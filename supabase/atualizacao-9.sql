-- Hóquei em Português · atualização 9
-- Contas de utilizador, palpites com pontos, ranking e loja.
-- Pode ser corrido mais do que uma vez sem estragar nada.

-- ============ configuração (editável no backoffice > Recompensas) ============
insert into definicoes (chave, valor) values
  ('recompensas', '{"ativo": true, "acerto": 10, "erro": 7, "direto": 1, "boas_vindas": 0}'::jsonb)
on conflict (chave) do nothing;

create or replace function rec(k text, omissao int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (valor ->> k)::int from definicoes where chave = 'recompensas'), omissao)
$$;

create or replace function rec_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (valor ->> 'ativo')::boolean from definicoes where chave = 'recompensas'), false)
$$;

-- ============ perfis ============
-- pontos = saldo para gastar na loja (nunca fica abaixo de 0); total = pontuação do ranking (ganhos e perdas, sem as compras)
create table if not exists perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  pontos int not null default 0,
  total int not null default 0,
  certos int not null default 0,
  errados int not null default 0,
  criado_em timestamptz not null default now()
);
alter table perfis enable row level security;
drop policy if exists perfis_leitura on perfis;
create policy perfis_leitura on perfis for select using (true);          -- o ranking é público (só nome e pontos; nunca o email)
drop policy if exists perfis_admin on perfis;
create policy perfis_admin on perfis for all using (is_admin()) with check (is_admin());

create table if not exists movimentos (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  pontos int not null,
  motivo text not null,          -- palpite | direto | loja | devolucao | ajuste | boas_vindas
  ref text not null default '',
  descricao text,
  criado_em timestamptz not null default now(),
  unique (user_id, motivo, ref)
);
create index if not exists movimentos_user on movimentos (user_id, criado_em desc);
alter table movimentos enable row level security;
drop policy if exists movimentos_meus on movimentos;
create policy movimentos_meus on movimentos for select using (user_id = auth.uid() or is_admin());

-- soma/tira pontos (uso interno). conta_ranking = false nas compras da loja.
create or replace function _pontuar(u uuid, p int, m text, r text, d text, conta_ranking boolean default true) returns boolean
language plpgsql security definer set search_path = public as $$
declare novo bigint;
begin
  insert into movimentos (user_id, pontos, motivo, ref, descricao) values (u, p, m, r, d)
    on conflict (user_id, motivo, ref) do nothing returning id into novo;
  if novo is null then return false; end if;
  update perfis set pontos = greatest(0, pontos + p), total = total + case when conta_ranking then p else 0 end where id = u;
  return true;
end $$;
revoke all on function _pontuar(uuid, int, text, text, text, boolean) from public, anon, authenticated;

-- cria o perfil quando alguém se regista
create or replace function novo_utilizador() returns trigger
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  -- nome para o ranking: o que a pessoa escolheu; senão o primeiro nome + inicial do apelido da conta Google ("João N."); senão o início do email
  n := nullif(trim(new.raw_user_meta_data ->> 'nome'), '');
  if n is null then
    n := nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')), '');
    if n is not null and position(' ' in n) > 0 then
      n := split_part(n, ' ', 1) || ' ' || upper(left(regexp_replace(n, '^.*\s', ''), 1)) || '.';
    end if;
  end if;
  n := left(coalesce(n, split_part(new.email, '@', 1), 'Adepto'), 30);
  insert into perfis (id, nome) values (new.id, n) on conflict (id) do nothing;
  if rec('boas_vindas', 0) > 0 then perform _pontuar(new.id, rec('boas_vindas', 0), 'boas_vindas', '', 'Pontos de boas-vindas'); end if;
  return new;
end $$;
drop trigger if exists ao_criar_utilizador on auth.users;
create trigger ao_criar_utilizador after insert on auth.users for each row execute function novo_utilizador();
-- quem já tinha conta (ex.: os administradores)
insert into perfis (id, nome) select id, left(split_part(email, '@', 1), 30) from auth.users on conflict (id) do nothing;

