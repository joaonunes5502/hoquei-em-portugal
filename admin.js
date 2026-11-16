/* =====================================================================
   HÓQUEI EM PORTUGUÊS — BACKOFFICE
   ===================================================================== */
const CFG = window.HP_CONFIG || {};
const LIVE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const clean = n => String(n || "").split(/\s*\/\s*/)[0].trim().replace(/\s+SAD$/i, "").replace(/\s*["“”']([A-D])["“”']\s*$/, " $1").trim();
const slugify = s => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
function toast(msg, bad) { const t = $("#toast"); t.textContent = msg; t.className = "show" + (bad ? " bad" : ""); clearTimeout(t._t); t._t = setTimeout(() => t.className = "", 3200); }

/* ---------- cliente: Supabase real ou simulador em memória (modo demonstração) ---------- */
function fakeClient(data) {
  const T = n => (data[n] = data[n] || []);
  const pk = { classificacao: ["competicao_id", "equipa_id"], plantel: ["equipa_id", "jogador_id"], tecnicos: ["equipa_id", "nome"], marcadores: ["competicao_id", "jogador_id"], definicoes: ["chave"], newsletter: ["email"] };
  const same = (t, a, b) => (pk[t] || ["id"]).every(k => a[k] === b[k]);
  return {
    auth: { async getSession() { return { data: { session: sessionStorage.demo ? { user: { email: "demo@hoquei.pt" } } : null } }; },
      async signInWithPassword() { sessionStorage.demo = 1; return { data: {}, error: null }; },
      async signOut() { delete sessionStorage.demo; }, async resetPasswordForEmail() { return { error: null }; } },
    storage: { from() { return { async upload() { return { error: { message: "Em modo demonstração não há upload. Cola um link de imagem." } }; }, getPublicUrl() { return { data: { publicUrl: "" } }; } }; } },
    from(t) {
      const f = []; let ord = [], lim, op = "select", payload;
      const run = () => {
        let rows = T(t).filter(r => f.every(fn => fn(r)));
        if (op === "select") {
          for (const [k, asc] of ord.slice().reverse()) rows = rows.slice().sort((a, b) => (a[k] ?? "") > (b[k] ?? "") ? (asc ? 1 : -1) : (a[k] ?? "") < (b[k] ?? "") ? (asc ? -1 : 1) : 0);
          if (lim) rows = rows.slice(0, lim);
          return { data: JSON.parse(JSON.stringify(rows)), error: null };
        }
        if (op === "update") { rows.forEach(r => Object.assign(r, payload)); return { data: rows, error: null }; }
        if (op === "delete") { data[t] = T(t).filter(r => !rows.includes(r)); return { error: null }; }
        const list = Array.isArray(payload) ? payload : [payload];
        for (const r of list) {
          const row = { ...r }; if (!(pk[t]) && row.id == null) row.id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
          const ex = T(t).find(x => same(t, x, row));
          if (ex && op === "insert") return { error: { message: "duplicate key" } };
          ex ? Object.assign(ex, row) : T(t).push(row);
        }
        return { data: list, error: null };
      };
      const b = {
        select() { return b; }, eq(k, v) { f.push(r => r[k] === v); return b; }, in(k, v) { f.push(r => v.includes(r[k])); return b; },
        ilike(k, v) { const x = norm(v.replace(/%/g, "")); f.push(r => norm(r[k]).includes(x)); return b; }, or() { return b; },
        order(k, o) { ord.push([k, o?.ascending !== false]); return b; }, limit(n) { lim = n; return b; },
        insert(p) { op = "insert"; payload = p; return b; }, upsert(p) { op = "upsert"; payload = p; return b; }, update(p) { op = "update"; payload = p; return b; }, delete() { op = "delete"; return b; },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); }
      };
      return b;
    }
  };
}
const SB_URL = (String(CFG.SUPABASE_URL || "").trim().match(/^https?:\/\/[^/]+/) || [""])[0];
const sb = LIVE ? window.supabase.createClient(SB_URL, CFG.SUPABASE_ANON_KEY) : fakeClient(JSON.parse(JSON.stringify(window.HP_DEMO || {})));

async function all(table, mod = x => x) { const { data, error } = await mod(sb.from(table).select("*")); if (error) { toast(error.message, 1); return []; } return data || []; }
async function save(table, row, conflict) {
  const { error } = conflict ? await sb.from(table).upsert(row, { onConflict: conflict }) : row.id && !String(row.id).startsWith("new") ? await sb.from(table).update(row).eq("id", row.id) : await sb.from(table).insert(clearNew(row));
  if (error) { toast("Erro: " + error.message, 1); return false; } toast("Guardado ✓"); return true;
}
const clearNew = r => { const x = { ...r }; if (String(x.id).startsWith("new")) delete x.id; return x; };
async function del(table, col, val) { const { error } = await sb.from(table).delete().eq(col, val); if (error) { toast("Erro: " + error.message, 1); return false; } toast("Apagado"); return true; }
async function upload(file) {
  const path = `${new Date().toISOString().slice(0, 7)}/${Date.now()}-${slugify(file.name.replace(/\.[^.]+$/, ""))}.${file.name.split(".").pop().toLowerCase()}`;
  const { error } = await sb.storage.from("imagens").upload(path, file, { upsert: true, cacheControl: "31536000" });
  if (error) { toast(error.message, 1); return null; }
  return sb.storage.from("imagens").getPublicUrl(path).data.publicUrl;
}

