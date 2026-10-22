// Lightweight PowerPoint (.pptx) renderer: text boxes, placeholders, pictures, shapes,
// groups, simple tables and backgrounds become positioned HTML. It covers typical church
// announcement and sermon slides. For pixel-exact output, the SDA Sabbath companion converts
// .pptx to PDF with LibreOffice, or save as PDF from PowerPoint.
import { unzipSync, strFromU8 } from '../../vendor/fflate-unzip.min.js';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU = 9525; // EMU per CSS px

const kids = (el, ns, name) => (el ? Array.prototype.filter.call(el.children, (c) => c.namespaceURI === ns && c.localName === name) : []);
const kid = (el, ns, name) => kids(el, ns, name)[0] || null;
const desc = (el, ns, name) => (el ? el.getElementsByTagNameNS(ns, name)[0] || null : null);
const num = (v, d = 0) => (v == null || v === '' ? d : +v);
const HEX6 = /^[0-9A-Fa-f]{6}$/;
const hex = (v, dflt) => (v && HEX6.test(v) ? '#' + v : dflt);
const PRESET_COLOURS = new Set(['black', 'white', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta', 'gray', 'grey', 'silver', 'maroon', 'olive', 'lime', 'aqua', 'teal', 'navy', 'fuchsia', 'purple', 'orange', 'brown', 'pink', 'gold', 'darkBlue', 'darkRed', 'darkGreen', 'darkGray', 'darkGrey', 'lightGray', 'lightGrey', 'ltGray', 'dkGray']);
const safeColour = (c) => (typeof c === 'string' && /^(#[0-9A-Fa-f]{3,8}|rgba?\([0-9.,\s]+\)|[A-Za-z]{3,20})$/.test(c) ? c : null);
/** Font family names: letters, digits, spaces and a few safe punctuation marks only. */
const safeFont = (f) => String(f || '').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 64) || 'sans-serif';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/emf', wmf: 'image/wmf' };

export async function parsePptx(blob) {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const cache = new Map();
  const xml = (path) => {
    if (cache.has(path)) return cache.get(path);
    const d = files[path] ? new DOMParser().parseFromString(strFromU8(files[path]), 'application/xml') : null;
    cache.set(path, d); return d;
  };
  const relsOf = (path) => {
    const dir = path.slice(0, path.lastIndexOf('/'));
    const doc = xml(dir + '/_rels/' + path.slice(path.lastIndexOf('/') + 1) + '.rels');
    const map = {};
    if (!doc) return map;
    Array.prototype.forEach.call(doc.getElementsByTagName('Relationship'), (r) => {
      let t = r.getAttribute('Target');
      if (r.getAttribute('TargetMode') === 'External') return;
      const parts = (t.startsWith('/') ? t.slice(1) : dir + '/' + t).split('/');
      const out = [];
      parts.forEach((p) => { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); });
      map[r.getAttribute('Id')] = { target: out.join('/'), type: r.getAttribute('Type') };
    });
    return map;
  };

  const pres = xml('ppt/presentation.xml');
  if (!pres) throw new Error('This is not a PowerPoint (.pptx) file.');
  const sz = desc(pres, P, 'sldSz');
  const W = Math.round(num(sz && sz.getAttribute('cx'), 12192000) / EMU);
  const H = Math.round(num(sz && sz.getAttribute('cy'), 6858000) / EMU);
  const presRels = relsOf('ppt/presentation.xml');

  // Theme colours and fonts
  const theme = xml('ppt/theme/theme1.xml');
  const scheme = {};
  if (theme) {
    const cs = desc(theme, A, 'clrScheme');
    if (cs) Array.prototype.forEach.call(cs.children, (c) => {
      const s = desc(c, A, 'srgbClr'), sys = desc(c, A, 'sysClr');
      scheme[c.localName] = s ? hex(s.getAttribute('val'), '#000000') : sys ? hex(sys.getAttribute('lastClr'), '#000000') : '#000000';
    });
  }
  Object.assign(scheme, { tx1: scheme.dk1 || '#000', bg1: scheme.lt1 || '#fff', tx2: scheme.dk2 || '#1f497d', bg2: scheme.lt2 || '#eee' });
  const minorFont = theme && desc(desc(theme, A, 'minorFont'), A, 'latin');
  const majorFont = theme && desc(desc(theme, A, 'majorFont'), A, 'latin');
  const fontBody = safeFont(minorFont ? minorFont.getAttribute('typeface') : 'Calibri');
  const fontHead = majorFont ? safeFont(majorFont.getAttribute('typeface')) : fontBody;

  function color(el) {
    if (!el) return null;
    let c = null, node = null;
    for (const ch of el.children) {
      if (ch.localName === 'srgbClr') { c = hex(ch.getAttribute('val'), null); node = ch; break; }
      if (ch.localName === 'schemeClr') { c = scheme[ch.getAttribute('val')] || null; node = ch; break; }
      if (ch.localName === 'sysClr') { c = hex(ch.getAttribute('lastClr') || '000000', null); node = ch; break; }
      if (ch.localName === 'prstClr') { { const v = ch.getAttribute('val'); c = PRESET_COLOURS.has(v) ? v : null; } node = ch; break; }
    }
    if (!c || !node) return safeColour(c);
    // lumMod / lumOff / alpha (approximation)
    const mod = desc(node, A, 'lumMod'), off = desc(node, A, 'lumOff'), al = desc(node, A, 'alpha');
    const tint = desc(node, A, 'tint'), shade = desc(node, A, 'shade');
    if (c[0] === '#' && (mod || off || al || tint || shade)) {
      let r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
      const m = mod ? num(mod.getAttribute('val')) / 100000 : 1, o = off ? num(off.getAttribute('val')) / 100000 : 0;
      const t = tint ? num(tint.getAttribute('val')) / 100000 : 1, sh = shade ? num(shade.getAttribute('val')) / 100000 : 1;
      [r, g, b] = [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round((x * t + 255 * (1 - t)) * sh * m + 255 * o))));
      const a = al ? num(al.getAttribute('val')) / 100000 : 1;
      return 'rgba(' + r + ',' + g + ',' + b + ',' + (Number.isFinite(a) ? a : 1) + ')';
    }
    return safeColour(c);
  }

  // Default text styles from the master
  function lvlDefaults(stylesEl) {
    const lv = desc(stylesEl, A, 'lvl1pPr');
    const d = lv && desc(lv, A, 'defRPr');
    return { sz: d && d.getAttribute('sz') ? num(d.getAttribute('sz')) / 100 : null, color: d ? color(desc(d, A, 'solidFill')) : null, algn: lv ? lv.getAttribute('algn') : null, bu: !!(lv && desc(lv, A, 'buChar')) };
  }

  const assets = [];
  const assetIdx = new Map();
  function asset(path) {
    if (assetIdx.has(path)) return assetIdx.get(path);
    const data = files[path];
    if (!data) return -1;
    const ext = path.split('.').pop().toLowerCase();
    if (ext === 'emf' || ext === 'wmf') return -1; // not drawable in browsers
    assets.push(new Blob([data], { type: MIME[ext] || 'application/octet-stream' }));
    assetIdx.set(path, assets.length - 1);
    return assets.length - 1;
  }

  function bgOf(doc, rels) {
    const bg = doc && desc(doc, P, 'bg');
    if (!bg) return null;
    const pr = kid(bg, P, 'bgPr');
    if (pr) {
      const sf = kid(pr, A, 'solidFill');
      if (sf) return { color: color(sf) };
      const gf = kid(pr, A, 'gradFill');
      if (gf) { const stops = gf.getElementsByTagNameNS(A, 'gs'); if (stops.length) return { color: color(stops[0]), color2: color(stops[stops.length - 1]) }; }
      const bf = kid(pr, A, 'blipFill');
      if (bf) { const bl = desc(bf, A, 'blip'); const rel = bl && rels[bl.getAttributeNS(R, 'embed')]; if (rel) { const i = asset(rel.target); if (i >= 0) return { img: i }; } }
    }
    const ref = kid(bg, P, 'bgRef');
    if (ref) return { color: color(ref) };
    return null;
  }

  function phInfo(sp) {
    const ph = desc(sp, P, 'ph');
    if (!ph) return null;
    return { type: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx') };
  }
  function findPh(doc, info) {
    if (!doc || !info) return null;
    const all = doc.getElementsByTagNameNS(P, 'sp');
    let byType = null;
    for (const sp of all) {
      const pi = phInfo(sp);
      if (!pi) continue;
      if (info.idx != null && pi.idx === info.idx) return sp;
      if (!byType && pi.type === info.type) byType = sp;
    }
    if (!byType && (info.type === 'ctrTitle')) return findPh(doc, { type: 'title' });
    if (!byType && (info.type === 'subTitle' || info.type === 'obj')) return findPh(doc, { type: 'body' });
    return byType;
  }

  function xfrmOf(spPr) {
    const x = spPr && kid(spPr, A, 'xfrm');
    if (!x) return null;
    const off = kid(x, A, 'off'), ext = kid(x, A, 'ext');
    if (!off || !ext) return null;
    return { x: num(off.getAttribute('x')), y: num(off.getAttribute('y')), cx: num(ext.getAttribute('cx')), cy: num(ext.getAttribute('cy')), rot: num(x.getAttribute('rot')) / 60000 };
  }

  function fillOf(spPr, rels) {
    if (!spPr) return '';
    const sf = kid(spPr, A, 'solidFill');
    if (sf) return 'background:' + color(sf) + ';';
    const gf = kid(spPr, A, 'gradFill');
    if (gf) { const st = gf.getElementsByTagNameNS(A, 'gs'); if (st.length) return 'background:linear-gradient(' + color(st[0]) + ',' + color(st[st.length - 1]) + ');'; }
    const bf = kid(spPr, A, 'blipFill');
    if (bf && rels) { const bl = desc(bf, A, 'blip'); const rel = bl && rels[bl.getAttributeNS(R, 'embed')]; if (rel) { const i = asset(rel.target); if (i >= 0) return '" data-abg="' + i + '" style="'; } }
    return '';
  }
  function lineOf(spPr) {
    const ln = spPr && kid(spPr, A, 'ln');
    if (!ln || kid(ln, A, 'noFill')) return '';
    const sf = kid(ln, A, 'solidFill');
    if (!sf) return '';
    const w = Math.max(1, Math.round(num(ln.getAttribute('w'), 12700) / EMU));
    return 'border:' + w + 'px solid ' + color(sf) + ';';
  }

  function textHtml(txBody, d) {
    if (!txBody) return '';
    const bodyPr = kid(txBody, A, 'bodyPr');
    const auto = bodyPr && desc(bodyPr, A, 'normAutofit');
    const scale = auto && auto.getAttribute('fontScale') ? num(auto.getAttribute('fontScale')) / 100000 : 1;
    let out = '';
    kids(txBody, A, 'p').forEach((p) => {
      const pPr = kid(p, A, 'pPr');
      const lvl = pPr ? num(pPr.getAttribute('lvl')) : 0;
      const algn = (pPr && pPr.getAttribute('algn')) || d.algn || 'l';
      const ta = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[algn] || 'left';
      const noBu = pPr && kid(pPr, A, 'buNone');
      const bu = !noBu && ((pPr && kid(pPr, A, 'buChar')) || d.bu);
      let runs = '';
      let firstSize = null;
      Array.prototype.forEach.call(p.children, (r) => {
        if (r.localName === 'br') { runs += '<br>'; return; }
        if (r.localName !== 'r' && r.localName !== 'fld') return;
        const rPr = kid(r, A, 'rPr');
        const t = kid(r, A, 't');
        let szPt = rPr && rPr.getAttribute('sz') ? num(rPr.getAttribute('sz')) / 100 : d.sz || 18;
        szPt *= scale;
        if (firstSize == null) firstSize = szPt;
        const c = (rPr && color(kid(rPr, A, 'solidFill'))) || d.color;
        let css = 'font-size:' + (szPt * 96 / 72).toFixed(1) + 'px;';
        if (rPr && rPr.getAttribute('b') === '1') css += 'font-weight:700;';
        if (rPr && rPr.getAttribute('i') === '1') css += 'font-style:italic;';
        if (rPr && rPr.getAttribute('u') && rPr.getAttribute('u') !== 'none') css += 'text-decoration:underline;';
        if (c) css += 'color:' + c + ';';
        const latin = rPr && kid(rPr, A, 'latin');
        if (latin && latin.getAttribute('typeface') && !/^\+/.test(latin.getAttribute('typeface'))) css += "font-family:'" + safeFont(latin.getAttribute('typeface')) + "'," + (d.font || 'sans-serif') + ';';
        runs += '<span style="' + css + '">' + esc(t ? t.textContent : '') + '</span>';
      });
      if (!runs) {
        const end = kid(p, A, 'endParaRPr');
        const szPt = (end && end.getAttribute('sz') ? num(end.getAttribute('sz')) / 100 : d.sz || 18) * scale;
        runs = '<span style="font-size:' + (szPt * 96 / 72).toFixed(1) + 'px">&nbsp;</span>';
      } else if (bu) runs = '<span style="font-size:' + ((firstSize || 18) * 96 / 72).toFixed(1) + 'px">•&nbsp;</span>' + runs;
      out += '<p style="text-align:' + ta + ';margin:0 0 .2em ' + lvl * 36 + 'px;line-height:1.12">' + runs + '</p>';
    });
    return out;
  }

  function shapeHtml(sp, env) {
    const name = sp.localName;
    if (name === 'grpSp') {
      const gpr = kid(sp, P, 'grpSpPr');
      const xf = gpr && kid(gpr, A, 'xfrm');
      let t = env.t;
      if (xf) {
        const off = kid(xf, A, 'off'), ext = kid(xf, A, 'ext'), co = kid(xf, A, 'chOff'), ce = kid(xf, A, 'chExt');
        if (off && ext && co && ce) {
          const sx = num(ext.getAttribute('cx')) / (num(ce.getAttribute('cx')) || 1), sy = num(ext.getAttribute('cy')) / (num(ce.getAttribute('cy')) || 1);
          const ox = num(off.getAttribute('x')) - num(co.getAttribute('x')) * sx, oy = num(off.getAttribute('y')) - num(co.getAttribute('y')) * sy;
          t = { x: env.t.x + ox * env.t.sx, y: env.t.y + oy * env.t.sy, sx: env.t.sx * sx, sy: env.t.sy * sy };
        }
      }
      let out = '';
      Array.prototype.forEach.call(sp.children, (c) => { out += shapeHtml(c, Object.assign({}, env, { t })); });
      return out;
    }
    if (name !== 'sp' && name !== 'pic' && name !== 'graphicFrame' && name !== 'cxnSp') return '';
    const pi = phInfo(sp);
    if (env.skipPh && pi) return '';
    const spPr = kid(sp, P, 'spPr');
    let xf = xfrmOf(spPr);
    let layoutSp = null, masterSp = null;
    if (pi) { layoutSp = findPh(env.layout, pi); masterSp = findPh(env.master, pi); }
    if (!xf && name === 'graphicFrame') {
      const gx = kid(sp, P, 'xfrm');
      const off = gx && kid(gx, A, 'off'), ext = gx && kid(gx, A, 'ext');
      if (off && ext) xf = { x: num(off.getAttribute('x')), y: num(off.getAttribute('y')), cx: num(ext.getAttribute('cx')), cy: num(ext.getAttribute('cy')), rot: 0 };
    }
    if (!xf && layoutSp) xf = xfrmOf(kid(layoutSp, P, 'spPr'));
    if (!xf && masterSp) xf = xfrmOf(kid(masterSp, P, 'spPr'));
    if (!xf) return '';
    const t = env.t;
    const left = (t.x + xf.x * t.sx) / EMU, top = (t.y + xf.y * t.sy) / EMU, w = (xf.cx * t.sx) / EMU, hh = (xf.cy * t.sy) / EMU;
    let style = 'left:' + left.toFixed(1) + 'px;top:' + top.toFixed(1) + 'px;width:' + w.toFixed(1) + 'px;height:' + hh.toFixed(1) + 'px;';
    if (xf.rot) style += 'transform:rotate(' + xf.rot + 'deg);';

    if (name === 'pic') {
      const bl = desc(sp, A, 'blip');
      const rel = bl && env.rels[bl.getAttributeNS(R, 'embed')];
      const i = rel ? asset(rel.target) : -1;
      return i < 0 ? '' : '<div class="sp" style="' + style + '"><img data-a="' + i + '" alt=""></div>';
    }
    if (name === 'graphicFrame') {
      const tbl = desc(sp, A, 'tbl');
      if (!tbl) return '';
      let rows = '';
      Array.prototype.forEach.call(tbl.getElementsByTagNameNS(A, 'tr'), (tr) => {
        rows += '<tr>';
        Array.prototype.forEach.call(tr.getElementsByTagNameNS(A, 'tc'), (tc) => {
          const tcPr = kid(tc, A, 'tcPr');
          const bg = tcPr ? color(kid(tcPr, A, 'solidFill')) : null;
          rows += '<td style="border:1px solid #888;padding:4px 6px;vertical-align:top;' + (bg ? 'background:' + bg + ';' : '') + '">' + textHtml(kid(tc, A, 'txBody'), { sz: 14, color: scheme.tx1, font: env.font }) + '</td>';
        });
        rows += '</tr>';
      });
      return '<div class="sp" style="' + style + '"><table style="width:100%;height:100%;border-collapse:collapse">' + rows + '</table></div>';
    }
    // Text shape / placeholder defaults
    const isTitle = pi && (pi.type === 'title' || pi.type === 'ctrTitle');
    const base = isTitle ? env.titleD : pi ? env.bodyD : env.otherD;
    const lst = (sp2) => { const tb = sp2 && kid(sp2, P, 'txBody'); return tb ? lvlDefaults(kid(tb, A, 'lstStyle')) : {}; };
    const lm = lst(masterSp), ll = lst(layoutSp), ls = lst(sp);
    const d = {
      sz: ls.sz || ll.sz || lm.sz || base.sz || (isTitle ? 44 : 18),
      color: ls.color || ll.color || lm.color || base.color || scheme.tx1,
      algn: ls.algn || ll.algn || lm.algn || base.algn || (pi && pi.type === 'ctrTitle' ? 'ctr' : null),
      bu: pi && !isTitle && (pi.type === 'body' || pi.type === 'obj') ? base.bu : false,
      font: isTitle ? "'" + fontHead.replace(/'/g, '') + "',sans-serif" : "'" + fontBody.replace(/'/g, '') + "',sans-serif",
    };
    const fill = fillOf(spPr, env.rels);
    const prst = desc(spPr, A, 'prstGeom');
    const geo = prst ? prst.getAttribute('prst') : 'rect';
    if (geo === 'ellipse') style += 'border-radius:50%;';
    else if (geo === 'roundRect') style += 'border-radius:' + Math.round(Math.min(w, hh) * 0.16) + 'px;';
    style += lineOf(spPr);
    const tb = kid(sp, P, 'txBody');
    const bodyPr = tb && kid(tb, A, 'bodyPr');
    const anchor = (bodyPr && bodyPr.getAttribute('anchor')) || (isTitle ? 'ctr' : pi && pi.type === 'ctrTitle' ? 'b' : 't');
    const jc = { t: 'flex-start', ctr: 'center', b: 'flex-end' }[anchor] || 'flex-start';
    const ins = (k, dflt) => (bodyPr && bodyPr.getAttribute(k) != null ? num(bodyPr.getAttribute(k)) : dflt) / EMU;
    style += 'display:flex;flex-direction:column;justify-content:' + jc + ';padding:' + ins('tIns', 45720).toFixed(1) + 'px ' + ins('rIns', 91440).toFixed(1) + 'px ' + ins('bIns', 45720).toFixed(1) + 'px ' + ins('lIns', 91440).toFixed(1) + 'px;font-family:' + d.font + ';color:' + d.color + ';';
    const text = textHtml(tb, d);
    if (!text && !fill && !lineOf(spPr)) return '';
    if (fill.startsWith('"')) return '<div class="sp" style="' + style + fill + '">' + text + '</div>';
    return '<div class="sp" style="' + style + fill + '">' + text + '</div>';
  }

  function treeHtml(doc, env) {
    const tree = doc && desc(doc, P, 'spTree');
    if (!tree) return '';
    let out = '';
    Array.prototype.forEach.call(tree.children, (c) => { out += shapeHtml(c, env); });
    return out;
  }

  const slides = [];
  const sldIds = desc(pres, P, 'sldIdLst');
  const order = sldIds ? kids(sldIds, P, 'sldId').map((s) => presRels[s.getAttributeNS(R, 'id')]).filter(Boolean).map((r) => r.target) : [];
  for (const path of order) {
    const doc = xml(path);
    if (!doc) continue;
    const show = desc(doc, P, 'sld');
    if (show && show.getAttribute('show') === '0') continue; // hidden slide
    const rels = relsOf(path);
    const layoutRel = Object.values(rels).find((r) => /slideLayout$/.test(r.type));
    const layoutPath = layoutRel && layoutRel.target;
    const layout = layoutPath ? xml(layoutPath) : null;
    const lrels = layoutPath ? relsOf(layoutPath) : {};
    const masterRel = Object.values(lrels).find((r) => /slideMaster$/.test(r.type));
    const masterPath = masterRel && masterRel.target;
    const master = masterPath ? xml(masterPath) : null;
    const mrels = masterPath ? relsOf(masterPath) : {};
    const txStyles = master && desc(master, P, 'txStyles');
    const env0 = {
      layout, master, t: { x: 0, y: 0, sx: 1, sy: 1 }, font: "'" + fontBody.replace(/'/g, '') + "',sans-serif",
      titleD: txStyles ? lvlDefaults(kid(txStyles, P, 'titleStyle')) : {},
      bodyD: txStyles ? lvlDefaults(kid(txStyles, P, 'bodyStyle')) : {},
      otherD: txStyles ? lvlDefaults(kid(txStyles, P, 'otherStyle')) : {},
    };
    const bg = bgOf(doc, rels) || bgOf(layout, lrels) || bgOf(master, mrels) || { color: scheme.bg1 || '#fff' };
    let html = '';
    if (bg.img != null) html += '<div class="sp" style="left:0;top:0;width:' + W + 'px;height:' + H + 'px" data-abg="' + bg.img + '"></div>';
    const cSld = desc(doc, P, 'sld');
    const showMaster = !(cSld && cSld.getAttribute('showMasterSp') === '0');
    const lay = layout && desc(layout, P, 'sldLayout');
    if (showMaster && !(lay && lay.getAttribute('showMasterSp') === '0')) html += treeHtml(master, Object.assign({}, env0, { rels: mrels, skipPh: true }));
    if (showMaster) html += treeHtml(layout, Object.assign({}, env0, { rels: lrels, skipPh: true }));
    html += treeHtml(doc, Object.assign({}, env0, { rels }));
    // Speaker notes text (shown to the operator only)
    let notes = '';
    const notesRel = Object.values(rels).find((r) => /notesSlide$/.test(r.type));
    if (notesRel) {
      const nd = xml(notesRel.target);
      if (nd) Array.prototype.forEach.call(nd.getElementsByTagNameNS(P, 'sp'), (sp) => {
        const pi = phInfo(sp);
        if (pi && pi.type === 'body') notes = Array.prototype.map.call(sp.getElementsByTagNameNS(A, 'p'), (p) => p.textContent).join('\n').trim();
      });
    }
    slides.push({ html, bg: bg.color2 ? 'linear-gradient(' + bg.color + ',' + bg.color2 + ')' : bg.color || '#fff', notes, used: [] });
  }
  // Each frame carries only the assets it references.
  slides.forEach((s) => {
    const map = new Map();
    s.html = s.html.replace(/data-(a|abg)="(\d+)"/g, (m, k, i) => {
      if (!map.has(i)) { map.set(i, s.used.length); s.used.push(assets[+i]); }
      return 'data-' + k + '="' + map.get(i) + '"';
    });
  });
  return { w: W, h: H, slides: slides.map((s) => ({ kind: 'html', html: s.html, assets: s.used, w: W, h: H, bg: s.bg, notes: s.notes })) };
}
