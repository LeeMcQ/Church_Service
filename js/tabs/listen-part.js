// Tools → Listen: switch the verse and hymn suggestions on and off (js/listen.js does the listening).
// The suggestions themselves appear beside Next / Live (on phones above the tabs), where the operator looks.
import { h, clear } from '../core/util.js';
import { icon } from '../core/icons.js';

export default function create(ctx) {
  const L = ctx.listener;
  const card = (title, ...kids) => h('div.card.st-card', h('h3', title), ...kids);

  const status = h('div.ls-status');
  const toggleBtn = h('button.btn.primary.ls-toggle', { type: 'button', onclick: () => L && L.toggle() });
  function paint() {
    clear(status); clear(toggleBtn);
    if (!L || !L.supported) {
      status.append(h('span.ls-off-dot'), h('b', 'Not available in this browser'));
      toggleBtn.disabled = true;
      toggleBtn.append(icon('mic'), h('span', 'Start listening'));
      return;
    }
    status.append(h('span' + (L.on ? '.ls-dot' : '.ls-off-dot')), h('b', L.on ? 'Listening' : 'Off'),
      h('span.note', L.on ? (L.problem || 'Suggestions appear under Black / Logo / Clear (on phones, above the tabs).') : 'Nothing is heard while it is off.'));
    toggleBtn.classList.toggle('primary', !L.on);
    toggleBtn.append(icon(L.on ? 'stop' : 'mic'), h('span', L.on ? 'Stop listening' : 'Start listening'));
  }

  const main = card('Listen for verses & hymns',
    h('p.note', 'Listens through the microphone. When a Bible verse or a hymn is mentioned, it is offered as a card with Put on Next and Present. While a hymn is on the screen it follows the singing and offers the stanza being sung. Nothing goes on the screen by itself.'),
    status,
    h('div.row', toggleBtn),
    h('p.note', 'Needs Chrome or Edge, the internet (the browser’s own speech service turns speech into text) and permission to use the microphone. Language: English, or Afrikaans when your main Bible is Afrikaans (Settings → Bible).'));

  const ex = (said, gets) => h('li', h('span.ls-said', '“' + said + '”'), h('span.note', ' → ' + gets));
  const examples = card('What it listens for',
    h('ul.ls-examples',
      ex('as it says in John chapter three verse sixteen', 'John 3:16'),
      ex('turn with me to Romans 8 28', 'Romans 8:28'),
      ex('Johannes drie vers sestien', 'Johannes 3:16'),
      ex('let us sing hymn number one hundred', 'Hymn 100'),
      ex('please turn to number 73 in your hymnal', 'Hymn 73'),
      ex('let us stand and sing Great Is Thy Faithfulness', 'Hymn 100, by its name'),
      ex('(the congregation sings the third stanza)', 'Being sung now: Verse 3')));

  const el = h('section.listen-tab',
    h('div.toolbar', h('h2', 'Listen'), h('span.note.hide-sm', 'Verse and hymn suggestions while the service runs'), h('div.grow')),
    h('div.scroll.st-grid', h('div.st-col', main), h('div.st-col', examples)));

  if (L && L.onChange) L.onChange(paint);
  paint();
  return { el, onShow: paint, open() { return null; } };
}