/* ---------- dados de apoio ---------- */
const D = { comps: [], clubes: [], equipas: [] };
async function loadSupport() {
  [D.comps, D.clubes, D.equipas] = await Promise.all([all("competicoes", x => x.order("ordem").order("id")), all("clubes"), all("equipas")]);
  D.clubes.sort((a, b) => clubName(a).localeCompare(clubName(b)));
}
const clubName = c => c ? (c.nome_curto || clean(c.nome).replace(/\s[B-D]$/, "")) : "—";
const club = id => D.clubes.find(c => c.id === +id);
const comp = id => D.comps.find(c => c.id === +id);
const cn = c => c ? (c.nome_curto || c.nome) : "—";
const teamName = eid => { const e = D.equipas.find(x => x.id === eid); if (!e) return "—"; const c = club(e.clube_id), s = (clean(e.nome).match(/\s([B-D])$/) || [])[1]; return c?.nome_curto ? c.nome_curto + (s ? " " + s : "") : clean(e.nome); };
const optClubes = (sel, empty = true) => (empty ? `<option value="">—</option>` : "") + D.clubes.map(c => `<option value="${c.id}" ${+sel === c.id ? "selected" : ""}>${esc(clubName(c))}</option>`).join("");
const optComps = (sel, empty = true) => (empty ? `<option value="">—</option>` : "") + D.comps.map(c => `<option value="${c.id}" ${+sel === c.id ? "selected" : ""}>${esc(cn(c))}</option>`).join("");

/* ---------- construtor de formulários ---------- */
function field(f, v) {
  const id = "f_" + f.k, lab = `<label for="${id}">${esc(f.l)}${f.help ? `<small>${esc(f.help)}</small>` : ""}</label>`;
  switch (f.t) {
    case "textarea": return `<div class="fld wide">${lab}<textarea id="${id}" rows="${f.rows || 4}">${esc(v)}</textarea></div>`;
    case "corpo": return `<div class="fld wide">${lab}<div class="tbar"><button type="button" data-w="**">B</button><button type="button" data-l>Link</button><span>Linha em branco = novo parágrafo · **negrito** · [texto](https://link)</span></div><textarea id="${id}" rows="14">${esc(v)}</textarea></div>`;
    case "check": return `<div class="fld chk"><label><input type="checkbox" id="${id}" ${v ? "checked" : ""}> ${esc(f.l)}</label></div>`;
    case "select": return `<div class="fld">${lab}<select id="${id}">${f.o(v)}</select></div>`;
    case "image": return `<div class="fld wide">${lab}<div class="imgf"><img id="${id}_p" src="${esc(v || "")}" ${v ? "" : 'style="display:none"'} alt=""><div><input id="${id}" value="${esc(v)}" placeholder="https://… (ou carrega um ficheiro)"><input type="file" accept="image/*" data-up="${id}"></div></div></div>`;
    case "clubes": return `<div class="fld wide">${lab}<input class="flt" placeholder="filtrar clubes"><div class="multi" id="${id}">${D.clubes.map(c => `<label><input type="checkbox" value="${c.id}" ${(v || []).includes(c.id) ? "checked" : ""}> ${esc(clubName(c))}</label>`).join("")}</div></div>`;
    case "datetime": return `<div class="fld">${lab}<input type="datetime-local" id="${id}" value="${v ? new Date(new Date(v).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""}"></div>`;
    default: return `<div class="fld ${f.wide ? "wide" : ""}">${lab}<input id="${id}" type="${f.t || "text"}" value="${esc(v)}" ${f.ph ? `placeholder="${esc(f.ph)}"` : ""}></div>`;
  }
}
function readForm(fields) {
  const o = {};
  for (const f of fields) {
    const el = $("#f_" + f.k); if (!el) continue;
    let v;
    if (f.t === "check") v = el.checked;
    else if (f.t === "clubes") v = [...el.querySelectorAll("input:checked")].map(i => +i.value);
    else if (f.t === "number") v = el.value === "" ? null : +el.value;
    else if (f.t === "datetime") v = el.value ? new Date(el.value).toISOString() : null;
    else v = el.value.trim() === "" ? null : el.value.trim();
    if (f.num && v != null) v = +v;
    o[f.k] = v;
  }
  return o;
}
function wireForm(root) {
  root.querySelectorAll("[data-up]").forEach(inp => inp.onchange = async () => { const f = inp.files[0]; if (!f) return; toast("A carregar imagem…"); const url = await upload(f); if (url) { $("#" + inp.dataset.up).value = url; const p = $("#" + inp.dataset.up + "_p"); p.src = url; p.style.display = ""; toast("Imagem carregada ✓"); } });
  root.querySelectorAll(".imgf input:not([type=file])").forEach(i => i.oninput = () => { const p = $("#" + i.id + "_p"); p.src = i.value; p.style.display = i.value ? "" : "none"; });
  root.querySelectorAll(".flt").forEach(i => i.oninput = () => i.nextElementSibling.querySelectorAll("label").forEach(l => l.style.display = norm(l.textContent).includes(norm(i.value)) ? "" : "none"));
  root.querySelectorAll(".tbar").forEach(tb => { const ta = tb.nextElementSibling;
    tb.querySelector("[data-w]").onclick = () => { const s = ta.selectionStart, e = ta.selectionEnd; ta.setRangeText("**" + ta.value.slice(s, e) + "**", s, e, "end"); ta.focus(); };
    tb.querySelector("[data-l]").onclick = () => { const s = ta.selectionStart, e = ta.selectionEnd; ta.setRangeText("[" + (ta.value.slice(s, e) || "texto") + "](https://)", s, e, "end"); ta.focus(); }; });
}

