import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scrape import *

CAL = '''<div id="principal"><table class="calendario-hp"> <tr> <td colspan="6"><h6 class="titulo-jornada">1ª Jornada</h6></td> </tr>
<tr> <td class="coluna-data coluna-numero"> <p class="data">3</p> </td> <td class="coluna-data"> <p class="data"> 2026-11-08 <br> 16:00 </p> </td>
<td class="coluna-equipa"> <a href="/Equipa/493/1182"><p class="visitada bold">J. Pacense / Des Compagnons</p></a> </td>
<td class="coluna-resultado"> <p class="resultado" > 5 - 3 </p> </td>
<td class="coluna-equipa"> <a href="/Equipa/493/1184"><p class="visitante ">AJ Viana </p></a> </td>
<td class="coluna-opcoes"> <a href="/jogo/18727"><i class="fa fa-search"></i></a> <br><a target="_blank" href="https://tv.fpp.pt/video?videoId=e-5518&amp;metaname=compID"><i class="fa fa-tv"></i></a> </td> </tr>
<tr> <td colspan="6"><h6 class="titulo-jornada">2ª Jornada</h6></td> </tr>
<tr> <td class="coluna-data coluna-numero"> <p class="data">15</p> </td> <td class="coluna-data"> <p class="data"> 2026-11-18 <br> 21:00 </p> </td>
<td class="coluna-equipa"> <a href="/Equipa/493/1189"><p class="visitada ">SCT / UP TOMAR</p></a> </td> <td class="coluna-resultado"> <p class="resultado" > - </p> </td>
<td class="coluna-equipa"> <a href="/Equipa/493/1172"><p class="visitante ">FC Porto </p></a> </td>
<td class="coluna-opcoes"> <a href="/jogo/18739"><i></i></a> <br><a target="_blank" href="https://tv.fpp.pt/live?l=99"><i></i></a> </td> </tr></table></div>'''

CLS = '''<table style="width:100%;"> <tr> <th></th> <th></th> <th>P</th> <th>J</th> <th>V</th> <th>E</th> <th>D</th> <th>GM</th> <th>GS</th> <th>DG</th> </tr>
<tr> <td class="classificacao"> <p>1</p> </td> <td class="clube"> <a href="/Equipa/493/1185"> <p><img src="https://plataforma.fpp.pt/Files/CLUBE_951.png" class="team-logo"></p> <p>OC Barcelos SAD </p> </a> </td>
<td>6</td> <td>2</td> <td>2</td> <td>0</td> <td>0</td> <td>15</td> <td>6</td> <td>9</td> </tr>
<tr> <td class="classificacao"> <p>8</p> </td> <td class="clube"> <a href="/Equipa/493/1167"> <p><img src="https://plataforma.fpp.pt/Files/CLUBE_128.png"></p> <p>AD Valongo / Colquímica</p> </a> </td>
<td>1</td> <td>2</td> <td>0</td> <td>1</td> <td>1</td> <td>4</td> <td>6</td> <td>-2</td> </tr></table>'''

MK = '''<div class="ranking-container"> <div class="player-row header"> <span>#</span> <span>Jogador</span> <span class="equipa">Equipa</span> <span>Golos</span> </div>
<div class="player-row"> <span>1</span> <span> <img src="https://plataforma.fpp.pt/Files/FED/FED_165001_170000/FED_167515.jpg" class="player-photo"> Miguel Rocha </span>
<span class="equipa"> <img src="https://plataforma.fpp.pt/Files/CLUBE_951.png" class="team-logo"> <p>OC Barcelos SAD </p> </span> <span>8</span> </div></div>'''