create or replace function definir_nome(p_nome text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Tens de entrar na tua conta.'; end if;
  if length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'O nome tem de ter pelo menos 2 letras.'; end if;
  update perfis set nome = left(trim(p_nome), 30) where id = auth.uid();
end $$;

create or replace function apagar_conta() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Tens de entrar na tua conta.'; end if;
  if is_admin() then raise exception 'As contas de administrador não se apagam por aqui.'; end if;
  delete from auth.users where id = auth.uid();     -- apaga em cascata perfil, palpites, movimentos e pedidos
end $$;

-- ============ palpites ============
create table if not exists palpites (
  user_id uuid not null references auth.users (id) on delete cascade,
  jogo_id int not null references jogos (id) on delete cascade,
  escolha text not null check (escolha in ('1', 'X', '2')),
  criado_em timestamptz not null default now(),
  resolvido boolean not null default false,
  pontos int,
  primary key (user_id, jogo_id)
);
create index if not exists palpites_jogo on palpites (jogo_id) where not resolvido;
alter table palpites enable row level security;
drop policy if exists palpites_meus on palpites;
create policy palpites_meus on palpites for select using (user_id = auth.uid() or is_admin());

-- hora de início de um jogo (hora de Portugal). Sem hora marcada, conta o início do dia.
create or replace function inicio_jogo(j jogos) returns timestamptz
language sql stable as $$
  select ((j.data::text || ' ' || coalesce(nullif(j.hora, ''), '00:00'))::timestamp at time zone 'Europe/Lisbon')
$$;

create or replace function palpitar(p_jogo int, p_escolha text) returns void
language plpgsql security definer set search_path = public as $$
declare j jogos;
begin
  if auth.uid() is null then raise exception 'Tens de entrar na tua conta.'; end if;
  if not rec_ativo() then raise exception 'Os palpites estão desligados.'; end if;
  if p_escolha not in ('1', 'X', '2') then raise exception 'Palpite inválido.'; end if;
  select * into j from jogos where id = p_jogo;
  if not found then raise exception 'Jogo não encontrado.'; end if;
  if j.data is null then raise exception 'Este jogo ainda não tem data marcada.'; end if;
  if j.golos_casa is not null or j.estado <> 'agendado' or inicio_jogo(j) <= now() then
    raise exception 'Os palpites deste jogo já fecharam.';
  end if;
  insert into palpites (user_id, jogo_id, escolha) values (auth.uid(), p_jogo, p_escolha)
    on conflict (user_id, jogo_id) do update set escolha = excluded.escolha, criado_em = now() where not palpites.resolvido;
end $$;

create or replace function retirar_palpite(p_jogo int) returns void
language plpgsql security definer set search_path = public as $$
declare j jogos;
begin
  select * into j from jogos where id = p_jogo;
  if found and (j.golos_casa is not null or j.estado <> 'agendado' or inicio_jogo(j) <= now()) then raise exception 'Os palpites deste jogo já fecharam.'; end if;
  delete from palpites where user_id = auth.uid() and jogo_id = p_jogo and not resolvido;
end $$;

-- quando um jogo termina, distribui os pontos; quando um jogo futuro ganha ficha (id novo), leva os palpites consigo
create or replace function ao_mudar_jogo() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record; res text; ganho int; nomes text;
begin
  if tg_op = 'INSERT' and new.id > 0 and new.numero is not null and new.competicao_id < 900000 then
    update palpites set jogo_id = new.id where jogo_id = -(new.competicao_id * 100000 + new.numero)
      and not exists (select 1 from palpites x where x.user_id = palpites.user_id and x.jogo_id = new.id);
  end if;
  if new.estado = 'final' and new.golos_casa is not null and new.golos_fora is not null then
    res := case when new.golos_casa > new.golos_fora then '1' when new.golos_casa < new.golos_fora then '2' else 'X' end;
    nomes := coalesce(new.casa_nome, (select nome from equipas where id = new.casa_id), '?') || ' ' || new.golos_casa || '-' || new.golos_fora || ' '
          || coalesce(new.fora_nome, (select nome from equipas where id = new.fora_id), '?');
    for p in select * from palpites where jogo_id = new.id and not resolvido loop
      -- só contam palpites feitos antes do início do jogo
      if new.data is not null and p.criado_em >= inicio_jogo(new) and nullif(new.hora, '') is not null then
        update palpites set resolvido = true, pontos = 0 where user_id = p.user_id and jogo_id = p.jogo_id;
        continue;
      end if;
      ganho := case when p.escolha = res then rec('acerto', 10) else -rec('erro', 7) end;
      update palpites set resolvido = true, pontos = ganho where user_id = p.user_id and jogo_id = p.jogo_id;
      perform _pontuar(p.user_id, ganho, 'palpite', new.id::text, nomes);
      update perfis set certos = certos + (p.escolha = res)::int, errados = errados + (p.escolha <> res)::int where id = p.user_id;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists jogos_palpites on jogos;
create trigger jogos_palpites after insert or update of estado, golos_casa, golos_fora on jogos
  for each row execute function ao_mudar_jogo();

-- ============ ponto por abrir um jogo em direto ============
create or replace function ponto_direto(p_jogo int) returns int
language plpgsql security definer set search_path = public as $$
declare j jogos; n int := rec('direto', 1);
begin
  if auth.uid() is null or n <= 0 or not rec_ativo() then return 0; end if;
  select * into j from jogos where id = p_jogo;
  if not found or j.data is null or j.estado = 'final' then return 0; end if;
  -- em direto: já começou (ou tem resultado provisório) e ainda não passaram 2h30 desde a hora marcada
  if not ((j.estado = 'provisorio' or (nullif(j.hora, '') is not null and inicio_jogo(j) <= now()))
          and inicio_jogo(j) > now() - interval '150 minutes' - case when nullif(j.hora, '') is null then interval '24 hours' else interval '0' end) then
    return 0;
  end if;
  if _pontuar(auth.uid(), n, 'direto', p_jogo::text, 'Jogo em direto') then return n; end if;
  return 0;
end $$;

-- ============ loja ============
create table if not exists loja_itens (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  imagem_url text,
  custo int not null check (custo >= 0),
  stock int,                      -- vazio = sem limite
  limite_por_pessoa int,          -- vazio = sem limite
  ativo boolean not null default true,
  ordem int not null default 100,
  criado_em timestamptz not null default now()
);
alter table loja_itens enable row level security;
drop policy if exists loja_leitura on loja_itens;
create policy loja_leitura on loja_itens for select using (ativo or is_admin());
drop policy if exists loja_admin on loja_itens;
create policy loja_admin on loja_itens for all using (is_admin()) with check (is_admin());

create table if not exists loja_pedidos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid references loja_itens (id) on delete set null,
  item_nome text not null,
  custo int not null,
  email text,
  contacto text,
  estado text not null default 'pendente' check (estado in ('pendente', 'entregue', 'cancelado')),
  nota text,
  criado_em timestamptz not null default now()
);
alter table loja_pedidos enable row level security;
drop policy if exists pedidos_meus on loja_pedidos;
create policy pedidos_meus on loja_pedidos for select using (user_id = auth.uid() or is_admin());
drop policy if exists pedidos_admin on loja_pedidos;
create policy pedidos_admin on loja_pedidos for update using (is_admin()) with check (is_admin());