/* ---------- secções ---------- */
const S = {};
S.painel = async () => {
  const [defs, nPub, nRas, msgs, nl] = await Promise.all([all("definicoes"), all("noticias", x => x.eq("publicado", true)), all("noticias", x => x.eq("publicado", false)), all("mensagens", x => x.eq("lida", false)), all("newsletter")]);
  const u = defs.find(d => d.chave === "ultima_atualizacao")?.valor || {};
  const quando = u.quando ? new Date(u.quando) : null, mins = quando ? Math.round((Date.now() - quando) / 60000) : null;
  return `<h1>Painel</h1><div class="cards">
    <div class="card ${mins == null || mins > 60 ? "warn" : ""}"><span>Última atualização do robô</span><b>${quando ? (mins < 60 ? `há ${mins} min` : quando.toLocaleString("pt-PT")) : "nunca"}</b><small>${esc(u.modo || "")} ${u.pedidos ? "· " + u.pedidos + " pedidos" : ""} ${u.erros?.length ? "· " + u.erros.length + " erros" : ""}</small></div>
    <div class="card"><span>Notícias publicadas</span><b>${nPub.length}</b><small>${nRas.length} rascunhos</small></div>
    <div class="card"><span>Mensagens por ler</span><b>${msgs.length}</b><small><a href="#mensagens">ver</a></small></div>
    <div class="card"><span>Subscritores</span><b>${nl.length}</b><small><a href="#newsletter">ver</a></small></div></div>
    <div class="actions"><a class="btn" href="#noticias/new">+ Nova notícia</a><a class="btn o" href="#equipa_jornada/new">+ Equipa da jornada</a><a class="btn o" href="#mercado/new">+ Movimento de mercado</a>${CFG.GITHUB_REPO ? `<a class="btn o" target="_blank" href="https://github.com/${esc(CFG.GITHUB_REPO)}/actions/workflows/scrape.yml">Atualizar dados agora ↗</a>` : ""}<a class="btn o" href="index.html" target="_blank">Ver site ↗</a></div>
    ${u.erros?.length ? `<h2>Erros na última execução</h2><pre class="err">${esc(u.erros.join("\n"))}</pre>` : ""}`;
};

/* --- Notícias --- */
const F_NEWS = [{ k: "titulo", l: "Título", wide: 1 }, { k: "resumo", l: "Resumo (aparece em destaque e nas listas)", t: "textarea", rows: 2 }, { k: "corpo", l: "Texto", t: "corpo" },
  { k: "imagem_url", l: "Imagem de capa", t: "image" }, { k: "credito_foto", l: "Crédito da foto", ph: "ex.: João Nunes" },
  { k: "competicao_id", l: "Competição", t: "select", o: v => optComps(v), num: 1 }, { k: "categoria", l: "Categoria (se não for uma competição)", ph: "ex.: Seleções, Europa, Formação" },
  { k: "clubes", l: "Clubes desta notícia", t: "clubes" }, { k: "autor", l: "Autor" }, { k: "publicado_em", l: "Data de publicação", t: "datetime", help: "pode ser no futuro (agendada)" },
  { k: "slug", l: "Endereço (slug)", help: "gerado a partir do título se ficar vazio" }, { k: "destaque", l: "Destaque na página inicial", t: "check" }, { k: "publicado", l: "Publicado (visível no site)", t: "check" }];
S.noticias = async (id) => {
  if (id) {
    const n = id === "new" ? { id: "new", publicado: false, publicado_em: new Date().toISOString(), autor: "Redação", clubes: [] } : (await all("noticias", x => x.eq("id", id)))[0];
    if (!n) return "<h1>Notícia não encontrada</h1>";
    return { html: `<a class="back" href="#noticias">← Notícias</a><h1>${id === "new" ? "Nova notícia" : "Editar notícia"}</h1><form class="form" id="frm">${F_NEWS.map(f => field(f, n[f.k])).join("")}<div class="bar"><button class="btn">Guardar</button>${id !== "new" ? `<button type="button" class="btn danger" id="del">Apagar</button>` : ""}${n.slug && n.publicado ? `<a class="btn o" target="_blank" href="index.html#/noticia/${esc(n.slug)}">Ver no site ↗</a>` : ""}</div></form>`,
      after: () => { wireForm($("#frm")); $("#frm").onsubmit = async e => { e.preventDefault(); const r = readForm(F_NEWS); if (!r.titulo) return toast("Falta o título", 1); r.slug = r.slug || slugify(r.titulo); r.id = n.id; if (await save("noticias", r)) location.hash = "noticias"; };
        if ($("#del")) $("#del").onclick = async () => { if (confirmBox("Apagar esta notícia?") && await del("noticias", "id", n.id)) location.hash = "noticias"; }; } };
  }
  const ns = await all("noticias", x => x.order("publicado_em", { ascending: false }).limit(300));
  return { html: `<div class="head"><h1>Notícias</h1><a class="btn" href="#noticias/new">+ Nova notícia</a></div><input class="search" id="sq" placeholder="Procurar…"><table class="tbl"><thead><tr><th>Título</th><th>Categoria</th><th>Data</th><th>Estado</th></tr></thead><tbody>${ns.map(n => `<tr data-h="#noticias/${n.id}"><td><b>${esc(n.titulo)}</b>${n.destaque ? ' <span class="tag">destaque</span>' : ""}</td><td>${esc(n.competicao_id ? cn(comp(n.competicao_id)) : n.categoria || "")}</td><td>${n.publicado_em ? new Date(n.publicado_em).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : ""}</td><td>${n.publicado ? (new Date(n.publicado_em) > new Date() ? '<span class="tag">agendada</span>' : '<span class="tag ok">publicada</span>') : '<span class="tag">rascunho</span>'}</td></tr>`).join("") || `<tr><td colspan="4">Ainda não há notícias.</td></tr>`}</tbody></table>`, after: listFilter };
};
function listFilter() { const s = $("#sq"); if (s) s.oninput = () => document.querySelectorAll(".tbl tbody tr").forEach(r => r.style.display = norm(r.textContent).includes(norm(s.value)) ? "" : "none"); document.querySelectorAll("tr[data-h]").forEach(r => r.onclick = () => location.hash = r.dataset.h); }
function confirmBox(msg) { try { return window.confirm(msg); } catch (e) { return true; } }

