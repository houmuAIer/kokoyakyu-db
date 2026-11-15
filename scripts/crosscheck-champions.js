// Wikipedia「全国高等学校野球選手権大会歴代優勝校」「選抜高等学校野球大会歴代優勝校」の一覧と、
// data/ の決勝・出場校数を照合する（大会ごとの記事とは別に書かれた一覧なので、決勝の取り違えの検出に使える）。
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/csv.js';
import { resolveTitles, canonical } from './redirects.js';

const p = (rel) => new URL(`../${rel}`, import.meta.url);
const csv = (n) => parseCsv(readFileSync(p(`data/${n}.csv`), 'utf8'));
const tournaments = csv('tournaments'), games = csv('games');
const link = (s) => s.match(/\[\[([^\]|#]+)/)?.[1]?.trim();

const lists = { summer: 'raw/list-全国高等学校野球選手権大会歴代優勝校.wiki', spring: 'raw/list-選抜高等学校野球大会歴代優勝校.wiki' };
const problems = [];
let checked = 0;
await resolveTitles(Object.values(lists).flatMap((path) => [...readFileSync(p(path), 'utf8').matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim())));
for (const [season, path] of Object.entries(lists)) {
  for (const line of readFileSync(p(path), 'utf8').split('\n')) {
    const cells = line.replace(/^\|/, '').split('||');
    const edition = Number(cells[0]?.match(/\|(\d+)\]\]/)?.[1]);
    if (!edition || cells.length < 6) continue;
    const t = tournaments.find((x) => x.season === season && Number(x.edition) === edition);
    if (!t) continue;
    checked++;
    const [, , teams, winCell, scoreCell, runCell] = cells;
    const winner = canonical(link(winCell) ?? ''), runner = canonical(link(runCell) ?? '');
    const lastScore = scoreCell.split(/<br\s*\/?>/).at(-1).match(/(\d+)\s*-\s*(\d+)/);
    const finals = games.filter((g) => g.tournament_id === t.tournament_id && g.round === 'F' && g.type === 'normal');
    const f = finals.at(-1);
    const tag = `${t.tournament_id}（第${edition}回）`;
    if (!f) { problems.push(`${tag}: こちらに決勝がない`); continue; }
    const loser = f.winner === f.school_a ? f.school_b : f.school_a;
    const base = (id) => id.replace(/#.*/, '');
    if (base(f.winner) !== winner) problems.push(`${tag}: 優勝校が違う（こちら ${f.winner} / 一覧 ${winner}）`);
    if (base(loser) !== runner) problems.push(`${tag}: 準優勝校が違う（こちら ${loser} / 一覧 ${runner}）`);
    if (lastScore) {
      const ours = [Number(f.score_a), Number(f.score_b)].sort((a, b) => b - a).join('-');
      const theirs = [Number(lastScore[1]), Number(lastScore[2])].sort((a, b) => b - a).join('-');
      if (ours !== theirs) problems.push(`${tag}: 決勝スコアが違う（こちら ${ours} / 一覧 ${theirs}）`);
    }
    const n = Number(String(teams).replace(/\D/g, ''));
    if (n && n !== Number(t.num_teams)) problems.push(`${tag}: 出場校数が違う（こちら ${t.num_teams} / 一覧 ${n}）`);
  }
}
console.log(`照合した大会: ${checked} / ${tournaments.length}`);
console.log(problems.length ? problems.join('\n') : '不一致なし');
