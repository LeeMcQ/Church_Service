// Mini controller in an always-on-top window (Document Picture-in-Picture, Chrome 116+).
// Lets the operator work in PowerPoint, a browser or any other program and still
// step slides, present, black or clear without switching back to Church Service.
import { h } from './core/util.js';
import { icon } from './core/icons.js';
import { live } from './core/live.js';
import { toast } from './core/ui.js';

export const pipSupported = () => 'documentPictureInPicture' in window;

let pw = null;
export async function openPip() {
  if (!pipSupported()) { toast('The mini controller needs Chrome or Edge 116 or newer.', 'err'); return; }
  if (pw) { pw.focus(); return; }
  pw = await window.documentPictureInPicture.requestWindow({ width: 420, height: 170 });
  for (const ss of Array.from(document.styleSheets)) {
    if (ss.href) { const l = pw.document.createElement('link'); l.rel = 'stylesheet'; l.href = ss.href; pw.document.head.appendChild(l); }
  }
  pw.document.documentElement.setAttribute('data-theme', document.documentElement.getAttribute('data-theme'));
  const d = pw.document;
  const title = d.createElement('div');
  title.style.cssText = 'font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  const next = d.createElement('div');
  next.style.cssText = 'font-size:12px;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  const mk = (ic, label, fn, cls) => h('button.btn' + (cls || ''), { type: 'button', title: label, onclick: fn }, icon(ic), h('span', label));
  const row = h('div.row', { style: { gap: '6px', flexWrap: 'wrap' } },
    mk('prev', 'Prev', () => live.prev()), mk('next', 'Next', () => live.next()),
    mk('present', 'Present', () => live.take(), '.primary'), mk('black', 'Black', () => live.setBlank('black')), mk('clear', 'Clear', () => live.clear()));
  const body = h('div', { style: { padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--bg)', color: 'var(--text)', height: '100vh', boxSizing: 'border-box', fontFamily: 'var(--font)' } }, title, next, row);
  d.body.style.margin = '0';
  d.body.appendChild(d.adoptNode(body));
  const upd = () => {
    title.textContent = live.cue ? 'Live: ' + live.cue.title + (live.count() > 1 ? '  (' + (live.index + 1) + '/' + live.count() + ')' : '') : 'Nothing live';
    next.textContent = live.staged ? 'Next: ' + live.staged.title + (live.staged.sub ? ' ' + live.staged.sub : '') : 'Nothing selected';
  };
  const offs = [live.on('live', upd), live.on('go', upd), live.on('staged', upd)];
  d.addEventListener('keydown', (e) => {
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); live.next(); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); live.prev(); }
    else if (e.key === 'F5' || (e.key === 'Enter' && e.ctrlKey)) { e.preventDefault(); live.take(); }
    else if (e.key === 'b' || e.key === 'B' || e.key === '.' || e.key === 'w' || e.key === 'W') live.setBlank('black');
    else if (e.key === 'Escape') live.clear();
  });
  pw.addEventListener('pagehide', () => { offs.forEach((f) => f()); pw = null; });
  upd();
}