/* --- Jogos --- */
S.jogos = async () => {
  const c = +(sessionStorage.jc || D.comps.find(x => x.principal)?.id || D.comps[0]?.id);
  const js = c ? await all("jogos", x => x.eq("competicao_id", c).order("jornada").order("data")) : [];
  const jors = [...new Set(js.map(j => j.jornada))];
  const jor = sessionStorage.jj && jors.includes(+sessionStorage.jj) ? +sessionStorage.jj : (Math.max(0, ...js.filter(j => j.golos_casa != null).map(j => j.jornada || 0)) || jors[0]);
  const l = js.filter(j => j.jornada === jor);
  return { html: `<h1>Jogos</h1><p class="hint">Resultados, datas e equipas vêm do hp.fpp.pt. Aqui acrescentas o canal de TV, destaques e notas.</p><div class="filters"><select id="jc">${optComps(c, false)}</select><select id="jj">${jors.map(x => `<option ${x === jor ? "selected" : ""} value="${x}">${esc(js.find(j => j.jornada === x)?.jornada_nome || "Jornada " + x)}</option>`).join("")}</select></div>
    <table class="tbl"><thead><tr><th>Data</th><th>Jogo</th><th>Canal TV</th><th>Nota</th><th>Destaque</th><th></th></tr></thead><tbody>${l.map(j => `<tr data-id="${j.id}"><td>${esc(j.data || "")} ${esc(j.hora || "")}</td><td><b>${esc(teamName(j.casa_id))} ${j.golos_casa != null ? j.golos_casa + "-" + j.golos_fora : "vs"} ${esc(teamName(j.fora_id))}</b></td><td><input class="in" data-k="canal_tv" value="${esc(j.canal_tv)}" placeholder="ex.: Sport TV 2" list="canais"></td><td><input class="in" data-k="nota" value="${esc(j.nota)}"></td><td><input type="checkbox" data-k="destaque" ${j.destaque ? "checked" : ""}></td><td><button class="btn sm">Guardar</button></td></tr>`).join("") || `<tr><td colspan="6">Sem jogos (o robô ainda não correu?).</td></tr>`}</tbody></table>
    <datalist id="canais"><option>FPP TV</option><option>Sport TV</option><option>Sport TV 2</option><option>A Bola TV</option><option>Canal 11</option><option>RTP 2</option><option>Porto Canal</option><option>BTV</option><option>Sporting TV</option></datalist>`,
    after: () => { $("#jc").onchange = e => { sessionStorage.jc = e.target.value; delete sessionStorage.jj; route(); }; if ($("#jj")) $("#jj").onchange = e => { sessionStorage.jj = e.target.value; route(); };
      document.querySelectorAll("tr[data-id] button").forEach(b => b.onclick = async () => { const tr = b.closest("tr"); const r = { id: +tr.dataset.id }; tr.querySelectorAll("[data-k]").forEach(i => r[i.dataset.k] = i.type === "checkbox" ? i.checked : (i.value.trim() || null)); await save("jogos", r); }); } };
};

/* --- Clubes --- */
const F_CLUBE = [{ k: "nome_curto", l: "Nome a mostrar no site", help: "deixa vazio para usar o nome oficial sem patrocinador" }, { k: "cor", l: "Cor principal", t: "color" }, { k: "cidade", l: "Cidade" }, { k: "pavilhao", l: "Pavilhão" }, { k: "instagram", l: "Instagram", ph: "@clube" }, { k: "logo_custom", l: "Emblema alternativo", t: "image", help: "só se quiseres trocar o emblema da FPP" }, { k: "descricao", l: "Descrição", t: "corpo" }];
S.clubes = async (id) => {
  if (id) {
    const c = club(id); if (!c) return "<h1>Clube não encontrado</h1>";
    return { html: `<a class="back" href="#clubes">← Clubes</a><div class="ch">${c.logo_custom || c.logo_url ? `<img src="${esc(c.logo_custom || c.logo_url)}" alt="">` : ""}<div><h1>${esc(clubName(c))}</h1><p class="hint">Nome oficial (FPP): ${esc(c.nome)} · id ${c.id}</p></div></div><form class="form" id="frm">${F_CLUBE.map(f => field(f, f.t === "color" ? (c[f.k] || "#7A1C28") : c[f.k])).join("")}<div class="bar"><button class="btn">Guardar</button><a class="btn o" href="#jogadores?clube=${c.id}">Ver jogadores</a></div></form>`,
      after: () => { wireForm($("#frm")); $("#frm").onsubmit = async e => { e.preventDefault(); const r = readForm(F_CLUBE); r.id = c.id; if (await save("clubes", r)) { Object.assign(c, r); location.hash = "clubes"; } }; } };
  }
  return { html: `<h1>Clubes</h1><input class="search" id="sq" placeholder="Procurar…"><table class="tbl"><thead><tr><th></th><th>Nome no site</th><th>Nome oficial</th><th>Cidade</th><th>Cor</th></tr></thead><tbody>${D.clubes.map(c => `<tr data-h="#clubes/${c.id}"><td>${c.logo_custom || c.logo_url ? `<img class="mini" src="${esc(c.logo_custom || c.logo_url)}" alt="">` : ""}</td><td><b>${esc(clubName(c))}</b></td><td>${esc(c.nome)}</td><td>${esc(c.cidade || "")}</td><td>${c.cor ? `<span class="sw" style="background:${esc(c.cor)}"></span>` : ""}</td></tr>`).join("") || `<tr><td colspan="5">Ainda sem clubes (o robô ainda não correu?).</td></tr>`}</tbody></table>`, after: listFilter };
};

