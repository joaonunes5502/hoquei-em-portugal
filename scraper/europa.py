"""
Robô das competições europeias (World Skate Europe).

O site https://www.wse.sidgad.com não tem páginas "simples": é uma aplicação que só mostra os dados
depois de carregar num navegador. Por isso este robô abre o site num navegador automático (Chromium),
tal como um visitante, e lê o que aparece no ecrã: o calendário/resultados e a classificação.

  python scraper/europa.py            -> lê as 5 competições e guarda no Supabase
  python scraper/europa.py --ver      -> lê e mostra um resumo, sem guardar nada (para testar)

Variáveis: SUPABASE_URL, SUPABASE_SERVICE_KEY (as mesmas do robô nacional).
"""
import os
import re
import sys
import time
import zlib
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scrape import DB, EUROPA, FINAL_APOS, TZ_PT, _norm, chave_nome, hora_jogo  # noqa: E402

SITE = os.environ.get("WSE_SITE", "https://www.wse.sidgad.com")
# (id no nosso site, expressão que reconhece o título no site da WSE)
COMPETICOES = [
    (900001, r"^wse champions league( men)?$"),
    (900002, r"^wse champions league women$"),
    (900003, r"^wse cup( men)?$"),
    (900004, r"^wse cup women$"),
    (900005, r"^wse trophy$"),
]
MAX_FICHAS = 12      # fichas de jogo lidas por competição em cada execução (as restantes ficam para a seguinte)
EQUIPA = 5_000_000   # ids das equipas europeias: 5 000 000 + id da equipa no site da WSE
CLUBE = 6_000_000    # clubes estrangeiros: 6 000 000 + n.º do emblema no site da WSE
# As horas do site da WSE são as do país onde se joga. Convertemos para a hora de Portugal continental.
# Espanha, Itália, França, Alemanha, Suíça e Áustria têm todas a mesma hora (Portugal + 1).
FUSO_FORA = ZoneInfo("Europe/Madrid")
FUSO_ACORES = ZoneInfo("Atlantic/Azores")
FUSO_UK = ZoneInfo("Europe/London")
ACORES = ("candelaria",)   # clubes portugueses dos Açores (1 hora a menos que o continente)
REINO_UNIDO = ("london", "kings lynn", "king's lynn", "herne bay", "grimsby", "middlesbrough", "manchester", "soham", "ely ", "peterborough", "letchworth", "sheffield", "cottenham", "halifax")
ALCUNHAS = {"juventudepacense": "jpacense", "hockeyclubliceo": "hcliceo"}
MAIUSCULAS = {"FC", "SL", "HC", "CP", "UD", "OC", "AD", "RC", "RSC", "CE", "PAS", "SCRA", "SC", "CD", "CH", "HCP", "ASD", "RHC", "SAD", "UP", "SCT", "AA", "GD", "CA", "US", "RESG", "TSG", "ERG", "IGR", "SKG", "RSV", "CGC", "GSH", "HRC"}


# ---------------- leitura do HTML (testável sem navegador) ----------------
def txt(el):
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)) if el else ""


def nome_bonito(n):
    """IGUALADA RIGAT HC -> Igualada Rigat HC"""
    out = []
    for w in re.sub(r"\s+", " ", n or "").strip().split(" "):
        out.append(w if w.upper() in MAIUSCULAS or any(c.isdigit() for c in w) else w.capitalize() if len(w) > 2 or not out else w.lower())
    return " ".join(out)


