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
    async rpc() { return { error: null }; },
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
    <div class="actions"><a class="btn" href="#noticias/new">+ Nova notícia</a><a class="btn o" href="#equipa_jornada/new">+ Equipa da jornada</a><a class="btn o" href="#mercado/new">+ Movimento de mercado</a><a class="btn o" href="#patrocinios/new">+ Patrocínio</a>${CFG.GITHUB_REPO ? `<a class="btn o" target="_blank" href="https://github.com/${esc(CFG.GITHUB_REPO)}/actions/workflows/scrape.yml">Atualizar dados agora ↗</a>` : ""}<a class="btn o" href="index.html" target="_blank">Ver site ↗</a></div>
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
    <table class="tbl"><thead><tr><th>Data</th><th>Jogo</th><th>Canal TV</th><th>Nota</th><th>Destaque</th><th></th></tr></thead><tbody>${l.map(j => `<tr data-id="${j.id}"><td>${esc(j.data || "")} ${esc(j.hora || "")}</td><td><b>${esc((j.casa_id != null ? teamName(j.casa_id) : (j.casa_nome || "—")))} ${j.golos_casa != null ? j.golos_casa + "-" + j.golos_fora : "vs"} ${esc((j.fora_id != null ? teamName(j.fora_id) : (j.fora_nome || "—")))}</b></td><td><input class="in" data-k="canal_tv" value="${esc(j.canal_tv)}" placeholder="ex.: Sport TV 2" list="canais"></td><td><input class="in" data-k="nota" value="${esc(j.nota)}"></td><td><input type="checkbox" data-k="destaque" ${j.destaque ? "checked" : ""}></td><td><button class="btn sm">Guardar</button></td></tr>`).join("") || `<tr><td colspan="6">Sem jogos (o robô ainda não correu?).</td></tr>`}</tbody></table>
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


/* --- Patrocínios --- */
const POSICOES = [["inicio", "Página inicial (banner largo)"], ["jogo", "Página de cada jogo"], ["competicao", "Páginas de competição"], ["noticia", "Fim das notícias"], ["equipa_jornada", "Equipa da jornada (“patrocinada por”)"], ["rodape", "Faixa de parceiros (todas as páginas)"]];
const F_SP = [{ k: "nome", l: "Patrocinador", wide: 1 }, { k: "posicao", l: "Onde aparece", t: "select", o: v => POSICOES.map(p => `<option value="${p[0]}" ${p[0] === v ? "selected" : ""}>${p[1]}</option>`).join("") },
  { k: "link", l: "Link (para onde vai quem clica)", ph: "https://…" }, { k: "imagem_url", l: "Banner / logótipo", t: "image", help: "banner largo: 1200×200 px · faixa de parceiros: logótipo com fundo transparente" },
  { k: "texto", l: "Texto (aparece se não houver imagem, e para leitores de ecrã)" }, { k: "inicio", l: "Começa em", t: "date", help: "opcional" }, { k: "fim", l: "Acaba em", t: "date", help: "opcional" },
  { k: "ordem", l: "Ordem", t: "number" }, { k: "ativo", l: "Ativo", t: "check" }];
