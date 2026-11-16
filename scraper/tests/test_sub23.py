"""O hp.fpp.pt usa o mesmo n.º de equipa para os seniores e os Sub-23 do clube: têm de ficar separados."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scrape
from falsa import DB

CAL = lambda c: f'''<table class="calendario-hp"><tr><td colspan="6"><h6 class="titulo-jornada">1ª Jornada</h6></td></tr>
<tr><td class="coluna-data coluna-numero"><p class="data">1</p></td><td class="coluna-data"><p class="data">2026-11-08 <br> 17:00</p></td>
<td class="coluna-equipa"><a href="/Equipa/{c}/1194"><p class="visitada">GDC Fânzeres</p></a></td><td class="coluna-resultado"><p class="resultado"> 3 - 1 </p></td>
<td class="coluna-equipa"><a href="/Equipa/{c}/1200"><p class="visitante">HC Marco</p></a></td><td class="coluna-opcoes"><a href="/jogo/{c}01">x</a></td></tr></table>'''
CLS = lambda c: f'''<table><tr><td class="classificacao">1</td><td class="clube"><a href="/Equipa/{c}/1194"><img src="/CLUBE_164.png"> GDC Fânzeres</a></td>
<td>3</td><td>1</td><td>1</td><td>0</td><td>0</td><td>3</td><td>1</td><td>2</td></tr></table>'''
FICHA = lambda c, nome: f'''<div id="scoreboard"><a href="/Equipa/{c}/1194"><img src="/CLUBE_164.png"> GDC Fânzeres</a><a href="/Equipa/{c}/1200"><img src="/CLUBE_165.png"> HC Marco</a></div>
<div id="Equipas"><div class="team"><div class="player"><img src="/FED_{c}1.png"><p>N.º 7 - {nome}</p></div></div><div class="team"></div></div>'''

db = DB()
db.upsert("competicoes", [{"id": 498, "nome": "CN 3ª Divisão Norte A", "grupo": "Campeonato Nacional 3ª Divisão", "ativa": True},
                          {"id": 505, "nome": "CN Sub 23 Norte", "grupo": "Campeonato Nacional Sub 23", "ativa": True}], "id")
assert scrape.id_equipa(1194, db.t["competicoes"][(505,)]) == 23001194 and scrape.id_equipa(1194, db.t["competicoes"][(498,)]) == 1194
assert scrape.id_fpp(23001194) == 1194 and scrape.id_fpp(1194) == 1194 and scrape.id_fpp(5001174) == 5001174

r = scrape.Robo(db); pedidos = []
def get(path, params=None):
    pedidos.append(path)
    c = int(path.rstrip("/").split("/")[2][:3]) if path.startswith(("/Competicao", "/Classificacao", "/jogo")) else 0
    if path.startswith("/Competicao"): return CAL(c)
    if path.startswith("/Classificacao"): return CLS(c)
    if path.startswith("/jogo/"): return FICHA(c, "Sénior Silva" if c == 498 else "Júnior Costa")
    return ""
r.get = get
for cid in (498, 505, 498):          # várias passagens, por qualquer ordem
    for j in r.calendario(cid):
        r.jogo(j)
    r.classificacao(cid)
E, J, P = db.t["equipas"], db.t["jogos"], db.t["plantel"]
assert E[(1194,)]["competicao_id"] == 498 and E[(23001194,)]["competicao_id"] == 505 and E[(23001194,)]["clube_id"] == 164
assert J[(49801,)]["casa_id"] == 1194 and J[(50501,)]["casa_id"] == 23001194 and J[(50501,)]["fora_id"] == 23001200
assert (1194, 4981) in P and (23001194, 5051) in P and (1194, 5051) not in P and (23001194, 4981) not in P, list(P)
C = {(x["competicao_id"], x["equipa_id"]) for x in db.t["classificacao"].values()}
assert C == {(498, 1194), (505, 23001194)}, C
assert scrape.chave_equipa(E[(23001194,)], db.t["competicoes"][(505,)]) == "164-S23" and scrape.chave_equipa(E[(1194,)], db.t["competicoes"][(498,)]) == "164"
# a página da equipa Sub-23 é pedida ao hp.fpp.pt com o n.º verdadeiro
r.equipa(505, 23001194)
assert pedidos[-1] == "/Equipa/505/1194", pedidos[-1]
print("SENIORES E SUB-23 SEPARADOS OK")
