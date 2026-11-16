-- Hóquei em Português · atualização 8
-- Corrige a final da Elite Cup Feminina: o hp.fpp.pt ligou o Benfica à equipa masculina (1181) em vez da feminina (1192),
-- e as jogadoras ficaram no plantel masculino. O robô novo já não cai nisto; aqui limpa-se o que ficou guardado.

update jogos set casa_id = 1192, detalhes_em = null where id = 1000100894 and casa_id = 1181;
update jogos set fora_id = 1192, detalhes_em = null where id = 1000100894 and fora_id = 1181;

delete from plantel
 where equipa_id = 1181 and coalesce(manual, false) = false
   and jogador_id in (select jogador_id from plantel where equipa_id = 1192);

delete from tecnicos
 where equipa_id = 1181
   and nome in (select nome from tecnicos where equipa_id = 1192);

-- Seniores e Sub-23 misturados (ex.: Fânzeres): o hp.fpp.pt usa o mesmo n.º de equipa nas duas provas.
-- O robô novo passa a guardar a equipa Sub-23 à parte. Aqui limpam-se os plantéis misturados dessas equipas
-- e marcam-se os jogos delas para serem relidos (o robô volta a preencher tudo, já separado).
drop table if exists afetadas;
create temporary table afetadas as
  select distinct e as id from (
    select j.casa_id as e from jogos j join competicoes c on c.id = j.competicao_id where c.nome ~* 'sub\s*-?\s*\d+' or c.grupo ~* 'sub\s*-?\s*\d+'
    union all
    select j.fora_id from jogos j join competicoes c on c.id = j.competicao_id where c.nome ~* 'sub\s*-?\s*\d+' or c.grupo ~* 'sub\s*-?\s*\d+'
    union all
    select id % 1000000 from equipas where (id between 7000000 and 99999999)
  ) x where e is not null and e < 1000000;

delete from plantel  where coalesce(manual, false) = false and equipa_id in (select id from afetadas);
delete from tecnicos where equipa_id in (select id from afetadas);
update equipas set plantel_em = null where id in (select id from afetadas);
update jogos set detalhes_em = null
 where golos_casa is not null and id < 1500000000
   and (casa_id in (select id from afetadas) or fora_id in (select id from afetadas));
drop table if exists afetadas;
