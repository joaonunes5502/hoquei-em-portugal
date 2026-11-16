-- =====================================================================
--  HÓQUEI EM PORTUGUÊS — base de dados (Supabase / PostgreSQL)
--  Cola tudo isto no Supabase: SQL Editor > New query > Run.
--  Pode ser corrido mais do que uma vez sem estragar nada.
-- =====================================================================

-- ---------- ADMINISTRADORES (quem pode entrar no backoffice) ----------
create table if not exists admins (
  email text primary key
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

-- ---------- DADOS QUE VÊM DO hp.fpp.pt (o robô preenche) ----------
-- Colunas marcadas "manual" nunca são tocadas pelo robô: edita-as no backoffice.

create table if not exists competicoes (
  id            int primary key,                 -- id do hp.fpp.pt (ex.: 493)
  nome          text not null,
  grupo         text,                            -- ex.: "Campeonato Nacional 2ª Divisão"
  grupo_id      int,
  epoca         int,
  atualizado_em timestamptz default now(),
  -- manual
  nome_curto    text,
  ativa         boolean not null default true,   -- aparece no site e o robô atualiza
  principal     boolean not null default false,  -- competição da página inicial
  ordem         int not null default 100
);

create table if not exists clubes (
  id          int primary key,                   -- id do emblema (CLUBE_123.png -> 123)
  nome        text not null,
  logo_url    text,
  -- manual
  nome_curto  text,
  cor         text,                              -- ex.: #0E5FA8
  cidade      text,
  pavilhao    text,
  instagram   text,
  descricao   text,
  logo_custom text
);

create table if not exists equipas (
  id             int primary key,                -- id da equipa no hp.fpp.pt (Equipa/493/1182 -> 1182)
  competicao_id  int references competicoes(id) on delete cascade,
  clube_id       int references clubes(id),
  nome           text not null,
  golos_marcados int,
  golos_sofridos int,
  faltas         int,
  plantel_em     timestamptz
);

create table if not exists classificacao (
  competicao_id int references competicoes(id) on delete cascade,
  equipa_id     int references equipas(id) on delete cascade,
  pos int, pts int, j int, v int, e int, d int, gm int, gs int, dg int,
  primary key (competicao_id, equipa_id)
);

create table if not exists jogos (
  id            int primary key,                 -- id do jogo (jogo/18727 -> 18727)
  competicao_id int references competicoes(id) on delete cascade,
  jornada       int,
  jornada_nome  text,
  numero        int,
  data          date,
  hora          text,
  casa_id       int references equipas(id),
  fora_id       int references equipas(id),
  golos_casa    int,
  golos_fora    int,
  estado        text default 'agendado',         -- agendado | provisorio | final
  tv_url        text,
  arbitros      text,
  faltas_casa   int,
  faltas_fora   int,
  detalhes_em   timestamptz,
  -- manual
  canal_tv      text,                            -- ex.: "Sport TV 2"
  destaque      boolean not null default false,
  nota          text
);
create index if not exists jogos_data_idx on jogos(data);
create index if not exists jogos_comp_idx on jogos(competicao_id, jornada);

create table if not exists eventos (
  id        bigserial primary key,
  jogo_id   int references jogos(id) on delete cascade,
  ordem     int,
  parte     text,                                -- "1ª Parte", "2ª Parte", ...
  tempo     text,                                -- "13:05"
  tipo      text,                                -- golo | azul | amarelo | vermelho | falta | desconto
  lado      text,                                -- casa | fora
  jogador   text,
  jogador_id int
);
create index if not exists eventos_jogo_idx on eventos(jogo_id);

create table if not exists jogadores (
  id         bigint primary key,                 -- n.º de federado (FED_161550 -> 161550); negativo = criado à mão
  nome       text not null,
  foto_url   text,
  numero     int,                                -- da última ficha de jogo
  -- manual
  nome_publico   text,
  numero_manual  int,
  posicao        text,                           -- Guarda-redes | Defesa | Médio | Avançado
  nacionalidade  text,
  data_nascimento date,
  foto_custom    text,
  bio            text,
  visivel        boolean not null default true
);

create table if not exists plantel (
  equipa_id  int references equipas(id) on delete cascade,
  jogador_id bigint references jogadores(id) on delete cascade,
  golos      int default 0,
  manual     boolean not null default false,
  primary key (equipa_id, jogador_id)
);

create table if not exists tecnicos (
  equipa_id int references equipas(id) on delete cascade,
  nome      text,
  funcao    text,
  foto_url  text,
  primary key (equipa_id, nome)
);

create table if not exists marcadores (
  competicao_id int references competicoes(id) on delete cascade,
  jogador_id    bigint references jogadores(id) on delete cascade,
  pos   int,
  nome  text,
  clube_id int references clubes(id),
  golos int,
  primary key (competicao_id, jogador_id)
);

-- ---------- CONTEÚDO EDITORIAL (backoffice) ----------
create table if not exists noticias (
  id            uuid primary key default gen_random_uuid(),
  titulo        text not null,
  slug          text unique,
  resumo        text,
  corpo         text,                            -- texto (parágrafos separados por linha em branco)
  imagem_url    text,
  credito_foto  text,
  competicao_id int references competicoes(id) on delete set null,
  categoria     text,                            -- texto livre se não for uma competição (ex.: Seleções)
  clubes        int[] default '{}',
  destaque      boolean not null default false,
  publicado     boolean not null default false,
  publicado_em  timestamptz default now(),
  autor         text,
  criado_em     timestamptz default now()
);
create index if not exists noticias_pub_idx on noticias(publicado, publicado_em desc);

create table if not exists mercado (
  id          uuid primary key default gen_random_uuid(),
  jogador     text not null,
  jogador_id  bigint references jogadores(id) on delete set null,
  de_clube    int references clubes(id),
  para_clube  int references clubes(id),
  tipo        text default 'Contratação',        -- Contratação | Renovação | Empréstimo | Saída
  data        date default current_date,
  nota        text
);

create table if not exists equipa_jornada (
  id            uuid primary key default gen_random_uuid(),
  competicao_id int references competicoes(id) on delete set null,
  jornada       int,
  titulo        text,
  jogadores     jsonb default '[]',  -- [{posicao,nome,clube_id,numero,nota,jogador_id}]
  treinador     text,
  treinador_clube int references clubes(id),
  publicado     boolean not null default false,
  criado_em     timestamptz default now()
);

create table if not exists definicoes (
  chave text primary key,
  valor jsonb
);

create table if not exists newsletter (
  email     text primary key,
  criado_em timestamptz default now()
);

create table if not exists mensagens (
  id        uuid primary key default gen_random_uuid(),
  nome      text, email text, assunto text, mensagem text,
  lida      boolean not null default false,
  criado_em timestamptz default now()
);

-- ---------- PERMISSÕES (Row Level Security) ----------
do $$
declare t text;
begin
  foreach t in array array['competicoes','clubes','equipas','classificacao','jogos','eventos','jogadores',
                           'plantel','tecnicos','marcadores','noticias','mercado','equipa_jornada','definicoes',
                           'newsletter','mensagens','admins']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists admin_tudo on %I', t);
    execute format('create policy admin_tudo on %I for all using (is_admin()) with check (is_admin())', t);
  end loop;

  -- leitura pública
  foreach t in array array['competicoes','clubes','equipas','classificacao','jogos','eventos','jogadores',
                           'plantel','tecnicos','marcadores','mercado','definicoes']
  loop
    execute format('drop policy if exists leitura_publica on %I', t);
    execute format('create policy leitura_publica on %I for select using (true)', t);
  end loop;
end $$;

drop policy if exists leitura_publica on noticias;
create policy leitura_publica on noticias for select using (publicado and publicado_em <= now());
drop policy if exists leitura_publica on equipa_jornada;
create policy leitura_publica on equipa_jornada for select using (publicado);

-- o público só pode inserir (subscrever / enviar mensagem), nunca ler
drop policy if exists inserir_publico on newsletter;
create policy inserir_publico on newsletter for insert with check (true);
drop policy if exists inserir_publico on mensagens;
create policy inserir_publico on mensagens for insert with check (true);

-- ---------- IMAGENS (Storage) ----------
insert into storage.buckets (id, name, public) values ('imagens','imagens', true)
on conflict (id) do nothing;

drop policy if exists "imagens leitura" on storage.objects;
create policy "imagens leitura" on storage.objects for select using (bucket_id = 'imagens');
drop policy if exists "imagens admin" on storage.objects;
create policy "imagens admin" on storage.objects for all
  using (bucket_id = 'imagens' and is_admin()) with check (bucket_id = 'imagens' and is_admin());

-- ---------- O TEU EMAIL DE ADMINISTRADOR ----------
-- Troca pelo email com que vais entrar no backoffice e corre esta linha:
-- insert into admins (email) values ('o-teu-email@exemplo.com') on conflict do nothing;
