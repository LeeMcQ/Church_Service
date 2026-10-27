// Online AI (optional): short text summaries and background pictures, using the church's own API key
// from Settings → AI. Everything else in Church Service works without it.
//
// Model names change often, so nothing depends on one name: each provider has a preferred default,
// and when the provider says that model does not exist, the list of models the key can use is
// fetched once and the best match is remembered (Settings → AI → Test key shows and sets this).
import { settings } from './settings.js';

export const PROVIDERS = {
  openai: {
    name: 'OpenAI', image: true, text: 'gpt-5-mini', img: 'gpt-image-2.5-flare',
    hint: 'Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a>. Needs a paid account. Keys start with <strong>sk-</strong>.',
  },
  google: {
    name: 'Google Gemini', image: true, text: 'gemini-3.8-flash', img: 'gemini-nano-banana-2.1',
    hint: 'Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. No credit card needed. Keys start with <strong>AIza</strong> or <strong>AQ.</strong>',
  },
  xai: {
    name: 'xAI Grok', image: true, text: 'grok-4.7', img: 'grok-imagine-image',
    hint: 'Get a key at <a href="https://console.x.ai" target="_blank" rel="noopener">console.x.ai</a>. Keys start with <strong>xai-</strong>.',
  },
  together: {
    name: 'Together AI', image: true, text: 'MiniMaxAI/MiniMax-M3', img: 'black-forest-labs/FLUX.2-dev',
    hint: 'Get a key at <a href="https://api.together.xyz/settings/api-keys" target="_blank" rel="noopener">api.together.xyz</a>. Free tier available.',
  },
  openrouter: {
    name: 'OpenRouter', image: true, text: 'google/gemini-3.8-flash', img: '',
    hint: 'Get a key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>. One key for many models. Keys start with <strong>sk-or-</strong>.',
  },
  anthropic: {
    name: 'Anthropic Claude', image: false, text: 'claude-haiku-5-5', img: '',
    hint: 'Get a key at <a href="https://platform.claude.com/" target="_blank" rel="noopener noreferrer">platform.claude.com</a>. Text only. Keys start with <strong>sk-ant-</strong>.',
  },
};

const cfg = () => settings.v.ai || {};
const provider = () => (PROVIDERS[cfg().provider] ? cfg().provider : 'openai');
const key = () => (cfg().apiKey || '').trim();
const auto = () => (cfg().auto && cfg().auto[provider()]) || {};
function remember(kind, model) {
  const all = Object.assign({}, cfg().auto || {});
  all[provider()] = Object.assign({}, all[provider()] || {}, { [kind]: model });
  settings.set('ai.auto', all);
}
/** The model that will be used: the one chosen in Settings, else one found earlier, else the default. */
export function modelFor(kind) {
  const p = PROVIDERS[provider()];
  if (kind === 'image') return (cfg().imageModel || '').trim() || auto().image || p.img;
  return (cfg().model || '').trim() || auto().text || p.text;
}
export const hasKey = () => !!key();
export const canImage = () => !!PROVIDERS[provider()].image;
export const providerName = () => PROVIDERS[provider()].name;

// ------------------------------------------------------------ errors
class AiError extends Error { constructor(msg, status, body) { super(msg); this.status = status; this.body = body || ''; } }
const who = () => PROVIDERS[provider()].name.split(' ')[0];
async function fail(r, what) {
  const body = await r.text().catch(() => '');
  let msg;
  if (r.status === 401 || r.status === 403) msg = who() + ' refused the API key. Check or replace it in Settings → AI.';
  else if (r.status === 402 || r.status === 429) msg = who() + ' says the key is out of credit or over its rate limit. Try again later or check billing.';
  else if (r.status >= 500) msg = who() + ' is having problems (' + r.status + '). Try again in a minute.';
  else msg = who() + ' ' + what + ' error ' + r.status + (body ? ': ' + body.replace(/\s+/g, ' ').slice(0, 160) : '');
  throw new AiError(msg, r.status, body);
}
const modelMissing = (e) => e instanceof AiError && (e.status === 404 || e.status === 400) && /model|not.?found|does not exist|invalid/i.test(e.body);