S.patrocinios = async (id) => {
  if (id) {
    const s = id === "new" ? { id: "new", ativo: true, posicao: "inicio", ordem: 100 } : (await all("patrocinios", x => x.eq("id", id)))[0];
    if (!s) return "<h1>Não encontrado</h1>";
    return { html: `<a class="back" href="#patrocinios">← Patrocínios</a><h1>${id === "new" ? "Novo patrocínio" : esc(s.nome)}</h1>${id !== "new" ? `<div class="cards" style="grid-template-columns:repeat(3,1fr)"><div class="card"><span>Vistas</span><b>${s.vistas || 0}</b></div><div class="card"><span>Cliques</span><b>${s.cliques || 0}</b></div><div class="card"><span>Taxa de clique</span><b>${s.vistas ? ((s.cliques || 0) / s.vistas * 100).toFixed(1) + "%" : "—"}</b></div></div>` : ""}<form class="form" id="frm">${F_SP.map(f => field(f, s[f.k])).join("")}<div class="bar"><button class="btn">Guardar</button>${id !== "new" ? `<button type="button" class="btn danger" id="del">Apagar</button>` : ""}</div></form>`,
      after: () => { wireForm($("#frm")); $("#frm").onsubmit = async e => { e.preventDefault(); const r = readForm(F_SP); if (!r.nome) return toast("Falta o nome", 1); r.ordem = r.ordem ?? 100; r.id = s.id; if (await save("patrocinios", r)) location.hash = "patrocinios"; }; if ($("#del")) $("#del").onclick = async () => { if (confirmBox("Apagar este patrocínio?") && await del("patrocinios", "id", s.id)) location.hash = "patrocinios"; }; } };
  }
  const l = await all("patrocinios", x => x.order("posicao").order("ordem"));
  const hoje = new Date().toISOString().slice(0, 10);
  return { html: `<div class="head"><h1>Patrocínios</h1><a class="btn" href="#patrocinios/new">+ Novo patrocínio</a></div><p class="hint">Banners dos teus patrocinadores. Se houver vários na mesma posição, o site mostra um ao acaso em cada visita (na faixa de parceiros aparecem todos). As vistas e os cliques servem para mostrares resultados ao patrocinador.</p><table class="tbl"><thead><tr><th></th><th>Patrocinador</th><th>Onde</th><th>Período</th><th>Vistas</th><th>Cliques</th><th>Estado</th></tr></thead><tbody>${l.map(s => { const fora = (s.inicio && s.inicio > hoje) || (s.fim && s.fim < hoje); return `<tr data-h="#patrocinios/${s.id}"><td>${s.imagem_url ? `<img class="mini" src="${esc(s.imagem_url)}" alt="" style="width:70px">` : ""}</td><td><b>${esc(s.nome)}</b></td><td>${esc((POSICOES.find(p => p[0] === s.posicao) || [0, s.posicao])[1])}</td><td>${esc(s.inicio || "…")} → ${esc(s.fim || "…")}</td><td>${s.vistas || 0}</td><td>${s.cliques || 0}</td><td>${!s.ativo ? '<span class="tag">desligado</span>' : fora ? '<span class="tag">fora de prazo</span>' : '<span class="tag ok">a aparecer</span>'}</td></tr>`; }).join("") || `<tr><td colspan="7">Ainda sem patrocínios.</td></tr>`}</tbody></table>`, after: listFilter };
};