create or replace function resgatar(p_item uuid, p_contacto text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare i loja_itens; saldo int; pid uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'Tens de entrar na tua conta.'; end if;
  select * into i from loja_itens where id = p_item and ativo for update;
  if not found then raise exception 'Este artigo já não está disponível.'; end if;
  if i.stock is not null and i.stock <= 0 then raise exception 'Este artigo esgotou.'; end if;
  if i.limite_por_pessoa is not null and (select count(*) from loja_pedidos where user_id = auth.uid() and item_id = i.id and estado <> 'cancelado') >= i.limite_por_pessoa then
    raise exception 'Já resgataste este artigo o número máximo de vezes.';
  end if;
  select pontos into saldo from perfis where id = auth.uid() for update;
  if coalesce(saldo, 0) < i.custo then raise exception 'Não tens pontos suficientes (tens %, precisas de %).', coalesce(saldo, 0), i.custo; end if;
  if i.stock is not null then update loja_itens set stock = stock - 1 where id = i.id; end if;
  insert into loja_pedidos (id, user_id, item_id, item_nome, custo, email, contacto)
    values (pid, auth.uid(), i.id, i.nome, i.custo, auth.jwt() ->> 'email', nullif(trim(coalesce(p_contacto, '')), ''));
  perform _pontuar(auth.uid(), -i.custo, 'loja', pid::text, i.nome, false);
  return pid;
end $$;

-- backoffice: cancelar um pedido devolve os pontos e o stock
create or replace function cancelar_pedido(p_pedido uuid, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p loja_pedidos;
begin
  if not is_admin() then raise exception 'Só para administradores.'; end if;
  select * into p from loja_pedidos where id = p_pedido for update;
  if not found or p.estado = 'cancelado' then return; end if;
  update loja_pedidos set estado = 'cancelado', nota = coalesce(p_nota, nota) where id = p.id;
  update loja_itens set stock = stock + 1 where id = p.item_id and stock is not null;
  perform _pontuar(p.user_id, p.custo, 'devolucao', p.id::text, 'Devolução: ' || p.item_nome, false);
end $$;

-- backoffice: dar ou tirar pontos à mão
create or replace function ajustar_pontos(p_user uuid, p_pontos int, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Só para administradores.'; end if;
  perform _pontuar(p_user, p_pontos, 'ajuste', extract(epoch from clock_timestamp())::text, coalesce(nullif(trim(p_motivo), ''), 'Ajuste'));
end $$;

-- posição no ranking
create or replace function minha_posicao() returns int
language sql stable security definer set search_path = public as $$
  select (select count(*) + 1 from perfis o where o.total > p.total)::int from perfis p where p.id = auth.uid()
$$;

grant execute on function definir_nome(text), apagar_conta(), palpitar(int, text), retirar_palpite(int), ponto_direto(int),
  resgatar(uuid, text), minha_posicao() to authenticated;
grant execute on function cancelar_pedido(uuid, text), ajustar_pontos(uuid, int, text) to authenticated;
revoke execute on function palpitar(int, text), retirar_palpite(int), ponto_direto(int), resgatar(uuid, text), definir_nome(text), apagar_conta(), minha_posicao() from anon;
