/* Visitor analytics, powered by Microsoft Clarity (free).
   Clarity shows: number of visits, country/city, device, time spent,
   click heatmaps, scroll maps and screen recordings of real visits.

   To switch it on: paste your Clarity project ID between the quotes below.
   (clarity.microsoft.com > your project > Settings > Overview > Project ID)
   While it is empty, nothing is loaded and nothing is tracked. */
var CLARITY_ID = 'zk2idr7tp1';

(function () {
  // window.track('name') records a named event (e.g. "open: Book 1").
  // In Clarity: Dashboard > filter "Custom events", or Recordings > filter by event.
  window.track = function (name) {
    try { if (window.clarity) window.clarity('event', String(name).slice(0, 100)); } catch (_) {}
  };
  if (!CLARITY_ID) return;

  (function (c, l, a, r, i, t, y) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
  })(window, document, 'clarity', 'script', CLARITY_ID);

  // Every button or link click is logged by its name, e.g. "click: Skip the room".
  // Capture phase, so buttons that stop the click from bubbling are still counted.
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('button, a');
    if (!el) return;
    var label = el.getAttribute('aria-label') || (el.textContent || '').trim() || el.id || el.getAttribute('href') || 'unnamed';
    window.track('click: ' + label.replace(/\s+/g, ' ').slice(0, 60));
  }, true);
})();
