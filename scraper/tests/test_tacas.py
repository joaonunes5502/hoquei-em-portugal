"""Taças: jogos /jogoTaca/, equipas só com nome no calendário, descoberta das equipas."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scrape
from falsa import DB

L = lambda n, d, h, c, f, res, opc: f'''<tr><td class="coluna-data coluna-numero"><p class="data">{n}</p></td>
<td class="coluna-data"><p class="data"> {d} <br> {h} </p></td>
<td class="coluna-equipa"><p class="visitada">{c}</p></td><td class="coluna-resultado"><p class="resultado"> {res} </p></td>
<td class="coluna-equipa"><p class="visitante">{f}</p></td><td class="coluna-opcoes">{opc}</td></tr>'''
T = lambda t: f'<tr><td colspan="6"><h6 class="titulo-jornada">{t}</h6></td></tr>'

ELITE_F = '<table class="calendario-hp">' + T("1/2 Final") + \
    L(1564, "2026-10-31", "15:00", "SL Benfica", "Escola Livre A", "5 - 1", '<a href="/jogoTaca/100892">x</a>') + \
    L(1565, "2026-10-31", "12:00", "ACD Gulpilhares", "AD Sanjoanense/Delba", "0 - 5", '<a href="/jogoTaca/100893">x</a>') + \
    T("Final") + L(1566, "2026-11-01", "12:00", "SL Benfica", "AD Sanjoanense/Delba", "4 - 2", '<a href="/jogoTaca/100894">x</a>') + "</table>"
TACA_PT = '<table class="calendario-hp">' + T("Pré Eliminatória Norte") + \
    L(1543, "2026-11-29", "17:30", "CA Feira", "CENAP", "-", "") + T("Pré Eliminatória Sul") + \
    L(1550, "2026-11-28", "17:30", "ACR Santa Cita", "GD Estreito", "-", "") + "</table>"

jogos, eqs = scrape.parse_calendar(ELITE_F, 510)
assert len(jogos) == 3 and not eqs
assert jogos[0]["id"] == scrape.TACA + 100892 and jogos[0]["casa_id"] is None
assert jogos[1]["fora_nome"] == "AD Sanjoanense/Delba" and jogos[2]["jornada_nome"] == "Final" and jogos[2]["golos_casa"] == 4
j2, _ = scrape.parse_calendar(TACA_PT, 508)
assert [j["id"] for j in j2] == [scrape.id_provisorio(508, 1543), scrape.id_provisorio(508, 1550)]
assert [j["jornada_nome"] for j in j2] == ["Pré Eliminatória Norte", "Pré Eliminatória Sul"]
print("CALENDÁRIO DAS TAÇAS OK")

db = DB()
db.upsert("competicoes", [{"id": 493, "nome": "Campeonato Placard HP", "grupo": "Campeonato Placard"},
                          {"id": 502, "nome": "CN Feminino Norte", "grupo": "Campeonato Nacional Seniores Femininos"},
                          {"id": 510, "nome": "Elite Cup Feminina", "grupo": "Elite Cup"},
                          {"id": 508, "nome": "Taça de Portugal Masculina - Pré Eliminatória", "grupo": "Taça de Portugal Masculina"}], "id")
db.upsert("equipas", [{"id": 1181, "nome": "SL Benfica ", "competicao_id": 493},          # masculina
                      {"id": 2001, "nome": "SL Benfica", "competicao_id": 502},           # feminina
                      {"id": 2002, "nome": "AD Sanjoanense / Delba", "competicao_id": 502},
                      {"id": 3001, "nome": "CA Feira", "competicao_id": 493}], "id")
r = scrape.Robo(db)
pag = {"/Competicao/510": ELITE_F, "/Competicao/508": TACA_PT}
r.get = lambda path, params=None: pag[path]
out = {j["id"]: j for j in r.calendario(510)}
fin = out[scrape.TACA + 100894]
assert fin["casa_id"] == 2001, "Benfica da Elite Cup Feminina tem de ser a equipa feminina"
assert fin["fora_id"] == 2002, "AD Sanjoanense/Delba = AD Sanjoanense / Delba"
assert out[scrape.TACA + 100892]["fora_id"] is None and out[scrape.TACA + 100892]["fora_nome"] == "Escola Livre A"
assert db.t["equipas"][(2001,)]["competicao_id"] == 502, "a taça não pode mudar a competição da equipa"
t = {j["numero"]: j for j in r.calendario(508)}
assert t[1543]["casa_id"] == 3001 and t[1543]["fora_id"] is None
print("EQUIPAS PELO NOME OK")

# ficha do jogo da taça: vai a /jogoTaca/ e fica com as equipas exatas
FICHA = '''<div id="scoreboard"><a href="/Equipa/510/2001"><img src="/img/CLUBE_10.png"> SL Benfica</a>
<a href="/Equipa/510/2050"><img src="/img/CLUBE_77.png"> Escola Livre A</a><p>Árbitros: A, B</p></div>'''
pedidos = []
def g(path, params=None):
    pedidos.append(path)
    return FICHA if path.startswith("/jogoTaca/") else pag.get(path, "")
r.get = g
r.jogo(dict(out[scrape.TACA + 100892]))
assert pedidos[-1] == "/jogoTaca/100892", pedidos
row = db.t["jogos"][(scrape.TACA + 100892,)]
assert row["casa_id"] == 2001 and row["fora_id"] == 2050 and row["arbitros"] == "A, B"
# e a leitura seguinte do calendário não apaga o que a ficha descobriu
r.get = lambda path, params=None: pag[path]
r.calendario(510)
assert db.t["jogos"][(scrape.TACA + 100892,)]["fora_id"] == 2050
# a FPP ligou a equipa masculina na ficha de um jogo feminino (aconteceu na final da Elite Cup Feminina):
# o robô fica com a equipa feminina e não mistura os plantéis
FICHA2 = FICHA.replace("/Equipa/510/2001", "/Equipa/510/1181").replace("/Equipa/510/2050", "/Equipa/510/2002").replace("Escola Livre A", "AD Sanjoanense/Delba") + \
    '<div id="Equipas"><div class="team"><div class="player"><img src="/FED_900001.png"><p>N.º 13 - Aimee Blackman (5i)</p></div></div><div class="team"></div></div>'
r2 = scrape.Robo(db); r2.get = lambda path, params=None: FICHA2 if path.startswith("/jogoTaca/") else pag.get(path, "")
r2.jogo(dict(out[scrape.TACA + 100894]))
fin = db.t["jogos"][(scrape.TACA + 100894,)]
assert fin["casa_id"] == 2001 and fin["fora_id"] == 2002, fin
assert (2001, 900001) in db.t["plantel"] and (1181, 900001) not in db.t["plantel"], "a jogadora tem de ir para a equipa feminina"
# e um jogo já guardado com a equipa errada é corrigido na leitura seguinte do calendário
db.t["jogos"][(scrape.TACA + 100894,)]["casa_id"] = 1181
r3 = scrape.Robo(db); r3.get = lambda path, params=None: pag[path]; r3.calendario(510)
assert db.t["jogos"][(scrape.TACA + 100894,)]["casa_id"] == 2001
print("EQUIPA ERRADA NA FICHA OK")
print("FICHA DA TAÇA OK")
print("TODOS OS TESTES DAS TAÇAS PASSARAM")
