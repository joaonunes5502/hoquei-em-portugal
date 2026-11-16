#!/usr/bin/env python3
"""
Robô do Hóquei em Português.
Lê o hp.fpp.pt e guarda tudo no Supabase.

Modos:
  python scrape.py rapido   -> calendário, resultados, classificação, marcadores e
                               detalhes (timeline, números, técnicos) dos jogos de ontem/hoje.
  python scrape.py completo -> descobre competições novas + tudo o anterior + plantéis
                               de todas as equipas (corre 1x por dia).
  python scrape.py aovivo   -> fica ligado até às 23:30: jogos a decorrer de 30 em 30 s,
                               classificações de 5 em 5 min, o resto de 30 em 30 min.
  python scrape.py auto     -> (agendado) ao vivo entre as 14:30 e as 23:30, rápido fora disso.

Variáveis de ambiente obrigatórias: SUPABASE_URL, SUPABASE_SERVICE_KEY
"""
import os, re, sys, time, json, base64, unicodedata, html as htmlmod
from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo
import requests
from bs4 import BeautifulSoup

BASE = "https://hp.fpp.pt"
DELAY = float(os.environ.get("SCRAPER_DELAY", "0.6"))   # pausa entre pedidos ao fpp.pt
MAX_BACKFILL = int(os.environ.get("SCRAPER_BACKFILL", "40"))  # jogos antigos sem detalhes por execução
TZ_PT = ZoneInfo("Europe/Lisbon")  # só serve para saber o que é "hoje"

VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "").strip()   # chave privada (backoffice > Notificações)
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "").strip() or "mailto:hoqueiemportugues@gmail.com"
INICIO_JANELA = (-2, 45)    # minutos à volta da hora marcada em que se avisa o início
FINAL_APOS = 95             # minutos depois da hora marcada a partir dos quais o jogo conta como terminado

# ---- modo ao vivo (hora de Portugal) ----
JANELA_VIVO = ((14, 30), (23, 30))   # o robô fica ligado entre estas horas
VIVO_JOGOS = 30                      # segundos entre leituras dos jogos a decorrer
VIVO_CLASSIFICACAO = 5 * 60          # classificações de todas as competições
VIVO_RESTO = 30 * 60                 # calendários completos, marcadores e jogos em atraso
VIVO_LIMITE = int(os.environ.get("SCRAPER_LIMITE", str(5 * 3600 + 40 * 60)))  # o GitHub corta aos 6h; parar antes

RE_EQUIPA = re.compile(r"/Equipa/(\d+)/(\d+)")
RE_JOGO = re.compile(r"/jogo/(\d+)")
RE_JOGO_TACA = re.compile(r"/jogoTaca/(\d+)")
TACA = 1_000_000_000   # os jogos das taças têm outra numeração no hp.fpp.pt (/jogoTaca/N) -> guardados como TACA + N
RE_CLUBE = re.compile(r"CLUBE_(\d+)\.", re.I)
RE_FED = re.compile(r"FED_(\d+)\.", re.I)
RE_TEMPO = re.compile(r"(\d{1,2}:\d{2})")


def txt(el):
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip() if el else ""


def base_clube(n):
    """'J. Pacense "B"' -> 'J. Pacense' (o clube é o mesmo da equipa principal)"""
    return re.sub(r'\s+["“”\']?[B-D]["“”\']?\s*$', "", (n or "").strip())


def hora_jogo(j):
    """Data + hora do jogo em Portugal, ou None."""
    if not j.get("data") or not j.get("hora"):
        return None
    try:
        h, m = (int(x) for x in j["hora"].split(":")[:2])
        return datetime.fromisoformat(j["data"]).replace(hour=h, minute=m, tzinfo=TZ_PT)
    except ValueError:
        return None


def _norm(t):
    return unicodedata.normalize("NFD", t or "").encode("ascii", "ignore").decode().lower()


def limpar_nome(n):
    n = re.split(r"\s*/\s*", (n or "").strip())[0].strip()
    n = re.sub(r"\s+SAD$", "", n, flags=re.I)
    return re.sub(r'\s*["“”\']([A-D])["“”\']\s*$', r" \1", n).strip()


def sufixo(n):
    m = re.search(r"\s([B-D])$", limpar_nome(n))
    return m.group(1) if m else ""


def escalao(comp):
    t = _norm((comp or {}).get("nome", "") + " " + ((comp or {}).get("grupo") or ""))
    if "femin" in t:
        return "F"
    m = re.search(r"sub\s*-?\s*(\d+)", t)
    return "S" + m.group(1) if m else ""


def chave_nome(n):
    """Nome para comparar equipas entre páginas: sem patrocinador, acentos, espaços ou pontuação."""
    return re.sub(r"[^a-z0-9]", "", _norm(limpar_nome(n)))


def chave_equipa(eq, comp):
    """Igual ao teamKey do site: 123, 123-B, 123-F, 123-B-S23..."""
    if not eq.get("clube_id"):
        return "e%s" % eq["id"]
    s, x = sufixo(eq["nome"]), escalao(comp)
    return str(eq["clube_id"]) + ("-" + s if s else "") + ("-" + x if x else "")


def nome_equipa(eq, clube):
    s = sufixo(eq["nome"])
    if clube and clube.get("nome_curto"):
        return clube["nome_curto"] + (" " + s if s else "")
    return limpar_nome(eq["nome"])


def to_int(s):
    m = re.search(r"-?\d+", s or "")
    return int(m.group()) if m else None