/* --- Jogadores --- */
const F_JOG = [{ k: "nome_publico", l: "Nome a mostrar", help: "vazio = nome da FPP" }, { k: "numero_manual", l: "Número da camisola", t: "number", help: "vazio = número da última ficha de jogo" },
  { k: "posicao", l: "Posição", t: "select", o: v => ["", "Guarda-redes", "Defesa", "Médio", "Avançado", "Universal"].map(p => `<option ${p === (v || "") ? "selected" : ""}>${p}</option>`).join("") },
  { k: "nacionalidade", l: "Nacionalidade" }, { k: "data_nascimento", l: "Data de nascimento", t: "date" }, { k: "foto_custom", l: "Foto alternativa", t: "image" }, { k: "bio", l: "Biografia", t: "corpo" }, { k: "visivel", l: "Visível no site", t: "check" }];
S.jogadores = async (id, params) => {
  if (id === "new") {
    return { html: `<a class="back" href="#jogadores">← Jogadores</a><h1>Adicionar jogador</h1><p class="hint">Para jogadores que não aparecem no hp.fpp.pt. Ficam marcados como “manual” e o robô não lhes mexe.</p><form class="form" id="frm">${field({ k: "nome", l: "Nome", wide: 1 }, "")}<div class="fld"><label>Equipa</label><select id="f_equipa">${D.equipas.filter(e => comp(e.competicao_id)).map(e => `<option value="${e.id}">${esc(teamName(e.id))} — ${esc(cn(comp(e.competicao_id)))}</option>`).join("")}</select></div>${F_JOG.map(f => field(f, f.k === "visivel" ? true : null)).join("")}<div class="bar"><button class="btn">Guardar</button></div></form>`,
      after: () => { wireForm($("#frm")); $("#frm").onsubmit = async e => { e.preventDefault(); const r = readForm([{ k: "nome" }, ...F_JOG]); if (!r.nome) return toast("Falta o nome", 1); r.id = -(Date.now() % 1e12); const ok = await save("jogadores", r, "id"); if (ok && await save("plantel", { equipa_id: +$("#f_equipa").value, jogador_id: r.id, manual: true }, "equipa_id,jogador_id")) location.hash = "jogadores/" + r.id; }; } };
  }
  if (id) {
    const p = (await all("jogadores", x => x.eq("id", +id)))[0]; if (!p) return "<h1>Jogador não encontrado</h1>";
    const pl = await all("plantel", x => x.eq("jogador_id", p.id));
    return { html: `<a class="back" href="#jogadores">← Jogadores</a><div class="ch">${p.foto_custom || p.foto_url ? `<img src="${esc(p.foto_custom || p.foto_url)}" alt="" style="border-radius:50%">` : ""}<div><h1>${esc(p.nome_publico || p.nome)}</h1><p class="hint">FPP: ${esc(p.nome)}${p.numero ? " · n.º " + p.numero : ""} · ${p.id > 0 ? "federado " + p.id : "criado à mão"} · ${pl.map(x => esc(teamName(x.equipa_id))).join(", ")}</p></div></div><form class="form" id="frm">${F_JOG.map(f => field(f, p[f.k])).join("")}<div class="bar"><button class="btn">Guardar</button>${p.id < 0 ? `<button type="button" class="btn danger" id="del">Apagar</button>` : ""}</div></form>`,
      after: () => { wireForm($("#frm")); $("#frm").onsubmit = async e => { e.preventDefault(); const r = readForm(F_JOG); r.id = p.id; if (await save("jogadores", r)) location.hash = "jogadores"; }; if ($("#del")) $("#del").onclick = async () => { if (confirmBox("Apagar este jogador?") && await del("jogadores", "id", p.id)) location.hash = "jogadores"; }; } };
  }
  const clubeSel = +(params?.get("clube") || sessionStorage.jcl || 0);
  let rows = [];
  if (clubeSel) {
    const eids = D.equipas.filter(e => e.clube_id === clubeSel).map(e => e.id);
    const pl = eids.length ? await all("plantel", x => x.in("equipa_id", eids)) : [];
    rows = pl.length ? await all("jogadores", x => x.in("id", [...new Set(pl.map(p => p.jogador_id))])) : [];
  }
  return { html: `<div class="head"><h1>Jogadores</h1><a class="btn" href="#jogadores/new">+ Adicionar jogador</a></div><div class="filters"><select id="jcl"><option value="">Escolhe um clube…</option>${optClubes(clubeSel, false)}</select><input class="search" id="pq" placeholder="ou procura pelo nome (mín. 3 letras)" style="margin:0"></div><div id="pres">${plist(rows)}</div>`,
    after: () => { $("#jcl").onchange = e => { sessionStorage.jcl = e.target.value; location.hash = "jogadores?clube=" + e.target.value; };
      let t; $("#pq").oninput = e => { clearTimeout(t); t = setTimeout(async () => { if (e.target.value.trim().length < 3) return; if ($("#pres")) $("#pres").innerHTML = plist(await all("jogadores", x => x.ilike("nome", "%" + e.target.value.trim() + "%").limit(60))); listFilter(); }, 300); };
      listFilter(); } };
};
const plist = rows => rows.length ? `<table class="tbl"><thead><tr><th></th><th>Nome</th><th>N.º</th><th>Posição</th><th>Visível</th></tr></thead><tbody>${rows.sort((a, b) => (a.numero_manual ?? a.numero ?? 999) - (b.numero_manual ?? b.numero ?? 999)).map(p => `<tr data-h="#jogadores/${p.id}"><td>${p.foto_custom || p.foto_url ? `<img class="mini" src="${esc(p.foto_custom || p.foto_url)}" alt="" style="border-radius:50%">` : ""}</td><td><b>${esc(p.nome_publico || p.nome)}</b></td><td>${esc(p.numero_manual ?? p.numero ?? "")}</td><td>${esc(p.posicao || "")}</td><td>${p.visivel ? "✓" : "—"}</td></tr>`).join("")}</tbody></table>` : `<p class="hint">Escolhe um clube ou procura pelo nome.</p>`;

