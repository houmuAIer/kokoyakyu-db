// Wikipedia（日本語版）の大会記事の wikitext から、出場校と試合結果を取り出す。
// 夏の大会（代表校表＋Round テンプレート＋準々決勝以降の表＋決勝の Linescore）の書式に対応。

const ROUND_BY_LABEL = { '1回戦': 'R1', '2回戦': 'R2', '3回戦': 'R3', '準々決勝': 'QF', '準決勝': 'SF', '決勝': 'F' };
const PREFS = new Set(['北海道','青森','岩手','秋田','山形','宮城','福島','茨城','栃木','群馬','埼玉','千葉','東京','神奈川','山梨','新潟','長野','富山','石川','福井','静岡','愛知','岐阜','三重','滋賀','京都','大阪','兵庫','奈良','和歌山','鳥取','島根','岡山','広島','山口','香川','徳島','愛媛','高知','福岡','佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄']);
/** 学校の記事名に都道府県名が入っていれば取り出す（「青森県立八戸高等学校」「北海道帯広三条高等学校」など） */
export function prefectureFromArticle(article) {
  if (article.startsWith('北海道')) return '北海道';
  if (article.startsWith('東京都')) return '東京';
  const m = article.match(/^(.{2,3}?)[府県]/) ?? article.match(/^(.{2,3}?)市立/); // 「京都市立」「山形市立」のように県庁所在地と同名の市
  return m && PREFS.has(m[1]) ? m[1] : null;
}
/** 代表枠 → 都道府県（北北海道・東東京のほか、記念大会の南埼玉・東兵庫なども） */
export function prefectureOfSlot(slot) {
  if (PREFS.has(slot)) return slot;
  if (/^[東西南北]/.test(slot) && PREFS.has(slot.slice(1))) return slot.slice(1);
  return null;
}