def id_provisorio(comp_id, numero):
    """Id negativo e estável para um jogo futuro sem ficha: -(competição*100000 + n.º do jogo).
    O site sabe converter este id de volta (competição + número) quando a ficha verdadeira aparece."""
    return -(int(comp_id) * 100000 + int(numero))


def ao_vivo_tv(j):
    """O hp.fpp.pt põe uma ligação tv.fpp.pt/live enquanto o jogo está a decorrer."""
    return bool(j.get("tv_url")) and "/live" in j["tv_url"]


def soup(h):
    return BeautifulSoup(h, "lxml")


# ======================================================================
#  PARSERS (só leem HTML -> dicionários; testáveis sem internet)
# ======================================================================
def parse_home(h):
    """Grupos de competições da época atual: [(grupo_id, epoca, nome)]"""
    out = []
    for a in soup(h).select("a[href]"):
        m = re.fullmatch(r"/(\d+)/(\d+)", a["href"].strip())
        if m:
            out.append((int(m.group(2)), int(m.group(1)), txt(a)))
    return out


def parse_group(h):
    """Competições dentro de um grupo: [(comp_id, nome)]"""
    out = []
    for a in soup(h).select('a[href^="/Competicao/"]'):
        cid = to_int(a["href"])
        if cid and txt(a):
            out.append((cid, txt(a)))
    return out


def parse_calendar(h, comp_id):
    """Devolve (jogos, equipas). Jogos: dicts prontos para a tabela 'jogos'."""
    s = soup(h)
    jogos, equipas = [], {}
    jornada_nome, jornada = None, 0
    for tr in s.select("table.calendario-hp tr"):
        titulo = tr.select_one(".titulo-jornada")
        if titulo:
            jornada_nome = txt(titulo)
            n = to_int(jornada_nome)
            jornada = n if n and "Jornada" in jornada_nome else jornada + 1
            continue
        tds = tr.find_all("td")
        if len(tds) < 5:
            continue
        a_jogo = tr.find("a", href=RE_JOGO)
        a_taca = tr.find("a", href=RE_JOGO_TACA)
        links = tr.find_all("a", href=RE_EQUIPA)
        numero = to_int(txt(tds[0]))
        nomes = [txt(p) for p in tr.select(".coluna-equipa")]
        if len(links) < 2 and (len(nomes) < 2 or not all(nomes)):
            continue
        if a_jogo:
            jid = int(RE_JOGO.search(a_jogo["href"]).group(1))
        elif a_taca:
            jid = TACA + int(RE_JOGO_TACA.search(a_taca["href"]).group(1))
        elif numero:
            # jogo futuro: o hp.fpp.pt ainda não tem ficha -> id provisório (negativo) até a ficha aparecer
            jid = id_provisorio(comp_id, numero)
        else:
            continue
        datahora = txt(tds[1])
        dm = re.search(r"(\d{4}-\d{2}-\d{2})", datahora)
        hm = re.search(r"(\d{1,2}:\d{2})", datahora)
        res = txt(tr.select_one(".resultado"))
        sm = re.match(r"^\s*(\d+)\s*-\s*(\d+)\s*$", res)
        if len(links) >= 2:
            casa = int(RE_EQUIPA.search(links[0]["href"]).group(2))
            fora = int(RE_EQUIPA.search(links[1]["href"]).group(2))
            equipas[casa] = txt(links[0])
            equipas[fora] = txt(links[1])
            nomes = [txt(links[0]), txt(links[1])]
        else:
            # taças: o calendário só tem os nomes; o robô descobre as equipas pelo nome (ou pela ficha do jogo)
            casa = fora = None
        tv = None
        for a in tr.find_all("a", href=True):
            if "tv.fpp.pt" in a["href"]:
                tv = htmlmod.unescape(a["href"])
        jogos.append({
            "id": jid,
            "competicao_id": comp_id,
            "jornada": jornada or None,
            "jornada_nome": jornada_nome,
            "numero": numero,
            "data": dm.group(1) if dm else None,
            "hora": hm.group(1) if hm else None,
            "casa_id": casa,
            "fora_id": fora,
            "casa_nome": nomes[0],
            "fora_nome": nomes[1],
            "golos_casa": int(sm.group(1)) if sm else None,
            "golos_fora": int(sm.group(2)) if sm else None,
            "tv_url": tv,
        })
    return jogos, equipas


def parse_classificacao(h):
    """Linhas: dict(pos, equipa_id, nome, clube_id, logo_url, pts, j, v, e, d, gm, gs, dg)"""
    rows = []
    for tr in soup(h).select("tr"):
        clube = tr.select_one("td.clube")
        if not clube:
            continue
        a = clube.find("a", href=RE_EQUIPA)
        img = clube.find("img")
        nums = [to_int(txt(td)) for td in tr.find_all("td") if "clube" not in (td.get("class") or []) and "classificacao" not in (td.get("class") or [])]
        if not a or len(nums) < 8:
            continue
        cm = RE_CLUBE.search(img["src"]) if img and img.get("src") else None
        rows.append({
            "pos": to_int(txt(tr.select_one("td.classificacao"))),
            "equipa_id": int(RE_EQUIPA.search(a["href"]).group(2)),
            "nome": txt(clube),
            "clube_id": int(cm.group(1)) if cm else None,
            "logo_url": img["src"] if img else None,
            "pts": nums[0], "j": nums[1], "v": nums[2], "e": nums[3], "d": nums[4],
            "gm": nums[5], "gs": nums[6], "dg": nums[7],
        })
    return rows


