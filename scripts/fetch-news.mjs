/**
 * fetch-news.mjs — runs on GitHub Actions (Node 20), NOT in the browser.
 * Fetches every source server-side (no CORS, no proxy, no ISP blocking) and
 * writes ../news.json at the repo root. The browser only ever reads that file.
 *
 * Zero dependencies on purpose — just `node scripts/fetch-news.mjs`.
 * Edit SOURCES / FEEDS below to add or remove anything.
 */
import { writeFileSync } from 'node:fs';

// JSON APIs (Tech / Jobs)
const SOURCES = [
  { name:'HN',     topic:'tech', kind:'hn',       url:'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30' },
  { name:'HN·AI',  topic:'tech', kind:'hn',       url:'https://hn.algolia.com/api/v1/search_by_date?query=AI%20OR%20LLM%20OR%20GPT&tags=story&numericFilters=points%3E25&hitsPerPage=15' },
  { name:'Dev.to', topic:'tech', kind:'devto',    url:'https://dev.to/api/articles?per_page=20&top=2' },
  { name:'Remotive', topic:'jobs', kind:'remotive', url:'https://remotive.com/api/remote-jobs?category=software-dev&limit=40' },
];

// RSS feeds (India / World / Business / Movies)
const FEEDS = [
  { name:'The Hindu',      topic:'india',         url:'https://www.thehindu.com/news/national/feeder/default.rss' },
  { name:'Times of India', topic:'india',         url:'https://timesofindia.indiatimes.com/rssfeedstopstories.cms' },
  { name:'Guardian World', topic:'world',         url:'https://www.theguardian.com/world/rss' },
  { name:'NPR World',      topic:'world',         url:'https://feeds.npr.org/1004/rss.xml' },
  { name:'BBC World',      topic:'world',         url:'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name:'Moneycontrol',   topic:'business',      url:'https://www.moneycontrol.com/rss/latestnews.xml' },
  { name:'Guardian Biz',   topic:'business',      url:'https://www.theguardian.com/uk/business/rss' },
  { name:'ET Markets',     topic:'business',      url:'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
  { name:'Variety',        topic:'entertainment', url:'https://variety.com/feed/' },
  { name:'Guardian Film',  topic:'entertainment', url:'https://www.theguardian.com/film/rss' },
];

const KW = /java|spring|backend|kafka|microservice|aws|kotlin|distributed/i;

function decode(s){
  return (s||'')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/<[^>]+>/g,' ')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
    .replace(/&#0?39;/g,"'").replace(/&apos;/g,"'")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n))
    .replace(/&amp;/g,'&')
    .replace(/\s+/g,' ').trim();
}
function tag(block,name){
  const m=block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,'i'));
  return m ? m[1] : '';
}
function atomLink(block){
  const m=block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return m ? m[1] : '';
}
function parseRss(xml, topic, name){
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  const items=[];
  for(const b of blocks.slice(0,15)){
    const title = decode(tag(b,'title'));
    let link = decode(tag(b,'link')) || atomLink(b);
    const date = tag(b,'pubDate')||tag(b,'published')||tag(b,'updated')||tag(b,'dc:date');
    let desc = decode(tag(b,'description')||tag(b,'summary'));
    if(desc.length>180) desc = desc.slice(0,180)+'…';
    let t=null; if(date){ const d=new Date(date.trim()); if(!isNaN(d)) t=d.toISOString(); }
    if(title && link) items.push({ title, url:link.trim(), time:t, topic, source:name, metric:'', desc });
  }
  if(!items.length) throw new Error('no items parsed');
  return items;
}

async function getJson(u){
  const r=await fetch(u,{headers:{'User-Agent':'BriefingBot/1.0'}});
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}
async function getText(u){
  const r=await fetch(u,{headers:{
    'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept':'application/rss+xml, application/xml, text/xml, */*'
  }});
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.text();
}

async function fetchSource(s){
  if(s.kind==='hn'){ const d=await getJson(s.url);
    return d.hits.map(h=>({ title:h.title, url:h.url||`https://news.ycombinator.com/item?id=${h.objectID}`,
      time:new Date(h.created_at).toISOString(), topic:'tech', source:s.name,
      metric:`▲ ${h.points||0}  💬 ${h.num_comments||0}`, desc:'' })); }
  if(s.kind==='devto'){ const d=await getJson(s.url);
    return d.map(a=>({ title:a.title, url:a.url, time:new Date(a.published_at).toISOString(),
      topic:'tech', source:'Dev.to', metric:`♥ ${a.positive_reactions_count||0} · ${a.user?.name||''}`, desc:a.description||'' })); }
  if(s.kind==='remotive'){ const d=await getJson(s.url);
    return (d.jobs||[]).filter(j=>KW.test(j.title)||KW.test(j.description||''))
      .map(j=>({ title:j.title, url:j.url, time:new Date(j.publication_date).toISOString(),
        topic:'jobs', source:j.company_name, metric:`${j.candidate_required_location||'Remote'}${j.salary?' · '+j.salary:''}`, desc:'' })); }
  return [];
}

const report=[]; let all=[];
for(const s of SOURCES){
  try{ const items=await fetchSource(s); all.push(...items); report.push(`OK   ${s.name} (${items.length})`); }
  catch(e){ report.push(`FAIL ${s.name} — ${e.message}`); }
}
for(const f of FEEDS){
  try{ const xml=await getText(f.url); const items=parseRss(xml,f.topic,f.name); all.push(...items); report.push(`OK   ${f.name} (${items.length})`); }
  catch(e){ report.push(`FAIL ${f.name} — ${e.message}`); }
}

const seen=new Set();
all = all.filter(x => x.url && !seen.has(x.url) && seen.add(x.url));
all.sort((a,b)=> new Date(b.time||0) - new Date(a.time||0));

const out = { updated:new Date().toISOString(), count:all.length, items:all };
writeFileSync(new URL('../news.json', import.meta.url), JSON.stringify(out));

console.log(report.join('\n'));
console.log(`\nWrote news.json — ${all.length} items, ${report.filter(r=>r.startsWith('OK')).length}/${SOURCES.length+FEEDS.length} sources OK`);
