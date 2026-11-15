// 別出典（高校野球ドットコムの大会ページHTML）と data/ の試合を突き合わせる。検証専用で、データには取り込まない。
// 使い方: node scripts/crosscheck-hb.js <大会ID> <保存したHTMLのパス>
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/csv.js';

const [tid, htmlPath] = process.argv.slice(2);
const html = readFileSync(htmlPath, 'utf8');
const ROUND = { '1回戦': 'R1', '2回戦': 'R2', '3回戦': 'R3', '準々決勝': 'QF', '準決勝': 'SF', '決勝': 'F' };
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
// 照合先の表記 → Wikipedia の表記（同じ学校の表記ゆれ・照合先の誤記）
const ALIAS = { 明桜: 'ノースアジア大明桜', 帝京五: '帝京第五', 旭川大高: '旭川大', 星陵: '星稜', 霞ケ浦: '霞ヶ浦' };
const norm = (n) => (ALIAS[n] ?? n).replace(/ケ/g, 'ヶ');

const theirs = [];
for (const row of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
  const tds = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  if (tds.length < 4 || !ROUND[strip(tds[2])]) continue;
  const a = tds[3].match(/class="team01">([^<]*)</)?.[1]?.trim();
  const b = tds[3].match(/class="team02">([^<]*)</)?.[1]?.trim();
  const sc = strip(tds[3].match(/class="score">([\s\S]*?)<\/a>/)?.[1] ?? '');
  theirs.push({ round: ROUND[strip(tds[2])], a: norm(a ?? ''), b: norm(b ?? ''), score: sc });
}

const p = (rel) => new URL(`../${rel}`, import.meta.url);
const entries = parseCsv(readFileSync(p('data/entries.csv'), 'utf8')).filter((e) => e.tournament_id === tid);
const name = new Map(entries.map((e) => [e.school_id, e.name_at_time.replace(/ケ/g, 'ヶ')]));
const ours = parseCsv(readFileSync(p('data/games.csv'), 'utf8')).filter((g) => g.tournament_id === tid);

const key = (round, x, y) => `${round}|${[x, y].sort().join('|')}`;
const theirMap = new Map(theirs.map((t) => [key(t.round, t.a, t.b), t]));
const problems = [];
for (const g of ours) {
  const a = name.get(g.school_a), b = name.get(g.school_b);
  const t = theirMap.get(key(g.round, a, b));
  if (!t) { problems.push(`見つからない: ${g.round} ${a} - ${b}`); continue; }
  theirMap.delete(key(g.round, a, b));
  if (g.type === 'forfeit') { if (!/不戦/.test(t.score)) problems.push(`不戦勝の表記が違う: ${a} - ${b}（相手側: ${t.score}）`); continue; }
  const m = t.score.match(/(\d+)\s*-\s*(\d+)/);
  if (!m) { problems.push(`スコアを読めない: ${a} - ${b}（${t.score}）`); continue; }
  // 照合先は学校とスコアの並び順がそろっていないことがあるので、得点の組で比べる（勝敗はトーナメント整合性チェックで別に検証済み）
  const ours2 = [Number(g.score_a), Number(g.score_b)].sort((x, y) => x - y).join('-');
  const theirs2 = [Number(m[1]), Number(m[2])].sort((x, y) => x - y).join('-');
  if (ours2 !== theirs2) problems.push(`スコア不一致: ${g.round} ${a} ${g.score_a}-${g.score_b} ${b}（相手側 ${t.a} ${t.score} ${t.b}）`);
}
for (const t of theirMap.values()) problems.push(`こちらにない試合: ${t.round} ${t.a} ${t.score} ${t.b}`);
console.log(`照合: こちら${ours.length}試合 / 相手側${theirs.length}試合`);
console.log(problems.length ? problems.join('\n') : '不一致なし');
