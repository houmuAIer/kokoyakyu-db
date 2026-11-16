// 集計ロジック（ブラウザ・Nodeの両方で動く純粋関数）
const ROUND_ORDER = { R1: 1, R2: 2, R3: 3, QF: 4, SF: 5, F: 6 };

// 年内の順序（交流試合は夏扱い）。元号の境目を「年＋春夏」で判定するために使う
const SEASON_ORDER = { spring: 1, summer: 2, exchange: 2 };
const pos = (year, season) => year * 10 + SEASON_ORDER[season];

/** 元号名 → その元号に属するかを判定する関数。eras は config/eras.json（開始順） */
function eraPredicate(eras, name) {
  const i = eras.findIndex((e) => e.name === name);
  if (i < 0) throw new Error(`unknown era: ${name}`);
  const from = pos(eras[i].fromYear, eras[i].fromSeason);
  const next = eras[i + 1];
  const to = next ? pos(next.fromYear, next.fromSeason) : Infinity;
  return (t) => pos(t.year, t.season) >= from && pos(t.year, t.season) < to;
}

/** 絞り込み条件 → 対象大会IDの集合 */
export function selectTournaments(db, { seasons = ['spring', 'summer'], fromYear = -Infinity, toYear = Infinity, era, numTeams } = {}) {
  const inEra = era ? eraPredicate(db.eras, era) : () => true;
  return new Set(db.tournaments
    .filter((t) => seasons.includes(t.season) && t.year >= fromYear && t.year <= toYear && inEra(t))
    .filter((t) => numTeams === undefined || t.numTeams === numTeams)
    .map((t) => t.id));
}

/** 直近n年の開始年（データ内の最新年から数える） */
export function fromYearForRecent(db, n, seasons = ['spring', 'summer']) {
  const years = db.tournaments.filter((t) => seasons.includes(t.season)).map((t) => t.year);
  return Math.max(...years) - n + 1;
}

function indexes(db) {
  const school = new Map(db.schools.map((s) => [s.id, s]));
  const entry = new Map(db.entries.map((e) => [`${e.tournamentId}|${e.schoolId}`, e]));
  return { school, entry };
}

/** 集計単位ごとのキー関数（school / prefecture / slot / district） */
function keyFn(db, level, idx) {
  return (tournamentId, schoolId) => {
    const e = idx.entry.get(`${tournamentId}|${schoolId}`); // 都道府県は出場当時のもの
    switch (level) {
      case 'school': return schoolId;
      case 'prefecture': return e.prefecture;
      case 'slot': return e.slot;
      case 'district': return db.districts[e.prefecture];
      default: throw new Error(`unknown level: ${level}`);
    }
  };
}

function labelFn(level, idx) {
  return (key) => (level === 'school' ? idx.school.get(key).name : key);
}

/** 出場ごとの到達ラウンド（種別を問わず全試合行の最上位）と優勝判定 */
function stages(db, tSet) {
  const reach = new Map();
  for (const g of db.games) {
    if (!tSet.has(g.tournamentId)) continue;
    for (const s of [g.a, g.b]) {
      const k = `${g.tournamentId}|${s}`;
      const cur = reach.get(k) ?? { round: 0, champion: false };
      cur.round = Math.max(cur.round, ROUND_ORDER[g.round]);
      if (g.round === 'F' && g.winner === s) cur.champion = true;
      reach.set(k, cur);
    }
  }
  return reach;
}

const rate = (w, l) => (w + l === 0 ? null : w / (w + l));

