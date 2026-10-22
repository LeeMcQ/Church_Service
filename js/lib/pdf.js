// PDF → images, rendered once at import and cached in IndexedDB. pdf.js is loaded only
// when a PDF is imported, so it costs nothing during a service.
let lib = null;
export async function pdfjs() {
  if (!lib) {
    lib = await import('../../vendor/pdfjs/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return lib;
}

function canvasToBlob(c, type, q) {
  return new Promise((res) => c.toBlob((b) => res(b), type, q));
}

export async function thumbOf(source, w = 320) {
  const sw = source.width, sh = source.height;
  const sc = w / sw;
  const c = document.createElement('canvas');
  c.width = Math.round(sw * sc); c.height = Math.round(sh * sc);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  const b = await canvasToBlob(c, 'image/jpeg', 0.8);
  c.width = c.height = 0;
  return b;
}

/**
 * Render every page. onPage(i, {full, thumb, w, h}) is called as each page is ready.
 * boxW/boxH: the display size to render for (pages are fitted inside it).
 */
export async function renderPdf(blob, { boxW = 1920, boxH = 1080, quality = 0.9, onPage, signal } = {}) {
  const pdf = await pdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const doc = await pdf.getDocument({ data, isEvalSupported: false, disableFontFace: false }).promise;
  const n = doc.numPages;
  for (let i = 1; i <= n; i++) {
    if (signal && signal.aborted) break;
    const page = await doc.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.min(boxW / vp1.width, boxH / vp1.height);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const full = await canvasToBlob(c, 'image/jpeg', quality);
    const thumb = await thumbOf(c, 320);
    const res = { full, thumb, w: c.width, h: c.height };
    c.width = c.height = 0; // free memory immediately (matters on 1–2 GB devices)
    page.cleanup();
    if (onPage) await onPage(i - 1, res, n);
  }
  await doc.destroy();
  return n;
}

/** Downscale a picture to fit the display (big phone photos waste RAM on weak PCs). */
export async function prepareImage(file, { boxW = 1920, boxH = 1080, quality = 0.9 } = {}) {
  const bmp = await (window.createImageBitmap ? createImageBitmap(file) : new Promise((res, rej) => {
    const im = new Image(); const u = URL.createObjectURL(file); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = (e) => { URL.revokeObjectURL(u); rej(e); }; im.src = u;
  }));
  const w = bmp.width, hh = bmp.height;
  const sc = Math.min(1, boxW / w, boxH / hh);
  let full = file;
  if (sc < 0.99 || !/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
    const c = document.createElement('canvas');
    c.width = Math.round(w * sc); c.height = Math.round(hh * sc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    full = await canvasToBlob(c, file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality);
    c.width = c.height = 0;
  }
  const thumb = await thumbOf(bmp, 320);
  if (bmp.close) bmp.close();
  return { full, thumb, w: Math.round(w * sc), h: Math.round(hh * sc) };
}