/* --- Equipa da jornada --- */
const POS = ["Guarda-redes", "Defesa", "Defesa", "Médio", "Avançado"];
S.equipa_jornada = async (id) => {
  if (id) {
    const e = id === "new" ? { id: "new", competicao_id: D.comps.find(c => c.principal)?.id, jogadores: POS.map(p => ({ posicao: p })), publicado: false } : (await all("equipa_jornada", x => x.eq("id", id)))[0];
    if (!e) return "<h1>Não encontrada</h1>";
    const js = POS.map((p, i) => ({ posicao: p, ...(e.jogadores || [])[i] }));
    return { html: `<a class="back" href="#equipa_jornada">← Equipas da jornada</a><h1>Equipa da jornada</h1><form class="form" id="frm">
      <div class="fld"><label>Competição</label><select id="f_competicao_id">${optComps(e.competicao_id)}</select></div><div class="fld"><label>Jornada</label><input type="number" id="f_jornada" value="${esc(e.jornada)}"></div><div class="fld wide"><label>Título</label><input id="f_titulo" value="${esc(e.titulo)}" placeholder="ex.: Equipa da 3ª Jornada"></div>
      <div class="fld wide"><label>Os cinco</label><table class="tbl five"><thead><tr><th>Posição</th><th>Nome</th><th>Clube</th><th>N.º</th><th>Nota</th></tr></thead><tbody>${js.map((p, i) => `<tr data-i="${i}"><td><select data-k="posicao">${["Guarda-redes", "Defesa", "Médio", "Avançado"].map(x => `<option ${x === p.posicao ? "selected" : ""}>${x}</option>`).join("")}</select></td><td><input data-k="nome" value="${esc(p.nome)}" list="jl" class="in"></td><td><select data-k="clube_id">${optClubes(p.clube_id)}</select></td><td><input data-k="numero" type="number" value="${esc(p.numero)}" class="in" style="width:70px"></td><td><input data-k="nota" value="${esc(p.nota)}" class="in" placeholder="ex.: 2 golos"></td></tr>`).join("")}</tbody></table><datalist id="jl"></datalist></div>
      <div class="fld"><label>Treinador</label><input id="f_treinador" value="${esc(e.treinador)}"></div><div class="fld"><label>Clube do treinador</label><select id="f_treinador_clube">${optClubes(e.treinador_clube)}</select></div>
      <div class="fld chk"><label><input type="checkbox" id="f_publicado" ${e.publicado ? "checked" : ""}> Publicada</label></div>
      <div class="bar"><button class="btn">Guardar</button>${id !== "new" ? `<button type="button" class="btn danger" id="del">Apagar</button>` : ""}</div></form>`,
      after: () => {
        document.querySelectorAll('.five input[data-k="nome"]').forEach(inp => { let t; inp.oninput = () => { clearTimeout(t); t = setTimeout(async () => { if (inp.value.length < 3) return; const r = await all("jogadores", x => x.ilike("nome", "%" + inp.value + "%").limit(10)); if ($("#jl")) $("#jl").innerHTML = r.map(p => `<option value="${esc(p.nome_publico || p.nome)}">`).join(""); }, 250); }; });
        $("#frm").onsubmit = async ev => { ev.preventDefault(); const r = { id: e.id, competicao_id: +$("#f_competicao_id").value || null, jornada: +$("#f_jornada").value || null, titulo: $("#f_titulo").value.trim() || null, treinador: $("#f_treinador").value.trim() || null, treinador_clube: +$("#f_treinador_clube").value || null, publicado: $("#f_publicado").checked,
          jogadores: [...document.querySelectorAll(".five tbody tr")].map(tr => { const o = {}; tr.querySelectorAll("[data-k]").forEach(i => o[i.dataset.k] = i.value.trim() === "" ? null : (i.dataset.k === "clube_id" || i.dataset.k === "numero") ? +i.value : i.value.trim()); return o; }).filter(p => p.nome) };
          if (await save("equipa_jornada", r)) location.hash = "equipa_jornada"; };
        if ($("#del")) $("#del").onclick = async () => { if (confirmBox("Apagar?") && await del("equipa_jornada", "id", e.id)) location.hash = "equipa_jornada"; };
      } };
  }
  const l = await all("equipa_jornada", x => x.order("criado_em", { ascending: false }));
  return { html: `<div class="head"><h1>Equipa da jornada</h1><a class="btn" href="#equipa_jornada/new">+ Nova</a></div><table class="tbl"><thead><tr><th>Título</th><th>Competição</th><th>Jogadores</th><th>Estado</th></tr></thead><tbody>${l.map(e => `<tr data-h="#equipa_jornada/${e.id}"><td><b>${esc(e.titulo || "Jornada " + (e.jornada || ""))}</b></td><td>${esc(cn(comp(e.competicao_id)))}</td><td>${(e.jogadores || []).map(p => esc(p.nome)).join(", ")}</td><td>${e.publicado ? '<span class="tag ok">publicada</span>' : '<span class="tag">rascunho</span>'}</td></tr>`).join("") || `<tr><td colspan="4">Nenhuma ainda.</td></tr>`}</tbody></table>`, after: listFilter };
};

