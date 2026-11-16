"""Robô europeu: leitura do HTML e fluxo completo contra uma imitação local do site da WSE."""
import os, sys, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI)); sys.path.insert(0, AQUI)

class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(H, directory=os.path.join(AQUI, "wse")))
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["WSE_SITE"] = f"http://127.0.0.1:{srv.server_address[1]}"

import europa, scrape
from falsa import DB

assert europa.nome_bonito("IGUALADA RIGAT HC") == "Igualada Rigat HC" and europa.nome_bonito("UBROKER HOCKEY BASSANO 1954") == "Ubroker Hockey Bassano 1954"
assert europa.ronda_pt("Round 3") == ("3ª Jornada", 3) and europa.ronda_pt("ROUND OF 16") == ("Oitavos de Final", 92)
assert europa.ronda_pt("QUARTERSFINALS")[0] == "Quartos de Final" and europa.ronda_pt("Final") == ("Final", 100)
assert scrape.escalao({"nome": "WSE Champions League Women"}) == "F"
print("NOMES OK")

db = DB()
db.upsert("competicoes", [{"id": 900001 + i, "nome": n, "ativa": i != 4} for i, n in enumerate(["WSE Champions League", "WSE Champions League Women", "WSE Cup", "WSE Cup Women", "WSE Trophy"])], "id")
db.upsert("clubes", [{"id": 1329, "nome": "Sporting CP", "nome_curto": None}, {"id": 116, "nome": "FC Porto", "nome_curto": None}, {"id": 951, "nome": "OC Barcelos SAD", "nome_curto": None},
                     {"id": 123, "nome": "J. Pacense / Des Compagnons", "nome_curto": None}, {"id": 127, "nome": "UD Oliveirense / Simoldes", "nome_curto": None}, {"id": 1333, "nome": "SL Benfica", "nome_curto": None}], "id")
nav = europa.Navegador()
try:
    ligas = nav.ligas()
    assert ligas == {900001: 339, 900002: 342, 900003: 351, 900004: 352, 900005: 353}, ligas   # época atual, não a antiga (234)
    assert europa.correr(db, nav)
    # 2.ª passagem com resultado novo: o mesmo jogo é atualizado, não duplicado
    n1 = len(db.t["jogos"])
    assert europa.correr(db, nav) and len(db.t["jogos"]) == n1
finally:
    nav.fechar()
print("NAVEGADOR OK", ligas)