EQ = '''<div id="principal"><div class="team-banner"> <img src="https://plataforma.fpp.pt/Files/CLUBE_123.png" class="team-logo1"></div>
<section class="stats-section"> <h2>J. Pacense / Des Compagnons</h2> <div class="stats-container row">
<div class="stat-item"> <p>Golos Marcados</p> <h3> <span>5</span> <span style="font-size: small;">/ 86 </span> </h3></div>
<div class="stat-item"> <p>Golos Sofridos</p> <h3> <span>8</span> <span>/ 86 </span> </h3></div>
<div class="stat-item"> <p>Faltas</p> <h3> <span>15</span> <span>/ 241 </span> </h3></div>
<div class="stat-item"> <p>Últimos 5 jogos</p> <span class="result draw"></span></div></div></section>
<section class="plantel-section"> <h2>Plantel</h2> <div class="players-grid row">
<div class="col-md-4"> <a href=""> <div class="player-card"> <img src="https://plataforma.fpp.pt/Files/FED/FED_160001_165000/FED_161488.png" class="player-photo"> <div class="player-info"> <p class="player-name">Ezequiel Funes</p> <p class="player-nationality"></p> </div> </div> </a> </div>
<div class="col-md-4"> <a href=""> <div class="player-card"> <img src="https://plataforma.fpp.pt/Files/FED/FED_160001_165000/FED_161550.jpg" class="player-photo"> <div class="player-info"> <p class="player-name">Joca Guimarães</p> <p class="player-nationality">2 Golos</p> </div> </div> </a> </div>
<div class="col-md-4"> <div class="player-card"> <img src="/img/sem-foto.png"> <p class="player-name">Sem Id</p></div></div></div></section></div>'''

JOGO = open(os.path.join(os.path.dirname(__file__), "jogo.html"), encoding="utf-8").read()

TL = '''<p><a target="_blank" href="https://tv.fpp.pt/video?videoId=e-5518"><i class="fa fa-tv"></i></a></p> <h3 class="col-md-12">2ª Parte</h3>
<div class='time d-flex align-items-center justify-content-end time-team'> <p><strong> Falta 3 (0:23)</strong> <i class='fa fa-fire'></i></p> </div>
<div class='time d-flex align-items-center time-team1'> <img src='https://plataforma.fpp.pt/Files/FED/FED_160001_165000/FED_161550.jpg' class='player-avatar'> <div class='ms-3'> <p><strong>Golo</strong></p> <p>3:25 Joca Guimarães</p> </div> </div>
<div class='time d-flex align-items-center justify-content-end time-team'> <div class='me-3 text-end'> <p><strong><span class='blue-card'>Cartão Azul </span>4:17</strong></p> <p>Futuro</p> </div> <img src='https://plataforma.fpp.pt/Files/FED_166354.png' class='player-avatar'> </div>
<h3 class="col-md-12">1ª Parte</h3>
<div class='time d-flex align-items-center justify-content-end time-team2'> <div class='me-3 text-end'> <p><strong>Golo </strong></p> <p>00:12 Rafa Almeida</p> </div> <img src='https://plataforma.fpp.pt/Files/FED_166353.png' class='player-avatar'> </div>
<div class='time d-flex align-items-center time-team'> <p><i class='fa fa-hourglass'></i> Desconto de Tempo (15:01)</p> </div>'''

ST = '''<div class="stats-section"> <h3>Disciplina</h3> <div class="team-columns row"> <div class="col-md-6"> <div class="team-column team-visitada col-md-12"> <h4>Equipa Visitada</h4> <p style='font-weight: bold;'>5 Faltas</p></div></div>
<div class="col-md-6"> <div class="team-column team-visitante col-md-12"> <h4>Equipa Visitante</h4> <p style='font-weight: bold;'>3 Faltas</p></div></div></div></div>'''

HOME = '''<div id="principal"><a href="/agenda">Agenda</a><a class="" href="/136/19"> <div class="competicao"> <p>Super Taça</p> </div> </a><a href="/136/4"><div><p>Campeonato Nacional 2ª Divisão</p></div></a></div>'''
GRP = '''<a class="" href="/Competicao/494"> <div class="conjunto-competicao"> <p>CN 2ª Divisão Norte</p> </div> </a><a href="/Competicao/495"><p>CN 2ª Divisão Sul</p></a>'''

