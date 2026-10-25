// Settings: how the screen looks, displays, Bibles, the app itself, and what's coming next.
import { accountSection, openFeedback } from './account.js';
import { backupSection } from './backup-ui.js';
import { screensPanel } from './screens-panel.js';
import { h, clear, uid, fmtBytes, download, readText, scrubUrls, debounce } from '../core/util.js';
import { icon } from '../core/icons.js';
import { btn, seg, toggle, toast, confirmBox } from '../core/ui.js';
import { db, persistStorage } from '../core/db.js';
import { createStage } from '../core/render.js';
import { listTranslations, deleteImported, resetCaches } from '../core/bibledata.js';
const importBibleDialog = (cb) => import('./bible-import.js').then((m) => m.importBibleDialog(cb));
import { listScreens } from '../core/link.js';
import { sanitizeImportedSettings, exportableSettings } from '../core/settings.js';
import { churchForm } from './church-form.js';
import { PROVIDERS, listModels, modelFor, friendlyAiError } from '../core/ai.js';

export default function create(ctx) {
  const { settings, live, link } = ctx;
  const D = () => settings.v.display;
  const setD = (k) => (v) => settings.set('display.' + k, v);
  const el = h('section');
  const scroll = h('div.scroll.pad', { style: { flex: '1' } });
  const nav = h('div.row.wrap');
  el.append(h('div.toolbar', h('h2', 'Settings'), h('div.grow'), nav), scroll);

  const sections = [];
  const section = (id, title, build) => { sections.push({ id, title, build }); };

  // ------------------------------------------------------------ Screen
  section('screen', 'Screen', (box) => {
    const host = h('div.stage-host');
    const prev = h('div.screen', { style: { maxWidth: '560px', marginBottom: '14px' } }, host);
    const stage = createStage(host, { placeholderOnly: true });
    const sample = { kind: 'text', variant: 'bible', refPos: settings.v.bible.refPos,
      html: '<span class="v"><span class="vn">16</span>For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.</span>',
      foot: 'John 3:16', footR: 'KJV' };
    const redraw = async () => { stage.setAspect(link.aspect()); prev.style.aspectRatio = String(link.aspect()); const s = await live.buildStyle(); stage.applyStyle(s); stage.show(sample); };
    const off = settings.on('change:display', debounce(redraw, 120)); // colour pickers fire many changes
    box._cleanup = off;

    const imgPick = (key, label) => {
      const inp = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: async () => {
        const f = inp.files[0]; if (!f) return;
        const { prepareImage } = await import('../lib/pdf.js');
        const r = await prepareImage(f, { boxW: 1920, boxH: 1080, quality: 0.88 });
        const id = 'img-' + uid();
        await db.put('files', id, { id, kind: 'image', name: f.name, type: r.full.type, size: r.full.size, blob: r.full, added: Date.now() });
        const old = D()[key];
        settings.set('display.' + key, id);
        if (old) db.del('files', old);
        rebuild();
      } });
      return h('div.row', h('button.btn.sm', { type: 'button', onclick: () => inp.click() }, icon('upload'), D()[key] ? 'Change' : 'Choose…'),
        D()[key] ? h('button.btn.sm', { type: 'button', onclick: () => { const old = D()[key]; settings.set('display.' + key, null); db.del('files', old); rebuild(); } }, 'Remove') : null,
        h('span.note', label), inp);
    };
    const color = (k, label) => { const c = h('input', { type: 'color', value: D()[k], 'aria-label': label, style: { width: '56px', height: '34px', border: 0, background: 'none' }, oninput: () => setD(k)(c.value) }); c.value = D()[k]; return c; };
    const range = (k, min, max, step, fmt, label) => {
      const out = h('span.note', fmt(D()[k]));
      const r = h('input', { type: 'range', min, max, step, 'aria-label': label, style: { flex: '1', maxWidth: '260px' }, oninput: () => { out.textContent = fmt(+r.value); r.setAttribute('aria-valuetext', fmt(+r.value)); }, onchange: () => setD(k)(+r.value) });
      r.value = D()[k];
      return h('div.row', r, out);
    };
    box.append(prev, h('div.form',
      h('label', 'Font'), seg([['sans', 'Clear sans'], ['serif', 'Serif'], ['system', 'System']], D().font, setD('font')),
      h('label', 'Weight'), seg([['bold', 'Bold'], ['regular', 'Regular']], D().weight, setD('weight')),
      h('label', 'Text colour'), color('fg', 'Text colour'),
      h('label', 'Verse-number colour'), color('accent', 'Verse-number colour'),
      h('label', 'Background colour'), color('bg', 'Background colour'),
      h('label', 'Background picture'), imgPick('bgImage', 'Shown behind Bible and hymn text'),
      h('label', 'Darken picture'), range('bgDim', 0, 0.85, 0.05, (v) => Math.round(v * 100) + '%', 'Darken picture'),
      h('label', 'Text shadow'), toggle('Outline text so it reads on pictures', D().shadow, setD('shadow')),
      h('label', 'Alignment'), seg([['center', 'Centre'], ['left', 'Left']], D().align, setD('align')),
      h('label', 'Margin'), range('pad', 20, 200, 4, (v) => v + ' px', 'Margin'),
      h('label', 'Smallest text'), range('minFont', 36, 110, 2, (v) => v + ' px', 'Smallest text'),
      h('label', 'Largest text'), range('maxFont', 90, 240, 5, (v) => v + ' px', 'Largest text'),
      h('label', 'Changing slides'), seg([['fade', 'Fade'], ['cut', 'Cut']], D().transition, setD('transition')),
      h('label', 'Fade time'), range('fade', 100, 1000, 50, (v) => v + ' ms', 'Fade time'),
      h('label', 'Screen shape'), seg([['auto', 'Automatic'], ['16:9', '16:9'], ['16:10', '16:10'], ['4:3', '4:3']], D().aspect, setD('aspect')),
      h('label', 'Clear shows'), seg([['background', 'Background'], ['black', 'Black'], ['logo', 'Logo']], D().clearShows, setD('clearShows')),
      h('label', 'Logo picture'), imgPick('logo', 'Church logo for the Logo button'),
      h('label', 'Logo text'), (() => { const i = h('input.field', { value: D().logoText || '', 'aria-label': 'Logo text', placeholder: 'e.g. Malmesbury SDA Church', onchange: () => setD('logoText')(i.value) }); return i; })(),
    ), h('p.note', { style: { marginTop: '10px' } }, 'Text always grows to fill the screen. “Smallest text” decides when a passage is split over more slides.'));
    setTimeout(redraw, 30);
  });

  // ------------------------------------------------------------ Displays
  section('display', 'Displays', (box) => {
    const stateLine = h('p', link.kind ? (link.ready ? 'Presenting to ' : 'Connecting to ') + link.info.label + (link.info.w ? ' (' + link.info.w + ' × ' + link.info.h + ')' : '') : 'No display connected.');
    const screens = h('div.list');
    box.append(h('div.card', { style: { marginBottom: '14px' } }, h('h3', 'Screens: projectors and stage screens'), screensPanel()),
      stateLine,
      h('div.row.wrap', { style: { margin: '10px 0' } },
        h('button.btn', { type: 'button', onclick: () => link.openWindow({ prompt: true }) }, icon('present'), 'Open display window'),
        'getScreenDetails' in window ? h('button.btn', { type: 'button', onclick: async () => {
          const r = await listScreens();
          clear(screens);
          if (!r) { toast('Screen list not allowed. Allow “Window management” for this site.', 'err'); return; }
          r.screens.forEach((s, i) => screens.appendChild(h('button', { type: 'button', onclick: () => { settings.set('display.screenLabel', s.label || ''); link.openWindow({ prompt: true }); } },
            icon('pc'), h('span.grow', (s.label || 'Screen ' + (i + 1)) + (s === r.current ? ' (this one)' : '') + (settings.v.display.screenLabel === s.label ? '  ✓ default' : '')), h('span.faint', s.width + ' × ' + s.height))));
        } }, icon('pc'), 'Detect screens') : null,
        link.canCast() ? h('button.btn', { type: 'button', onclick: () => link.openCast().catch((e) => toast(e.message, 'err')) }, icon('cast'), 'Cast') : null,
        link.kind ? h('button.btn.danger', { type: 'button', onclick: () => { link.close(); rebuild(); } }, icon('x'), 'Close display') : null),
      screens,
      h('div.row', { style: { margin: '6px 0' } }, toggle('Keep the projector full screen', settings.v.display.keepFull !== false, (v) => {
        settings.set('display.keepFull', v);
        if (link.kind === 'window' && link.win) { try { link.win.postMessage({ t: 'keepfull', on: v }, location.origin); } catch (e) { /* */ } }
      }, 'If the projector window leaves full screen (Esc, a clicker button, another window), it goes back to full screen straight away or on your next click or key press here.')),
      h('p.note', 'Tip: in Chrome or Edge, allow “Window management” once and SDA Sabbath opens the display straight onto the projector every time. Click the projector screen once at the start so videos may play with sound (not needed once SDA Sabbath is installed).'));
    // Phone remote via the companion
    const comp = ctx.companion;
    const rc = h('div.card', h('h3', 'Phone remote and network displays'));
    if (comp) {
      const url = (comp.urls && comp.urls[0] || location.origin) + '/?remote=1' + (comp.pin_hint ? '' : '');
      rc.append(h('p.note', 'Scan with a phone on the church Wi-Fi to control the screen from the phone. PIN: ' + (comp.pin || 'shown in the companion window') + '.'));
      const qrBox = h('div.qr');
      import('../../vendor/qrcode.min.js').then((m) => {
        const q = m.default(0, 'M'); q.addData(url); q.make();
        qrBox.appendChild(h('img', { src: q.createDataURL(6, 0), alt: 'QR code for ' + url }));
      }).catch(() => {});
      rc.append(h('div.row.wrap', qrBox, h('div.col', h('code', url), h('p.note', 'TV or second PC as the screen: open ' + (comp.urls && comp.urls[0] || location.origin) + '/display.html?via=ws&pin=' + (comp.pin || 'PIN')))));
    } else {
      rc.append(h('p.note', 'Run the SDA Sabbath companion on the church PC to control the screen from a phone, use a smart-TV browser as the screen, play videos straight from the PC’s Videos folder, and convert PowerPoint files exactly. Then open SDA Sabbath from the address it shows. Anything in the PC’s Videos\\Selah folder can be opened by anyone on the same Wi-Fi who knows its file name, so keep private files out of it.'));
      rc.append(h('a.btn.primary', { href: 'companion.html', target: '_blank', rel: 'noopener' }, icon('download'), h('span', 'Download the companion')));
    }
    box.append(rc);
  });

  // ------------------------------------------------------------ Bibles & hymns
  section('bibles', 'Bibles & hymns', async (box) => {
    const list = h('div.list');
    box.append(h('div.row.wrap', { style: { marginBottom: '10px' } },
      h('button.btn.primary', { type: 'button', onclick: () => importBibleDialog(async () => { resetCaches(); rebuild(); }) }, icon('plus'), 'Add a Bible (NIV, Xhosa, …)'),
      h('button.btn', { type: 'button', onclick: async () => { const t = await ctx.tab('hymns'); await ctx.showTab('hymns'); toast('Use the ⋯ menu in Hymns to import, export or add hymns.'); return t; } }, icon('hymn'), 'Manage hymnbooks')),
    list,
    h('p.note', { style: { marginTop: '10px' } }, 'Built in: KJV and WEB (public domain) and the Afrikaans 1933/53 Bible. NIV and the 1975 Xhosa Bible are copyrighted, so each church adds its own licensed copy here; it is converted once and stays offline on this device.'));
    const ts = await listTranslations(true);
    ts.forEach((t) => list.appendChild(h('div.li', icon('bible'), h('span.grow', h('div', t.abbr + ' — ' + t.name), h('div.note', { builtin: 'Built in', private: 'Included with this installation', imported: 'Added on this device' }[t.src] + (t.license ? ' · ' + t.license : ''))),
      t.src === 'imported' ? btn('trash', 'Remove ' + t.abbr, async () => {
        if (await confirmBox('Remove ' + t.abbr + '?', 'Delete the offline copy of ' + t.name + ' from this device?', 'Remove', true)) { await deleteImported(t.id); rebuild(); }
      }, { cls: 'sm' }) : null)));
  });

  // ------------------------------------------------------------ App
  section('app', 'App', async (box) => {
    const A = settings.v.app;
    const lpNow = settings.lowPower();
    const storage = h('span.note', '…');
    const cache = h('span.note', 'Checking…');
    const onCache = (e) => { cache.textContent = e.detail.done >= e.detail.total ? 'Everything is stored for offline use.' : 'Downloading for offline use: ' + e.detail.done + ' / ' + e.detail.total + ' files'; };
    const onHealth = () => offlineStatus().then((t) => { cache.textContent = t; });
    window.addEventListener('selah-cache', onCache);
    window.addEventListener('selah-health', onHealth);
    box._cleanup = () => { window.removeEventListener('selah-cache', onCache); window.removeEventListener('selah-health', onHealth); };
    if (ctx.cacheProgress) onCache({ detail: ctx.cacheProgress });
    else offlineStatus().then((t) => { if (cache.textContent === 'Checking…') cache.textContent = t; });
    box.append(h('div.form',
      h('label', 'Colours'), seg([['dark', 'Dark'], ['light', 'Light'], ['auto', 'Follow device']], A.theme, (v) => settings.set('app.theme', v)),
      h('label', 'Tabs on the'), seg([['left', 'Left'], ['right', 'Right']], A.railSide, (v) => settings.set('app.railSide', v)),
      h('label', 'Next / Live monitors'), toggle('Show monitors', A.monitors !== false, (v) => settings.set('app.monitors', v)),
      h('label', 'Low-power mode'), seg([['auto', 'Automatic' + (A.lowPower == null ? (lpNow ? ' (on)' : ' (off)') : '')], ['on', 'On'], ['off', 'Off']], A.lowPower == null ? 'auto' : A.lowPower ? 'on' : 'off', (v) => settings.set('app.lowPower', v === 'auto' ? null : v === 'on')),
      h('label', ''), h('p.note', 'Low-power mode turns off fades and the live video thumbnail, renders slides at 1280 px and shares screens at 15 frames per second — for old PCs and 1–2 GB phones.'),
      h('label', 'Install'), ctx.installPrompt ? h('button.btn', { type: 'button', onclick: async () => { await ctx.promptInstall(); rebuild(); } }, icon('download'), 'Install SDA Sabbath') : h('span.note', window.matchMedia('(display-mode: standalone)').matches ? 'Installed.' : 'Use the browser menu → Install app / Add to Home screen.'),
      h('label', 'Offline'), h('div.col', { style: { gap: '6px' } }, cache,
        h('div.row.wrap', h('button.btn.sm', { type: 'button', onclick: () => { cache.textContent = 'Checking…'; if (!ctx.checkOffline || !ctx.checkOffline(true)) offlineStatus().then((t) => { cache.textContent = t; }); } }, icon('check'), 'Check & repair offline files'))),
      h('label', 'Storage'), h('div.row.wrap', storage, h('button.btn.sm', { type: 'button', onclick: async () => { const ok = await persistStorage(); toast(ok ? 'SDA Sabbath’s data is protected from automatic clean-up.' : 'The browser has not allowed it yet. Install SDA Sabbath first.', ok ? 'ok' : ''); } }, 'Protect data')),
      h('label', 'Backup'), h('div.row.wrap',
        h('button.btn.sm.primary', { type: 'button', onclick: () => { active = 'backup'; rebuild(); } }, icon('upload'), 'Back up or move to another device'),
        h('button.btn.sm', { type: 'button', onclick: importBackup, title: 'For the .json backups made by older versions' }, 'Import an old .json backup')),
      h('label', 'Update'), h('div.row.wrap',
        h('button.btn.sm', { type: 'button', onclick: hardUpdate }, icon('reload'), 'Update now'),
        h('button.btn.sm', { type: 'button', onclick: freshCopy }, 'Download a fresh copy'),
        h('span.note', 'Update downloads the new version completely before switching, so the app keeps working offline. A fresh copy is only for when something misbehaves.')),
      h('label', 'Reset'), h('button.btn.sm.danger', { type: 'button', onclick: async () => { if (await confirmBox('Reset settings?', 'Return all settings to their defaults? Bibles, slides, hymns and plans stay.', 'Reset', true)) { settings.reset(); rebuild(); } } }, 'Reset settings'),
      h('label', 'Version'), h('div.col',
        h('span.note', 'SDA Sabbath ' + ctx.VERSION),
        h('span.note', { style: { fontFamily: 'monospace', fontSize: '12px' } }, 'main ' + (ctx.BUILD || '—')))));
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      storage.textContent = fmtBytes(e.usage) + ' used of ' + fmtBytes(e.quota) + ' available';
    }
  });


  // ------------------------------------------------------------ Church
  section('church', 'Church', (box) => {
    box.append(h('p.note', { style: { marginBottom: '12px' } }, 'Used by Banners: the church name, the date and sunset time, the service countdown and the QR code for giving. Stored only on this device.'),
      churchForm(settings));
  });

  // ------------------------------------------------------------ AI providers
  section('ai', 'AI', (box) => {
    const A = settings.v.ai || {};
    const providerSel = h('select.field', { id: 'aiProvider', 'aria-label': 'AI provider',
      onchange: () => { settings.set('ai.provider', providerSel.value); settings.set('ai.model', ''); settings.set('ai.imageModel', ''); updateHint(); clear(models); clear(testOut); } });
    Object.keys(PROVIDERS).forEach((id) => {
      const p = PROVIDERS[id];
      providerSel.appendChild(h('option', { value: id }, p.name + (p.image ? ' · text + pictures' : ' · text only')));
    });
    providerSel.value = PROVIDERS[A.provider] ? A.provider : 'openai';

    const keyInp = h('input.field', {
      type: 'password', id: 'aiKey', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'AI API key',
      value: A.apiKey || '', placeholder: 'Paste API key', style: { width: '100%' },
      onchange: () => { settings.set('ai.apiKey', keyInp.value.trim()); clear(testOut); },
    });
    const showBtn = h('button.btn.sm', { type: 'button', onclick: () => {
      keyInp.type = keyInp.type === 'password' ? 'text' : 'password';
      showBtn.textContent = keyInp.type === 'password' ? 'Show' : 'Hide';
    } }, 'Show');
    const removeBtn = h('button.btn.sm', { type: 'button', 'aria-label': 'Remove API key from this device', onclick: () => {
      keyInp.value = ''; keyInp.type = 'password'; showBtn.textContent = 'Show';
      settings.set('ai.apiKey', '');
      clear(models); clear(testOut);
      toast('API key removed from this device.', 'ok');
    } }, 'Remove key');

    const hintEl = h('div.note', { style: { marginTop: '6px', lineHeight: '1.45' } });
    const usingEl = h('p.note', { style: { marginTop: '4px' } });
    function updateHint() {
      const p = PROVIDERS[providerSel.value] || PROVIDERS.openai;
      hintEl.innerHTML = p.hint;
      usingEl.textContent = 'Using: text ' + (modelFor('text') || '—') + (p.image ? ' · pictures ' + (modelFor('image') || 'chosen after Test key') : ' · no pictures');
    }
    updateHint();

    // Test the key and choose from the models it can really use (names change often).
    const testOut = h('div');
    const models = h('div.form', { style: { marginTop: '8px' } });
    const testBtn = h('button.btn', { type: 'button', onclick: async () => {
      settings.set('ai.apiKey', keyInp.value.trim());
      clear(testOut); clear(models);
      if (!keyInp.value.trim()) { testOut.appendChild(h('p.note.warn', 'Paste a key first.')); return; }
      testBtn.disabled = true; testOut.appendChild(h('p.note', 'Checking the key…'));
      try {
        const list = await listModels();
        clear(testOut);
        testOut.appendChild(h('p.note', { style: { color: 'var(--next)' } }, '✓ The key works: ' + list.text.length + ' text model' + (list.text.length === 1 ? '' : 's') +
          (PROVIDERS[providerSel.value].image ? ' and ' + list.image.length + ' picture model' + (list.image.length === 1 ? '' : 's') : '') + ' available.'));
        const pickSel = (kind, arr, label) => {
          const cur = (kind === 'image' ? settings.v.ai.imageModel : settings.v.ai.model) || '';
          const sel = h('select.field', { 'aria-label': label, style: { maxWidth: '100%' }, onchange: () => { settings.set(kind === 'image' ? 'ai.imageModel' : 'ai.model', sel.value); updateHint(); } },
            h('option', { value: '' }, 'Automatic (' + (arr[0] || 'default') + ')'),
            arr.slice(0, 80).map((m) => h('option', { value: m, selected: m === cur }, m)));
          return sel;
        };
        models.append(h('label', 'Text model'), pickSel('text', list.text, 'Text model'));
        if (PROVIDERS[providerSel.value].image) models.append(h('label', 'Picture model'), list.image.length ? pickSel('image', list.image, 'Picture model') : h('p.note', 'This key has no picture models.'));
        // Remember the best automatic choices so the first request does not need a retry.
        const auto = Object.assign({}, settings.v.ai.auto || {});
        auto[providerSel.value] = { text: list.text[0] || '', image: list.image[0] || '' };
        settings.set('ai.auto', auto);
        updateHint();
      } catch (e) { clear(testOut); testOut.appendChild(h('p.note.warn', friendlyAiError(e))); }
      finally { testBtn.disabled = false; }
    } }, icon('check'), h('span', 'Test key'));

    box.append(h('div.form',
      h('label', { for: 'aiProvider' }, 'Provider'), providerSel,
      hintEl,
      usingEl,
      h('label', { for: 'aiKey' }, 'API key'),
      h('div.row', { style: { gap: '8px', alignItems: 'center' } }, keyInp, showBtn, removeBtn),
      h('label', 'Check'), h('div.col', { style: { alignItems: 'flex-start' } }, testBtn, testOut),
      h('span'), models,
      h('label.switch', { title: 'The key is forgotten when this tab or window is closed' }, (() => {
        const c = h('input', { type: 'checkbox', checked: !!A.keySession, onchange: () => { settings.set('ai.keySession', c.checked); toast(c.checked ? 'The key is now kept only until this tab is closed. Paste it again next time.' : 'The key is saved on this device again.', 'ok', 4000); } });
        return c;
      })(), h('span', 'Forget the key when this window closes (recommended on a shared church computer)')),
      h('p.note', 'Stored only in this browser on this device, and never included in backups. Other pages on the same website address can read what a browser page stores, so use a key with a low spending limit, and press "Remove key" after the service on a shared computer.'),
      h('p.note', 'AI output can be wrong, and it can be doctrinally wrong. Read everything against Scripture before it goes on the screen. AI pictures are marked “AI-generated”.'),
      h('p.note', 'Privacy (POPIA): when you use an online AI button, what you typed (a topic, a picture description, or Bible text you asked it to summarise) is sent directly to the provider chosen above and handled under their terms. These providers are companies in the USA: OpenAI, Google, xAI, Together AI, OpenRouter and Anthropic. Do not type names, contact details or other personal information. Other online features send a request only when you use them: lyrics search (LRCLIB and Lyrics.ovh, outside South Africa), Bible downloads (bible.helloao.org and GitHub, USA) and YouTube videos you embed (youtube-nocookie.com, Google, USA). Everything else in SDA Sabbath works offline and sends nothing. The full notice is on the privacy page.')));
  });

  // ------------------------------------------------------------ Coming next
  section('next', 'Live translation', (box) => {
    box.append(h('div.card', h('h3', h('span', icon('translate'), ' Live translation — coming later')),
      h('p.note', 'The sermon will be heard through a microphone, turned into text and translated (for example English → Afrikaans or isiXhosa), and shown as a caption line at the bottom of the screen while Bible verses and hymns stay visible. The caption line is already built into the display; the speech and translation part will be added in a later version.'),
      h('label.switch', { title: 'Not available yet' }, h('input', { type: 'checkbox', disabled: true }), h('span', 'Show live captions (not available yet)'))));
  });

  // ------------------------------------------------------------ Account
  section('backup', 'Backup', (box) => backupSection(box));
  section('account', 'Account', (box) => accountSection(box, ctx));

  section('about', 'About', (box) => {
    // Version, build and the offline copy in use: what to quote when reporting a problem.
    const offline = h('span.mono', '…');
    fetch('asset-manifest.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
      .then((m) => { offline.textContent = m && m.version ? m.version : (ctx.offlineHealth && ctx.offlineHealth.version) || '—'; });
    box.append(h('div.ver-box',
      h('div', h('b', 'SDA Sabbath ' + ctx.VERSION)),
      h('div.note', 'Build ', h('span.mono', ctx.BUILD || '—'), ' · Offline copy ', offline),
      h('button.btn.sm', { type: 'button', title: 'Copy the version details, e.g. for a problem report', onclick: () => {
        const t = 'SDA Sabbath ' + ctx.VERSION + ' · build ' + (ctx.BUILD || '—') + ' · offline ' + offline.textContent + ' · ' + location.host + location.pathname + ' · ' + navigator.userAgent;
        if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast('Version details copied.', 'ok'), () => {});
      } }, icon('copy'), h('span', 'Copy version details'))));
    box.append(h('div.row.wrap', { style: { margin: '10px 0' } },
      h('button.btn', { type: 'button', onclick: () => openFeedback(ctx) }, icon('msg'), h('span', 'Comments and suggestions')),
      h('button.btn', { type: 'button', onclick: () => ctx.openWelcome && ctx.openWelcome() }, icon('reload'), h('span', 'Run the setup again'))));
    box.append(h('p', 'SDA Sabbath — a free, offline church presenter made for Seventh-day Adventist media teams.'),
      h('p.note', { style: { marginTop: '8px' } }, 'Bibles: KJV (public domain), World English Bible (public domain), Afrikaanse Bybel 1933/53. Fonts: Atkinson Hyperlegible Next and Source Serif 4 (SIL Open Font License). PDF rendering: pdf.js (Apache 2.0). ZIP reading: fflate (MIT). QR codes: qrcode-generator (MIT). Stage link: Trystero and noble-secp256k1 (MIT). Sample hymn words are in the public domain.'),
      h('p.note', { style: { marginTop: '8px' } }, h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy notice'), ' · ', h('a', { href: 'terms.html', target: '_blank', rel: 'noopener' }, 'Terms of use'), ' · ', h('a', { href: 'vendor/VERSIONS.md', target: '_blank', rel: 'noopener' }, 'Third-party code')),
      h('p.note', { style: { marginTop: '8px' } }, 'Hymn music: the church\'s own MIDI recordings, played by SpessaSynth (Apache 2.0) with the GeneralUser GS 2.0.3 SoundFont by S. Christian Collins (free to use; schristiancollins.com), using the reverb and chorus levels the author recommends.'));
  });

  /** Is there real internet? (sw.js is never stored offline, so only the server can answer.) */
  async function reallyOnline() {
    if (!navigator.onLine) return false;
    try { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000); const r = await fetch('sw.js?ping=' + Date.now(), { cache: 'no-store', signal: ctl.signal }); clearTimeout(t); return r.ok; } catch (e) { return false; }
  }
  // Updating never throws the offline copy away first: the new version is downloaded completely while the
  // old one keeps working, and only then does it take over.
  async function hardUpdate() {
    if (!(await reallyOnline())) { toast('No internet right now. SDA Sabbath keeps working offline; update when connected.', 'err', 6000); return; }
    toast('Looking for an update…', '', 3000);
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (!reg) { location.reload(); return; }
      await reg.update();
      const w = reg.installing || reg.waiting;
      if (w) {
        toast('Downloading the update… the app restarts by itself when it is complete.', 'ok', 8000);
        const go = () => { if (reg.waiting) reg.waiting.postMessage({ t: 'skip' }); };
        if (reg.waiting) go(); else w.addEventListener('statechange', () => { if (w.state === 'installed') go(); else if (w.state === 'redundant') toast('The update could not be downloaded completely. The current version stays; try again later.', 'err', 8000); });
        return;
      }
      if (ctx.checkOffline) ctx.checkOffline(true);
      toast('You have the latest version. Stored files checked.', 'ok', 4000);
    } catch (e) { toast('Could not update now: ' + (e.message || e) + '. The current version keeps working.', 'err', 6000); }
  }
  async function freshCopy() {
    if (!(await reallyOnline())) { toast('No internet: the offline copy is kept. Connect first.', 'err', 6000); return; }
    if (!(await confirmBox('Download a fresh copy?', 'Only if the app misbehaves: this removes the stored app files and downloads them again (about 24 MB). Your plans, hymns, banners and settings stay. Keep the internet on until it finishes.', 'Download again', true))) return;
    try {
      // Only this app's worker and files: another app on the same site keeps its own offline copy.
      const regs = 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).filter((r) => location.href.indexOf(r.scope) === 0) : [];
      const mine = 'selah-' + (regs[0] ? new URL(regs[0].scope).pathname : location.pathname.replace(/[^/]*$/, '')) + '|';
      await Promise.all(regs.map((r) => r.unregister()));
      if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.filter((k) => k.startsWith(mine)).map((k) => caches.delete(k))); }
    } catch (e) { console.warn('fresh copy', e); }
    const u = new URL(location.href); u.searchParams.set('v', Date.now()); location.replace(u.href);
  }

  async function offlineStatus() {
    try {
      if (!('serviceWorker' in navigator) || !window.isSecureContext) return 'Offline use needs https:// or the SDA Sabbath companion.';
      if (!navigator.serviceWorker.controller || !window.caches) return 'Not stored yet — keep this page open for a minute, or install SDA Sabbath.';
      const hh = ctx.offlineHealth;
      if (hh && hh.total) return hh.missingCount ? 'Stored for offline use: ' + hh.have + ' of ' + hh.total + ' files. ' + (navigator.onLine ? 'Fetching the rest…' : 'Connect to the internet once to finish.') : 'Everything is stored for offline use (' + hh.total + ' files).';
      const man = await (await fetch('asset-manifest.json', { cache: 'no-store' })).json();
      const reg = await navigator.serviceWorker.getRegistration();
      const c = await caches.open('selah-' + new URL(reg ? reg.scope : location.href).pathname.replace(/[^/]*$/, '') + '|' + man.version);
      const have = (await c.keys()).length;
      return have >= man.files.length ? 'Everything is stored for offline use (' + fmtBytes(man.bytes) + ').' : 'Stored for offline use: ' + have + ' / ' + man.files.length + ' files.';
    } catch (e) { return navigator.serviceWorker && navigator.serviceWorker.controller ? 'Stored for offline use.' : ''; }
  }

  async function exportBackup() {
    const data = { app: 'selah', version: 1, settings: exportableSettings(settings.v), plans: await db.all('plans'), hymnbooks: await db.all('hymnbooks') };
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'sda-sabbath-backup.json');
  }
  function importBackup() {
    const inp = h('input', { type: 'file', accept: '.json' });
    inp.onchange = async () => {
      try {
        const d = JSON.parse(await readText(inp.files[0]));
        if (!d || typeof d !== 'object' || d.app !== 'selah') throw new Error('Not an SDA Sabbath backup.');
        if (d.settings && typeof d.settings === 'object') {
          // keep this device's AI key; never take one from a file
          const clean = sanitizeImportedSettings(d.settings);
          clean.ai = Object.assign({}, clean.ai || {}, { apiKey: (settings.v.ai && settings.v.ai.apiKey) || '' });
          localStorage.setItem('selah.settings.v1', JSON.stringify(clean));
        }
        const okId = (x) => x && typeof x === 'object' && (typeof x.id === 'string' || typeof x.id === 'number');
        for (const p of (Array.isArray(d.plans) ? d.plans : []).filter(okId)) await db.put('plans', p.id, scrubUrls(p));
        for (const b of (Array.isArray(d.hymnbooks) ? d.hymnbooks : []).filter(okId)) await db.put('hymnbooks', b.id, scrubUrls(b));
        toast('Backup restored. Reloading…', 'ok'); setTimeout(() => location.reload(), 800);
      } catch (e) { toast(e.message, 'err'); }
    };
    inp.click();
  }

  let active = 'screen';
  let curBox = null;
  async function rebuild() {
    if (curBox && curBox._cleanup) curBox._cleanup();
    clear(nav); clear(scroll);
    sections.forEach((s) => nav.appendChild(h('button.chip', { type: 'button', 'aria-pressed': String(s.id === active), onclick: () => { active = s.id; rebuild(); } }, s.title)));
    const sec = sections.find((s) => s.id === active);
    curBox = h('div', { style: { maxWidth: '920px' } });
    scroll.appendChild(curBox);
    await sec.build(curBox);
  }
  link.on('state', () => { if (active === 'display' && !el.hidden) rebuild(); });

  return { el, onShow: rebuild, onHide() { if (curBox && curBox._cleanup) curBox._cleanup(); }, open() { return null; } };
}
