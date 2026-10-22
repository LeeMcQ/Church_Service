// The church's own details (name, town, location, service time, giving link) and the dates and
// sunset times worked out from them, offline. Used by Banners and Settings → Church.
import { settings } from './settings.js';

export const church = () => {
  const c = settings.v.church || {};
  return {
    name: (c.name || '').trim() || (settings.v.display.logoText || '').trim(),
    town: (c.town || '').trim(),
    lat: typeof c.lat === 'number' && isFinite(c.lat) ? c.lat : null,
    lon: typeof c.lon === 'number' && isFinite(c.lon) ? c.lon : null,
    service: /^\d{1,2}:\d{2}$/.test(c.service || '') ? c.service : '09:30',
    givingUrl: (c.givingUrl || '').trim(),
    givingLabel: (c.givingLabel || '').trim() || 'Scan to give online',
  };
};
export const hasLocation = () => { const c = church(); return c.lat != null && c.lon != null; };

// ------------------------------------------------------------ sun
const RAD = Math.PI / 180;
/**
 * Sunrise and sunset for a local calendar day (NOAA / "sunrise equation", within about 2 minutes).
 * lat: degrees north (South Africa is negative), lon: degrees east. Returns Dates, or null near the poles.
 */
export function sunTimes(day, lat, lon) {
  const jdNoon = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 12) / 86400000 + 2440587.5;
  const n = Math.round(jdNoon - 2451545.0 + 0.0008);
  const jStar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinD = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosD = Math.cos(Math.asin(sinD));
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinD) / (Math.cos(lat * RAD) * cosD);
  if (cosW < -1 || cosW > 1) return null;
  const w = Math.acos(cosW) / RAD;
  const toDate = (j) => new Date((j - 2440587.5) * 86400000);
  return { sunrise: toDate(jTransit - w / 360), sunset: toDate(jTransit + w / 360) };
}

export const hhmm = (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

/** "Sabbath begins at sunset: 18:52" (Friday), "Sabbath ends at sunset: 18:53" (Sabbath), else next Friday's. */
export function sabbathSunsetLine(now = new Date()) {
  const c = church();
  if (c.lat == null || c.lon == null) return '';
  const day = now.getDay();
  if (day === 6) { const t = sunTimes(now, c.lat, c.lon); return t ? 'Sabbath ends at sunset: ' + hhmm(t.sunset) : ''; }
  const fri = new Date(now); fri.setDate(now.getDate() + ((5 - day + 7) % 7));
  const t = sunTimes(fri, c.lat, c.lon);
  if (!t) return '';
  return (day === 5 ? 'Sabbath begins at sunset: ' : 'Sabbath begins Friday at sunset: ') + hhmm(t.sunset);
}

/** The coming Sabbath (today when it is Saturday). */
export function nextSabbath(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return d;
}
/** "Sabbath, 17 October 2026" */
export function sabbathDateLine(now = new Date()) {
  return 'Sabbath, ' + nextSabbath(now).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * When "HH:MM" next happens: today, unless that was more than three hours ago (then tomorrow).
 * A countdown that ran out a few minutes ago keeps showing its "Welcome" text instead of jumping a day.
 */
export function nextTime(hm, now = new Date()) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
  if (!m) return null;
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2], 0, 0);
  if (now - t > 3 * 3600000) t.setDate(t.getDate() + 1);
  return t;
}

/** Only https links (and plain web addresses) become giving QR codes. */
export function safeGivingUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (/^www\./i.test(u)) u = 'https://' + u;
  return /^https:\/\/[^\s]+$/i.test(u) && u.length <= 600 ? u : '';
}