def test_all():
    jogos, eqs = parse_calendar(CAL, 493)
    assert len(jogos) == 2 and eqs[1182] == "J. Pacense / Des Compagnons"
    j = jogos[0]
    assert (j["id"], j["jornada"], j["numero"], j["data"], j["hora"], j["golos_casa"], j["golos_fora"], j["casa_id"], j["fora_id"]) == (18727, 1, 3, "2026-11-08", "16:00", 5, 3, 1182, 1184)
    assert j["tv_url"].startswith("https://tv.fpp.pt/video?videoId=e-5518&metaname")
    assert jogos[1]["golos_casa"] is None and jogos[1]["jornada"] == 2 and jogos[1]["jornada_nome"] == "2ª Jornada"

    c = parse_classificacao(CLS)
    assert c[0] == {"pos":1,"equipa_id":1185,"nome":"OC Barcelos SAD","clube_id":951,"logo_url":"https://plataforma.fpp.pt/Files/CLUBE_951.png","pts":6,"j":2,"v":2,"e":0,"d":0,"gm":15,"gs":6,"dg":9}, c[0]
    assert c[1]["dg"] == -2 and c[1]["pos"] == 8

    m = parse_marcadores(MK)
    assert len(m) == 1 and m[0]["jogador_id"] == 167515 and m[0]["nome"] == "Miguel Rocha" and m[0]["golos"] == 8 and m[0]["clube_id"] == 951

    e = parse_equipa(EQ)
    assert e["clube_id"] == 123 and e["stats"] == {"golos_marcados":5,"golos_sofridos":8,"faltas":15}
    assert [(p["id"], p["golos"]) for p in e["jogadores"]] == [(161488, 0), (161550, 2)]

    g = parse_jogo(JOGO)
    assert g["arbitros"].startswith("Carlos Correia")
    assert g["equipas"][0]["jogadores"][0] == {"id":161518,"numero":1,"nome":"Àlvaro Shehda","foto_url":"https://plataforma.fpp.pt/Files/FED/FED_160001_165000/FED_161518.png"}
    assert g["equipas"][0]["jogadores"][5]["nome"] == "Gabi Costa"
    assert g["equipas"][1]["tecnicos"][0] == {"funcao":"Treinador","nome":"André Torres","foto_url":"https://plataforma.fpp.pt/Files/FED/FED_170001_175000/FED_171450.png"}
    assert "token=368ad" in g["ajax"]["/Views/ajax_jogo.php"] and "&amp;" not in g["ajax"]["/Views/ajax_jogo.php"]
    assert g["logos"][0][:2] == (1182, 123)

    ev = parse_timeline(TL)
    assert [(x["parte"], x["tempo"], x["tipo"], x["lado"]) for x in ev] == [
        ("1ª Parte","15:01","desconto","casa"), ("1ª Parte","00:12","golo","fora"),
        ("2ª Parte","4:17","azul","fora"), ("2ª Parte","3:25","golo","casa"), ("2ª Parte","0:23","falta","fora")], ev
    assert ev[1]["jogador"] == "Rafa Almeida" and ev[1]["jogador_id"] == 166353
    assert ev[3]["jogador"] == "Joca Guimarães" and ev[2]["jogador"] == "Futuro"

    assert parse_estatisticas(ST) == {"casa":5,"fora":3}
    assert parse_home(HOME) == [(19,136,"Super Taça"),(4,136,"Campeonato Nacional 2ª Divisão")]
    assert parse_group(GRP) == [(494,"CN 2ª Divisão Norte"),(495,"CN 2ª Divisão Sul")]
    print("TODOS OS TESTES PASSARAM")

if __name__ == "__main__":
    test_all()
