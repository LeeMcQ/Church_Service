// Settings: small, synchronous, stored in localStorage.
import { emitter, lowPowerDevice } from './util.js';
import { lsKey } from './storens.js';

// Named after this app's address folder, so another app on the same website never shares them (see storens.js).
const KEY = lsKey('settings.v1');
const AIKEY = lsKey('aikey.session');

export const DEFAULTS = {
  app: { theme: 'dark', railSide: 'left', monitors: true, lowPower: null, lastTab: 'bible', clickerKeys: true, webPart: 'web', toolsPart: 'stage', stats: false, setupDone: false, deviceRole: '', speakers: '' },
  display: {
    font: 'sans', fg: '#ffffff', bg: '#000000', accent: '#f2cf7a', shadow: true, align: 'center',
    pad: 96, minFont: 58, maxFont: 150, fade: 250, transition: 'fade', aspect: 'auto',
    hymnSize: 'large', // hymn words on the projector: 'normal' (capped at 110 px of 150), 'large' (130), 'largest' (150)
    bgImage: null, bgDim: 0.45, logo: null, logoText: '', clearShows: 'background', weight: 'bold',
    keepFull: true, // put the projector window back in full screen whenever it drops out
    screenLabel: '', screenLabel2: '', mirror: false, // projector screen; a second projector (same picture) and its screen
  },
  bible: {
    primary: 'kjv', parallel: '', parallelLayout: 'cols', perSlide: 'auto', numbers: true, redLetter: false,
    italics: false, refPos: 'bottom', continue: true, history: [],
  },
  hymns: {
    book: 'sda-sample', chorusRepeat: true, titleSlide: true, showNumber: true, maxLines: 0, caps: false, refPos: 'bottom',
    // Hymn music (MIDI accompaniment through GeneralUser GS)
    musicIntro: true, musicFollow: true, musicInstrument: 'arranged', musicTempo: 100, musicKey: 0, musicVolume: 1.3,
    musicReverb: 59, musicChorus: 43, musicOutput: 'auto',
    // Sound quality: recorded piano and pipe organ (18 MB download, 'auto' = on for PCs), church echo, natural playing
    musicHQ: 'auto', musicRoom: 'church', musicNatural: true,
    // Sound preset (or 'custom'), equaliser preset and band gains (dB), sample interpolation and note limit.
    musicPreset: 'balanced', musicEqPreset: 'flat', musicEq: [0, 0, 0, 0, 0], musicInterp: 'hermite', musicVoices: 256,
  },
  slides: { fit: 'contain', autoSec: 8, quality: 0.9 },
  video: { volume: 1, autoNext: true, repeat: 'off', fit: 'contain', keepCopies: 'ask' },
  screen: { cursor: 'never', audio: false },
  companion: { url: '', pin: '' },
  // Stage screen (confidence monitor) for the people on the platform: what they see by default, the room
  // code and control PIN for phones/laptops that join, timers and quick messages.
  stage: {
    code: '', pin: '', online: false, layout: 'full', featured: 'speaker', warnSec: 120, clock24: true,
    showNext: true, showPlan: true, showNotes: true, showLive: true, textSize: 1, mirror: false,
    allowWinControl: true, msgSec: 0, autoPlanTimer: true, preview: true, monitor: true, monitorPreview: false,
    useWindow: false, second: false, screenLabel: '', screenLabel2: '', // stage windows on this PC (layout in Settings → Displays)
    presets: [], timers: [], turnUrl: '', turnUser: '', turnPass: '', relays: '', hostKey: null,
  },
  // Live stream (OBS): lower thirds and the full-slide output, their look, and the OBS connection.
  stream: {
    autoBible: true, autoHymns: true, hymnMode: 'lines', autoOther: false, theme: 'classic', pos: 'left', size: 1, bug: false,
    fullBg: 'stage', accent: '', lowerSec: 8, names: [],
    obsUrl: 'ws://127.0.0.1:4455', obsPass: '', obsAuto: false, autoScene: false, camScene: '', presScene: 'Church Service · Presentation', obsPrefix: 'Church Service',
    mediaScene: 'camera', studioPreview: true, hdmiBg: 'green', hdmiScreen: '',
  },
  // Presentation clicker: buttons taught in Clicker setup ({next:['key:F14'], prev:[…], black:[…], present:[…], clear:[…]}).
  clicker: { map: {} },
  // Background music for banners (Banners & Music → Music). auto: start when a banner or the pre-service
  // loop goes on screen; fade: fade out when something else goes on screen.
  bannerMusic: { auto: true, fade: true, fadeSec: 3, volume: 0.7, shuffle: false, repeat: 'all' },
  // keySession: keep the API key only until this browser tab or window is closed (not saved on the device).
  ai: { provider: 'openai', apiKey: '', model: '', imageModel: '', auto: {}, keySession: false },
  // The church's details, used by Banners (name, town, sunset times, service countdown, giving QR code).
  church: { name: '', town: '', lat: null, lon: null, service: '09:30', givingUrl: '', givingLabel: '' },
  backup: { slides: true, videos: false, lastDrive: null, lastFile: null },
};