def parse_marcadores(h):
    out = []
    for row in soup(h).select(".player-row"):
        if "header" in (row.get("class") or []):
            continue
        spans = row.find_all("span", recursive=False)
        if len(spans) < 4:
            continue
        foto = spans[1].find("img")
        fm = RE_FED.search(foto["src"]) if foto and foto.get("src") else None
        if not fm:
            continue  # sem n.º de federado não conseguimos identificar o jogador
        logo = spans[2].find("img")
        cm = RE_CLUBE.search(logo["src"]) if logo and logo.get("src") else None
        out.append({
            "pos": to_int(txt(spans[0])),
            "jogador_id": int(fm.group(1)),
            "nome": txt(spans[1]),
            "foto_url": foto["src"],
            "clube_id": int(cm.group(1)) if cm else None,
            "clube_nome": txt(spans[2]),
            "clube_logo": logo["src"] if logo else None,
            "golos": to_int(txt(spans[3])) or 0,
        })
    return out


def parse_equipa(h):
    s = soup(h)
    logo = s.select_one(".team-logo1")
    cm = RE_CLUBE.search(logo["src"]) if logo and logo.get("src") else None
    stats = {}
    for item in s.select(".stat-item"):
        label = txt(item.find("p")).lower()
        val = item.select_one("h3 span")
        if val is None:
            continue
        if "marcados" in label: stats["golos_marcados"] = to_int(txt(val))
        elif "sofridos" in label: stats["golos_sofridos"] = to_int(txt(val))
        elif "faltas" in label: stats["faltas"] = to_int(txt(val))
    jogadores = []
    for card in s.select(".player-card"):
        img = card.find("img")
        fm = RE_FED.search(img["src"]) if img and img.get("src") else None
        nome = txt(card.select_one(".player-name"))
        if not fm or not nome:
            continue
        jogadores.append({"id": int(fm.group(1)), "nome": nome, "foto_url": img["src"],
                          "golos": to_int(txt(card.select_one(".player-nationality"))) or 0})
    return {"clube_id": int(cm.group(1)) if cm else None, "logo_url": logo["src"] if logo else None,
            "nome": txt(s.select_one(".stats-section h2")), "stats": stats, "jogadores": jogadores}


def parse_jogo(h):
    s = soup(h)
    out = {"arbitros": None, "equipas": [], "ajax": {}, "logos": []}
    for p in s.select("#scoreboard p"):
        t = txt(p)
        if t.startswith("Árbitros"):
            out["arbitros"] = t.split(":", 1)[1].strip()
    for a in s.select("#scoreboard a[href]"):
        m = RE_EQUIPA.search(a["href"])
        img = a.find("img")
        if m and img and img.get("src"):
            cm = RE_CLUBE.search(img["src"])
            out["logos"].append((int(m.group(2)), int(cm.group(1)) if cm else None, img["src"], txt(a)))
    for team in s.select("#Equipas .team"):
        jog, tec = [], []
        for pl in team.select(".player"):
            img = pl.find("img")
            fm = RE_FED.search(img["src"]) if img and img.get("src") else None
            m = re.match(r"N\.º\s*(\d+)\s*-\s*(.+?)(\s*\([^)]*\))?$", txt(pl.find("p")))
            if fm and m:
                jog.append({"id": int(fm.group(1)), "numero": int(m.group(1)), "nome": m.group(2).strip(), "foto_url": img["src"]})
        for st in team.select(".staff-member"):
            img = st.find("img")
            t = txt(st.find("p"))
            if " - " in t:
                funcao, nome = t.split(" - ", 1)
                tec.append({"funcao": funcao.strip(), "nome": nome.strip(), "foto_url": img["src"] if img else None})
        out["equipas"].append({"jogadores": jog, "tecnicos": tec})
    # pedidos AJAX que a página faz (timeline e estatísticas precisam do token da página)
    for url, data in re.findall(r'url:\s*"(/Views/[^"]+)",\s*data:\s*\'([^\']+)\'', h):
        out["ajax"].setdefault(url, htmlmod.unescape(data))
    return out


def parse_timeline(h):
    """Eventos por ordem cronológica: dict(parte, tempo, tipo, lado, jogador, jogador_id)."""
    s = soup(h)
    blocos, parte = [], None
    for el in s.find_all(["h3", "div"]):
        if el.name == "h3":
            parte = txt(el)
            blocos.append([parte, []])
            continue
        cls = el.get("class") or []
        if "time" not in cls:
            continue
        if not blocos:
            blocos.append([None, []])
        t = txt(el)
        low = t.lower()
        tipo = classificar(low)
        tm = RE_TEMPO.search(t)
        img = el.find("img")
        fm = RE_FED.search(img["src"]) if img and img.get("src") else None
        jogador = None
        if tipo in COM_JOGADOR:
            ps = el.find_all("p")
            if ps:
                jogador = RE_TEMPO.sub("", txt(ps[-1])).strip() or None
        blocos[-1][1].append({
            "parte": blocos[-1][0], "tempo": tm.group(1) if tm else None, "tipo": tipo,
            "lado": "fora" if ("justify-content-end" in cls or "time-team2" in cls) else "casa",
            "jogador": jogador, "jogador_id": int(fm.group(1)) if fm else None,
        })
    # o site mostra o mais recente primeiro -> inverter tudo
    eventos = [e for _, evs in reversed(blocos) for e in reversed(evs)]
    for i, e in enumerate(eventos):
        e["ordem"] = i
    return eventos


COM_JOGADOR = ("golo", "golo_penalti", "golo_livre", "autogolo", "penalti_falhado", "livre_falhado", "defesa",
               "azul", "amarelo", "vermelho")


