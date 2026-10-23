// Android app glue (SDA Sabbath APK, Capacitor). Classic script, runs before the app modules.
// Does nothing on the website: it only acts when the page runs inside the native Capacitor shell,
// which serves these same files from https://localhost/ inside the APK.
(function () {
  'use strict';
  var C = window.Capacitor;
  if (!C || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform()) return;
  window.SDA_NATIVE = true;
  document.documentElement.classList.add('native-app');
  var P = C.Plugins || {};

  // 1) Pop-ups. An Android WebView has no second window: window.open would replace the app page.
  //    Web pages (http/https on another origin) open in a Chrome Custom Tab; everything else
  //    (display window, stage monitor, overlay) returns null so the app shows its own fallback.
  window.open = function (url) {
    try {
      if (url) {
        var u = new URL(url, location.href);
        if (/^https?:$/.test(u.protocol) && u.origin !== location.origin) {
          if (P.Browser) P.Browser.open({ url: u.href });
          // A stand-in window object: callers only check that it is not null / closed.
          return { closed: false, focus: function () {}, close: function () {}, postMessage: function () {} };
        }
      }
    } catch (e) { /* bad URL: treat as blocked */ }
    return null;
  };

  // 2) Android back button: close the top dialog or menu, leave the full-screen display,
  //    go back to the first tab, and only then leave the app (minimised, so a running
  //    service keeps its state if back is pressed by mistake).
  function esc(el) { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); }
  function onBack() {
    var menu = document.querySelector('.menu');
    if (menu) { esc(menu); return; }
    var backs = document.querySelectorAll('.modal-back');
    if (backs.length) { var x = backs[backs.length - 1].querySelector('.modal-h button'); if (x) x.click(); else esc(backs[backs.length - 1]); return; }
    var self = document.querySelector('.self-display .self-close');
    if (self) { self.click(); return; }
    if (document.fullscreenElement && document.exitFullscreen) { document.exitFullscreen().catch(function () {}); return; }
    var tabs = document.querySelectorAll('#rail [role=tab]');
    if (tabs.length && tabs[0].getAttribute('aria-selected') !== 'true') { tabs[0].click(); return; }
    if (P.App && P.App.minimizeApp) P.App.minimizeApp(); else if (P.App) P.App.exitApp();
  }
  if (P.App && P.App.addListener) P.App.addListener('backButton', onBack);
  window.SDA_NATIVE_BACK = onBack; // for tests

  // 3) Boot guard: never leave a silent blank screen. If a script fails to load or the app has not
  //    drawn its tabs after 12 s, show what went wrong with a Retry button.
  var booted = false, firstErr = '';
  function mounted() { var r = document.getElementById('rail'); return !!(r && r.children.length); }
  function fail(why) {
    if (booted || mounted() || document.getElementById('bootFail')) return;
    var d = document.createElement('div');
    d.id = 'bootFail';
    d.setAttribute('style', 'position:fixed;inset:0;z-index:9999;background:#161c28;color:#e9e4d8;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;font:16px/1.5 system-ui,sans-serif');
    d.innerHTML = '<b style="font-size:20px">SDA Sabbath did not start</b><div></div><button type="button" style="font:inherit;padding:10px 22px;border-radius:8px;border:0;background:#d6a23a;color:#161c28;font-weight:700">Retry</button>';
    d.children[1].textContent = why || 'Unknown error';
    d.children[2].onclick = function () { location.reload(); };
    (document.body || document.documentElement).appendChild(d);
  }
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) firstErr = firstErr || ('Could not load ' + (t.src || t.href));
    else if (e.message) firstErr = firstErr || e.message;
    if (firstErr) setTimeout(function () { fail(firstErr); }, 1500);
  }, true);
  setTimeout(function () { booted = mounted(); fail(firstErr || 'The app did not finish loading in 12 seconds.'); }, 12000);
})();
