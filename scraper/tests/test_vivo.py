"""Jogos futuros sem ficha (id provisório), troca pelo id verdadeiro e modo ao vivo."""
import sys, os
from datetime import datetime, timedelta
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scrape

LINHA = lambda n, d, h, c, f, res, opc: f'''<tr><td class="coluna-data coluna-numero"><p class="data">{n}</p></td>
<td class="coluna-data"><p class="data"> {d} <br> {h} </p></td>
<td class="coluna-equipa"><a href="/Equipa/493/{c}"><p class="visitada">Equipa {c}</p></a></td>
<td class="coluna-resultado"><p class="resultado"> {res} </p></td>
<td class="coluna-equipa"><a href="/Equipa/493/{f}"><p class="visitante">Equipa {f}</p></a></td>
<td class="coluna-opcoes">{opc}</td></tr>'''
TIT = lambda t: f'<tr><td colspan="6"><h6 class="titulo-jornada">{t}</h6></td></tr>'

CAL1 = '<table class="calendario-hp">' + TIT("2ª Jornada") + \
    LINHA(10, "2026-11-14", "21:30", 1184, 1190, "1 - 4", '<a href="/jogo/18734">x</a><a href="https://tv.fpp.pt/video?videoId=e-1">tv</a>') + \
    LINHA(15, "2026-11-18", "21:00", 1189, 1172, "-", '<a href="/jogo/18739">x</a><a href="https://tv.fpp.pt/live?l=AB">tv</a>') + \
    TIT("17ª Jornada") + LINHA(117, "2027-03-20", "18:00", 1184, 1186, "-", "") + "</table>"

# 1) jogos futuros sem ficha passam a entrar com id provisório
jogos, eqs = scrape.parse_calendar(CAL1, 493)
assert len(jogos) == 3, jogos
fut = jogos[2]
assert fut["id"] == scrape.id_provisorio(493, 117) == -49300117, fut
assert fut["jornada"] == 17 and fut["data"] == "2027-03-20" and fut["golos_casa"] is None
assert jogos[1]["id"] == 18739 and scrape.ao_vivo_tv(jogos[1]) and not scrape.ao_vivo_tv(jogos[0])
print("FUTUROS OK")


from falsa import DB


db = DB()
r = scrape.Robo(db)
paginas = {"/Competicao/493": CAL1}
r.get = lambda path, params=None: paginas[path]

# 2) o jogo futuro fica guardado com id provisório; o backoffice põe-lhe canal de TV; avisa-se o início
r.calendario(493)
assert (-49300117,) in db.t["jogos"]
db.upsert("jogos", [{"id": -49300117, "canal_tv": "Sport TV 2", "destaque": True}], "id")
db.upsert("notificacoes_enviadas", [{"jogo_id": -49300117, "tipo": "inicio", "destinatarios": 7}], "jogo_id,tipo")

# 3) a ficha aparece no hp.fpp.pt -> o provisório é trocado pelo verdadeiro, sem perder nada
paginas["/Competicao/493"] = CAL1.replace(LINHA(117, "2027-03-20", "18:00", 1184, 1186, "-", ""),
                                          LINHA(117, "2027-03-20", "18:00", 1184, 1186, "2 - 1", '<a href="/jogo/18850">x</a><a href="https://tv.fpp.pt/live?l=ZZ">tv</a>'))
r.calendario(493)
assert (-49300117,) not in db.t["jogos"], "provisório devia ter sido apagado"
real = db.t["jogos"][(18850,)]
assert real["canal_tv"] == "Sport TV 2" and real["destaque"] is True and real["golos_casa"] == 2
assert (18850, "inicio") in db.t["notificacoes_enviadas"], "a notificação de início não pode repetir"
print("TROCA OK")

# 4) estado: com transmissão em direto não conta como final (atrasos); sem ela, final após 95 min
agora = datetime.now(scrape.TZ_PT)
k = agora - timedelta(minutes=120)
cal = '<table class="calendario-hp">' + TIT("1ª Jornada") + \
    LINHA(1, k.strftime("%Y-%m-%d"), k.strftime("%H:%M"), 1, 2, "3 - 3", '<a href="/jogo/1">x</a><a href="https://tv.fpp.pt/live?l=Q">tv</a>') + \
    LINHA(2, k.strftime("%Y-%m-%d"), k.strftime("%H:%M"), 3, 4, "1 - 0", '<a href="/jogo/2">x</a><a href="https://tv.fpp.pt/video?videoId=e-9">tv</a>') + "</table>"
paginas["/Competicao/1"] = cal
est = {j["id"]: j["estado"] for j in r.calendario(1)}
assert est == {1: "provisorio", 2: "final"}, est
print("ESTADOS OK")

# 5) janela e escolha do modo
tz = scrape.TZ_PT
d = lambda h, m: datetime(2026, 11, 21, h, m, tzinfo=tz)
assert scrape.Robo.modo_auto(d(14, 25)) == "aovivo"
assert scrape.Robo.modo_auto(d(14, 10)) == "rapido"
assert scrape.Robo.modo_auto(d(20, 15)) == "aovivo"
assert scrape.Robo.modo_auto(d(23, 31)) == "rapido"
verao = datetime(2027, 7, 3, 14, 20, tzinfo=tz)
assert scrape.Robo.modo_auto(verao) == "aovivo"
print("JANELA OK")

# 6) jogos a decorrer
js = [{"id": 1, "data": "2026-11-21", "hora": "18:00", "estado": "agendado"},
      {"id": 2, "data": "2026-11-21", "hora": "15:00", "estado": "final"},
      {"id": 3, "data": "2026-11-21", "hora": "21:00", "estado": "agendado"},
      {"id": 4, "data": "2026-11-21", "hora": "17:00", "estado": "provisorio"}]
assert [j["id"] for j in r.jogos_a_decorrer(js, d(17, 50))] == [1, 4]
print("A DECORRER OK")

# 7) uma volta curta do modo ao vivo (sem esperar): termina por limite de tempo
scrape.VIVO_LIMITE = 0
db2 = DB(); r2 = scrape.Robo(db2)
db2.upsert("competicoes", [{"id": 1, "nome": "Teste", "ativa": True}], "id")
r2.get = lambda path, params=None: cal if path.startswith("/Competicao") else ""
r2.janela = lambda agora: (agora - timedelta(hours=1), agora + timedelta(hours=1))
r2.correr = lambda modo, fechar=True: None
assert r2.ao_vivo() is True
print("AO VIVO OK")
print("TODOS OS TESTES DO MODO AO VIVO PASSARAM")

# 8) uma volta completa com um jogo a decorrer: lê o calendário e a ficha desse jogo
scrape.VIVO_LIMITE = 10**9
db3 = DB(); r3 = scrape.Robo(db3)
db3.upsert("competicoes", [{"id": 1, "nome": "Teste", "ativa": True}], "id")
pedidos = []
def get3(path, params=None):
    pedidos.append(path)
    return cal if path.startswith("/Competicao") else ""
r3.get = get3
r3.janela = lambda agora: (agora - timedelta(hours=1), agora + timedelta(hours=1))
r3.correr = lambda modo, fechar=True: r3.calendario(1)
fichas = []
r3.jogo = lambda j: fichas.append(j["id"])
def dorme(s):
    scrape.VIVO_LIMITE = 0
scrape.time.sleep = dorme
r3.ao_vivo()
assert fichas == [1], fichas   # só o jogo ainda em direto; o 2 já terminou
assert pedidos.count("/Competicao/1") == 2, pedidos
print("VOLTA AO VIVO OK")
