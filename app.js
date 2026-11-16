/* =====================================================================
   HÓQUEI EM PORTUGUÊS — site público
   Lê tudo do Supabase (ou dos dados de demonstração se não houver config)
   ===================================================================== */
const CFG = window.HP_CONFIG || {};
const LIVE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
const SB_URL = (String(CFG.SUPABASE_URL || "").trim().match(/^https?:\/\/[^/]+/) || [""])[0];
const sb = LIVE ? window.supabase.createClient(SB_URL, CFG.SUPABASE_ANON_KEY) : null;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- camada de dados ---------------- */
const cache = new Map();
async function q(table, o = {}) {
  const key = table + JSON.stringify(o);
  if (cache.has(key)) return cache.get(key);
  let rows;
  if (LIVE) {
    let x = sb.from(table).select(o.select || "*");
    for (const [k, v] of Object.entries(o.eq || {})) x = x.eq(k, v);
    for (const [k, v] of Object.entries(o.in || {})) x = x.in(k, v);
    for (const [k, v] of Object.entries(o.gte || {})) x = x.gte(k, v);
    for (const [k, v] of Object.entries(o.lte || {})) x = x.lte(k, v);
    for (const [k, v] of Object.entries(o.ilike || {})) x = x.ilike(k, "%" + v + "%");
    for (const k of o.notnull || []) x = x.not(k, "is", null);
    for (const k of o.isnull || []) x = x.is(k, null);
    for (const [k, asc] of o.order || []) x = x.order(k, { ascending: asc, nullsFirst: false });
    if (o.limit) x = x.limit(o.limit);
    const { data, error } = await x;
    if (error) { console.error(table, error); rows = []; } else rows = data;
  } else {
    rows = (window.HP_DEMO[table] || []).slice();
    if (table === "noticias") rows = rows.filter(r => r.publicado);
    if (table === "equipa_jornada") rows = rows.filter(r => r.publicado);
    for (const [k, v] of Object.entries(o.eq || {})) rows = rows.filter(r => r[k] === v);
    for (const [k, v] of Object.entries(o.in || {})) rows = rows.filter(r => v.includes(r[k]));
    for (const [k, v] of Object.entries(o.gte || {})) rows = rows.filter(r => r[k] != null && r[k] >= v);
    for (const [k, v] of Object.entries(o.lte || {})) rows = rows.filter(r => r[k] != null && r[k] <= v);
    for (const [k, v] of Object.entries(o.ilike || {})) rows = rows.filter(r => norm(r[k] || "").includes(norm(v)));
    for (const k of o.notnull || []) rows = rows.filter(r => r[k] != null);
    for (const k of o.isnull || []) rows = rows.filter(r => r[k] == null);
    for (const [k, asc] of (o.order || []).slice().reverse()) rows.sort((a, b) => (a[k] ?? "￿") > (b[k] ?? "￿") ? (asc ? 1 : -1) : (a[k] ?? "￿") < (b[k] ?? "￿") ? (asc ? -1 : 1) : 0);
    if (o.limit) rows = rows.slice(0, o.limit);
  }
  if (table === "jogos") rows.forEach(equipasPorNome);
  cache.set(key, rows);
  return rows;
}
// taças: quando a FPP só dá o nome da equipa, cria uma equipa "de passagem" para o site a conseguir mostrar
function equipasPorNome(j) {
  for (const l of ["casa", "fora"]) {
    if (j[l + "_id"] != null || !j[l + "_nome"]) continue;
    let h = 0; for (const ch of j[l + "_nome"]) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const id = -(Math.abs(h) % 1e9) - 1;
    if (!B.equipas.has(id)) B.equipas.set(id, { id, nome: j[l + "_nome"], competicao_id: j.competicao_id, clube_id: null, passagem: true });
    j[l + "_id"] = id;
  }
}
async function ins(table, row) {
  if (!LIVE) return { error: null };
  return sb.from(table).insert(row);
}

