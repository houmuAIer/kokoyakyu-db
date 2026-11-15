// CSV群を検証し、アプリが読む1つのJSONオブジェクトに組み立てる
import { parseCsv } from './csv.js';

export const ROUNDS = ['R1', 'R2', 'R3', 'QF', 'SF', 'F'];
const SEASONS = ['spring', 'summer', 'exchange'];
const TYPES = ['normal', 'draw', 'forfeit', 'exchange'];

const int = (v) => (v === '' ? null : Number.parseInt(v, 10));

export function buildDb({ tournamentsCsv, schoolsCsv, entriesCsv, gamesCsv, districts, eras }) {
  const errors = [];
  const err = (m) => errors.push(m);

  const tournaments = parseCsv(tournamentsCsv).map((t) => ({
    id: t.tournament_id, year: int(t.year), season: t.season,
    edition: int(t.edition), numTeams: int(t.num_teams),
  }));
  const schools = parseCsv(schoolsCsv).map((s) => ({ id: s.school_id, name: s.name, prefecture: s.prefecture }));
  const entries = parseCsv(entriesCsv).map((e) => ({
    tournamentId: e.tournament_id, schoolId: e.school_id, nameAtTime: e.name_at_time,
    prefecture: e.prefecture ?? '', slot: e.slot,
  }));
  const games = parseCsv(gamesCsv).map((g) => ({
    id: g.game_id, tournamentId: g.tournament_id, round: g.round, date: g.date, gameNo: int(g.game_no ?? ''),
    a: g.school_a, scoreA: int(g.score_a), b: g.school_b, scoreB: int(g.score_b),
    winner: g.winner || null, type: g.type, replayOf: g.replay_of || null,
  }));

  const tMap = new Map(), sMap = new Map(), eKey = new Set(), gIds = new Set();
  for (const t of tournaments) {
    if (tMap.has(t.id)) err(`大会ID重複: ${t.id}`);
    if (!SEASONS.includes(t.season)) err(`大会${t.id}: season不正 ${t.season}`);
    if (!Number.isInteger(t.year)) err(`大会${t.id}: year不正`);
    tMap.set(t.id, t);
  }
  for (const s of schools) {
    if (sMap.has(s.id)) err(`学校ID重複: ${s.id}`);
    if (!districts[s.prefecture]) err(`学校${s.id}: 都道府県が地区マップにない ${s.prefecture}`);
    sMap.set(s.id, s);
  }
  for (const e of entries) {
    const k = `${e.tournamentId}|${e.schoolId}`;
    if (eKey.has(k)) err(`出場重複: ${k}`);
    eKey.add(k);
    if (!tMap.has(e.tournamentId)) err(`出場${k}: 大会が存在しない`);
    if (!sMap.has(e.schoolId)) err(`出場${k}: 学校が存在しない`);
    if (!e.prefecture && sMap.has(e.schoolId)) e.prefecture = sMap.get(e.schoolId).prefecture;
    if (!e.slot) e.slot = e.prefecture;
    if (!districts[e.prefecture]) err(`出場${k}: 都道府県が地区マップにない ${e.prefecture}`);
  }
  for (const g of games) {
    if (gIds.has(g.id)) err(`試合ID重複: ${g.id}`);
    gIds.add(g.id);
    if (!tMap.has(g.tournamentId)) err(`試合${g.id}: 大会が存在しない`);
    if (!ROUNDS.includes(g.round)) err(`試合${g.id}: round不正 ${g.round}`);
    if (!TYPES.includes(g.type)) err(`試合${g.id}: type不正 ${g.type}`);
    if (g.a === g.b) err(`試合${g.id}: 同一校同士`);
    for (const s of [g.a, g.b]) {
      if (!eKey.has(`${g.tournamentId}|${s}`)) err(`試合${g.id}: ${s}がその大会の出場校にない`);
    }
    if (g.type === 'draw') {
      if (g.winner) err(`試合${g.id}: 引き分けなのに勝者がある`);
      if (g.scoreA !== g.scoreB) err(`試合${g.id}: 引き分けなのに得点が異なる`);
    } else {
      if (![g.a, g.b].includes(g.winner)) err(`試合${g.id}: 勝者が対戦校でない`);
      if (g.type === 'normal') {
        if (g.scoreA === null || g.scoreB === null) err(`試合${g.id}: 得点が空欄`);
        else if ((g.scoreA > g.scoreB ? g.a : g.b) !== g.winner || g.scoreA === g.scoreB) err(`試合${g.id}: 得点と勝者が矛盾`);
      }
    }
    if (g.replayOf && !games.some((x) => x.id === g.replayOf && x.type === 'draw')) err(`試合${g.id}: replay_ofが引き分け試合を指していない`);
  }
  if (!errors.length) checkBrackets({ tournaments, entries, games }, err);
  return { db: { tournaments, schools, entries, games, districts, eras }, errors };
}

/** トーナメントとしての整合性（転記ミスの検出用） */
const ORDER = { R1: 1, R2: 2, R3: 3, QF: 4, SF: 5, F: 6 };
function checkBrackets({ tournaments, entries, games }, err) {
  for (const t of tournaments) {
    if (t.season === 'exchange') continue;
    const es = entries.filter((e) => e.tournamentId === t.id);
    const gs = games.filter((g) => g.tournamentId === t.id && g.type !== 'draw')
      .sort((x, y) => ORDER[x.round] - ORDER[y.round] || (x.date || '').localeCompare(y.date || ''));
    const tag = `大会${t.id}`;
    if (t.numTeams !== null && es.length !== t.numTeams) err(`${tag}: 出場校数 ${es.length} が num_teams ${t.numTeams} と違う`);
    if (gs.length !== es.length - 1) err(`${tag}: 勝敗のついた試合数 ${gs.length} が 出場校数-1（${es.length - 1}）と違う`);
    const finals = gs.filter((g) => g.round === 'F');
    if (finals.length !== 1) err(`${tag}: 決勝が ${finals.length} 試合ある`);
    const lost = new Map(), lastWin = new Map();
    for (const g of gs) {
      const loser = g.winner === g.a ? g.b : g.a;
      for (const s of [g.a, g.b]) {
        if (lost.has(s)) err(`${tag}: ${s} が ${lost.get(s)} で負けた後に ${g.round} を戦っている`);
        const prev = lastWin.get(s);
        if (prev && ORDER[prev] >= ORDER[g.round]) err(`${tag}: ${s} が同じか前の回戦（${prev}→${g.round}）を続けて戦っている`);
      }
      lost.set(loser, g.round);
      lastWin.set(g.winner, g.round);
    }
    const unbeaten = es.filter((e) => !lost.has(e.schoolId));
    if (unbeaten.length !== 1) err(`${tag}: 負けていない学校が ${unbeaten.length} 校ある（1校のはず）`);
    else if (finals[0] && finals[0].winner !== unbeaten[0].schoolId) err(`${tag}: 決勝の勝者と無敗の学校が一致しない`);
    const played = new Set(gs.flatMap((g) => [g.a, g.b]));
    for (const e of es) if (!played.has(e.schoolId)) err(`${tag}: ${e.schoolId} の試合がない`);
  }
}
