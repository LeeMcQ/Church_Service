// The service plan as a Word document: a title block, an order-of-service table (times, parts, what is
// shown, who leads) and, if wanted, the Scripture readings and hymn words on the pages after it.
// planWord(model) takes plain data (see plan.js → exportWord) and returns a .docx Blob.
import { run, para, cell, row, table, line, sideBorders, buildDocx, contentWidth, DOCX_TYPE } from './docx.js';

const NAVY = '1F4068', GOLD = 'B8892B', INK = '222222', MUTED = '6B7280', RULE = 'D5D9E0', BAND = 'F4F6FA';
const KIND = { bible: '1D4ED8', hymns: '6D28D9', slides: 'B45309', video: 'B91C1C', web: '0E7490', ai: '047857', note: '6B7280' };

const pad2 = (n) => (n < 10 ? '0' : '') + n;
export const clock = (mins) => pad2(Math.floor(mins / 60) % 24) + ':' + pad2(Math.round(mins % 60));
export const duration = (mins) => { mins = Math.round(mins); const h = Math.floor(mins / 60), m = mins % 60; return h ? h + ' h' + (m ? ' ' + m + ' min' : '') : m + ' min'; };

/**
 * model: {church, title, dateLine, start:'09:30', showTimes, notes:bool, generated,
 *   parts:[{n, part, kind:'bible'|'hymns'|…, kindLabel, detail, role, mins, empty}],
 *   readings:[{ref, tr, verses:[{v, t}], more}], hymns:[{n, title, book, stanzas:[[line]], chorus:[line]}] }
 */