/** Turn a thrown error into words for a media volunteer. Browsers report a refused key as a network failure. */
export function friendlyAiError(e) {
  const m = (e && e.message) || String(e);
  if (e instanceof TypeError || /failed to fetch|networkerror|load failed|cors/i.test(m)) {
    return navigator.onLine === false
      ? 'No internet connection. Online AI needs internet; everything else still works offline.'
      : 'Could not reach ' + providerName() + '. Usually the API key is wrong or expired (the provider then blocks the request), or the network is down. Check the key in Settings → AI.';
  }
  return m;
}

// ------------------------------------------------------------ requests
const json = (headers) => Object.assign({ 'Content-Type': 'application/json' }, headers);
function openaiLike(base, extra) {
  return { url: base, headers: json(Object.assign({ Authorization: 'Bearer ' + key() }, extra || {})) };
}
const ENDPOINTS = {
  openai: { chat: () => openaiLike('https://api.openai.com/v1/chat/completions'), models: () => openaiLike('https://api.openai.com/v1/models') },
  xai: { chat: () => openaiLike('https://api.x.ai/v1/chat/completions'), models: () => openaiLike('https://api.x.ai/v1/models') },
  together: { chat: () => openaiLike('https://api.together.xyz/v1/chat/completions'), models: () => openaiLike('https://api.together.xyz/v1/models') },
  openrouter: { chat: () => openaiLike('https://openrouter.ai/api/v1/chat/completions', { 'HTTP-Referer': location.origin, 'X-Title': 'Church Service' }), models: () => openaiLike('https://openrouter.ai/api/v1/models') },
};
const anthropicHeaders = () => json({ 'x-api-key': key(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });

async function textOnce(model, system, prompt, maxTokens) {
  const p = provider();
  if (p === 'google') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', headers: json({ 'x-goog-api-key': key() }),
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens } }),
    });
    if (!r.ok) await fail(r, 'text');
    const j = await r.json();
    return ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((x) => x.text || '').join('');
  }
  if (p === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: anthropicHeaders(),
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) await fail(r, 'text');
    const j = await r.json();
    return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  }
  const ep = ENDPOINTS[p].chat();
  const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] };
  // Newer OpenAI models take max_completion_tokens and only the default temperature.
  if (p === 'openai') body.max_completion_tokens = maxTokens * 4; else { body.max_tokens = maxTokens; body.temperature = 0.4; }
  const r = await fetch(ep.url, { method: 'POST', headers: ep.headers, body: JSON.stringify(body) });
  if (!r.ok) await fail(r, 'text');
  const j = await r.json();
  const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  return Array.isArray(c) ? c.map((x) => x.text || '').join('') : c || '';
}

/** Ask for text. Retries once with a model the key can use if the default is not available. */
export async function aiText({ system, prompt, maxTokens = 700 }) {
  if (!key()) throw new Error('Add an API key in Settings → AI first.');
  const model = modelFor('text');
  try { return await textOnce(model, system, prompt, maxTokens); }
  catch (e) {
    if (!modelMissing(e) || (cfg().model || '').trim()) throw e;
    const list = await listModels().catch(() => null);
    const alt = list && list.text.find((m) => m !== model);
    if (!alt) throw e;
    remember('text', alt);
    return textOnce(alt, system, prompt, maxTokens);
  }
}

function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: type || 'image/png' });
}
async function urlToBlob(url) {
  try { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return await r.blob(); }
  catch (e) { throw new Error('The picture was made, but this browser could not download it from ' + who() + '. Try again, or use another provider.'); }
}
/** Pull the picture out of any of the reply shapes the providers use. */
async function pictureFrom(j) {
  const d = j && j.data && j.data[0];
  if (d && d.b64_json) return b64ToBlob(d.b64_json, d.media_type || 'image/png');
  if (d && d.url) return /^data:image\//.test(d.url) ? b64ToBlob(d.url.split(',')[1], d.url.slice(5, d.url.indexOf(';'))) : urlToBlob(d.url);
  const parts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const p = parts.find((x) => x.inlineData || x.inline_data);
  if (p) { const x = p.inlineData || p.inline_data; return b64ToBlob(x.data, x.mimeType || x.mime_type); }
  return null;
}

