/* Landing page: join-code form (no native dialogs) and the copyright year. */
(function () {
  'use strict';
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  var form = document.getElementById('join');
  if (!form || !window.Net) return;
  var input = document.getElementById('join-code'), err = document.getElementById('join-err');

  function show(msg) { err.textContent = msg; err.hidden = false; input.classList.add('invalid'); input.setAttribute('aria-invalid', 'true'); input.focus(); }
  input.addEventListener('input', function () { err.hidden = true; input.classList.remove('invalid'); input.removeAttribute('aria-invalid'); });

  form.addEventListener('submit', function (e) {
    var parsed = Net.parseJoinInput(input.value);
    if (!parsed) {
      e.preventDefault();
      show(input.value.trim() ? 'That doesn’t look like a class code. It’s 6 letters and numbers, like ABC-123.' : 'Type the class code from your teacher’s screen.');
      return;
    }
    // hand the cleaned-up code to the student app (also works without JavaScript, just less tidy)
    input.value = parsed.code || input.value;
  });
})();
