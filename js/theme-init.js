// Apply theme before first paint (kept in a file so the Content Security Policy needs no inline script).
  try { var s = JSON.parse(localStorage.getItem('selah.settings.v1') || '{}'); var a = s.app || {};
    document.documentElement.setAttribute('data-theme', a.theme || 'dark');
    if (a.monitors === false) document.documentElement.classList.add('no-mon'); } catch (e) {}
  // Nothing is staged or live at start: phones show the slim monitor strip from the first paint (no jump).
  document.documentElement.classList.add('mon-idle');
