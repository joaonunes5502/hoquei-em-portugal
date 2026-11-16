-- Hóquei em Português · atualização 5
-- Zonas das classificações (play-offs, subidas e descidas), editadas no backoffice > Zonas das tabelas.
-- Cada zona: {"tipo": "campeao|playoff|subida|playoff_subida|playoff_descida|descida", "de": 1, "ate": 4, "nome": "opcional"}
alter table competicoes add column if not exists zonas jsonb not null default '[]'::jsonb;
