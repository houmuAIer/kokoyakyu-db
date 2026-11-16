import { aggregate, rank, opponents, headToHead, lastDebuts, fromYearForRecent, schoolHistory, draftGeneration, schoolDrafts, draftRanking } from './aggregate.js';

const db = window.__DATA__ ?? await (await fetch('./data.json')).json();
db.drafts = (db.drafts ?? []).map((d) => ({ ...d, kind: d.kind ?? 'regular', status: d.status ?? 'signed', route: d.route ?? 'hs', classYear: d.classYear ?? d.year, team: db.draftTeams[d.team] }));

// ---------- 定数・ユーティリティ ----------
const LEVELS = { school: '学校', prefecture: '都道府県', slot: '代表枠', district: '地区' };
const METRICS = [
  ['appearances', '出場'], ['wins', '勝'], ['losses', '敗'], ['winRate', '勝率'],
  ['best8', 'ベスト8'], ['best4', 'ベスト4'], ['runnerUp', '準優勝'], ['champion', '優勝'],
];
const ROUND = { R1: '1回戦', R2: '2回戦', R3: '3回戦', QF: '準々決勝', SF: '準決勝', F: '決勝' };
const SEASON = { spring: '春', summer: '夏', exchange: '交流' };
const PREF_ORDER = Object.keys(db.districts);
const DISTRICT_ORDER = [...new Set(Object.values(db.districts))];
const schoolById = new Map(db.schools.map((s) => [s.id, s]));
const tById = new Map(db.tournaments.map((t) => [t.id, t]));
const entryIdx = new Map(db.entries.map((e) => [`${e.tournamentId}|${e.schoolId}`, e]));
const entryPref = (tid, sid) => entryIdx.get(`${tid}|${sid}`)?.prefecture ?? schoolById.get(sid).prefecture; // 出場当時の都道府県

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (r) => (r === null || r === undefined ? '—' : r.toFixed(3).replace(/^0/, ''));
const $ = (sel) => document.querySelector(sel);
const mainYears = db.tournaments.filter((t) => t.season !== 'exchange').map((t) => t.year);
const minYear = Math.min(...mainYears), maxYear = Math.max(...mainYears);
// ---------- 状態 ----------
const state = {
  seasons: 'both',
  period: { mode: 'all', era: null, n: Math.min(10, maxYear - minYear + 1) },
  tab: 'ranking',
  level: 'school', metric: 'wins', minGames: 0,
  h2h: { level: 'prefecture', a: null, b: '' },
  school: null,
  debutTeams: '49',
  genOpen: null, // 世代のドラフト指名を開いている「試合ID|大会ID|学校ID」
  draftRank: { level: 'school', metric: 'total' },
};

function filter() {
  const f = { seasons: state.seasons === 'both' ? ['spring', 'summer'] : [state.seasons] };
  if (state.period.mode === 'era') f.era = state.period.era;
  if (state.period.mode === 'from2000') f.fromYear = 2000;
  if (state.period.mode === 'recent') f.fromYear = fromYearForRecent(db, state.period.n, f.seasons);
  return f;
}

function keysFor(level) {
  const rows = aggregate(db, { level });
  const order = level === 'prefecture' ? (k) => PREF_ORDER.indexOf(k)
    : level === 'district' ? (k) => DISTRICT_ORDER.indexOf(k)
    : level === 'slot' ? (k) => PREF_ORDER.findIndex((p) => k.includes(p)) * 10 + (k.length > 3 ? 1 : 0)
    : null;
  if (order) return rows.sort((x, y) => order(x.key) - order(y.key)).map((r) => [r.key, r.label]);
  return rows.sort((x, y) => schoolSort(x.key, y.key)).map((r) => [r.key, `${r.label}（${schoolById.get(r.key).prefecture}）`]);
}
const schoolSort = (a, b) => {
  const sa = schoolById.get(a), sb = schoolById.get(b);
  return PREF_ORDER.indexOf(sa.prefecture) - PREF_ORDER.indexOf(sb.prefecture) || sa.name.localeCompare(sb.name, 'ja');
};