def ronda_pt(nome):
    """Nome da ronda em português + ordem (as eliminatórias ficam depois das jornadas, da maior para a final)."""
    t = _norm(nome).strip()
    m = re.match(r"^(round|jornada|matchday|day)\s*(\d+)$", t)
    if m:
        return f"{int(m.group(2))}ª Jornada", int(m.group(2))
    m = re.search(r"round of (\d+)", t)
    if m:
        n = int(m.group(1)) // 2
        return ({8: "Oitavos de Final", 16: "1/16 de Final", 32: "1/32 de Final"}.get(n, f"1/{n} de Final"), 100 - n)
    if "eighth" in t or "octavos" in t or "oitavos" in t:
        return "Oitavos de Final", 92
    if "quarter" in t or "cuartos" in t or "quartos" in t:
        return "Quartos de Final", 96
    if "semi" in t:
        return "Meias-Finais", 98
    if "3rd" in t or "third" in t:
        return "3.º e 4.º lugar", 99
    if re.fullmatch(r"finals?", t):
        return "Final", 100
    if "preliminary" in t or "qualif" in t:
        return "Pré-Eliminatória", 50
    return nome_bonito(nome), 60


def _id_equipa(a):
    m = re.search(r"equipo=(\d+)", a.get("href", "")) if a else None
    return int(m.group(1)) if m else None


def _emblema(td):
    img = td.find("img") if td else None
    src = (img.get("src") or "").replace("images//", "images/") if img else ""
    m = re.search(r"logos_clubes/(\d+)", src)
    return (int(m.group(1)) if m else None), (src or None)


def ler_calendario(html):
    """Jogos: dict(ronda, ordem, data, hora, casa/fora: (id, nome, n.º emblema, logo), gc, gf, tv)."""
    jogos, ronda = [], ("", 0)
    for tr in BeautifulSoup(html, "lxml").select("table.sidgad-calendario-table tr"):
        cls = tr.get("class") or []
        if "sidgad-calendario-jornada" in cls:
            ronda = ronda_pt(txt(tr))
            continue
        if "sidgad-calendario-partido" not in cls:
            continue
        lados = []
        for lado in ("home", "away"):
            a = tr.select_one(f".sidgad-col-equipo-{lado} a")
            num, logo = _emblema(tr.select_one(f".sidgad-col-logo-{lado}"))
            lados.append({"id": _id_equipa(a), "nome": txt(a), "emblema": num, "logo": logo})
        if not all(x["id"] and x["nome"] for x in lados):
            continue  # linha ainda sem equipas (ronda por sortear)
        d = re.search(r"(\d{2})/(\d{2})/(\d{4})", txt(tr.select_one(".sidgad-col-dia")))
        h = re.search(r"(\d{1,2}:\d{2})", txt(tr.select_one(".sidgad-col-hora")))
        r = re.search(r"(\d+)\s*[:\-]\s*(\d+)", txt(tr.select_one(".sidgad-col-resultado")))
        f = tr.select_one("[data-match-id]")
        v = tr.select_one("[data-video-url]")
        tv = None
        if v and v.get("data-video-url"):
            tv = v["data-video-url"] if v["data-video-url"].startswith("http") else "https://youtu.be/" + v["data-video-url"]
        jogos.append({"ronda": ronda[0], "ordem": ronda[1], "data": f"{d.group(3)}-{d.group(2)}-{d.group(1)}" if d else None,
                      "hora": h.group(1) if h else None, "casa": lados[0], "fora": lados[1],
                      "gc": int(r.group(1)) if r else None, "gf": int(r.group(2)) if r else None, "tv": tv,
                      "partido": int(f["data-match-id"]) if f and (f.get("data-match-id") or "").isdigit() else None})
    return jogos


COLUNAS = {"points": "pts", "games played": "j", "games won": "v", "games drawn": "e", "games lost": "d",
           "goals for": "gm", "goals against": "gs", "goal difference": "dg"}