J = list(db.t["jogos"].values()); E = db.t["equipas"]; C = db.t["clubes"]
cl = [j for j in J if j["competicao_id"] == 900001]; cup = [j for j in J if j["competicao_id"] == 900003]
assert len(cl) == 4 and len(cup) == 4, (len(cl), len(cup))           # as linhas vazias dos quartos não entram
assert all(j["id"] >= scrape.EUROPA for j in J) and len({j["id"] for j in J}) == len(J)
dj = next(j for j in cl if j["casa_nome"] == "FC Porto")
ig = next(j for j in cl if j["casa_nome"] == "Igualada Rigat HC")
assert (ig["data"], ig["hora"]) == ("2026-11-25", "19:30"), ig          # 20:30 em Espanha = 19:30 em Portugal
eu = europa.Europa(db)
assert eu.hora_pt("2026-12-12", "00:30", "HOCKEY TRISSINO") == ("2026-12-11", "23:30")       # muda de dia
assert eu.hora_pt("2026-12-12", "17:00", "SPORTING CP") == ("2026-12-12", "17:00")           # em Portugal fica igual
assert eu.hora_pt("2026-12-12", "", "HC LICEO") == ("2026-12-12", "")
assert dj["data"] == "2026-11-26" and dj["hora"] == "20:00" and dj["jornada_nome"] == "1ª Jornada" and dj["estado"] == "agendado" and dj["golos_casa"] is None
assert E[(5001172,)]["clube_id"] == 116 and E[(5001174,)]["clube_id"] == 1329 and E[(5001181,)]["clube_id"] == 951   # clubes portugueses ligados aos do site
assert E[(5001301,)]["clube_id"] == 123 and E[(5001302,)]["clube_id"] == 127                                             # J. Pacense e Oliveirense (nomes diferentes)
assert E[(5001176,)]["clube_id"] == 6000092 and C[(6000092,)]["nome"] == "Igualada Rigat HC" and "images/logos_clubes/92_1.png" in C[(6000092,)]["logo_url"]
assert C[(1329,)]["nome"] == "Sporting CP" and "logo_url" not in C[(1329,)]                                              # não mexe nos clubes portugueses
ida = next(j for j in cup if j["casa_id"] == 5001301)
assert (ida["golos_casa"], ida["golos_fora"], ida["jornada_nome"], ida["jornada"]) == (3, 2, "Oitavos de Final", 92) and ida["tv_url"] == "https://youtu.be/aXZnmrEbvEI"
volta = next(j for j in cup if j["casa_id"] == 5001302)
vm = next(j for j in cup if j["casa_nome"].startswith("CP Voltreg"))
assert vm["hora"] == "19:00", vm                                          # 20:00 em Espanha
assert volta["id"] != ida["id"] and volta["jornada_nome"] == "Oitavos de Final"
t = sorted((r for r in db.t["classificacao"].values() if r["competicao_id"] == 900001), key=lambda r: r["pos"])
assert [(r["equipa_id"], r["pts"], r["gm"], r["dg"]) for r in t] == [(5001174, 3, 5, 3), (5001172, 1, 2, 0)], t     # linha sem nome fica de fora
assert not [j for j in J if j["competicao_id"] == 900005]                                                              # competição desligada no backoffice
# ficha do jogo com resultado (J. Pacense 3-2 Oliveirense)
assert ida["arbitros"] == "Joseph Silecchia, Francesco Stallone" and (ida["faltas_casa"], ida["faltas_fora"]) == (9, 10) and ida["detalhes_em"]
fc = ida["ficha"]
assert fc["casa"]["jogadores"][0] == {"n": 1, "nome": "Àlvaro Shehda", "gr": True} and fc["casa"]["jogadores"][1] == {"n": 74, "nome": "João Carlos Guimarães da Silva"}
assert fc["casa"]["tecnicos"] == [{"funcao": "Treinador", "nome": "Hugo Azevedo"}, {"funcao": "Delegado", "nome": "Tiago Sousa"}]
assert fc["fora"]["jogadores"][0]["nome"] == "Marc Grau-Tallada" and fc["fora"]["jogadores"][1]["nome"] == "Carlo di Benedetto" and fc["pavilhao"]
ev = sorted((e for e in db.t["eventos"].values() if e["jogo_id"] == ida["id"]), key=lambda e: e["ordem"])
resumo = [(e["parte"][0], e["tempo"], e["tipo"], e["lado"], (e["jogador"] or "").split(" ")[0]) for e in ev]
assert resumo == [("1", "23:24", "golo", "casa", "Alessandro"), ("1", "17:48", "golo", "casa", "João"), ("1", "07:19", "falta", "casa", ""), ("1", "04:10", "golo", "fora", "Marc"),
                  ("2", "22:50", "golo_penalti", "fora", "Carlo"), ("2", "16:31", "azul", "fora", "Carlo"), ("2", "05:44", "golo", "casa", "João"), ("2", "05:44", "desconto", "fora", ""),
                  ("2", "00:15", "falta", "fora", ""), ("2", "00:15", "livre_falhado", "casa", "Alessandro")], resumo
assert len(db.t["eventos"]) == len(ev)        # a 2.ª passagem substituiu, não duplicou; jogos sem resultado não têm ficha
assert "ficha" not in volta
print("FICHA OK")
print("DADOS OK")

# o robô nacional ignora as competições e os jogos europeus
r = scrape.Robo(db); pedidos = []
r.get = lambda path, params=None: pedidos.append(path) or ""
assert all(c["id"] < 900000 for c in r.ativas())
r.jogo(dict(ida)); assert not pedidos
print("TODOS OS TESTES EUROPEUS PASSARAM")
