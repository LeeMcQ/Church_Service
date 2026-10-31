// Apply theme before first paint (kept in a file so the Content Security Policy needs no inline script).
// Settings are named after this app's folder (js/core/storens.js); before the first run of that, the old shared name.
// Never shown inside another website's frame (clickjacking). The app's own pages may frame each other.
try { if (window.top !== window.self) { var sameTop = false; try { sameTop = window.top.location.origin === location.origin; } catch (e) { /* cross-origin */ } if (!sameTop) { document.documentElement.style.display = 'none'; try { window.top.location.replace(location.href); } catch (e) { /* */ } } } } catch (e) { /* */ }
  try { var ns = 'cs' + location.pathname.replace(/[^/]*$/, '');
    var s = JSON.parse(localStorage.getItem(ns + 'settings.v1') || localStorage.getItem('selah.settings.v1') || '{}'); var a = s.app || {};
    document.documentElement.setAttribute('data-theme', a.theme || 'dark');
    if (a.monitors === false) document.documentElement.classList.add('no-mon'); } catch (e) {}
  // Nothing is staged or live at start: phones show the slim monitor strip from the first paint (no jump).
  document.documentElement.classList.add('mon-idle');
