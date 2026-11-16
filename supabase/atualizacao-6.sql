-- Hóquei em Português · atualização 6
-- Provas agrupadas (2ª Divisão > Norte / Sul ...) e quadros das taças.

-- nome da prova no site (ex.: "2ª Divisão"); igual em todas as competições do mesmo grupo
alter table competicoes add column if not exists grupo_curto text;
-- nome do separador dentro da prova (ex.: "Norte", "Sul A"); vazio = automático
alter table competicoes add column if not exists zona text;
-- 'auto' | 'liga' (classificação) | 'eliminatoria' (quadro/bracket)
alter table competicoes add column if not exists formato text not null default 'auto';

-- jogos das taças: o calendário da FPP só traz o nome das equipas
alter table jogos add column if not exists casa_nome text;
alter table jogos add column if not exists fora_nome text;
