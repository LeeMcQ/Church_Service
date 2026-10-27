// Keeps this app's saved data apart from any other app on the same website.
//
// leemcq.github.io serves several apps from one origin (Church_Service, the older SDA_Sabbath, …). A browser gives
// one origin a single localStorage, sessionStorage, IndexedDB and Cache Storage, so names decide what is shared.
// Everything this app saves is named after its own address folder ('cs/Church_Service/…'), so another app never
// reads, overwrites or deletes it, and this app never touches theirs.
//
// The first time, data saved under the old shared names ('selah…', from before this change) is COPIED over once.
// The old copies stay exactly as they are, so the other app keeps working with them.
import { APP_SCOPE } from './util.js';

export const NS = 'cs' + APP_SCOPE;                 // 'cs/Church_Service/'
export const lsKey = (name) => NS + name;
export const DB_NAME = NS + 'data';                 // IndexedDB
export const CACHE_NS = NS + 'cache:';              // Cache Storage names (not the service worker's own)

/** Old shared name → this app's name (localStorage). */
export const LEGACY_LOCAL = {
  'selah.settings.v1': 'settings.v1',
  'selah.stage.local': 'stage.local',
  'selah.stage.hosts': 'stage.hosts',
  'selah-slide-clipboard': 'slide-clipboard',
  'selah-recent-colours': 'recent-colours',
  'selah-bn-wide': 'bn-wide',
  'selah-ai-history': 'ai-history',
  'selah.gdrive.token': 'gdrive.token',
  'selah.cloud.session': 'cloud.session',
  'selah.cloud.install': 'cloud.install',
  'selah.cloud.pending': 'cloud.pending',
  'selah.cloud.outbox': 'cloud.outbox',
};
const LEGACY_SESSION = { 'selah.aikey.session': 'aikey.session' };

(function copyOnce() {
  try {
    if (localStorage.getItem(NS + 'separated')) return;
    for (const [from, to] of Object.entries(LEGACY_LOCAL)) {
      const v = localStorage.getItem(from);
      if (v != null && localStorage.getItem(NS + to) == null) localStorage.setItem(NS + to, v);
    }
    for (const [from, to] of Object.entries(LEGACY_SESSION)) {
      const v = sessionStorage.getItem(from);
      if (v != null && sessionStorage.getItem(NS + to) == null) sessionStorage.setItem(NS + to, v);
    }
    localStorage.setItem(NS + 'separated', new Date().toISOString());
  } catch (e) { /* private window or storage off: nothing saved anyway */ }
})();
