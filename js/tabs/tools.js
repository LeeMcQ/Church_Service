// Service tools: lower thirds, responsive readings, communion sequence, streaming overlay, captions
// (the stage screen, timers and stage messages are in the Stage tab).
// Like every other tab, slides from here go to the green Next screen first; Present shows them.
// Children's story templates intentionally omitted.
import { h, esc } from '../core/util.js';
import { icon } from '../core/icons.js';
import { btn } from '../core/ui.js';

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

export default function create(ctx) {
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
  /** Streaming: the lower third on the OBS overlay (Stream tab), not the projector. */
  function showLowerOnStream() {
    const text = lowerText.value.trim();
    if (!text) { showToast('Type the lower-third text first.', 'err'); return; }
    const kind = lowerKind.value;
    ctx.stage.showLower(kind === 'speaker' ? { title: text, text: '', kind: 'name' } : { title: KIND_LABEL[kind] || '', text, kind: 'text' });
    showToast(ctx.stage.obsOutputs().length ? 'Shown on the stream.' : 'Shown on the stream overlay. Set up OBS in the Stream tab to see it there.', 'ok', 3500);
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

  const el = h('section',
    h('div.toolbar', h('h2', 'Service tools'), h('div.grow')),
    h('div.scroll', { style: { flex: '1', padding: '8px 4px' } },
      h('div.card', { style: { marginBottom: '12px', padding: '12px', border: '1px solid var(--line)', borderRadius: '10px' } },
        h('h3', { style: { margin: '0 0 8px' } }, 'Stage screen, timers and messages'),
        h('p.note', 'The second screen for the people on the platform — the slide on screen and what comes next, speaker notes, the time, speaker timers and your messages — on a stage monitor, a cast TV, or their own phones and laptops (QR code). Everything is in the Stage tab.'),
        h('div.row.wrap', { style: { marginTop: '8px' } },
          btn('present', 'Open stage screen', () => ctx.stage && ctx.stage.openWindow(), { label: true, cls: 'primary' }),
          btn('stage', 'Stage tab', () => ctx.showTab('stage'), { label: true }))),
      h('div.card', { style: { marginBottom: '12px', padding: '12px', border: '1px solid var(--line)', borderRadius: '10px' } },
        h('h3', { style: { margin: '0 0 8px' } }, 'Lower third / overlay'),
        h('div.row', { style: { gap: '8px', marginBottom: '8px' } }, lowerKind, lowerText),
        h('div.row.wrap', btn('next', 'Set as Next', stageLower, { label: true, cls: 'primary' }),
          btn('link', 'Show on stream overlay', showLowerOnStream, { label: true }),
          btn('x', 'Hide on stream', () => ctx.stage.hideLower(), { label: true })),
        h('p.note', 'Set as Next puts the text on the green Next screen for the projector; Present (F5) shows it. Show on stream puts it on the OBS lower third only (Stream tab).')),
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
      h('div.card', { style: { marginBottom: '12px', padding: '12px', border: '1px solid var(--line)', borderRadius: '10px' } },
        h('h3', { style: { margin: '0 0 8px' } }, 'Live stream (OBS)'),
        h('p.note', 'Lower thirds with Bible verses and hymn words, names, a ticker, the slides for a presentation scene, and one-click OBS set-up are in the Stream tab.'),
        btn('live', 'Stream tab', () => ctx.showTab('stream'), { label: true })),
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
