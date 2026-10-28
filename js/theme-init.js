// Apply theme before first paint (kept in a file so the Content Security Policy needs no inline script).
// Settings are named after this app's folder (js/core/storens.js); before the first run of that, the old shared name.
  try { var ns = 'cs' + location.pathname.replace(/[^/]*$/, '');
    var s = JSON.parse(localStorage.getItem(ns + 'settings.v1') || localStorage.getItem('selah.settings.v1') || '{}'); var a = s.app || {};
    document.documentElement.setAttribute('data-theme', a.theme || 'dark');
    if (a.monitors === false) document.documentElement.classList.add('no-mon'); } catch (e) {}
  // Nothing is staged or live at start: phones show the slim monitor strip from the first paint (no jump).
  document.documentElement.classList.add('mon-idle');