/** [[記事名|表示名]] / [[記事名]] → { article, label } */
function link(cell) {
  const m = cell.match(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/);
  if (!m) return null;
  return { article: m[1].trim(), label: (m[2] ?? m[1]).trim() };
}
function plain(s) {
  let t = s.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<br\s*\/?>/g, '');
  for (let prev = ''; prev !== t;) { prev = t; t = t.replace(/\{\{[^{}]*\}\}/g, ''); } // 入れ子のテンプレートを内側から消す
  return t.replace(/'''?/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/^\|+/, '').trim();
}
const isBold = (s) => /'''/.test(s);
const score = (s) => { const m = plain(s).match(/^(\d+)/); return m ? Number(m[1]) : null; };
const section = (text, heading) => {
  const re = new RegExp(`^(=+)\\s*${heading}\\s*\\1\\s*$`, 'm');
  const m = text.match(re);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const next = rest.search(new RegExp(`^={1,${m[1].length}}[^=]`, 'm'));
  return next < 0 ? rest : rest.slice(0, next);
};
function isoDate(year, s) {
  const m = s && s.match(/(\d{1,2})月(\d{1,2})日/);
  return m ? `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
}

/** 代表校表 → [{ slot, prefecture, article, label }] */
export function parseRepresentatives(text) {
  const sec = section(text, '代表校');
  if (!sec) throw new Error('「代表校」の節が見つからない');
  const out = [];
  for (const line of sec.split('\n')) {
    if (!line.startsWith('|') || line.startsWith('|-') || line.startsWith('|}')) continue;
    const cells = line.slice(1).split('||');
    if (cells.length < 2) continue;
    const slot = link(cells[0])?.label ?? plain(cells[0]);
    const school = link(cells[1]);
    if (!school) continue;
    // 1977年以前の「奥羽」「北関東」などは複数県の代表枠なので、都道府県は後で学校から判定する
    out.push({ slot, prefecture: prefectureOfSlot(slot) ?? prefectureFromArticle(school.article), ...school });
  }
  return out;
}

/** Round テンプレート群 → 試合とトーナメント表の並び（上から） */
export function parseBracket(text, year) {
  const sec = section(text, '組み合わせ・試合結果') ?? section(text, '試合結果') ?? section(text, '1回戦 - 3回戦') ?? text;
  const blocks = templates(stripTemplates(sec, ['Efn', 'efn', 'Refnest', 'refnest']), 'Round')
    .map((t) => { const m = t.match(/^\{\{Round(\d+)[^\n]*\n([\s\S]*)\}\}$/); return m ? [m[0], m[1], m[2].replace(/([^\n])\|(RD\d+=)/g, '$1\n|$2')] : null; })
    .filter(Boolean);
  const games = [], order = [];
  for (const [, size, body] of blocks) {
    const rounds = []; let cur = null;
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      const rd = line.match(/^\|RD\d+=(.*)$/);
      if (rd) { cur = { label: rd[1].trim(), rows: [] }; rounds.push(cur); continue; }
      if (!line.startsWith('|') || !cur) continue;
      cur.rows.push(splitRow(line));
    }
    // 古い書き方：回戦名（RD1= RD2= …）が先頭にまとめて書かれ、試合はあとに続けて並ぶ。テンプレートの大きさから各回戦の試合数を割り振る
    if (rounds.length > 1 && rounds.slice(0, -1).every((r) => !r.rows.length)) {
      const rows = rounds.at(-1).rows; let k = 0;
      rounds.forEach((r, i) => { r.rows = rows.slice(k, k + Number(size) / 2 ** (i + 1)); k += Number(size) / 2 ** (i + 1); });
    }
    const parsed = rounds.map((r) => r.rows.map((cells) => rowToGame(cells, ROUND_BY_LABEL[r.label], year)));
    // 並び順：1回戦の各枠。空き枠（シード）は次の回戦の対応する側の学校
    const slots = Number(size);
    const firstRound = parsed[0] ?? [];
    for (let i = 0; i < slots / 2; i++) {
      const g = firstRound[i];
      if (g) { order.push(g.a, g.b); continue; }
      const next = parsed[1]?.[Math.floor(i / 2)];
      if (next) order.push(i % 2 === 0 ? next.a : next.b);
    }
    for (const r of parsed) for (const g of r) if (g) games.push(g);
  }
  return { games, order };
}

/** 括弧の対応を数えて {{name...}} を切り出す（入れ子・複数行に対応） */
function templates(text, name) {
  const out = [];
  for (let i = text.indexOf(`{{${name}`); i >= 0; i = text.indexOf(`{{${name}`, i + 2)) {
    let depth = 0, j = i;
    for (; j < text.length; j++) {
      if (text.startsWith('{{', j)) { depth++; j++; } else if (text.startsWith('}}', j)) { depth--; j++; if (depth === 0) break; }
    }
    out.push(text.slice(i, j + 1));
  }
  return out;
}
/** 指定したテンプレート（注釈など）を中身ごと取り除く */
function stripTemplates(text, names) {
  for (const n of names) for (const t of templates(text, n)) text = text.replace(t, '');
  return text;
}

/** テンプレートの1行を | で分ける（{{...}} や [[...]] の中の | は分けない） */
function splitRow(line) {
  const cells = []; let depth = 0, cur = '';
  for (let i = 1; i < line.length; i++) {
    const two = line.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; continue; }
    if (two === '}}' || two === ']]') { depth--; cur += two; i++; continue; }
    if (line[i] === '|' && depth === 0) { cells.push(cur); cur = ''; continue; }
    cur += line[i];
  }
  cells.push(cur);
  return cells;
}

function rowToGame(cells, round, year) {
  const [date = '', a = '', sa = '', b = '', sb = ''] = cells;
  if (!plain(a) && !plain(b)) return null; // 空き枠
  const nameA = plain(a).replace(/（不戦勝）|\(不戦勝\)/, '').trim();
  const nameB = plain(b).replace(/（不戦勝）|\(不戦勝\)/, '').trim();
  const forfeit = /不戦勝/.test(a + b);
  const scoreA = score(sa), scoreB = score(sb);
  let winner = isBold(a) ? nameA : isBold(b) ? nameB : null;
  let type = 'normal';
  if (forfeit) type = 'forfeit';
  else if (scoreA !== null && scoreA === scoreB) { type = 'draw'; winner = null; }
  const gameNo = Number(date.match(/[（(](\d+)[）)]/)?.[1]) || null;
  return { round, date: isoDate(year, date), gameNo, a: nameA, b: nameB, scoreA: forfeit ? null : scoreA, scoreB: forfeit ? null : scoreB, winner, type, replay: /再試合/.test(date) };
}

/** 準々決勝・準決勝の表（勝利||スコア||敗戦） */
export function parseResultTable(text, heading, year) {
  const sec = section(text, heading);
  if (!sec) return [];
  if (!/\{\|/.test(sec)) return parseResultList(sec, heading, year);
  const out = []; let date = '';
  for (const block of sec.split(/\n\|-\s*\n/)) {
    const line = block.split('\n').find((l) => l.startsWith('|') && !l.startsWith('|}') && !l.startsWith('|-'));
    if (!line) continue;
    const cells = line.slice(1).split('||').map((c) => c.replace(/^rowspan="\d+"\|/, '').replace(/^align=\w+\|/, ''));
    const hasDate = /月\d+日/.test(cells[0]);
    if (hasDate) date = cells[0];
    const [no, w, sc, l] = hasDate ? cells.slice(1) : cells; // [試合順, 勝利, スコア, 敗戦]
    const gameNo = Number(plain(no).match(/(\d+)/)?.[1]) || null;
    const base = { round: ROUND_BY_LABEL[heading], date: isoDate(year, date), gameNo, a: plain(w).replace(/（不戦勝）/, ''), b: plain(l).replace(/（不戦敗）|（辞退）/, ''), replay: /再試合/.test(line) };
    if (/不戦/.test(line)) { out.push({ ...base, scoreA: null, scoreB: null, winner: base.a, type: 'forfeit' }); continue; }
    const m = plain(sc).match(/(\d+)x?\s*-\s*(\d+)/);
    if (!m) continue;
    const draw = m[1] === m[2];
    out.push({ ...base, scoreA: Number(m[1]), scoreB: Number(m[2]), winner: draw ? null : base.a, type: draw ? 'draw' : 'normal' });
  }
  return out;
}

/** 決勝の Linescore テンプレート */
export function parseFinal(text, year) {
  const sec = section(text, '決勝') ?? section(text, '決勝戦') ?? section(text, '決勝戦スコア') ?? '';
  return [...sec.matchAll(/\{\{Linescore([\s\S]*?)\n\}\}/g)].map((t, i) => {
    const v = (k) => t[1].match(new RegExp(`\\|${k}=([^|\\n]*)`))?.[1]?.trim();
    const before = sec.slice(0, t.index).split('\n').reverse().find((l) => /月\d+日/.test(l)) ?? ''; // Date がない年は直前の行の日付
    const road = plain(v('Road')), home = plain(v('Home'));
    const rr = Number(v('RR')), hr = Number(v('HR'));
    const draw = rr === hr;
    return { round: 'F', date: isoDate(year, v('Date') ?? before), gameNo: 1, a: road, b: home, scoreA: rr, scoreB: hr, winner: draw ? null : rr > hr ? road : home, type: draw ? 'draw' : 'normal', replay: i > 0 };
  });
}

/** テンプレートと表の両方に載っている同じ試合を1つにする（日付のある方を残す） */
function dedupe(games) {
  const byKey = new Map();
  for (const g of games) {
    const k = `${g.round}|${[g.a, g.b].sort().join('|')}|${g.type}`;
    const prev = byKey.get(k);
    if (!prev || (!prev.date && g.date) || (!prev.gameNo && g.gameNo)) byKey.set(k, { ...prev, ...g, date: g.date || prev?.date || '', gameNo: g.gameNo ?? prev?.gameNo ?? null });
  }
  return [...byKey.values()];
}

/** 記事全体 → { reps, games, order } */
export function parseSummerArticle(text, year) {
  text = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, ''); // 注釈・コメントを先に除く
  const reps = parseRepresentatives(text);
  const { games, order } = parseBracket(text, year);
  games.push(...parseResultsSection(text, year), ...parseFinal(text, year));
  return { reps, games: dedupe(games), order };
}

/** 箇条書きの結果（「8月19日（第12日）」の行のあとに「* 勝利 9 - 2 敗戦」が並ぶ書き方） */
function parseResultList(sec, heading, year) {
  const out = []; let date = '', no = 0;
  for (const raw of sec.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('*') && /月\d+日/.test(line)) { date = line; no = 0; continue; }
    const m = plain(line.replace(/^\*+/, '')).match(/^(.+?)\s+(\d+)x?\s*-\s*(\d+)\s+(.+?)(?:\s*[（(].*)?$/);
    if (!line.startsWith('*') || !m) continue;
    no++;
    const draw = m[2] === m[3];
    out.push({ round: ROUND_BY_LABEL[heading], date: isoDate(year, date), gameNo: no, a: m[1].trim(), b: m[4].trim(), scoreA: Number(m[2]), scoreB: Number(m[3]), winner: draw ? null : m[1].trim(), type: draw ? 'draw' : 'normal', replay: /再試合/.test(line) });
  }
  return out;
}

/** 選抜の選出校表（地区||学校||都道府県||出場回数。地区セルは rowspan で省略されることがある） */
export function parseSelections(text) {
  const sec = section(text, '選出校') ?? section(text, '出場校');
  if (!sec) throw new Error('「選出校」「出場校」の節が見つからない');
  const out = [], seen = new Set();
  for (const line of sec.split('\n')) {
    // 箇条書き：* [[学校|略称]]（[[県|県]]、出場回数）
    const li = line.match(/^\*+\s*(\[\[[^\]]+\]\])\s*[（(]([^、,）)]+)/);
    if (li) {
      const school = link(li[1]);
      const pref = prefectureOfSlot(link(li[2])?.label ?? plain(li[2]));
      if (!school || !pref) throw new Error(`出場校の都道府県を判定できない: ${line}`);
      const article = seen.has(school.article) ? `${school.article}#${school.label}` : school.article; // 同じ記事にリンクされた別の学校（1947年の慶応と慶応商工など）
      seen.add(school.article);
      out.push({ slot: pref, prefecture: pref, ...school, article });
      continue;
    }
    if (!line.startsWith('|') || line.startsWith('|-') || line.startsWith('|}') || line.startsWith('|+')) continue;
    const cells = line.slice(1).split('||').map((c) => c.replace(/^\s*rowspan="\d+"\s*\|/, '').trim());
    // 学校のセル：都道府県へのリンクではない最初のリンク
    const iSchool = cells.findIndex((c) => { const l = link(c); return l && !/[都道府県]$/.test(l.article) && l.article !== '北海道'; }); // 学校名が県名と同じ（高知・三重など）こともあるので記事名で判定
    if (iSchool < 0 || iSchool + 1 >= cells.length) continue;
    const school = link(cells[iSchool]);
    const pref = prefectureOfSlot(link(cells[iSchool + 1])?.label ?? plain(cells[iSchool + 1]));
    if (!pref) throw new Error(`選出校の都道府県を判定できない: ${line}`);
    const article = seen.has(school.article) ? `${school.article}#${school.label}` : school.article;
    seen.add(school.article);
    out.push({ slot: pref, prefecture: pref, ...school, article });
  }
  return out;
}

/** 選抜の記事全体 → { reps, games } */
export function parseSpringArticle(text, year) {
  text = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  const reps = parseSelections(text);
  const { games } = parseBracket(text, year);
  games.push(...parseResultsSection(text, year), ...parseFinal(text, year));
  return { reps, games: dedupe(games) };
}

const SCORE_CELL = /^(\d+)x?\s*[-－–]\s*(\d+)x?$/;
const ROUND_LABELS = Object.keys(ROUND_BY_LABEL);
const roundIn = (t) => ROUND_BY_LABEL[ROUND_LABELS.find((l) => plain(t).replace(/\s/g, '') === l)] ?? null; // 表示名 → R1 などの回戦コード

/**
 * 試合結果の節を上から読み、表（列の並びは年によって違う）と箇条書きから試合を取り出す。
 * 回戦は「=== 2回戦 ===」の見出しか、表の中の見出し行（!colspan=6|2回戦）で切り替える。
 * Round テンプレート・Linescore は別の関数で読むので、ここでは除いてから読む。
 */
export function parseResultsSection(text, year) {
  let sec = section(text, '組み合わせ・試合結果') ?? section(text, '試合結果') ?? '';
  for (const n of ['Round', 'Linescore', 'Efn', 'efn', 'Refnest', 'refnest']) sec = stripTemplates(sec, [n]);
  const out = [];
  let round = null, date = '', listNo = 0;
  const push = (cells, raw) => {
    const iScore = cells.findIndex((c) => SCORE_CELL.test(plain(c)) || /^不戦/.test(plain(c)));
    if (iScore < 1 || iScore + 1 >= cells.length || !round) return;
    const dCell = cells.slice(0, iScore - 1).find((c) => /月\d+日/.test(c));
    if (dCell) date = dCell;
    const gameNo = Number(cells.slice(0, iScore).map((c) => plain(c).match(/第(\d+)試合/)?.[1]).find(Boolean)) || null;
    const a = plain(cells[iScore - 1]).replace(/（不戦勝）/, ''), b = plain(cells[iScore + 1]).replace(/（不戦敗）|（辞退）/, '');
    if (!a || !b) return;
    const base = { round, date: isoDate(year, date), gameNo, a, b, replay: /再試合/.test(raw) };
    const sc = plain(cells[iScore]);
    if (/不戦/.test(sc) || /不戦/.test(raw)) { out.push({ ...base, scoreA: null, scoreB: null, winner: a, type: 'forfeit' }); return; }
    const m = sc.match(SCORE_CELL);
    const draw = m[1] === m[2];
    out.push({ ...base, scoreA: Number(m[1]), scoreB: Number(m[2]), winner: draw ? null : a, type: draw ? 'draw' : 'normal' });
  };
  let row = null; // 表の1行（複数行に分かれたセルをまとめる）
  const flush = () => { if (row) { push(row.cells, row.raw); row = null; } };
  for (const rawLine of sec.split('\n')) {
    const line = rawLine.trim();
    const h = line.match(/^(=+)\s*(.+?)\s*\1$/);
    if (h) { flush(); const r = roundIn(h[2]); if (r) round = r; else if (/回戦|決勝/.test(h[2])) round = null; date = ''; continue; }
    if (line.startsWith('{|') || line.startsWith('|}')) { flush(); continue; }
    if (line.startsWith('|-')) { flush(); continue; }
    if (line.startsWith('!')) { flush(); const cells = line.replace(/^!/, '').split(/!!|\|\|/).map((c) => c.replace(/^[^|]*\|(?!\|)/, (x) => (/=/.test(x) ? '' : x))); const r = cells.map(roundIn).find(Boolean); if (r && cells.length <= 2) round = r; continue; }
    if (line.startsWith('|')) {
      const cells = line.slice(1).split('||').map((c) => c.replace(/^\s*(?:rowspan|colspan|style|align)[^|]*\|/, '').trim());
      if (!row) row = { cells: [], raw: '' };
      row.cells.push(...cells); row.raw += line;
      continue;
    }
    if (line.startsWith('*')) {
      flush();
      const body = plain(line.replace(/^\*+/, ''));
      if (/^[（(]/.test(body) || /ノーゲーム/.test(body)) continue; // 降雨ノーゲームなど、試合として数えない行
      const m = body.match(/^(.+?)\s*(\d+)x?\s*[-－–]\s*(\d+)x?\s*(.+?)(?:\s*[（(][^）)]*(?:延長|回|降雨|試合|日)[^）)]*[）)].*)?$/); // 「海星（長崎）2 - 0 海星（三重）」のように空白がない書き方もある
      if (!m || !round) continue;
      listNo++;
      push([date, `第${listNo}試合`, m[1], `${m[2]} - ${m[3]}`, m[4]], line);
      continue;
    }
    if (/月\d+日/.test(line)) { flush(); date = line; listNo = 0; const r = roundIn(line.replace(/^[;:]/, '')); if (r) round = r; }
  }
  flush();
  return out;
}