/* --- Mercado --- */
const F_MKT = [{ k: "jogador", l: "Jogador", wide: 1 }, { k: "tipo", l: "Tipo", t: "select", o: v => ["Contratação", "Renovação", "Empréstimo", "Saída"].map(x => `<option ${x === v ? "selected" : ""}>${x}</option>`).join("") }, { k: "data", l: "Data", t: "date" }, { k: "de_clube", l: "De (clube)", t: "select", o: v => optClubes(v), num: 1 }, { k: "para_clube", l: "Para (clube)", t: "select", o: v => optClubes(v), num: 1 }, { k: "nota", l: "Nota", ph: "ex.: vem do campeonato espanhol", wide: 1 }];
S.mercado = async (id) => {
  if (id) {
    const m = id === "new" ? { id: "new", tipo: "Contratação", data: new Date().toISOString().slice(0, 10) } : (await all("mercado", x => x.eq("id", id)))[0];
    if (!m) return "<h1>Não encontrado</h1>";
    return { html: `<a class="back" href="#mercado">← Mercado</a><h1>${id === "new" ? "Novo movimento" : "Editar movimento"}</h1><form class="form" id="frm">${F_MKT.map(f => field(f, m[f.k])).join("")}<div class="bar"><button class="btn">Guardar</button>${id !== "new" ? `<button type="button" class="btn danger" id="del">Apagar</button>` : ""}</div></form>`,
      after: () => { $("#frm").onsubmit = async e => { e.preventDefault(); const r = readForm(F_MKT); if (!r.jogador) return toast("Falta o jogador", 1); r.id = m.id; if (await save("mercado", r)) location.hash = "mercado"; }; if ($("#del")) $("#del").onclick = async () => { if (confirmBox("Apagar?") && await del("mercado", "id", m.id)) location.hash = "mercado"; }; } };
  }
  const l = await all("mercado", x => x.order("data", { ascending: false }));
  return { html: `<div class="head"><h1>Mercado</h1><a class="btn" href="#mercado/new">+ Novo movimento</a></div><input class="search" id="sq" placeholder="Procurar…"><table class="tbl"><thead><tr><th>Jogador</th><th>De</th><th>Para</th><th>Tipo</th><th>Data</th></tr></thead><tbody>${l.map(m => `<tr data-h="#mercado/${m.id}"><td><b>${esc(m.jogador)}</b></td><td>${esc(clubName(club(m.de_clube)))}</td><td>${esc(clubName(club(m.para_clube)))}</td><td>${esc(m.tipo)}</td><td>${esc(m.data || "")}</td></tr>`).join("") || `<tr><td colspan="5">Sem movimentos.</td></tr>`}</tbody></table>`, after: listFilter };
};

/* --- Competições --- */
S.competicoes = async () => ({
  html: `<h1>Competições</h1><p class="hint">O robô descobre as competições sozinho. Desliga “ativa” nas que não queres no site (e o robô deixa de as atualizar). A “principal” é a da página inicial.</p><table class="tbl"><thead><tr><th>Nome oficial</th><th>Nome no site</th><th>Ordem</th><th>Ativa</th><th>Principal</th><th></th></tr></thead><tbody>${D.comps.map(c => `<tr data-id="${c.id}"><td><b>${esc(c.nome)}</b><br><small>${esc(c.grupo || "")} · id ${c.id}</small></td><td><input class="in" data-k="nome_curto" value="${esc(c.nome_curto)}" placeholder="${esc(c.nome)}"></td><td><input class="in" type="number" data-k="ordem" value="${esc(c.ordem)}" style="width:70px"></td><td><input type="checkbox" data-k="ativa" ${c.ativa ? "checked" : ""}></td><td><input type="radio" name="pr" data-k="principal" ${c.principal ? "checked" : ""}></td><td><button class="btn sm">Guardar</button></td></tr>`).join("") || `<tr><td colspan="6">Sem competições (corre o robô em modo “completo”).</td></tr>`}</tbody></table>`,
  after: () => document.querySelectorAll("tr[data-id] button").forEach(b => b.onclick = async () => {
    const tr = b.closest("tr"), id = +tr.dataset.id, r = { id };
    tr.querySelectorAll("[data-k]").forEach(i => r[i.dataset.k] = i.type === "checkbox" || i.type === "radio" ? i.checked : i.type === "number" ? (+i.value || 100) : (i.value.trim() || null));
    if (r.principal) for (const c of D.comps.filter(c => c.principal && c.id !== id)) { await sb.from("competicoes").update({ principal: false }).eq("id", c.id); c.principal = false; }
    if (await save("competicoes", r)) Object.assign(D.comps.find(c => c.id === id), r);
  })
});

