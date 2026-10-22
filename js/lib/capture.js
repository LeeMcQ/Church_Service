// Screen / window / tab capture shared by the Web and PC view tabs.
import { settings } from '../core/settings.js';

export const canCapture = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

/** surface: 'monitor' | 'window' | 'browser'. Returns {stream, controller, label}. */
export async function capture({ surface = 'monitor', audio = false, cursor } = {}) {
  if (!canCapture()) throw new Error('This browser cannot share the screen. Use Chrome or Edge on a PC.');
  const lp = settings.lowPower();
  const controller = typeof window.CaptureController === 'function' ? new window.CaptureController() : null;
  const opts = {
    video: {
      displaySurface: surface,
      cursor: cursor || settings.v.screen.cursor || 'never',
      frameRate: { ideal: lp ? 12 : 24, max: lp ? 15 : 30 },
      width: { ideal: lp ? 1280 : 1920, max: 1920 },
      height: { ideal: lp ? 720 : 1080, max: 1080 },
    },
    audio: !!audio,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    systemAudio: audio ? 'include' : 'exclude',
    preferCurrentTab: false,
  };
  if (controller) opts.controller = controller;
  const stream = await navigator.mediaDevices.getDisplayMedia(opts);
  const track = stream.getVideoTracks()[0];
  try { if (track && 'contentHint' in track) track.contentHint = surface === 'browser' ? 'detail' : 'motion'; } catch (e) { /* */ }
  const st = track && track.getSettings ? track.getSettings() : {};
  return { stream, controller, label: friendlyLabel(track ? track.label : ''), surface: st.displaySurface || surface };
}

// Chrome names captured screens "screen:0:0" and windows "window:1234:0" — internal ids, not
// something to show the operator. Keep real titles (tab and window names) and drop the ids.
export function friendlyLabel(label) {
  const l = String(label || '').trim();
  if (!l || /^(screen|window|web-contents-media-stream):/i.test(l) || /^[\w-]+:-?\d+:-?\d+$/.test(l)) return '';
  return l;
}

export function stopStream(stream) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
}

/** Captured Surface Control (Chrome): scroll and zoom a shared tab from the preview. */
export function attachSurfaceControl(videoEl, controller) {
  if (!controller || typeof controller.sendWheel !== 'function') return null;
  const onWheel = async (e) => {
    e.preventDefault();
    const r = videoEl.getBoundingClientRect();
    const vw = videoEl.videoWidth || r.width, vh = videoEl.videoHeight || r.height;
    const sc = Math.min(r.width / vw, r.height / vh);
    const ox = (r.width - vw * sc) / 2, oy = (r.height - vh * sc) / 2;
    const x = Math.round((e.clientX - r.left - ox) / sc), y = Math.round((e.clientY - r.top - oy) / sc);
    if (x < 0 || y < 0 || x > vw || y > vh) return;
    try { await controller.sendWheel({ x, y, wheelDeltaX: Math.round(-e.deltaX), wheelDeltaY: Math.round(-e.deltaY) }); }
    catch (err) { console.warn('sendWheel', err); }
  };
  videoEl.addEventListener('wheel', onWheel, { passive: false });
  return {
    zoomIn: () => controller.increaseZoomLevel && controller.increaseZoomLevel().catch(() => {}),
    zoomOut: () => controller.decreaseZoomLevel && controller.decreaseZoomLevel().catch(() => {}),
    zoomReset: () => controller.resetZoomLevel && controller.resetZoomLevel().catch(() => {}),
    detach: () => videoEl.removeEventListener('wheel', onWheel),
  };
}
