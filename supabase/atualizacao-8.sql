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