export function planWord(model) {
  const landscape = !!model.notes;
  const W = contentWidth(landscape);
  const out = [];
  const total = model.parts.reduce((a, p) => a + (p.mins > 0 ? p.mins : 0), 0);
  const anyMins = total > 0;
  const times = !!model.showTimes && anyMins;

  // ---- title block
  if (model.church) out.push(para(run(model.church, { caps: true, b: true, sz: 20, color: GOLD, spacing: 40 }), { after: 40 }));
  out.push(para(run(model.title || 'Order of service', { b: true, sz: 56, color: NAVY, font: 'Georgia' }), { style: 'Title', after: 40, keepNext: true }));
  const sub = [model.dateLine, model.start && times ? 'Starts ' + model.start : ''].filter(Boolean).join('   ·   ');
  if (sub) out.push(para(run(sub, { sz: 24, color: MUTED }), { after: 160, borderBottom: { sz: 14, color: GOLD }, keepNext: true }));

  // ---- summary band
  const leaders = new Set(model.parts.map((p) => p.role).filter(Boolean));
  const facts = [['Parts', String(model.parts.length)]];
  if (anyMins) facts.push(['Planned time', duration(total)]);
  if (times) facts.push(['Ends about', clock(toMin(model.start) + total)]);
  if (leaders.size) facts.push(['Taking part', String(leaders.size)]);
  const fw = Math.floor(W / facts.length);
  out.push(table([row(facts.map(([k, v], i) => cell([
    para(run(k, { caps: true, sz: 16, b: true, color: MUTED, spacing: 20 }), { after: 20 }),
    para(run(v, { b: true, sz: 30, color: NAVY }))], { w: i === facts.length - 1 ? W - fw * (facts.length - 1) : fw, fill: BAND, pad: [100, 160, 100, 160] })))], facts.map((_, i) => (i === facts.length - 1 ? W - fw * (facts.length - 1) : fw))));
  out.push(para('', { after: 160 }));

  // ---- the order of service
  const cols = [];
  if (times) cols.push(['Time', 900]);
  cols.push(['Part', 2700], ['What is shown', 0], ['Led by', 1900]);
  if (anyMins) cols.push(['Min', 650]);
  if (model.notes) cols.push(['Notes', 3300]);
  const fixed = cols.reduce((a, c) => a + c[1], 0);
  cols.find((c) => c[0] === 'What is shown')[1] = Math.max(2200, W - fixed);
  const widths = cols.map((c) => c[1]);
  const sumW = widths.reduce((a, b) => a + b, 0);
  if (sumW !== W) widths[widths.length - 1] += W - sumW;
  const hdr = row(cols.map((c, i) => cell(para(run(c[0], { b: true, sz: 18, color: 'FFFFFF', caps: true, spacing: 20 }), { align: c[0] === 'Min' ? 'right' : 'left' }),
    { w: widths[i], fill: NAVY, vAlign: 'center', pad: [90, 120, 90, 120] })), { header: true });
  let t = times ? toMin(model.start) : 0;
  const rows = model.parts.map((p, idx) => {
    const k = KIND[p.kind] || KIND.note;
    const fill = idx % 2 ? BAND : 'FFFFFF';
    const base = { fill, pad: [100, 120, 100, 120], borders: sideBorders({ bottom: [4, RULE] }) };
    const cells = [];
    if (times) cells.push(cell(para(run(clock(t), { b: true, color: NAVY, sz: 20 })), Object.assign({ w: widths[cells.length] }, base)));
    t += p.mins > 0 ? p.mins : 0;
    cells.push(cell(para(run(p.part || 'Part', { b: true, sz: 22 })), Object.assign({ w: widths[cells.length] }, base)));
    const det = [];
    if (p.kindLabel) det.push(para(run(p.kindLabel, { caps: true, b: true, sz: 15, color: k, spacing: 20 }), { after: 20 }));
    det.push(para(run(p.detail || (p.empty ? '—' : ''), { sz: 21, color: p.detail ? INK : MUTED })));
    cells.push(cell(det, Object.assign({ w: widths[cells.length] }, base)));
    cells.push(cell(para(run(p.role || '', { sz: 20 })), Object.assign({ w: widths[cells.length] }, base)));
    if (anyMins) cells.push(cell(para(run(p.mins > 0 ? String(p.mins) : '', { sz: 20, color: MUTED }), { align: 'right' }), Object.assign({ w: widths[cells.length] }, base)));
    if (model.notes) cells.push(cell(para(''), Object.assign({ w: widths[cells.length] }, base)));
    return row(cells);
  });
  if (!rows.length) rows.push(row([cell(para(run('This plan has no parts yet.', { i: true, color: MUTED })), { w: W, span: cols.length, pad: [160, 120, 160, 120] })]));
  out.push(table([hdr, ...rows], widths, { borders: sideBorders({ top: [8, NAVY], bottom: [8, NAVY], left: null, right: null, insideH: [4, RULE], insideV: null }) }));
  if (anyMins && model.parts.some((p) => !(p.mins > 0))) out.push(para(run('Times follow the minutes planned for each part; parts without minutes take no time in the running order.', { i: true, sz: 17, color: MUTED }), { before: 80 }));

  // ---- Scripture readings
  if (model.readings && model.readings.length) {
    out.push(para(run('Scripture readings', { b: true, sz: 34, color: NAVY, font: 'Georgia' }), { style: 'Heading1', pageBreak: true, borderBottom: { sz: 8, color: GOLD } }));
    model.readings.forEach((r) => {
      out.push(para([run(r.ref, { b: true, sz: 26, color: NAVY }), run(r.tr ? '   ' + String(r.tr).toUpperCase() : '', { sz: 18, color: MUTED, b: true })], { style: 'Heading2', keepNext: true }));
      if (r.part) out.push(para(run(r.part, { sz: 18, i: true, color: MUTED }), { after: 60, keepNext: true }));
      const runs = [];
      r.verses.forEach((v) => { runs.push(run(v.v + ' ', { sup: true, b: true, sz: 17, color: GOLD })); runs.push(run(v.t + ' ', { sz: 23 })); });
      if (r.more) runs.push(run('… (continues in the Bible)', { i: true, sz: 19, color: MUTED }));
      out.push(para(runs.length ? runs : run('The text is not available on this device.', { i: true, color: MUTED }), { line: 300, after: 160, borderLeft: { sz: 18, color: RULE }, ind: 160 }));
    });
  }

  // ---- hymns
  if (model.hymns && model.hymns.length) {
    out.push(para(run('Hymns and songs', { b: true, sz: 34, color: NAVY, font: 'Georgia' }), { style: 'Heading1', pageBreak: !(model.readings && model.readings.length) || true, borderBottom: { sz: 8, color: GOLD } }));
    out.push(para(run('Hymn words are for use in your own congregation. Check your church’s copyright licence (for example CCLI) before sharing this document more widely.', { i: true, sz: 17, color: MUTED }), { after: 120 }));
    model.hymns.forEach((hy) => {
      out.push(para([run((hy.book ? hy.book + ' ' : 'Hymn ') + hy.n, { b: true, sz: 24, color: '6D28D9' }), run('   ' + hy.title, { b: true, sz: 26, color: NAVY })], { style: 'Heading2', keepNext: true }));
      hy.stanzas.forEach((st, i) => {
        out.push(para([run((i + 1) + '   ', { b: true, color: GOLD, sz: 21 }), run(st.join('\n'), { sz: 22 })], { line: 276, after: 80, ind: 480, hang: 480, keepLines: true }));
        if (hy.chorus && hy.chorus.length && (i === 0 || hy.chorusEvery)) out.push(para([run('Chorus   ', { i: true, b: true, sz: 18, color: MUTED }), run(hy.chorus.join('\n'), { i: true, sz: 21 })], { line: 276, after: 100, ind: 960, hang: 480, keepLines: true }));
      });
    });
  }

  const blob = buildDocx({ body: out.join(''), landscape, title: (model.church ? model.church + ' – ' : '') + (model.title || 'Order of service'), author: model.church || 'Church Service',
    footerLeft: (model.church ? model.church + '  ·  ' : '') + (model.title || 'Order of service') + '  ·  made with Church Service' + (model.generated ? ', ' + model.generated : '') });
  return blob.slice(0, blob.size, DOCX_TYPE);
}
function toMin(hhmm) { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); return m ? +m[1] * 60 + +m[2] : 9 * 60 + 30; }