const nameCell = (level, key, label) => {
  if (level === 'school') {
    return `<button class="link" data-school="${esc(key)}">${esc(label)}</button><span class="subtle">${esc(schoolById.get(key).prefecture)}</span>`;
  }
  return `<button class="link" data-h2h-level="${level}" data-h2h-a="${esc(key)}">${esc(label)}</button>`;
};

function gameRows(games, selfKeyFn) {
  const sorted = [...games].sort((x, y) => (tById.get(y.tournamentId).year - tById.get(x.tournamentId).year) || (y.date || '').localeCompare(x.date || ''));
  return sorted.map((g) => {
    const t = tById.get(g.tournamentId);
    const aIsSelf = selfKeyFn ? selfKeyFn(g, g.a) : true;
    const [s, o, ss, os] = aIsSelf ? [g.a, g.b, g.scoreA, g.scoreB] : [g.b, g.a, g.scoreB, g.scoreA];
    const res = g.type === 'draw' ? '<span class="subtle">引き分け</span>'
      : g.type === 'forfeit' ? (g.winner === s ? '<span class="subtle">不戦勝</span>' : '<span class="subtle">不戦敗・辞退</span>')
      : g.winner === s ? '<span class="win">○</span>' : '<span class="lose">●</span>';
    const score = ss === null ? '—' : `${ss} - ${os}`;
    const sch = (id) => entryName(g.tournamentId, id);
    const open = [s, o].map((id) => `${g.id}|${g.tournamentId}|${id}`).find((k) => k === state.genOpen); // 開くのは押した試合の行だけ
    return `<tr><td class="name">${t.year} ${SEASON[t.season]}</td><td class="name">${ROUND[g.round]}${g.replayOf ? '<span class="replay">再試合</span>' : ''}</td>
      <td class="name">${esc(sch(s))}${genBadge(g, s)}</td><td>${res}</td><td>${score}</td><td class="name">${esc(sch(o))}<span class="subtle">${esc(entryPref(g.tournamentId, o))}</span>${genBadge(g, o)}</td></tr>
      ${open ? `<tr class="gen-detail"><td colspan="6">${genDetail(...open.split('|').slice(1))}</td></tr>` : ''}`;
  }).join('');
}

// ---------- ドラフト ----------
const kindRound = (d) => (d.kind === 'development' ? `育成${d.round ?? ''}位` : d.round ? `${d.round}位` : '枠');
const statusTag = (d) => (d.status === 'declined' ? '<span class="draft-declined">拒否</span>' : d.status === 'canceled' ? '<span class="draft-declined">取消</span>' : '');
/** 大会の時点で在籍していた、のちのドラフト指名選手の数（高卒・大社。押すと内訳） */
function genBadge(game, sid) {
  const tid = game.tournamentId;
  const g = draftGeneration(db, tid, sid);
  if (!g) return '';
  const key = `${game.id}|${tid}|${sid}`;
  const open = state.genOpen === key ? 'open' : '';
  return `<button class="draft-gen ${g.count ? '' : 'zero'} ${open}" data-gen="${esc(key)}" title="在籍していて、高校から指名された選手">指名${g.count}${g.partial ? '+' : ''}</button>`
    + `<button class="draft-gen later ${g.laterCount ? '' : 'zero'} ${open}" data-gen="${esc(key)}" title="在籍していて、大学・社会人などを経て指名された選手">大社${g.laterCount}${g.laterPartial ? '+' : ''}</button>`;
}
function genDetail(tid, sid) {
  const g = draftGeneration(db, tid, sid);
  const t = tById.get(tid);
  const who = `${esc(entryName(tid, sid))}（${t.year} ${SEASON[t.season]}）`;
  const list = (picks, later) => (picks.length
    ? `<ul class="gen-list">${picks.map((d) => `<li>${d.grade}年 ${esc(d.player)} <span class="subtle">${d.year} ${esc(d.team)} ${kindRound(d)}${later ? `（${esc(d.affiliation)}）` : ''}</span>${statusTag(d)}</li>`).join('')}</ul>`
    : '<p class="gen-none">いません</p>');
  const more = (p, text) => (p ? `<span class="subtle">${text}</span>` : '');
  return `<b>${who}</b>
    <div class="gen-head">高校から指名${more(g.partial, '下級生はこれからのドラフトで増える可能性があります')}</div>${list(g.picks, false)}
    <div class="gen-head">大学・社会人などを経て指名${more(g.laterPartial, '大学経由などでこれから増える可能性があります')}</div>${list(g.laterPicks, true)}`;
}
const GEN_NOTE = '<p class="note">「指名n」「大社n」は、その大会の時点でその学校に在籍していた、のちのドラフト指名選手の数です。「指名」は高校から直接、「大社」は大学・社会人・独立リーグなどを経ての指名（学年は生年月日から判定）。夏は1〜3年、春は新2・3年で、ベンチ入りかどうかは問いません。育成・入団拒否を含み、1965年以降のドラフトが対象。押すと内訳が出ます。「+」はこれから増える可能性がある大会です。</p>';