def ler_classificacao(html):
    """Linhas da 1.ª tabela (classificação geral): dict(equipa, nome, pos, pts, j, v, e, d, gm, gs, dg)."""
    tab = BeautifulSoup(html, "lxml").select_one("table.sidgad-clasif-tabla")
    if not tab:
        return []
    cols = [COLUNAS.get((th.get("title") or "").strip().lower()) for th in tab.select("thead th")][1:]
    if not all(cols) or len(cols) < 8:  # site noutra língua: as colunas vêm sempre por esta ordem
        cols = ["pts", "j", "v", "e", "d", "gm", "gs", "dg"]
    out = []
    for tr in tab.select("tr[data-team-id]"):
        nome = txt(tr.select_one(".sidgad-clasif-nombre"))
        tds = tr.find_all("td")
        if not nome or len(tds) < 3:
            continue
        linha = {"equipa": int(tr["data-team-id"]), "nome": nome, "pos": int(txt(tds[0]) or 0) or len(out) + 1}
        for k, td in zip(cols, tds[2:]):
            if k:
                try:
                    linha[k] = int(txt(td))
                except ValueError:
                    linha[k] = 0
        num, logo = _emblema(tr.select_one(".sidgad-clasif-equipo"))
        linha.update(emblema=num, logo=logo)
        out.append(linha)
    return out


PARTICULAS = {"da", "de", "do", "das", "dos", "del", "di", "la", "le", "van", "von", "e", "y", "i"}


def nome_pessoa(n):
    """'SOUSA PINTO, TELMO' -> 'Telmo Sousa Pinto'"""
    n = re.sub(r"\s+", " ", n or "").strip().strip(",")
    if "," in n:
        apelido, proprio = n.split(",", 1)
        n = f"{proprio.strip()} {apelido.strip()}"
    out = []
    for w in n.split(" "):
        out.append(w.lower() if w.lower() in PARTICULAS and out else "-".join(p.capitalize() for p in w.split("-")))
    return " ".join(out)


FUNCOES = {"E1": "Treinador", "E2": "Treinador adjunto", "D": "Delegado", "A": "Equipa técnica"}


def _numero(t):
    m = re.search(r"\d+", t or "")
    return int(m.group()) if m else None