def classificar(low):
    """Texto de um acontecimento do hp.fpp.pt -> tipo."""
    if "defend" in low or "defesa" in low:
        return "defesa"
    if "falhad" in low:
        return "penalti_falhado" if ("penalti" in low or "penálti" in low) else "livre_falhado"
    if "golo" in low:
        if "auto" in low: return "autogolo"
        if "penalti" in low or "penálti" in low: return "golo_penalti"
        if "livre" in low: return "golo_livre"
        return "golo"
    if "azul" in low: return "azul"
    if "amarelo" in low: return "amarelo"
    if "vermelho" in low: return "vermelho"
    if "desconto" in low: return "desconto"
    if "falta" in low: return "falta"
    return "outro"


def parse_estatisticas(h):
    faltas = {}
    for col in soup(h).select(".team-column"):
        cls = col.get("class") or []
        for p in col.find_all("p"):
            m = re.match(r"(\d+)\s+Faltas?", txt(p))
            if m:
                faltas["casa" if "team-visitada" in cls else "fora"] = int(m.group(1))
    return faltas


# ======================================================================
#  SUPABASE
# ======================================================================
class DB:
    def __init__(self, url, key):
        # aceita o URL com ou sem "/rest/v1" ou outros caminhos no fim: fica só https://xxxx.supabase.co
        m = re.match(r"(https?://[^/]+)", url.strip())
        self.url = (m.group(1) if m else url.rstrip("/")) + "/rest/v1"
        # chaves novas (sb_secret_...) vão só no cabeçalho "apikey"; as antigas (service_role, JWT) também no Authorization
        self.h = {"apikey": key, "Content-Type": "application/json"}
        if not key.startswith("sb_"):
            self.h["Authorization"] = f"Bearer {key}"

    def upsert(self, table, rows, on_conflict=None):
        rows = [r for r in rows if r]
        if not rows:
            return
        # a mesma chave não pode aparecer duas vezes no mesmo pedido (ex.: clube com equipa A e B) -> juntar
        if on_conflict:
            keys = on_conflict.split(",")
            merged = {}
            for r in rows:
                k = tuple(r.get(x) for x in keys)
                merged[k] = {**merged.get(k, {}), **{a: b for a, b in r.items() if b is not None or a not in merged.get(k, {})}}
            rows = list(merged.values())
        # todas as linhas de um pedido têm de ter as mesmas colunas
        groups = {}
        for r in rows:
            groups.setdefault(tuple(sorted(r)), []).append(r)
        for _, grp in groups.items():
            for i in range(0, len(grp), 500):
                q = f"?on_conflict={on_conflict}" if on_conflict else ""
                r = requests.post(f"{self.url}/{table}{q}", headers={**self.h, "Prefer": "resolution=merge-duplicates,return=minimal"},
                                  data=json.dumps(grp[i:i + 500], default=str), timeout=60)
                if r.status_code >= 300:
                    raise RuntimeError(f"Supabase {table}: {r.status_code} {r.text[:300]}")

    def delete(self, table, query):
        r = requests.delete(f"{self.url}/{table}?{query}", headers=self.h, timeout=60)
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase delete {table}: {r.status_code} {r.text[:300]}")

    def select(self, table, query):
        r = requests.get(f"{self.url}/{table}?{query}", headers=self.h, timeout=60)
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase select {table}: {r.status_code} {r.text[:300]}")
        return r.json()


