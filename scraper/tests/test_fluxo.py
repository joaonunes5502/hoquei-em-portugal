import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scrape
from test_parsers import CAL, CLS, MK, EQ, JOGO, TL, ST, HOME, GRP
from datetime import date

class FakeDB:
    def __init__(s): s.t = {}
    def upsert(s, table, rows, on_conflict=None):
        keys = (on_conflict or "id").split(",")
        d = s.t.setdefault(table, {})
        for r in rows:
            k = tuple(r.get(x) for x in keys) if all(x in r for x in keys) else id(r)
            d.setdefault(k, {}).update(r)
    def delete(s, table, q):
        col, val = q.split("=eq.")
        s.t[table] = {k: v for k, v in s.t.get(table, {}).items() if str(v.get(col)) != val}
    def select(s, table, q):
        rows = list(s.t.get(table, {}).values())
        if table == "competicoes": return [r for r in rows if r.get("ativa", True)]
        if table == "jogos": return [r for r in rows if r.get("golos_casa") is not None and not r.get("detalhes_em")]
        if table == "equipas": return [r for r in rows if r.get("competicao_id")]
        return rows

PAGES = {"/": HOME, "/136/19": GRP, "/136/4": "", "/Competicao/494": CAL, "/Competicao/495": CAL,
         "/Classificacao/494": CLS, "/Classificacao/495": CLS, "/Marcadores/494": MK, "/Marcadores/495": MK, "/jogo/18727": JOGO}
def fake_get(self, path, params=None):
    self.pedidos += 1
    if path.startswith("/Views/ajax_jogo.php"): return TL
    if path.startswith("/Views/ajax_estatisticasJogo.php"): return ST
    if path.startswith("/Equipa/"): return EQ
    return PAGES[path]
scrape.Robo.get = fake_get
db = FakeDB()
r = scrape.Robo(db); r.hoje = date(2026, 11, 9)
assert r.correr("completo")
assert not r.erros, r.erros
assert set(k[0] for k in db.t["competicoes"]) == {494, 495}
j = db.t["jogos"][(18727,)]
assert j["estado"] == "final" and j["arbitros"].startswith("Carlos") and j["faltas_casa"] == 5 and j["detalhes_em"]
assert len([e for e in db.t["eventos"].values()]) == 5
assert db.t["jogadores"][(161550,)]["nome"] == "Joca Guimarães"
assert db.t["jogadores"][(161518,)]["numero"] == 1
assert db.t["plantel"][(1182, 161550)]["golos"] == 2
assert db.t["equipas"][(1182,)]["clube_id"] == 123 and db.t["equipas"][(1182,)]["golos_marcados"] == 5
assert db.t["definicoes"][("ultima_atualizacao",)]["valor"]["modo"] == "completo"
# segunda passagem rápida não duplica nada
n = len(db.t["eventos"]); r2 = scrape.Robo(db); r2.hoje = date(2026, 11, 9); r2.correr("rapido")
assert len(db.t["eventos"]) == n
print("FLUXO OK", r.pedidos, "pedidos")
