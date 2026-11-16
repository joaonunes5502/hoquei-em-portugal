-- =====================================================================
--  HÓQUEI EM PORTUGUÊS — atualização 2
--  Patrocínios, duração das partes e novos tipos de acontecimentos.
--  Cola no Supabase: SQL Editor > New query > Run. Pode correr mais do que uma vez.
-- =====================================================================

-- duração de cada parte (minutos) por competição, para calcular o minuto dos golos
alter table competicoes add column if not exists duracao_parte int not null default 25;

-- ---------- PATROCÍNIOS ----------
create table if not exists patrocinios (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,                 -- nome do patrocinador (só para ti)
  imagem_url text,                          -- banner
  link       text,                          -- para onde vai quem clica
  texto      text,                          -- texto alternativo / "Patrocinado por …"
  posicao    text not null default 'inicio',-- inicio | jogo | noticia | rodape | equipa_jornada | competicao
  ativo      boolean not null default true,
  inicio     date,                          -- opcional: começa a aparecer
  fim        date,                          -- opcional: deixa de aparecer
  ordem      int not null default 100,
  vistas     int not null default 0,
  cliques    int not null default 0,
  criado_em  timestamptz default now()
);
alter table patrocinios enable row level security;
drop policy if exists admin_tudo on patrocinios;
create policy admin_tudo on patrocinios for all using (is_admin()) with check (is_admin());
drop policy if exists leitura_publica on patrocinios;
create policy leitura_publica on patrocinios for select
  using (ativo and (inicio is null or inicio <= current_date) and (fim is null or fim >= current_date));

-- contar vistas e cliques sem dar ao público permissão para editar a tabela
create or replace function registar_patrocinio(ids uuid[], tipo text)
returns void language sql security definer set search_path = public as $$
  update patrocinios
     set vistas  = vistas  + case when tipo = 'vista'  then 1 else 0 end,
         cliques = cliques + case when tipo = 'clique' then 1 else 0 end
   where id = any(ids) and ativo;
$$;
grant execute on function registar_patrocinio(uuid[], text) to anon, authenticated;

-- ---------- REFAZER A TIMELINE DOS JOGOS ----------
-- O robô passou a distinguir golos de penálti/livre direto, falhados e defesas.
-- Isto obriga-o a voltar a ler todos os jogos na próxima execução "completo".
update jogos set detalhes_em = null where golos_casa is not null;
