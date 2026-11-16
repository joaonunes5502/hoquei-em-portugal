-- Hóquei em Português · atualização 7
-- Competições europeias (WSE): tema de cores + intro. Os jogos e classificações ainda não são lidos automaticamente.

-- cor do tema da prova (ex.: #1746A2); vazio = cores normais do site
alter table competicoes add column if not exists tema_cor text;

-- ficha dos jogos europeus: plantéis (só nomes), equipa técnica e pavilhão
alter table jogos add column if not exists ficha jsonb;

-- as 5 competições europeias (ids 900001+ para o robô do hp.fpp.pt as ignorar)
insert into competicoes (id, nome, grupo, grupo_id, ativa, principal, menu, ordem, formato) values
  (900001, 'WSE Champions League',       'WSE Champions League',       9001, true, false, 'mais', 201, 'liga'),
  (900002, 'WSE Champions League Women', 'WSE Champions League Women', 9002, true, false, 'mais', 202, 'liga'),
  (900003, 'WSE Cup',                    'WSE Cup',                    9003, true, false, 'mais', 203, 'auto'),
  (900004, 'WSE Cup Women',              'WSE Cup Women',              9004, true, false, 'mais', 204, 'auto'),
  (900005, 'WSE Trophy',                 'WSE Trophy',                 9005, true, false, 'mais', 205, 'auto')
on conflict (id) do nothing;
