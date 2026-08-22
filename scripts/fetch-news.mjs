/**
 * fetch-news.mjs — runs on GitHub Actions (Node 20), NOT in the browser.
 * Fetches every source server-side (no CORS, no proxy, no ISP blocking) and
 * writes ../news.json at the repo root. The browser only ever reads that file.
 *
 * Zero dependencies on purpose — just `node scripts/fetch-news.mjs`.
 *
 * Every item carries two independent axes:
 *   topic  — what the story is about (india | hyderabad | world | business | tech | jobs | entertainment)
 *   region — where it originates     (in | global)
 * The UI filters on either. Do not encode region into topic names.
 *
 * `limit` per feed is the lever that controls the India / global ratio.
 */
import { writeFileSync } from 'node:fs';

const RUN_TIME = new Date();

// ── JSON APIs ────────────────────────────────────────────────────────────────
const SOURCES = [
  { name:'HN',       topic:'tech', region:'global', kind:'hn',       limit:20,
    url:'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30' },
  { name:'HN·AI',    topic:'tech', region:'global', kind:'hn',       limit:15,
    url:'https://hn.algolia.com/api/v1/search_by_date?query=AI%20OR%20LLM%20OR%20GPT&tags=story&numericFilters=points%3E25&hitsPerPage=15' },
  { name:'Dev.to',   topic:'tech', region:'global', kind:'devto',    limit:12,
    url:'https://dev.to/api/articles?per_page=20&top=2' },
  { name:'Remotive', topic:'jobs', region:'global', kind:'remotive', limit:40,
    url:'https://remotive.com/api/remote-jobs?category=software-dev&limit=40' },
];

// ── RSS feeds ────────────────────────────────────────────────────────────────
// Ordered by preference: when two feeds carry the same story, the FIRST one
// wins the near-duplicate check below. Most-trusted sources at the top.
//
// verified:'live'   — URL fetched and confirmed parseable on 2026-08-17
// verified:'listed' — from a curated public feed list, NOT fetched.
//                     Run `node scripts/check-feeds.mjs` before trusting it.
const FEEDS = [
  // ── India: national ────────────────────────────────────────────────────────
  { name:'The Hindu',        topic:'india', region:'in', limit:12, verified:'live',
    url:'https://www.thehindu.com/news/national/feeder/default.rss' },
  { name:'NDTV',             topic:'india', region:'in', limit:15, verified:'live',
    url:'https://feeds.feedburner.com/NDTV-LatestNews',
    // NDTV is a mixed firehose — route on its <category> element.
    dropCategories:['sport','cricket','hockey','badminton','football','tennis','squash','lifestyle'],
    categoryMap:{ world:'world', business:'business', markets:'business', technology:'tech' } },
  { name:'Times of India',   topic:'india', region:'in', limit:12, verified:'live',
    url:'https://timesofindia.indiatimes.com/rssfeedstopstories.cms' },
  { name:'Indian Express',   topic:'india', region:'in', limit:12, verified:'listed',
    url:'https://indianexpress.com/section/india/feed/' },
  { name:'Scroll.in',        topic:'india', region:'in', limit:8,  verified:'listed',
    url:'https://feeds.feedburner.com/ScrollinArticles.rss' },

  // ── Hyderabad / Telangana ──────────────────────────────────────────────────
  { name:'The Hindu HYD',    topic:'hyderabad', region:'in', limit:8, verified:'listed',
    url:'https://www.thehindu.com/news/cities/Hyderabad/feeder/default.rss' },
  { name:'Deccan Chronicle', topic:'hyderabad', region:'in', limit:8, verified:'listed',
    url:'https://www.deccanchronicle.com/rss_feed/' },

  // ── India: business & markets ──────────────────────────────────────────────
  { name:'Moneycontrol',     topic:'business', region:'in', limit:12, verified:'live',
    url:'https://www.moneycontrol.com/rss/latestnews.xml' },
  { name:'ET Markets',       topic:'business', region:'in', limit:12, verified:'live',
    url:'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
  { name:'Business Std',     topic:'business', region:'in', limit:10, verified:'live',
    url:'https://www.business-standard.com/rss/home_page_top_stories.rss' },

  // ── World (deliberately small) ─────────────────────────────────────────────
  { name:'BBC World',        topic:'world', region:'global', limit:6, verified:'live',
    url:'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name:'Guardian World',   topic:'world', region:'global', limit:6, verified:'live',
    url:'https://www.theguardian.com/world/rss' },

  // ── Global movies ──────────────────────────────────────────────────────────
  { name:'Variety',          topic:'entertainment', region:'global', limit:5, verified:'live',
    url:'https://variety.com/feed/' },
];

const KW = /java|spring|backend|kafka|microservice|aws|kotlin|distributed/i;

// ── Entity decoding ──────────────────────────────────────────────────────────
const NAMED = {
  nbsp:' ', lt:'<', gt:'>', quot:'"', apos:"'",
  ndash:'\u2013', mdash:'\u2014', hellip:'\u2026',
  lsquo:'\u2018', rsquo:'\u2019', ldquo:'\u201C', rdquo:'\u201D',
  laquo:'\u00AB', raquo:'\u00BB', deg:'\u00B0', middot:'\u00B7', bull:'\u2022',
  eacute:'\u00E9', egrave:'\u00E8', agrave:'\u00E0', ccedil:'\u00E7',
  ntilde:'\u00F1', uuml:'\u00FC', ouml:'\u00F6', auml:'\u00E4', szlig:'\u00DF',
  euro:'\u20AC', pound:'\u00A3', trade:'\u2122', copy:'\u00A9', reg:'\u00AE',
};

function cp(n){
  try { return (n > 0 && n <= 0x10FFFF) ? String.fromCodePoint(n) : ''; }
  catch { return ''; }
}
function decode(s){
  return (s||'')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/<[^>]+>/g,' ')
    // hex entities — previously passed through untouched ("Trump&#x2019;s")
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_,h) => cp(parseInt(h,16)))
    // decimal — fromCodePoint, not fromCharCode (emoji / astral planes)
    .replace(/&#(\d+);/g, (_,n) => cp(parseInt(n,10)))
    // named entities; &amp; deliberately skipped here and resolved last, so
    // "&amp;lt;" survives as "&lt;" rather than collapsing to "<"
    .replace(/&([a-zA-Z]+);/g, (m,name) => (name === 'amp' ? m : (NAMED[name] ?? m)))
    .replace(/&amp;/g,'&')
    .replace(/\s+/g,' ').trim();
}