/* ---------------- dados base ---------------- */
const B = { comps: [], clubes: new Map(), equipas: new Map(), defs: {} };
async function loadBase() {
  const [comps, clubes, equipas, defs, spons] = await Promise.all([
    q("competicoes", { eq: { ativa: true }, order: [["ordem", true], ["id", true]] }),
    q("clubes"), q("equipas", { select: "id,competicao_id,clube_id,nome" }), q("definicoes"), q("patrocinios", { order: [["ordem", true]] })]);
  B.spons = spons;
  B.comps = comps;
  clubes.forEach(c => B.clubes.set(c.id, c));
  equipas.forEach(e => B.equipas.set(e.id, e));
  defs.forEach(d => B.defs[d.chave] = d.valor);
}
const principal = () => B.comps.find(c => c.principal) || B.comps[0];
const compById = id => B.comps.find(c => c.id === id);
/* ---- provas: as competições do mesmo grupo da FPP ficam juntas (2ª Divisão > Norte | Sul) ---- */
const provaId = c => "g" + (c.grupo_id ?? c.grupo ?? "c" + c.id);
const FASES = /\s*[-–·]?\s*(pr[eé][\s-]*eliminat[óo]ria|\d+[ªa]?\s*eliminat[óo]ria|eliminat[óo]rias?|1\/(2|4|8|16|32)\s*(de\s*)?final|oitavos( de final)?|quartos( de final)?|meias?[\s-]*finais?|final four|fase final|final)\b.*$/i;
const ehTaca = cs => { const f = cs.map(c => c.formato).find(f => f && f !== "auto"); if (f) return f === "eliminatoria"; return cs.some(c => /ta[çc]a|cup|supertaça|super taça|final four|play[\s-]?off|eliminat/i.test(c.nome + " " + (c.grupo || ""))); };
function provaNomeAuto(t) {
  t = String(t || "").replace(/\s+de\s+Hóquei em Patins/i, "").replace(/^Campeonato Nacional\s+/i, "").replace(/^Seniores\s+/i, "").replace(/\bPLACARD\b/g, "").trim();
  return t.replace(/^Femininos?$/i, "Feminino").replace(/^Sub\s*(\d+)$/i, "Sub-$1").replace(/^Super\s*Taça$/i, "Supertaça") || "Competição";
}
// separadores dentro da prova: um por competição; nas taças, as fases (pré-eliminatória, 1/4...) juntam-se num só quadro
function separadores(comps) {
  const taca = ehTaca(comps), m = new Map();
  comps.forEach(c => { const k = taca ? norm(c.nome.replace(FASES, "")).replace(/[^a-z0-9]/g, "") : "c" + c.id; if (!m.has(k)) m.set(k, { id: c.id, comps: [], nome: taca ? c.nome.replace(FASES, "").trim() : c.nome }); m.get(k).comps.push(c); });
  const seps = [...m.values()];
  // nome curto: tira as palavras comuns a todos (CN 2ª Divisão Norte / Sul -> Norte / Sul)
  const pal = seps.map(x => x.nome.replace(/\bPLACARD\b/g, "").trim().split(/\s+/));
  let ini = 0, fim = 0;
  if (pal.length > 1) { while (pal.every(w => w[ini] && norm(w[ini]) === norm(pal[0][ini])) && ini < Math.min(...pal.map(w => w.length)) - 1) ini++; while (pal.every(w => w.length - fim - 1 > ini && norm(w[w.length - 1 - fim]) === norm(pal[0][pal[0].length - 1 - fim]))) fim++; }
  const generos = seps.map(x => /femin/i.test(x.nome));
  seps.forEach((x, i) => { const manual = x.comps.map(c => c.zona).find(Boolean); x.label = manual || (pal.length > 1 ? (generos.some(Boolean) && !generos.every(Boolean) ? (generos[i] ? "Feminina" : "Masculina") : pal[i].slice(ini, pal[i].length - fim).join(" ")) : ""); });
  return seps;
}
function provas() {
  const m = new Map();
  for (const c of B.comps) { const k = provaId(c); if (!m.has(k)) m.set(k, { k, comps: [] }); m.get(k).comps.push(c); }
  return [...m.values()].map(p => { const c0 = p.comps[0]; return { ...p, rep: p.comps.find(c => c.principal) || c0, nome: p.comps.map(c => c.grupo_curto).find(Boolean) || (p.comps.length === 1 && c0.nome_curto) || provaNomeAuto(c0.grupo || c0.nome), menu: p.comps.some(c => c.menu === "principal") ? "principal" : "mais", taca: ehTaca(p.comps) }; });
}
const cardSub = c => { const p = provaDe(c); if (!p) return ""; const l = separadores(p.comps).map(x => x.label).filter(Boolean); return l.length ? l.join(" · ") : (p.taca ? "Taça · eliminatórias" : "Fase regular"); };
const provaDe = c => c ? provas().find(p => p.k === provaId(c)) : null;
const pn = c => provaDe(c)?.nome || cn(c);
// provas do menu principal vs "mais competições" (definido no backoffice; se nada estiver definido, as 6 primeiras)
const compsPrincipais = () => { const ps = provas(), p = ps.filter(x => x.menu === "principal"); return (p.length ? p : ps.slice(0, 6)).map(x => x.rep); };
const compsMais = () => { const p = new Set(compsPrincipais().map(provaId)); return provas().filter(x => !p.has(x.k)).map(x => x.rep); };
function compPicker(c, tab) {
  const mais = compsMais(), k = provaId(c);
  return `<div class="cpick"><div class="chips cp-chips">${compsPrincipais().map(x => `<a class="chip ${provaId(x) === k ? "on" : ""}" href="#/competicao/${x.id}">${esc(pn(x))}</a>`).join("")}</div>${mais.length ? `<select class="input cp-sel" onchange="if(this.value)go('/competicao/'+this.value)"><option value="">Mais competições ▾</option>${mais.map(x => `<option value="${x.id}" ${provaId(x) === k ? "selected" : ""}>${esc(pn(x))}</option>`).join("")}</select>` : ""}</div>`;
}
const cn = c => c ? (c.nome_curto || c.nome) : "";
const clean = n => String(n || "").split(/\s*\/\s*/)[0].trim().replace(/\s+SAD$/i, "").replace(/\s*["“”']([A-D])["“”']\s*$/, " $1").trim();
const sufixo = n => (clean(n).match(/\s([B-D])$/) || [])[1];
// cada equipa é "clube + letra" (123 = principal, 123-B = equipa B); junta a mesma equipa em várias competições
// escalão pela competição: femininas e sub-23 são equipas diferentes do mesmo clube
const escalao = c => { const n = norm((c?.nome || "") + " " + (c?.grupo || "")); if (/femin/.test(n)) return "F"; const s = /sub\s*-?\s*(\d+)/.exec(n); return s ? "S" + s[1] : ""; };
const ESC_NOME = { F: "Feminino" };
const escNome = k => ESC_NOME[k] || (k ? "Sub-" + k.slice(1) : "");
const teamKey = eid => { const e = B.equipas.get(eid); if (!e || e.passagem) return ""; if (!e.clube_id) return "e" + e.id; const s = sufixo(e.nome), x = escalao(compById(e.competicao_id)); return e.clube_id + (s ? "-" + s : "") + (x ? "-" + x : ""); };
const teamLabel = eid => { const e = B.equipas.get(eid); const x = escalao(compById(e?.competicao_id)); return tName(eid) + (x ? " · " + escNome(x) : ""); };
const eqsDaChave = k => { const m = /^e(\d+)$/.exec(k); if (m) return [...B.equipas.values()].filter(e => e.id === +m[1]); return [...B.equipas.values()].filter(e => teamKey(e.id) === k); };
const clubOfTeam = eid => B.clubes.get(B.equipas.get(eid)?.clube_id);
const clubName = c => c ? (c.nome_curto || clean(c.nome).replace(/\s[B-D]$/, "")) : "";
const tName = eid => { const e = B.equipas.get(eid), c = clubOfTeam(eid); if (!e) return "—"; const s = sufixo(e.nome); return c?.nome_curto ? c.nome_curto + (s ? " " + s : "") : clean(e.nome); };
const ini = n => clean(n).replace(/^(FC|SL|CP|OC|UD|HC|AD|CD|AA|SC|AJ|GD|CA)\s+/i, "").split(/\s+/).map(w => w[0]).join("").slice(0, 3).toUpperCase();
function crestC(c, size = 28, cls = "crest") {
  const logo = c && (c.logo_custom || c.logo_url);
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size / 3)}px`;
  if (logo) return `<span class="${cls} lg" style="${st}"><img src="${esc(logo)}" alt="" loading="lazy" onerror="var p=this.parentNode;p.classList.remove('lg');p.style.background='${esc(c.cor || "#7A1C28")}';p.textContent='${esc(ini(c.nome))}'"></span>`;
  return `<span class="${cls}" style="${st};background:${esc(c?.cor || "#7A1C28")}">${esc(ini(c?.nome || "?"))}</span>`;
}
const crest = (eid, size) => crestC(clubOfTeam(eid) || { nome: B.equipas.get(eid)?.nome }, size);
const pName = p => p.nome_publico || p.nome;
const pNum = p => p.numero_manual ?? p.numero;
const pFoto = p => p.foto_custom || p.foto_url;
const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const pad = i => String(i + 1).padStart(2, "0");
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
const fmtD = d => d ? new Date(d + (d.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-PT", { weekday: "short", day: "numeric", month: "short" }).replace(".", "") : "";
const fmtDN = d => d ? new Date(d).toLocaleDateString("pt-PT", { day: "numeric", month: "short", year: "numeric" }) : "";
const score = j => j.golos_casa == null ? null : `${j.golos_casa}-${j.golos_fora}`;
const img = (src, alt = "", cls = "") => src ? `<div class="imgbox ${cls}"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" onerror="this.parentNode.classList.add('err');this.remove()"></div>` : `<div class="imgbox err ${cls}"></div>`;
const RINK = `<svg class="rinkline" viewBox="0 0 400 220"><rect x="4" y="4" width="392" height="212" rx="60"/><line x1="200" y1="4" x2="200" y2="216"/><circle cx="200" cy="110" r="34"/><path d="M4 70 h50 a40 40 0 0 1 0 80 h-50"/><path d="M396 70 h-50 a40 40 0 0 0 0 80 h50"/><circle cx="200" cy="110" r="3"/></svg>`;
const hd = (crumbs, title, desc, tabs, act, base) => `<div class="phd">${RINK}<div class="wrap" style="position:relative"><div class="crumbs"><a href="#/">Início</a>${crumbs.map(c => ` / ${c[1] ? `<a href="${c[1]}">${esc(c[0])}</a>` : esc(c[0])}`).join("")}</div><h1 class="x">${esc(title)}</h1>${desc ? `<p>${esc(desc)}</p>` : ""}${tabs ? `<div class="tabs">${tabs.map((t, i) => `<a class="tb ${i === act ? "on" : ""}" href="${base}/${i}">${t}</a>`).join("")}</div>` : `<div style="height:40px"></div>`}</div></div>`;
const sh = (i, t, more) => `<div class="sh"><span class="idx">${i}</span><h2 class="x">${esc(t)}</h2>${more ? `<a class="more" href="${more[1]}">${esc(more[0])} →</a>` : "<span></span>"}</div>`;
const empty = t => `<div class="box rink-r"><p style="color:var(--ink-2)">${t}</p></div>`;
const newsCat = n => n.competicao_id ? cn(compById(n.competicao_id)) || "Hóquei" : (n.categoria || "Hóquei");
const nc = (n, i) => `<a class="nc" href="#/noticia/${esc(n.slug || n.id)}">${img(n.imagem_url, n.titulo)}<div class="row"><span class="lbl">${pad(i)} — ${esc(newsCat(n))}</span><span class="lbl">${fmtD(n.publicado_em)}</span></div><h3>${esc(n.titulo)}</h3></a>`;
const matchRow = (j, extra = "") => `<a class="match" href="#/jogo/${j.id}"><span class="a">${esc(tName(j.casa_id))} ${crest(j.casa_id)}</span><span class="s ${score(j) ? "" : "h"}">${score(j) || esc(j.hora || "—")}</span><span class="b">${crest(j.fora_id)}${esc(tName(j.fora_id))}</span><span class="i"><span>${esc((j.jornada_nome || "").toUpperCase())} · ${esc(fmtD(j.data).toUpperCase())}${j.estado === "provisorio" ? " · PROVISÓRIO" : ""}</span><span>${extra || (j.canal_tv ? esc(j.canal_tv.toUpperCase()) + " · " : "") + "FICHA →"}</span></span></a>`;
const tvRow = j => `<a class="tv" href="#/jogo/${j.id}"><span class="when">${esc(fmtD(j.data))}<b>${esc(j.hora || "")}</b></span><span style="font-weight:700">${crest(j.casa_id)}${esc(tName(j.casa_id))} <span style="color:var(--ink-2);font-weight:400">vs</span> ${esc(tName(j.fora_id))}<br><small class="lbl">${esc(cn(compById(j.competicao_id)))}</small></span><span class="ch ${j.canal_tv ? "" : "live"}">${esc(j.canal_tv || "FPP TV")}</span></a>`;
const trRow = m => `<div class="tr"><span class="p">${esc(m.jogador)}<small>${esc(fmtD(m.data))}${m.nota ? " · " + esc(m.nota) : ""}</small></span><span class="from">${m.de_clube ? crestC(B.clubes.get(m.de_clube)) + esc(clubName(B.clubes.get(m.de_clube))) : "—"}</span><span class="arr">${m.tipo === "Renovação" ? "↻" : "→"}</span>${m.para_clube ? `<a href="#/clube/${m.para_clube}">${crestC(B.clubes.get(m.para_clube))}${esc(clubName(B.clubes.get(m.para_clube)))}</a>` : "<span>—</span>"}<span class="k ${m.tipo === "Renovação" ? "ren" : ""}">${esc(m.tipo)}</span></div>`;
function para(t) { // texto simples -> parágrafos, **negrito**, [texto](link)
  return esc(t || "").split(/\n\s*\n/).map(p => "<p>" + p.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" style="color:var(--red);text-decoration:underline">$1</a>').replace(/\n/g, "<br>") + "</p>").join("");
}

/* forma (últimos 5) a partir dos jogos */
function forma(jogos, eid) {
  return jogos.filter(j => j.golos_casa != null && (j.casa_id === eid || j.fora_id === eid)).sort((a, b) => (b.data || "").localeCompare(a.data || "")).slice(0, 5).reverse()
    .map(j => { const g = j.casa_id === eid ? j.golos_casa - j.golos_fora : j.golos_fora - j.golos_casa; return g > 0 ? "V" : g < 0 ? "D" : "E"; });
}
const formaHTML = f => f.map(x => `<span class="fm ${x}">${x}</span>`).join("");
/* zonas da classificação (definidas no backoffice > Zonas das tabelas) */
const ZONAS = { campeao: ["Play-off de apuramento de campeão", "#C9A227"], playoff: ["Play-off", "#2F6FB5"], subida: ["Sobe de divisão", "#1E8E5A"], playoff_subida: ["Play-off de subida", "#62B88E"], playoff_descida: ["Play-off de descida", "#E08A2E"], descida: ["Desce de divisão", "#C0392B"] };
const zonasDe = c => (Array.isArray(c?.zonas) ? c.zonas : []).filter(z => ZONAS[z.tipo] && +z.de > 0 && +z.ate >= +z.de);
const zonaPos = (c, pos) => zonasDe(c).find(z => pos >= +z.de && pos <= +z.ate);
const zonaAttr = (c, pos) => { const z = zonaPos(c, pos); return z ? ` data-z="${z.tipo}" style="--zc:${ZONAS[z.tipo][1]}" title="${esc(z.nome || ZONAS[z.tipo][0])}"` : ""; };
const ordinal = n => n + ".º";
const zonasLegenda = c => { const zs = zonasDe(c); return zs.length ? `<div class="zleg">${zs.map(z => `<span><i style="background:${ZONAS[z.tipo][1]}"></i>${esc(z.nome || ZONAS[z.tipo][0])} <small>${+z.de === +z.ate ? ordinal(z.de) : ordinal(z.de) + "–" + ordinal(z.ate)}</small></span>`).join("")}</div>` : ""; };
const ultimaJornada = jogos => { const js = jogos.filter(j => j.golos_casa != null && j.jornada).map(j => j.jornada); return js.length ? Math.max(...js) : (jogos[0]?.jornada || 1); };

/* ---------------- menu, placar, pesquisa ---------------- */
function buildMenu() {
  const sm = (t, l) => `<h5>${t}</h5><div class="sm">${l.map(a => `<a href="${a[1]}" ${/^http/.test(a[1]) ? 'target="_blank"' : ""}>${esc(a[0])}</a>`).join("")}</div>`;
  $("#menuCols").innerHTML = `<div class="big"><h5>Competições</h5>${compsPrincipais().map((c, i) => `<a href="#/competicao/${c.id}"><small>${pad(i)}</small>${esc(pn(c))}</a>`).join("")}</div>
  <div>${sm("Mais competições", compsMais().map(c => [pn(c), "#/competicao/" + c.id]).concat([["Seleções", "#/selecoes"]]))}</div>
  <div>${sm("Conteúdos", [["Notícias", "#/noticias"], ["Equipa da Jornada", "#/equipa-da-jornada"], ["Mercado", "#/mercado"], ["Onde ver", "#/onde-ver"], ["Clubes", "#/clubes"]])}</div>
  <div>${sm("A tua app", [["📲 Instalar a app", "#/instalar"], ["🔔 Notificações", "#/notificacoes"]])}${sm("Hóquei em Português", [["Sobre", "#/sobre"], ["Envia a tua notícia", "#/sobre"], ["Instagram ↗", "https://www.instagram.com/" + (CFG.INSTAGRAM || "hoqueiemportugues") + "/"]])}</div>`;
  $("#footComps").innerHTML = compsPrincipais().map(c => `<a href="#/competicao/${c.id}">${esc(pn(c))}</a>`).join("");
}
function openMenu() { $("#menu").classList.add("open"); document.body.style.overflow = "hidden"; setTimeout(() => $("#q").focus(), 50); }
function closeMenu() { $("#menu").classList.remove("open"); document.body.style.overflow = ""; }
async function board() {
  const t = today();
  let js = await q("jogos", { eq: { data: t }, order: [["hora", true]] });
  let tag = "● HOJE";
  if (!js.length) { js = await q("jogos", { gte: { data: t }, order: [["data", true], ["hora", true]], limit: 8 }); tag = "PRÓXIMOS"; }
  if (!js.length) { js = await q("jogos", { notnull: ["golos_casa"], order: [["data", false]], limit: 8 }); tag = "ÚLTIMOS"; }
  js = js.filter(j => compById(j.competicao_id));
  $("#board").innerHTML = js.length ? `<span class="tag">${tag}</span>` + js.map(j => `<a class="gm" href="#/jogo/${j.id}"><span class="t">${esc(tName(j.casa_id))}</span><span class="sc">${score(j) || esc(j.hora || "--:--")}</span><span class="t">${esc(tName(j.fora_id))}</span><span class="st">${j.estado === "provisorio" ? "AO VIVO / PROVISÓRIO" : j.golos_casa != null ? "FINAL" : esc(fmtD(j.data).toUpperCase())} · ${esc(cn(compById(j.competicao_id)).toUpperCase())}</span></a>`).join("") : "";
  $(".board").style.display = js.length ? "" : "none";
}
async function search(v) {
  const qv = norm(v.trim()); const box = $("#res");
  if (qv.length < 2) { box.innerHTML = ""; return; }
  const r = [
    ...[...B.clubes.values()].filter(c => norm(c.nome + " " + (c.nome_curto || "")).includes(qv)).map(c => ({ t: clubName(c), s: "Clube", h: "#/clube/" + c.id })),
    ...B.comps.filter(c => norm(c.nome + " " + (c.nome_curto || "")).includes(qv)).map(c => ({ t: cn(c), s: "Competição", h: "#/competicao/" + c.id })),
  ];
  const [ns, js] = await Promise.all([q("noticias", { ilike: { titulo: v.trim() }, limit: 5, order: [["publicado_em", false]] }), q("jogadores", { ilike: { nome: v.trim() }, eq: { visivel: true }, limit: 6 })]);
  ns.forEach(n => r.push({ t: n.titulo, s: "Notícia", h: "#/noticia/" + (n.slug || n.id) }));
  js.forEach(p => r.push({ t: pName(p), s: "Jogador", h: "#/jogador/" + p.id }));
  box.innerHTML = r.length ? r.slice(0, 12).map(x => `<a href="${x.h}">${esc(x.t)}<small>${x.s}</small></a>`).join("") : `<a href="#/">Sem resultados<small>—</small></a>`;
}

/* ---------------- páginas ---------------- */
let heroT;
async function pHome() {
  const c = principal();
  const [news, jogosP, cls, mk, mkt, ej] = await Promise.all([
    q("noticias", { order: [["publicado_em", false]], limit: 14 }),
    c ? q("jogos", { eq: { competicao_id: c.id }, order: [["data", true], ["hora", true]] }) : [],
    c ? q("classificacao", { eq: { competicao_id: c.id }, order: [["pos", true]] }) : [],
    c ? q("marcadores", { eq: { competicao_id: c.id }, order: [["pos", true]], limit: 6 }) : [],
    q("mercado", { order: [["data", false]], limit: 5 }),
    q("equipa_jornada", { order: [["criado_em", false]], limit: 1 })]);
  const tv = (await q("jogos", { gte: { data: today() }, order: [["data", true], ["hora", true]], limit: 40 })).filter(j => compById(j.competicao_id) && (j.canal_tv || j.tv_url)).slice(0, 4);
  const feat = (news.filter(n => n.destaque).length ? news.filter(n => n.destaque) : news).slice(0, 3);
  const rest = news.filter(n => !feat.includes(n));
  const jor = ultimaJornada(jogosP), last = jogosP.filter(j => j.jornada === jor);
  let s = "";
  if (feat.length) {
    s += `<section class="hero">${RINK.replace('class="rinkline"', 'class="rinkline" style="right:-120px;top:10px;width:900px"')}<div class="wrap hero-grid"><div><div id="hb"></div><div class="ctrl">${feat.map((_, i) => `<button class="dot ${i ? "" : "on"}" data-h="${i}" aria-label="Destaque ${i + 1}"></button>`).join("")}<span class="lbl" style="margin-left:10px" id="hc"></span></div></div><a class="ph" id="hp" href="#/"></a></div></section>`;
  } else {
    s += `<section class="hero">${RINK.replace('class="rinkline"', 'class="rinkline" style="right:-120px;top:10px;width:900px"')}<div class="wrap"><span class="pill">Hóquei em Português</span><h1 class="x" style="margin-top:22px">O hóquei em patins<br><em>jornada a jornada.</em></h1><p class="lead">Resultados, classificações, plantéis e notícias de todas as competições nacionais.</p>${c ? `<a class="btn" href="#/competicao/${c.id}">Ver ${esc(cn(c))} →</a>` : ""}</div></section>`;
  }
  if (rest.length) s += `<section style="padding-top:20px"><div class="wrap"><div class="sh"><span class="idx">01</span><h2 class="x">Últimas</h2><div class="rail-ctrl"><button class="hbtn circ" data-rail="-1">←</button><button class="hbtn circ" data-rail="1">→</button><a class="hbtn" href="#/noticias">Todas</a></div></div><div class="rail" id="rail">${rest.map(nc).join("")}</div></div></section>`;
  { const sp = sponsor("inicio"); if (sp) s += `<div class="wrap" style="margin-top:10px">${sp}</div>`; }
  if (c) s += `<section style="padding-top:20px"><div class="wrap grid g2" style="gap:56px">
    <div>${sh("02", (last[0]?.jornada_nome || "Jornada"), ["Todos os jogos", `#/competicao/${c.id}/1`])}<div class="mini">${last.map(j => `<a class="r" href="#/jogo/${j.id}"><span class="a">${esc(tName(j.casa_id))} ${crest(j.casa_id)}</span><span class="s">${score(j) || esc(j.hora || "—")}</span><span>${crest(j.fora_id)}${esc(tName(j.fora_id))}</span></a>`).join("") || empty("Sem jogos.")}</div></div>
    <div>${sh("03", "Tabela", ["Completa", `#/competicao/${c.id}`])}${cls.length ? `<table class="mtab"><thead><tr><th>#</th><th>Clube</th><th class="c">J</th><th class="c">DG</th><th class="c">Pts</th></tr></thead><tbody>${cls.slice(0, 8).map(r => `<tr${zonaAttr(c, r.pos)}><td><span class="pos">${r.pos}</span></td><td style="font-weight:600"><a href="#/clube/${teamKey(r.equipa_id)}">${crest(r.equipa_id)}${esc(tName(r.equipa_id))}</a></td><td class="c num">${r.j}</td><td class="c num">${r.dg > 0 ? "+" : ""}${r.dg}</td><td class="c pts">${r.pts}</td></tr>`).join("")}</tbody></table>${zonasLegenda(c)}` : empty("A classificação aparece depois da 1ª jornada.")}</div></div></section>`;
  s += `<section style="padding-top:20px"><div class="wrap grid g2" style="grid-template-columns:${ej.length ? "1.4fr 1fr" : "1fr"};gap:56px">
    ${ej.length ? `<div>${sh("04", "Equipa da Jornada", ["Ver", "#/equipa-da-jornada"])}${rinkTeam(ej[0])}${sponsor("equipa_jornada")}</div>` : ""}
    <div>${sh(ej.length ? "05" : "04", "Marcadores", c ? ["Top", `#/competicao/${c.id}/3`] : null)}<div class="docs">${mk.map(m => `<a class="doc" href="#/jogador/${m.jogador_id}"><span class="d">${pad(m.pos - 1)}</span><b>${esc(m.nome)}<br><small style="font-weight:400;color:var(--ink-2)">${esc(clubName(B.clubes.get(m.clube_id)))}</small></b><span class="pts" style="font-size:26px">${m.golos}</span></a>`).join("") || empty("Ainda sem golos registados.")}</div></div></div></section>`;
  s += `<section style="padding-top:20px"><div class="wrap">${sh("06", "Competições")}<div class="compcards">${[...compsPrincipais(), ...compsMais()].map(x => `<a class="cc rink-r" href="#/competicao/${x.id}"><span class="ar">↗</span><span class="lbl">${esc(cardSub(x))}</span><span class="x">${esc(pn(x))}</span></a>`).join("")}</div></div></section>`;
  s += `<section style="padding-top:20px"><div class="wrap grid g2" style="gap:56px"><div>${sh("07", "Mercado", ["Todas as mexidas", "#/mercado"])}${mkt.map(trRow).join("") || empty("Sem movimentos registados.")}</div><div>${sh("08", "Onde ver", ["Agenda", "#/onde-ver"])}${tv.map(tvRow).join("") || empty("Sem transmissões anunciadas.")}</div></div></section>`;
  s += `<div class="newsband"><div class="wrap"><div><span class="lbl" style="color:rgba(255,255,255,.7)">Newsletter</span><h2 class="x" style="margin-top:10px">A jornada inteira<br>no teu email.</h2><p style="opacity:.85;margin-top:14px;max-width:460px;font-size:18px">Resultados, tabela, equipa da jornada e as mexidas do mercado, todas as semanas.</p></div><form id="nlf"><input class="input" type="email" name="email" placeholder="o-teu@email.pt" required><button class="btn">Subscrever</button><label><input type="checkbox" required> Aceito receber a newsletter do Hóquei em Português</label></form></div></div>`;
  if (news.length) s += `<section><div class="wrap"><div class="sh"><span class="idx">09</span><h2 class="x">@${esc(CFG.INSTAGRAM || "hoqueiemportugues")}</h2><a class="more" href="https://www.instagram.com/${esc(CFG.INSTAGRAM || "hoqueiemportugues")}/" target="_blank">Seguir no Instagram ↗</a></div><div class="ig">${news.slice(0, 6).map(n => `<a href="https://www.instagram.com/${esc(CFG.INSTAGRAM || "hoqueiemportugues")}/" target="_blank">${img(n.imagem_url)}</a>`).join("")}</div></div></section>`;
  return { html: s, after: () => {
    let hi = 0;
    const show = i => { hi = i; const n = feat[i]; if (!n || !$("#hb")) return; $("#hb").innerHTML = `<div class="meta"><span class="pill">${esc(newsCat(n))}</span><span class="lbl">${esc(fmtDN(n.publicado_em))}</span></div><h1 class="x">${esc(n.titulo)}</h1><p class="lead">${esc(n.resumo || "")}</p><a class="btn" href="#/noticia/${esc(n.slug || n.id)}">Ler notícia <span>→</span></a>`; $("#hp").href = "#/noticia/" + (n.slug || n.id); $("#hp").innerHTML = img(n.imagem_url, n.titulo, "rink") + (n.credito_foto ? `<span class="num">FOTO: ${esc(n.credito_foto.toUpperCase())}</span>` : ""); document.querySelectorAll(".hero .dot").forEach((d, j) => d.classList.toggle("on", j === i)); $("#hc").textContent = pad(i) + " / " + String(feat.length).padStart(2, "0"); };
    if (feat.length) { show(0); clearInterval(heroT); if (feat.length > 1) heroT = setInterval(() => $("#hb") ? show((hi + 1) % feat.length) : clearInterval(heroT), 7000); }
    document.querySelectorAll(".hero .dot").forEach(d => d.onclick = () => show(+d.dataset.h));
    document.querySelectorAll("[data-rail]").forEach(b => b.onclick = () => $("#rail").scrollBy({ left: +b.dataset.rail * $("#rail").clientWidth * .75, behavior: "smooth" }));
    newsletterForm();
  } };
}
function newsletterForm() {
  const f = $("#nlf"); if (!f) return;
  f.onsubmit = async e => { e.preventDefault(); const email = f.email.value.trim().toLowerCase(); const { error } = await ins("newsletter", { email }); f.innerHTML = `<h3 class="x" style="font-size:30px">${error && !/duplicate/i.test(error.message) ? "Não foi possível subscrever. Tenta mais tarde." : "Estás dentro. Até à próxima jornada!"}</h3>`; };
}
const POSXY = { "Guarda-redes": [[12, 50]], "Defesa": [[34, 26], [34, 74]], "Médio": [[62, 30], [58, 50]], "Avançado": [[70, 72], [80, 40]] };
function rinkTeam(ej) {
  const used = {};
  const pl = (ej.jogadores || []).map((p, i) => { const k = POSXY[p.posicao] ? p.posicao : "Avançado"; used[k] = (used[k] || 0); const xy = POSXY[k][used[k]++ % POSXY[k].length]; const c = B.clubes.get(+p.clube_id); return `<div class="player" style="left:${xy[0]}%;top:${xy[1]}%"><div class="shirt" style="background:${esc(c?.cor || "#7A1C28")}">${esc(p.numero ?? "")}</div><b>${esc(p.nome)}</b><small>${esc(clubName(c))}</small></div>`; }).join("");
  return `<div class="rinkbox"><svg class="lines" viewBox="0 0 400 220" preserveAspectRatio="none"><line x1="200" y1="0" x2="200" y2="220"/><circle cx="200" cy="110" r="30"/><path d="M0 70 h44 a40 40 0 0 1 0 80 h-44"/><path d="M400 70 h-44 a40 40 0 0 0 0 80 h44"/><rect x="0" y="96" width="10" height="28"/></svg>${pl}</div>`;
}

async function pNoticias() {
  const news = await q("noticias", { order: [["publicado_em", false]], limit: 200 });
  const cats = [...new Set(news.map(newsCat))];
  return { html: hd([["Notícias"]], "Notícias", "Tudo o que mexe no hóquei em patins português.") + `<section style="padding-top:36px"><div class="wrap"><div class="tools"><input class="input" id="nq" placeholder="Pesquisar notícias"></div><div class="chips" id="nch">${["Todas", ...cats].map((c, i) => `<button class="chip ${i ? "" : "on"}" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div><div class="grid g4" id="nl"></div></div></section>`,
    after: () => { let cat = "Todas"; const r = () => { const v = norm($("#nq").value); const l = news.filter(n => (cat === "Todas" || newsCat(n) === cat) && norm(n.titulo).includes(v)); $("#nl").innerHTML = l.map(nc).join("") || `<p style="color:var(--ink-2)">Sem notícias.</p>`; }; $("#nq").oninput = r; document.querySelectorAll("#nch .chip").forEach(b => b.onclick = () => { cat = b.dataset.c; document.querySelectorAll("#nch .chip").forEach(x => x.classList.toggle("on", x === b)); r(); }); r(); } };
}
async function pNoticia(slug) {
  let n = (await q("noticias", { eq: { slug } }))[0] || (/^[0-9a-f-]{36}$/.test(slug) ? (await q("noticias", { eq: { id: slug } }))[0] : null);
  if (!n) return { html: hd([["Notícias", "#/noticias"]], "Notícia não encontrada") };
  const more = (await q("noticias", { order: [["publicado_em", false]], limit: 5 })).filter(x => x.id !== n.id).slice(0, 4);
  const clubs = (n.clubes || []).map(id => B.clubes.get(id)).filter(Boolean);
  return { html: hd([["Notícias", "#/noticias"], [newsCat(n)]], n.titulo) + `<section style="padding-top:28px"><div class="wrap"><div class="article"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span class="pill">${esc(newsCat(n))}</span><span class="lbl">${esc(fmtDN(n.publicado_em))}${n.autor ? " · " + esc(n.autor) : ""}</span></div>${n.imagem_url ? img(n.imagem_url, n.titulo, "rink") : ""}${n.credito_foto ? `<p class="credit" style="margin:-18px 0 22px">Foto: ${esc(n.credito_foto)}</p>` : ""}${n.resumo ? `<p><b>${esc(n.resumo)}</b></p>` : ""}<div class="corpo">${para(n.corpo)}</div>${clubs.length ? `<div class="chips" style="margin-top:22px">${clubs.map(c => `<a class="chip" style="display:inline-flex;align-items:center;gap:6px" href="#/clube/${c.id}">${crestC(c, 20)}${esc(clubName(c))}</a>`).join("")}</div>` : ""}<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:24px"><button class="btn o" id="cp">Copiar link</button></div>${sponsor("noticia")}</div></div></section>${more.length ? `<section style="padding-top:0"><div class="wrap">${sh("+", "Mais notícias")}<div class="grid g4">${more.map(nc).join("")}</div></div></section>` : ""}`,
    after: () => { $("#cp").onclick = function () { try { navigator.clipboard.writeText(location.href); this.textContent = "Link copiado ✓"; } catch (e) { } }; } };
}

async function pComp(id, tab) {
  const c = compById(+id) || principal(); if (!c) return { html: hd([], "Sem competições") };
  tab = +tab || 0;
  const P = provaDe(c), seps = separadores(P.comps), sep = seps.find(x => x.comps.some(y => y.id === c.id)) || { id: c.id, comps: [c], label: "" };
  if (ehTaca(sep.comps)) return pTaca(c, P, seps, sep, tab);
  const zchips = zonaChips(seps, sep, tab);
  const [jogos, cls, mk] = await Promise.all([q("jogos", { eq: { competicao_id: c.id }, order: [["jornada", true], ["data", true], ["hora", true]] }), q("classificacao", { eq: { competicao_id: c.id }, order: [["pos", true]] }), q("marcadores", { eq: { competicao_id: c.id }, order: [["pos", true]], limit: 50 })]);
  const base = `#/competicao/${c.id}`;
  const chips = compPicker(c, tab);
  let body = "", after;
  if (tab === 0) {
    body = cls.length ? `<div style="overflow-x:auto"><table class="ctab"><thead><tr><th>#</th><th>Clube</th><th class="c">J</th><th class="c hm">V</th><th class="c hm">E</th><th class="c hm">D</th><th class="c hm">Golos</th><th class="c">DG</th><th class="c">Pts</th><th class="hm">Forma</th></tr></thead><tbody>${cls.map(r => `<tr${zonaAttr(c, r.pos)}><td><span class="pos">${r.pos}</span></td><td style="white-space:nowrap;font-weight:600"><a href="#/clube/${teamKey(r.equipa_id)}">${crest(r.equipa_id)}${esc(tName(r.equipa_id))}</a></td><td class="c num">${r.j}</td><td class="c num hm">${r.v}</td><td class="c num hm">${r.e}</td><td class="c num hm">${r.d}</td><td class="c num hm">${r.gm}:${r.gs}</td><td class="c num">${r.dg > 0 ? "+" : ""}${r.dg}</td><td class="c pts">${r.pts}</td><td class="hm" style="white-space:nowrap">${formaHTML(forma(jogos, r.equipa_id))}</td></tr>`).join("")}</tbody></table></div>${zonasLegenda(c)}` : empty("Esta prova não tem classificação (ou ainda não começou).");
  } else if (tab === 1) {
    const jors = [...new Set(jogos.map(j => j.jornada))].filter(x => x != null).sort((a, b) => a - b);
    let cur = ultimaJornada(jogos);
    body = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:18px"><button class="hbtn circ" id="jp">←</button><span class="x" style="font-size:30px" id="jn"></span><button class="hbtn circ" id="jx">→</button></div><div id="jl"></div>`;
    after = () => { const r = () => { const l = jogos.filter(j => j.jornada === cur); $("#jn").textContent = l[0]?.jornada_nome || ("Jornada " + cur); $("#jl").innerHTML = l.map(j => matchRow(j)).join("") || empty("Sem jogos."); }; $("#jp").onclick = () => { const i = jors.indexOf(cur); if (i > 0) { cur = jors[i - 1]; r(); } }; $("#jx").onclick = () => { const i = jors.indexOf(cur); if (i < jors.length - 1) { cur = jors[i + 1]; r(); } }; r(); };
  } else if (tab === 2) {
    const prox = jogos.filter(j => j.golos_casa == null).sort((a, b) => (a.data || "9").localeCompare(b.data || "9") || (a.hora || "").localeCompare(b.hora || ""));
    body = prox.map(j => matchRow(j)).join("") || empty("Não há jogos por disputar.");
  } else {
    body = mk.length ? `<table><thead><tr><th>#</th><th>Jogador</th><th>Clube</th><th class="c">Golos</th></tr></thead><tbody>${mk.map(m => `<tr class="${m.pos <= 3 ? "q" : ""}"><td><span class="pos">${m.pos}</span></td><td style="font-weight:600"><a href="#/jogador/${m.jogador_id}">${esc(m.nome)}</a></td><td><a href="#/clube/${m.clube_id}">${crestC(B.clubes.get(m.clube_id))}${esc(clubName(B.clubes.get(m.clube_id)))}</a></td><td class="c pts">${m.golos}</td></tr>`).join("")}</tbody></table>` : empty("Ainda sem marcadores.");
  }
  return { html: hd([["Competições"], [P.nome]], P.nome, (sep.label ? sep.label + " · " : "") + "Época 2026/27", ["Classificação", "Jornadas", "Calendário", "Marcadores"], tab, base) + `<section style="padding-top:36px"><div class="wrap">${chips}${zchips}${sponsor("competicao")}${body}<p class="note">Fonte: hp.fpp.pt · atualizado ${esc(c.atualizado_em ? new Date(c.atualizado_em).toLocaleString("pt-PT") : "")}</p></div></section>`, after };
}

const zonaChips = (seps, sep, tab) => seps.length > 1 ? `<div class="zchips" role="tablist">${seps.map(x => `<a class="zchip ${x === sep ? "on" : ""}" href="#/competicao/${x.id}/${tab}">${esc(x.label || x.nome)}</a>`).join("")}</div>` : "";

/* ---------------- taças: quadro (bracket) ---------------- */
const REGIAO = /\s*[-–·]?\s*\b(zona\s+\S+|s[ée]rie\s+\S+|grupo\s+\S+|norte|sul|centro|ilhas|a[çc]ores|madeira)\b.*$/i;
function rondaTam(nome) { // n.º de jogos de uma ronda pelo nome (null = não se sabe, ex.: pré-eliminatória)
  const t = norm(nome || "");
  const f = /1\/(\d+)/.exec(t); if (f) return +f[1];
  if (/oitavos/.test(t)) return 8; if (/quartos/.test(t)) return 4; if (/meia/.test(t)) return 2; if (/final four/.test(t)) return null;
  if (/^\s*final\s*$|grande final/.test(t)) return 1; return null;
}
const RONDA_NOME = { 16: "1/16 de Final", 8: "Oitavos de Final", 4: "Quartos de Final", 2: "Meias-Finais", 1: "Final" };
function quadro(jogos, comps) {
  const ordemComp = new Map(comps.map((c, i) => [c.id, i]));
  const rondas = new Map();
  jogos.slice().sort((a, b) => (ordemComp.get(a.competicao_id) - ordemComp.get(b.competicao_id)) || (a.jornada ?? 0) - (b.jornada ?? 0) || (a.numero ?? 0) - (b.numero ?? 0)).forEach(j => {
    const nome = (j.jornada_nome || "Ronda").replace(REGIAO, "").trim() || j.jornada_nome, k = norm(nome).replace(/[^a-z0-9\/]/g, "");
    if (!rondas.has(k)) rondas.set(k, { nome, tam: rondaTam(nome), jogos: [] });
    rondas.get(k).jogos.push(j);
  });
  const lista = [...rondas.values()];
  // rondas que ainda não existem: completa até à final
  let ult = [...lista].reverse().find(r => r.tam)?.tam;
  const fechado = lista.some(r => r.tam === 1);
  if (!fechado) {
    let tam = ult ? ult / 2 : 8;
    if (!ult && lista.length) { const n = lista[lista.length - 1].jogos.length; tam = n >= 16 ? 16 : n >= 8 ? 8 : n >= 4 ? 4 : n >= 2 ? 2 : 1; if (n >= 8) tam = Math.min(tam, 8); }
    for (; tam >= 1; tam /= 2) lista.push({ nome: RONDA_NOME[tam] || "Ronda", tam, jogos: [], futura: true });
  }
  lista.forEach(r => { if (r.tam && r.jogos.length < r.tam) r.vazios = r.tam - r.jogos.length; });
  const vencedor = j => j.golos_casa == null || j.golos_casa === j.golos_fora ? null : (j.golos_casa > j.golos_fora ? "c" : "f");
  const lado = (j, l) => { const id = l === "c" ? j.casa_id : j.fora_id, g = l === "c" ? j.golos_casa : j.golos_fora, w = vencedor(j);
    return `<div class="bt ${w === l ? "w" : w ? "l" : ""}">${crest(id, 20)}<span class="n">${esc(tName(id))}</span><b>${g ?? ""}</b></div>`; };
  const cartao = j => { const reg = (REGIAO.exec(j.jornada_nome || "") || [""])[0].replace(/^[\s\-–·]+/, "");
    return `<a class="bm" href="#/jogo/${j.id}"><div class="bi"><span>${esc(fmtD(j.data))}${j.hora ? " · " + esc(j.hora) : ""}</span>${reg ? `<span>${esc(reg)}</span>` : ""}</div>${lado(j, "c")}${lado(j, "f")}</a>`; };
  const vazio = `<div class="bm vz"><div class="bt"><span class="crest" style="width:20px;height:20px"></span><span class="n">A definir</span></div><div class="bt"><span class="crest" style="width:20px;height:20px"></span><span class="n">A definir</span></div></div>`;
  return `<div class="bracket-wrap"><div class="bracket">${lista.map((r, i) => `<div class="bcol ${r.futura ? "fut" : ""} ${i === lista.length - 1 ? "last" : ""}"><div class="bh"><span>${esc(r.nome)}</span><small>${r.jogos.length ? r.jogos.length + (r.jogos.length === 1 ? " jogo" : " jogos") : "por sortear"}</small></div><div class="bgames">${r.jogos.map(cartao).join("")}${vazio.repeat(Math.min(r.vazios || 0, 16))}</div></div>`).join("")}</div></div>
    ${fechado ? "" : `<p class="note">As rondas a tracejado ainda não foram sorteadas: aparecem aqui assim que a FPP publicar os jogos.</p>`}`;
}
async function pTaca(c, P, seps, sep, tab) {
  const ids = sep.comps.map(x => x.id);
  const jogos = await q("jogos", { in: { competicao_id: ids }, order: [["jornada", true], ["data", true], ["hora", true]] });
  const base = `#/competicao/${c.id}`;
  let body;
  if (tab === 1) {
    const grupos = new Map();
    jogos.forEach(j => { const k = (j.competicao_id + "|" + (j.jornada_nome || "")); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(j); });
    body = [...grupos.values()].map(l => `<h3 class="x" style="font-size:24px;margin:26px 0 12px">${esc(l[0].jornada_nome || "Jogos")}</h3>${l.map(j => matchRow(j)).join("")}`).join("") || empty("Ainda não há jogos publicados.");
  } else {
    body = quadro(jogos, sep.comps);
  }
  return { html: hd([["Competições"], [P.nome]], P.nome, (sep.label ? sep.label + " · " : "") + "Época 2026/27", ["Quadro", "Jogos"], tab, base) + `<section style="padding-top:36px"><div class="wrap">${compPicker(c, tab)}${zonaChips(seps, sep, tab)}${sponsor("competicao")}${body}<p class="note">Fonte: hp.fpp.pt · atualizado automaticamente.</p></div></section>` };
}

/* ---------------- linha de jogo ---------------- */
const EV = {
  golo: ["⚫️", "Golo"], golo_penalti: ["🥅", "Golo de penálti"], golo_livre: ["🥅", "Golo de livre direto"], autogolo: ["⚫️", "Autogolo"],
  defesa: ["🧱", "Defesa"], desconto: ["⏰", "Time-out"], penalti_falhado: ["❌", "Penálti falhado"], livre_falhado: ["❌", "Livre direto falhado"],
  azul: ["🟦", "Cartão azul"], amarelo: ["🟨", "Cartão amarelo"], vermelho: ["🟥", "Cartão vermelho"], falta: ["", "Falta"]
};
const isGoal = t => t === "golo" || t === "golo_penalti" || t === "golo_livre" || t === "autogolo";
const isCard = t => t === "azul" || t === "amarelo" || t === "vermelho";
const parteN = p => { p = norm(p || ""); if (/prolong/.test(p)) return /2/.test(p) ? 4 : 3; return /2/.test(p) ? 2 : 1; };
const parteNome = n => ["", "1ª Parte", "2ª Parte", "1º Prolongamento", "2º Prolongamento"][n] || "";
/* O relógio do hp.fpp.pt conta para trás (tempo que falta na parte). Convertemos para o minuto do jogo,
   arredondado para cima: 22:04 que faltam na 2ª parte de 25' = 2:56 jogados = 28'. Se numa parte os tempos
   estiverem a subir, assume-se relógio normal. */
function minutos(ev, dur) {
  const porParte = {};
  ev.forEach(e => (porParte[parteN(e.parte)] = porParte[parteN(e.parte)] || []).push(e));
  for (const [pn, lista] of Object.entries(porParte)) {
    const secs = lista.map(e => { const m = /(\d{1,2}):(\d{2})/.exec(e.tempo || ""); return m ? +m[1] * 60 + +m[2] : null; });
    let sobe = 0, desce = 0; for (let i = 1; i < secs.length; i++) if (secs[i] != null && secs[i - 1] != null) secs[i] > secs[i - 1] ? sobe++ : secs[i] < secs[i - 1] ? desce++ : 0;
    const n = +pn, len = n >= 3 ? 5 : dur, off = n === 1 ? 0 : n === 2 ? dur : 2 * dur + (n === 4 ? 5 : 0);
    lista.forEach((e, i) => { const s = secs[i]; if (s == null) { e.min = null; return; } const jogado = sobe > desce ? s : Math.max(0, len * 60 - s); e.min = off + Math.min(len, Math.max(1, Math.ceil(jogado / 60))); e.pn = n; });
  }
  return ev;
}
function linhaDeJogo(j, ev, filtro) {
  let gc = 0, gf = 0, fc = 0, ff = 0, pAnt = 0;
  const final = j.golos_casa != null && j.estado !== "provisorio";
  const linhas = [];
  for (const e of ev) {
    if (e.pn && e.pn !== pAnt) { if (pAnt) linhas.push(`<div class="ldj-sep"><span>${pAnt === 1 ? "Intervalo" : "Fim da " + parteNome(pAnt).toLowerCase()} · ${gc}-${gf}</span></div>`); linhas.push(`<div class="ldj-sep"><span>${parteNome(e.pn)}</span></div>`); pAnt = e.pn; }
    if (isGoal(e.tipo)) (e.lado === "casa" ? gc++ : gf++);
    if (e.tipo === "falta") (e.lado === "casa" ? fc++ : ff++);
    const cat = isGoal(e.tipo) ? "golos" : isCard(e.tipo) ? "cartoes" : e.tipo === "falta" ? "faltas" : "outros";
    if (filtro === "tudo" ? cat === "faltas" : filtro !== cat) continue;
    const [ico, lab] = EV[e.tipo] || ["•", e.tipo];
    const nome = e.jogador ? (e.jogador_id ? `<a href="#/jogador/${e.jogador_id}">${esc(e.jogador)}</a>` : esc(e.jogador)) : "";
    const extra = isGoal(e.tipo) ? `<span class="ldj-sc">${gc}-${gf}</span>` : e.tipo === "falta" ? `<span class="ldj-f ${(e.lado === "casa" ? fc : ff) >= 10 ? "dez" : ""}">${e.lado === "casa" ? fc : ff}.ª</span>` : "";
    const card = `<div class="ldj-ev ${cat} t-${e.tipo}"><span class="ldj-ico">${ico || "·"}</span><div><b>${lab}${extra}</b>${nome ? `<small>${nome}</small>` : `<small>${esc(tName(e.lado === "casa" ? j.casa_id : j.fora_id))}</small>`}</div></div>`;
    linhas.push(`<div class="ldj-row ${e.lado}"><div class="ldj-l">${e.lado === "casa" ? card : ""}</div><div class="ldj-m">${e.min != null ? e.min + "'" : "—"}</div><div class="ldj-r">${e.lado === "fora" ? card : ""}</div></div>`);
  }
  if (final && ev.length) linhas.push(`<div class="ldj-sep fim"><span>Final · ${j.golos_casa}-${j.golos_fora}</span></div>`);
  return linhas.join("") || `<p class="ldj-vazio">Nada para mostrar neste filtro.</p>`;
}

async function pJogo(id) {
  let j = (await q("jogos", { eq: { id: +id } }))[0];
  if (!j && +id < 0) { // jogo futuro (id provisório) que entretanto ganhou ficha no hp.fpp.pt
    const cid = Math.floor(-id / 100000), num = -id % 100000;
    j = (await q("jogos", { eq: { competicao_id: cid, numero: num } }))[0];
    if (j) try { history.replaceState(null, "", "#/jogo/" + j.id); } catch (e) { }
  }
  if (!j) return { html: hd([], "Jogo não encontrado") };
  const c = compById(j.competicao_id), dur = c?.duracao_parte || 25;
  const [ev0, pc, pf] = await Promise.all([q("eventos", { eq: { jogo_id: j.id }, order: [["ordem", true]] }), q("plantel", { eq: { equipa_id: j.casa_id } }), q("plantel", { eq: { equipa_id: j.fora_id } })]);
  const ev = minutos(ev0.map(e => ({ ...e })), dur);
  const goals = ev.filter(e => isGoal(e.tipo));
  const n = (t, l) => ev.filter(e => (Array.isArray(t) ? t.includes(e.tipo) : e.tipo === t) && e.lado === l).length;
  const st = [
    ["Golos", j.golos_casa, j.golos_fora],
    ["Golos de penálti / livre direto", n(["golo_penalti", "golo_livre"], "casa"), n(["golo_penalti", "golo_livre"], "fora")],
    ["Penáltis / livres falhados", n(["penalti_falhado", "livre_falhado"], "casa"), n(["penalti_falhado", "livre_falhado"], "fora")],
    ["Faltas de equipa", j.faltas_casa ?? n("falta", "casa"), j.faltas_fora ?? n("falta", "fora")],
    ["Cartões azuis", n("azul", "casa"), n("azul", "fora")],
    ["Cartões amarelos", n("amarelo", "casa"), n("amarelo", "fora")],
    ["Cartões vermelhos", n("vermelho", "casa"), n("vermelho", "fora")],
    ["Time-outs", n("desconto", "casa"), n("desconto", "fora")]
  ].filter(s => s[1] != null && (s[0] === "Golos" || s[0] === "Faltas de equipa" || +s[1] + +s[2] > 0));
  const big = eid => `<a href="#/clube/${teamKey(eid)}" style="display:block">${crest(eid, 84).replace('class="crest', 'style="margin:0 auto 14px;display:grid" class="crest')}<div class="x">${esc(tName(eid))}</div></a>`;
  const mk = l => { const m = new Map(); goals.filter(g => g.lado === l).forEach(g => { const k = g.jogador_id || g.jogador || "?"; const x = m.get(k) || { nome: g.jogador || "—", n: 0 }; x.n++; m.set(k, x); }); return [...m.values()].map(x => esc(x.nome) + (x.n > 1 ? ` (${x.n})` : "")).join("<br>"); };
  const temEv = ev.length > 0;
  return { html: hd([[cn(c), "#/competicao/" + j.competicao_id], ["Jogo"]], `${tName(j.casa_id)} — ${tName(j.fora_id)}`, `${cn(c)} · ${j.jornada_nome || ""} · ${fmtD(j.data)} ${j.hora || ""}`) + `<section style="padding-top:36px"><div class="wrap">
    <div class="score-hero rink">${big(j.casa_id)}<div><div class="lbl" style="color:#8A857C">${j.golos_casa == null ? esc(fmtD(j.data).toUpperCase()) : j.estado === "provisorio" ? "PROVISÓRIO" : "FINAL"}</div><div class="big">${score(j) || esc(j.hora || "vs")}</div>${j.canal_tv || j.tv_url ? `<a class="lbl" style="color:#FFC94D" href="${esc(j.tv_url || "#/onde-ver")}" target="_blank">▶ ${esc(j.canal_tv || "FPP TV")}</a>` : ""}</div>${big(j.fora_id)}</div>
    ${goals.length ? `<div class="scorers"><div>${mk("casa")}</div><div style="text-align:right">${mk("fora")}</div></div>` : ""}
    ${notifAtivas() ? `<div class="seguir-jogo"><span class="lbl">Recebe o início e o resultado final dos jogos</span><div>${botaoSeguir(teamKey(j.casa_id), tName(j.casa_id))}${botaoSeguir(teamKey(j.fora_id), tName(j.fora_id))}</div></div>` : ""}
    ${sponsor("jogo")}
    <div class="ldj-wrap">
      <div class="ldj-head"><div>${crest(j.casa_id, 34)}<b>${esc(tName(j.casa_id))}</b></div><span class="x">Linha de jogo</span><div><b>${esc(tName(j.fora_id))}</b>${crest(j.fora_id, 34)}</div></div>
      ${temEv ? `<div class="chips ldj-fil">${[["tudo", "Tudo"], ["golos", "Golos"], ["cartoes", "Cartões"], ["outros", "Time-outs e falhados"], ["faltas", "Faltas"]].map((f, i) => `<button class="chip ${i ? "" : "on"}" data-f="${f[0]}">${f[1]}</button>`).join("")}</div><div class="ldj" id="ldj"></div>
      <div class="ldj-leg">${["golo", "golo_penalti", "defesa", "desconto", "penalti_falhado", "azul", "amarelo", "vermelho"].map(t => `<span>${EV[t][0]} ${t === "golo_penalti" ? "Golo de penálti / livre direto" : t === "penalti_falhado" ? "Penálti / livre direto falhado" : EV[t][1]}</span>`).join("")}</div>`
      : empty(j.golos_casa == null ? "O jogo ainda não começou. A linha de jogo aparece aqui durante o jogo." : "Ainda sem registo de acontecimentos deste jogo.")}
    </div>
    <div class="grid g2" style="margin-top:44px;gap:56px">
      <div>${st.length ? `<h3 class="x" style="font-size:30px;margin-bottom:18px">Estatísticas</h3><div class="stats">${st.map(s => { const x = +s[1] || 0, y = +s[2] || 0, p = x + y ? Math.round(x / (x + y) * 100) : 50; return `<div class="row"><span class="lab">${s[0]}</span><span class="v">${s[1] ?? 0}</span><span class="bar"><i style="width:${p}%"></i></span><span class="v r">${s[2] ?? 0}</span></div>`; }).join("")}</div>` : ""}</div>
      <div>${j.arbitros ? `<h3 class="x" style="font-size:30px;margin-bottom:14px">Arbitragem</h3><p>${esc(j.arbitros)}</p>` : ""}${j.nota ? `<div class="box rink-r" style="margin-top:24px">${esc(j.nota)}</div>` : ""}</div>
    </div>${(pc.length || pf.length) ? `<div class="grid g2" style="margin-top:44px;gap:56px">${[[j.casa_id, pc], [j.fora_id, pf]].map(([eid]) => `<div><h3 class="x" style="font-size:24px;margin-bottom:12px">Plantel · ${esc(tName(eid))}</h3><div id="pl-${eid}" class="mini-squad">A carregar…</div></div>`).join("")}</div>` : ""}
    <p class="note">Fonte: hp.fpp.pt · minutos calculados a partir do relógio do jogo (partes de ${dur}').</p></div></section>`,
    after: async () => {
      if (temEv) { const r = f => { $("#ldj").innerHTML = linhaDeJogo(j, ev, f); document.querySelectorAll(".ldj-fil .chip").forEach(b => b.classList.toggle("on", b.dataset.f === f)); }; document.querySelectorAll(".ldj-fil .chip").forEach(b => b.onclick = () => r(b.dataset.f)); r("tudo"); }
      for (const [eid, p] of [[j.casa_id, pc], [j.fora_id, pf]]) { const el = $("#pl-" + eid); if (!el) continue; const js = await players(p); el.innerHTML = js.map(x => `<a href="#/jogador/${x.id}"><b>${esc(pNum(x) ?? "")}</b> ${esc(pName(x))}</a>`).join("") || "<span style='color:var(--ink-2)'>—</span>"; }
    } };
}

/* ---------------- patrocínios e publicidade ---------------- */
const SP_LBL = { inicio: "Patrocinado", jogo: "Patrocinado", noticia: "Patrocinado", competicao: "Patrocinado", equipa_jornada: "Equipa da jornada patrocinada por", rodape: "Parceiros" };
function sponsor(pos) {
  const l = (B.spons || []).filter(s => s.posicao === pos);
  if (!l.length) return adSlot(pos);
  if (pos === "rodape") return `<div class="sp-strip"><span class="lbl">${SP_LBL.rodape}</span>${l.map(s => `<a class="sp-logo" data-sp="${esc(s.id)}" href="${esc(s.link || "#/")}" target="_blank" rel="sponsored noopener" title="${esc(s.texto || s.nome)}">${s.imagem_url ? `<img src="${esc(s.imagem_url)}" alt="${esc(s.texto || s.nome)}">` : esc(s.nome)}</a>`).join("")}</div>`;
  const s = l[Math.floor(Math.random() * l.length)];
  if (pos === "equipa_jornada") return `<a class="sp-ej" data-sp="${esc(s.id)}" href="${esc(s.link || "#/")}" target="_blank" rel="sponsored noopener"><span class="lbl">${SP_LBL.equipa_jornada}</span>${s.imagem_url ? `<img src="${esc(s.imagem_url)}" alt="${esc(s.nome)}">` : `<b>${esc(s.texto || s.nome)}</b>`}</a>`;
  return `<a class="sp-ban" data-sp="${esc(s.id)}" href="${esc(s.link || "#/")}" target="_blank" rel="sponsored noopener"><span class="lbl">${SP_LBL[pos] || "Patrocinado"}</span>${s.imagem_url ? `<img src="${esc(s.imagem_url)}" alt="${esc(s.texto || s.nome)}">` : `<b>${esc(s.texto || s.nome)}</b>`}</a>`;
}
function adSlot(pos) {
  if (!CFG.ADSENSE_CLIENT || !["inicio", "jogo", "noticia", "competicao"].includes(pos)) return "";
  return `<div class="ad-slot"><span class="lbl">Publicidade</span><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(CFG.ADSENSE_CLIENT)}" ${CFG.ADSENSE_SLOT ? `data-ad-slot="${esc(CFG.ADSENSE_SLOT)}"` : ""} data-ad-format="auto" data-full-width-responsive="true"></ins></div>`;
}
function afterSponsors(root) {
  const ids = [...root.querySelectorAll("[data-sp]")].map(a => a.dataset.sp).filter((v, i, a) => a.indexOf(v) === i);
  if (LIVE && ids.length) sb.rpc("registar_patrocinio", { ids, tipo: "vista" }).then(() => { }, () => { });
  root.querySelectorAll("[data-sp]").forEach(a => a.addEventListener("click", () => { if (LIVE) sb.rpc("registar_patrocinio", { ids: [a.dataset.sp], tipo: "clique" }).then(() => { }, () => { }); }));
  root.querySelectorAll("ins.adsbygoogle:not([data-adsbygoogle-status])").forEach(() => { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { } });
}
function loadAdsense() {
  if (!CFG.ADSENSE_CLIENT || document.getElementById("adsjs")) return;
  const s = document.createElement("script"); s.id = "adsjs"; s.async = true; s.crossOrigin = "anonymous";
  s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(CFG.ADSENSE_CLIENT);
  document.head.appendChild(s);
}

/* ---------------- privacidade ---------------- */
const PRIVACIDADE = `**Quem somos.** O Hóquei em Português é um projeto independente sobre hóquei em patins. Os resultados, classificações e plantéis vêm do site público da Federação de Patinagem de Portugal (hp.fpp.pt).

**Que dados recolhemos.** Só os que nos dás: o email, se subscreveres a newsletter, e o nome, email e mensagem, se usares o formulário de contacto. Não pedimos registo para ler o site.

**Para que os usamos.** O email da newsletter serve só para enviar a newsletter. As mensagens servem para te respondermos. Não vendemos nem cedemos estes dados a ninguém.

**Onde ficam guardados.** Numa base de dados na Supabase (servidores na União Europeia ou com garantias equivalentes). O site está alojado na Netlify.

**Cookies e publicidade.** O site guarda no teu navegador apenas preferências como o modo noite. Se mostrarmos publicidade da Google (AdSense), a Google pode usar cookies para mostrar e medir anúncios, só depois de dares consentimento na mensagem que aparece ao entrar. Podes mudar a tua escolha a qualquer momento em “Gerir cookies”, no fundo da página. Mais informação: [policies.google.com/technologies/ads](https://policies.google.com/technologies/ads).

**Notificações.** Se seguires uma equipa, o teu navegador cria um endereço anónimo de notificações, que guardamos junto com as equipas que escolheste. Não guardamos nome nem email. Para deixar de receber, carrega outra vez em “A seguir” ou desliga as notificações nas definições do telemóvel; o endereço é apagado.

**Patrocinadores.** Os banners de patrocinadores são imagens nossas; contamos apenas quantas vezes são vistos e clicados, sem identificar quem.

**Os teus direitos (RGPD).** Podes pedir para ver, corrigir ou apagar os teus dados, ou cancelar a newsletter a qualquer momento, através do formulário de contacto. Também podes apresentar queixa à CNPD (cnpd.pt).`;
async function pPrivacidade() {
  const t = B.defs.privacidade?.texto || PRIVACIDADE;
  return { html: hd([["Privacidade"]], "Privacidade e cookies") + `<section style="padding-top:36px"><div class="wrap"><div class="article">${para(t)}<p class="note">Última atualização: ${esc(B.defs.privacidade?.atualizado || "novembro de 2026")}</p></div></div></section>` };
}
function gerirCookies() {
  try { if (window.googlefc && window.googlefc.showRevocationMessage) { window.googlefc.showRevocationMessage(); return; } } catch (e) { }
  go("/privacidade");
}

async function players(plantel) {
  if (!plantel.length) return [];
  const js = await q("jogadores", { in: { id: plantel.map(p => p.jogador_id) }, eq: { visivel: true } });
  const g = Object.fromEntries(plantel.map(p => [p.jogador_id, p.golos]));
  return js.map(p => ({ ...p, golos: g[p.id] || 0 })).sort((a, b) => (pNum(a) ?? 999) - (pNum(b) ?? 999) || pName(a).localeCompare(pName(b)));
}

async function pClubes() {
  const ativos = new Set(B.comps.map(c => c.id));
  const grupos = new Map();
  for (const e of B.equipas.values()) {
    if (!ativos.has(e.competicao_id)) continue;
    const k = teamKey(e.id); if (!k) continue;
    const g = grupos.get(k) || { k, eid: e.id, comps: [] }; g.comps.push(compById(e.competicao_id)); grupos.set(k, g);
  }
  const l = [...grupos.values()].map(g => ({ ...g, nome: teamLabel(g.eid), c: clubOfTeam(g.eid) })).sort((a, b) => a.nome.localeCompare(b.nome));
  return { html: hd([["Clubes"]], "Clubes e equipas", "Plantéis, jogos e notícias de cada equipa.") + `<section style="padding-top:36px"><div class="wrap"><div class="tools"><input class="input" id="cq" placeholder="Procurar equipa ou cidade"></div><div class="clubgrid">${l.map(g => `<a class="club" href="#/clube/${g.k}">${crest(g.eid, 62).replace('class="crest', 'class="cr crest')}<div><h3>${esc(g.nome)}</h3><small>${esc([(g.c?.cidade || ""), cn(g.comps.sort((x, y) => (x.ordem ?? 100) - (y.ordem ?? 100))[0])].filter(Boolean).join(" · ").toUpperCase())}</small></div></a>`).join("") || empty("Ainda sem equipas. O robô preenche esta lista na primeira execução.")}</div></div></section>`,
    after: () => { $("#cq").oninput = e => document.querySelectorAll(".club").forEach(c => c.style.display = norm(c.textContent).includes(norm(e.target.value)) ? "" : "none"); } };
}
async function pClube(id, tab) {
  const chave = String(id || "");
  const eqs = eqsDaChave(chave).filter(e => compById(e.competicao_id)).sort((a, b) => (compById(a.competicao_id).ordem - compById(b.competicao_id).ordem));
  const c = eqs.length ? (clubOfTeam(eqs[0].id) || { id: null, nome: eqs[0].nome }) : B.clubes.get(+chave);
  if (!c) return { html: hd([["Clubes", "#/clubes"]], "Equipa não encontrada") };
  const nomeEq = eqs.length ? teamLabel(eqs[0].id) : clubName(c);
  const outras = c.id ? [...new Set([...B.equipas.values()].filter(e => e.clube_id === c.id && compById(e.competicao_id)).map(e => teamKey(e.id)))].filter(k => k !== chave) : [];
  tab = +tab || 0;
  const eids = eqs.map(e => e.id);
  let body = "", after;
  if (tab === 0) {
    const [cls, jogos] = await Promise.all([eids.length ? q("classificacao", { in: { equipa_id: eids } }) : [], eids.length ? q("jogos", { in: { casa_id: eids }, order: [["data", true]] }) : []]);
    const jf = eids.length ? await q("jogos", { in: { fora_id: eids }, order: [["data", true]] }) : [];
    const all = [...jogos, ...jf].sort((a, b) => (a.data || "").localeCompare(b.data || ""));
    const next = all.find(j => j.golos_casa == null), last = all.filter(j => j.golos_casa != null).slice(-5).reverse();
    body = `${c.descricao ? `<div class="box rink-r" style="margin-bottom:30px">${para(c.descricao)}</div>` : ""}<div class="grid g4" style="margin-bottom:36px">${cls.map(r => `<a class="box rink-r" href="#/competicao/${r.competicao_id}"><span class="lbl">${esc(cn(compById(r.competicao_id)))}</span><div class="x" style="font-size:40px;margin-top:8px;color:var(--red)">${r.pos}º</div><p style="color:var(--ink-2)">${r.pts} pts · ${r.v}V ${r.e}E ${r.d}D · ${r.gm}:${r.gs}</p></a>`).join("")}${c.pavilhao || c.cidade ? `<div class="box rink-r"><span class="lbl">Casa</span><h3 style="margin-top:8px">${esc(c.pavilhao || c.cidade)}</h3><p style="color:var(--ink-2)">${esc(c.pavilhao ? c.cidade || "" : "")}</p></div>` : ""}${c.instagram ? `<a class="box rink-r" href="https://www.instagram.com/${esc(c.instagram.replace("@", ""))}/" target="_blank"><span class="lbl">Instagram</span><h3 style="margin-top:8px">@${esc(c.instagram.replace("@", ""))} ↗</h3></a>` : ""}</div>
    ${next ? `<h3 class="x" style="font-size:28px;margin-bottom:12px">Próximo jogo</h3>${matchRow(next)}` : ""}${last.length ? `<h3 class="x" style="font-size:28px;margin:30px 0 12px">Últimos jogos</h3>${last.map(j => matchRow(j)).join("")}` : ""}`;
  } else if (tab === 1) {
    const pl = eids.length ? await q("plantel", { in: { equipa_id: eids } }) : [];
    const uniq = Object.values(Object.fromEntries(pl.map(p => [p.jogador_id, p])));
    const [js, tec] = await Promise.all([players(uniq), eids.length ? q("tecnicos", { in: { equipa_id: eids } }) : []]);
    const tecU = Object.values(Object.fromEntries(tec.map(t => [t.nome, t])));
    body = (js.length ? `<div class="squad">${js.map(p => `<a class="pl" href="#/jogador/${p.id}">${pFoto(p) ? `<img class="ph" src="${esc(pFoto(p))}" alt="" loading="lazy" onerror="this.remove()">` : ""}<span class="nr">${esc(pNum(p) ?? "")}</span><div><b>${esc(pName(p))}</b><small>${esc(p.posicao || "")}${p.golos ? (p.posicao ? " · " : "") + p.golos + (p.golos === 1 ? " golo" : " golos") : ""}</small></div></a>`).join("")}</div>` : empty("O plantel aparece depois da primeira atualização diária do robô.")) +
      (tecU.length ? `<h3 class="x" style="font-size:24px;margin:30px 0 10px">Equipa técnica</h3><div class="squad">${tecU.map(t => `<div class="pl"><span class="nr">—</span><div><b>${esc(t.nome)}</b><small>${esc(t.funcao)}</small></div></div>`).join("")}</div>` : "");
  } else if (tab === 2) {
    const [a, b] = eids.length ? await Promise.all([q("jogos", { in: { casa_id: eids } }), q("jogos", { in: { fora_id: eids } })]) : [[], []];
    body = [...a, ...b].sort((x, y) => (x.data || "9").localeCompare(y.data || "9")).map(j => matchRow(j)).join("") || empty("Sem jogos.");
  } else {
    const [m1, m2] = c.id ? await Promise.all([q("mercado", { eq: { para_clube: c.id } }), q("mercado", { eq: { de_clube: c.id } })]) : [[], []];
    const all = Object.values(Object.fromEntries([...m1, ...m2].map(m => [m.id, m]))).sort((a, b) => (b.data || "").localeCompare(a.data || ""));
    const news = (await q("noticias", { order: [["publicado_em", false]], limit: 60 })).filter(n => (n.clubes || []).includes(c.id));
    body = (all.map(trRow).join("") || empty("Sem movimentos de mercado.")) + (news.length ? `<div style="margin-top:36px">${sh("+", "Notícias")}<div class="grid g4">${news.slice(0, 8).map(nc).join("")}</div></div>` : "");
  }
  return { html: `<div class="phd">${RINK}<div class="wrap" style="position:relative"><div class="crumbs"><a href="#/">Início</a> / <a href="#/clubes">Clubes</a> / ${esc(nomeEq)}</div><div class="clubhero">${crestC(c, 120, "cr")}<div><h1 class="x">${esc(nomeEq)}</h1><p>${esc([c.cidade, ...new Set(eqs.map(e => cn(compById(e.competicao_id))))].filter(Boolean).join(" · "))}</p>${botaoSeguir(chave, nomeEq)}${outras.length ? `<p style="margin-top:8px">${outras.map(k => `<a class="chip" style="display:inline-flex;margin-right:6px" href="#/clube/${k}">${esc(teamLabel(eqsDaChave(k)[0]?.id))} →</a>`).join("")}</p>` : ""}</div></div><div class="tabs">${["Resumo", "Plantel", "Jogos", "Mercado e notícias"].map((x, k) => `<a class="tb ${k === tab ? "on" : ""}" href="#/clube/${chave}/${k}">${x}</a>`).join("")}</div></div></div><section style="padding-top:36px"><div class="wrap">${body}</div></section>`, after };
}
async function pJogador(id) {
  const p = (await q("jogadores", { eq: { id: +id } }))[0];
  if (!p || !p.visivel) return { html: hd([["Clubes", "#/clubes"]], "Jogador não encontrado") };
  const [pl, mk] = await Promise.all([q("plantel", { eq: { jogador_id: p.id } }), q("marcadores", { eq: { jogador_id: p.id } })]);
  const eq = pl.map(x => B.equipas.get(x.equipa_id)).filter(Boolean);
  const c = B.clubes.get(eq[0]?.clube_id);
  const idade = p.data_nascimento ? Math.floor((Date.now() - new Date(p.data_nascimento)) / 3.15576e10) : null;
  return { html: hd([["Clubes", "#/clubes"], ...(c ? [[clubName(c), "#/clube/" + c.id]] : []), [pName(p)]], pName(p), [p.posicao, c && clubName(c)].filter(Boolean).join(" · ")) + `<section style="padding-top:36px"><div class="wrap grid g2 jog-grid">
    <div>${pFoto(p) ? img(pFoto(p), pName(p), "rink").replace('class="imgbox', 'style="aspect-ratio:3/4" class="imgbox') : `<div class="imgbox err rink" style="aspect-ratio:3/4"></div>`}</div>
    <div><div class="grid g3" style="margin-bottom:28px">${[["Número", pNum(p) ?? "—"], ["Posição", p.posicao || "—"], ["Golos", mk.reduce((s, m) => s + (m.golos || 0), 0) || pl.reduce((s, x) => s + (x.golos || 0), 0)], ...(p.nacionalidade ? [["Nacionalidade", p.nacionalidade]] : []), ...(idade ? [["Idade", idade + " anos"]] : [])].map(s => `<div class="box rink-r"><span class="lbl">${s[0]}</span><div class="x" style="font-size:30px;margin-top:8px;color:var(--red)">${esc(s[1])}</div></div>`).join("")}</div>
    ${p.bio ? `<div class="article">${para(p.bio)}</div>` : ""}${eq.length ? `<h3 class="x" style="font-size:24px;margin:20px 0 10px">Equipas</h3>${eq.map(e => `<a class="doc" href="#/clube/${teamKey(e.id)}"><span class="d">${esc(cn(compById(e.competicao_id)))}</span><b>${esc(tName(e.id))}</b><span></span></a>`).join("")}` : ""}</div></div></section>` };
}

async function pMercado() {
  const m = await q("mercado", { order: [["data", false]], limit: 300 });
  return { html: hd([["Mercado"]], "Mercado", "Contratações, renovações e empréstimos da época 2026/27.") + `<section style="padding-top:36px"><div class="wrap"><div class="chips" id="mch">${["Todos", "Contratação", "Renovação", "Empréstimo", "Saída"].map((k, i) => `<button class="chip ${i ? "" : "on"}" data-k="${k}">${k}</button>`).join("")}</div><div id="ml"></div></div></section>`,
    after: () => { const r = k => { $("#ml").innerHTML = m.filter(x => k === "Todos" || x.tipo === k).map(trRow).join("") || empty("Sem movimentos."); document.querySelectorAll("#mch .chip").forEach(b => b.classList.toggle("on", b.dataset.k === k)); }; document.querySelectorAll("#mch .chip").forEach(b => b.onclick = () => r(b.dataset.k)); r("Todos"); } };
}
async function pTV() {
  const js = (await q("jogos", { gte: { data: today() }, order: [["data", true], ["hora", true]], limit: 120 })).filter(j => compById(j.competicao_id));
  const com = js.filter(j => j.canal_tv || j.tv_url);
  return { html: hd([["Onde ver"]], "Onde ver", "Os próximos jogos e onde dão: televisão e streaming.") + `<section style="padding-top:36px"><div class="wrap">${com.map(tvRow).join("") || empty("Ainda não há transmissões anunciadas.")}<p class="note">Os jogos marcados “FPP TV” são transmitidos em tv.fpp.pt.</p></div></section>` };
}
async function pEDJ() {
  const ej = await q("equipa_jornada", { order: [["criado_em", false]], limit: 10 });
  if (!ej.length) return { html: hd([["Equipa da Jornada"]], "Equipa da Jornada") + `<section><div class="wrap">${empty("Ainda não foi publicada nenhuma equipa da jornada.")}</div></section>` };
  const e = ej[0];
  return { html: hd([["Equipa da Jornada"]], e.titulo || "Equipa da Jornada", `${cn(compById(e.competicao_id))}${e.jornada ? " · Jornada " + e.jornada : ""}`) + `<section style="padding-top:36px"><div class="wrap">${rinkTeam(e)}${sponsor("equipa_jornada")}<div class="grid g3" style="margin-top:28px">${(e.jogadores || []).map(p => `<div class="box rink-r"><span class="lbl">${esc(p.posicao || "")}</span><h3 style="margin-top:6px">${esc(p.nome)}</h3><p style="color:var(--ink-2)">${esc(clubName(B.clubes.get(+p.clube_id)))}${p.nota ? " · " + esc(p.nota) : ""}</p></div>`).join("")}${e.treinador ? `<div class="box rink-r" style="background:var(--red);color:#fff;border-color:var(--red)"><span class="lbl" style="color:#fff;opacity:.7">Treinador da jornada</span><h3 style="margin-top:6px">${esc(e.treinador)}</h3><p style="opacity:.85">${esc(clubName(B.clubes.get(+e.treinador_clube)))}</p></div>` : ""}</div>
    ${ej.length > 1 ? `<div style="margin-top:44px">${sh("+", "Anteriores")}${ej.slice(1).map(x => `<div class="doc"><span class="d">${esc(fmtD((x.criado_em || "").slice(0, 10)))}</span><b>${esc(x.titulo || "Jornada " + x.jornada)}</b><span>${(x.jogadores || []).map(p => esc(p.nome)).join(", ")}</span></div>`).join("")}</div>` : ""}</div></section>` };
}
async function pSelecoes() {
  const t = B.defs.selecoes?.texto;
  const news = (await q("noticias", { order: [["publicado_em", false]], limit: 60 })).filter(n => /sele/i.test(n.categoria || ""));
  return { html: hd([["Seleções"]], "Seleções Nacionais", "Portugal no hóquei em patins.") + `<section style="padding-top:36px"><div class="wrap">${t ? `<div class="article" style="margin-bottom:30px">${para(t)}</div>` : ""}${news.length ? `<div class="grid g4">${news.map(nc).join("")}</div>` : empty("As notícias com a categoria “Seleções” aparecem aqui.")}</div></section>` };
}
async function pSobre() {
  const t = B.defs.sobre?.texto || "O hóquei em patins português, jornada a jornada.";
  return { html: hd([["Sobre"]], "Sobre nós") + `<section style="padding-top:36px"><div class="wrap grid g2" style="gap:56px"><div><div class="article">${para(t)}</div><div class="grid" style="gap:16px;margin-top:20px">${[["Envia a tua notícia", "Clube, associação ou atleta? Manda-nos resultados, fotos e histórias."], ["Parcerias e publicidade", "Fala connosco para chegar aos adeptos de hóquei em patins."], ["Instagram", "@" + (CFG.INSTAGRAM || "hoqueiemportugues")]].map(b => `<div class="box rink-r"><h3>${esc(b[0])}</h3><p style="color:var(--ink-2)">${esc(b[1])}</p></div>`).join("")}</div></div>
    <form class="box rink grid" style="gap:12px;align-content:start" id="ctf"><h3>Fala connosco</h3><input class="input" name="nome" placeholder="Nome" required><input class="input" type="email" name="email" placeholder="Email" required><select class="input" name="assunto"><option>Enviar notícia</option><option>Parceria / publicidade</option><option>Correção</option><option>Outro</option></select><textarea class="input" name="mensagem" placeholder="Mensagem" required></textarea><button class="btn">Enviar</button></form></div></section>`,
    after: () => { const f = $("#ctf"); f.onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(f)); const { error } = await ins("mensagens", d); f.innerHTML = error ? "<h3>Não foi possível enviar. Tenta mais tarde.</h3>" : "<h3>Recebido. Obrigado!</h3><p style=color:var(--ink-2)>Respondemos o mais rápido possível.</p>"; }; } };
}

/* ---------------- router ---------------- */
let cur = null;
async function go(path) {
  cur = path || "/";
  try { if (location.hash !== "#" + cur) history.replaceState(null, "", "#" + cur); } catch (e) { }
  const p = cur.replace(/^\//, "").split("/").map(decodeURIComponent);
  const R = { "": pHome, noticias: pNoticias, noticia: pNoticia, competicao: pComp, jogo: pJogo, clubes: pClubes, clube: pClube, jogador: pJogador, mercado: pMercado, "onde-ver": pTV, "equipa-da-jornada": pEDJ, selecoes: pSelecoes, sobre: pSobre, privacidade: pPrivacidade, notificacoes: pSeguir };
  const top = { competicao: "comp", jogo: "comp", noticias: "news", noticia: "news", clubes: "clubs", clube: "clubs", jogador: "clubs", mercado: "mkt", "onde-ver": "tv" }[p[0]] || "";
  closeMenu();
  $("#app").innerHTML = `<div class="wrap" style="padding:80px 28px"><span class="lbl">A carregar…</span></div>`;
  try {
    const r = await (R[p[0]] || pHome)(p[1], p[2]);
    if (cur !== (path || "/")) return; // utilizador já navegou para outra página
    $("#app").innerHTML = r.html; r.after && r.after(); afterSponsors($("#app")); if (!/^\/notificacoes/.test(cur)) ligarSeguir($("#app"));
  } catch (e) { console.error(e); $("#app").innerHTML = `<div class="wrap" style="padding:80px 28px">${empty("Ocorreu um erro a carregar esta página.")}</div>`; }
  document.querySelectorAll("#quick a, .tabbar a").forEach(a => a.classList.toggle("on", a.dataset.k === (top || (p[0] === "" ? "home" : ""))));
  window.scrollTo(0, 0);
}
document.addEventListener("click", e => { const a = e.target.closest("a"); if (!a) return; const h = a.getAttribute("href"); if (h === "#/instalar") { e.preventDefault(); instalarApp(); return; } if (h && h.startsWith("#/")) { e.preventDefault(); go(h.slice(1)); } });
window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (h && h !== cur) go(h); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });

/* ---------------- tema e arranque ---------------- */
function setTheme(t) { document.documentElement.dataset.theme = t; $("#themeBtn").textContent = t === "dark" ? "☀" : "☾"; try { localStorage.setItem("hp-theme", t); } catch (e) { } }
(async function init() {
  let th = "light"; try { th = localStorage.getItem("hp-theme") || "light"; } catch (e) { }
  setTheme(th);
  $("#themeBtn").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  $("#menuBtn").onclick = openMenu; $("#menuClose").onclick = closeMenu; $("#tabMenu").onclick = openMenu;
  let t; $("#q").oninput = e => { clearTimeout(t); t = setTimeout(() => search(e.target.value), 250); };
  if (!LIVE) $("#demo").style.display = "block";
  await loadBase();
  buildMenu(); board(); loadAdsense();
  $("#spBar").innerHTML = sponsor("rodape"); afterSponsors($("#spBar"));
  $("#gerirCookies").onclick = e => { e.preventDefault(); gerirCookies(); };
  go(location.hash.slice(1) || "/");
  // atualiza o placar e a página do jogo de 2 em 2 minutos (o robô corre de 10 em 10)
  setInterval(() => { cache.clear(); board(); if (/^\/jogo\//.test(cur || "")) go(cur); }, 120000);
})();

/* ---------------- app instalável e notificações ---------------- */
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSuportado = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const notifAtivas = () => !!CFG.VAPID_PUBLIC_KEY;
let pedidoInstalar = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); pedidoInstalar = e; });
const seguidas = () => { try { return JSON.parse(localStorage.getItem("hp-seguir") || "[]"); } catch (e) { return []; } };
const guardarSeguidas = l => { try { localStorage.setItem("hp-seguir", JSON.stringify(l)); } catch (e) { } };
const b64u8 = s => { const p = "=".repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); };
function toast(msg) { let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); } t.textContent = msg; t.className = "show"; clearTimeout(t._t); t._t = setTimeout(() => t.className = "", 3500); }
function modal(titulo, html) {
  let m = $("#modal"); if (!m) { m = document.createElement("div"); m.id = "modal"; document.body.appendChild(m); m.onclick = e => { if (e.target === m || e.target.closest("[data-fechar]")) m.classList.remove("open"); }; }
  m.innerHTML = `<div class="mbox rink"><h3 class="x">${titulo}</h3>${html}<button class="btn" data-fechar style="margin-top:18px">Percebi</button></div>`; m.classList.add("open");
}
const instrIOS = (o) => `<p>No iPhone, as notificações só funcionam com a app instalada:</p><ol class="passos"><li>Abre este site no <b>Safari</b>.</li><li>Carrega em <b>Partilhar</b> <span class="ico-share">⬆︎</span> (em baixo).</li><li>Escolhe <b>Adicionar ao ecrã principal</b>.</li><li>Abre a app <b>Hóquei em Português</b> no ecrã principal${o ? " e carrega outra vez em 🔔 Seguir" : ""}.</li></ol>`;
async function instalarApp() {
  closeMenu();
  if (standalone()) return modal("Já tens a app 🎉", "<p>Estás a usar o Hóquei em Português como app.</p>");
  if (pedidoInstalar) { pedidoInstalar.prompt(); const r = await pedidoInstalar.userChoice; pedidoInstalar = null; if (r.outcome === "accepted") toast("App instalada ✓"); return; }
  if (isIOS) return modal("Instalar a app", instrIOS(false));
  modal("Instalar a app", "<p>Abre o menu do navegador (⋮) e escolhe <b>Instalar app</b> ou <b>Adicionar ao ecrã principal</b>.</p>");
}
function botaoSeguir(key, nome) {
  if (!notifAtivas() || !key) return "";
  const on = seguidas().includes(key);
  return `<button class="seguir ${on ? "on" : ""}" data-seguir="${esc(key)}" data-nome="${esc(nome)}">${on ? "🔔 A seguir ✓" : "🔔 Seguir " + esc(nome)}</button>`;
}
function ligarSeguir(root) {
  root.querySelectorAll("[data-seguir]").forEach(b => b.onclick = () => alternarSeguir(b.dataset.seguir, b.dataset.nome));
}
function atualizarBotoes() {
  const l = seguidas();
  document.querySelectorAll("[data-seguir]").forEach(b => { const on = l.includes(b.dataset.seguir); b.classList.toggle("on", on); b.textContent = on ? "🔔 A seguir ✓" : "🔔 Seguir " + b.dataset.nome; });
}
async function subscricao() {
  const reg = await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u8(CFG.VAPID_PUBLIC_KEY) });
}
async function guardarEquipas(l) {
  const sub = await subscricao(), j = sub.toJSON();
  const { error } = await sb.rpc("subscrever", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_equipas: l });
  if (error) throw error;
  if (!l.length) await sub.unsubscribe();
}
async function alternarSeguir(key, nome) {
  if (!LIVE) return modal("Modo demonstração", "<p>As notificações funcionam quando o site estiver ligado ao Supabase.</p>");
  if (isIOS && !standalone()) return modal("🔔 Avisos de " + esc(nome), instrIOS(true));
  if (!pushSuportado()) return modal("Sem notificações", "<p>Este navegador não suporta notificações. Experimenta o Chrome (Android/computador) ou instala a app no iPhone.</p>");
  const l = seguidas(), on = l.includes(key);
  if (!on) {
    const p = await Notification.requestPermission();
    if (p !== "granted") return modal("Notificações bloqueadas", "<p>Para receberes os avisos, permite as notificações deste site nas definições do navegador (ícone do cadeado ao lado do endereço) e tenta outra vez.</p>");
  }
  const nova = on ? l.filter(x => x !== key) : [...l, key];
  try {
    await guardarEquipas(nova); guardarSeguidas(nova); atualizarBotoes();
    toast(on ? "Deixaste de seguir " + nome : "Vais receber o início e o resultado final dos jogos de " + nome + " 🔔");
  } catch (e) { console.error(e); modal("Não foi possível", "<p>Ocorreu um erro a ativar as notificações. Tenta outra vez mais tarde.</p>"); }
}
async function pSeguir() {
  const l = seguidas();
  const linha = k => { const e = eqsDaChave(k)[0]; return e ? `<div class="doc"><span class="d">🔔</span><b><a href="#/clube/${esc(k)}">${esc(teamLabel(e.id))}</a></b><button class="chip" data-seguir="${esc(k)}" data-nome="${esc(teamLabel(e.id))}">Deixar de seguir</button></div>` : ""; };
  return { html: hd([["Notificações"]], "Notificações", "Recebe um aviso quando um jogo das tuas equipas começa e quando termina, com o resultado final.") + `<section style="padding-top:36px"><div class="wrap article">
    ${!notifAtivas() ? empty("As notificações ainda não estão ativas neste site.") : l.length ? `<div class="docs">${l.map(linha).join("")}</div>` : empty("Ainda não segues nenhuma equipa. Abre a página de uma equipa ou de um jogo e carrega em 🔔 Seguir.")}
    <h3 class="x" style="font-size:24px;margin:34px 0 10px">Como funciona</h3>
    <p>🏒 <b>Início do jogo</b>: avisamos quando o jogo começa, e que vais receber o resultado final.</p><p>🏁 <b>Resultado final</b>: o resultado, quando o jogo termina.</p>
    <p class="note">Os resultados vêm do hp.fpp.pt e são atualizados de 10 em 10 minutos, por isso os avisos podem chegar alguns minutos depois. Não precisas de conta: as escolhas ficam guardadas neste aparelho.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px"><button class="btn" id="instalar">📲 Instalar a app</button></div></div></section>`,
    after: () => { $("#instalar").onclick = instalarApp; document.querySelectorAll("[data-seguir]").forEach(b => b.onclick = async () => { await alternarSeguir(b.dataset.seguir, b.dataset.nome); go("/notificacoes"); }); } };
}
if ("serviceWorker" in navigator && (location.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => { }));
