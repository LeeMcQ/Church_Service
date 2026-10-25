// "Add a Bible" dialog — for licensed translations (NIV, Xhosa 1975, …) that cannot be
// shipped with the app. The file is converted once and stored offline on this device.
import { h, clear } from '../core/util.js';
import { modal, toast, closeModal } from '../core/ui.js';
import { parseBibleFile, saveImported, listTranslations } from '../core/bibledata.js';

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
  // Full index from bible.helloao.org (1,200+ translations, public domain / free).
  const AO = 'https://bible.helloao.org';
  let aoIndex = null;
  const searchInp = h('input.field', { type: 'search', placeholder: 'Search 1,200+ Bibles (KJV, Afrikaans, Xhosa…)', 'aria-label': 'Search Bibles', oninput: (e) => renderAo(e.target.value) });
  const searchBox = h('div.col', { style: { gap: '4px', maxHeight: '200px', overflow: 'auto' } });
  const saBox = h('div.col', { style: { gap: '4px', maxHeight: '240px', overflow: 'auto' } });
  const gets = h('div.col', { style: { gap: '6px' } },
    h('b', 'Bibles of southern Africa'),
    h('p.note', 'Afrikaans, isiXhosa, isiZulu, Sesotho, Setswana, Sepedi, Xitsonga, Tshivenda, siSwati, isiNdebele, Shona, Chichewa and more: public-domain and free Bibles. Tap Add; it is saved for offline use.'),
    saBox,
    h('label', 'Search all Bibles'),
    searchInp, searchBox,
    h('p.note', 'Needs internet while adding. Public-domain and free Bibles only.'));
  async function loadAo() {
    if (aoIndex) return aoIndex;
    try {
      const r = await fetch(AO + '/api/available_translations.json');
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      aoIndex = (d.translations || []).map((t) => ({
        id: t.id, abbr: t.shortName || t.id, name: t.englishName || t.name || t.id,
        lang: t.language || '', langName: t.languageEnglishName || t.languageName || '', link: t.completeTranslationApiLink || ('/api/' + t.id + '/complete.json'),
      }));
    } catch (e) { aoIndex = []; }
    return aoIndex;
  }
  // Southern African languages (ISO 639-3 codes, plus a name fallback for odd codes).
  const SA_CODES = new Set(['afr', 'xho', 'zul', 'sot', 'tsn', 'nso', 'tso', 'ven', 'ssw', 'nbl', 'nde', 'sna', 'nya', 'her', 'ndo', 'kua', 'loz', 'toi', 'bem', 'tum', 'kmb', 'umb', 'lue', 'kwn', 'tn', 'st', 'xh', 'zu', 'ts', 've', 'ss', 'nr', 'sn', 'ny', 'af']);
  const SA_NAME = /afrikaans|xhosa|zulu|sotho|tswana|pedi|tsonga|venda|swati|swazi|ndebele|shona|chichewa|nyanja|herero|oshiwambo|ovambo|lozi|tonga|bemba|kwanyama|ndonga|himba|nama|damara/i;
  const isSA = (t) => SA_CODES.has(String(t.lang).toLowerCase()) || SA_NAME.test(t.langName + ' ' + t.name);
  const langOf = (t) => { const c = String(t.lang).toLowerCase(); return c === 'afr' || c === 'af' ? 'af' : c === 'xho' || c === 'xh' ? 'xh' : c === 'zul' || c === 'zu' ? 'zu' : /afrikaans/i.test(t.langName) ? 'af' : /xhosa/i.test(t.langName) ? 'xh' : /zulu/i.test(t.langName) ? 'zu' : 'en'; };
  const row = (t) => {
    const btn = h('button.btn.sm.primary', { type: 'button' }, 'Add');
    btn.onclick = () => addAo(t, btn);
    return h('div.row', { style: { gap: '6px', alignItems: 'center' } },
      h('span.grow', h('b', t.abbr), h('span.note', '  ' + t.name + (t.langName ? ' · ' + t.langName : ''))), btn);
  };
  async function renderAo(q) {
    clear(searchBox); clear(saBox);
    if (!aoIndex) { searchBox.appendChild(h('p.note', 'Loading Bible list…')); saBox.appendChild(h('p.note', 'Loading Bible list…')); }
    const list = await loadAo();
    clear(searchBox); clear(saBox);
    if (!list.length) { const m = 'Could not load the Bible list. Check your connection.'; searchBox.appendChild(h('p.note', m)); saBox.appendChild(h('p.note', m)); return; }
    const sa = list.filter(isSA).sort((x, y) => (x.langName + x.name).localeCompare(y.langName + y.name));
    if (sa.length) sa.forEach((t) => saBox.appendChild(row(t)));
    else saBox.appendChild(h('p.note', 'No southern African Bibles are in the free list right now. Use the search below.'));
    const qq = (q || '').toLowerCase().trim();
    const hits = list.filter((t) => !qq || t.abbr.toLowerCase().includes(qq) || t.name.toLowerCase().includes(qq) || t.lang.toLowerCase().includes(qq) || t.langName.toLowerCase().includes(qq)).slice(0, 20);
    if (!hits.length) { searchBox.appendChild(h('p.note', 'No Bible matches “' + q + '”.')); return; }
    hits.forEach((t) => searchBox.appendChild(row(t)));
  }
  // One tap: download from the free Bible list, convert and save for offline use.
  async function addAo(t, bt) {
    bt.disabled = true; const old = bt.textContent; bt.textContent = 'Adding…';
    try {
      const ab = String(t.abbr || t.id).trim().toUpperCase().slice(0, 8);
      const id = 'imp-' + ab.toLowerCase().replace(/[^a-z0-9]/g, '');
      const existing = await listTranslations(true);
      if (existing.some((x) => x.id === id && x.src !== 'imported')) throw new Error('already built in');
      const simple = t.link.replace('/complete.json', '/complete.simple.json');
      let r = await fetch(AO + simple);
      if (!r.ok) r = await fetch(AO + t.link);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const parsed = await parseBibleFile(new File([await r.blob()], ab + '.json', { type: 'application/json' }));
      await saveImported({ id, abbr: ab, name: t.name, lang: langOf(t), license: 'Public domain / free (bible.helloao.org)' }, parsed);
      closeModal();
      toast(ab + ' added and available offline.', 'ok');
      if (onDone) onDone(id);
      return;
    } catch (e) { bt.textContent = 'Failed: ' + e.message; }
    setTimeout(() => { bt.disabled = false; bt.textContent = old; }, 3500);
  }
  renderAo('');
  modal({
    title: 'Add a Bible translation',
    body: h('div.col',
      h('p.note.warn', 'The Bibles listed here are public domain or free to use. NIV, ESV, NKJV and the 1975 Xhosa Bible are copyrighted (Biblica, Crossway, Thomas Nelson, Bible Society of South Africa) and cannot be included: add those only from a file your church is licensed to use (choose it below).'),
      gets, presets,
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