// ── URL hygiene ──────────────────────────────────────────────────────────────
const TRACKING = /^(utm_|CMP$|cmp$|ito$|ref$|fbclid$|gclid$|at_)/;
function normalizeUrl(raw){
  try {
    const u = new URL(String(raw).trim());
    if(u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    for(const k of [...u.searchParams.keys()]) if(TRACKING.test(k)) u.searchParams.delete(k);
    u.hash = '';
    let s = u.toString();
    if(s.endsWith('/') && u.pathname !== '/') s = s.slice(0,-1);
    return s;
  } catch { return null; }
}

// ── RSS / Atom parsing ───────────────────────────────────────────────────────
function tag(block,name){
  const m=block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,'i'));
  return m ? m[1] : '';
}
function atomLink(block){
  const m=block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return m ? m[1] : '';
}

function parseRss(xml, f){
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  const items=[];
  for(const b of blocks.slice(0, f.limit ?? 10)){
    const title = decode(tag(b,'title'));
    const link  = decode(tag(b,'link')) || atomLink(b);
    const url   = link ? normalizeUrl(link) : null;
    if(!title || !url) continue;

    // Category routing for mixed feeds. Generic, not an NDTV special case.
    const cat = decode(tag(b,'category')).toLowerCase();
    if(cat && f.dropCategories?.some(c => cat.includes(c))) continue;
    let topic = f.topic;
    if(cat && f.categoryMap){
      for(const [k,v] of Object.entries(f.categoryMap)) if(cat.includes(k)){ topic = v; break; }
    }

    // Date with a fetch-time fallback. This used to produce null, which sorted
    // the item to the very bottom via new Date(0) — The Hindu lost every item.
    const raw = tag(b,'pubDate')||tag(b,'published')||tag(b,'updated')||tag(b,'dc:date');
    let t = RUN_TIME.toISOString(), exact = false;
    if(raw){ const d = new Date(decode(raw)); if(!isNaN(d)){ t = d.toISOString(); exact = true; } }

    let desc = decode(tag(b,'description')||tag(b,'summary'));
    if(desc.length>180) desc = desc.slice(0,180)+'\u2026';

    items.push({ title, url, time:t, approxTime:!exact, topic, region:f.region,
                 source:f.name, metric:'', desc });
  }
  if(!items.length) throw new Error('no items parsed');
  return items;
}