def ler_ficha(html):
    """Ficha de um jogo: dict(arbitros, faltas_casa, faltas_fora, eventos, ficha={casa, fora})."""
    s = BeautifulSoup(html, "lxml")
    out = {"arbitros": ", ".join(nome_pessoa(txt(p)) for p in s.select("#sidgad-modal-refs p") if txt(p)) or None,
           "faltas_casa": _numero(txt(s.select_one("#sidgad-hp-home-faults"))), "faltas_fora": _numero(txt(s.select_one("#sidgad-hp-away-faults"))),
           "pavilhao": nome_bonito(txt(s.select_one("#sidgad-modal-venue"))) or None, "eventos": [], "ficha": {}}
    logo = lambda sel: ((s.select_one(sel) or {}).get("src") or "").split("/")[-1]
    logo_casa, logo_fora = logo("#sidgad-modal-home-logo"), logo("#sidgad-modal-away-logo")
    nome_casa = _norm(txt(s.select_one("#sidgad-modal-home-name")))

    # plantéis (só nomes) e equipa técnica
    for lado, tab in zip(("casa", "fora"), s.select("table.sidgad-roster-table")):
        jog, tec = [], []
        for tr in tab.select("tr"):
            tds = tr.find_all("td")
            if tr.select_one(".sidgad-tecnico-name"):
                cod = txt(tr.select_one(".sidgad-captain-badge")).upper()
                tec.append({"funcao": FUNCOES.get(cod, "Equipa técnica"), "nome": nome_pessoa(txt(tr.select_one(".sidgad-tecnico-name")))})
            elif len(tds) >= 4 and tr.select_one(".sidgad-player-last"):
                nome = nome_pessoa(txt(tr.select_one(".sidgad-player-first")) + " " + txt(tr.select_one(".sidgad-player-last")))
                j = {"n": _numero(txt(tds[0])), "nome": nome}
                if txt(tds[1]).upper() == "P":
                    j["gr"] = True
                jog.append(j)
        tec.sort(key=lambda t: list(FUNCOES.values()).index(t["funcao"]))
        out["ficha"][lado] = {"jogadores": jog, "tecnicos": tec}

    # acontecimentos (o site lista do mais recente para o mais antigo)
    brutos = []
    for row in s.select("#sidgad-incidents-list .sidgad-mob-incident-row"):
        icones = " ".join(c for i in row.select(".sidgad-mob-col-icon *") for c in (i.get("class") or []))
        titulo = _norm(txt(row.select_one(".sidgad-mob-title-goal")))
        resultado = _norm(txt(row.select_one(".sidgad-mob-result")))
        per = _numero(txt(row.select_one(".sidgad-mob-period"))) or 1
        img = row.select_one(".sidgad-mob-team-logo")
        lg = (img.get("src") or "").split("/")[-1] if img else ""
        lado = "casa" if lg and lg == logo_casa else "fora" if lg and lg == logo_fora else ("casa" if nome_casa and nome_casa in titulo else "fora")
        a = row.select_one(".sidgad-mob-player a")
        if "icon-timeout" in icones:
            tipo = "desconto"
        elif "blue-card" in icones or "blue card" in titulo:
            tipo = "azul"
        elif "yellow" in icones or "yellow card" in titulo:
            tipo = "amarelo"
        elif "red-card" in icones or "red card" in titulo:
            tipo = "vermelho"
        elif "penalty-shoot" in icones:
            tipo = "remate_penalti"
        elif "direct-fault" in icones and row.select_one(".sidgad-mob-shooter, .sidgad-mob-result"):
            tipo = "remate_livre"
        elif "icon-fault" in icones:
            tipo = "falta"
        elif row.select_one(".sidgad-bola") or titulo.startswith("goal") or titulo.startswith("gol"):
            tipo = "golo"
        else:
            continue
        brutos.append({"per": per, "tempo": txt(row.select_one(".sidgad-mob-clock")), "tipo": tipo, "lado": lado,
                       "jogador": nome_pessoa(txt(a)) if a else None, "golo": resultado in ("goal", "gol", "golo", "but", "rete")})
    brutos.reverse()
    # um penálti/livre direto convertido aparece 2x (o remate e o golo): fica só o golo, com o tipo certo
    for r in [b for b in brutos if b["tipo"].startswith("remate_")]:
        especie = "penalti" if r["tipo"] == "remate_penalti" else "livre"
        g = next((b for b in brutos if b["tipo"] == "golo" and (b["per"], b["tempo"], b["lado"]) == (r["per"], r["tempo"], r["lado"])), None) if r["golo"] else None
        if g:
            g["tipo"] = "golo_" + especie
            g["jogador"] = g["jogador"] or r["jogador"]
            r["tipo"] = None
        else:
            r["tipo"] = ("golo_" if r["golo"] else "") + especie + ("" if r["golo"] else "_falhado")
    partes = {1: "1ª Parte", 2: "2ª Parte", 3: "1º Prolongamento", 4: "2º Prolongamento"}
    for b in brutos:
        if b["tipo"]:
            out["eventos"].append({"ordem": len(out["eventos"]), "parte": partes.get(b["per"], "Prolongamento"), "tempo": b["tempo"],
                                   "tipo": b["tipo"], "lado": b["lado"], "jogador": b["jogador"], "jogador_id": None})
    return out


def id_jogo(indice, ordem, casa, fora):
    """Id estável (igual antes e depois do jogo): competição + ronda + as duas equipas."""
    return EUROPA + indice * 50_000_000 + zlib.crc32(f"{ordem}|{casa}|{fora}".encode()) % 50_000_000


