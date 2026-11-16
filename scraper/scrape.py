#!/usr/bin/env python3
"""
Robô do Hóquei em Português.
Lê o hp.fpp.pt e guarda tudo no Supabase.

Modos:
  python scrape.py rapido   -> calendário, resultados, classificação, marcadores e
                               detalhes (timeline, números, técnicos) dos jogos de ontem/hoje.
  python scrape.py completo -> descobre competições novas + tudo o anterior + plantéis
                               de todas as equipas (corre 1x por dia).

Variáveis de ambiente obrigatórias: SUPABASE_URL, SUPABASE_SERVICE_KEY
"""
import os, re, sys, time, json, html as htmlmod
from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo
import requests
from bs4 import BeautifulSoup

BASE = "https://hp.fpp.pt"
DELAY = float(os.environ.get("SCRAPER_DELAY", "0.6"))   # pausa entre pedidos ao fpp.pt
MAX_BACKFILL = int(os.environ.get("SCRAPER_BACKFILL", "40"))  # jogos antigos sem detalhes por execução
TZ_PT = ZoneInfo("Europe/Lisbon")  # só serve para saber o que é "hoje"

RE_EQUIPA = re.compile(r"/Equipa/(\d+)/(\d+)")
RE_JOGO = re.compile(r"/jogo/(\d+)")
RE_CLUBE = re.compile(r"CLUBE_(\d+)\.", re.I)
RE_FED = re.compile(r"FED_(\d+)\.", re.I)
RE_TEMPO = re.compile(r"(\d{1,2}:\d{2})")


def txt(el):
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip() if el else ""


def base_clube(n):
    """'J. Pacense "B"' -> 'J. Pacense' (o clube é o mesmo da equipa principal)"""
    return re.sub(r'\s+["“”\']?[B-D]["“”\']?\s*$', "", (n or "").strip())


