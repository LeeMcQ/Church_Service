// A small Word (.docx) writer: paragraphs, runs, tables, a footer with page numbers, and a plain
// (uncompressed) zip container. No library and nothing downloaded, so it works offline.
// Units: font sizes are half-points (22 = 11 pt), lengths are twips (1440 = 1 inch, 567 = 1 cm).

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** Text safe for XML (control characters removed). */
export const x = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex6 = (c) => (/^[0-9a-f]{6}$/i.test(c || '') ? c.toUpperCase() : '');

/** One run of text. o: {b,i,u,caps,sup,color:'RRGGBB',sz,font,spacing} */
export function run(text, o = {}) {
  const pr = [];
  if (o.font) pr.push('<w:rFonts w:ascii="' + x(o.font) + '" w:hAnsi="' + x(o.font) + '" w:cs="' + x(o.font) + '"/>');
  if (o.b) pr.push('<w:b/><w:bCs/>');
  if (o.i) pr.push('<w:i/><w:iCs/>');
  if (o.caps) pr.push('<w:caps/>');
  if (hex6(o.color)) pr.push('<w:color w:val="' + hex6(o.color) + '"/>');
  if (o.spacing) pr.push('<w:spacing w:val="' + (o.spacing | 0) + '"/>');
  if (o.sz) pr.push('<w:sz w:val="' + (o.sz | 0) + '"/><w:szCs w:val="' + (o.sz | 0) + '"/>');
  if (o.u) pr.push('<w:u w:val="single"/>');
  if (o.sup) pr.push('<w:vertAlign w:val="superscript"/>');
  const parts = String(text == null ? '' : text).split(/(\n|\t)/).map((s) => (s === '\n' ? '<w:br/>' : s === '\t' ? '<w:tab/>' : s ? '<w:t xml:space="preserve">' + x(s) + '</w:t>' : '')).join('');
  return '<w:r>' + (pr.length ? '<w:rPr>' + pr.join('') + '</w:rPr>' : '') + parts + '</w:r>';
}
/** A page-number field. */
export const field = (instr, o = {}) => '<w:fldSimple w:instr="' + x(instr) + '"><w:r>' +
  (o.sz || o.color || o.b ? '<w:rPr>' + (o.b ? '<w:b/>' : '') + (hex6(o.color) ? '<w:color w:val="' + hex6(o.color) + '"/>' : '') + (o.sz ? '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>' : '') + '</w:rPr>' : '') +
  '<w:t>1</w:t></w:r></w:fldSimple>';

/** A paragraph. runs: xml string (or array of them). o: {align,before,after,line,ind,hang,keepNext,keepLines,pageBreak,shade,borderBottom,borderTop,tabs:[{pos,val}],style} */
export function para(runs, o = {}) {
  const pr = [];
  if (o.style) pr.push('<w:pStyle w:val="' + x(o.style) + '"/>');
  if (o.keepNext) pr.push('<w:keepNext/>');
  if (o.keepLines) pr.push('<w:keepLines/>');
  if (o.pageBreak) pr.push('<w:pageBreakBefore/>');
  const bd = [];
  if (o.borderTop) bd.push('<w:top w:val="single" w:sz="' + (o.borderTop.sz || 6) + '" w:space="6" w:color="' + (hex6(o.borderTop.color) || 'BBBBBB') + '"/>');
  if (o.borderBottom) bd.push('<w:bottom w:val="single" w:sz="' + (o.borderBottom.sz || 12) + '" w:space="4" w:color="' + (hex6(o.borderBottom.color) || 'BBBBBB') + '"/>');
  if (o.borderLeft) bd.push('<w:left w:val="single" w:sz="' + (o.borderLeft.sz || 18) + '" w:space="8" w:color="' + (hex6(o.borderLeft.color) || 'BBBBBB') + '"/>');
  if (bd.length) pr.push('<w:pBdr>' + bd.join('') + '</w:pBdr>');
  if (hex6(o.shade)) pr.push('<w:shd w:val="clear" w:color="auto" w:fill="' + hex6(o.shade) + '"/>');
  if (o.tabs) pr.push('<w:tabs>' + o.tabs.map((t) => '<w:tab w:val="' + (t.val || 'left') + '" w:pos="' + (t.pos | 0) + '"/>').join('') + '</w:tabs>');
  if (o.before != null || o.after != null || o.line) {
    pr.push('<w:spacing' + (o.before != null ? ' w:before="' + (o.before | 0) + '"' : '') + (o.after != null ? ' w:after="' + (o.after | 0) + '"' : '') +
      (o.line ? ' w:line="' + (o.line | 0) + '" w:lineRule="auto"' : '') + '/>');
  }
  if (o.ind || o.hang) pr.push('<w:ind' + (o.ind ? ' w:left="' + (o.ind | 0) + '"' : '') + (o.hang ? ' w:hanging="' + (o.hang | 0) + '"' : '') + '/>');
  if (o.align) pr.push('<w:jc w:val="' + o.align + '"/>');
  return '<w:p>' + (pr.length ? '<w:pPr>' + pr.join('') + '</w:pPr>' : '') + (Array.isArray(runs) ? runs.join('') : runs || '') + '</w:p>';
}