# ======================================================================
#  ROBÔ
# ======================================================================
class Robo:
    def __init__(self, db):
        self.db = db
        self.s = requests.Session()
        self.s.headers["User-Agent"] = "HoqueiEmPortugues-bot/1.0 (+https://www.instagram.com/hoqueiemportugues/)"
        self.pedidos, self.erros = 0, []
        self.hoje = datetime.now(TZ_PT).date()

    def get(self, path, params=None):
        for tentativa in range(3):  # o fpp.pt às vezes corta a ligação: tentar outra vez
            time.sleep(DELAY * (1 + 3 * tentativa))
            self.pedidos += 1
            try:
                r = self.s.get(BASE + path, params=params, timeout=30)
                r.raise_for_status()
                return r.content.decode("utf-8", errors="replace")
            except requests.RequestException:
                if tentativa == 2:
                    raise

    # ---------- descoberta ----------
    def descobrir(self):
        grupos = parse_home(self.get("/"))
        ordem = 0
        for gid, epoca, gnome in grupos:
            for cid, nome in parse_group(self.get(f"/{epoca}/{gid}")):
                ordem += 1
                self.db.upsert("competicoes", [{"id": cid, "nome": nome, "grupo": gnome, "grupo_id": gid, "epoca": epoca}], "id")
        print(f"Descoberta: {len(grupos)} grupos")

    # ---------- uma competição ----------
    def competicao(self, cid):
        jogos = self.calendario(cid)
        self.classificacao(cid)
        self.marcadores(cid)
        return jogos

    def calendario(self, cid):
        jogos, equipas = parse_calendar(self.get(f"/Competicao/{cid}"), cid)
        self.db.upsert("equipas", [{"id": k, "competicao_id": cid, "nome": v} for k, v in equipas.items()], "id")
        if any(j["casa_id"] is None or j["fora_id"] is None for j in jogos):
            self.equipas_pelo_nome(cid, jogos)

        agora = datetime.now(TZ_PT)
        for j in jogos:
            if j["golos_casa"] is None:
                j["estado"] = "agendado"
            else:
                k = hora_jogo(j)
                if ao_vivo_tv(j) and k is not None and agora - k < timedelta(hours=3):
                    j["estado"] = "provisorio"  # ainda com transmissão em direto: não terminou (atrasos)
                    continue
                j["estado"] = "final" if (k is None and j["data"] and j["data"] < self.hoje.isoformat()) or (k is not None and agora - k >= timedelta(minutes=FINAL_APOS)) else "provisorio"
        self.db.upsert("jogos", jogos, "id")
        self.trocar_provisorios(cid, jogos)
        self.db.upsert("competicoes", [{"id": cid, "atualizado_em": datetime.now(timezone.utc).isoformat()}], "id")
        return jogos

    def indice_equipas(self):
        """nome normalizado -> [(id, escalão)] de todas as equipas conhecidas (lido 1x por execução)."""
        if getattr(self, "_indice", None) is None:
            comps = {c["id"]: c for c in self.db.select("competicoes", "select=id,nome,grupo")}
            self._indice = {}
            for e in self.db.select("equipas", "select=id,nome,competicao_id"):
                c = comps.get(e.get("competicao_id")) or {}
                self._indice.setdefault(chave_nome(e["nome"]), []).append((e["id"], escalao(c)))
        return self._indice

    def equipas_pelo_nome(self, cid, jogos):
        """Taças: o calendário só traz nomes. Usa os ids que a ficha do jogo já deu; senão procura pelo nome
        (no mesmo escalão: uma taça feminina procura nas equipas femininas)."""
        comp = (self.db.select("competicoes", f"select=nome,grupo&id=eq.{cid}") or [{}])[0]
        esc = escalao(comp)
        antes = {j["id"]: j for j in self.db.select("jogos", f"select=id,casa_id,fora_id&competicao_id=eq.{cid}")}
        idx = self.indice_equipas()
        for j in jogos:
            for lado in ("casa", "fora"):
                if j[lado + "_id"] is not None:
                    continue
                j[lado + "_id"] = (antes.get(j["id"]) or {}).get(lado + "_id")
                if j[lado + "_id"] is None:
                    cand = idx.get(chave_nome(j[lado + "_nome"]), [])
                    certos = [i for i, e in cand if e == esc] or ([i for i, e in cand] if len(cand) == 1 else [])
                    j[lado + "_id"] = certos[0] if certos else None

    def trocar_provisorios(self, cid, jogos):
        """Quando um jogo futuro ganha ficha no hp.fpp.pt, passa o que o backoffice/notificações guardaram
        no id provisório para o id verdadeiro e apaga o provisório."""
        reais = {id_provisorio(cid, j["numero"]): j["id"] for j in jogos if j["id"] > 0 and j["numero"]}
        if not reais:
            return
        antigos = self.db.select("jogos", f"select=id,canal_tv,destaque,nota&competicao_id=eq.{cid}&id=lt.0")
        antigos = [a for a in antigos if a["id"] in reais]
        if not antigos:
            return
        ids = ",".join(str(a["id"]) for a in antigos)
        for a in antigos:
            extra = {k: a[k] for k in ("canal_tv", "destaque", "nota") if a.get(k)}
            if extra:
                self.db.upsert("jogos", [{"id": reais[a["id"]], **extra}], "id")
        notifs = self.db.select("notificacoes_enviadas", f"select=jogo_id,tipo,destinatarios&jogo_id=in.({ids})")
        if notifs:
            self.db.upsert("notificacoes_enviadas", [{**n, "jogo_id": reais[n["jogo_id"]]} for n in notifs], "jogo_id,tipo")
        self.db.delete("jogos", f"id=in.({ids})")
        print(f"Competição {cid}: {len(antigos)} jogos futuros ganharam ficha")

    def classificacao(self, cid):
        cls = parse_classificacao(self.get(f"/Classificacao/{cid}"))
        self.db.upsert("clubes", [{"id": r["clube_id"], "nome": base_clube(r["nome"]), "logo_url": r["logo_url"]} for r in cls if r["clube_id"]], "id")
        self.db.upsert("equipas", [{"id": r["equipa_id"], "competicao_id": cid, "nome": r["nome"], "clube_id": r["clube_id"]} for r in cls], "id")
        if cls:
            self.db.delete("classificacao", f"competicao_id=eq.{cid}")
            self.db.upsert("classificacao", [{k: r[k] for k in ("pos", "equipa_id", "pts", "j", "v", "e", "d", "gm", "gs", "dg")} | {"competicao_id": cid} for r in cls])

    def marcadores(self, cid):
        mk = parse_marcadores(self.get(f"/Marcadores/{cid}"))
        self.db.upsert("clubes", [{"id": m["clube_id"], "nome": base_clube(m["clube_nome"]), "logo_url": m["clube_logo"]} for m in mk if m["clube_id"]], "id")
        self.db.upsert("jogadores", [{"id": m["jogador_id"], "nome": m["nome"], "foto_url": m["foto_url"]} for m in mk], "id")
        if mk:
            self.db.delete("marcadores", f"competicao_id=eq.{cid}")
            vistos = set()
            self.db.upsert("marcadores", [{"competicao_id": cid, "jogador_id": m["jogador_id"], "pos": m["pos"], "nome": m["nome"],
                                          "clube_id": m["clube_id"], "golos": m["golos"]} for m in mk
                                         if not (m["jogador_id"] in vistos or vistos.add(m["jogador_id"]))])

    # ---------- detalhes de um jogo ----------
    def jogo(self, j):
        if j["id"] < 0:
            return  # jogo futuro ainda sem ficha no hp.fpp.pt
        h = self.get(f"/jogoTaca/{j['id'] - TACA}" if j["id"] >= TACA else f"/jogo/{j['id']}")
        info = parse_jogo(h)
        upd = {"id": j["id"], "arbitros": info["arbitros"], "detalhes_em": datetime.now(timezone.utc).isoformat()}

        ids = []
        for eid, clube_id, logo, nome in info["logos"]:
            if clube_id:
                self.db.upsert("clubes", [{"id": clube_id, "nome": base_clube(nome), "logo_url": logo}], "id")
                self.db.upsert("equipas", [{"id": eid, "nome": nome, "clube_id": clube_id}], "id")
                ids.append(eid)
            else:
                ids.append(None)
        casa_id, fora_id = j.get("casa_id"), j.get("fora_id")
        if len(ids) == 2 and all(ids):
            casa_id, fora_id = ids          # a ficha diz exatamente que equipas são (importante nas taças)
            upd["casa_id"], upd["fora_id"] = ids

        for lado, equipa_id in zip(("casa", "fora"), (casa_id, fora_id)):
            idx = 0 if lado == "casa" else 1
            if equipa_id is None or idx >= len(info["equipas"]):
                continue
            eq = info["equipas"][idx]
            self.db.upsert("jogadores", [{"id": p["id"], "nome": p["nome"], "foto_url": p["foto_url"], "numero": p["numero"]} for p in eq["jogadores"]], "id")
            self.db.upsert("plantel", [{"equipa_id": equipa_id, "jogador_id": p["id"]} for p in eq["jogadores"]], "equipa_id,jogador_id")
            self.db.upsert("tecnicos", [{"equipa_id": equipa_id, **t} for t in eq["tecnicos"]], "equipa_id,nome")

        tl = next((d for u, d in info["ajax"].items() if u.endswith("ajax_jogo.php")), None)
        if tl:
            eventos = parse_timeline(self.get("/Views/ajax_jogo.php?" + tl))
            self.db.delete("eventos", f"jogo_id=eq.{j['id']}")
            self.db.upsert("eventos", [{"jogo_id": j["id"], **e} for e in eventos])
        st = next((d for u, d in info["ajax"].items() if u.endswith("ajax_estatisticasJogo.php")), None)
        if st:
            f = parse_estatisticas(self.get("/Views/ajax_estatisticasJogo.php?" + st))
            upd["faltas_casa"], upd["faltas_fora"] = f.get("casa"), f.get("fora")
        self.db.upsert("jogos", [upd], "id")

    # ---------- plantel completo ----------
    def equipa(self, cid, eid):
        e = parse_equipa(self.get(f"/Equipa/{cid}/{eid}"))
        if e["clube_id"]:
            self.db.upsert("clubes", [{"id": e["clube_id"], "nome": base_clube(e["nome"]) or str(e["clube_id"]), "logo_url": e["logo_url"]}], "id")
        self.db.upsert("equipas", [{"id": eid, "competicao_id": cid, "nome": e["nome"] or str(eid), "clube_id": e["clube_id"],
                                    "plantel_em": datetime.now(timezone.utc).isoformat(), **e["stats"]}], "id")
        self.db.upsert("jogadores", [{"id": p["id"], "nome": p["nome"], "foto_url": p["foto_url"]} for p in e["jogadores"]], "id")
        self.db.upsert("plantel", [{"equipa_id": eid, "jogador_id": p["id"], "golos": p["golos"]} for p in e["jogadores"]], "equipa_id,jogador_id")

    # ---------- execução ----------
    def ativas(self):
        return self.db.select("competicoes", "select=id,nome&ativa=eq.true&order=ordem,id")

    def correr(self, modo, fechar=True):
        comps = self.ativas()
        if modo == "completo" or not comps:
            self.tentar("descoberta", self.descobrir)
            comps = self.ativas()

        todos = []
        for c in comps:
            r = self.tentar(f"competição {c['id']} ({c['nome']})", self.competicao, c["id"])
            if r:
                todos += r
        self.atrasados(todos, 2000 if modo == "completo" else MAX_BACKFILL)

        if modo == "completo":
            eqs = self.db.select("equipas", "select=id,competicao_id&competicao_id=not.is.null")
            ativos = {c["id"] for c in comps}
            for e in eqs:
                if e["competicao_id"] in ativos:
                    self.tentar(f"equipa {e['id']}", self.equipa, e["competicao_id"], e["id"])

        self.tentar("notificações", self.notificar)
        if fechar:
            return self.fim(modo, len(comps))

    def atrasados(self, todos, limite):
        """Detalhes: jogos dos últimos 3 dias (resultados podem ser corrigidos) + os que ainda não têm detalhes."""
        desde = (self.hoje - timedelta(days=3)).isoformat()
        recentes = [j for j in todos if j["id"] > 0 and j["data"] and desde <= j["data"] <= self.hoje.isoformat() and j["golos_casa"] is not None]
        sem = self.db.select("jogos", f"select=id,casa_id,fora_id&id=gt.0&golos_casa=not.is.null&detalhes_em=is.null&order=data.desc&limit={limite}")
        ids = {j["id"] for j in recentes}
        fila = recentes + [x for x in sem if x["id"] not in ids]
        print(f"Detalhes de {len(fila)} jogos")
        for j in fila:
            self.tentar(f"jogo {j['id']}", self.jogo, j)

    def fim(self, modo, ncomps):
        self.estado(modo, ncomps)
        print(f"Feito ({modo}): {self.pedidos} pedidos ao hp.fpp.pt, {len(self.erros)} erros")
        return len(self.erros) == 0 or self.pedidos > 0

    def estado(self, modo, ncomps):
        self.tentar("estado", self.db.upsert, "definicoes", [{"chave": "ultima_atualizacao", "valor": {
            "quando": datetime.now(timezone.utc).isoformat(), "modo": modo, "pedidos": self.pedidos,
            "competicoes": ncomps, "erros": self.erros[-20:]}}], "chave")

    # ---------- modo ao vivo ----------
    @staticmethod
    def janela(agora):
        (h1, m1), (h2, m2) = JANELA_VIVO
        return agora.replace(hour=h1, minute=m1, second=0, microsecond=0), agora.replace(hour=h2, minute=m2, second=0, microsecond=0)

    @classmethod
    def modo_auto(cls, agora=None):
        """Execuções agendadas: dentro da janela (ou até 15 min antes) -> ao vivo; fora -> rápido."""
        agora = agora or datetime.now(TZ_PT)
        ini, fim = cls.janela(agora)
        return "aovivo" if ini - timedelta(minutes=15) <= agora < fim else "rapido"

    def jogos_a_decorrer(self, jogos, agora):
        """Jogos de hoje entre 15 min antes da hora marcada e o fim (ou até 3h depois, se a FPP se atrasar)."""
        out = []
        for j in jogos:
            k = hora_jogo(j)
            if k is None or j.get("estado") == "final":
                continue
            mins = (agora - k).total_seconds() / 60
            if -15 <= mins <= 180:
                out.append(j)
        return out

    def ao_vivo(self):
        arranque = time.time()
        agora = datetime.now(TZ_PT)
        ini, fim = self.janela(agora)
        if agora < ini - timedelta(minutes=15) or agora >= fim:
            # lançado à mão fora do horário: sessão de teste de 30 minutos
            ini, fim = agora, agora + timedelta(minutes=30)
            print("Fora do horário dos jogos: sessão de teste de 30 minutos")
        if agora < ini:
            espera = (ini - agora).total_seconds()
            print(f"À espera das {ini:%H:%M} ({espera/60:.0f} min)")
            time.sleep(espera)
        print(f"Modo ao vivo até às {fim:%H:%M}")
        self.correr("rapido", fechar=False)
        comps = self.ativas()
        t_cls = t_resto = t_estado = time.time()
        voltas = 0
        while True:
            tick = time.time()
            agora = datetime.now(TZ_PT)
            if agora >= fim:
                print("Fim da janela do modo ao vivo")
                break
            if tick - arranque >= VIVO_LIMITE:
                print("Limite de tempo do GitHub: a próxima execução continua")
                break
            self.hoje = agora.date()

            if tick - t_resto >= VIVO_RESTO:
                comps = self.ativas() or comps
                todos = []
                for c in comps:
                    todos += self.tentar(f"competição {c['id']} ({c['nome']})", self.competicao, c["id"]) or []
                self.atrasados(todos, MAX_BACKFILL)
                t_resto = t_cls = tick
            elif tick - t_cls >= VIVO_CLASSIFICACAO:
                for c in comps:
                    self.tentar(f"classificação {c['id']}", self.classificacao, c["id"])
                t_cls = tick

            hoje = self.db.select("jogos", f"select=id,competicao_id,data,hora,estado&data=eq.{self.hoje.isoformat()}") or []
            ativos = {c["id"] for c in comps}
            vivos = [j for j in self.jogos_a_decorrer(hoje, agora) if j["competicao_id"] in ativos]
            for cid in sorted({j["competicao_id"] for j in vivos}):
                frescos = self.tentar(f"calendário {cid}", self.calendario, cid) or []
                for j in self.jogos_a_decorrer([x for x in frescos if x["data"] == self.hoje.isoformat()], agora):
                    if j["id"] > 0:
                        self.tentar(f"jogo {j['id']}", self.jogo, j)
            self.tentar("notificações", self.notificar)

            voltas += 1
            if tick - t_estado >= VIVO_CLASSIFICACAO:
                self.estado("ao vivo", len(comps))
                t_estado = tick
                print(f"{agora:%H:%M} · {voltas} voltas · {len(vivos)} jogos a decorrer · {self.pedidos} pedidos · {len(self.erros)} erros")
            time.sleep(max(5, VIVO_JOGOS - (time.time() - tick)))
        return self.fim("ao vivo", len(comps))

    # ---------- notificações (início e resultado final) ----------
    def notificar(self):
        if not VAPID_PRIVATE_KEY:
            print("Notificações desligadas (falta o segredo VAPID_PRIVATE_KEY)")
            return
        from py_vapid import Vapid01
        self.vapid = Vapid01.from_raw(VAPID_PRIVATE_KEY.strip().encode())  # a chave "d" (base64url) gerada no backoffice
        self.manuais()
        agora = datetime.now(TZ_PT)
        ontem = (self.hoje - timedelta(days=1)).isoformat()
        jogos = self.db.select("jogos", f"select=id,competicao_id,jornada_nome,data,hora,casa_id,fora_id,golos_casa,golos_fora&data=gte.{ontem}&data=lte.{self.hoje.isoformat()}")
        if not jogos:
            return
        ids = ",".join(str(j["id"]) for j in jogos)
        feitos = {(n["jogo_id"], n["tipo"]) for n in self.db.select("notificacoes_enviadas", f"select=jogo_id,tipo&jogo_id=in.({ids})")}
        comps = {c["id"]: c for c in self.db.select("competicoes", "select=id,nome,nome_curto,grupo,ativa")}
        jogos = [j for j in jogos if j["casa_id"] is not None and j["fora_id"] is not None]
        eids = ",".join({str(j["casa_id"]) for j in jogos} | {str(j["fora_id"]) for j in jogos}) or "0"
        eqs = {e["id"]: e for e in self.db.select("equipas", f"select=id,nome,clube_id,competicao_id&id=in.({eids})")}
        clubes = {c["id"]: c for c in self.db.select("clubes", "select=id,nome_curto&nome_curto=not.is.null")}
        fila = []
        for j in jogos:
            comp = comps.get(j["competicao_id"])
            k = hora_jogo(j)
            if not comp or not comp.get("ativa") or k is None or j["casa_id"] not in eqs or j["fora_id"] not in eqs:
                continue
            mins = (agora - k).total_seconds() / 60
            if INICIO_JANELA[0] <= mins <= INICIO_JANELA[1] and (j["id"], "inicio") not in feitos:
                fila.append(("inicio", j, comp))
            if j["golos_casa"] is not None and FINAL_APOS <= mins <= 14 * 60 and (j["id"], "final") not in feitos:
                fila.append(("final", j, comp))
        if not fila:
            return
        subs = self.db.select("subscricoes", "select=endpoint,p256dh,auth,equipas")
        for tipo, j, comp in fila:
            ec, ef = eqs[j["casa_id"]], eqs[j["fora_id"]]
            casa, fora = nome_equipa(ec, clubes.get(ec.get("clube_id"))), nome_equipa(ef, clubes.get(ef.get("clube_id")))
            chaves = {chave_equipa(ec, comp), chave_equipa(ef, comp)}
            prova = (comp.get("nome_curto") or comp["nome"]) + (" · " + j["jornada_nome"] if j.get("jornada_nome") else "")
            if tipo == "inicio":
                msg = {"title": f"🏒 Começou: {casa} vs {fora}", "body": f"{prova}. Vais receber o resultado final quando o jogo terminar.", "tag": f"jogo-{j['id']}"}
            else:
                msg = {"title": f"🏁 Final: {casa} {j['golos_casa']}-{j['golos_fora']} {fora}", "body": f"{prova}. Toca para veres a linha de jogo.", "tag": f"jogo-{j['id']}"}
            msg["url"] = f"/#/jogo/{j['id']}"
            alvo = [x for x in subs if chaves & set(x.get("equipas") or [])]
            enviados = self.enviar(alvo, msg, 3600 if tipo == "inicio" else 43200, f"{tipo} jogo {j['id']}")
            self.db.upsert("notificacoes_enviadas", [{"jogo_id": j["id"], "tipo": tipo, "destinatarios": enviados}], "jogo_id,tipo")
            print(f"Notificação {tipo} do jogo {j['id']}: {enviados} aparelhos")

    def enviar(self, subs, msg, ttl, nome):
        """Envia uma notificação a vários aparelhos. Devolve quantos a receberam."""
        from pywebpush import webpush, WebPushException
        enviados = 0
        for sub in subs:
            try:
                webpush({"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}},
                        json.dumps(msg, ensure_ascii=False), vapid_private_key=self.vapid,
                        vapid_claims={"sub": VAPID_SUBJECT}, ttl=ttl, timeout=10)
                enviados += 1
            except WebPushException as ex:
                st = getattr(getattr(ex, "response", None), "status_code", None)
                if st in (404, 410):  # o aparelho deixou de aceitar notificações: apagar
                    self.db.delete("subscricoes", "endpoint=eq." + requests.utils.quote(sub["endpoint"], safe=""))
                else:
                    self.erros.append(f"notificação {nome}: {st} {str(ex)[:120]}")
            except Exception as ex:
                self.erros.append(f"notificação {nome}: {str(ex)[:150]}")
        return enviados

    def manuais(self):
        """Notificações pedidas no backoffice (teste ou aviso a todos)."""
        pend = self.db.select("notificacoes_manuais", "select=id,titulo,corpo,url,destino,endpoint&enviado_em=is.null&order=criado_em&limit=20")
        if not pend:
            return
        subs = self.db.select("subscricoes", "select=endpoint,p256dh,auth,equipas")
        for n in pend:
            alvo = subs if n["destino"] == "todos" else [x for x in subs if x["endpoint"] == n.get("endpoint")]
            msg = {"title": n["titulo"], "body": n.get("corpo") or "", "url": n.get("url") or "/", "tag": "manual-" + n["id"][:8]}
            env = self.enviar(alvo, msg, 3600, "manual " + n["id"][:8])
            self.db.upsert("notificacoes_manuais", [{"id": n["id"], "enviado_em": datetime.now(timezone.utc).isoformat(), "destinatarios": env}], "id")
            print(f"Notificação manual '{n['titulo']}': {env} aparelhos")

    def tentar(self, nome, fn, *a):
        try:
            return fn(*a)
        except Exception as ex:  # um erro numa página não pára o resto
            msg = f"{nome}: {ex}"
            print("ERRO", msg)
            self.erros.append(msg[:300])


if __name__ == "__main__":
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        sys.exit("Faltam os segredos SUPABASE_URL e SUPABASE_SERVICE_KEY (GitHub > Settings > Secrets and variables > Actions).")
    modo = (sys.argv[1] if len(sys.argv) > 1 else "auto").lower().replace(" ", "")
    if modo == "auto":
        modo = Robo.modo_auto()
    robo = Robo(DB(url, key))
    if modo.startswith("comp"):
        ok = robo.correr("completo")
    elif modo in ("aovivo", "vivo"):
        ok = robo.ao_vivo()
    else:
        ok = robo.correr("rapido")
    sys.exit(0 if ok else 1)