function merge(base, over) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  if (over && typeof over === 'object' && !Array.isArray(over)) {
    for (const k in over) {
      if (base && typeof base[k] === 'object' && base[k] && !Array.isArray(base[k])) out[k] = merge(base[k], over[k]);
      else out[k] = over[k];
    }
  }
  return out;
}

/**
 * Saved settings may come from an older version or be damaged: every value that has a default must
 * have the default's type (numbers must be real numbers), otherwise the default is used.
 */
function fixTypes(base, v) {
  for (const k of Object.keys(base)) {
    const b = base[k];
    if (b && typeof b === 'object' && !Array.isArray(b)) {
      if (!v[k] || typeof v[k] !== 'object' || Array.isArray(v[k])) v[k] = merge(b, {});
      else fixTypes(b, v[k]);
    } else if (Array.isArray(b)) {
      if (!Array.isArray(v[k])) v[k] = b.slice();
    } else if (b !== null && b !== undefined) {
      if (typeof v[k] !== typeof b || (typeof b === 'number' && !isFinite(v[k]))) v[k] = b;
    }
  }
  return v;
}

function load() {
  let v, raw = {};
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
    v = fixTypes(DEFAULTS, merge(DEFAULTS, raw));
  } catch (e) { v = merge(DEFAULTS, {}); }
  // A key kept for this session only lives in sessionStorage, never in the saved settings.
  if (v.ai.keySession) { try { v.ai.apiKey = sessionStorage.getItem(AIKEY) || ''; } catch (e) { v.ai.apiKey = ''; } }
  // v1.1: the projector margin default grew from 80 to 96 px (safe area for cropping projectors).
  // Move people still on the old default along once; a margin they chose themselves is kept.
  if (!v.app.rev || v.app.rev < 2) {
    if (v.display.pad === 80) v.display.pad = 96;
    v.app.rev = 2;
  }
  // v1.6: OBS scenes and sources are named "Church Service · …". OBS already set up from this computer keeps the
  // first names ("SDA Sabbath · …"), so it does not need setting up again.
  // Usage statistics are now only sent when a church switches them on (none were ever sent before: no cloud).
  if (v.app.rev < 3) {
    v.app.stats = false;
    const st = raw.stream || {};
    if (st.camScene && !st.obsPrefix) {
      v.stream.obsPrefix = 'SDA Sabbath';
      if (!st.presScene) v.stream.presScene = 'SDA Sabbath · Presentation';
    }
    v.app.rev = 3;
  }
  return v;
}

/**
 * Validate settings coming from an imported backup: only known sections, values must match the
 * default's type, unknown keys may only be short primitives. The AI key is never imported.
 */