def to_int(s):
    m = re.search(r"-?\d+", s or "")
    return int(m.group()) if m else None


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
        links = tr.find_all("a", href=RE_EQUIPA)
        if not a_jogo or len(links) < 2:
            continue
        datahora = txt(tds[1])
        dm = re.search(r"(\d{4}-\d{2}-\d{2})", datahora)
        hm = re.search(r"(\d{1,2}:\d{2})", datahora)
        res = txt(tr.select_one(".resultado"))
        sm = re.match(r"^\s*(\d+)\s*-\s*(\d+)\s*$", res)
        casa = int(RE_EQUIPA.search(links[0]["href"]).group(2))
        fora = int(RE_EQUIPA.search(links[1]["href"]).group(2))
        equipas[casa] = txt(links[0])
        equipas[fora] = txt(links[1])
        tv = None
        for a in tr.find_all("a", href=True):
            if "tv.fpp.pt" in a["href"]:
                tv = htmlmod.unescape(a["href"])
        jogos.append({
            "id": int(RE_JOGO.search(a_jogo["href"]).group(1)),
            "competicao_id": comp_id,
            "jornada": jornada or None,
            "jornada_nome": jornada_nome,
            "numero": to_int(txt(tds[0])),
            "data": dm.group(1) if dm else None,
            "hora": hm.group(1) if hm else None,
            "casa_id": casa,
            "fora_id": fora,
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
        if "golo" in low: tipo = "golo"
        elif "azul" in low: tipo = "azul"
        elif "amarelo" in low: tipo = "amarelo"
        elif "vermelho" in low: tipo = "vermelho"
        elif "desconto" in low: tipo = "desconto"
        elif "falta" in low: tipo = "falta"
        else: tipo = "outro"
        tm = RE_TEMPO.search(t)
        img = el.find("img")
        fm = RE_FED.search(img["src"]) if img and img.get("src") else None
        jogador = None
        if tipo in ("golo", "azul", "amarelo", "vermelho"):
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
        jogos, equipas = parse_calendar(self.get(f"/Competicao/{cid}"), cid)
        self.db.upsert("equipas", [{"id": k, "competicao_id": cid, "nome": v} for k, v in equipas.items()], "id")

        for j in jogos:
            if j["golos_casa"] is None:
                j["estado"] = "agendado"
            else:
                d = date.fromisoformat(j["data"]) if j["data"] else self.hoje
                j["estado"] = "provisorio" if d >= self.hoje else "final"
        self.db.upsert("jogos", jogos, "id")

        cls = parse_classificacao(self.get(f"/Classificacao/{cid}"))
        self.db.upsert("clubes", [{"id": r["clube_id"], "nome": base_clube(r["nome"]), "logo_url": r["logo_url"]} for r in cls if r["clube_id"]], "id")
        self.db.upsert("equipas", [{"id": r["equipa_id"], "competicao_id": cid, "nome": r["nome"], "clube_id": r["clube_id"]} for r in cls], "id")
        if cls:
            self.db.delete("classificacao", f"competicao_id=eq.{cid}")
            self.db.upsert("classificacao", [{k: r[k] for k in ("pos", "equipa_id", "pts", "j", "v", "e", "d", "gm", "gs", "dg")} | {"competicao_id": cid} for r in cls])

        mk = parse_marcadores(self.get(f"/Marcadores/{cid}"))
        self.db.upsert("clubes", [{"id": m["clube_id"], "nome": base_clube(m["clube_nome"]), "logo_url": m["clube_logo"]} for m in mk if m["clube_id"]], "id")
        self.db.upsert("jogadores", [{"id": m["jogador_id"], "nome": m["nome"], "foto_url": m["foto_url"]} for m in mk], "id")
        if mk:
            self.db.delete("marcadores", f"competicao_id=eq.{cid}")
            vistos = set()
            self.db.upsert("marcadores", [{"competicao_id": cid, "jogador_id": m["jogador_id"], "pos": m["pos"], "nome": m["nome"],
                                          "clube_id": m["clube_id"], "golos": m["golos"]} for m in mk
                                         if not (m["jogador_id"] in vistos or vistos.add(m["jogador_id"]))])
        self.db.upsert("competicoes", [{"id": cid, "atualizado_em": datetime.now(timezone.utc).isoformat()}], "id")
        return jogos

    # ---------- detalhes de um jogo ----------
    def jogo(self, j):
        h = self.get(f"/jogo/{j['id']}")
        info = parse_jogo(h)
        upd = {"id": j["id"], "arbitros": info["arbitros"], "detalhes_em": datetime.now(timezone.utc).isoformat()}

        for eid, clube_id, logo, nome in info["logos"]:
            if clube_id:
                self.db.upsert("clubes", [{"id": clube_id, "nome": base_clube(nome), "logo_url": logo}], "id")
                self.db.upsert("equipas", [{"id": eid, "nome": nome, "clube_id": clube_id}], "id")

        for lado, equipa_id in zip(("casa", "fora"), (j["casa_id"], j["fora_id"])):
            idx = 0 if lado == "casa" else 1
            if idx >= len(info["equipas"]):
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
    def correr(self, modo):
        comps = self.db.select("competicoes", "select=id,nome&ativa=eq.true&order=ordem,id")
        if modo == "completo" or not comps:
            self.tentar("descoberta", self.descobrir)
            comps = self.db.select("competicoes", "select=id,nome&ativa=eq.true&order=ordem,id")

        todos = []
        for c in comps:
            r = self.tentar(f"competição {c['id']} ({c['nome']})", self.competicao, c["id"])
            if r:
                todos += r

        # detalhes: jogos dos últimos 3 dias (resultados podem ser corrigidos) + todos os que ainda não têm detalhes
        desde = (self.hoje - timedelta(days=3)).isoformat()
        recentes = [j for j in todos if j["data"] and desde <= j["data"] <= self.hoje.isoformat() and j["golos_casa"] is not None]
        limite = 2000 if modo == "completo" else MAX_BACKFILL
        sem = self.db.select("jogos", f"select=id,casa_id,fora_id&golos_casa=not.is.null&detalhes_em=is.null&order=data.desc&limit={limite}")
        ids = {j["id"] for j in recentes}
        fila = recentes + [x for x in sem if x["id"] not in ids]
        print(f"Detalhes de {len(fila)} jogos")
        for j in fila:
            self.tentar(f"jogo {j['id']}", self.jogo, j)

        if modo == "completo":
            eqs = self.db.select("equipas", "select=id,competicao_id&competicao_id=not.is.null")
            ativos = {c["id"] for c in comps}
            for e in eqs:
                if e["competicao_id"] in ativos:
                    self.tentar(f"equipa {e['id']}", self.equipa, e["competicao_id"], e["id"])

        self.db.upsert("definicoes", [{"chave": "ultima_atualizacao", "valor": {
            "quando": datetime.now(timezone.utc).isoformat(), "modo": modo, "pedidos": self.pedidos,
            "competicoes": len(comps), "erros": self.erros[-20:]}}], "chave")
        print(f"Feito ({modo}): {self.pedidos} pedidos ao hp.fpp.pt, {len(self.erros)} erros")
        return len(self.erros) == 0 or self.pedidos > 0

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
    modo = (sys.argv[1] if len(sys.argv) > 1 else "rapido").lower()
    ok = Robo(DB(url, key)).correr("completo" if modo.startswith("comp") else "rapido")
    sys.exit(0 if ok else 1)
