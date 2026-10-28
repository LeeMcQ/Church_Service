// Banners & Music → Music: choose background music and play it with the banners.
import { h, clear, fmtTime, fmtBytes } from '../core/util.js';
import { icon } from '../core/icons.js';
import { btn, toast, promptBox, menu, dropzone, modal, closeModal, undoToast } from '../core/ui.js';
import { db } from '../core/db.js';
import { bgMusic, KIND_LABEL, ACCEPT, linkInfo, playable } from '../core/bgmusic.js';
import { bgAudio } from '../core/audio.js';

const KIND_ICON = { file: 'music', midi: 'hymn', url: 'link', hls: 'link', list: 'link', youtube: 'video', soundcloud: 'music', web: 'web' };

export function createMusicView(ctx, root) {
  const { settings } = ctx;
  const S = () => settings.v.bannerMusic || {};
  let busy = false;

  // ---------------------------------------------------------------- now playing
  const npTitle = h('div.mu-np-title', 'Nothing playing');
  const npSub = h('div.note.mu-np-sub', '');
  const npBar = h('div.mu-bar', h('i'));
  const npTime = h('span.note.mu-time', '');
  const playB = btn('play', 'Play banner music', () => {
    if (bgMusic.isPlaying()) bgAudio.toggle();
    else bgMusic.start();
  }, { cls: 'primary', label: 'Play' });
  const prevB = btn('prev', 'Previous piece', () => bgMusic.prev());
  const nextB = btn('next', 'Next piece', () => bgMusic.next());
  const fadeB = btn('fade', 'Fade out', () => bgMusic.fadeOut(), { label: 'Fade out' });
  const stopB = btn('stop', 'Stop', () => bgMusic.stop());
  const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: S().volume != null ? S().volume : 0.7, 'aria-label': 'Music volume',
    oninput: () => bgMusic.setVolume(+vol.value) });
  const shuffleB = btn('shuffle', 'Shuffle', () => { settings.set('bannerMusic.shuffle', !S().shuffle); paintModes(); }, { pressed: !!S().shuffle });
  const repeatB = h('button.btn.sm', { type: 'button', title: 'Repeat', onclick: () => {
    const r = S().repeat || 'all';
    settings.set('bannerMusic.repeat', r === 'all' ? 'one' : r === 'one' ? 'off' : 'all'); paintModes();
  } });
  function paintModes() {
    shuffleB.setAttribute('aria-pressed', String(!!S().shuffle));
    const r = S().repeat || 'all';
    clear(repeatB); repeatB.append(icon('loop'), h('span', r === 'all' ? 'Repeat all' : r === 'one' ? 'Repeat one' : 'Play once'));
    repeatB.setAttribute('aria-pressed', String(r !== 'off'));
  }
  paintModes();

  const nowCard = h('div.card.mu-now',
    h('div.mu-np', icon('music'), h('div.grow', { style: { minWidth: 0 } }, npTitle, npSub, h('div.row', { style: { gap: '8px', alignItems: 'center' } }, npBar, npTime))),
    h('div.row.wrap.mu-ctrls', prevB, playB, nextB, fadeB, stopB,
      h('label.mu-vol', icon('vol'), vol), shuffleB, repeatB));

  function paintNow() {
    const on = bgMusic.isPlaying();
    const t = on ? bgMusic.current : null;
    npTitle.textContent = t ? t.title : on ? bgAudio.title : 'Nothing playing';
    const st = { time: 0, dur: 0, paused: true };
    if (on) Object.assign(st, lastState || {});
    npSub.textContent = t ? KIND_LABEL[t.kind] + (st.paused ? ' · paused' : ' · playing') + ' · from this computer’s speakers'
      : 'Press Play, or show a banner: the music starts by itself' + (S().auto ? '' : ' (switched off below)') + '.';
    const live = on && (bgAudio.live || !st.dur);
    npBar.hidden = !on || live;
    npBar.firstChild.style.width = (st.dur ? Math.min(100, (st.time / st.dur) * 100) : 0) + '%';
    npTime.textContent = !on ? '' : live ? 'Live' : fmtTime(st.time) + ' / ' + fmtTime(st.dur);
    clear(playB); playB.append(icon(on && !st.paused ? 'pause' : 'play'), h('span', on ? (st.paused ? 'Continue' : 'Pause') : 'Play'));
    [prevB, nextB, fadeB, stopB].forEach((b) => { b.disabled = !on; });
    listBox.querySelectorAll('.mu-row').forEach((r) => r.classList.toggle('now', !!t && r.dataset.id === t.id));
  }
  let lastState = null;
  bgAudio.on('state', (st) => { if (st.owner === 'music' || !st.active) { lastState = st; if (!root.hidden) paintNow(); } });
  bgMusic.on('now', () => { if (!root.hidden) paintNow(); });

  // ---------------------------------------------------------------- with banners
  const chk = (path, label, hint) => {
    const c = h('input', { type: 'checkbox', checked: !!S()[path], onchange: () => { settings.set('bannerMusic.' + path, c.checked); paintNow(); } });
    return h('label.mu-opt', c, h('span', h('b', label), h('span.note', hint)));
  };
  const fadeSel = h('select.field', { 'aria-label': 'Fade time', style: { width: 'auto', height: '34px' }, onchange: () => settings.set('bannerMusic.fadeSec', +fadeSel.value) },
    [1, 2, 3, 5, 8].map((s) => h('option', { value: s, selected: (S().fadeSec || 3) === s }, s + ' s')));
  const rulesCard = h('div.card.mu-rules',
    h('h3', icon('banner'), ' Play with the banners'),
    chk('auto', 'Start the music when a banner or the pre-service loop goes on screen', 'It fades in softly and plays the list below, then starts again.'),
    chk('fade', 'Fade out when something else goes on screen', 'A hymn, Bible verse, slide or video takes over; the music fades away.'),
    h('div.row', { style: { gap: '8px', alignItems: 'center' } }, h('span.note', 'Fade time'), fadeSel));

  // ---------------------------------------------------------------- adding
  const zone = dropzone('Drop music here or tap to choose: MP3, M4A/AAC, WAV, OGG, Opus, FLAC, WebM, AIFF, MIDI, or the sound of MP4 videos', ACCEPT, (files) => addFiles(files));
  const fileInp = zone.querySelector('input');
  const addRow = h('div.row.wrap', { style: { gap: '8px' } },
    btn('plus', 'Add music files', () => fileInp.click(), { label: 'Add music files' }),
    btn('link', 'Add an online link', () => linkDialog(), { label: 'Add online link' }));
  const prog = h('p.note', { hidden: true });

  async function addFiles(files) {
    if (busy || !files.length) return;
    busy = true; prog.hidden = false;
    try {
      const r = await bgMusic.addFiles(files, (name, i, n) => { prog.textContent = 'Adding ' + name + ' (' + i + ' of ' + n + ')…'; });
      if (r.added.length) toast(r.added.length + (r.added.length === 1 ? ' piece' : ' pieces') + ' added. They are kept on this device and play offline.', 'ok', 4000);
      if (r.failed.length) modal({ title: 'Some files could not be added', body: h('ul.mu-fails', r.failed.map((f) => h('li', h('b', f.name), h('div.note', f.why)))), actions: [{ label: 'OK', primary: true }] });
    } finally { busy = false; prog.hidden = true; }
  }

  function linkDialog() {
    const inp = h('input.field', { placeholder: 'https://…', 'aria-label': 'Music link', style: { width: '100%' } });
    const nm = h('input.field', { placeholder: 'Name (optional)', 'aria-label': 'Name', style: { width: '100%' } });
    const what = h('p.note', '');
    const status = h('p.note', '');
    const show = () => {
      const i = linkInfo(inp.value);
      what.textContent = !inp.value.trim() ? '' : i.kind ? 'Found: ' + KIND_LABEL[i.kind] + (i.kind === 'web' ? ' — it will open in its own window when you play it.' : '.') : i.why;
    };
    inp.addEventListener('input', show);
    const add = async () => {
      status.textContent = 'Checking the link…';
      try {
        const t = await bgMusic.addLink(inp.value, nm.value);
        closeModal();
        toast('Added: ' + t.title + '. Online music needs the internet while it plays.', 'ok', 4500);
      } catch (e) { status.textContent = e.message; status.classList.add('warn'); }
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    modal({
      title: 'Add online music',
      body: h('div.col', { style: { gap: '10px' } },
        inp, nm, what,
        h('div.note.mu-help',
          h('b', 'Works with'),
          h('ul',
            h('li', 'YouTube videos and playlists, SoundCloud — they play in a small player at the bottom of the screen'),
            h('li', 'Internet radio streams (the stream address, usually ending in /stream, .mp3, .aac, .m3u, .pls or .m3u8)'),
            h('li', 'Direct links to music files (…/song.mp3)'),
            h('li', 'Spotify, Apple Music, Deezer and similar: they open in their own window (they don’t allow other apps to play them)'))),
        status),
      actions: [{ label: 'Cancel' }, { label: 'Add', primary: true, onclick: () => { add(); return false; } }],
    });
    setTimeout(() => inp.focus(), 50);
  }

  // ---------------------------------------------------------------- the list
  const listBox = h('div.list.mu-list');
  const countNote = h('span.note', '');
  function renderList() {
    clear(listBox);
    const ts = bgMusic.tracks;
    const on = ts.filter((t) => t.on !== false && playable(t)).length;
    countNote.textContent = ts.length ? on + ' of ' + ts.length + ' play with the banners' : '';
    if (!ts.length) {
      listBox.appendChild(h('div.pad.note', 'No music yet. Add music files from this computer, or a YouTube, SoundCloud or internet radio link.'));
      return;
    }
    ts.forEach((t, i) => {
      const inList = h('input', { type: 'checkbox', checked: t.on !== false && playable(t), disabled: !playable(t), title: playable(t) ? 'Plays with the banners' : 'Opens in its own window only',
        'aria-label': 'Play ' + t.title + ' with the banners', onchange: () => bgMusic.update(t.id, { on: inList.checked }) });
      const info = [KIND_LABEL[t.kind]];
      if (t.dur) info.push(fmtTime(t.dur));
      if (t.size) info.push(fmtBytes(t.size));
      if (t.url) { try { info.push(new URL(t.url).hostname.replace(/^www\./, '')); } catch (e) { /* */ } }
      const more = btn('more', 'More', () => menu(more, [
        { label: 'Play now', icon: 'play', onclick: () => bgMusic.start(t.id) },
        { label: 'Rename', icon: 'edit', onclick: async () => { const n = await promptBox('Rename', 'Name', t.title); if (n && n.trim()) bgMusic.update(t.id, { title: n.trim() }); } },
        i > 0 ? { label: 'Move up', icon: 'up', onclick: () => bgMusic.move(t.id, i - 1) } : null,
        i < ts.length - 1 ? { label: 'Move down', icon: 'down', onclick: () => bgMusic.move(t.id, i + 1) } : null,
        '-',
        { label: 'Remove', icon: 'trash', onclick: async () => {
          const r = await bgMusic.remove(t.id, { keepFile: true });
          if (r) undoToast('“' + t.title + '” removed from the banner music.', { onUndo: () => bgMusic.restore(r), onCommit: () => { if (r.track.fileId && !bgMusic.tracks.some((x) => x.id === r.track.id)) db.del('files', r.track.fileId).catch(() => {}); } });
        } },
      ].filter(Boolean)), { cls: 'sm' });
      const row = h('div.mu-row', { 'data-id': t.id, draggable: 'true' },
        h('span.mu-n', String(i + 1)), inList,
        h('button.mu-main', { type: 'button', title: t.kind === 'web' ? 'Open ' + t.title : 'Play ' + t.title + ' now', onclick: () => bgMusic.start(t.id) },
          icon(KIND_ICON[t.kind] || 'music'), h('span.grow', { style: { minWidth: 0 } }, h('div.trunc', t.title), h('div.note.trunc', info.join(' · ')))),
        btn('play', 'Play now', () => bgMusic.start(t.id), { cls: 'sm' }), more);
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-music', t.id); row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-music')) { e.preventDefault(); row.classList.add('over'); } });
      row.addEventListener('dragleave', () => row.classList.remove('over'));
      row.addEventListener('drop', (e) => { const id = e.dataTransfer.getData('text/x-music'); row.classList.remove('over'); if (id && id !== t.id) { e.preventDefault(); bgMusic.move(id, i); } });
      listBox.appendChild(row);
    });
    paintNow();
  }
  bgMusic.on('change', () => { renderList(); });
  bgMusic.on('error', ({ track, why }) => toast((track ? track.title + ': ' : '') + why, 'err', 7000));
  bgMusic.on('notice', ({ text }) => toast(text, '', 6000));

  root.append(
    h('p.note.bn-intro', 'Background music for the banners and the pre-service loop. It plays from this computer’s speakers (or the sound system connected to it), so the screen can keep showing the banners.'),
    nowCard, rulesCard,
    h('div.card.mu-lib', h('div.row', { style: { alignItems: 'center', gap: '8px' } }, h('h4.grow', icon('music'), ' Music for the banners'), countNote),
      listBox, addRow, prog, zone,
      h('p.note', 'Files are stored on this device and play offline. Online links (YouTube, SoundCloud, radio) need the internet. Only use music your church may play in public.')));

  bgMusic.ready.then(renderList);
  return { show() { vol.value = S().volume != null ? S().volume : 0.7; paintModes(); renderList(); paintNow(); } };
}

/** A one-line summary for the banner editor and the loop: "♪ Music: 5 pieces, starts with banners". */
export function musicChip(ctx, onOpen) {
  const el = h('button.mu-chip', { type: 'button', title: 'Banner music', onclick: onOpen });
  const paint = () => {
    const s = ctx.settings.v.bannerMusic || {};
    const n = bgMusic.tracks.filter((t) => t.on !== false && playable(t)).length;
    const playing = bgMusic.isPlaying();
    clear(el);
    el.append(icon('music'), h('span', playing ? 'Playing: ' + (bgMusic.current ? bgMusic.current.title : bgAudio.title)
      : !n ? 'Add background music' : n + (n === 1 ? ' piece' : ' pieces') + (s.auto ? ' · starts with the banner' : ' · press Play in Music')));
    el.classList.toggle('on', playing);
  };
  bgMusic.on('change', paint); bgMusic.on('now', paint); bgAudio.on('state', paint);
  ctx.settings.on('change:bannerMusic', paint);
  bgMusic.ready.then(paint);
  return el;
}