/* --- Mensagens e newsletter --- */
S.mensagens = async () => {
  const l = await all("mensagens", x => x.order("criado_em", { ascending: false }).limit(300));
  return { html: `<h1>Mensagens</h1>${l.map(m => `<div class="msg ${m.lida ? "" : "nova"}" data-id="${m.id}"><div class="mh"><b>${esc(m.nome)}</b> · <a href="mailto:${esc(m.email)}">${esc(m.email)}</a> · <span class="tag">${esc(m.assunto || "")}</span><small>${new Date(m.criado_em).toLocaleString("pt-PT")}</small></div><p>${esc(m.mensagem).replace(/\n/g, "<br>")}</p><div class="bar">${m.lida ? "" : `<button class="btn sm" data-a="lida">Marcar como lida</button>`}<button class="btn sm danger" data-a="del">Apagar</button></div></div>`).join("") || "<p class='hint'>Sem mensagens.</p>"}`,
    after: () => document.querySelectorAll(".msg button").forEach(b => b.onclick = async () => { const id = b.closest(".msg").dataset.id; if (b.dataset.a === "lida") await save("mensagens", { id, lida: true }); else if (confirmBox("Apagar mensagem?")) await del("mensagens", "id", id); route(); }) };
};
S.newsletter = async () => {
  const l = await all("newsletter", x => x.order("criado_em", { ascending: false }));
  return { html: `<div class="head"><h1>Newsletter</h1><button class="btn" id="cpy">Copiar todos os emails</button></div><p class="hint">${l.length} subscritores. Copia a lista e importa-a no Mailchimp.</p><table class="tbl"><thead><tr><th>Email</th><th>Data</th><th></th></tr></thead><tbody>${l.map(n => `<tr><td>${esc(n.email)}</td><td>${n.criado_em ? new Date(n.criado_em).toLocaleDateString("pt-PT") : ""}</td><td><button class="btn sm danger" data-e="${esc(n.email)}">Remover</button></td></tr>`).join("")}</tbody></table><textarea id="emails" style="position:absolute;left:-9999px">${esc(l.map(n => n.email).join("\n"))}</textarea>`,
    after: () => { $("#cpy").onclick = async () => { try { await navigator.clipboard.writeText($("#emails").value); toast("Copiado ✓"); } catch (e) { $("#emails").style.cssText = "width:100%;height:200px"; $("#emails").select(); toast("Seleciona e copia a lista"); } };
      document.querySelectorAll("[data-e]").forEach(b => b.onclick = async () => { if (confirmBox("Remover?") && await del("newsletter", "email", b.dataset.e)) route(); }); } };
};

/* --- Definições --- */
S.definicoes = async () => {
  const defs = await all("definicoes"); const g = k => defs.find(d => d.chave === k)?.valor?.texto || "";
  return { html: `<h1>Textos do site</h1><form class="form" id="frm">${field({ k: "sobre", l: "Página “Sobre nós”", t: "corpo" }, g("sobre"))}${field({ k: "selecoes", l: "Página “Seleções” (texto de introdução)", t: "corpo" }, g("selecoes"))}<div class="bar"><button class="btn">Guardar</button></div></form>`,
    after: () => { wireForm($("#frm")); $("#frm").onsubmit = async e => { e.preventDefault(); await save("definicoes", [{ chave: "sobre", valor: { texto: $("#f_sobre").value } }, { chave: "selecoes", valor: { texto: $("#f_selecoes").value } }], "chave"); }; } };
};

/* ---------- navegação ---------- */
const NAV = [["painel", "Painel"], ["noticias", "Notícias"], ["jogos", "Jogos e TV"], ["equipa_jornada", "Equipa da jornada"], ["mercado", "Mercado"], ["jogadores", "Jogadores"], ["clubes", "Clubes"], ["competicoes", "Competições"], ["mensagens", "Mensagens"], ["newsletter", "Newsletter"], ["definicoes", "Textos do site"]];
async function route() {
  const h = location.hash.slice(1) || "painel";
  const [path, qs] = h.split("?"); const [sec, id] = path.split("/");
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + sec));
  $("#main").innerHTML = `<p class="hint">A carregar…</p>`;
  try { const r = await (S[sec] || S.painel)(id, new URLSearchParams(qs || "")); const o = typeof r === "string" ? { html: r } : r; $("#main").innerHTML = o.html; o.after && o.after(); }
  catch (e) { console.error(e); $("#main").innerHTML = `<h1>Erro</h1><pre class="err">${esc(e.message)}</pre>`; }
  $("#side").classList.remove("open"); window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

/* ---------- login ---------- */
async function start() {
  $("#nav").innerHTML = NAV.map(n => `<a href="#${n[0]}">${n[1]}</a>`).join("");
  if (!LIVE) $("#demo").style.display = "block";
  const { data } = await sb.auth.getSession();
  if (!data.session) return showLogin();
  const { data: ad, error } = await sb.from("admins").select("email");
  if (LIVE && (error || !ad?.length)) { $("#login").style.display = "grid"; $("#app").style.display = "none"; $("#lmsg").innerHTML = `Entraste como <b>${esc(data.session.user.email)}</b>, mas este email não é administrador.<br>No Supabase (SQL Editor) corre:<br><code>insert into admins (email) values ('${esc(data.session.user.email)}');</code>`; $("#lout").style.display = ""; return; }
  $("#login").style.display = "none"; $("#app").style.display = "block";
  $("#who").textContent = data.session.user.email;
  await loadSupport(); route();
}
function showLogin() { $("#login").style.display = "grid"; $("#app").style.display = "none"; }
$("#lf").onsubmit = async e => { e.preventDefault(); $("#lmsg").textContent = "A entrar…"; const { error } = await sb.auth.signInWithPassword({ email: $("#le").value.trim(), password: $("#lp").value }); if (error) { $("#lmsg").textContent = "Email ou palavra-passe errados."; return; } $("#lmsg").textContent = ""; start(); };
$("#forgot").onclick = async () => { const em = $("#le").value.trim(); if (!em) { $("#lmsg").textContent = "Escreve o teu email primeiro."; return; } await sb.auth.resetPasswordForEmail(em, { redirectTo: location.href.split("#")[0] }); $("#lmsg").textContent = "Se o email existir, recebes um link para mudar a palavra-passe."; };
document.querySelectorAll(".logout").forEach(b => b.onclick = async () => { await sb.auth.signOut(); location.hash = ""; location.reload(); });
$("#burger").onclick = () => $("#side").classList.toggle("open");
// recuperação de palavra-passe (link do email)
if (LIVE) sb.auth.onAuthStateChange(async (ev) => { if (ev === "PASSWORD_RECOVERY") { const np = window.prompt ? window.prompt("Nova palavra-passe:") : null; if (np) { const { error } = await sb.auth.updateUser({ password: np }); toast(error ? error.message : "Palavra-passe alterada ✓", !!error); } } });
start();