export function sanitizeImportedSettings(raw) {
  function walk(base, over, depth) {
    const out = {};
    if (!over || typeof over !== 'object' || Array.isArray(over) || depth > 4) return out;
    for (const k of Object.keys(over)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const b = base ? base[k] : undefined, v = over[k];
      if (b && typeof b === 'object' && !Array.isArray(b)) { out[k] = walk(b, v, depth + 1); continue; }
      if (Array.isArray(b)) { if (Array.isArray(v)) out[k] = v.filter((x) => x == null || ['string', 'number', 'boolean', 'object'].includes(typeof x)).slice(0, 200); continue; }
      if (b === null || b === undefined) { if (v === null || (typeof v === 'string' && v.length <= 200) || typeof v === 'number' || typeof v === 'boolean') out[k] = v; continue; }
      if (typeof v === typeof b && (typeof v !== 'string' || v.length <= 2000)) out[k] = v;
    }
    return out;
  }
  const out = walk(DEFAULTS, raw, 0);
  if (out.ai) { delete out.ai.apiKey; delete out.ai.auto; }
  if (out.stream) { delete out.stream.obsPass; if (out.stream.obsUrl && !/^wss?:\/\//i.test(out.stream.obsUrl)) delete out.stream.obsUrl; }
  if (out.church) for (const k of ['lat', 'lon']) if (out.church[k] != null && !(typeof out.church[k] === 'number' && Math.abs(out.church[k]) <= 180)) delete out.church[k];
  if (out.companion && out.companion.url && !/^(https?|wss?):\/\//i.test(out.companion.url)) out.companion.url = '';
  for (const c of ['fg', 'bg', 'accent']) if (out.display && out.display[c] != null && !/^#[0-9a-f]{3,8}$/i.test(out.display[c])) delete out.display[c];
  return out;
}

/** Settings for a backup file: never includes the AI key. */
export function exportableSettings(v) {
  const o = JSON.parse(JSON.stringify(v));
  if (o.ai) o.ai.apiKey = '';
  if (o.stream) o.stream.obsPass = '';
  if (o.stage) o.stage.hostKey = null;
  return o;
}

export const settings = emitter({ v: load() });

settings.get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), settings.v);

settings.set = (path, value) => {
  const keys = path.split('.');
  let o = settings.v;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] = o[keys[i]] || {};
  o[keys[keys.length - 1]] = value;
  settings.save();
  settings.emit('change', path, value);
  settings.emit('change:' + keys[0], path, value);
};

settings.save = () => {
  try {
    const ai = settings.v.ai || {};
    if (ai.keySession) {
      // Session-only key: remembered for this tab, left out of what is saved on the device.
      try { sessionStorage.setItem(AIKEY, ai.apiKey || ''); } catch (e) { /* */ }
      localStorage.setItem(KEY, JSON.stringify(Object.assign({}, settings.v, { ai: Object.assign({}, ai, { apiKey: '' }) })));
    } else {
      try { sessionStorage.removeItem(AIKEY); } catch (e) { /* */ }
      localStorage.setItem(KEY, JSON.stringify(settings.v));
    }
  } catch (e) { /* private mode */ }
};

settings.reset = (section) => {
  if (section) settings.v[section] = merge(DEFAULTS[section], {});
  else settings.v = merge(DEFAULTS, {});
  settings.save();
  settings.emit('change', section || '*');
  if (section) settings.emit('change:' + section, section);
};

/** Effective low-power flag: explicit choice wins, else device heuristic. */
settings.lowPower = () => {
  const v = settings.v.app.lowPower;
  return v == null ? lowPowerDevice() : !!v;
};

/** Style object sent to the display (and used by the monitors). */
settings.displayStyle = () => {
  const d = settings.v.display;
  return {
    font: d.font, fg: d.fg, bg: d.bg, accent: d.accent, shadow: d.shadow, align: d.align, pad: d.pad,
    minFont: d.minFont, maxFont: d.maxFont, hymnCap: { normal: 110 / 150, large: 130 / 150, largest: 1 }[d.hymnSize] || 130 / 150, fade: settings.lowPower() || d.transition === 'cut' ? 0 : d.fade,
    bgImage: d.bgImage, bgDim: d.bgDim, logo: d.logo, logoText: d.logoText, clearShows: d.clearShows, weight: d.weight,
    // Default logo slide when no logo is set: the church name from Settings → Church, if any.
    logoName: ((settings.v.church && settings.v.church.name) || '').trim(),
  };
};
