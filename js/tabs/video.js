// Video & audio tab with VLC-style controls. Playback uses the browser's own (usually
// hardware-accelerated) decoders, which is far lighter on old PCs than running VLC.
import { h, clear, uid, fmtTime, fmtBytes, readText, download } from '../core/util.js';
import { icon } from '../core/icons.js';
import { btn, seg, toggle, toast, promptBox, confirmBox, dropzone } from '../core/ui.js';
import { db } from '../core/db.js';
import { srtToVtt } from '../lib/srt.js';

const EQ_LABELS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const EQ_PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Voice: [-4, -3, -1, 0, 2, 4, 5, 4, 2, 0],
  Music: [3, 2, 1, 0, -1, 0, 1, 2, 3, 3],
  'Bass boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  Treble: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  'Small speakers': [-6, -4, -2, 0, 2, 3, 3, 2, 1, 0],
};
const isAudio = (it) => /^audio\//.test(it.type || '') || /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i.test(it.name || '');

export default function create(ctx) {
  const { settings, live, bgAudio } = ctx;
  let items = [];          // stored + session + companion items, in playlist order
  let sel = null;
  let previewUrl = null;
  const session = new Map(); // id -> File (not saved)
  const opts = { volume: settings.v.video.volume || 1, rate: 1, loop: false, ab: null, fit: settings.v.video.fit || 'contain', zoom: 1, rotate: 0, flipH: false, flipV: false, filters: { brightness: 1, contrast: 1, saturate: 1, hue: 0 }, eq: null, subs: null };
  let bgMode = true;       // audio files play in the background by default
  let endedFor = null;

  // ------------------------------------------------------------ layout
  const listEl = h('div.list');
  const prevVideo = h('video', { controls: true, muted: true, preload: 'metadata', playsInline: true });
  prevVideo.muted = true;
  const prevBox = h('div.media-prev', prevVideo);
  const selTitle = h('h3.grow.trunc', 'Nothing selected');
  const startNote = h('span.note', '');
  const useStart = h('input', { type: 'checkbox' });
  const bgToggleWrap = h('div');
  const panel = h('div.vlc-grid');
  const fsa = 'showOpenFilePicker' in window;
  const addBtn = btn('plus', 'Add videos or music', () => addFiles(), { cls: 'sm', label: 'Add' });
  const linkBtn = btn('link', 'Add a video link', () => addLink(), { cls: 'sm', label: 'Link' });
  const pcBtn = btn('pc', 'Media on the church PC (companion)', () => loadCompanion(true), { cls: 'sm', label: 'Church PC' });
  pcBtn.hidden = true;
  const repeatSeg = seg([['off', 'No repeat'], ['one', 'Repeat 1'], ['all', 'Repeat all']], settings.v.video.repeat, (v) => settings.set('video.repeat', v));
  const zone = dropzone('Drop videos or music here', 'video/*,audio/*,.mkv,.mov', (files) => addFiles(files));

  const el = h('section',
    h('div.toolbar.wrap-ok', h('h2', 'Video'), addBtn, linkBtn, pcBtn, h('div.grow'), repeatSeg,
      toggle('Play next automatically', settings.v.video.autoNext, (v) => settings.set('video.autoNext', v))),
    h('div.split.media-split',
      h('div.pane', h('div.pane-h', 'Playlist'), h('div.scroll', { style: { flex: '1' } }, listEl, h('div.pad', zone))),
      h('div.pane', h('div.scroll.pad', { style: { flex: '1' } },
        h('div.row', { style: { marginBottom: '8px' } }, selTitle),
        prevBox,
        h('div.row.wrap', { style: { margin: '8px 0 14px' } },
          h('label.switch', useStart, h('span', 'Start from the preview position')), startNote, bgToggleWrap),
        panel))));

  // ------------------------------------------------------------ items
  async function loadItems() {
    const stored = (await db.all('files')).filter((f) => f.kind === 'media');
    const order = (await db.get('kv', 'media-order')) || [];
    const all = stored.concat(Array.from(session.values()).map((x) => x.meta)).concat(items.filter((x) => x.remote));
    all.sort((a, b) => { const ia = order.indexOf(a.id), ib = order.indexOf(b.id); return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.added - b.added; });
    items = all;
    renderList();
  }
  const saveOrder = () => db.put('kv', 'media-order', items.map((x) => x.id));

  function renderList() {
    clear(listEl);
    if (!items.length) { listEl.appendChild(h('p.note.pad', 'Add videos (MP4, WebM, MKV) or music (MP3, M4A, WAV). On a PC the files stay where they are — nothing is copied.')); return; }
    items.forEach((it, i) => {
      const row = h('div.li' + (sel && sel.id === it.id ? '.sel' : ''), { role: 'button', tabindex: 0,
        onclick: () => select(it), ondblclick: () => select(it).then(() => live.take()),
        onkeydown: (e) => { if (e.key === 'Enter') select(it); } },
      icon(isAudio(it) ? 'music' : 'video'),
      h('span.grow', h('div.trunc', it.name), h('div.note', [it.remote ? 'Church PC' : it.handle ? 'On this PC' : it.blob ? 'Saved offline' : 'This session only', it.size ? fmtBytes(it.size) : '', it.dur ? fmtTime(it.dur) : ''].filter(Boolean).join(' · '))),
      live.cue && live.cue.itemId === it.id ? h('span.tally-dot.live') : null,
      btn('up', 'Move up', (e) => { e.stopPropagation(); move(i, -1); }, { cls: 'sm' }),
      btn('trash', 'Remove', (e) => { e.stopPropagation(); removeItem(it); }, { cls: 'sm' }));
      listEl.appendChild(row);
    });
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const t = items[i]; items[i] = items[j]; items[j] = t;
    saveOrder(); renderList();
  }

  async function removeItem(it) {
    if (!(await confirmBox('Remove from playlist?', '“' + it.name + '” will be removed from SDA Sabbath' + (it.blob ? ' and its offline copy deleted' : '') + '. The original file is not touched.', 'Remove', true))) return;
    if (session.has(it.id)) session.delete(it.id); else if (!it.remote) await db.del('files', it.id);
    items = items.filter((x) => x !== it);
    if (sel === it) { sel = null; ctx.setStaged('video', null); renderSelected(); }
    renderList();
  }

  async function addFiles(files) {
    if (!files && fsa) {
      try {
        const handles = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'Video and audio', accept: { 'video/*': ['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.ogv'], 'audio/*': ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac', '.opus'] } }] });
        for (const hd of handles) {
          const f = await hd.getFile();
          const id = uid();
          await db.put('files', id, { id, kind: 'media', name: f.name, type: f.type, size: f.size, added: Date.now(), handle: hd });
        }
        await loadItems();
        return;
      } catch (e) { if (e.name === 'AbortError') return; console.warn(e); }
    }
    if (!files) { zone.querySelector('input').click(); return; }
    const total = files.reduce((s, f) => s + f.size, 0);
    let keep = false;
    try {
      const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      const free = est ? est.quota - est.usage : 0;
      keep = free > total * 1.3 && (await confirmBox('Keep offline copies?', 'Save ' + fmtBytes(total) + ' inside SDA Sabbath so these play next time without choosing them again? (Choose “No” to use them for this session only.)', 'Keep copies'));
    } catch (e) { keep = false; }
    for (const f of files) {
      if (!/^(video|audio)\//.test(f.type) && !/\.(mkv|mov|mp4|webm|mp3|m4a|wav|ogg|flac)$/i.test(f.name)) continue;
      const id = uid();
      const meta = { id, kind: 'media', name: f.name, type: f.type, size: f.size, added: Date.now() };
      if (keep) await db.put('files', id, Object.assign(meta, { blob: f }));
      else session.set(id, { meta, file: f });
    }
    await loadItems();
  }

  async function addLink() {
    const url = await promptBox('Add a video link', 'Direct link to an .mp4 / .webm / .mp3 file. For YouTube use the Web tab.', '', 'https://…/video.mp4');
    if (!url) return;
    if (/youtu\.?be/.test(url)) { toast('YouTube links play in the Web tab (they need internet).', ''); (await ctx.tab('web')).open({ url }); return; }
    const id = uid();
    await db.put('files', id, { id, kind: 'media', name: decodeURIComponent(url.split('/').pop().split('?')[0]) || url, type: '', url, added: Date.now() });
    await loadItems();
  }

  async function loadCompanion(show) {
    if (!ctx.companion) return;
    pcBtn.hidden = false;
    try {
      const list = await (await fetch('api/media?pin=' + encodeURIComponent(settings.v.companion.pin || ''), { cache: 'no-store' })).json();
      items = items.filter((x) => !x.remote);
      list.forEach((m) => items.push({ id: 'pc:' + m.name, kind: 'media', name: m.name, type: m.type || '', size: m.size, added: m.mtime || 0, url: 'media/' + m.name.split('/').map(encodeURIComponent).join('/'), remote: true }));
      renderList();
      if (show) toast(list.length + ' files in the church PC media folder.', 'ok');
    } catch (e) { if (show) toast('Could not read the church PC media folder.', 'err'); }
  }

  async function srcOf(it, interactive = true) {
    if (it.url) return it.url;
    if (session.has(it.id)) return session.get(it.id).file;
    if (it.blob) return it.blob;
    if (it.handle) {
      let p = await it.handle.queryPermission({ mode: 'read' });
      if (p !== 'granted' && interactive) p = await it.handle.requestPermission({ mode: 'read' });
      if (p !== 'granted') throw new Error('SDA Sabbath needs permission to open “' + it.name + '”. Click it again and allow access.');
      return it.handle.getFile();
    }
    throw new Error('This file is no longer available. Add it again.');
  }

  // ------------------------------------------------------------ selection & staging
  async function select(it) {
    sel = it;
    renderList();
    try {
      const src = await srcOf(it, true);
      it._src = src;
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
      prevVideo.src = typeof src === 'string' ? src : (previewUrl = URL.createObjectURL(src));
      prevVideo.onloadedmetadata = () => {
        if (!it.dur && isFinite(prevVideo.duration)) { it.dur = prevVideo.duration; if (!session.has(it.id) && !it.remote) db.put('files', it.id, it); renderList(); }
      };
    } catch (e) { toast(e.message, 'err', 6000); it._src = null; }
    renderSelected();
    restage();
  }

  function restage() {
    if (!sel || !sel._src) { ctx.setStaged('video', null); return; }
    const it = sel;
    const start = useStart.checked ? prevVideo.currentTime || 0 : 0;
    if (isAudio(it) && bgMode) {
      ctx.setStaged('video', {
        id: 'audio:' + it.id, tab: 'video', title: it.name, sub: 'Background audio', itemId: it.id,
        deck: { kind: 'audio', frame: { kind: 'audio', title: it.name, sub: 'Plays on this device — the screen stays as it is' } },
        run: () => { bgAudio.play(it._src, it.name, { loop: opts.loop, volume: Math.min(1, opts.volume) }); if (start) bgAudio.seek(start); },
        plan: { tab: 'video', item: it.id, label: it.name },
      });
      return;
    }
    ctx.setStaged('video', {
      id: 'video:' + it.id, tab: 'video', title: it.name, sub: isAudio(it) ? 'Audio' : 'Video', itemId: it.id,
      deck: { kind: 'video', frame: { kind: 'video', src: it._src, start, opts: JSON.parse(JSON.stringify(opts)), title: it.name } },
      plan: { tab: 'video', item: it.id, label: it.name },
    });
  }
  prevVideo.addEventListener('seeked', () => { startNote.textContent = useStart.checked ? 'Starts at ' + fmtTime(prevVideo.currentTime) : ''; if (useStart.checked) restage(); });
  useStart.addEventListener('change', () => { startNote.textContent = useStart.checked ? 'Starts at ' + fmtTime(prevVideo.currentTime) : ''; restage(); });

  function renderSelected() {
    selTitle.textContent = sel ? sel.name : 'Nothing selected';
    clear(bgToggleWrap);
    if (sel && isAudio(sel)) bgToggleWrap.appendChild(toggle('Background audio (keep the screen as it is)', bgMode, (v) => { bgMode = v; restage(); }));
  }

  // ------------------------------------------------------------ VLC-style panel
  const isLiveVideo = () => live.cue && live.cue.tab === 'video' && live.cue.deck.kind === 'video';
  function apply(op, v) {
    if (isLiveVideo()) live.mediaCmd(op, v);
    restage();
  }
  const card = (title, ...kids) => h('div.card', h('h3', title), ...kids);
  const slider = (label, min, max, step, val, fmt, on) => {
    const out = h('span.note', { style: { minWidth: '52px', textAlign: 'right', flex: 'none' } }, fmt(val));
    const r = h('input', { type: 'range', min, max, step, value: val, 'aria-label': label, style: { flex: '1 1 0', minWidth: '0' }, oninput: () => { out.textContent = fmt(+r.value); r.setAttribute('aria-valuetext', fmt(+r.value)); on(+r.value); } });
    r.value = val;
    return h('div.row', h('span.note', { style: { minWidth: '86px', flex: 'none' } }, label), r, out);
  };

  function buildPanel() {
    clear(panel);
    // Playback
    const rateSel = h('select.field', { 'aria-label': 'Playback speed', onchange: () => { opts.rate = +rateSel.value; apply('rate', opts.rate); } },
      [0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3, 4].map((r) => h('option', { value: r, selected: r === opts.rate }, r + '×')));
    const abNote = h('span.note', opts.ab ? fmtTime(opts.ab.a) + ' → ' + fmtTime(opts.ab.b) : 'off');
    const nowT = () => (isLiveVideo() && live.media ? live.media.time : prevVideo.currentTime || 0);
    let abA = null;
    panel.appendChild(card('Playback',
      h('div.row', h('span.note', { style: { minWidth: '86px' } }, 'Speed'), rateSel),
      toggle('Loop this video', opts.loop, (v) => { opts.loop = v; apply('loop', v); }),
      h('div.row.wrap', h('span.note', { style: { minWidth: '86px' } }, 'A-B repeat'),
        h('button.btn.sm', { type: 'button', onclick: () => { abA = nowT(); abNote.textContent = 'A = ' + fmtTime(abA); } }, 'Set A'),
        h('button.btn.sm', { type: 'button', onclick: () => { const b = nowT(); if (abA == null || b <= abA) { toast('Set A first, then B later in the video.', 'err'); return; } opts.ab = { a: abA, b }; abNote.textContent = fmtTime(abA) + ' → ' + fmtTime(b); apply('ab', opts.ab); } }, 'Set B'),
        h('button.btn.sm', { type: 'button', onclick: () => { opts.ab = null; abA = null; abNote.textContent = 'off'; apply('ab', null); } }, 'Clear'), abNote),
      h('div.row.wrap', h('span.note', { style: { minWidth: '86px' } }, 'Frame'),
        btn('prev', 'Previous frame', () => { if (isLiveVideo()) live.mediaCmd('frame', -1); else { prevVideo.pause(); prevVideo.currentTime -= 1 / 25; } }, { cls: 'sm' }),
        btn('next', 'Next frame', () => { if (isLiveVideo()) live.mediaCmd('frame', 1); else { prevVideo.pause(); prevVideo.currentTime += 1 / 25; } }, { cls: 'sm' }),
        h('button.btn.sm', { type: 'button', onclick: () => live.mediaCmd('fadeIn', 1500) }, icon('fade'), 'Fade in'),
        h('button.btn.sm', { type: 'button', onclick: () => live.mediaCmd('fadeOut', 2000) }, icon('fade'), 'Fade out'))));

    // Audio
    const eqWrap = h('div.eq');
    const eqVals = (opts.eq || EQ_PRESETS.Flat).slice();
    const eqInputs = EQ_LABELS.map((lab, i) => {
      const r = h('input', { type: 'range', min: -12, max: 12, step: 1, value: eqVals[i], 'aria-label': lab + ' Hz',
        oninput: () => { eqVals[i] = +r.value; opts.eq = eqVals.some((x) => x) ? eqVals.slice() : null; apply('eq', opts.eq); } });
      r.value = eqVals[i];
      eqWrap.appendChild(h('label', r, lab));
      return r;
    });
    const presetSel = h('select.field', { 'aria-label': 'Equaliser preset', onchange: () => { const p = EQ_PRESETS[presetSel.value]; p.forEach((v, i) => { eqVals[i] = v; eqInputs[i].value = v; }); opts.eq = p.some((x) => x) ? p.slice() : null; apply('eq', opts.eq); } },
      Object.keys(EQ_PRESETS).map((k) => h('option', { value: k }, k)));
    panel.appendChild(card('Sound',
      slider('Volume', 0, 2, 0.05, opts.volume, (v) => Math.round(v * 100) + '%', (v) => { opts.volume = v; settings.set('video.volume', v); apply('volume', v); }),
      h('p.note', 'Above 100% boosts quiet videos.'),
      h('div.row', h('span.note', { style: { minWidth: '86px' } }, 'Equaliser'), presetSel), eqWrap));

    // Picture
    const f = opts.filters;
    panel.appendChild(card('Picture',
      h('div.row', h('span.note', { style: { minWidth: '86px' } }, 'Shape'), seg([['contain', 'Fit'], ['cover', 'Fill'], ['fill', 'Stretch']], opts.fit, (v) => { opts.fit = v; settings.set('video.fit', v); apply('fit', v); })),
      slider('Zoom', 1, 3, 0.05, opts.zoom, (v) => v.toFixed(2) + '×', (v) => { opts.zoom = v; apply('zoom', v); }),
      h('div.row.wrap', h('span.note', { style: { minWidth: '86px' } }, 'Turn'),
        seg([['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']], String(opts.rotate), (v) => { opts.rotate = +v; apply('rotate', +v); }),
        toggle('Mirror', opts.flipH, (v) => { opts.flipH = v; apply('flip', { h: opts.flipH, v: opts.flipV }); })),
      slider('Brightness', 0.3, 2, 0.05, f.brightness, (v) => Math.round(v * 100) + '%', (v) => { f.brightness = v; apply('filters', f); }),
      slider('Contrast', 0.3, 2, 0.05, f.contrast, (v) => Math.round(v * 100) + '%', (v) => { f.contrast = v; apply('filters', f); }),
      slider('Colour', 0, 2.5, 0.05, f.saturate, (v) => Math.round(v * 100) + '%', (v) => { f.saturate = v; apply('filters', f); }),
      slider('Hue', -180, 180, 5, f.hue, (v) => v + '°', (v) => { f.hue = v; apply('filters', f); }),
      h('button.btn.sm', { type: 'button', onclick: () => { Object.assign(opts, { zoom: 1, rotate: 0, flipH: false, flipV: false, filters: { brightness: 1, contrast: 1, saturate: 1, hue: 0 } }); ['zoom', 'rotate', 'filters'].forEach((k) => apply(k, opts[k])); apply('flip', { h: false, v: false }); buildPanel(); } }, 'Reset picture')));

    // Subtitles & tools
    const subNote = h('span.note', opts.subs ? 'Subtitles loaded' : 'No subtitles');
    const subInp = h('input', { type: 'file', accept: '.srt,.vtt', 'aria-label': 'Subtitle file', style: { display: 'none' }, onchange: async () => {
      const file = subInp.files[0]; if (!file) return;
      opts.subs = { vtt: srtToVtt(await readText(file)), size: (opts.subs && opts.subs.size) || 100 };
      subNote.textContent = file.name; apply('subs', opts.subs);
    } });
    panel.appendChild(card('Subtitles and tools',
      h('div.row.wrap', h('button.btn.sm', { type: 'button', onclick: () => subInp.click() }, icon('subtitle'), 'Load .srt / .vtt'),
        h('button.btn.sm', { type: 'button', onclick: () => { opts.subs = null; subNote.textContent = 'No subtitles'; apply('subs', null); } }, 'Remove'), subNote, subInp),
      slider('Text size', 60, 200, 10, (opts.subs && opts.subs.size) || 100, (v) => v + '%', (v) => { if (opts.subs) { opts.subs.size = v; apply('subs', opts.subs); } }),
      h('div.row.wrap', { style: { marginTop: '8px' } },
        h('button.btn.sm', { type: 'button', onclick: () => snapshot() }, icon('snapshot'), 'Snapshot'),
        h('span.note', 'Saves the current picture.'))));
  }

  function snapshot() {
    if (isLiveVideo()) { live.mediaCmd('snapshot'); return; }
    if (!prevVideo.videoWidth) { toast('Select a video first.', 'err'); return; }
    const c = h('canvas', { width: prevVideo.videoWidth, height: prevVideo.videoHeight });
    c.getContext('2d').drawImage(prevVideo, 0, 0);
    c.toBlob((b) => b && download(b, 'snapshot.jpg'), 'image/jpeg', 0.92);
  }
  live.on('snapshot', (b) => { if (b) download(b, 'snapshot-' + fmtTime(live.media ? live.media.time : 0).replace(/:/g, '-') + (b.type === 'image/png' ? '.png' : '.jpg')); });

  // ------------------------------------------------------------ playlist auto-next
  live.on('live', () => { endedFor = null; renderList(); });
  live.on('media', (m) => {
    const c = live.cue;
    if (!c || c.tab !== 'video' || !m.ended || m.loop || endedFor === c) return;
    endedFor = c;
    const mode = settings.v.video.repeat;
    if (mode === 'one') { live.mediaCmd('seek', 0); live.mediaCmd('play'); endedFor = null; return; }
    if (!settings.v.video.autoNext) return;
    const i = items.findIndex((x) => x.id === c.itemId);
    let next = items[i + 1];
    if (!next && mode === 'all') next = items[0];
    if (!next || isAudio(next) && bgMode) return;
    select(next).then(() => { const st = ctx.stagedOf('video'); if (st && st.itemId === next.id) live.take(st); });
  });
  bgAudio.on('ended', (owner) => {
    if (owner !== 'video' || !settings.v.video.autoNext) return;
    const i = items.findIndex((x) => x.name === bgAudio.title);
    const next = items[i + 1] || (settings.v.video.repeat === 'all' ? items[0] : null);
    if (next && isAudio(next)) select(next).then(() => { const st = ctx.stagedOf('video'); if (st && st.run) st.run(); });
  });

  // ------------------------------------------------------------ live control bar
  let offMedia = null;
  const api = {
    el,
    /** Add files from another tab (Plan): resolves once they are in the playlist. */
    async importFiles(files) { await ready; const before = new Set(items.map((x) => x.id)); await addFiles(files); return items.filter((x) => !before.has(x.id)); },
    async open({ item }) {
      await ready;
      await ctx.showTab('video');
      const it = items.find((x) => x.id === item);
      if (!it) { toast('That video is not in the playlist on this device.', 'err'); return null; }
      await select(it);
      return ctx.stagedOf('video');
    },
    onShow() { if (ctx.companion) loadCompanion(false); },
    controls(cue) {
      if (offMedia) { offMedia(); offMedia = null; }
      if (cue.deck.kind !== 'video') return null;
      const playB = btn('pause', 'Play / pause (Space)', () => live.mediaCmd('toggle'));
      const seek = h('input', { type: 'range', min: 0, max: 1, step: 0.1, value: 0, 'aria-label': 'Position' });
      let dragging = false;
      seek.addEventListener('input', () => { dragging = true; tm.textContent = fmtTime(+seek.value) + ' / ' + fmtTime(+seek.max); });
      seek.addEventListener('change', () => { live.mediaCmd('seek', +seek.value); dragging = false; });
      const tm = h('span.tm', '0:00 / 0:00');
      const vol = h('input', { type: 'range', min: 0, max: 2, step: 0.05, value: opts.volume, title: 'Volume', 'aria-label': 'Volume', style: { width: '90px' }, oninput: () => { opts.volume = +vol.value; live.mediaCmd('volume', opts.volume); } });
      vol.value = opts.volume;
      const muteB = btn('vol', 'Mute', () => live.mediaCmd('mute', !(live.media && live.media.muted)), { cls: 'sm' });
      const loopB = btn('loop', 'Loop', () => { opts.loop = !(live.media && live.media.loop); live.mediaCmd('loop', opts.loop); }, { cls: 'sm' });
      offMedia = live.on('media', (m) => {
        playB.replaceChildren(icon(m.paused ? 'play' : 'pause'));
        if (!dragging) { seek.max = m.dur || 1; seek.value = m.time; tm.textContent = fmtTime(m.time) + ' / ' + fmtTime(m.dur); }
        muteB.replaceChildren(icon(m.muted ? 'mute' : 'vol'));
        muteB.classList.toggle('live-on', !!m.muted);
        loopB.setAttribute('aria-pressed', String(!!m.loop));
      });
      return h('div.row', { style: { flex: '1', minWidth: '0' } },
        playB, btn('stop', 'Stop', () => live.mediaCmd('stop'), { cls: 'hide-sm' }),
        btn('back10', 'Back 10 s', () => live.mediaCmd('skip', -10), { cls: 'hide-sm' }),
        btn('fwd10', 'Forward 10 s', () => live.mediaCmd('skip', 10), { cls: 'hide-sm' }),
        h('div.seekbar', seek, tm),
        h('span.hide-sm.row', muteB, vol), h('span.hide-sm', loopB),
        btn('fade', 'Fade out', () => live.mediaCmd('fadeOut', 2000), { cls: 'sm hide-sm' }));
    },
  };

  buildPanel();
  renderSelected();
  const ready = loadItems();
  return api;
}
