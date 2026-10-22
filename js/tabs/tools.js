// Service tools: lower thirds, responsive readings, communion sequence, streaming overlay, captions
// The Stage and Stream parts (stage.js, stream.js) are shown in this tab too.
// Like every other tab, slides from here go to the green Next screen first; Present shows them.
// Children's story templates intentionally omitted.
import { h, esc } from '../core/util.js';
import { icon } from '../core/icons.js';
import { btn } from '../core/ui.js';
import createStage from './stage.js';
import createStream from './stream.js';

const RESPONSIVE = [
  { title: 'Call to Worship', text: 'Leader: O come, let us worship and bow down.\nPeople: Let us kneel before the Lord our maker.\nLeader: For he is our God.\nPeople: And we are the people of his pasture, and the sheep of his hand.' },
  { title: 'Offering Response', text: 'Leader: The earth is the Lord’s, and the fullness thereof.\nPeople: The world, and they that dwell therein.\nLeader: Let us give with cheerful hearts.\nPeople: For God loves a cheerful giver.' },
  { title: 'Benediction Response', text: 'Leader: The Lord bless you and keep you.\nPeople: The Lord make his face shine upon you and be gracious unto you.\nLeader: The Lord lift up his countenance upon you.\nPeople: And give you peace. Amen.' },
];

const COMMUNION = [
  { title: 'Ordinance of Humility', text: 'Jesus said, “If I then, your Lord and Master, have washed your feet; ye also ought to wash one another’s feet.”\n\nJohn 13:14\n\nMen and women separate for the foot-washing. This is a symbol of humility and service.' },
  { title: 'Lord’s Supper — Bread', text: 'The Lord Jesus the same night in which he was betrayed took bread:\nAnd when he had given thanks, he brake it, and said,\n“Take, eat: this is my body, which is broken for you: this do in remembrance of me.”\n\n1 Corinthians 11:23–24' },
  { title: 'Lord’s Supper — Cup', text: 'After the same manner also he took the cup, when he had supped, saying,\n“This cup is the new testament in my blood: this do ye, as oft as ye drink it, in remembrance of me.”\n\n1 Corinthians 11:25' },
  { title: 'Closing', text: 'For as often as ye eat this bread, and drink this cup, ye do shew the Lord’s death till he come.\n\n1 Corinthians 11:26' },
];

