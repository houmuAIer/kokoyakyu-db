// プロ野球ドラフト会議（1965年〜）の高校からの指名選手を取り込み、data/drafts.csv を作り直す。
// 使い方: node scripts/import-drafts.js [開始年] [終了年]
// 記事は raw/draft-<年>.wiki に保存し、既にあれば再取得しない。
// 対象：所属が高校で、その高校が data/schools.csv（甲子園出場校）にある指名選手。育成・入団拒否も含む。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseDraftArticle, statusOf } from '../src/draft-parse.js';
import { parseCsv } from '../src/csv.js';
import { resolveTitles, canonical } from './redirects.js';

const p = (rel) => new URL(`../${rel}`, import.meta.url);
const UA = { headers: { 'User-Agent': 'koshien-db/0.1 (personal non-commercial project)' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [from = 1965, to = new Date().getFullYear()] = process.argv.slice(2).map(Number);
mkdirSync(p('raw'), { recursive: true });

async function fetchRaw(title, depth = 0) {
  const res = await fetch(`https://ja.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`, UA);
  if (!res.ok) return null;
  const body = await res.text();
  const r = body.match(/^#(?:REDIRECT|転送)\s*\[\[([^\]#]+)/i);
  if (r && depth < 3) return fetchRaw(r[1], depth + 1);
  return body;
}
async function article(year) {
  const path = p(`raw/draft-${year}.wiki`);
  if (!existsSync(path)) {
    const body = await fetchRaw(`${year}年度新人選手選択会議 (日本プロ野球)`);
    await sleep(800);
    if (!body || body.length < 200) return null;
    writeFileSync(path, body);
  }
  return readFileSync(path, 'utf8');
}

const problems = [];
const schools = new Set(parseCsv(readFileSync(p('data/schools.csv'), 'utf8')).map((s) => s.school_id));
const lineage = JSON.parse(readFileSync(p('config/school-lineage.json'), 'utf8'));
const overrides = JSON.parse(readFileSync(p('config/draft-overrides.json'), 'utf8'));

const picks = [];
for (let y = from; y <= to; y++) {
  const text = await article(y);
  if (!text) { if (y < to) problems.push(`${y}年：記事が見つからない`); continue; }
  const rows = parseDraftArticle(text);
  if (!rows.length) problems.push(`${y}年：指名選手の行を読めない`);
  for (const r of rows) picks.push({ year: y, ...r });
}

// 高校らしいリンク先だけ正式な記事名にそろえる（大学・社会人・独立リーグは対象外）
const isHighSchool = (t) => /高等学校|高校|中等教育学校|学院|学園|学校$/.test(t) && !/野球部|野球団|クラブ|大学$|短期大学|専門学校|大学校/.test(t);
await resolveTitles(picks.flatMap((x) => x.affiliationLinks.filter(isHighSchool)));

/** 指名年の学校ID：改称は一本化、統合前の年は統合前の学校（school-lineage.json）に割り当てる */
const norm = (s) => s.replace(/(高等学校|高校|高)$/, '').replace(/工業/g, '工').replace(/商業/g, '商');
const entryRows = parseCsv(readFileSync(p('data/entries.csv'), 'utf8'));
const ownBefore = (id, year) => entryRows.some((e) => e.school_id === id && Number(e.tournament_id.slice(0, 4)) < year);
const fallbacks = [];
function schoolIdFor(link, label, year) {
  let id = canonical(link);
  id = lineage.renames[id]?.to ?? id;
  const cands = lineage.splits.filter((x) => x.successor === id && year < x.before);
  if (!cands.length) return id;
  const byOverride = overrides.splitLabels?.[label];
  if (byOverride && cands.some((x) => x.id === byOverride)) return byOverride;
  const hit = cands.find((x) => x.labels.some((l) => norm(label) === norm(l)));
  if (hit) return hit.id;
  // 校名で決まらないとき：統合後の学校が統合前から同じ記事で出場していればその学校、統合前の学校が1つならその学校
  if (ownBefore(id, Math.max(...cands.map((x) => x.before)))) { fallbacks.push(`${year} ${label} → ${id}`); return id; }
  if (cands.length === 1) { fallbacks.push(`${year} ${label} → ${cands[0].id}`); return cands[0].id; }
  problems.push(`${year}年 ${label}：統合前のどの学校か決められない（${id}）`);
  return id;
}

const seen = new Set();
const out = [];
for (const x of picks) {
  const key = `${x.year}|${x.kind}|${x.playerArticle || x.player}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const ov = overrides.picks?.[`${x.year}|${x.player}`];
  if (ov?.exclude) continue;
  const link = ov?.school ?? x.affiliationLinks.find(isHighSchool);
  if (!link) continue;
  const sid = ov?.school ?? schoolIdFor(link, x.affiliation, x.year);
  if (!schools.has(sid)) continue; // 甲子園に出場していない学校は対象外
  out.push({
    draft_year: x.year, team: x.team, kind: x.kind, round: x.round ?? '', player: x.player,
    school_id: sid, affiliation: x.affiliation, status: statusOf(x.result),
  });
}
out.sort((a, b) => a.draft_year - b.draft_year || a.team.localeCompare(b.team, 'ja') || (a.kind === b.kind ? 0 : a.kind === 'regular' ? -1 : 1) || a.round - b.round);
const cols = ['draft_year', 'team', 'kind', 'round', 'player', 'school_id', 'affiliation', 'status'];
writeFileSync(p('data/drafts.csv'), [cols.join(','), ...out.map((r) => cols.map((c) => String(r[c] ?? '').replace(/,/g, '、')).join(','))].join('\n') + '\n');
const years = new Set(picks.map((x) => x.year));
console.log(`記事${years.size}年分 指名行${picks.length} → 甲子園出場校からの高校生指名 ${out.length}人（育成${out.filter((r) => r.kind === 'development').length}・拒否${out.filter((r) => r.status === 'declined').length}）`);
if (fallbacks.length) console.log(`\n統合前の学校を校名以外で決めた指名 ${fallbacks.length}件:\n` + fallbacks.map((s) => `  - ${s}`).join('\n'));
if (problems.length) { console.log(`\n要確認 ${problems.length}件:\n` + [...new Set(problems)].map((s) => `  - ${s}`).join('\n')); process.exitCode = 2; }