const entryName = (tid, sid) => entryIdx.get(`${tid}|${sid}`)?.nameAtTime ?? schoolById.get(sid).name;
const gamesTable = (rowsHtml) => `<div class="table-wrap"><table><thead><tr><th class="name">大会</th><th class="name">回戦</th><th class="name">学校</th><th></th><th>スコア</th><th class="name">相手</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;

// ---------- ビュー ----------
function viewRanking() {
  const rows = rank(aggregate(db, { level: state.level, ...filter() }), state.metric, { minGames: state.metric === 'winRate' ? state.minGames : 0 });
  let prev, prevRank = 0;
  const body = rows.map((r, i) => {
    const v = r[state.metric];
    const rk = v === prev ? prevRank : i + 1;
    prev = v; prevRank = rk;
    return `<tr><td class="rank">${rk}</td><td class="name">${nameCell(state.level, r.key, r.label)}</td>
      <td>${r.appearances}</td><td>${r.wins}</td><td>${r.losses}</td><td>${pct(r.winRate)}</td>
      <td>${r.best8}</td><td>${r.best4}</td><td>${r.runnerUp}</td><td>${r.champion ? `<span class="circled">${r.champion}</span>` : 0}</td></tr>`;
  }).join('');
  const head = METRICS.map(([k, l]) => `<th class="sortable ${k === state.metric ? 'active' : ''}" data-metric="${k}">${l}</th>`).join('');
  return `<div class="controls">
      <label>集計単位 <select id="level">${Object.entries(LEVELS).map(([k, l]) => `<option value="${k}" ${k === state.level ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>並び順 <select id="metric">${METRICS.map(([k, l]) => `<option value="${k}" ${k === state.metric ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${state.metric === 'winRate' ? `<label>最低試合数 <input type="number" id="min-games" min="0" value="${state.minGames}"></label>` : ''}
    </div>
    <div class="ledger">${rows.length ? `<div class="table-wrap"><table><thead><tr><th class="rank">順位</th><th class="name">${LEVELS[state.level]}</th>${head}</tr></thead><tbody>${body}</tbody></table></div>` : '<p class="empty">この条件に当てはまる出場校はありません。期間や大会を広げてください。</p>'}</div>`;
}

function viewH2H() {
  const h = state.h2h;
  const keys = keysFor(h.level);
  if (!h.a || !keys.some(([k]) => k === h.a)) h.a = keys[0]?.[0];
  const opt = (sel, withAll) => (withAll ? `<option value="">（対戦相手別の一覧）</option>` : '') + keys.map(([k, l]) => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
  let content;
  const selfKey = (g, sid) => {
    if (h.level === 'school') return sid === h.a;
    const pref = entryPref(g.tournamentId, sid);
    const v = h.level === 'prefecture' ? pref : h.level === 'district' ? db.districts[pref] : entryIdx.get(`${g.tournamentId}|${sid}`).slot;
    return v === h.a;
  };
  if (h.b) {
    const r = headToHead(db, { level: h.level, a: h.a, b: h.b, ...filter() });
    const label = (k) => keys.find(([x]) => x === k)?.[1] ?? k;
    content = `<div class="ledger"><div class="ledger-title"><h2>${esc(label(h.a))} 対 ${esc(label(h.b))}</h2>${h.a === h.b ? '<span class="aside">同じグループ同士の対戦なので、各試合が1勝1敗になります</span>' : ''}</div>
      <div class="record"><span class="big"><span class="w">${r.wins}</span><small>勝</small>${r.losses}<small>敗</small></span><span class="rate">勝率<b>${pct(r.winRate)}</b></span></div>
      ${r.games.length ? GEN_NOTE + gamesTable(gameRows(r.games, selfKey)) : '<p class="empty">この条件での対戦はありません</p>'}</div>`;
  } else {
    const rows = opponents(db, { level: h.level, key: h.a, ...filter() })
      .sort((x, y) => (y.wins + y.losses) - (x.wins + x.losses) || y.wins - x.wins);
    content = `<div class="ledger">${rows.length ? `<div class="table-wrap"><table><thead><tr><th class="name">対戦相手</th><th>勝</th><th>敗</th><th>勝率</th><th>試合</th></tr></thead><tbody>
      ${rows.map((o) => `<tr><td class="name"><button class="link" data-h2h-b="${esc(o.key)}">${esc(o.label)}</button></td><td>${o.wins}</td><td>${o.losses}</td><td>${pct(o.winRate)}</td><td>${o.games.length}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">この条件での対戦はありません</p>'}</div>`;
  }
  return `<div class="controls">
      <label>単位 <select id="h2h-level">${Object.entries(LEVELS).map(([k, l]) => `<option value="${k}" ${k === h.level ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>A <select id="h2h-a">${opt(h.a, false)}</select></label>
      <label>B <select id="h2h-b">${opt(h.b, true)}</select></label>
    </div>${content}`;
}

function viewSchool() {
  const keys = keysFor('school');
  if (!state.school) state.school = keys[0]?.[0];
  const s = schoolById.get(state.school);
  const f = filter();
  const sum = aggregate(db, { level: 'school', ...f }).find((r) => r.key === s.id);
  const hist = schoolHistory(db, { schoolId: s.id, ...f });
  const opp = opponents(db, { level: 'school', key: s.id, ...f }).sort((x, y) => y.games.length - x.games.length || schoolSort(x.key, y.key));
  const allGames = opp.flatMap((o) => o.games);
  const drafts = schoolDrafts(db, { schoolId: s.id, ...f });
  const genCell = (h) => { const g = draftGeneration(db, h.tournament.id, s.id); return g ? `${g.count}${g.partial ? '+' : ''}・${g.laterCount}${g.laterPartial ? '+' : ''}` : '—'; };
  const nHs = drafts.filter((d) => d.route === 'hs').length;
  const stat = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  const tag = (r) => (r === '優勝' ? 'circled' : r === '準優勝' ? 'result-runner' : 'result-plain');
  return `<div class="controls"><label>学校 <input list="school-list" id="school-input" placeholder="校名で検索" value="${esc(`${s.name}（${s.prefecture}）`)}"></label>
      <datalist id="school-list">${keys.map(([, l]) => `<option value="${esc(l)}">`).join('')}</datalist></div>
    <div class="ledger"><div class="ledger-title"><h2>${esc(s.name)}</h2><span class="aside">${esc(s.prefecture)}（${esc(db.districts[s.prefecture])}地区）</span></div>
      ${sum ? `<dl class="tally">${stat('出場', sum.appearances)}${stat('勝敗', `${sum.wins}-${sum.losses}`)}${stat('勝率', pct(sum.winRate))}${stat('ベスト8', sum.best8)}${stat('ベスト4', sum.best4)}${stat('準優勝', sum.runnerUp)}${stat('優勝', sum.champion)}${stat('高卒指名', nHs)}${stat('大社指名', drafts.length - nHs)}</dl>` : '<p class="empty">この条件での出場はありません。期間や大会を広げてください。</p>'}
      ${hist.length ? `<h3>出場履歴</h3><div class="table-wrap"><table><thead><tr><th class="name">大会</th><th class="name">当時の校名</th><th class="name">代表枠</th><th>成績</th><th>勝敗</th><th>在籍の指名<br><span class="subtle">高卒・大社</span></th></tr></thead><tbody>
        ${hist.map((h) => `<tr><td class="name">${h.tournament.year} ${SEASON[h.tournament.season]}${h.tournament.edition ? `<span class="subtle">第${h.tournament.edition}回</span>` : ''}</td><td class="name">${esc(h.nameAtTime)}</td><td class="name">${esc(h.slot)}</td><td><span class="${tag(h.result)}">${esc(h.result)}</span></td><td>${h.wins}-${h.losses}</td><td>${genCell(h)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      ${opp.length ? `<h3>対戦校別</h3><div class="table-wrap"><table><thead><tr><th class="name">対戦校</th><th>勝</th><th>敗</th><th>試合</th></tr></thead><tbody>
        ${opp.map((o) => `<tr><td class="name">${nameCell('school', o.key, o.label)}</td><td>${o.wins}</td><td>${o.losses}</td><td>${o.games.length}</td></tr>`).join('')}
      </tbody></table></div>
      <h3>全試合</h3>${GEN_NOTE}${gamesTable(gameRows(allGames, (g, sid) => sid === s.id))}` : ''}
      ${drafts.length ? `<h3>ドラフト指名</h3><p class="note">期間内に指名された、この学校の出身者です。「大社」は大学・社会人などを経ての指名で、高校3年の年を添えています。</p><div class="table-wrap"><table><thead><tr><th class="name">年</th><th class="name">選手</th><th class="name">球団・順位</th><th class="name">経由</th></tr></thead><tbody>
        ${drafts.map((d) => `<tr><td class="name">${d.year}</td><td class="name">${esc(d.player)}${statusTag(d)}</td><td class="name">${esc(d.team)}<span class="subtle">${kindRound(d)}</span></td><td class="name">${d.route === 'later' ? `大社<span class="subtle">${esc(d.affiliation)}・高3 ${d.classYear}</span>` : '高卒'}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
    </div>`;
}

const DRAFT_METRICS = [['total', '合計'], ['hs', '高卒'], ['later', '大社'], ['first', '1位'], ['development', '育成']];
function viewDraftRank() {
  const dr = state.draftRank;
  const rows = draftRanking(db, { level: dr.level, ...filter() })
    .sort((x, y) => y[dr.metric] - x[dr.metric] || y.total - x.total || y.first - x.first);
  let prev, prevRank = 0;
  const body = rows.filter((r) => r[dr.metric] > 0).map((r, i) => {
    const v = r[dr.metric];
    const rk = v === prev ? prevRank : i + 1;
    prev = v; prevRank = rk;
    return `<tr><td class="rank">${rk}</td><td class="name">${nameCell(dr.level, r.key, r.label)}</td>${DRAFT_METRICS.map(([k]) => `<td>${r[k]}</td>`).join('')}</tr>`;
  }).join('');
  const head = DRAFT_METRICS.map(([k, l]) => `<th class="sortable ${k === dr.metric ? 'active' : ''}" data-draft-metric="${k}">${l}</th>`).join('');
  return `<p class="note">期間内に行われたドラフト会議で指名された、甲子園出場校の出身者の数です（1965年以降。育成・入団拒否を含む）。「高卒」は高校から直接、「大社」は大学・社会人・独立リーグなどを経ての指名。「1位」は本指名の1位（自由獲得枠・希望枠は含まない）。期間は大会の年の範囲で数え、春夏の切り替えは関係しません。県・地区は学校の最新の出場時のものです。</p>
    <div class="controls">
      <label>集計単位 <select id="draft-level">${Object.entries(LEVELS).map(([k, l]) => `<option value="${k}" ${k === dr.level ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>並び順 <select id="draft-metric">${DRAFT_METRICS.map(([k, l]) => `<option value="${k}" ${k === dr.metric ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div class="ledger">${body ? `<div class="table-wrap"><table><thead><tr><th class="rank">順位</th><th class="name">${LEVELS[dr.level]}</th>${head}</tr></thead><tbody>${body}</tbody></table></div>` : '<p class="empty">この期間の指名はありません。</p>'}</div>`;
}

function viewDebut() {
  if (state.seasons === 'spring') return '<p class="empty">登場順の集計は夏の大会だけです。大会を「春夏」か「夏」にしてください。</p>';
  const teamCounts = [...new Set(db.tournaments.filter((t) => t.season === 'summer').map((t) => t.numTeams))].sort((a, b) => a - b);
  const f = { ...filter() };
  if (state.debutTeams !== 'all') f.numTeams = Number(state.debutTeams);
  const last = lastDebuts(db, f);
  const w = last.filter((d) => d.result === '勝').length, l = last.filter((d) => d.result === '敗').length, dr = last.filter((d) => d.result === '分').length;
  const mark = (r) => (r === '勝' ? '<span class="win">○</span>' : r === '敗' ? '<span class="lose">●</span>' : `<span class="subtle">${r}</span>`);
  const stageTag = (st) => (st === '優勝' ? 'circled' : st === '準優勝' ? 'result-runner' : ['ベスト8', 'ベスト4'].includes(st) ? 'result-runner' : 'result-plain');
  return `<p class="note">各校が初戦を迎えた順番です。最後に初戦を迎える学校（49校の大会なら49番目）は、1回戦を勝ち上がってきた相手と戦います。初戦が不戦勝・不戦敗だった学校は数えません。</p>
    <div class="controls"><label>出場校数 <select id="debut-teams"><option value="all" ${state.debutTeams === 'all' ? 'selected' : ''}>すべての大会</option>${teamCounts.map((n) => `<option value="${n}" ${String(n) === state.debutTeams ? 'selected' : ''}>${n}校の大会</option>`).join('')}</select></label></div>
    <div class="ledger"><div class="ledger-title"><h2>最後に初戦を迎えた学校</h2><span class="aside">${last.length}大会</span></div>
      ${last.length ? `<div class="record"><span class="big"><span class="w">${w}</span><small>勝</small>${l}<small>敗</small>${dr ? `${dr}<small>分</small>` : ''}</span><span class="rate">初戦の勝率<b>${pct(w + l ? w / (w + l) : null)}</b></span><span class="rate">（初戦全体では勝ちと負けが同数なので .500）</span></div>
      <div class="table-wrap"><table><thead><tr><th class="name">大会</th><th class="name">学校</th><th>登場順</th><th class="name">初戦</th><th></th><th>スコア</th><th class="name">相手</th><th>最終成績</th></tr></thead><tbody>
      ${last.map((d) => `<tr><td class="name">${d.tournament.year} 夏</td><td class="name">${nameCell('school', d.schoolId, entryName(d.tournament.id, d.schoolId))}</td><td>${d.order}/${d.tournament.numTeams}</td>
        <td class="name">${ROUND[d.firstGame.round]}<span class="subtle">${esc((d.firstGame.date || '').slice(5).replace('-', '/'))}</span></td><td>${mark(d.result)}</td><td>${d.score[0] ?? '—'} - ${d.score[1] ?? '—'}</td>
        <td class="name">${esc(entryName(d.tournament.id, d.opponent))}<span class="subtle">${esc(entryPref(d.tournament.id, d.opponent))}</span></td><td><span class="${stageTag(d.stage)}">${esc(d.stage)}</span></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">この条件に当てはまる大会はありません。期間や出場校数を変えてください。</p>'}</div>
`;
}

// ---------- 描画とイベント ----------
function renderFilters() {
  document.querySelectorAll('#seasons button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === state.seasons)));
  // 期間の区分：戦後（データ全体）・平成・2000年以降・令和・直近n年
  const modes = [['all', '戦後'], ['era:平成', '平成'], ['from2000', '2000年以降'], ['era:令和', '令和'], ['recent', '直近n年']];
  const cur = state.period.mode === 'era' ? `era:${state.period.era}` : state.period.mode;
  $('#period').innerHTML = modes.map(([v, l]) => `<button data-v="${v}" aria-pressed="${v === cur}">${l}</button>`).join('');
  const span = maxYear - minYear + 1;
  $('#recent-box').hidden = state.period.mode !== 'recent';
  $('#recent-n').max = String(span);
  $('#recent-n').value = String(state.period.n);
  $('#recent-out').textContent = state.period.n;
  const f = filter();
  const notes = { all: `夏${minYear}年・春${minYear + 1}年以降`, 'era:平成': '1989年春〜2019年春', 'era:令和': '2019年夏以降', recent: `${f.fromYear}〜${maxYear}年` };
  $('#period-note').textContent = notes[cur] ?? '';
}

const VIEWS = { ranking: viewRanking, draft: viewDraftRank, h2h: viewH2H, school: viewSchool, debut: viewDebut };
function render() {
  renderFilters();
  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  $('#view').innerHTML = VIEWS[state.tab]();
}

$('#seasons').addEventListener('click', (e) => { if (e.target.dataset.v) { state.seasons = e.target.dataset.v; render(); } });
$('#period').addEventListener('click', (e) => {
  const v = e.target.dataset.v;
  if (!v) return;
  if (v.startsWith('era:')) state.period = { ...state.period, mode: 'era', era: v.slice(4) };
  else state.period = { ...state.period, mode: v };
  render();
});
$('#recent-n').addEventListener('input', (e) => { state.period.n = Number(e.target.value); render(); });
$('#tabs').addEventListener('click', (e) => { if (e.target.dataset.tab) { state.tab = e.target.dataset.tab; render(); } });

const view = $('#view');
view.addEventListener('change', (e) => {
  const id = e.target.id, v = e.target.value;
  if (id === 'level') state.level = v;
  else if (id === 'metric') state.metric = v;
  else if (id === 'min-games') state.minGames = Math.max(0, Number(v) || 0);
  else if (id === 'h2h-level') state.h2h = { level: v, a: null, b: '' };
  else if (id === 'h2h-a') state.h2h.a = v;
  else if (id === 'h2h-b') state.h2h.b = v;
  else if (id === 'debut-teams') state.debutTeams = v;
  else if (id === 'draft-level') state.draftRank.level = v;
  else if (id === 'draft-metric') state.draftRank.metric = v;
  else if (id === 'school-input') {
    const hit = keysFor('school').find(([, l]) => l === v) ?? keysFor('school').find(([, l]) => l.startsWith(v));
    if (hit) state.school = hit[0];
  } else return;
  render();
});
view.addEventListener('click', (e) => {
  const t = e.target.closest('[data-metric],[data-draft-metric],[data-school],[data-h2h-a],[data-h2h-b],[data-gen]');
  if (!t) return;
  const d = t.dataset;
  if (d.draftMetric) state.draftRank.metric = d.draftMetric;
  else if (d.gen) state.genOpen = state.genOpen === d.gen ? null : d.gen;
  else if (d.metric) state.metric = d.metric;
  else if (d.school) { state.school = d.school; state.tab = 'school'; window.scrollTo(0, 0); }
  else if (d.h2hA) { state.h2h = { level: d.h2hLevel, a: d.h2hA, b: '' }; state.tab = 'h2h'; window.scrollTo(0, 0); }
  else if (d.h2hB) state.h2h.b = d.h2hB;
  render();
});

render();
