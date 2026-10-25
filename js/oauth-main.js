// oauth.html: Google sends the sign-in answer here (#access_token=…). Pass it to the SDA Sabbath page that
// asked (a pop-up's opener, or, on phones where it opened as a separate tab, through localStorage).
(function () {
  var q = new URLSearchParams(location.hash.replace(/^#/, '') || location.search.replace(/^\?/, ''));
  var data = { t: 'google-token', access_token: q.get('access_token') || '', expires_in: q.get('expires_in') || '', state: q.get('state') || '', error: q.get('error') || '' };
  var want = null;
  try { want = localStorage.getItem('selah.gdrive.state'); } catch (e) { /* */ }
  history.replaceState(null, '', location.pathname); // the token never stays in the address bar or history
  var ok = !data.error && data.access_token && data.state && (!want || want === data.state);
  try { if (window.opener && !window.opener.closed) window.opener.postMessage(data, location.origin); } catch (e) { /* */ }
  try { localStorage.setItem('selah.gdrive.reply', JSON.stringify(data)); } catch (e) { /* */ }
  document.getElementById('h').textContent = ok ? 'Signed in to Google' : 'Google sign-in did not finish';
  document.getElementById('p').textContent = ok ? 'Go back to SDA Sabbath. This window can be closed.' : (data.error === 'access_denied' ? 'It was cancelled. Go back to SDA Sabbath and try again.' : 'Go back to SDA Sabbath and try again.');
  setTimeout(function () { try { window.close(); } catch (e) { /* */ } }, 800);
})();