/** A table cell. content: paragraphs xml (a cell needs at least one paragraph). o: {w,fill,span,vAlign,borders,pad} */
export function cell(content, o = {}) {
  const pr = ['<w:tcW w:w="' + (o.w | 0) + '" w:type="dxa"/>'];
  if (o.span > 1) pr.push('<w:gridSpan w:val="' + o.span + '"/>');
  if (o.borders) pr.push('<w:tcBorders>' + o.borders + '</w:tcBorders>');
  if (hex6(o.fill)) pr.push('<w:shd w:val="clear" w:color="auto" w:fill="' + hex6(o.fill) + '"/>');
  if (o.pad) pr.push('<w:tcMar><w:top w:w="' + o.pad[0] + '" w:type="dxa"/><w:left w:w="' + o.pad[1] + '" w:type="dxa"/><w:bottom w:w="' + o.pad[2] + '" w:type="dxa"/><w:right w:w="' + o.pad[3] + '" w:type="dxa"/></w:tcMar>');
  pr.push('<w:vAlign w:val="' + (o.vAlign || 'top') + '"/>');
  const body = Array.isArray(content) ? content.join('') : content || '';
  return '<w:tc><w:tcPr>' + pr.join('') + '</w:tcPr>' + (body.includes('<w:p>') || body.includes('<w:p ') ? body : para('')) + '</w:tc>';
}
export const row = (cells, o = {}) => '<w:tr><w:trPr><w:cantSplit/>' + (o.header ? '<w:tblHeader/>' : '') + (o.height ? '<w:trHeight w:val="' + (o.height | 0) + '" w:hRule="atLeast"/>' : '') + '</w:trPr>' + cells.join('') + '</w:tr>';
/** A table. widths: column widths (twips). o: {borders (tblBorders xml), pad:[t,l,b,r]} */
export function table(rows, widths, o = {}) {
  const total = widths.reduce((a, b) => a + b, 0);
  return '<w:tbl><w:tblPr><w:tblW w:w="' + total + '" w:type="dxa"/>' +
    '<w:tblBorders>' + (o.borders || '<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/>') + '</w:tblBorders>' +
    '<w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar><w:top w:w="' + ((o.pad || [60, 100, 60, 100])[0]) + '" w:type="dxa"/><w:left w:w="' + ((o.pad || [60, 100, 60, 100])[1]) + '" w:type="dxa"/><w:bottom w:w="' + ((o.pad || [60, 100, 60, 100])[2]) + '" w:type="dxa"/><w:right w:w="' + ((o.pad || [60, 100, 60, 100])[3]) + '" w:type="dxa"/></w:tblCellMar>' +
    '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>' +
    '<w:tblGrid>' + widths.map((w) => '<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>' + rows.join('') + '</w:tbl>';
}
export const line = (color, sz = 4) => '<w:top w:val="single" w:sz="' + sz + '" w:space="0" w:color="' + color + '"/><w:left w:val="single" w:sz="' + sz + '" w:space="0" w:color="' + color + '"/><w:bottom w:val="single" w:sz="' + sz + '" w:space="0" w:color="' + color + '"/><w:right w:val="single" w:sz="' + sz + '" w:space="0" w:color="' + color + '"/>';
export const sideBorders = (o) => Object.entries(o).map(([k, v]) => '<w:' + k + (v ? ' w:val="single" w:sz="' + v[0] + '" w:space="0" w:color="' + v[1] + '"' : ' w:val="nil"') + '/>').join('');

// ------------------------------------------------------------------ zip (stored, no compression)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zipStore(files, when = new Date()) {
  const enc = new TextEncoder();
  const dt = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const tm = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const chunks = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, tm, true); lh.setUint16(12, dt, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, tm, true); ch.setUint16(14, dt, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

/**
 * The whole file. opts: {body (xml of paragraphs and tables), landscape, footerLeft, title, author, margin (twips), font}
 * Returns a Blob (application/vnd.openxmlformats-officedocument.wordprocessingml.document).
 */
export function buildDocx({ body, landscape = false, footerLeft = '', title = '', author = '', margin = 1021, font = 'Calibri', color = '222222' }) {
  const pw = landscape ? 16838 : 11906, ph = landscape ? 11906 : 16838;
  const contentW = pw - margin * 2;
  const now = new Date();
  const iso = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const sect = '<w:sectPr><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="' + pw + '" w:h="' + ph + '"' + (landscape ? ' w:orient="landscape"' : '') + '/>' +
    '<w:pgMar w:top="' + margin + '" w:right="' + margin + '" w:bottom="' + (margin + 160) + '" w:left="' + margin + '" w:header="567" w:footer="454" w:gutter="0"/></w:sectPr>';
  const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W_NS + '><w:body>' + body + sect + '</w:body></w:document>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ' + W_NS + '>' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="' + x(font) + '" w:hAnsi="' + x(font) + '" w:eastAsia="' + x(font) + '" w:cs="' + x(font) + '"/><w:color w:val="' + color + '"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-ZA" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="60"/><w:szCs w:val="60"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="220" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="777777"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr></w:style>' +
    '</w:styles>';
  const footer = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ' + W_NS + '>' +
    para([run(footerLeft, { sz: 17, color: '777777' }), run('\t', {}), run('Page ', { sz: 17, color: '777777' }), field('PAGE', { sz: 17, color: '777777' }), run(' of ', { sz: 17, color: '777777' }), field('NUMPAGES', { sz: 17, color: '777777' })],
      { style: 'Footer', borderTop: { sz: 4, color: 'CCCCCC' }, tabs: [{ pos: contentW, val: 'right' }] }) + '</w:ftr>';
  const settings = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ' + W_NS + '><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>';
  const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';
  const docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>';
  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:title>' + x(title) + '</dc:title><dc:creator>' + x(author) + '</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:modified></cp:coreProperties>';
  const app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Church Service</Application></Properties>';
  return zipStore([
    { name: '[Content_Types].xml', data: types }, { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: doc }, { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'word/styles.xml', data: styles }, { name: 'word/settings.xml', data: settings }, { name: 'word/footer1.xml', data: footer },
    { name: 'docProps/core.xml', data: core }, { name: 'docProps/app.xml', data: app },
  ], now);
}
export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const contentWidth = (landscape, margin = 1021) => (landscape ? 16838 : 11906) - margin * 2;