# ---------------- navegador ----------------
class Navegador:
    def __init__(self):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        self.b = self._pw.chromium.launch()
        self.p = self.b.new_page(locale="en-GB", viewport={"width": 1366, "height": 900})
        self.p.set_default_timeout(30000)

    def fechar(self):
        self.b.close()
        self._pw.stop()

    def ligas(self):
        """{id no nosso site: id da liga no site da WSE}, pelos cartões da época atual na página inicial."""
        self.p.goto(SITE + "/", wait_until="domcontentloaded")
        self.p.wait_for_selector("button.sidgad-liga-card", state="attached")
        self.p.wait_for_timeout(1500)
        cartoes = self.p.eval_on_selector_all(
            "button.sidgad-liga-card:not(.sidgad-oculto)",
            "els => els.map((b, i) => ({i, titulo: (b.querySelector('.sidgad-liga-titulo') || b).textContent.trim(), logo: (b.querySelector('img.sidgad-liga-logo') || {}).src || ''}))")
        out = {}
        for nosso, exp in COMPETICOES:
            c = next((x for x in cartoes if re.match(exp, _norm(x["titulo"]).strip())), None)
            if not c:
                print(f"  não encontrei o cartão de {exp}")
                continue
            liga = None
            try:  # carregar no cartão, como um visitante, e ver para que competição o site vai
                self.p.locator("button.sidgad-liga-card:not(.sidgad-oculto)").nth(c["i"]).click()
                self.p.wait_for_function("() => /[?&]liga=\\d+/.test(location.search)", timeout=10000)
                liga = int(re.search(r"[?&]liga=(\d+)", self.p.url).group(1))
                self.p.go_back()
                self.p.wait_for_selector("button.sidgad-liga-card:not(.sidgad-oculto)")
            except Exception as e:  # plano B: o n.º do logótipo da competição costuma ser o id da liga
                m = re.search(r"logos_competiciones/(\d+)", c["logo"])
                liga = int(m.group(1)) if m else None
                print(f"  {c['titulo']}: usei o plano B ({type(e).__name__})")
                self.p.goto(SITE + "/", wait_until="domcontentloaded")
                self.p.wait_for_selector("button.sidgad-liga-card", state="attached")
            if liga:
                out[nosso] = liga
        return out

    def vista(self, liga, vista, seletor):
        """HTML da página depois de os dados aparecerem (ou do aviso de 'ainda não há dados')."""
        self.p.goto(f"{SITE}/?liga={liga}&vista={vista}", wait_until="domcontentloaded")
        try:
            self.p.wait_for_selector(f"#sidgad-liga-main-content {seletor}, #sidgad-liga-main-content .sidgad-empty-state", timeout=25000)
        except Exception:
            print(f"  liga {liga}/{vista}: a página não mostrou dados a tempo")
            return ""
        self.p.wait_for_timeout(600)
        return self.p.inner_html("#sidgad-liga-main-content")


    def ficha(self, liga, partido):
        """HTML da ficha de um jogo (a mesma página que um visitante abre ao carregar na lupa)."""
        self.p.goto(f"{SITE}/?liga={liga}&partido={partido}", wait_until="domcontentloaded")
        try:
            self.p.wait_for_selector("#sidgad-incidents-list .sidgad-mob-incident-row, table.sidgad-roster-table .sidgad-player-last", state="attached", timeout=25000)
        except Exception:
            print(f"  jogo {partido}: a ficha não apareceu a tempo")
            return ""
        self.p.wait_for_timeout(900)
        return self.p.inner_html(".sidgad-match-modal")


