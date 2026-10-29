/* Runs before first paint: applies the saved theme so the page never flashes the wrong colours.
   (Kept as an external file so the pages carry no inline scripts and a strict Content-Security-Policy works.) */
try { var t = localStorage.getItem('dqb_theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) { /* storage blocked: follow the OS theme */ }
