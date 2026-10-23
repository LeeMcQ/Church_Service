// "AI full banner": the second online picture maker in Banners. Instead of a plain background (the first
// maker; the words are then drawn sharp on top by the app), this one asks the AI for ONE finished banner
// picture that already contains all the words the person gave, built around pictures they attach (a photo
// of the church, a logo, a gallery picture). AI can misspell, so the result is always shown first and can be
// remade; the giving QR code is never drawn by AI (the app adds the real one on top).
import { h, clear } from '../core/util.js';
import { icon } from '../core/icons.js';
import { modal, closeModal, toast } from '../core/ui.js';
import * as ai from '../core/ai.js';

export function promptFor(v) {
  const bits = [];
  if (v.church) bits.push('Church name: "' + v.church + '"');
  if (v.heading) bits.push('Heading: "' + v.heading + '"');
  if (v.message) bits.push('Message: "' + v.message + '"');
  if (v.foot) bits.push('Bottom line: "' + v.foot + '"');
  if (v.extra) bits.push('Also include: ' + v.extra);
  return 'Design one complete, finished wide 16:9 landscape banner picture to be shown on a church projector screen (Seventh-day Adventist church). ' +
    'Put exactly this text in the picture, large, centred or well placed, spelled exactly as written, in a clear easy-to-read style with strong contrast against the background:\n' +
    bits.join('\n') + '\n' +
    'Do not add any other words, letters, numbers, logos or watermarks, and do not draw a QR code. Keep every word well inside the edges (a safe margin all round). ' +
    'Style and mood: ' + (v.style || 'warm, reverent and uplifting, soft natural light') + '. ' +
    (v.nPics ? 'Use the ' + v.nPics + ' attached picture' + (v.nPics === 1 ? '' : 's') + ' as part of the design (for example as a framed photo or as the main background), keeping ' + (v.nPics === 1 ? 'it' : 'them') + ' recognisable and unchanged, and make the text and picture work together. ' : '');
}

/**
 * opts: { fields:{church,heading,message,foot,style}, files:()=>Promise<[{id,name,thumb,blob}]>, logo:()=>Promise<Blob|null>,
 *         storePicture(blob,name)->id, onUse(id) }
 */