# ---------------- guardar ----------------
class Europa:
    def __init__(self, db):
        self.db = db
        self._clubes = None

    def clube_pt(self, nome):
        """Clube português já conhecido do site (pelo nome), para o Sporting da Champions ser o Sporting do Placard."""
        if self._clubes is None:
            self._clubes = []
            for c in self.db.select("clubes", f"select=id,nome,nome_curto&id=lt.{CLUBE}"):
                for n in (c.get("nome"), c.get("nome_curto")):
                    k = chave_nome(n or "")
                    if len(k) >= 3:
                        self._clubes.append((k, c))
        k = chave_nome(nome)
        k = ALCUNHAS.get(k, next((v for a, v in ALCUNHAS.items() if k.startswith(a)), k))
        for ck, c in self._clubes:
            if ck == k:
                return c
        for ck, c in self._clubes:  # "UD Oliveirense Simoldes" = "UD Oliveirense"
            if min(len(ck), len(k)) >= 7 and (k.startswith(ck) or ck.startswith(k)):
                return c
        return None

    def fuso(self, nome_casa):
        """Fuso horário do pavilhão = país da equipa da casa."""
        t = _norm(nome_casa) + " "
        if self.clube_pt(nome_casa):
            return FUSO_ACORES if any(a in t for a in ACORES) else TZ_PT
        return FUSO_UK if any(a in t for a in REINO_UNIDO) else FUSO_FORA

    def hora_pt(self, data, hora, nome_casa):
        """(data, hora) do site da WSE -> (data, hora) em Portugal continental."""
        if not data or not hora:
            return data, hora
        try:
            h, m = (int(x) for x in hora.split(":"))
            local = datetime.fromisoformat(data).replace(hour=h, minute=m, tzinfo=self.fuso(nome_casa)).astimezone(TZ_PT)
            return local.date().isoformat(), local.strftime("%H:%M")
        except ValueError:
            return data, hora

    def equipas(self, cid, lista):
        """lista: dicts(id, nome, emblema, logo). Cria/atualiza clubes estrangeiros e equipas."""
        clubes, equipas = {}, {}
        for e in lista:
            pt = self.clube_pt(e["nome"])
            if pt:
                clube_id, nome = pt["id"], pt["nome"]
            elif e.get("emblema"):
                clube_id, nome = CLUBE + e["emblema"], nome_bonito(e["nome"])
                clubes.setdefault(clube_id, {"id": clube_id, "nome": nome, "logo_url": e.get("logo")})
            else:
                clube_id, nome = None, nome_bonito(e["nome"])
            equipas[EQUIPA + e["id"]] = {"id": EQUIPA + e["id"], "competicao_id": cid, "clube_id": clube_id, "nome": nome}
        self.db.upsert("clubes", list(clubes.values()), "id")
        self.db.upsert("equipas", list(equipas.values()), "id")

    def guardar(self, indice, cid, jogos, tabela):
        vistos = {}
        for j in jogos:
            vistos[j["casa"]["id"]] = j["casa"]
            vistos[j["fora"]["id"]] = j["fora"]
        for r in tabela:
            vistos.setdefault(r["equipa"], {"id": r["equipa"], "nome": r["nome"], "emblema": r.get("emblema"), "logo": r.get("logo")})
        self.equipas(cid, list(vistos.values()))

        agora, hoje = datetime.now(TZ_PT), datetime.now(TZ_PT).date().isoformat()
        linhas = {}
        for j in jogos:
            j["data"], j["hora"] = self.hora_pt(j["data"], j["hora"], j["casa"]["nome"])
            row = {"id": id_jogo(indice, j["ordem"], j["casa"]["id"], j["fora"]["id"]), "competicao_id": cid, "jornada": j["ordem"],
                   "jornada_nome": j["ronda"], "numero": None, "data": j["data"], "hora": j["hora"],
                   "casa_id": EQUIPA + j["casa"]["id"], "fora_id": EQUIPA + j["fora"]["id"], "casa_nome": nome_bonito(j["casa"]["nome"]),
                   "fora_nome": nome_bonito(j["fora"]["nome"]), "golos_casa": j["gc"], "golos_fora": j["gf"], "tv_url": j["tv"]}
            if j["gc"] is None:
                row["estado"] = "agendado"
            else:
                k = hora_jogo(row)
                acabou = (k is not None and agora - k >= timedelta(minutes=FINAL_APOS)) or (k is None and (j["data"] or "") < hoje)
                row["estado"] = "final" if acabou else "provisorio"
            linhas[row["id"]] = row
        antes = {x["id"]: x for x in self.db.select("jogos", f"select=id,detalhes_em&competicao_id=eq.{cid}")} if linhas else {}
        if linhas:
            self.db.upsert("jogos", list(linhas.values()), "id")
            antigos = [x["id"] for x in self.db.select("jogos", f"select=id&competicao_id=eq.{cid}") if x["id"] not in linhas]
            if antigos:  # jogos que saíram do calendário (ex.: sorteio alterado)
                self.db.delete("jogos", f"id=in.({','.join(map(str, antigos))})")
        if tabela:
            self.db.delete("classificacao", f"competicao_id=eq.{cid}")
            self.db.upsert("classificacao", [{"competicao_id": cid, "equipa_id": EQUIPA + r["equipa"], "pos": r["pos"],
                                              **{k: r.get(k, 0) for k in ("pts", "j", "v", "e", "d", "gm", "gs", "dg")}} for r in tabela])
        self.db.upsert("competicoes", [{"id": cid, "atualizado_em": datetime.now(timezone.utc).isoformat()}], "id")
        # fichas a ler: jogos com resultado que ainda não têm ficha, ou dos últimos 2 dias (podem ser corrigidos / estar a decorrer)
        recente = (datetime.now(TZ_PT).date() - timedelta(days=2)).isoformat()
        fila = []
        for j in jogos:
            jid = id_jogo(indice, j["ordem"], j["casa"]["id"], j["fora"]["id"])
            if j["gc"] is not None and j.get("partido") and (not (antes.get(jid) or {}).get("detalhes_em") or (j["data"] or "") >= recente):
                fila.append((jid, j["partido"], j["data"] or ""))
        return [(a, b) for a, b, _ in sorted(fila, key=lambda x: x[2], reverse=True)]

    def guardar_ficha(self, jid, f):
        self.db.delete("eventos", f"jogo_id=eq.{jid}")
        self.db.upsert("eventos", [{"jogo_id": jid, **e} for e in f["eventos"]])
        self.db.upsert("jogos", [{"id": jid, "arbitros": f["arbitros"], "faltas_casa": f["faltas_casa"], "faltas_fora": f["faltas_fora"],
                                  "ficha": {**f["ficha"], "pavilhao": f["pavilhao"]}, "detalhes_em": datetime.now(timezone.utc).isoformat()}], "id")