/** Can the chosen provider and model take the church's own pictures along with the request? */
export function canAttach() {
  const p = provider();
  return (p === 'openai' && !/^dall-e/.test(modelFor('image'))) || p === 'google';
}
/** A picture sent to the AI is scaled down first (a phone photo can be many MB). */
export async function shrinkPicture(blob, max = 1280) {
  const bmp = await createImageBitmap(blob);
  const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * sc)); c.height = Math.max(1, Math.round(bmp.height * sc));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  const out = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88));
  c.width = c.height = 0;
  if (!out) throw new Error('A picture could not be prepared for the AI.');
  return out;
}
const blobToB64 = (b) => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1] || ''); f.onerror = () => rej(f.error); f.readAsDataURL(b); });

async function imageOnce(model, prompt, refs = []) {
  const p = provider();
  let r;
  if (p === 'openai' && refs.length && !/^dall-e/.test(model)) {
    const fd = new FormData();
    fd.append('model', model); fd.append('prompt', prompt); fd.append('n', '1'); fd.append('size', '1536x1024');
    refs.forEach((b, i) => fd.append('image[]', b, 'picture' + (i + 1) + '.jpg'));
    r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + key() }, body: fd });
  } else if (p === 'google' && refs.length) {
    const pics = await Promise.all(refs.map(async (b) => ({ inlineData: { mimeType: b.type || 'image/jpeg', data: await blobToB64(b) } })));
    const call = (gen) => fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', headers: json({ 'x-goog-api-key': key() }),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt + ' Wide 16:9 landscape format.' }].concat(pics) }], generationConfig: gen }) });
    r = await call({ responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9' } });
    if (r.status === 400) r = await call({ responseModalities: ['TEXT', 'IMAGE'] });
  } else if (p === 'openai') {
    const dalle = /^dall-e/.test(model);
    r = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: openaiLike('').headers,
      body: JSON.stringify(Object.assign({ model, prompt, n: 1, size: dalle ? '1792x1024' : '1536x1024' }, dalle ? { response_format: 'b64_json' } : {})) });
  } else if (p === 'google') {
    const call = (gen) => fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', headers: json({ 'x-goog-api-key': key() }),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt + ' Wide 16:9 landscape format.' }] }], generationConfig: gen }) });
    r = await call({ responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9' } });
    if (r.status === 400) r = await call({ responseModalities: ['TEXT', 'IMAGE'] }); // older image models: no aspect setting
  } else if (p === 'xai') {
    r = await fetch('https://api.x.ai/v1/images/generations', { method: 'POST', headers: openaiLike('').headers,
      body: JSON.stringify({ model, prompt, n: 1, aspect_ratio: '16:9', response_format: 'b64_json' }) });
  } else if (p === 'together') {
    r = await fetch('https://api.together.xyz/v1/images/generations', { method: 'POST', headers: openaiLike('').headers,
      body: JSON.stringify({ model, prompt, n: 1, width: 1536, height: 864, response_format: 'base64' }) });
  } else if (p === 'openrouter') {
    r = await fetch('https://openrouter.ai/api/v1/images', { method: 'POST', headers: openaiLike('', { 'HTTP-Referer': location.origin, 'X-Title': 'Church Service' }).headers,
      body: JSON.stringify({ model, prompt, n: 1, aspect_ratio: '16:9' }) });
  } else throw new Error(providerName() + ' cannot make pictures. Choose OpenAI, Gemini, Grok, Together or OpenRouter in Settings → AI.');
  if (!r.ok) await fail(r, 'picture');
  const blob = await pictureFrom(await r.json());
  if (!blob || !blob.size) throw new Error(who() + ' sent no picture back. Try again or describe the picture differently.');
  return blob;
}

/** Make a picture. Retries once with an image model the key can use if the default is not available. */
export async function aiImage(prompt, refs = []) {
  refs = canAttach() ? await Promise.all((refs || []).filter(Boolean).slice(0, 4).map((b) => shrinkPicture(b))) : [];
  if (!key()) throw new Error('Add an API key in Settings → AI first.');
  if (!canImage()) throw new Error(providerName() + ' cannot make pictures. Choose OpenAI, Gemini, Grok, Together or OpenRouter in Settings → AI.');
  let model = modelFor('image');
  if (!model) { const list = await listModels(); model = list.image[0]; if (!model) throw new Error('This key has no picture models. Choose one in Settings → AI → Test key.'); remember('image', model); }
  try { return await imageOnce(model, prompt, refs); }
  catch (e) {
    if (!modelMissing(e) || (cfg().imageModel || '').trim()) throw e;
    const list = await listModels().catch(() => null);
    const alt = list && list.image.find((m) => m !== model);
    if (!alt) throw e;
    remember('image', alt);
    return imageOnce(alt, prompt, refs);
  }
}

// ------------------------------------------------------------ models
const NOT_TEXT = /(image|imagen|imagine|dall-e|flux|banana|seedream|sdxl|stable-diffusion|tts|whisper|transcribe|audio|realtime|embed|moderation|vision-preview|search|computer-use|codex|aqa|veo|video|music|lyria|rerank|guard)/i;
const IS_IMAGE = /(gpt-image|dall-e|imagen|imagine|flux|banana|seedream|-image)/i;
const version = (id) => { const m = /(\d+(?:\.\d+)?)/.exec(id.replace(/^[^/]*\//, '')); return m ? parseFloat(m[1]) : 0; };
const rank = (re) => (a, b) => (re.test(b) - re.test(a)) || (version(b) - version(a)) || a.localeCompare(b);

/** Models this key can use, best first: {text: [...], image: [...]} */
export async function listModels() {
  if (!key()) throw new Error('Add an API key first.');
  const p = provider();
  let ids = [], imgIds = [];
  if (p === 'google') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key() } });
    if (!r.ok) await fail(r, 'model list');
    const j = await r.json();
    (j.models || []).forEach((m) => {
      if (!(m.supportedGenerationMethods || []).includes('generateContent')) return;
      const id = String(m.name || '').replace(/^models\//, '');
      if (IS_IMAGE.test(id)) imgIds.push(id); else ids.push(id);
    });
  } else if (p === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: anthropicHeaders() });
    if (!r.ok) await fail(r, 'model list');
    ids = ((await r.json()).data || []).map((m) => m.id);
  } else {
    const ep = ENDPOINTS[p].models();
    const r = await fetch(ep.url, { headers: ep.headers });
    if (!r.ok) await fail(r, 'model list');
    const j = await r.json();
    const list = Array.isArray(j) ? j : j.data || [];
    list.forEach((m) => {
      const id = m.id || m.name; if (!id) return;
      const type = (m.type || '').toLowerCase();
      if (type === 'image' || IS_IMAGE.test(id)) imgIds.push(id);
      else if (!type || type === 'chat' || type === 'language') ids.push(id);
    });
    if (p === 'openrouter') {
      try {
        const ri = await fetch('https://openrouter.ai/api/v1/images/models', { headers: ep.headers });
        if (ri.ok) { const ji = await ri.json(); imgIds = (ji.data || []).map((m) => m.id).filter(Boolean); }
      } catch (e) { /* keep what the general list gave */ }
    }
  }
  const text = ids.filter((id) => !NOT_TEXT.test(id)).sort(rank(/(mini|flash|haiku|fast)(?!.*(lite|nano))/i));
  const image = Array.from(new Set(imgIds)).sort(rank(/(gpt-image|banana|imagine|flux)/i));
  return { text, image };
}

// ------------------------------------------------------------ helpers for replies
/** First {...} JSON object in a reply (models sometimes wrap it in ``` fences or add a sentence). */
export function parseJsonReply(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}

/** Words worth a second look before AI text goes on a church screen. Only AI output is checked. */
const FLAG = /\b(violen\w*|weapons?|guns?|drugs?|sex\w*|porn\w*|horror|occult\w*|witchcraft|murder\w*|suicide|kill(?:ed|ing|s)?|hate(?:d|s)?|curse\w*|damn\w*|hell)\b/gi;
export function flaggedWords(text) {
  const m = String(text || '').match(FLAG);
  return m ? Array.from(new Set(m.map((w) => w.toLowerCase()))) : [];
}
