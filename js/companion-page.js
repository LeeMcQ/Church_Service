// companion.html: lists the companion programs built with the website (download/index.json) and puts the
// one for this computer first. Opened from the companion itself, it fetches the list from the website.
(function () {
  const SITE = 'https://leemcq.github.io/Church_Service/';
  const onSite = /github\.io$/.test(location.hostname);
  const base = (onSite ? new URL('download/', location.href).href : SITE + 'download/');
  const box = document.getElementById('dl'), meta = document.getElementById('meta');
  const LABEL = {
    'church-service-windows-x64.exe': ['Windows (64-bit)', 'win'],
    'church-service-linux-x64': ['Linux PC (64-bit)', 'linux'],
    'church-service-linux-arm64': ['Raspberry Pi 4 / 5 (64-bit)', 'pi'],
  };
  const ua = navigator.userAgent;
  const mine = /Windows/i.test(ua) ? 'win' : /aarch64|arm64|raspbian/i.test(ua) ? 'pi' : /Linux/i.test(ua) && !/Android/i.test(ua) ? 'linux' : 'win';
  const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
  const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); Object.assign(e, attrs || {}); kids.forEach((k) => e.append(k)); return e; };
  fetch(base + 'index.json', { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((info) => {
    const files = (info.files || []).filter((f) => LABEL[f.name]);
    box.replaceChildren();
    if (!files.length) throw new Error('none');
    files.sort((a, b) => (LABEL[b.name][1] === mine) - (LABEL[a.name][1] === mine));
    files.forEach((f, i) => {
      const main = i === 0 && LABEL[f.name][1] === mine;
      box.append(el('a', { className: 'b' + (main ? ' main' : ''), href: base + f.name, download: f.name },
        el('span', {}, (main ? 'Download for ' : '') + LABEL[f.name][0]), el('span', { className: 's' }, mb(f.size))));
    });
    meta.textContent = 'Built ' + (info.built || '') + (info.commit ? ' from version ' + info.commit : '') + '.';
  }).catch(() => {
    box.replaceChildren(el('p', { className: 'err' }, 'The download list could not be loaded. Check the internet connection and reload, or get the files from '),
      el('a', { href: 'https://github.com/LeeMcQ/Church_Service/actions/workflows/pages.yml' }, 'the latest website build on GitHub'));
  });
})();