/** ランキング用の集計表 */
export function aggregate(db, { level = 'school', ...filter } = {}) {
  const idx = indexes(db);
  const tSet = selectTournaments(db, filter);
  const key = keyFn(db, level, idx);
  const rows = new Map();
  const row = (k) => {
    if (!rows.has(k)) rows.set(k, { key: k, appearances: 0, wins: 0, losses: 0, best8: 0, best4: 0, runnerUp: 0, champion: 0, drafted: 0 });
    return rows.get(k);
  };
  const reach = stages(db, tSet);
  for (const e of db.entries) {
    if (!tSet.has(e.tournamentId)) continue;
    const r = row(key(e.tournamentId, e.schoolId));
    r.appearances++;
    const st = reach.get(`${e.tournamentId}|${e.schoolId}`);
    if (!st) continue;
    if (st.round >= ROUND_ORDER.QF) r.best8++;
    if (st.round >= ROUND_ORDER.SF) r.best4++;
    if (st.round === ROUND_ORDER.F) st.champion ? r.champion++ : r.runnerUp++;
  }
  for (const g of db.games) {
    if (!tSet.has(g.tournamentId) || g.type !== 'normal') continue;
    const loser = g.winner === g.a ? g.b : g.a;
    row(key(g.tournamentId, g.winner)).wins++;
    row(key(g.tournamentId, loser)).losses++;
  }
  // ドラフト指名数：絞り込んだ期間（大会の年の範囲）に指名された高校生。その期間に出場していない学校も数える
  const span = yearSpan(db, tSet);
  if (span) {
    const dk = draftKeyFn(db, level, idx);
    for (const d of db.drafts ?? []) if (d.year >= span[0] && d.year <= span[1]) row(dk(d.schoolId)).drafted++;
  }
  const label = labelFn(level, idx);
  return [...rows.values()].map((r) => ({ ...r, label: label(r.key), winRate: rate(r.wins, r.losses) }));
}

/** 対象大会の年の範囲 [最小, 最大] */
function yearSpan(db, tSet) {
  const ys = db.tournaments.filter((t) => tSet.has(t.id)).map((t) => t.year);
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
}

/** ドラフト指名を集計単位に振り分けるキー（都道府県・代表枠・地区は、その学校の最新の出場のもの） */
function draftKeyFn(db, level, idx) {
  if (level === 'school') return (sid) => sid;
  const latest = new Map();
  const tYear = new Map(db.tournaments.map((t) => [t.id, t.year]));
  for (const e of db.entries) {
    const cur = latest.get(e.schoolId);
    if (!cur || tYear.get(e.tournamentId) >= tYear.get(cur.tournamentId)) latest.set(e.schoolId, e);
  }
  return (sid) => {
    const e = latest.get(sid);
    const pref = e?.prefecture || idx.school.get(sid).prefecture;
    if (level === 'prefecture') return pref;
    if (level === 'slot') return e?.slot || pref;
    if (level === 'district') return db.districts[pref];
    throw new Error(`unknown level: ${level}`);
  };
}

/** 指標で並べ替え（勝率は最低試合数で足切りできる） */
export function rank(rows, metric, { minGames = 0, desc = true } = {}) {
  return rows
    .filter((r) => r.appearances > 0 || (metric === 'drafted' && r.drafted > 0)) // 期間内に出場のない学校はドラフト順のときだけ出す
    .filter((r) => metric !== 'winRate' || (r.winRate !== null && r.wins + r.losses >= minGames))
    .sort((x, y) => (desc ? (y[metric] ?? -1) - (x[metric] ?? -1) : (x[metric] ?? -1) - (y[metric] ?? -1))
      || (y.winRate ?? -1) - (x.winRate ?? -1) || y.wins - x.wins); // 同値は勝率→勝ち星で並べる
}

/** 対象（学校・県・代表枠・地区）の対戦相手別戦績 */
export function opponents(db, { level = 'school', key: target, ...filter }) {
  const idx = indexes(db);
  const tSet = selectTournaments(db, filter);
  const key = keyFn(db, level, idx);
  const label = labelFn(level, idx);
  const out = new Map();
  for (const g of db.games) {
    if (!tSet.has(g.tournamentId) || g.type === 'exchange') continue;
    const ka = key(g.tournamentId, g.a), kb = key(g.tournamentId, g.b);
    for (const [self, selfKey, oppKey] of [[g.a, ka, kb], [g.b, kb, ka]]) {
      if (selfKey !== target) continue;
      if (!out.has(oppKey)) out.set(oppKey, { key: oppKey, label: label(oppKey), wins: 0, losses: 0, games: [] });
      const o = out.get(oppKey);
      if (o.games.at(-1) !== g) o.games.push(g); // 同一グループ同士の試合は1回だけ載せる
      if (g.type === 'normal') (g.winner === self ? o.wins++ : o.losses++);
    }
  }
  return [...out.values()].map((o) => ({ ...o, winRate: rate(o.wins, o.losses) }));
}