function createService(ctx) {
  const { live, toast: showToast } = ctx;
  let captionRec = null;

  const lowerText = h('input.field', { placeholder: 'Lower third text (e.g. John 3:16 or Hymn 73)', style: { width: '100%' } });
  const lowerKind = h('select.field', { 'aria-label': 'Lower third type', style: { width: '140px' } },
    h('option', { value: 'scripture' }, 'Scripture'),
    h('option', { value: 'hymn' }, 'Hymn'),
    h('option', { value: 'speaker' }, 'Speaker'),
    h('option', { value: 'offering' }, 'Offering'),
    h('option', { value: 'custom' }, 'Custom'));

  // ------------------------------------------------------------ slides (Next first, then Present)
  // Text becomes a normal text slide: "Leader:" / "People:" labels in the accent colour, and a
  // Bible reference on its own last line moves to the footer like the Bible tab's references.
  const REF_LINE = /^(?:[1-3]\s?)?[A-Z][a-z]+\.?\s\d{1,3}(?::\d{1,3}(?:\s?[-–]\s?\d{1,3})?)?$/;
  function textFrame(title, text) {
    const paras = String(text || '').trim().split(/\n\s*\n/);
    let foot = '';
    if (paras.length > 1 && REF_LINE.test(paras[paras.length - 1].trim())) foot = paras.pop().trim();
    const html = paras.map((p) => p.split('\n').map((line) => {
      const m = /^(Leader|People|All|Minister|Congregation):\s*(.*)$/.exec(line.trim());
      return m ? '<span class="who">' + esc(m[1]) + ':</span> ' + esc(m[2]) : esc(line);
    }).join('<br>')).join('<br><br>');
    return { kind: 'text', variant: 'plain', head: title, html, foot, cls: /Leader:|People:/.test(text) ? 'responsive' : '' };
  }
  const textCue = (id, title, sub, items) => ({
    id, tab: 'tools', title, sub, index: 0,
    deck: { kind: 'text', frames: items.map((x) => textFrame(x.title, x.text)) },
    labels: items.map((x, i) => (items.length > 1 ? String(i + 1) : x.title)),
  });
  const readingCue = (i) => textCue('tools:reading:' + i, RESPONSIVE[i].title, 'Responsive reading', [RESPONSIVE[i]]);
  const communionCue = () => textCue('tools:communion', 'Communion', 'Ordinance of Humility & Lord’s Supper', COMMUNION);

  /** Put a cue on the Next screen; `now` (double-click) also presents it. */
  function stage(cue, now) {
    ctx.setStaged('tools', cue);
    if (now) live.take(cue);
    else showToast(cue.title + (cue.deck.frames.length > 1 ? ' (slide ' + ((cue.index || 0) + 1) + ')' : '') + ' is Next. Press Present (F5).', 'ok', 2200);
  }
  /** A communion step: when the sequence is already on screen, go straight to that step. */
  function communionStep(i, now) {
    const c = communionCue();
    c.index = i;
    if (live.cue && live.cue.id === c.id) { live.go(i); ctx.setStaged('tools', c); return; }
    stage(c, now);
  }
  // Show which reading or step is Next (green) or on screen (red).
  const pickBtns = [];
  function markPicks() {
    const s = live.staged, c = live.cue;
    pickBtns.forEach(({ b, id, i }) => {
      const isNext = !!s && s.id === id && (i == null || (s.index || 0) === i);
      const isLive = !!c && c.id === id && (i == null || live.index === i);
      b.setAttribute('aria-pressed', String(isNext));
      b.classList.toggle('live-on', isLive);
    });
  }
  function pickBtn(label, id, i, onPick) {
    const b = h('button.btn', { type: 'button', title: 'Click: put on Next. Double-click: show now.', onclick: () => onPick(false), ondblclick: () => onPick(true) }, label);
    pickBtns.push({ b, id, i });
    return b;
  }

  const KIND_LABEL = { scripture: 'Scripture', hymn: 'Hymn', speaker: 'Speaker', offering: 'Offering', custom: '' };
  /** Projector: the lower-third text as a slide on the Next screen. */
  function stageLower() {
    const text = lowerText.value.trim();
    if (!text) { showToast('Type the lower-third text first.', 'err'); return; }
    stage(textCue('tools:lower:' + text, text, 'Lower third', [{ title: KIND_LABEL[lowerKind.value] || '', text }]), false);
  }
  // Captions go on the display's caption line, over whatever is on screen (they never replace a slide).
  // Starting them is the operator's explicit choice, so they show straight away.
  const capPreview = h('p.note', { style: { marginTop: '8px', minHeight: '1.4em' } }, '');
  const capBtn = h('button.btn', { type: 'button', onclick: () => toggleCaptions() });
  function paintCapBtn() { capBtn.replaceChildren(icon('mic'), h('span', captionRec ? 'Stop captions' : 'Start captions on screen')); capBtn.setAttribute('aria-pressed', String(!!captionRec)); }
  function stopCaptions(msg) {
    const r = captionRec; captionRec = null;
    if (r) { r.onend = null; try { r.stop(); } catch (e) { /* */ } }
    live.caption('');
    capPreview.textContent = '';
    paintCapBtn();
    if (msg) showToast(msg, msg === 'Captions stopped.' ? '' : 'err');
  }
  function toggleCaptions() {
    if (captionRec) { stopCaptions('Captions stopped.'); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showToast('Speech recognition is not available in this browser (use Chrome or Edge).', 'err'); return; }
    const rec = new SR();
    captionRec = rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let txt = '';
      for (let i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript;
      txt = txt.trim().slice(-160); // one or two lines at the bottom of the screen
      if (txt) { live.caption(txt); capPreview.textContent = txt; }
    };
    rec.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') stopCaptions('Captions stopped: ' + (e.error || 'error') + '.'); };
    // Keep listening after pauses in speech, but never spin: more than 6 restarts in 15 s means the
    // browser cannot listen here (no microphone, no connection), so stop and say so.
    const restarts = [];
    rec.onend = () => {
      if (captionRec !== rec) return;
      const now = Date.now();
      restarts.push(now);
      while (restarts.length && now - restarts[0] > 15000) restarts.shift();
      if (restarts.length > 6) { stopCaptions('Captions stopped: the browser keeps stopping the microphone. Check the microphone and the internet connection.'); return; }
      setTimeout(() => { if (captionRec === rec) { try { rec.start(); } catch (e) { stopCaptions('Captions stopped.'); } } }, 250);
    };
    try { rec.start(); } catch (e) { stopCaptions('Captions could not start: ' + e.message); return; }
    paintCapBtn();
    showToast('Captions are on the screen’s caption line (experimental).', 'ok');
  }
  paintCapBtn();

  const el = h('section.tools-service',
    h('div.scroll', { style: { flex: '1', padding: '8px 4px' } },
      h('div.card', { style: { marginBottom: '12px', padding: '12px', border: '1px solid var(--line)', borderRadius: '10px' } },
        h('h3', { style: { margin: '0 0 8px' } }, 'Lower third on the projector'),
        h('div.row', { style: { gap: '8px', marginBottom: '8px' } }, lowerKind, lowerText),
        h('div.row.wrap', btn('next', 'Set as Next', stageLower, { label: true, cls: 'primary' })),
        h('p.note', 'Set as Next puts the text on the green Next screen for the projector; Present (F5) shows it. Names and announcements for the live stream are under Stream.')),
      h('div.card', { style: { marginBottom: '12px', padding: '12px', border: '1px solid var(--line)', borderRadius: '10px' } },
        h('h3', { style: { margin: '0 0 8px' } }, 'Responsive readings'),
        h('p.note', { style: { marginBottom: '8px' } }, 'Click to put a reading on the green Next screen, then Present (F5). Double-click to show it at once.'),
        h('div.col', { style: { gap: '6px' } },
          ...RESPONSIVE.map((r, i) => pickBtn(r.title, 'tools:reading:' + i, null, (now) => stage(readingCue(i), now))))),
      h('div.card', { style: { marginBottom: '12px', padding: '12px', border: '1px solid var(--line)', borderRadius: '10px' } },
        h('h3', { style: { margin: '0 0 8px' } }, 'Communion / Ordinance of Humility'),
        h('p.note', { style: { marginBottom: '8px' } }, 'The four slides go on Next as one sequence: Present (F5), then → / Next for each step. While it is on screen, clicking a step shows that step.'),
        h('div.col', { style: { gap: '6px' } },
          ...COMMUNION.map((c, i) => pickBtn((i + 1) + '. ' + c.title, 'tools:communion', i, (now) => communionStep(i, now))))),
      h('div.card', { style: { marginBottom: '12px', padding: '12px', border: '1px solid var(--line)', borderRadius: '10px' } },
        h('h3', { style: { margin: '0 0 8px' } }, 'Offering & tithe'),
        h('p.note', 'Offering banners (with a verse and a QR code for online giving) are made in Banners.'),
        h('button.btn', { type: 'button', style: { marginTop: '8px' }, onclick: () => ctx.showTab('ai') }, icon('banner'), h('span', 'Open Banners'))),
      h('div.card', { style: { padding: '12px', border: '1px solid var(--line)', borderRadius: '10px' } },
        h('h3', { style: { margin: '0 0 8px' } }, 'Live captions (experimental)'),
        h('p.note', 'Uses the browser’s speech recognition (needs internet in Chrome/Edge). The words appear on the caption line at the bottom of the screen, over whatever is showing. Full multi-language translation remains planned.'),
        capBtn, capPreview)
    ));

  live.on('live', markPicks);
  live.on('staged', markPicks);
  live.on('go', markPicks);

  return {
    el,
    open() { return null; },
  };
}