/* --- Notificações --- */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64u8a = s => { const p = "=".repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); };
async function gerarChaves() {
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = b64u(await crypto.subtle.exportKey("raw", k.publicKey));
  const priv = (await crypto.subtle.exportKey("jwk", k.privateKey)).d;
  return { pub, priv };
}
async function esteAparelho() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Este navegador não suporta notificações (no iPhone, instala primeiro a app no ecrã principal).");
  if (await Notification.requestPermission() !== "granted") throw new Error("As notificações estão bloqueadas neste navegador. Permite-as nas definições do site e tenta outra vez.");
  const reg = await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready;
  return { reg, sub: (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u8a(CFG.VAPID_PUBLIC_KEY) }) };
}
S.notificacoes = async () => {
  const ativo = !!CFG.VAPID_PUBLIC_KEY;
  const [subs, envs, man, defs] = await Promise.all([all("subscricoes", x => x.limit(5000)), all("notificacoes_enviadas", x => x.order("enviado_em", { ascending: false }).limit(15)), all("notificacoes_manuais", x => x.order("criado_em", { ascending: false }).limit(10)), all("definicoes")]);
  const cont = {}; subs.forEach(s => (s.equipas || []).forEach(k => { if (k !== "teste") cont[k] = (cont[k] || 0) + 1; }));
  const nomeChave = k => { const m = /^(\d+)(?:-([B-D]))?(?:-(F|S\d+))?$/.exec(k); if (!m) return k; const c = club(+m[1]); return (c ? clubName(c) : k) + (m[2] ? " " + m[2] : "") + (m[3] ? " · " + (m[3] === "F" ? "Feminino" : "Sub-" + m[3].slice(1)) : ""); };
  const top = Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const u = defs.find(d => d.chave === "ultima_atualizacao")?.valor || {};
  return { html: `<h1>Notificações</h1>
    ${!ativo ? `<div class="card warn" style="margin-bottom:22px"><b style="font-size:18px">As notificações ainda não estão ligadas</b><p style="margin-top:8px">Segue os 3 passos abaixo (só é preciso fazer uma vez).</p></div>` : ""}
    <div class="cards" style="grid-template-columns:repeat(3,1fr)"><div class="card"><span>Aparelhos a seguir equipas</span><b>${subs.filter(s => (s.equipas || []).some(k => k !== "teste")).length}</b></div><div class="card"><span>Avisos enviados (últimos)</span><b>${envs.reduce((s, n) => s + (n.destinatarios || 0), 0)}</b><small>${envs.length} jogos</small></div><div class="card"><span>Última execução do robô</span><b style="font-size:18px">${u.quando ? new Date(u.quando).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }) : "—"}</b><small>envia os avisos e os testes</small></div></div>

    <h2>🔔 Enviar notificação de teste</h2>
    <div class="form" style="grid-template-columns:1fr 1fr">
      <div class="fld"><label>1. Teste rápido neste aparelho<small>Mostra já uma notificação aqui. Confirma que o navegador deixa mostrar notificações.</small></label><button class="btn o" id="tLocal" ${ativo ? "" : "disabled"}>Mostrar notificação agora</button></div>
      <div class="fld"><label>2. Teste completo pelo servidor<small>O robô envia-a como envia os avisos dos jogos. Chega na próxima execução (até 10 min)${CFG.GITHUB_REPO ? ", ou já, se correres o robô à mão" : ""}.</small></label><button class="btn" id="tServidor" ${ativo ? "" : "disabled"}>Enviar teste para este aparelho</button>${CFG.GITHUB_REPO ? `<a class="link" style="margin-top:6px" target="_blank" href="https://github.com/${esc(CFG.GITHUB_REPO)}/actions/workflows/scrape.yml">Correr o robô agora ↗ (Run workflow → rápido)</a>` : ""}</div>
    </div>
    ${man.length ? `<table class="tbl" style="margin-top:14px"><thead><tr><th>Teste / aviso</th><th>Pedido</th><th>Enviado</th><th>Aparelhos</th></tr></thead><tbody>${man.map(n => `<tr><td><b>${esc(n.titulo)}</b></td><td>${new Date(n.criado_em).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" })}</td><td>${n.enviado_em ? new Date(n.enviado_em).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : '<span class="tag">à espera do robô</span>'}</td><td>${n.destinatarios ?? "—"}</td></tr>`).join("")}</tbody></table>` : ""}

    <h2>Equipas mais seguidas</h2>${top.length ? `<table class="tbl"><tbody>${top.map(([k, n]) => `<tr><td><b>${esc(nomeChave(k))}</b></td><td>${n} aparelho${n === 1 ? "" : "s"}</td></tr>`).join("")}</tbody></table>` : `<p class="hint">Ainda ninguém segue equipas.</p>`}
    <h2>Últimos avisos automáticos</h2>${envs.length ? `<table class="tbl"><thead><tr><th>Jogo</th><th>Tipo</th><th>Quando</th><th>Aparelhos</th></tr></thead><tbody>${envs.map(n => `<tr><td>${n.jogo_id}</td><td>${n.tipo === "inicio" ? "🏒 Início" : "🏁 Final"}</td><td>${new Date(n.enviado_em).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" })}</td><td>${n.destinatarios}</td></tr>`).join("")}</tbody></table>` : `<p class="hint">Ainda não foram enviados avisos de jogos.</p>`}

    <h2>⚙️ Ligar as notificações (uma vez)</h2>
    <div class="form" style="grid-template-columns:1fr">
      <div class="fld"><label>Passo 1 — Gerar as chaves<small>${ativo ? "⚠️ Já tens chaves configuradas. Se gerares novas, todos os aparelhos que seguem equipas deixam de receber avisos." : "Carrega no botão. As chaves são criadas aqui no teu navegador e não são enviadas a lado nenhum."}</small></label><button class="btn ${ativo ? "o" : ""}" id="gerar" style="width:max-content">Gerar chaves</button><div id="chaves"></div></div>
    </div>`,
    after: () => {
      $("#gerar").onclick = async () => {
        if (ativo && !confirmBox("Já tens chaves. Gerar novas desliga os avisos de quem já segue equipas. Continuar?")) return;
        const k = await gerarChaves();
        $("#chaves").innerHTML = `<div class="kbox"><b>Passo 2 — Chave PÚBLICA → <code>config.js</code></b><p>No GitHub, edita o <code>config.js</code> e põe:</p><pre>VAPID_PUBLIC_KEY: "${k.pub}",</pre><button type="button" class="btn sm o" data-cp="VAPID_PUBLIC_KEY: &quot;${k.pub}&quot;,">Copiar</button></div>
          <div class="kbox"><b>Passo 3 — Chave PRIVADA → segredo do GitHub</b><p>Em <b>Settings → Secrets and variables → Actions → New repository secret</b> cria:</p><p>Nome <code>VAPID_PRIVATE_KEY</code> e valor:</p><pre>${k.priv}</pre><button type="button" class="btn sm o" data-cp="${k.priv}">Copiar</button><p style="margin-top:10px">E outro: nome <code>VAPID_SUBJECT</code>, valor <code>mailto:o-teu-email@gmail.com</code></p><p class="hint" style="margin-top:8px">⚠️ A chave privada nunca vai para o site nem para o config.js. Guarda-a só no segredo do GitHub. Esta página não a guarda: se fechares sem a copiar, gera outra.</p></div>`;
        document.querySelectorAll("[data-cp]").forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.cp); toast("Copiado ✓"); } catch (e) { toast("Seleciona o texto e copia", 1); } });
      };
      if ($("#tLocal")) $("#tLocal").onclick = async () => { try { if (await Notification.requestPermission() !== "granted") throw new Error("As notificações estão bloqueadas neste navegador."); const reg = await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready; await reg.showNotification("🔔 Teste — Hóquei em Português", { body: "Se estás a ver isto, este aparelho mostra notificações.", icon: "/icones/icon-192.png" }); toast("Notificação mostrada ✓"); } catch (e) { toast(e.message, 1); } };
      if ($("#tServidor")) $("#tServidor").onclick = async () => {
        try {
          const { sub } = await esteAparelho(); const j = sub.toJSON();
          const { error } = await sb.rpc("subscrever", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_equipas: ["teste"] });
          if (error) throw error;
          if (await save("notificacoes_manuais", { id: "new", titulo: "🏁 Teste: Hóquei em Português", corpo: "Se recebeste isto, as notificações dos jogos estão a funcionar ✓", url: "/", destino: "endpoint", endpoint: j.endpoint })) { toast("Pedido enviado. Chega na próxima execução do robô."); route(); }
        } catch (e) { toast(e.message || "Erro", 1); }
      };
    } };
};

