// Church echo for the hymn music: builds the "impulse response" of a mid-sized church (how one hand clap would
// ring in the room) for a Web Audio ConvolverNode. Made in code, so it costs no download and no licence:
//   - the first echoes off nearby walls (early reflections) in the first 0.1 s,
//   - then a smooth tail that dies away slower in the bass than in the treble, like stone and wood rooms do.
// The same function runs in Node for the test renders (tools/), so what is tested is what plays.

/** Room presets: decay time (seconds to fall 60 dB, mid frequencies) and how much of it is mixed in. */
export const ROOMS = {
  off: null,
  small: { rt: 1.2, wet: 0.22, predelay: 0.010 },
  church: { rt: 2.0, wet: 0.30, predelay: 0.018 },
  large: { rt: 3.0, wet: 0.36, predelay: 0.028 },
};

function rng(seed) {   // small, repeatable random numbers (the room sounds the same every time)
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Returns [left, right] Float32Arrays. */
export function churchImpulse(sampleRate, room = ROOMS.church) {
  const { rt, predelay } = room;
  const len = Math.round(sampleRate * (predelay + rt * 1.25));
  const pre = Math.round(predelay * sampleRate);
  const out = [];
  for (let c = 0; c < 2; c++) {
    const rand = rng(0x5ab0 + c * 7919);
    const ir = new Float32Array(len);
    // Early reflections: a dozen discrete echoes, softer as they come later, different in each ear.
    for (let k = 0; k < 14; k++) {
      const t = pre + Math.round((0.004 + Math.pow(rand(), 1.4) * 0.085) * sampleRate);
      const g = (0.55 - k * 0.028) * (rand() < 0.5 ? -1 : 1);
      if (t < len) ir[t] += g;
    }
    // Diffuse tail: noise split into bass, middle and treble, each dying away at its own speed.
    const rtLow = rt * 1.25, rtMid = rt, rtHigh = rt * 0.5;
    const aL = Math.exp(-2 * Math.PI * 350 / sampleRate), aH = Math.exp(-2 * Math.PI * 3000 / sampleRate);
    let lp = 0, lpH = 0;
    const build = Math.round(0.06 * sampleRate);
    for (let i = pre; i < len; i++) {
      const n = rand() * 2 - 1;
      lp = aL * lp + (1 - aL) * n;            // bass part
      lpH = aH * lpH + (1 - aH) * n;          // everything below the treble
      const low = lp, high = n - lpH, mid = lpH - lp;
      const t = (i - pre) / sampleRate;
      const env = (x) => Math.exp(-6.91 * t / x);   // -60 dB after x seconds
      const onset = Math.min(1, (i - pre) / build);
      ir[i] += 0.35 * onset * (1.4 * low * env(rtLow) + mid * env(rtMid) + 0.6 * high * env(rtHigh));
    }
    // Soften the very top end (air and soft furnishings) and fade the last 5 % so it ends in silence.
    const aT = Math.exp(-2 * Math.PI * 8000 / sampleRate);
    let y = 0;
    for (let i = 0; i < len; i++) { y = aT * y + (1 - aT) * ir[i]; ir[i] = y; }
    const fade = Math.round(len * 0.05);
    for (let i = 0; i < fade; i++) ir[len - 1 - i] *= i / fade;
    out.push(ir);
  }
  return out;
}
