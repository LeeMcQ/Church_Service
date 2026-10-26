// "Add a Bible" dialog — for licensed translations (NIV, Xhosa 1975, …) that cannot be
// shipped with the app. The file is converted once and stored offline on this device.
import { h, clear } from '../core/util.js';
import { modal, toast, closeModal } from '../core/ui.js';
import { parseBibleFile, saveImported, listTranslations } from '../core/bibledata.js';
import { CORPUS, CORPUS_BASE } from '../core/biblecorpus.js';
import { GETBIBLE } from '../core/biblegetbible.js';

export function importBibleDialog(onDone) {
  const file = h('input', { type: 'file', accept: '.json,.xml,.csv,.tsv,.txt' });
  const abbr = h('input.field', { placeholder: 'NIV', maxlength: 8 });
  const name = h('input.field', { placeholder: 'New International Version' });
  const lang = h('select.field', h('option', { value: 'en' }, 'English'), h('option', { value: 'af' }, 'Afrikaans'), h('option', { value: 'xh' }, 'isiXhosa'), h('option', { value: 'zu' }, 'isiZulu / other'));
  const status = h('p.note', 'Supported: Zefania XML, OSIS XML, JSON (Joy in the Journey, bible-api, thiagobodruk, and book → chapter → verse files such as Bible-json) and CSV/TSV (book, chapter, verse, text).');
  let parsed = null;
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    status.textContent = 'Reading ' + f.name + '…';
    try {
      parsed = await parseBibleFile(f);
      const m = parsed.meta || {};
      if (m.abbr && !abbr.value) abbr.value = String(m.abbr).slice(0, 8);
      if ((m.name || m.shortname) && !name.value) name.value = m.name || m.shortname;
      if (m.lang && ['en', 'af', 'xh'].includes(m.lang)) lang.value = m.lang;
      if (/xho|xhosa/i.test(f.name + (m.name || ''))) lang.value = 'xh';
      if (/afr/i.test(f.name + (m.name || ''))) lang.value = 'af';
      status.textContent = 'Found ' + parsed.total.toLocaleString() + ' verses in ' + parsed.books.size + ' books. Check the name and press Add.';
    } catch (e) { parsed = null; status.textContent = e.message; status.classList.add('warn'); }
  });
  const PRESETS = [['NIV', 'New International Version'], ['ESV', 'English Standard Version'], ['NKJV', 'New King James Version']];
  const presets = h('div.row.wrap', { style: { gap: '6px' } }, h('span.note', 'Quick fill:'),
    PRESETS.map(([a, n]) => h('button.btn.sm', { type: 'button', onclick: () => { abbr.value = a; name.value = n; lang.value = 'en'; } }, a)));
  // Three sources, searched together. Each one's list loads on its own, so a slow or blocked source never hides the
  // others. getBible and the Bible corpus have built-in lists, so they always show; bible.helloao.org needs its live list.
  const AO = 'https://bible.helloao.org';
  const GB = 'https://api.getbible.net';
  const SRC = {
    ao: { label: 'Free Use Bible API', site: 'bible.helloao.org', items: [], state: 'loading', note: '' },
    gb: { label: 'getBible', site: 'api.getbible.net', items: [], state: 'loading', note: '' },
    bc: { label: 'Bible corpus', site: 'github.com/christos-c/bible-corpus', items: [], state: 'ok', note: '' },
  };
  let filter = 'all';
  const searchInp = h('input.field', { type: 'search', placeholder: 'Search: Zulu, Xhosa, Sesotho, Afrikaans, KJV…', 'aria-label': 'Search Bibles', oninput: () => renderAo() });
  const chips = h('div.row.wrap.src-chips', { style: { gap: '6px' }, role: 'group', 'aria-label': 'Bible sources' });
  const searchBox = h('div.col', { style: { gap: '4px', maxHeight: '320px', overflow: 'auto' } });
  const gets = h('div.col', { style: { gap: '6px' } },
    h('b', 'Find a Bible'), searchInp, chips, searchBox,
    h('p.note', 'Tap Add: it downloads once and then works offline.'));
  const withTimeout = (url, ms) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return fetch(url, { signal: c.signal }).finally(() => clearTimeout(t)); };

  function fromAo(t) {
    return { src: 'ao', id: t.id, abbr: t.shortName || t.id, name: t.englishName || t.name || t.id, lang: t.language || '',
      langName: t.languageEnglishName || t.languageName || '', license: t.licenseUrl ? 'licence: ' + String(t.licenseUrl).replace(/^https?:\/\//, '').slice(0, 40) : '',
      complete: t.completeTranslationApiLink || '', simple: t.simpleCompleteTranslationApiLink || '', books: t.listOfBooksApiLink || ('/api/' + t.id + '/books.json') };
  }
  const fromGb = (abbr, name, lang, language, lic) => ({ src: 'gb', id: abbr, abbr, name, lang, langName: language, license: lic ? 'licence: ' + lic : '', link: '/v2/' + encodeURIComponent(abbr) + '.json' });
  SRC.bc.items = CORPUS.map(([file, iso, lang, kind, abbr, mb]) => ({ src: 'bc', id: abbr, abbr, name: lang + (kind === 'nt' ? ' New Testament' : kind === 'part' ? ' (parts of the Bible)' : ' Bible'),
    lang: iso, langName: lang, mb, license: 'Bible corpus (github.com/christos-c/bible-corpus); the translation keeps its own copyright', link: CORPUS_BASE + encodeURIComponent(file) }));
  SRC.gb.items = GETBIBLE.map((r) => fromGb(...r));

  async function loadSource(k) {
    const s = SRC[k];
    s.state = 'loading'; s.note = ''; renderAo();
    try {
      if (k === 'ao') {
        const r = await withTimeout(AO + '/api/available_translations.json', 20000);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        s.items = (d.translations || []).map(fromAo);
        if (!s.items.length) throw new Error('empty list');
      } else if (k === 'gb') {
        const r = await withTimeout(GB + '/v2/translations.json', 20000);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        const live = Object.keys(d || {}).map((key) => { const t = d[key] || {}; return fromGb(t.abbreviation || key, t.translation || key, t.lang || '', t.language || '', String(t.distribution_license || '').slice(0, 40)); });
        if (live.length) s.items = live;
      }
      s.state = 'ok';
    } catch (e) {
      s.state = k === 'gb' ? 'ok' : 'err';   // getBible falls back to its built-in list
      s.note = k === 'gb' ? 'built-in list (api.getbible.net did not answer; Add still needs it)' : (e.name === 'AbortError' ? 'it took too long' : e.name === 'TypeError' ? 'no connection, or the site blocked the request' : String(e.message || e));
    }
    renderAo();
  }


  // African languages: southern ones first (ISO 639-3 / 639-1 codes, plus a name check for odd codes).
  const SOUTH = new Set(['afr', 'xho', 'zul', 'sot', 'tsn', 'nso', 'tso', 'ven', 'ssw', 'nbl', 'nde', 'sna', 'nya', 'her', 'ndo', 'kua', 'loz', 'toi', 'bem', 'tum', 'kmb', 'umb', 'lue', 'kwn', 'af', 'xh', 'zu', 'st', 'tn', 'ts', 've', 'ss', 'nr', 'sn', 'ny', 'nd']);
  const NORTH = new Set(['swa', 'swh', 'amh', 'yor', 'ibo', 'hau', 'som', 'orm', 'gaz', 'tir', 'lin', 'kin', 'run', 'mlg', 'plt', 'wol', 'aka', 'twi', 'ewe', 'gaa', 'ful', 'fuv', 'lug', 'kik', 'kam', 'luo', 'kon', 'lua', 'sw', 'am', 'yo', 'ig', 'ha', 'so', 'om', 'ti', 'ln', 'rw', 'rn', 'mg', 'wo', 'ak', 'tw', 'ee', 'ff', 'lg', 'ki', 'kg', 'cjk', 'tig', 'ara', 'arz', 'kab', 'ber', 'tzm', 'zgh', 'bam', 'ses', 'dag', 'efi', 'ibb', 'ijo', 'kpe', 'men', 'tem', 'vai', 'sag', 'ktu', 'mos', 'gur', 'dyu', 'bci', 'ctu', 'nym', 'mas', 'kln', 'luy', 'meru', 'mer', 'kdj', 'tuk', 'lgg', 'ach', 'alz', 'teo', 'rub', 'sna']);
  const SA_NAME = /afrikaans|xhosa|zulu|sotho|tswana|pedi|tsonga|venda|swati|swazi|ndebele|shona|chichewa|nyanja|herero|oshiwambo|ovambo|lozi|tonga|bemba|kwanyama|ndonga|himba|nama|damara|mozambi|zimbab|malawi|namib/i;
  const AF_NAME = /swahili|kiswahili|amharic|yoruba|igbo|hausa|somali|oromo|tigrinya|lingala|kinyarwanda|rwanda|kirundi|rundi|malagasy|wolof|akan|twi|ewe|fula|fulani|luganda|ganda|kikuyu|kamba|luo|kongo|chokwe|tumbuka|berber|kabyle|tamazight|bambara|dagbani|efik|ibibio|ijaw|kpelle|mende|temne|vai|sango|mossi|dyula|baoule|maasai|luhya|kalenjin|acholi|runyoro|nuer|dinka|african|ethiop|nigeria|ghana|kenya|uganda|tanzan|cameroon|congo|sudan|egypt|arabic \(?(egypt|morocc|alger|tunis|liby)/i;
  const isSA = (t) => SOUTH.has(String(t.lang).toLowerCase()) || SA_NAME.test(t.langName + ' ' + t.name);
  const isAfrica = (t) => !isSA(t) && (NORTH.has(String(t.lang).toLowerCase()) || AF_NAME.test(t.langName)) && !/^(eng|en)$/i.test(t.lang);
  const langOf = (t) => { const c = String(t.lang).toLowerCase(); return c === 'afr' || c === 'af' ? 'af' : c === 'xho' || c === 'xh' ? 'xh' : c === 'zul' || c === 'zu' ? 'zu' : /afrikaans/i.test(t.langName) ? 'af' : /xhosa/i.test(t.langName) ? 'xh' : /zulu/i.test(t.langName) ? 'zu' : 'en'; };
  const row = (t) => {
    const btn = h('button.btn.sm.primary', { type: 'button' }, 'Add');
    btn.onclick = () => addAo(t, btn);
    return h('div.row', { style: { gap: '6px', alignItems: 'center' } },
      h('span.grow', { title: t.license || '' }, h('b', t.name), h('span.note', (t.langName ? '  ' + t.langName : '') + ' · ' + SRC[t.src].label + (t.mb ? ', ' + t.mb + ' MB' : ''))), btn);
  };
  const ALIAS = { xhose: 'xhosa', xosa: 'xhosa', khosa: 'xhosa', xh: 'xho', zulu: 'zulu', isizulu: 'zulu', sesotho: 'sotho', setswana: 'tswana', sepedi: 'pedi', 'northern sotho': 'pedi', tshivenda: 'venda', xitsonga: 'tsonga', siswati: 'swati', isindebele: 'ndebele', chishona: 'shona', chichewa: 'nyanja', afrikaans: 'afrikaans', afrikans: 'afrikaans', afrikaan: 'afrikaans' };
  const strip = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const unprefix = (w) => w.replace(/^(isi|ses|se|si|tshi|xi|chi|oshi|ki|ci|ik|ichi|otji|oci)(?=[a-z]{3,})/, '');
  const words = (x) => strip(x).split(/[^a-z0-9]+/).filter(Boolean).map(unprefix);
  const canon = (qq) => { const k = strip(qq).trim(); return ALIAS[k] || ALIAS[unprefix(k)] || unprefix(k); };
  const hay = (t) => strip([t.abbr, t.name, t.lang, t.langName].join(' '));
  function matches(t, qq) {
    const c = canon(qq), h2 = hay(t);
    return h2.includes(strip(qq).trim()) || h2.includes(c) || words(t.name + ' ' + t.langName).some((w) => w === c || w.startsWith(c));
  }
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < best) best = cur[j]; }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  function fuzzyMatch(t, qq) {
    const c = canon(qq); if (c.length < 3) return false;
    const max = c.length >= 7 ? 2 : 1;
    return words(t.name + ' ' + t.langName + ' ' + t.abbr).some((w) => w.length >= 3 && lev(w.slice(0, c.length + 1), c, max) <= max || lev(w, c, max) <= max);
  }
  const rank = (t) => (isSA(t) ? 0 : isAfrica(t) ? 1 : 2);
  function paintChips() {
    clear(chips);
    const all = SRC.ao.items.length + SRC.gb.items.length + SRC.bc.items.length;
    const chip = (key, text) => h('button.btn.sm' + (filter === key ? '.primary' : ''), { type: 'button', 'aria-pressed': String(filter === key), onclick: () => { filter = key; renderAo(); } }, text);
    chips.append(chip('all', 'All sources (' + all + ')'));
    Object.keys(SRC).forEach((k) => {
      const s = SRC[k];
      chips.append(chip(k, s.label + ' (' + (s.state === 'loading' ? '…' : s.state === 'err' ? '!' : s.items.length) + ')'));
    });
    Object.keys(SRC).forEach((k) => {
      const s = SRC[k];
      if (s.state === 'err') chips.append(h('span.note', { style: { width: '100%' } }, s.label + ' (' + s.site + ') could not be reached: ' + s.note + '. ',
        h('button.btn.ghost.sm', { type: 'button', onclick: () => loadSource(k) }, 'Try again')));
      else if (s.note) chips.append(h('span.note', { style: { width: '100%' } }, s.label + ': ' + s.note + '.'));
    });
  }
  function renderAo() {
    paintChips();
    clear(searchBox);
    const q = searchInp.value || '';
    const qq = q.toLowerCase().trim();
    const keys = filter === 'all' ? Object.keys(SRC) : [filter];
    const list = keys.flatMap((k) => SRC[k].items);
    let hits = list.filter((t) => !qq || matches(t, qq));
    let fuzzy = false;
    if (qq && !hits.length) { hits = list.filter((t) => fuzzyMatch(t, qq)); fuzzy = hits.length > 0; }
    hits = hits
      .sort((x, y) => rank(x) - rank(y) || (x.langName + x.name).localeCompare(y.langName + y.name) || x.src.localeCompare(y.src))
      .slice(0, qq ? 150 : 100);
    if (!hits.length) {
      const waiting = keys.some((k) => SRC[k].state === 'loading');
      searchBox.appendChild(h('p.note', waiting ? 'Loading the Bible lists…'
        : 'No Bible matches “' + q + '” in ' + (filter === 'all' ? 'the three sources' : SRC[filter].label) + '. If you have the Bible as a file (from the Bible Society or your church), choose it in the form below the list.'));
      return;
    }
    if (fuzzy) searchBox.appendChild(h('p.note', 'No exact match for “' + q + '”. Closest results:'));
    hits.forEach((t) => searchBox.appendChild(row(t)));
  }

  // helloao: the whole Bible in one file when the site offers it, otherwise chapter by chapter.
  async function aoDownload(t, say) {
    for (const link of [t.simple, t.complete, '/api/' + t.id + '/complete.json']) {
      if (!link) continue;
      try { const r = await fetch(AO + link); if (r.ok) return await r.blob(); } catch (e) { /* try the next */ }
    }
    const r = await fetch(AO + t.books);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const bl = await r.json();
    const jobs = [];
    (bl.books || []).forEach((b) => { for (let c = b.firstChapterNumber || 1; c <= (b.lastChapterNumber || b.numberOfChapters || 0); c++) jobs.push([b, c]); });
    const books = new Map();
    let done = 0, i = 0;
    async function worker() {
      while (i < jobs.length) {
        const [b, c] = jobs[i++];
        let ok = false;
        for (let tries = 0; tries < 3 && !ok; tries++) {
          try {
            const rr = await fetch(AO + '/api/' + encodeURIComponent(t.id) + '/' + encodeURIComponent(b.id) + '/' + c + '.json');
            if (rr.ok) { const d = await rr.json(); if (!books.has(b.id)) books.set(b.id, { id: b.id, name: b.name, order: b.order, chapters: [] }); books.get(b.id).chapters.push({ chapter: d.chapter }); ok = true; }
          } catch (e) { /* retry */ }
        }
        say('Adding… ' + Math.round((++done / jobs.length) * 100) + '%');
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker));
    const out = { translation: { shortName: t.abbr, englishName: t.name, language: t.lang }, books: [...books.values()].sort((a, b) => a.order - b.order) };
    out.books.forEach((b) => b.chapters.sort((x, y) => x.chapter.number - y.chapter.number));
    return new Blob([JSON.stringify(out)], { type: 'application/json' });
  }

  // One tap: download, convert and save for offline use.
  async function addAo(t, bt) {
    bt.disabled = true; const old = bt.textContent; bt.textContent = 'Adding…';
    const say = (x) => { bt.textContent = x; };
    try {
      const ab = String(t.abbr || t.id).trim().toUpperCase().slice(0, 8);
      // The source goes into the id, so the same short name from two sources (XHO, SHONA …) never overwrites the other.
      const id = 'imp-' + ab.toLowerCase().replace(/[^a-z0-9]/g, '') + (t.src === 'ao' ? '' : '-' + t.src);
      const existing = await listTranslations(true);
      if (existing.some((x) => x.id === id && x.src !== 'imported')) throw new Error('already built in');
      let blob;
      if (t.src === 'ao') blob = await aoDownload(t, say);
      else {
        const r = await fetch(t.src === 'gb' ? GB + t.link : t.link);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        blob = await r.blob();
      }
      say('Saving…');
      const parsed = await parseBibleFile(new File([blob], ab + (t.src === 'bc' ? '.xml' : '.json'), { type: t.src === 'bc' ? 'application/xml' : 'application/json' }));
      await saveImported({ id, abbr: ab, name: t.name, lang: langOf(t), license: t.src === 'bc' ? t.license : SRC[t.src].site + (t.license ? ', ' + t.license : '') }, parsed);
      closeModal();
      toast(ab + ' added and available offline.', 'ok');
      if (onDone) onDone(id);
      return;
    } catch (e) { bt.textContent = 'Failed: ' + (e.name === 'TypeError' ? 'no connection to ' + SRC[t.src].site : e.message); }
    setTimeout(() => { bt.disabled = false; bt.textContent = old; }, 4000);
  }
  renderAo();
  loadSource('ao');
  loadSource('gb');
  modal({
    title: 'Add a Bible translation',
    body: h('div.col',
      gets,
      h('p.note', { style: { marginTop: '10px' } }, 'Have a Bible file your church is licensed to use (NIV, ESV, NKJV, Xhosa 1975 …)? Choose it here:'),
      presets,
      file, h('div.form', h('label', 'Short name'), abbr, h('label', 'Full name'), name, h('label', 'Language (book names)'), lang), status),
    actions: [{ label: 'Cancel' }, {
      label: 'Add Bible', primary: true, onclick: async () => {
        if (!parsed) { toast('Choose a Bible file first.', 'err'); return false; }
        const ab = (abbr.value || 'BIB').trim().toUpperCase();
        const id = 'imp-' + ab.toLowerCase().replace(/[^a-z0-9]/g, '');
        const list = await listTranslations(true);
        if (list.some((t) => t.id === id && t.src !== 'imported')) { toast('That short name is already used by a built-in Bible.', 'err'); return false; }
        status.textContent = 'Saving for offline use…';
        await saveImported({ id, abbr: ab, name: name.value.trim() || ab, lang: lang.value, license: 'Imported on this device' }, parsed);
        closeModal();
        toast(ab + ' added and available offline.', 'ok');
        if (onDone) onDone(id);
        return false;
      },
    }],
  });
}
