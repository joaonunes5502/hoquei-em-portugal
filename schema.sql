create table noticias (
  id bigint generated always as identity primary key,
  titulo text not null, categoria text not null default 'Geral', resumo text, corpo text not null, imagem_url text,
  publicada boolean not null default true,
  criada_em timestamptz not null default now()
);
create table jogos (
  competicao int not null, id int not null, jornada int not null,
  data timestamptz not null, casa text not null, fora text not null,
  golos_casa int, golos_fora int, atualizado_em timestamptz default now(),
  primary key (competicao, id)
);
alter table noticias enable row level security;
alter table jogos enable row level security;
create policy "ler noticias" on noticias for select using (publicada);
create policy "admin noticias" on noticias for all to authenticated using (true) with check (true);
create policy "ler jogos" on jogos for select using (true);