/** AとBの直接対決（例：宮城 vs 北海道）。Aから見た勝敗 */
export function headToHead(db, { level = 'prefecture', a, b, ...filter }) {
  const hit = opponents(db, { level, key: a, ...filter }).find((o) => o.key === b);
  if (!hit) return { wins: 0, losses: 0, winRate: null, games: [] };
  return hit; // 同一グループ同士は各試合が1勝1敗になる
}

const ROUND_LABEL = { 1: '1回戦', 2: '2回戦', 3: '3回戦', 4: 'ベスト8', 5: 'ベスト4' };

/** 学校の出場履歴（新しい順）：当時の校名・代表枠・到達・勝敗 */
export function schoolHistory(db, { schoolId, ...filter }) {
  const tSet = selectTournaments(db, filter);
  const tMap = new Map(db.tournaments.map((t) => [t.id, t]));
  const reach = stages(db, tSet);
  return db.entries
    .filter((e) => e.schoolId === schoolId && tSet.has(e.tournamentId))
    .map((e) => {
      const t = tMap.get(e.tournamentId);
      const st = reach.get(`${e.tournamentId}|${schoolId}`);
      const result = !st ? '—' : st.round === ROUND_ORDER.F ? (st.champion ? '優勝' : '準優勝') : ROUND_LABEL[st.round];
      let wins = 0, losses = 0;
      for (const g of db.games) {
        if (g.tournamentId !== e.tournamentId || g.type !== 'normal' || (g.a !== schoolId && g.b !== schoolId)) continue;
        g.winner === schoolId ? wins++ : losses++;
      }
      return { tournament: t, nameAtTime: e.nameAtTime, slot: e.slot, result, wins, losses };
    })
    .sort((x, y) => y.tournament.year - x.tournament.year || (y.tournament.season === 'summer') - (x.tournament.season === 'summer'));
}

/** 試合の時系列キー（日付→その日の第何試合） */
const when = (g) => `${g.date || '9999-99-99'}#${String(g.gameNo ?? 99).padStart(2, '0')}`;

/**
 * 夏の各大会で、各校が初戦を迎えた順番（登場順）。
 * 同じ試合で2校が初登場する場合は、その試合までに登場した学校数を両校の番号にする
 * （最後に1校だけが初登場する試合は、出場校数と同じ番号＝「49番目」になる）。
 * 初戦が不戦勝・不戦敗だった学校（相手の辞退など）は、通常の初戦を迎えていないので対象外。
 */
export function debutOrder(db, filter = {}) {
  const tSet = selectTournaments(db, { ...filter, seasons: ['summer'] });
  const tMap = new Map(db.tournaments.map((t) => [t.id, t]));
  const reach = stages(db, tSet);
  const out = [];
  for (const tid of tSet) {
    const all = db.games.filter((g) => g.tournamentId === tid && g.type !== 'exchange');
    const firstByRound = new Map();
    for (const g of [...all].sort((x, y) => ROUND_ORDER[x.round] - ROUND_ORDER[y.round])) for (const s of [g.a, g.b]) if (!firstByRound.has(s)) firstByRound.set(s, g);
    const excluded = new Set([...firstByRound].filter(([, g]) => g.type === 'forfeit').map(([s]) => s));
    const games = all.filter((g) => g.date).sort((x, y) => when(x).localeCompare(when(y)));
    const seen = new Set(excluded);
    let count = 0;
    for (const g of games) {
      const fresh = [g.a, g.b].filter((s) => !seen.has(s));
      fresh.forEach((s) => seen.add(s));
      count += fresh.length;
      for (const s of fresh) {
        const self = s === g.a;
        const result = g.type === 'draw' ? '分' : g.type === 'forfeit' ? (g.winner === s ? '不戦勝' : '不戦敗') : g.winner === s ? '勝' : '敗';
        const st = reach.get(`${tid}|${s}`);
        const stage = !st ? '—' : st.round === ROUND_ORDER.F ? (st.champion ? '優勝' : '準優勝') : ROUND_LABEL[st.round];
        out.push({ tournament: tMap.get(tid), schoolId: s, order: count, firstGame: g, opponent: self ? g.b : g.a, score: self ? [g.scoreA, g.scoreB] : [g.scoreB, g.scoreA], result, stage });
      }
    }
  }
  return out;
}

