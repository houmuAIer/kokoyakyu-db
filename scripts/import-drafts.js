// プロ野球ドラフト会議（1965年〜）の高校からの指名選手を取り込み、data/drafts.csv を作り直す。
// 使い方: node scripts/import-drafts.js [開始年] [終了年]
// 記事は raw/draft-<年>.wiki に保存し、既にあれば再取得しない。
// 対象：所属が高校で、その高校が data/schools.csv（甲子園出場校）にある指名選手（route=hs）と、
// 大学・社会人・独立リーグなどを経て指名された選手のうち、出身高校が甲子園出場校のもの（route=later）。育成・入団拒否も含む。
// 大社経由は選手記事（基本情報欄の経歴・生年月日）から出身高校と高校3年の年（class_year）を読む。選手記事は raw/draft-players.json にキャッシュ。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseDraftArticle, statusOf, parsePlayerArticle, classYearOf, isHighSchool } from '../src/draft-parse.js';
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
  const byLink = cands.find((x) => [link, label].includes(x.id.replace(/#.*/, ''))); // 統合前の学校の記事名でリンク・表記されている
  if (byLink) return byLink.id;
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
  const ov0 = overrides.picks?.[`${x.year}|${x.player}`];
  if (ov0?.exclude) continue;
  const ov = ov0?.route === 'later' ? null : ov0; // 大社経由の補正はこちらでは使わない
  const link = ov?.school ?? x.affiliationLinks.find(isHighSchool);
  if (!link) continue;
  const sid = ov?.school ?? schoolIdFor(link, x.affiliation, x.year);
  if (!schools.has(sid)) continue; // 甲子園に出場していない学校は対象外
  out.push({
    draft_year: x.year, team: x.team, kind: x.kind, round: x.round ?? '', player: x.player,
    school_id: sid, affiliation: x.affiliation, status: statusOf(x.result), route: 'hs', class_year: x.year, _article: x.playerArticle,
  });
}

// ---- 大社経由：高校以外からの指名を選手記事で出身高校に結びつける ----
const hsPlayers = new Set(out.map((r) => r._article).filter(Boolean));
const later = picks.filter((x) => !x.affiliationLinks.some(isHighSchool) && !(overrides.picks?.[`${x.year}|${x.player}`]?.exclude));
const playersPath = p('raw/draft-players.json');
const players = existsSync(playersPath) ? JSON.parse(readFileSync(playersPath, 'utf8')) : {};
const todo = [...new Set(later.map((x) => x.playerArticle).filter((t) => t && !(t in players)))];
for (let i = 0; i < todo.length; i += 50) {
  const batch = todo.slice(i, i + 50);
  const url = `https://ja.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(batch.join('|'))}`;
  let res;
  for (let attempt = 0; attempt < 6; attempt++) {
    res = await fetch(url, UA);
    if (res.status !== 429) break;
    await sleep((Number(res.headers.get('retry-after')) || 10 * 2 ** attempt) * 1000);
  }
  if (!res.ok) { writeFileSync(playersPath, JSON.stringify(players)); throw new Error(`選手記事の取得に失敗 ${res.status}`); }
  const q = (await res.json()).query ?? {};
  const norm = new Map((q.normalized ?? []).map((n) => [n.from, n.to]));
  const redir = new Map((q.redirects ?? []).map((r) => [r.from, r.to]));
  const byTitle = new Map(Object.values(q.pages ?? {}).map((pg) => [pg.title, pg]));
  for (const t of batch) {
    const n = norm.get(t) ?? t;
    const pg = byTitle.get(redir.get(n) ?? n);
    const text = pg?.revisions?.[0]?.slots?.main?.['*'];
    if (!text) { players[t] = null; continue; }
    // 基本情報欄を含む冒頭（最初の節見出しまで）だけを保存し、解析は毎回やり直す
    const cut = text.search(/^==[^=]/m);
    players[t] = text.slice(0, cut > 0 ? Math.min(cut, 20000) : 20000);
  }
  writeFileSync(playersPath, JSON.stringify(players));
  process.stdout.write(`選手記事 ${Math.min(i + 50, todo.length)}/${todo.length}\r`);
  await sleep(1500);
}
const playerInfo = new Map(Object.entries(players).map(([t, head]) => [t, head ? parsePlayerArticle(head, isHighSchool) : null]));
await resolveTitles([...playerInfo.values()].filter((v) => v?.school).map((v) => v.school));

const laterStats = { noArticle: 0, noSchool: 0, noBirth: 0, mismatch: 0, notInDb: 0, dupHs: 0, odd: [] };
const laterSeen = new Map();
for (const x of later) {
  const ov = overrides.picks?.[`${x.year}|${x.player}`];
  const info = x.playerArticle ? playerInfo.get(x.playerArticle) : null;
  if (!info && !ov?.school) { laterStats.noArticle++; continue; }
  if (hsPlayers.has(x.playerArticle)) { laterStats.dupHs++; continue; } // 高校で指名済みの選手は高卒の枠で数える
  const link = ov?.school ?? info?.school;
  if (!link) { laterStats.noSchool++; continue; }
  const birth = ov?.birth ?? info?.birth;
  if (!birth && !ov?.classYear) { laterStats.noBirth++; continue; }
  const classYear = ov?.classYear ?? classYearOf(birth);
  // 同名の別人の記事などを除くため、高3の翌年〜15年後の指名だけを採る
  if (classYear >= x.year || x.year - classYear > 15) { laterStats.mismatch++; laterStats.odd.push(`${x.year} ${x.player}：高3の年 ${classYear}`); continue; }
  const sid = ov?.school ?? schoolIdFor(link, info?.schoolLabel ?? '', classYear);
  if (!schools.has(sid)) { laterStats.notInDb++; continue; }
  // 同じ選手が大社で複数回指名されたとき（拒否後に再指名など）は最後の指名を残す
  const key = x.playerArticle || x.player;
  const row = {
    draft_year: x.year, team: x.team, kind: x.kind, round: x.round ?? '', player: x.player,
    school_id: sid, affiliation: x.affiliation, status: statusOf(x.result), route: 'later', class_year: classYear,
  };
  const prev = laterSeen.get(key);
  if (!prev || prev.draft_year < x.year || (prev.draft_year === x.year && prev.kind === 'development')) laterSeen.set(key, row);
}
out.push(...laterSeen.values());
for (const r of out) delete r._article;
out.sort((a, b) => a.draft_year - b.draft_year || a.team.localeCompare(b.team, 'ja') || (a.kind === b.kind ? 0 : a.kind === 'regular' ? -1 : 1) || a.round - b.round);
const cols = ['draft_year', 'team', 'kind', 'round', 'player', 'school_id', 'affiliation', 'status', 'route', 'class_year'];
writeFileSync(p('data/drafts.csv'), [cols.join(','), ...out.map((r) => cols.map((c) => String(r[c] ?? '').replace(/,/g, '、')).join(','))].join('\n') + '\n');
const years = new Set(picks.map((x) => x.year));
const hs = out.filter((r) => r.route === 'hs'), lt = out.filter((r) => r.route === 'later');
console.log(`記事${years.size}年分 指名行${picks.length}`);
console.log(`高卒：甲子園出場校から ${hs.length}人（育成${hs.filter((r) => r.kind === 'development').length}・拒否${hs.filter((r) => r.status === 'declined').length}）`);
console.log(`大社：高校以外からの指名 ${later.length}行 → 甲子園出場校出身 ${lt.length}人（記事なし${laterStats.noArticle}・高校不明${laterStats.noSchool}・生年月日なし${laterStats.noBirth}・年齢が合わない${laterStats.mismatch}・出場校外${laterStats.notInDb}・高卒指名と重複${laterStats.dupHs}）`);
if (laterStats.odd.length) console.log(`\n大社の要確認 ${laterStats.odd.length}件:\n` + laterStats.odd.map((s) => `  - ${s}`).join('\n'));
if (fallbacks.length) console.log(`\n統合前の学校を校名以外で決めた指名 ${fallbacks.length}件:\n` + fallbacks.map((s) => `  - ${s}`).join('\n'));
if (problems.length) { console.log(`\n要確認 ${problems.length}件:\n` + [...new Set(problems)].map((s) => `  - ${s}`).join('\n')); process.exitCode = 2; }