export function openFullBanner(opts) {
  const f = opts.fields || {};
  const inp = (label, val, ph, rows) => {
    const el = rows ? h('textarea.field', { rows, placeholder: ph || '', 'aria-label': label }) : h('input.field', { placeholder: ph || '', 'aria-label': label, style: { width: '100%' } });
    el.value = val || '';
    return el;
  };
  const church = inp('Church name', f.church, 'Church name');
  const heading = inp('Heading', f.heading, 'The main words, e.g. Happy Sabbath');
  const message = inp('Message', f.message, 'Optional message', 3);
  const foot = inp('Bottom line', f.foot, 'Optional: place, time, date, contact');
  const extra = inp('Anything else', '', 'Optional: e.g. “a Bible verse reference”, “children’s programme at 10:00”');
  const style = inp('Style', f.style, 'e.g. sunrise over a green valley, warm gold and blue', 2);
  const picked = new Set();
  let useLogo = false, logoBlob = null;
  const gal = h('div.bn-gallery');
  const attachNote = h('p.note', '');
  const result = h('div.fb-result', { hidden: true });
  const MAX = 4;

  function paintGallery(files) {
    clear(gal);
    files.forEach((fl) => {
      const u = URL.createObjectURL(fl.thumb || fl.blob);
      gal.appendChild(h('div.bn-pic-wrap', h('button.bn-pic', { type: 'button', title: 'Include ' + (fl.name || 'this picture'), 'aria-pressed': String(picked.has(fl.id)),
        onclick: (e) => {
          if (picked.has(fl.id)) picked.delete(fl.id);
          else if (picked.size + (useLogo ? 1 : 0) >= MAX) { toast('Up to ' + MAX + ' pictures can be included.', '', 3000); return; }
          else picked.add(fl.id);
          e.currentTarget.setAttribute('aria-pressed', String(picked.has(fl.id)));
        } }, h('img', { src: u, alt: fl.name || 'Picture', onload: () => setTimeout(() => URL.revokeObjectURL(u), 1000) }))));
    });
    if (!files.length) gal.appendChild(h('p.note', 'No pictures yet. Choose some from this device.'));
  }
  let filesCache = [];
  const refreshFiles = async () => { filesCache = await opts.files().catch(() => []); paintGallery(filesCache); };
  const chooser = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async () => {
    const list = Array.from(chooser.files || []); chooser.value = '';
    for (const file of list.slice(0, 6)) {
      try { const id = await opts.storePicture(file, file.name); if (picked.size < MAX) picked.add(id); } catch (e) { toast('Could not use ' + file.name + ': ' + e.message, 'err'); }
    }
    await refreshFiles();
  } });
  const logoChip = h('button.chip', { type: 'button', 'aria-pressed': 'false', title: 'Include the church logo from Settings → Screen', hidden: true, onclick: () => {
    if (!useLogo && picked.size >= MAX) { toast('Up to ' + MAX + ' pictures can be included.', '', 3000); return; }
    useLogo = !useLogo; logoChip.setAttribute('aria-pressed', String(useLogo));
  } }, 'Church logo');
  Promise.resolve(opts.logo ? opts.logo() : null).then((b) => { if (b) { logoBlob = b; logoChip.hidden = false; } }).catch(() => {});
  refreshFiles();

  const canPics = ai.canAttach();
  attachNote.textContent = canPics
    ? 'Pick up to ' + MAX + ' pictures for the AI to build into the banner (a photo of the church, people, a scene). They are sent to ' + ai.providerName() + ' only when you press Make.'
    : ai.providerName() + ' cannot take attached pictures, so the banner will be made from your words and style only. OpenAI (gpt-image) and Google Gemini can use your pictures: change this in Settings → AI.';

  const goBtn = h('button.btn.primary', { type: 'button' }, icon('sparkle'), h('span', 'Make banner picture'));
  let lastBlob = null, lastUrl = '';
  async function make() {
    const vals = { church: church.value.trim(), heading: heading.value.trim(), message: message.value.trim(), foot: foot.value.trim(), extra: extra.value.trim(), style: style.value.trim() };
    if (!vals.heading && !vals.message && !vals.church) { toast('Add at least a heading, message or church name.', 'err'); return; }
    const flags = ai.flaggedWords(Object.values(vals).join(' '));
    if (flags.length) { toast('Please check the words (“' + flags.join('”, “') + '”) are suitable for church.', 'err', 5000); return; }
    const refs = [];
    if (canPics) {
      for (const id of picked) { const fl = filesCache.find((x) => x.id === id); if (fl && fl.blob) refs.push(fl.blob); }
      if (useLogo && logoBlob) refs.push(logoBlob);
    }
    vals.nPics = refs.length;
    goBtn.disabled = true; const lbl = goBtn.lastChild.textContent; goBtn.lastChild.textContent = 'Making… this can take up to a minute';
    try {
      const blob = await ai.aiImage(promptFor(vals), refs);
      lastBlob = blob;
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(blob);
      clear(result); result.hidden = false;
      result.append(
        h('img.fb-img', { src: lastUrl, alt: 'The AI banner', style: { width: '100%', borderRadius: '8px', border: '1px solid var(--line)' } }),
        h('p.note', 'Read every word carefully: AI sometimes misspells. If anything is wrong, press Make again, or simplify the words.'),
        h('div.row.wrap',
          h('button.btn.primary', { type: 'button', onclick: async () => {
            try { const id = await opts.storePicture(lastBlob, 'AI banner ' + new Date().toLocaleDateString()); closeModal(); opts.onUse(id); }
            catch (e) { toast('Could not keep the picture: ' + e.message, 'err'); }
          } }, icon('check'), h('span', 'Use this banner')),
          h('button.btn', { type: 'button', onclick: make }, icon('sparkle'), h('span', 'Make another'))));
      result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (e) { toast(ai.friendlyAiError(e), 'err', 9000); }
    finally { goBtn.disabled = false; goBtn.lastChild.textContent = lbl; }
  }
  goBtn.onclick = make;

  modal({
    title: 'AI full banner', wide: true,
    body: h('div.col', { style: { gap: '8px' } },
      h('p.note', 'One finished picture with all your words built in, made with online AI (' + ai.providerName() + '). Everything below is filled in from your banner; change anything you like.'),
      h('div.form', h('label', 'Church name'), church, h('label', 'Heading'), heading, h('label', 'Message'), message, h('label', 'Bottom line'), foot,
        h('label', 'Anything else'), extra, h('label', 'Style'), style),
      h('h4', 'Pictures to include'), attachNote,
      h('div.row.wrap', h('button.btn.sm', { type: 'button', disabled: !canPics, onclick: () => chooser.click() }, icon('upload'), h('span', 'Choose pictures…')), logoChip, chooser),
      canPics ? gal : null,
      h('div.row.wrap', goBtn), result),
    actions: [{ label: 'Close' }],
  });
}
