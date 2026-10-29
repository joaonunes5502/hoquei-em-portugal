import * as cheerio from 'cheerio';
const URL_=process.env.SUPABASE_URL, KEY=process.env.SUPABASE_SERVICE_KEY, COMP=493; // 493 = Placard, Fase Regular

// "2026-11-08" + "16:00" (hora de Lisboa) -> ISO UTC
function lisboa(d,t){
  const g=new Date(`${d}T${t}:00Z`);
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Lisbon',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(g).map(x=>[x.type,x.value]));
  const local=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);
  return new Date(g.getTime()-(local-g.getTime())).toISOString();
}

const html=await (await fetch(`https://hp.fpp.pt/Competicao/${COMP}`)).text();
const $=cheerio.load(html);
let jornada=0;const rows=[];
$('table tr').each((_,tr)=>{
  const td=$(tr).find('td,th').map((_,c)=>$(c).text().replace(/\s+/g,' ').trim()).get();
  const j=td[0]?.match(/^(\d+)ª Jornada/); if(j){jornada=+j[1];return}
  if(td.length<5||!/^\d+$/.test(td[0]))return;
  const m=td[1].match(/(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2})/); if(!m)return;
  const s=td[3].match(/^(\d+)\s*-\s*(\d+)$/);
  rows.push({competicao:COMP,id:+td[0],jornada,data:lisboa(m[1],m[2]),casa:td[2],fora:td[4],
    golos_casa:s?+s[1]:null,golos_fora:s?+s[2]:null,atualizado_em:new Date().toISOString()});
});
if(!rows.length){console.error('Nenhum jogo encontrado: o layout da FPP pode ter mudado.');process.exit(1)}

const r=await fetch(`${URL_}/rest/v1/jogos?on_conflict=competicao,id`,{method:'POST',
  headers:{apikey:KEY,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},
  body:JSON.stringify(rows)});
if(!r.ok){console.error(await r.text());process.exit(1)}
console.log(rows.length,'jogos atualizados');