/* --- Competições --- */
const provaKey = c => "g" + (c.grupo_id ?? c.grupo ?? "c" + c.id);
const provaAuto = t => String(t || "").replace(/\s+de\s+Hóquei em Patins/i, "").replace(/^Campeonato Nacional\s+/i, "").replace(/^Seniores\s+/i, "").replace(/\bPLACARD\b/g, "").trim().replace(/^Femininos?$/i, "Feminino").replace(/^Sub\s*(\d+)$/i, "Sub-$1").replace(/^Super\s*Taça$/i, "Supertaça");
S.competicoes = async () => {
  const grupos = new Map();
  D.comps.forEach(c => { const k = provaKey(c); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(c); });
  const linhaComp = c => `<tr data-id="${c.id}"><td><b>${esc(c.nome)}</b><br><small>id ${c.id}</small></td>
    <td><input class="in" data-k="zona" value="${esc(c.zona || "")}" placeholder="automático" title="Nome do separador dentro da prova (ex.: Norte, Sul A, Feminina)"></td>
    <td><input class="in" data-k="nome_curto" value="${esc(c.nome_curto)}" placeholder="${esc(c.nome)}"></td>
    <td><select class="in" data-k="formato"><option value="auto" ${!c.formato || c.formato === "auto" ? "selected" : ""}>Automático</option><option value="liga" ${c.formato === "liga" ? "selected" : ""}>Classificação</option><option value="eliminatoria" ${c.formato === "eliminatoria" ? "selected" : ""}>Quadro (taça)</option></select></td>
    <td><input class="in" type="number" data-k="ordem" value="${esc(c.ordem)}" style="width:64px"></td>
    <td><input class="in" type="number" data-k="duracao_parte" value="${esc(c.duracao_parte ?? 25)}" style="width:64px" title="Duração de cada parte, para calcular o minuto dos golos"></td>
    <td><input type="checkbox" data-k="ativa" ${c.ativa ? "checked" : ""}></td><td><input type="radio" name="pr" data-k="principal" ${c.principal ? "checked" : ""}></td><td><button class="btn sm">Guardar</button></td></tr>`;
  return {
    html: `<h1>Competições</h1><p class="hint">As competições estão agrupadas por <b>prova</b>, como no hp.fpp.pt (ex.: a <b>2ª Divisão</b> tem os separadores <b>Norte</b> e <b>Sul</b>). No site, o menu mostra só as provas; dentro de cada uma aparecem os separadores.<br>
      <b>Prova</b>: o nome no menu e o sítio onde aparece (“Competição principal” = em destaque; “Mais competições” = na lista). <b>Separador</b>: o nome dentro da prova (vazio = automático). <b>Cor do tema</b>: se preencheres, o site veste essa cor e mostra a intro animada ao entrar na prova (as competições WSE já têm cor automática). <b>Formato</b>: “Automático” mostra um quadro (bracket) nas taças, supertaças, Elite Cup e play-offs, e a classificação nas restantes; muda só se o automático errar.<br>
      Desliga “ativa” nas que não queres no site (o robô deixa de as atualizar). “Página inicial” é a competição da tabela da página inicial. “Parte” é a duração de cada parte em minutos (serve para o minuto dos golos).</p>
    <div style="overflow-x:auto"><table class="tbl provas"><thead><tr><th>Competição oficial</th><th>Separador</th><th>Nome curto</th><th>Formato</th><th>Ordem</th><th>Parte</th><th>Ativa</th><th>Página inicial</th><th></th></tr></thead><tbody>
    ${[...grupos.entries()].map(([k, cs]) => { const nomeP = cs.map(c => c.grupo_curto).find(Boolean) || "", menu = cs.some(c => c.menu === "principal") ? "principal" : "mais";
      return `<tr class="prova" data-g="${esc(k)}"><td colspan="9"><div class="pv"><span class="lbl">Prova</span><input class="in" data-gk="grupo_curto" value="${esc(nomeP)}" placeholder="${esc(provaAuto(cs[0].grupo || cs[0].nome))}"><select class="in" data-gk="menu"><option value="principal" ${menu === "principal" ? "selected" : ""}>Competição principal</option><option value="mais" ${menu !== "principal" ? "selected" : ""}>Mais competições</option></select><input class="in" data-gk="tema_cor" value="${esc(cs.map(c => c.tema_cor).find(Boolean) || "")}" placeholder="cor do tema (ex.: #1746A2)" style="min-width:0;width:190px;font-weight:400" title="Cor do tema da prova no site. Vazio = cores normais (as competições WSE têm cor automática)."><button class="btn sm" data-prova>Guardar prova</button><small>${esc(cs[0].grupo || "")}</small></div></td></tr>${cs.map(linhaComp).join("")}`; }).join("") || `<tr><td colspan="9">Sem competições (corre o robô em modo “completo”).</td></tr>`}
    </tbody></table></div>`,
    after: () => {
      document.querySelectorAll("tr[data-id] button").forEach(b => b.onclick = async () => {
        const tr = b.closest("tr"), id = +tr.dataset.id, r = { id };
        tr.querySelectorAll("[data-k]").forEach(i => r[i.dataset.k] = i.type === "checkbox" || i.type === "radio" ? i.checked : i.type === "number" ? (+i.value || (i.dataset.k === "duracao_parte" ? 25 : 100)) : (i.value.trim() || null));
        if (!r.formato) r.formato = "auto";
        if (r.principal) for (const c of D.comps.filter(c => c.principal && c.id !== id)) { await sb.from("competicoes").update({ principal: false }).eq("id", c.id); c.principal = false; }
        if (await save("competicoes", r)) Object.assign(D.comps.find(c => c.id === id), r);
      });
      document.querySelectorAll("[data-prova]").forEach(b => b.onclick = async () => {
        const tr = b.closest("tr"), cs = grupos.get(tr.dataset.g), r = {};
        tr.querySelectorAll("[data-gk]").forEach(i => r[i.dataset.gk] = i.value.trim() || null);
        r.menu = r.menu || "mais";
        if (r.tema_cor && !/^#[0-9a-f]{6}$/i.test(r.tema_cor)) return toast("A cor do tema tem de ser do género #1746A2.", 1);
        const { error } = await sb.from("competicoes").update(r).in("id", cs.map(c => c.id));
        if (error) return toast("Erro: " + error.message, 1);
        cs.forEach(c => Object.assign(c, r)); toast("Prova guardada ✓");
      });
    }
  };
};

/* --- Zonas das tabelas (play-offs, subidas e descidas) --- */
const ZONAS = { campeao: ["Play-off de apuramento de campeão", "#C9A227"], playoff: ["Play-off", "#2F6FB5"], subida: ["Sobe de divisão", "#1E8E5A"], playoff_subida: ["Play-off de subida", "#62B88E"], playoff_descida: ["Play-off de descida", "#E08A2E"], descida: ["Desce de divisão", "#C0392B"] };
S.zonas = async () => {
  const c = +(sessionStorage.zc || D.comps.find(x => x.principal)?.id || D.comps[0]?.id);
  const comp = D.comps.find(x => x.id === c);
  const cls = c ? await all("classificacao", x => x.eq("competicao_id", c).order("pos")) : [];
  const eqs = D.equipas.filter(e => e.competicao_id === c);
  const lugares = cls.length ? cls.map(r => ({ pos: r.pos, nome: teamName(r.equipa_id) })) : eqs.map((e, i) => ({ pos: i + 1, nome: "—" }));
  const n = lugares.length;
  let zs = (Array.isArray(comp?.zonas) ? comp.zonas : []).map(z => ({ ...z }));
  const linha = (z, i) => `<div class="zrow" data-i="${i}"><select class="in" data-k="tipo">${Object.entries(ZONAS).map(([k, v]) => `<option value="${k}" ${z.tipo === k ? "selected" : ""}>${v[0]}</option>`).join("")}</select>
    <span>do</span><input class="in" type="number" min="1" data-k="de" value="${esc(z.de ?? "")}" placeholder="1"><span>ao</span><input class="in" type="number" min="1" data-k="ate" value="${esc(z.ate ?? "")}" placeholder="${n || 4}"><span>lugar</span>
    <input class="in" data-k="nome" value="${esc(z.nome || "")}" placeholder="Nome (opcional)"><button class="btn sm o" data-x title="Tirar">✕</button></div>`;
  return {
    html: `<h1>Zonas das tabelas</h1><p class="hint">Escolhe a competição e diz que lugares vão a play-off, sobem ou descem. No site, esses lugares ficam com a cor da zona e aparece uma legenda por baixo da tabela. O “Nome” é opcional: serve para escreveres, por exemplo, “Final Four” ou “Liguilha”. Os atalhos ao lado preenchem as zonas mais comuns; podes acertar os números depois.</p>
    <div class="filters"><select id="zc">${optComps(c, false)}</select>${n ? `<span class="hint" style="margin:0">${n} equipas na tabela</span>` : ""}</div>
    <div class="zgrid"><div><div id="zlist"></div>
      <div class="zbtns"><button class="btn sm o" id="zadd">+ Adicionar zona</button><button class="btn sm o" data-q="campeao">Play-off de campeão</button><button class="btn sm o" data-q="playoff">Play-off</button><button class="btn sm o" data-q="subida">Sobe</button><button class="btn sm o" data-q="playoff_subida">Play-off de subida</button><button class="btn sm o" data-q="playoff_descida">Play-off de descida</button><button class="btn sm o" data-q="descida">Desce</button></div>
      <p><button class="btn" id="zsave">Guardar zonas</button></p></div>
      <div><span class="hint">Pré-visualização</span><table class="tbl zprev"><tbody id="zprev"></tbody></table></div></div>`,
    after: () => {
      $("#zc").onchange = e => { sessionStorage.zc = e.target.value; route(); };
      const ler = () => { zs = [...document.querySelectorAll(".zrow")].map(r => { const z = {}; r.querySelectorAll("[data-k]").forEach(i => z[i.dataset.k] = i.type === "number" ? (i.value === "" ? null : +i.value) : i.value.trim()); if (!z.nome) delete z.nome; return z; }); };
      const prev = () => {
        const zona = p => zs.find(z => z.de && z.ate && p >= z.de && p <= z.ate);
        $("#zprev").innerHTML = (n ? lugares : Array.from({ length: 12 }, (_, i) => ({ pos: i + 1, nome: "—" }))).map(l => { const z = zona(l.pos); return `<tr><td style="width:44px"><span class="zpos" style="${z ? `background:${ZONAS[z.tipo][1]};color:#fff` : ""}">${l.pos}</span></td><td>${esc(l.nome)}</td><td><small>${z ? esc(z.nome || ZONAS[z.tipo][0]) : ""}</small></td></tr>`; }).join("");
      };
      const desenhar = () => { $("#zlist").innerHTML = zs.map(linha).join("") || `<p class="hint">Sem zonas nesta competição.</p>`; prev();
        document.querySelectorAll(".zrow [data-k]").forEach(i => i.oninput = () => { ler(); prev(); });
        document.querySelectorAll(".zrow [data-x]").forEach(b => b.onclick = () => { ler(); zs.splice(+b.closest(".zrow").dataset.i, 1); desenhar(); }); };
      const N = n || 12;
      const atalho = { campeao: [1, 4], playoff: [1, 8], subida: [1, 1], playoff_subida: [2, 2], playoff_descida: [Math.max(1, N - 2), Math.max(1, N - 2)], descida: [Math.max(1, N - 1), N] };
      $("#zadd").onclick = () => { ler(); zs.push({ tipo: "playoff", de: null, ate: null }); desenhar(); };
      document.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { ler(); const [de, ate] = atalho[b.dataset.q]; zs.push({ tipo: b.dataset.q, de, ate }); desenhar(); });
      $("#zsave").onclick = async () => {
        ler();
        const bons = zs.filter(z => z.de && z.ate);
        const mal = bons.find(z => z.de > z.ate || (n && z.ate > n));
        if (mal) return toast(`Verifica a zona “${mal.nome || ZONAS[mal.tipo][0]}”: o primeiro lugar tem de ser menor que o último${n ? ` e não pode passar do ${n}.º` : ""}.`, 1);
        bons.sort((a, b) => a.de - b.de);
        const choque = bons.find((z, i) => i && z.de <= bons[i - 1].ate);
        if (choque) return toast(`Há duas zonas com os mesmos lugares (${choque.de}.º). Cada lugar só pode estar numa zona.`, 1);
        if (await save("competicoes", { id: c, zonas: bons })) { comp.zonas = bons; zs = bons.map(z => ({ ...z })); desenhar(); }
      };
      desenhar();
    }
  };
};

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
  return { html: `<h1>Textos do site</h1><form class="form" id="frm">${field({ k: "sobre", l: "Página “Sobre nós”", t: "corpo" }, g("sobre"))}${field({ k: "selecoes", l: "Página “Seleções” (texto de introdução)", t: "corpo" }, g("selecoes"))}${field({ k: "privacidade", l: "Política de privacidade e cookies", t: "corpo", help: "se ficar vazio, o site usa o texto-modelo que já vem preparado" }, g("privacidade"))}<div class="bar"><button class="btn">Guardar</button></div></form>`,
    after: () => { wireForm($("#frm")); $("#frm").onsubmit = async e => { e.preventDefault(); await save("definicoes", [{ chave: "sobre", valor: { texto: $("#f_sobre").value } }, { chave: "selecoes", valor: { texto: $("#f_selecoes").value } }, { chave: "privacidade", valor: $("#f_privacidade").value.trim() ? { texto: $("#f_privacidade").value, atualizado: new Date().toLocaleDateString("pt-PT", { month: "long", year: "numeric" }) } : null }], "chave"); }; } };
};

/* ---------- navegação ---------- */
const NAV = [["painel", "Painel"], ["noticias", "Notícias"], ["jogos", "Jogos e TV"], ["equipa_jornada", "Equipa da jornada"], ["mercado", "Mercado"], ["patrocinios", "Patrocínios"], ["notificacoes", "Notificações"], ["jogadores", "Jogadores"], ["clubes", "Clubes"], ["competicoes", "Competições"], ["zonas", "Zonas das tabelas"], ["mensagens", "Mensagens"], ["newsletter", "Newsletter"], ["definicoes", "Textos do site"]];
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
