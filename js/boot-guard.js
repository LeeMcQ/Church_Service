// Start-up safety net (a plain script, so it runs even if the app's modules cannot load).
// If Church Service has not started after a while, explain what to do instead of showing a blank page.
(function () {
  var shown = false;
  function online(cb) {
    // A file the service worker never stores: only reachable with real internet.
    try { fetch('sw.js?ping=' + Date.now(), { cache: 'no-store' }).then(function (r) { cb(r.ok); }, function () { cb(false); }); } catch (e) { cb(false); }
  }
  function show(why) {
    if (shown || window.__selahBooted) return;
    shown = true;
    var d = document.createElement('div');
    d.id = 'bootGuard';
    d.setAttribute('role', 'alert');
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:#161c28;color:#e9e4d8;font:16px/1.5 system-ui,sans-serif;padding:24px';
    d.innerHTML = '<div style="max-width:520px"><h2 style="margin:0 0 10px">Church Service is taking long to start</h2>' +
      '<p style="margin:0 0 14px">' + (navigator.onLine ? 'Part of the app did not load.' : 'This device is offline and part of the app did not load from its offline copy.') +
      ' Try these in order:</p><div style="display:flex;flex-wrap:wrap;gap:8px">' +
      '<button id="bgReload" style="padding:8px 14px">Reload</button>' +
      '<button id="bgRepair" style="padding:8px 14px">Repair offline files</button>' +
      '<button id="bgFresh" style="padding:8px 14px">Download a fresh copy (needs internet)</button></div>' +
      '<p id="bgMsg" style="margin:12px 0 0;opacity:.8;font-size:14px">' + (why || '') + '</p></div>';
    document.body.appendChild(d);
    var msg = d.querySelector('#bgMsg');
    d.querySelector('#bgReload').onclick = function () { location.reload(); };
    d.querySelector('#bgRepair').onclick = function () {
      var c = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (!c) { msg.textContent = 'The offline copy is not installed on this device yet. Open the app once with internet.'; return; }
      msg.textContent = 'Checking stored files…';
      navigator.serviceWorker.addEventListener('message', function (e) {
        if (e.data && e.data.t === 'health') { msg.textContent = (e.data.missingCount ? e.data.missingCount + ' files still missing (connect to the internet to fetch them).' : 'All files are stored.') + ' Reloading…'; setTimeout(function () { location.reload(); }, 1500); }
      });
      c.postMessage({ t: 'check', repair: true });
    };
    d.querySelector('#bgFresh').onclick = function () {
      msg.textContent = 'Checking the internet…';
      online(function (ok) {
        // Never throw away the offline copy without internet to fetch a new one.
        if (!ok) { msg.textContent = 'No internet right now, so the offline copy is kept. Try Reload, or connect first.'; return; }
        msg.textContent = 'Downloading a fresh copy…';
        var done = function () { location.replace(location.pathname + '?v=' + Date.now()); };
        (navigator.serviceWorker ? navigator.serviceWorker.getRegistrations() : Promise.resolve([])).then(function (rs) {
          // Only this app's own worker (the other app on this site keeps its own).
          return Promise.all(rs.filter(function (r) { return location.href.indexOf(r.scope) === 0; }).map(function (r) { return r.unregister(); }));
        }).then(function () { return window.caches ? caches.keys() : []; }).then(function (ks) {
          // Only this app's own caches (another app on the same site keeps its offline files).
          var mine = 'selah-' + location.pathname.replace(/[^\/]*$/, '') + '|';
          return Promise.all(ks.filter(function (k) { return k.indexOf(mine) === 0; }).map(function (k) { return caches.delete(k); }));
        }).then(done, done);
      });
    };
  }
  // A script of the app that fails to load shows the help at once.
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'SCRIPT' && !window.__selahBooted) show('A file of the app could not be loaded: ' + (t.src || '').replace(location.origin, ''));
  }, true);
  setTimeout(function () { show(''); }, 15000);
})();
