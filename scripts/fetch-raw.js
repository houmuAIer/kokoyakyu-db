// 記事名の候補を順に試して raw/<大会ID>.wiki に保存する（転送ページはたどる）
import { existsSync, writeFileSync } from 'node:fs';
const [, , id, ...titles] = process.argv;
const path = new URL(`../raw/${id}.wiki`, import.meta.url);
if (existsSync(path)) { console.log(`${id} cached`); process.exit(0); }
async function get(title, depth = 0) {
  const url = `https://ja.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`;
  const res = await fetch(url, { headers: { 'User-Agent': 'koshien-db/0.1 (personal non-commercial project)' } });
  if (!res.ok) return null;
  const body = await res.text();
  const r = body.match(/^#(?:REDIRECT|転送)\s*\[\[([^\]#]+)/i);
  if (r && depth < 3) return get(r[1], depth + 1);
  return body.length > 200 ? { title, body } : null;
}
for (const t of titles) {
  const hit = await get(t);
  if (hit) { writeFileSync(path, hit.body); console.log(`${id} ${hit.title}`); process.exit(0); }
}
console.log(`${id} NOT FOUND: ${titles.join(' / ')}`);
