// Wikipedia「YYYY年度新人選手選択会議 (日本プロ野球)」の記事から指名選手の行を読む。
// 球団別の一覧（見出し＝球団名、表＝順位・選手名・守備・所属・結果）を前提にする。
// 記事に「球団別指名選手一覧」の節があればそこだけを読む（冒頭の全体表と重複するため）。

const LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
const plain = (s) => s
  .replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
  .replace(/\{\{(?:efn|Efn2?|注釈)[^}]*\}\}/g, '')
  .replace(/\{\{仮リンク\|([^|}]+)[^}]*\}\}/g, '$1')
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
  .replace(/'''?/g, '').replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')
  .replace(/\{\{[^}]*\}\}/g, '').trim();
/** セル先頭の書式指定（style="..." | ）を落とす */
const cellBody = (c) => { const m = c.match(/^\s*(?:[a-z-]+\s*=\s*(?:"[^"]*"|[^|"\[]*?)\s*)+\|(?!\|)(.*)$/s); return (m ? m[1] : c).trim(); };
const links = (s) => [...s.matchAll(LINK)].map((m) => ({ target: m[1].trim(), label: (m[2] ?? m[1]).trim() }));

export function parseDraftArticle(text) {
  const start = text.search(/^==\s*球団別指名選手一覧\s*==/m);
  const body = start >= 0 ? text.slice(start) : text;
  const out = [];
  let team = '', kind = 'regular', round = '', inTable = false, pickTable = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const h = line.match(/^(={2,5})\s*(.+?)\s*\1$/);
    if (h) { team = plain(h[2]); continue; }
    if (line.startsWith('{|')) { inTable = true; pickTable = false; kind = 'regular'; round = ''; continue; }
    if (line.startsWith('|}')) { inTable = false; continue; }
    if (!inTable || line.startsWith('|-') || line.startsWith('|+')) continue;
    if (line.startsWith('!') && /所属/.test(line)) pickTable = true; // 所属の列がある表だけが指名選手の表
    if (line.startsWith('!')) { // 見出しセル：育成の切り替え、または行頭の順位（!1位）
      if (/育成/.test(line) && !/\d+(位|巡目)/.test(line)) kind = 'development';
      else if (/選手選択会議|新人選手/.test(line) && !/育成/.test(line)) kind = 'regular';
      const r = plain(cellBody(line.slice(1))).match(/^(育成)?\s*(?:高校生|大学生?・?社会人|大社)?\s*(\d+)\s*(?:位|巡目)/);
      if (r) { round = `${r[2]}`; if (r[1]) kind = 'development'; }
      continue;
    }
    if (!line.startsWith('|') || !pickTable) continue;
    let cells = line.slice(1).split('||').map(cellBody);
    const r0 = plain(cells[0]).match(/^(育成)?\s*(?:高校生|大学生?・?社会人|大社)?\s*(\d+)\s*(?:位|巡目)/);
    if (r0) { round = r0[2]; if (r0[1]) kind = 'development'; cells = cells.slice(1); }
    if (cells.length < 3) continue;
    const playerLinks = links(cells[0]);
    const player = plain(cells[0]);
    if (!player || player === '---' || /^[-—―]+$/.test(player)) continue;
    // 所属は守備の次の列。列が欠ける年に備え、選手名以外のセルを後ろから見る
    const affCell = cells.length >= 4 ? cells[2] : cells[1];
    const result = plain(cells[3] ?? cells.at(-1)); // 結果の後ろに備考列がある年もある
    out.push({
      team, kind, round: Number(round) || null,
      player, playerArticle: playerLinks[0]?.target ?? '',
      affiliation: plain(affCell), affiliationLinks: links(affCell).map((l) => l.target),
      result,
    });
  }
  // 同じ学校が記事内で2回目以降に出るとリンクが省かれるので、記事全体の「表示名→リンク先」で補う
  const byLabel = new Map();
  for (const l of links(text)) if (!byLabel.has(l.label)) byLabel.set(l.label, l.target);
  for (const r of out) if (!r.affiliationLinks.length && byLabel.has(r.affiliation)) r.affiliationLinks = [byLabel.get(r.affiliation)];
  return out;
}

/** 結果欄から入団・拒否を判定（「拒否・法政大学進学」「入団拒否」など） */
export const statusOf = (result) => (/指名取消/.test(result) ? 'canceled' : /拒否|辞退|放棄/.test(result) ? 'declined' : /入団|^[○〇]$/.test(result) ? 'signed' : 'unknown');

/**
 * 選手記事の基本情報欄から、経歴の高校（リンク先）と生年月日を読む。
 * 経歴は「| 経歴 =」の後の箇条書き。高校が複数あるとき（転校）は最後のもの。
 */
export function parsePlayerArticle(text, isHighSchool) {
  const lines = text.split('\n');
  const career = [];
  const i = lines.findIndex((l) => /^\|\s*経歴\s*=/.test(l.trim()));
  if (i >= 0) {
    for (const l of lines.slice(i + 1)) {
      const t = l.trim();
      if (t.startsWith('|') || t.startsWith('}}')) break;
      if (t.startsWith('*')) career.push(t);
    }
  }
  const hsFrom = (s) => links(s).filter((l) => isHighSchool(l.target));
  let schools = career.flatMap(hsFrom);
  if (!schools.length) { // 経歴がない記事は出身校欄
    const o = lines.find((l) => /^\|\s*出身校\s*=/.test(l.trim()));
    if (o) schools = hsFrom(o);
  }
  const b = lines.find((l) => /^\|\s*生年月日\s*=/.test(l.trim()));
  const m = b?.match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/);
  return { school: schools.at(-1)?.target ?? null, schoolLabel: schools.at(-1)?.label ?? '', birth: m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null };
}

/** 生年月日 → 高校3年の夏の年（4月2日〜翌年4月1日生まれが同じ学年） */
export const classYearOf = ([y, m, d]) => (m > 4 || (m === 4 && d >= 2) ? y + 18 : y + 17);

/** 記事名が高校か（大学・社会人・独立リーグを除く）。「〜高等部」（早稲田実・志学館）や「短期大学附属高等学校」も高校。DBの学校ID（記事名）がすべて当てはまることをテストで確かめている */
export const isHighSchool = (t) => /高等学校|高校|高等部|中等教育学校|学院|学園|学校$/.test(t) && !/野球部|野球団|クラブ|大学$|短期大学$|専門学校|大学校$/.test(t);