def correr(db, nav, so_ver=False):
    ativas = None if so_ver else {c["id"] for c in db.select("competicoes", "select=id&ativa=eq.true&id=gte.900000")}
    ligas = nav.ligas()
    print(f"Competições encontradas no site da WSE: {ligas}")
    eu, erros, feitas, fichas = (None if so_ver else Europa(db)), 0, 0, 0
    for indice, (cid, _) in enumerate(COMPETICOES):
        if cid not in ligas or (ativas is not None and cid not in ativas):
            continue
        try:
            jogos = ler_calendario(nav.vista(ligas[cid], "calendar", "table.sidgad-calendario-table"))
            tabela = ler_classificacao(nav.vista(ligas[cid], "clasificaciones", "table.sidgad-clasif-tabla"))
            print(f"  {cid}: {len(jogos)} jogos ({sum(1 for j in jogos if j['gc'] is not None)} com resultado), {len(tabela)} equipas na classificação")
            if so_ver:
                for j in jogos[:4]:
                    print("     ", j["ronda"], j["data"], j["hora"], j["casa"]["nome"], j["gc"], "-", j["gf"], j["fora"]["nome"])
            else:
                fila = eu.guardar(indice, cid, jogos, tabela)
                for jid, partido in fila[:MAX_FICHAS]:
                    f = ler_ficha(nav.ficha(ligas[cid], partido))
                    if f["eventos"] or f["ficha"].get("casa", {}).get("jogadores"):
                        eu.guardar_ficha(jid, f)
                        fichas += 1
                    time.sleep(1)
            feitas += 1
        except Exception as e:  # uma competição com problemas não pára as outras
            erros += 1
            print(f"  ERRO em {cid}: {type(e).__name__}: {e}")
        time.sleep(1)
    print(f"Feito: {feitas} competições, {fichas} fichas de jogo, {erros} erros")
    return feitas > 0 or not ligas


if __name__ == "__main__":
    ver = "--ver" in sys.argv
    url, key = os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not ver and not (url and key):
        sys.exit("Faltam os segredos SUPABASE_URL e SUPABASE_SERVICE_KEY")
    nav = Navegador()
    try:
        ok = correr(None if ver else DB(url, key), nav, ver)
    finally:
        nav.fechar()
    sys.exit(0 if ok else 1)
