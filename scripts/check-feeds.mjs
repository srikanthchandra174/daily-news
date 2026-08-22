/**
 * check-feeds.mjs — verify every RSS feed URL before trusting it.
 *
 *   node scripts/check-feeds.mjs
 *
 * Reads the FEEDS array out of fetch-news.mjs, fetches each URL, and reports
 * whether it responds, parses, and carries usable dates. Exits non-zero if any
 * feed marked verified:'live' has broken, so this is safe to wire into CI.
 *
 * Zero dependencies, same as everything else here.
 */
// fetch-news.mjs executes on import (it's a script, not a module), so rather
// than importing it we re-read the file and pull the FEEDS literal out of it.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./fetch-news.mjs', import.meta.url), 'utf8');
const m = src.match(/const FEEDS = (\[[\s\S]*?\n\];)/);
if(!m){ console.error('Could not locate the FEEDS array in fetch-news.mjs'); process.exit(2); }
const FEEDS = eval(m[1].slice(0, -1));   // trusted local source, not user input

const UA = {
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept':'application/rss+xml, application/xml, text/xml, */*'
};

let liveBroken = 0;
console.log(`Checking ${FEEDS.length} feeds…\n`);

for(const f of FEEDS){
  const label = `${f.name.padEnd(18)} ${String(f.verified||'?').padEnd(7)}`;
  try {
    const ctl = AbortSignal.timeout(15000);
    const r = await fetch(f.url, { headers: UA, signal: ctl });
    if(!r.ok){ throw new Error('HTTP '+r.status); }
    const xml = await r.text();
    const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
    if(!blocks.length) throw new Error('0 items parsed');

    const dated = blocks.filter(b =>
      /<(pubDate|published|updated|dc:date)[^>]*>/i.test(b)).length;
    const pct = Math.round(dated / blocks.length * 100);
    const warn = pct < 100 ? `  ⚠ only ${pct}% have dates` : '';
    console.log(`OK   ${label} ${String(blocks.length).padStart(3)} items, taking ${f.limit}${warn}`);
  } catch(e) {
    console.log(`FAIL ${label} ${e.message}`);
    if(f.verified === 'live') liveBroken++;
  }
}

if(liveBroken){
  console.error(`\n${liveBroken} feed(s) marked verified:'live' are now broken.`);
  process.exit(1);
}
console.log('\nDone. Feeds marked \'listed\' that FAILed above should be removed or corrected.');
