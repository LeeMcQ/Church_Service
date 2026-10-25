// The output display. Mounted by display.html (projector window / Cast / LAN screen)
// and by the in-app "this device" mode. It only renders what the control sends.
import { createStage } from '../core/render.js';
import { isBlob, throttle, safeHttpUrl } from '../core/util.js';

const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export function createDisplay(root, { post, self = false, mirror = false } = {}) {
  // mirror: a second projector showing the same picture. It plays videos silently (the main projector has the
  // sound) and keeps them in time with the main projector.
  let deck = null, index = 0, style = {}, stream = null, frozen = null;
  let video = null, audio = null, mediaOpts = {}, abLoop = null, lastFrame = null;
  const winAspect = () => Math.max(0.5, (root.clientWidth || innerWidth) / (root.clientHeight || innerHeight || 1));

  const stage = createStage(root, { aspect: winAspect(), media: mediaHook });
  stage.el.classList.add('display-stage');

  // ---------------------------------------------------------------- media
  function report(extra) {
    if (!video) return;
    post(Object.assign({
      t: 'media', time: video.currentTime || 0, dur: isFinite(video.duration) ? video.duration : 0,
      paused: video.paused, ended: video.ended, rate: video.playbackRate, vol: mediaOpts.volume == null ? 1 : mediaOpts.volume,
      muted: video.muted, loop: video.loop, ab: abLoop, vw: video.videoWidth, vh: video.videoHeight,
    }, extra || {}));
  }
  const reportT = throttle(() => report(), 250);

  function ensureAudioGraph() {
    if (audio || !video) return audio;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      const ctx = new AC();
      const src = ctx.createMediaElementSource(video);
      const filters = EQ_FREQS.map((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f; b.Q.value = 1.1; b.gain.value = 0;
        return b;
      });
      const gain = ctx.createGain();
      let n = src;
      filters.forEach((f) => { n.connect(f); n = f; });
      n.connect(gain); gain.connect(ctx.destination);
      audio = { ctx, src, filters, gain };
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch (e) { console.warn('audio graph', e); audio = null; }
    return audio;
  }

  function applyVolume(v) {
    mediaOpts.volume = v;
    if (!video) return;
    if (mirror) { video.muted = true; return; }
    if (v > 1 || audio) {
      const a = ensureAudioGraph();
      if (a) { video.volume = 1; a.gain.gain.value = v; return; }
    }
    video.volume = Math.max(0, Math.min(1, v));
  }

  function applyVisual() {
    if (!video) return;
    const o = mediaOpts;
    const box = video.parentNode;
    box.classList.toggle('fit-cover', o.fit === 'cover');
    box.classList.toggle('fit-fill', o.fit === 'fill');
    const tr = [];
    if (o.zoom && o.zoom !== 1) tr.push('scale(' + o.zoom + ')');
    if (o.rotate) tr.push('rotate(' + o.rotate + 'deg)');
    if (o.flipH) tr.push('scaleX(-1)');
    if (o.flipV) tr.push('scaleY(-1)');
    video.style.transform = tr.join(' ');
    const f = o.filters || {};
    const parts = [];
    if (f.brightness != null && f.brightness !== 1) parts.push('brightness(' + f.brightness + ')');
    if (f.contrast != null && f.contrast !== 1) parts.push('contrast(' + f.contrast + ')');
    if (f.saturate != null && f.saturate !== 1) parts.push('saturate(' + f.saturate + ')');
    if (f.hue) parts.push('hue-rotate(' + f.hue + 'deg)');
    video.style.filter = parts.join(' ');
  }

  function setSubs(sub) {
    if (!video) return;
    Array.prototype.slice.call(video.querySelectorAll('track')).forEach((t) => { if (t.src.startsWith('blob:')) URL.revokeObjectURL(t.src); t.remove(); });
    if (!sub || !sub.vtt) return;
    const tr = document.createElement('track');
    tr.kind = 'subtitles'; tr.default = true; tr.srclang = 'en'; tr.label = 'Subtitles';
    tr.src = URL.createObjectURL(new Blob([sub.vtt], { type: 'text/vtt' }));
    video.appendChild(tr);
    setTimeout(() => { if (video && video.textTracks[0]) video.textTracks[0].mode = 'showing'; }, 50);
    let css = document.getElementById('cue-css');
    if (!css) { css = document.createElement('style'); css.id = 'cue-css'; document.head.appendChild(css); }
    css.textContent = 'video::cue{font-size:' + (sub.size || 100) + '%;background:rgba(0,0,0,.7);color:#fff;font-family:Hyperlegible,sans-serif}';
  }

  async function safePlay() {
    if (!video) return;
    try { await video.play(); }
    catch (e) {
      if (e && e.name === 'NotAllowedError') {
        // Browser blocked sound until someone clicks this window: play muted and tell the operator.
        video.muted = true;
        try { await video.play(); } catch (e2) { /* */ }
        post({ t: 'notice', code: 'autoplay', text: 'Sound is blocked until the display window is clicked once. Click the projector screen, then unmute.' });
        report();
      }
    }
  }

  function fade(to, ms) {
    if (!video) return;
    const start = performance.now();
    const fromO = parseFloat(video.style.opacity || '1');
    const baseVol = mediaOpts.volume == null ? 1 : mediaOpts.volume;
    const fromV = to ? 0 : baseVol;
    const step = (t) => {
      if (!video) return;
      const k = Math.min(1, (t - start) / ms);
      video.style.opacity = String(fromO + ((to ? 1 : 0) - fromO) * k);
      const vol = to ? fromV + (baseVol - fromV) * k : baseVol * (1 - k);
      if (audio) audio.gain.gain.value = vol; else video.volume = Math.max(0, Math.min(1, vol));
      if (k < 1) requestAnimationFrame(step);
      else if (!to) { video.pause(); applyVolume(baseVol); report(); }
    };
    if (to && video.paused) { safePlay(); }
    requestAnimationFrame(step);
  }

  // Black (or Logo) during a video: the sound fades out in a third of a second and the video pauses where it
  // is; taking Black off again carries on from the same place. (Behind a black screen the sound must stop too.)
  let blankPaused = false;
  function blankMedia(mode) {
    if (!video) { blankPaused = false; return; }
    if (mode && !video.paused) {
      blankPaused = true;
      const baseVol = mediaOpts.volume == null ? 1 : mediaOpts.volume;
      const start = performance.now();
      const step = (t) => {
        if (!video || !blankPaused) return;
        const k = Math.min(1, (t - start) / 300);
        const vol = baseVol * (1 - k);
        if (audio) audio.gain.gain.value = vol; else video.volume = Math.max(0, Math.min(1, vol));
        if (k < 1) requestAnimationFrame(step);
        else { video.pause(); applyVolume(baseVol); report(); }
      };
      requestAnimationFrame(step);
    } else if (!mode && blankPaused) {
      blankPaused = false;
      applyVolume(mediaOpts.volume == null ? 1 : mediaOpts.volume);
      safePlay();
    }
  }

  function snapshot() {
    if (!video || !video.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    c.toBlob((b) => post({ t: 'snapshot', blob: b }), 'image/jpeg', 0.92); // JPEG: a full-HD PNG can stall a weak PC for a second
  }

  function mediaCmd(op, v) {
    if (op === 'freeze') return freeze(v);
    if (!video) return;
    switch (op) {
      case 'play': safePlay(); break;
      case 'pause': video.pause(); break;
      case 'toggle': if (video.paused) safePlay(); else video.pause(); break;
      case 'stop': video.pause(); video.currentTime = 0; break;
      case 'seek': video.currentTime = Math.max(0, v); break;
      case 'skip': video.currentTime = Math.max(0, video.currentTime + v); break;
      case 'frame': video.pause(); video.currentTime = Math.max(0, video.currentTime + v / 25); break;
      case 'rate': video.playbackRate = v; break;
      case 'volume': applyVolume(v); break;
      case 'mute': if (!mirror) { video.muted = !!v; if (!v && audio) audio.ctx.resume(); } break;
      case 'sync': if (mirror && v && isFinite(v.time)) { if (Math.abs(video.currentTime - v.time) > 0.35) video.currentTime = v.time; if (v.paused && !video.paused) video.pause(); else if (!v.paused && video.paused) safePlay(); } break;
      case 'loop': video.loop = !!v; break;
      case 'ab': abLoop = v && v.b > v.a ? v : null; break;
      case 'fit': mediaOpts.fit = v; applyVisual(); break;
      case 'zoom': mediaOpts.zoom = v; applyVisual(); break;
      case 'rotate': mediaOpts.rotate = v; applyVisual(); break;
      case 'flip': mediaOpts.flipH = !!(v && v.h); mediaOpts.flipV = !!(v && v.v); applyVisual(); break;
      case 'filters': mediaOpts.filters = v || {}; applyVisual(); break;
      case 'eq': {
        mediaOpts.eq = v;
        const flat = !v || v.every((g) => !g);
        if (flat && !audio) break;
        const a = ensureAudioGraph();
        if (a) a.filters.forEach((f, i) => { f.gain.value = flat ? 0 : v[i] || 0; });
        applyVolume(mediaOpts.volume == null ? 1 : mediaOpts.volume);
        break;
      }
      case 'subs': mediaOpts.subs = v; setSubs(v); break;
      case 'fadeOut': fade(false, v || 1500); break;
      case 'fadeIn': fade(true, v || 1500); break;
      case 'snapshot': snapshot(); break;
    }
    report();
  }

  function freeze(on) {
    const host = stage.frontLayer().querySelector('.f-media');
    const vid = host && host.querySelector('video');
    if (!vid) return;
    if (on && !frozen) {
      const c = document.createElement('canvas');
      c.width = vid.videoWidth || 1920; c.height = vid.videoHeight || 1080;
      try { c.getContext('2d').drawImage(vid, 0, 0, c.width, c.height); } catch (e) { /* */ }
      host.appendChild(c); frozen = c;
    } else if (!on && frozen) { frozen.remove(); frozen = null; }
    post({ t: 'frozen', on: !!frozen });
  }

  function teardownVideo() {
    if (audio) { try { audio.ctx.close(); } catch (e) { /* */ } audio = null; }
    if (video) {
      try { video.pause(); video.removeAttribute('src'); video.srcObject = null; video.load(); } catch (e) { /* */ }
      video = null;
    }
    abLoop = null;
  }

  // Called by the stage when a video / stream / web frame is shown.
  function mediaHook(layer, frame) {
    const box = document.createElement('div');
    box.className = 'f-media';
    layer.appendChild(box);
    if (frame.kind === 'web') {
      const fr = document.createElement('iframe');
      fr.src = safeHttpUrl(frame.url) || 'about:blank';
      fr.allow = 'autoplay; fullscreen; encrypted-media';
      // YouTube needs to know which page embeds the video; every other site gets no referrer at all.
      fr.referrerPolicy = /^https:\/\/(www\.)?youtube(-nocookie)?\.com\//i.test(fr.src) ? 'strict-origin-when-cross-origin' : 'no-referrer';
      box.appendChild(fr);
      return () => { fr.src = 'about:blank'; };
    }
    const v = document.createElement('video');
    v.playsInline = true; v.setAttribute('playsinline', '');
    v.disablePictureInPicture = true;
    box.appendChild(v);
    if (frame.kind === 'stream') {
      v.muted = true; v.autoplay = true;
      if (stream) v.srcObject = stream;
      v.play().catch(() => {});
      return () => { if (frozen) { frozen.remove(); frozen = null; } v.srcObject = null; };
    }
    // video
    teardownVideo();
    video = v;
    mediaOpts = Object.assign({ volume: 1 }, frame.opts || {});
    let url = null;
    if (isBlob(frame.src)) { url = URL.createObjectURL(frame.src); v.src = url; }
    else v.src = frame.src;
    v.preload = 'auto';
    v.loop = !!mediaOpts.loop;
    v.playbackRate = mediaOpts.rate || 1;
    if (mediaOpts.ab) abLoop = mediaOpts.ab;
    applyVisual();
    v.addEventListener('loadedmetadata', () => {
      if (frame.start) v.currentTime = frame.start;
      applyVolume(mediaOpts.volume == null ? 1 : mediaOpts.volume);
      if (mediaOpts.eq) mediaCmd('eq', mediaOpts.eq);
      if (mediaOpts.subs) setSubs(mediaOpts.subs);
      if (frame.autoplay !== false) safePlay();
      report();
    });
    ['play', 'pause', 'ended', 'ratechange', 'volumechange', 'seeked'].forEach((ev) => v.addEventListener(ev, () => report()));
    v.addEventListener('timeupdate', () => {
      if (abLoop && v.currentTime >= abLoop.b) v.currentTime = abLoop.a;
      reportT();
    });
    v.addEventListener('error', () => post({ t: 'notice', code: 'media-error', text: 'This video could not be played here (' + (v.error ? 'code ' + v.error.code : 'unknown') + '). Try MP4 (H.264) or WebM.' }));
    return () => {
      if (video === v) teardownVideo();
      else { v.pause(); v.removeAttribute('src'); v.load(); }
      if (url) URL.revokeObjectURL(url);
    };
  }

  // ---------------------------------------------------------------- frames
  function frameAt(i) {
    if (!deck) return null;
    if (deck.kind === 'video' || deck.kind === 'stream' || deck.kind === 'web') return deck.frame;
    return (deck.frames || [])[i] || null;
  }
  function showCurrent() {
    const f = frameAt(index);
    // Re-showing the same media frame (e.g. a "go" while a video plays) must not restart it.
    if (f && f === lastFrame && (f.kind === 'video' || f.kind === 'stream' || f.kind === 'web')) return;
    lastFrame = f;
    const shown = stage.show(f);
    hint(false);
    return shown;
  }

  // ---------------------------------------------------------------- self-running loops (pre-service)
  // A deck with auto:{secs, len, at?, end?} advances here, on the display, so it keeps going even when
  // the phone or PC that started it goes to sleep. Frames 0…len-1 rotate; at `at` (epoch ms) the display
  // jumps to frame `end` (e.g. the Welcome banner) and stops. Each step is reported back with 'auto-go'.
  let autoT = null, autoLast = 0, autoPaused = false;
  function stopAuto() { if (autoT) { clearInterval(autoT); autoT = null; } }
  function startAuto() {
    stopAuto();
    const a = deck && deck.auto;
    if (!a || !(a.secs > 0) || !(a.len > 0)) return;
    autoLast = Date.now(); autoPaused = false;
    autoT = setInterval(() => {
      if (!deck || deck.auto !== a) { stopAuto(); return; }
      const now = Date.now();
      if (a.at && a.end != null && now >= a.at) {
        if (index !== a.end) { index = a.end; showCurrent(); post({ t: 'auto-go', index }); }
        stopAuto(); return;
      }
      if (autoPaused || index >= a.len || now - autoLast < a.secs * 1000) return;
      autoLast = now;
      index = (index + 1) % a.len;
      showCurrent();
      post({ t: 'auto-go', index });
    }, 250);
  }

  function handle(msg) {
    if (!msg || !msg.t) return;
    const q = msg.q;
    let drawn = null;
    switch (msg.t) {
      case 'style': style = msg.style || {}; stage.applyStyle(style); if (deck && deck.frames) { lastFrame = null; drawn = showCurrent(); } break;
      case 'deck': deck = msg.deck; index = msg.index || 0; lastFrame = null; blankPaused = false; stage.setBlank(msg.blank || null); drawn = showCurrent(); startAuto(); break;
      case 'go': index = msg.index || 0; autoLast = Date.now(); drawn = showCurrent(); break;
      case 'auto': autoPaused = !msg.on; autoLast = Date.now(); break;
      case 'blank': stage.setBlank(msg.mode); blankMedia(msg.mode); break;
      case 'clear': deck = null; lastFrame = null; stopAuto(); teardownVideo(); stage.show(null); stage.setBlank(msg.mode || null); break;
      case 'media': mediaCmd(msg.op, msg.v); break;
      case 'caption': stage.setCaption(msg.text || ''); break;
      case 'music': musicCmd(msg); break;
      case 'hello?': sayHello(); break;
      case 'ping': post({ t: 'pong' }); break;
      case 'fullscreen':
        try {
          const el = document.documentElement;
          const r = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen ? el.webkitRequestFullscreen() : null;
          if (r && r.catch) r.catch(() => { /* the browser wants a click on the display first */ });
        } catch (e) { /* needs a user gesture */ }
        break;
    }
    // Tell the controller this change is on the screen now (it keeps its Live monitor in step with it).
    if (q) {
      const say = () => requestAnimationFrame(() => requestAnimationFrame(() => post({ t: 'ack', q })));
      Promise.resolve(drawn).then(say, say);
    }
  }

  // ---------------------------------------------------------------- hymn music (phone remote → church PC)
  // When a phone controls this display through the companion, hymn music plays here so it comes
  // out of the PC's speakers. The engine loads only the first time music is requested.
  let musicEng = null, musicEngP = null;
  function getMusic() {
    if (!musicEngP) {
      musicEngP = import('../core/musicengine.js').then(({ MusicEngine }) => {
        musicEng = new MusicEngine();
        musicEng.on('state', (st) => post({ t: 'music-state', s: st }));
        musicEng.on('slide', (slide) => post({ t: 'music-slide', slide }));
        musicEng.on('ended', () => post({ t: 'music-ended' }));
        return musicEng;
      });
    }
    return musicEngP;
  }
  async function musicCmd(msg) {
    try {
      const eng = await getMusic();
      if (msg.op === 'play') {
        try { eng.unlock(); } catch (e) { /* reported below */ }
        await eng.play(msg.req);
        if (eng.ctx && eng.ctx.state !== 'running') {
          hint(true);
          post({ t: 'notice', code: 'autoplay', text: 'The display needs one click before it may play sound. Click the projector screen once, then press Play again.' });
        }
      } else eng.command(msg.op, msg.v);
    } catch (e) { post({ t: 'music-error', text: e.message || String(e) }); }
  }

  const sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); // this page's session
  function sayHello() { post({ t: 'hello', w: root.clientWidth || innerWidth, h: root.clientHeight || innerHeight, self, sid }); }

  // ---------------------------------------------------------------- hint overlay
  let hintEl = null;
  function hint(show) {
    if (self) return;
    if (show && !hintEl) {
      hintEl = document.createElement('div');
      hintEl.className = 'disp-hint';
      hintEl.innerHTML = '<b>SDA Sabbath display</b><span>Click here once to fill this screen and allow sound.<br>It stays full screen; press F if it ever is not.</span>';
      root.appendChild(hintEl);
    } else if (!show && hintEl) { hintEl.remove(); hintEl = null; }
  }

  const onResize = throttle(() => { stage.setAspect(winAspect()); sayHello(); }, 300);
  window.addEventListener('resize', onResize);

  return {
    stage, handle, hint, sayHello,
    unlockAudio() { if (musicEng) try { musicEng.unlock(); } catch (e) { /* */ } },
    setStream(s) { stream = s || null; if (deck && deck.kind === 'stream') { lastFrame = null; showCurrent(); } },
    get video() { return video; },
    get mediaEl() { const l = stage.frontLayer(); return l && l.querySelector('video'); },
    destroy() { window.removeEventListener('resize', onResize); stopAuto(); teardownVideo(); stage.destroy(); },
  };
}