// ------------------------------------------------------------ the Tools tab: three parts
//   Service – readings, communion, the projector lower third, captions
//   Stage   – the second screen for the platform: messages, timers, phones & laptops (stage.js)
//   Stream  – OBS: lower thirds, presentation output, scene switching (stream.js)
// Each part keeps its own content; only the part that is open is shown. Stage and Stream are built the first
// time they are opened.
const PARTS = [
  ['service', 'grid', 'Service', 'Readings, communion, projector lower third, captions'],
  ['stage', 'stage', 'Stage', 'Second screen for the platform: messages, timers, phones & laptops'],
  ['stream', 'live', 'Stream', 'OBS live stream: lower thirds, slides, scene switching'],
];
export default function create(ctx) {
  const makers = { service: createService, stage: createStage, stream: createStream };
  const parts = {};
  let part = PARTS.some((p) => p[0] === ctx.settings.v.app.toolsPart) ? ctx.settings.v.app.toolsPart : 'service';
  const seg = h('div.seg.tools-seg', { role: 'group', 'aria-label': 'Tools' });
  const host = h('div.tools-parts');
  const el = h('section.tools',
    h('div.toolbar.tools-bar', h('h2', 'Tools'), seg, h('div.grow'), h('span.note.hide-sm.tools-hint')),
    host);
  const hint = el.querySelector('.tools-hint');
  function get(k) {
    if (!parts[k]) {
      const api = makers[k](ctx);
      api.el.classList.add('tools-part', 'tools-part-' + k);
      api.el.hidden = true;
      host.append(api.el);
      parts[k] = api;
    }
    return parts[k];
  }
  function paintSeg() {
    seg.replaceChildren(...PARTS.map(([k, ic, label, title]) => h('button', { type: 'button', title, 'aria-pressed': String(k === part), onclick: () => show(k) }, icon(ic), h('span', label))));
    const p = PARTS.find((x) => x[0] === part);
    hint.textContent = p ? p[3] : '';
  }
  function show(k) {
    if (!makers[k]) k = 'service';
    const prev = parts[part];
    if (prev && part !== k) { prev.el.hidden = true; if (prev.onHide) prev.onHide(); }
    part = k;
    ctx.settings.set('app.toolsPart', k);
    const api = get(k);
    api.el.hidden = false;
    paintSeg();
    if (visible && api.onShow) api.onShow();
    return api;
  }
  let visible = false;
  show(part);
  return {
    el,
    /** Open one part (also used for the old tab names "stage" and "stream"); returns that part. */
    show(k) { return show(k === 'tools' ? 'service' : k); },
    onShow() { visible = true; const api = get(part); if (api.onShow) api.onShow(); },
    onHide() { visible = false; const api = parts[part]; if (api && api.onHide) api.onHide(); },
    open() { return null; },
  };
}