// ── Fetch helpers ────────────────────────────────────────────────────────────
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
  const base = { region:s.region, source:s.name, approxTime:false };
  if(s.kind==='hn'){ const d=await getJson(s.url);
    return d.hits.slice(0,s.limit).map(h=>({ ...base, title:h.title||'',
      url:normalizeUrl(h.url||`https://news.ycombinator.com/item?id=${h.objectID}`),
      time:new Date(h.created_at).toISOString(), topic:'tech',
      metric:`\u25B2 ${h.points||0}  \uD83D\uDCAC ${h.num_comments||0}`, desc:'' })); }
  if(s.kind==='devto'){ const d=await getJson(s.url);
    return d.slice(0,s.limit).map(a=>({ ...base, title:a.title||'', url:normalizeUrl(a.url),
      time:new Date(a.published_at).toISOString(), topic:'tech', source:'Dev.to',
      metric:`\u2665 ${a.positive_reactions_count||0} \u00B7 ${a.user?.name||''}`, desc:a.description||'' })); }
  if(s.kind==='remotive'){ const d=await getJson(s.url);
    return (d.jobs||[]).filter(j=>KW.test(j.title)||KW.test(j.description||'')).slice(0,s.limit)
      .map(j=>({ ...base, title:j.title||'', url:normalizeUrl(j.url),
        time:new Date(j.publication_date).toISOString(), topic:'jobs', source:j.company_name,
        metric:`${j.candidate_required_location||'Remote'}${j.salary?' \u00B7 '+j.salary:''}`, desc:'' })); }
  return [];
}

// ── Run ──────────────────────────────────────────────────────────────────────
const report=[]; let all=[];
for(const s of SOURCES){
  try{ const items=(await fetchSource(s)).filter(x=>x.url&&x.title);
       all.push(...items); report.push({ name:s.name, ok:true, count:items.length }); }
  catch(e){ report.push({ name:s.name, ok:false, error:e.message }); }
}
for(const f of FEEDS){
  try{ const items=parseRss(await getText(f.url), f);
       all.push(...items); report.push({ name:f.name, ok:true, count:items.length }); }
  catch(e){ report.push({ name:f.name, ok:false, error:e.message }); }
}

// Dedup 1: exact (normalized) URL.
const seenUrl=new Set();
all = all.filter(x => !seenUrl.has(x.url) && seenUrl.add(x.url));

// Dedup 2: near-identical headlines. With six Indian national feeds the same
// story arrives four or five times. FEEDS order above = preference order.
const titleKey = t => t.toLowerCase().replace(/[^a-z0-9 ]/g,'')
  .split(/\s+/).filter(w=>w.length>3).slice(0,6).join(' ');
const seenTitle=new Set(); let collapsed=0;
all = all.filter(x => {
  const k = titleKey(x.title);
  if(k.split(' ').length < 3) return true;   // too little signal to judge safely
  if(seenTitle.has(k)){ collapsed++; return false; }
  seenTitle.add(k); return true;
});

// Pure recency. Do NOT weight by region — that buries breaking world news
// under stale Indian stories and stops this being a briefing.
all.sort((a,b)=> new Date(b.time) - new Date(a.time));

const okCount = report.filter(r=>r.ok).length;
const total   = SOURCES.length + FEEDS.length;
const inCount = all.filter(x=>x.region==='in').length;
const lines   = report.map(r=>r.ok?`OK   ${r.name} (${r.count})`:`FAIL ${r.name} — ${r.error}`).join('\n');

// Never overwrite a good news.json with a broken fetch. A transient network
// failure used to commit an empty file and blank the live site for an hour.
if(all.length < 40){
  console.error(lines);
  console.error(`\nOnly ${all.length} items (${okCount}/${total} sources OK) — refusing to overwrite news.json.`);
  process.exit(1);
}

writeFileSync(new URL('../news.json', import.meta.url), JSON.stringify({
  updated: RUN_TIME.toISOString(),
  count: all.length,
  sourcesOk: okCount,
  sourcesTotal: total,
  sources: report,
  items: all,
}));

console.log(lines);
console.log(`\nWrote news.json — ${all.length} items (${inCount} India, ${Math.round(inCount/all.length*100)}%), ` +
            `${collapsed} near-duplicates collapsed, ${okCount}/${total} sources OK`);
