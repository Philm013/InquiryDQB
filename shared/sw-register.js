/* Registers the service worker (offline start-up and instant updates). Used by the Teacher and Student pages. */
(function () {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  var url = new URL('../sw.js', document.currentScript.src).href;                    // /sw.js, so its scope covers the whole site
  window.addEventListener('load', function () { navigator.serviceWorker.register(url).catch(function () { /* optional enhancement */ }); });
})();
