// Dados de demonstração (só usados enquanto o config.js não tem o Supabase).
// Têm exatamente a mesma forma das tabelas da base de dados.
window.HP_DEMO = (function () {
  const F = "https://plataforma.fpp.pt/Files/";
  const clubes = [
    [123, "J. Pacense / Des Compagnons", "#0E5FA8", "Paços de Ferreira"], [129, "AJ Viana", "#1E6B3A", "Viana do Castelo"],
    [127, "UD Oliveirense / Simoldes", "#C99A12", "Oliveira de Azeméis"], [125, "AD Sanjoanense", "#2D3748", "São João da Madeira"],
    [1329, "Sporting CP", "#0B7A3E", "Lisboa"], [122, "Candelária SC", "#3B5BA5", "Madeira"],
    [124, "Riba d' Ave HC / CSJ Group", "#4A5568", "V. N. de Famalicão"], [128, "AD Valongo / Colquímica", "#22314F", "Valongo"],
    [116, "FC Porto", "#1C3F94", "Porto"], [1333, "SL Benfica", "#D0102B", "Lisboa"],
    [951, "OC Barcelos SAD", "#B3122E", "Barcelos"], [126, "SCT / UP TOMAR", "#6B2C91", "Tomar"],
    [120, "HC Braga SAD/SPORMEX", "#8E1D29", "Braga"], [155, "AD Oeiras", "#C05621", "Oeiras"]
  ].map(([id, nome, cor, cidade]) => ({ id, nome, cor, cidade, logo_url: F + "CLUBE_" + id + ".png", nome_curto: null, logo_custom: null, pavilhao: null, instagram: null, descricao: null }));
  const eqId = { 123: 1182, 129: 1184, 127: 1178, 125: 1186, 1329: 1159, 122: 1187, 124: 1188, 128: 1167, 116: 1172, 1333: 1181, 951: 1185, 126: 1189, 120: 1190, 155: 1183 };
  const equipas = clubes.map(c => ({ id: eqId[c.id], competicao_id: 493, clube_id: c.id, nome: c.nome }));
  equipas.push({ id: 1203, competicao_id: 494, clube_id: 123, nome: 'J. Pacense "B"' }, { id: 1300, competicao_id: 511, clube_id: 123, nome: "J. Pacense" });
  const competicoes = [
    { id: 493, nome: "Campeonato Placard HP - Fase Regular", grupo: "Campeonato Placard de Hóquei em Patins", nome_curto: "Campeonato Placard", ativa: true, principal: true, ordem: 1, menu: "principal" },
    { id: 494, nome: "CN 2ª Divisão Norte", grupo: "Campeonato Nacional 2ª Divisão", nome_curto: null, ativa: true, principal: false, ordem: 2, menu: "principal" },
    { id: 511, nome: "CN Sub 23 Norte", grupo: "Campeonato Nacional Sub 23", nome_curto: null, ativa: true, principal: false, ordem: 4, menu: "mais" },
    { id: 508, nome: "Taça de Portugal Masculina - Pré Eliminatória", grupo: "Taça de Portugal Masculina", nome_curto: "Taça de Portugal", ativa: true, principal: false, ordem: 3, menu: "mais" }
  ];
  // jornadas 1 e 2 reais; o resto é calendário de exemplo
  const R = [
    [1, 18727, "2026-11-08", "16:00", 1182, 1184, 5, 3], [1, 18728, "2026-11-08", "15:30", 1178, 1186, 7, 2], [1, 18729, "2026-11-10", "20:30", 1159, 1187, 5, 0],
    [1, 18730, "2026-11-08", "17:00", 1188, 1167, 3, 3], [1, 18731, "2026-11-11", "20:00", 1172, 1181, 3, 2], [1, 18732, "2026-11-08", "17:00", 1185, 1189, 7, 3],
    [1, 18733, "2026-11-08", "17:00", 1190, 1183, 5, 2],
    [2, 18734, "2026-11-14", "21:30", 1184, 1190, 1, 4], [2, 18735, "2026-11-14", "18:00", 1186, 1182, 5, 5], [2, 18736, "2026-11-14", "21:00", 1187, 1178, 0, 2],
    [2, 18737, "2026-11-14", "18:30", 1167, 1159, 1, 3], [2, 18738, "2026-11-14", "20:00", 1181, 1188, 4, 0], [2, 18739, "2026-11-18", "21:00", 1189, 1172, null, null],
    [2, 18740, "2026-11-14", "18:00", 1183, 1185, 3, 8],
    [3, 18741, "2026-11-21", "17:00", 1182, 1187, null, null], [3, 18742, "2026-11-21", "21:30", 1184, 1186, null, null], [3, 18743, "2026-11-21", "18:00", 1178, 1167, null, null],
    [3, 18744, "2026-11-22", "17:00", 1159, 1181, null, null], [3, 18745, "2026-11-21", "21:00", 1188, 1185, null, null], [3, 18746, "2026-11-22", "18:00", 1172, 1183, null, null],
    [3, 18747, "2026-11-21", "18:00", 1190, 1189, null, null]
  ];
  const canais = { 18744: "Sport TV", 18746: "A Bola TV", 18739: "Sport TV" };
  const jogos = R.map(([jor, id, data, hora, casa, fora, gc, gf]) => ({
    id, competicao_id: 493, jornada: jor, jornada_nome: jor + "ª Jornada", numero: id - 18724, data, hora, casa_id: casa, fora_id: fora,
    golos_casa: gc, golos_fora: gf, estado: gc == null ? "agendado" : "final", tv_url: "https://tv.fpp.pt/", arbitros: id === 18727 ? "Carlos Correia, Silvia Coelho, Hélder Pereira, Alexandre Pinto" : null,
    faltas_casa: id === 18727 ? 5 : null, faltas_fora: id === 18727 ? 3 : null, canal_tv: canais[id] || null, destaque: false, nota: null
  }));
  // classificação calculada a partir dos jogos
  const t = {};
  equipas.forEach(e => t[e.id] = { competicao_id: 493, equipa_id: e.id, pts: 0, j: 0, v: 0, e: 0, d: 0, gm: 0, gs: 0 });
  jogos.filter(j => j.golos_casa != null).forEach(j => {
    const a = t[j.casa_id], b = t[j.fora_id]; a.j++; b.j++; a.gm += j.golos_casa; a.gs += j.golos_fora; b.gm += j.golos_fora; b.gs += j.golos_casa;
    if (j.golos_casa > j.golos_fora) { a.v++; b.d++; a.pts += 3 } else if (j.golos_casa < j.golos_fora) { b.v++; a.d++; b.pts += 3 } else { a.e++; b.e++; a.pts++; b.pts++ }
  });
  const classificacao = Object.values(t).map(r => ({ ...r, dg: r.gm - r.gs })).sort((x, y) => y.pts - x.pts || y.dg - x.dg || y.gm - x.gm).map((r, i) => ({ ...r, pos: i + 1 }));
  const P = (id, nome, foto, numero, eq, golos) => ({ id, nome, foto_url: F + foto, numero, nome_publico: null, numero_manual: null, posicao: null, nacionalidade: null, data_nascimento: null, foto_custom: null, bio: null, visivel: true, _eq: eq, _g: golos });
  const J = [
    P(161518, "Àlvaro Shehda", "FED/FED_160001_165000/FED_161518.png", 1, 1182, 0), P(161551, "Abreu", "FED/FED_160001_165000/FED_161551.jpg", 78, 1182, 2),
    P(161488, "Ezequiel Funes", "FED/FED_160001_165000/FED_161488.png", 57, 1182, 0), P(161546, "Flórido", "FED/FED_160001_165000/FED_161546.jpg", 7, 1182, 0),
    P(161645, "Franco Serfaty", "FED/FED_160001_165000/FED_161645.png", 77, 1182, 1), P(161555, "Gabi Costa", "FED/FED_160001_165000/FED_161555.jpg", 10, 1182, 0),
    P(161550, "Joca Guimarães", "FED/FED_160001_165000/FED_161550.jpg", 74, 1182, 2), P(161547, "Cancela", "FED/FED_160001_165000/FED_161547.jpg", 55, 1182, 2),
    P(161548, "Zé Miguel", "FED/FED_160001_165000/FED_161548.jpg", 5, 1182, 2), P(161549, "Miccoli", "FED/FED_160001_165000/FED_161549.jpg", 9, 1182, 1),
    P(166353, "Rafa Almeida", "FED_166353.png", 25, 1184, 2), P(164820, "Tomás Pereira", "FED/FED_160001_165000/FED_164820.jpg", 5, 1184, 1),
    P(166354, "Futuro", "FED_166354.png", 74, 1184, 0), P(166347, "Gabi", "FED_166347.png", 4, 1184, 0),
    P(167515, "Miguel Rocha", "FED/FED_165001_170000/FED_167515.jpg", null, 1185, 8), P(170390, "Gonçalo Neto", "FED/FED_170001_175000/FED_170390.jpeg", null, 1190, 3),
    P(168745, "João Rodrigues", "FED/FED_165001_170000/FED_168745.jpeg", null, 1181, 3), P(170969, "David Fonseca", "FED/FED_170001_175000/FED_170969.jpg", null, 1183, 3)
  ];
  J.push(P(170001, "Jogador da equipa B", "x.png", 3, 1203, 0));
  const plantel = J.map(p => ({ equipa_id: p._eq, jogador_id: p.id, golos: p._g, manual: false }));
  const marcadores = J.filter(p => p._g > 0).sort((a, b) => b._g - a._g).map((p, i) => ({ competicao_id: 493, jogador_id: p.id, pos: i + 1, nome: p.nome, clube_id: equipas.find(e => e.id === p._eq).clube_id, golos: p._g }));
  const tecnicos = [{ equipa_id: 1182, nome: "Hugo Azevedo", funcao: "Treinador" }, { equipa_id: 1182, nome: "Tiago Sousa", funcao: "Treinador Adjunto" }, { equipa_id: 1184, nome: "André Torres", funcao: "Treinador" }];
  const eventos = [
    ["1ª Parte", "24:48", "golo", "fora", "Rafa Almeida", 166353], ["1ª Parte", "20:10", "desconto", "casa", null, null], ["1ª Parte", "16:20", "golo", "casa", "Abreu", 161551], ["1ª Parte", "12:58", "azul", "casa", "Abreu", 161551],
    ["1ª Parte", "12:58", "falta", "casa", null, null], ["1ª Parte", "8:02", "penalti_falhado", "fora", "Tomás Pereira", 164820], ["1ª Parte", "5:30", "golo_penalti", "casa", "Miccoli", 161549], ["1ª Parte", "2:50", "golo", "fora", "Tomás Pereira", 164820],
    ["2ª Parte", "21:35", "golo", "casa", "Joca Guimarães", 161550], ["2ª Parte", "20:43", "azul", "fora", "Futuro", 166354], ["2ª Parte", "19:59", "golo_livre", "casa", "Zé Miguel", 161548], ["2ª Parte", "16:00", "amarelo", "casa", "Franco Serfaty", 161645],
    ["2ª Parte", "11:55", "golo", "casa", "Joca Guimarães", 161550], ["2ª Parte", "6:20", "livre_falhado", "casa", "Cancela", 161547], ["2ª Parte", "4:00", "desconto", "fora", null, null], ["2ª Parte", "2:56", "golo", "fora", "Rafa Almeida", 166353]
].map((e, i) => ({ id: i + 1, jogo_id: 18727, ordem: i, parte: e[0], tempo: e[1], tipo: e[2], lado: e[3], jogador: e[4], jogador_id: e[5] }));
  const U = "https://fpp.pt/wp-content/uploads/";
  const noticias = [
    ["Joca Guimarães bisa e a Juventude Pacense entra a ganhar no Placard", "Vitória por 5-3 frente à AJ Viana na estreia, num jogo decidido na segunda parte.", "202627-CPHP-News-1-JJ-Fecho-20261111.png", 493, true, "2026-11-08T20:00:00Z"],
    ["FC Porto conquista a terceira Taça Continental", "Os dragões venceram a final da WSE Continental Cup e somam o terceiro título na competição.", "2026-Taca-Continental-FCP.png", null, true, "2026-11-15T12:00:00Z"],
    ["Sporting CP vence em Valongo e fecha a 2ª jornada", "Vitória leonina por 3-1 num dos pavilhões mais difíceis do campeonato.", "202627-CPHP-News-2-JJ-Fecho-20261114.png", 493, true, "2026-11-14T23:00:00Z"],
    ["Benfica abre a época com a Supertaça António Livramento", "Vitória sobre o Sporting CP no primeiro troféu da temporada.", "2026_STAL_SLBxSCP.png", null, false, "2026-11-02T20:00:00Z"],
    ["13ª Supertaça feminina para as encarnadas", "O Benfica venceu o HC Massamá e voltou a erguer a Supertaça feminina.", "2026_STF_SLBxASM.png", null, false, "2026-11-03T20:00:00Z"],
    ["Três equipas portuguesas na fase final da Continental Cup", "Portugal em força na decisão da segunda competição europeia de clubes.", "2026-taca-Continental.png", null, false, "2026-11-12T10:00:00Z"]
  ].map((n, i) => ({ id: "demo-" + i, titulo: n[0], slug: "demo-" + i, resumo: n[1], corpo: n[1] + "\n\nEste é um texto de demonstração. No site a funcionar, o texto completo é escrito no backoffice.", imagem_url: U + n[2], credito_foto: "FPP", competicao_id: n[3], categoria: n[3] ? null : "Europa", clubes: i === 0 ? [123, 129] : [], destaque: n[4], publicado: true, publicado_em: n[5], autor: "Redação" }));
  const mercado = [
    { id: "m1", jogador: "Exemplo de reforço", jogador_id: null, de_clube: 1333, para_clube: 116, tipo: "Contratação", data: "2026-11-10", nota: null },
    { id: "m2", jogador: "Exemplo de renovação", jogador_id: null, de_clube: 123, para_clube: 123, tipo: "Renovação", data: "2026-11-02", nota: null }
  ];
  const equipa_jornada = [{ id: "ej1", competicao_id: 493, jornada: 1, titulo: "Equipa da 1ª Jornada", publicado: true, treinador: "Hugo Azevedo", treinador_clube: 123,
    jogadores: [{ posicao: "Guarda-redes", nome: "Àlvaro Shehda", clube_id: 123, numero: 1 }, { posicao: "Defesa", nome: "Abreu", clube_id: 123, numero: 78 },
      { posicao: "Defesa", nome: "Gonçalo Neto", clube_id: 120 }, { posicao: "Médio", nome: "Rafa Almeida", clube_id: 129, numero: 25 }, { posicao: "Avançado", nome: "Miguel Rocha", clube_id: 951 }] }];
  const definicoes = [{ chave: "ultima_atualizacao", valor: { quando: new Date().toISOString(), modo: "demo" } },
    { chave: "sobre", valor: { texto: "O Hóquei em Português é a casa de quem vive o hóquei em patins: resultados, histórias e o dia a dia dos clubes, do Placard às divisões regionais." } }];
  const patrocinios = [
    { id: "sp1", nome: "Exemplo", imagem_url: null, link: "#/sobre", texto: "O teu banner aqui · Anuncia no Hóquei em Português", posicao: "inicio", ativo: true, ordem: 1 },
    { id: "sp2", nome: "Exemplo", imagem_url: null, link: "#/sobre", texto: "O teu banner aqui", posicao: "jogo", ativo: true, ordem: 1 },
    { id: "sp3", nome: "Parceiro A", imagem_url: null, link: "#/sobre", texto: "Parceiro A", posicao: "rodape", ativo: true, ordem: 1 },
    { id: "sp4", nome: "Parceiro B", imagem_url: null, link: "#/sobre", texto: "Parceiro B", posicao: "rodape", ativo: true, ordem: 2 },
    { id: "sp5", nome: "Exemplo", imagem_url: null, link: "#/sobre", texto: "A tua marca", posicao: "equipa_jornada", ativo: true, ordem: 1 }];
  return { patrocinios, competicoes, clubes, equipas, classificacao, jogos, eventos, jogadores: J.map(({ _eq, _g, ...p }) => p), plantel, tecnicos, marcadores, noticias, mercado, equipa_jornada, definicoes, newsletter: [], mensagens: [] };
})();