/** 登場順ごとの初戦成績（引き分けは「分」として別に数え、勝率には入れない） */
export function debutStats(db, filter = {}) {
  const rows = new Map();
  for (const d of debutOrder(db, filter)) {
    if (!rows.has(d.order)) rows.set(d.order, { order: d.order, wins: 0, losses: 0, draws: 0, n: 0 });
    const r = rows.get(d.order);
    r.n++;
    if (d.result === '勝') r.wins++; else if (d.result === '敗') r.losses++; else if (d.result === '分') r.draws++;
  }
  return [...rows.values()].sort((x, y) => x.order - y.order).map((r) => ({ ...r, winRate: rate(r.wins, r.losses) }));
}

/** 各大会で最後に初戦を迎えた学校（「49番目」） */
export function lastDebuts(db, filter = {}) {
  const all = debutOrder(db, filter);
  const byT = new Map();
  for (const d of all) if (!byT.has(d.tournament.id) || byT.get(d.tournament.id).order < d.order) byT.set(d.tournament.id, d);
  return [...byT.values()].sort((x, y) => y.tournament.year - x.tournament.year);
}

// ---------- ドラフト（高校からの指名。育成・入団拒否を含む） ----------
const draftCache = new WeakMap();
function draftIndex(db) {
  if (!draftCache.has(db)) {
    const bySchool = new Map();
    for (const d of db.drafts ?? []) {
      if (!bySchool.has(d.schoolId)) bySchool.set(d.schoolId, []);
      bySchool.get(d.schoolId).push(d);
    }
    const ys = (db.drafts ?? []).map((d) => d.year);
    draftCache.set(db, { bySchool, tMap: new Map(db.tournaments.map((t) => [t.id, t])), from: ys.length ? Math.min(...ys) : null, to: ys.length ? Math.max(...ys) : null });
  }
  return draftCache.get(db);
}

/**
 * 大会の時点で在籍していた選手の指名年。高校3年の秋に指名されるので、
 * 夏は1〜3年生（指名年＝大会の年〜2年後）、春（3月）は新2・3年生（大会の年〜1年後）。
 */
export const generationYears = (t) => Array.from({ length: t.season === 'spring' ? 2 : 3 }, (_, i) => t.year + i);

/**
 * その大会の時点でその学校に在籍していた、のちのドラフト指名選手（ベンチ入りかどうかは問わない）。
 * 3年生の指名年がデータより前なら null。下級生の指名年がデータより先なら partial（今後のドラフトで増えうる）。
 */
export function draftGeneration(db, tournamentId, schoolId) {
  const { bySchool, tMap, from, to } = draftIndex(db);
  const t = tMap.get(tournamentId);
  if (!t || from === null) return null;
  const ys = generationYears(t);
  if (ys[0] < from) return null;
  const picks = (bySchool.get(schoolId) ?? [])
    .filter((d) => ys.includes(d.year))
    .map((d) => ({ ...d, grade: 3 - (d.year - t.year) }))
    .sort((x, y) => y.grade - x.grade || x.year - y.year);
  return { count: picks.length, picks, partial: ys.at(-1) > to };
}

/** 学校のドラフト指名一覧（絞り込んだ期間の年の範囲、新しい順） */
export function schoolDrafts(db, { schoolId, ...filter }) {
  const span = yearSpan(db, selectTournaments(db, filter));
  if (!span) return [];
  return (draftIndex(db).bySchool.get(schoolId) ?? [])
    .filter((d) => d.year >= span[0] && d.year <= span[1])
    .sort((x, y) => y.year - x.year || (x.kind === y.kind ? (x.round ?? 99) - (y.round ?? 99) : x.kind === 'regular' ? -1 : 1));
}
