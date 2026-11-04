/* Registers the service worker (offline start-up and instant updates). Used by the Teacher and Student pages. */
(function () {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;          // needs https:// or http://localhost
  var url = new URL('../sw.js', document.currentScript.src).href;                    // /sw.js, so its scope covers the whole site
  // the app still works online without it, so failures only warn, but they never pass silently
  function warn(why) { console.warn('InquiryDQB: offline support could not be set up: ' + why); }
  function register() {
    navigator.serviceWorker.register(url).then(function (reg) {
      var w = reg.installing, installed = false;
      if (w) w.addEventListener('statechange', function () {
        if (w.state === 'installed') installed = true;
        else if (w.state === 'redundant' && !installed) warn('part of the app could not be downloaded; the browser will try again on the next visit');
      });
    }, function (err) { warn((err && err.message) || String(err)); });
  }
  if (document.readyState === 'complete') register(); else window.addEventListener('load', register);
})();
