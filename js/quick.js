// "Go to" box: type a Bible reference or a hymn number, Enter stages it, Ctrl+Enter presents it.
import { h, clear, debounce } from './core/util.js';
import { parseRef, refText, EN } from './core/books.js';
import { live } from './core/live.js';

export function createQuick({ input, pop, wrap, getTab, showTab }) {
  let items = [], sel = 0, lastQ = null;

  async function suggest() {
    const q = input.value.trim();
    lastQ = q;
    items = [];
    if (!q) { pop.hidden = true; return; }
    const hm = /^(?:h|hymn|hymne|lied|liedere|ingoma|#)?\s*(\d{1,4})$/i.exec(q);
    if (hm) {
      try {
        const hy = await getTab('hymns');
        hy.lookup(+hm[1]).slice(0, 4).forEach((x) => items.push({ kind: 'Hymn', label: x.n + '  ' + x.t, sub: x.book, run: () => hy.open({ n: x.n, book: x.bookId }) }));
      } catch (e) { /* */ }
    }
    const r = /\d/.test(q) || q.length > 2 ? parseRef(q) : null;
    if (r) {
      items.push({ kind: 'Bible', label: refText(EN, r.book, r.segs), run: async () => (await getTab('bible')).open({ ref: q }) });
    }
    if (!hm && q.length >= 3 && !/^\d/.test(q)) {
      try {
        const hy = await getTab('hymns');
        hy.search(q, 5).forEach((x) => items.push({ kind: 'Hymn', label: x.n + '  ' + x.t, sub: x.book, run: () => hy.open({ n: x.n, book: x.bookId }) }));
      } catch (e) { /* */ }
    }
    if (input.value.trim() !== q) return; // stale
    sel = 0;
    render();
  }

  const hint = () => h('div.note.quick-hint', h('kbd', 'Enter'), ' selects  ·  ', h('kbd', 'Shift+Enter'), ' presents now');
  function render() {
    clear(pop);
    if (!items.length) {
      pop.appendChild(h('div.note', { style: { padding: '8px 10px' } }, 'Try “John 3:16”, “Ps 23”, “Joh 3:16” or a hymn number like “73”.'));
      pop.appendChild(hint());
      pop.hidden = false; return;
    }
    items.forEach((it, i) => pop.appendChild(h('button', { type: 'button', role: 'option', 'aria-selected': String(i === sel),
      onmousedown: (e) => { e.preventDefault(); choose(i, e.ctrlKey || e.metaKey); } },
    h('span.k', it.kind), h('span.grow', it.label), it.sub ? h('span.faint', it.sub) : null)));
    pop.appendChild(hint());
    pop.hidden = false;
  }

  async function choose(i, present) {
    const it = items[i];
    if (!it) return;
    pop.hidden = true;
    input.value = '';
    wrap.classList.remove('open');
    input.blur();
    await it.run();
    if (present) setTimeout(() => live.take(), 60);
  }

  const deb = debounce(suggest, 90);
  input.addEventListener('input', deb);
  input.addEventListener('focus', () => { if (input.value) suggest(); });
  input.addEventListener('blur', () => setTimeout(() => { pop.hidden = true; wrap.classList.remove('open'); }, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      const present = e.ctrlKey || e.metaKey || e.shiftKey;
      if (lastQ === input.value.trim() && items.length) choose(sel, present);
      else suggest().then(() => choose(0, present));
    }
    else if (e.key === 'Escape') { input.value = ''; pop.hidden = true; input.blur(); wrap.classList.remove('open'); }
  });
  return {
    focus() { wrap.classList.add('open'); input.focus(); input.select(); },
    /** Stage (and optionally present) the first match for q, as if typed in the box. Used by remote control. */
    async run(q, present) {
      input.value = String(q || '').trim();
      await suggest();
      pop.hidden = true;
      if (!items.length) { input.value = ''; return false; }
      const it = items[0];
      input.value = '';
      await it.run();
      if (present) await new Promise((r) => setTimeout(r, 60));
      return it.label;
    },
  };
}
