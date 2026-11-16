-- =====================================================================
--  HÓQUEI EM PORTUGUÊS — atualização 4: notificações
--  Subscrições anónimas (sem login) e registo do que já foi enviado.
--  Cola no Supabase: SQL Editor > New query > Run. Pode correr mais do que uma vez.
-- =====================================================================

create table if not exists subscricoes (
  endpoint   text primary key,          -- "endereço de entrega" do navegador (anónimo)
  p256dh     text not null,
  auth       text not null,
  equipas    text[] not null default '{}', -- equipas seguidas (ex.: 123, 123-B, 123-F)
  criado_em  timestamptz default now(),
  atualizado_em timestamptz default now(),
  enviadas   int not null default 0
);
create index if not exists subscricoes_equipas_idx on subscricoes using gin (equipas);

create table if not exists notificacoes_enviadas (
  jogo_id   int references jogos(id) on delete cascade,
  tipo      text,                         -- inicio | final
  enviado_em timestamptz default now(),
  destinatarios int default 0,
  primary key (jogo_id, tipo)
);

alter table subscricoes enable row level security;
alter table notificacoes_enviadas enable row level security;
drop policy if exists admin_tudo on subscricoes;
create policy admin_tudo on subscricoes for all using (is_admin()) with check (is_admin());
drop policy if exists admin_tudo on notificacoes_enviadas;
create policy admin_tudo on notificacoes_enviadas for all using (is_admin()) with check (is_admin());
-- o público não lê nem escreve nestas tabelas diretamente: só através das funções abaixo

-- seguir / atualizar as equipas seguidas por este aparelho
create or replace function subscrever(p_endpoint text, p_p256dh text, p_auth text, p_equipas text[])
returns void language sql security definer set search_path = public as $$
  insert into subscricoes (endpoint, p256dh, auth, equipas)
  values (p_endpoint, p_p256dh, p_auth, coalesce(p_equipas, '{}'))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, equipas = excluded.equipas, atualizado_em = now();
  delete from subscricoes where endpoint = p_endpoint and cardinality(equipas) = 0;
$$;

-- deixar de receber tudo neste aparelho
create or replace function cancelar_subscricao(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from subscricoes where endpoint = p_endpoint;
$$;

grant execute on function subscrever(text, text, text, text[]) to anon, authenticated;
grant execute on function cancelar_subscricao(text) to anon, authenticated;

-- ---------- notificações manuais / de teste (backoffice) ----------
-- O backoffice põe aqui o pedido; o robô envia-o na execução seguinte.
create table if not exists notificacoes_manuais (
  id          uuid primary key default gen_random_uuid(),
  titulo      text not null,
  corpo       text,
  url         text default '/',
  destino     text not null default 'endpoint',  -- endpoint (um aparelho) | todos
  endpoint    text,
  criado_em   timestamptz default now(),
  enviado_em  timestamptz,
  destinatarios int
);
alter table notificacoes_manuais enable row level security;
drop policy if exists admin_tudo on notificacoes_manuais;
create policy admin_tudo on notificacoes_manuais for all using (is_admin()) with check (is_admin());
