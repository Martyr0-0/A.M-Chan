// The A.M Chan website: shows whether A.M's PC is online and lists the installers.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ua = navigator.userAgent || '';
  var isPhone = /iPhone|iPad|iPod|Android/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));

  $('year').textContent = '© ' + new Date().getFullYear();

  // a phone sees the phone app first; the Windows installer is still below
  if (isPhone) {
    var d = $('ctaDownload'), p = $('ctaPhone');
    p.className = 'btn primary';
    d.className = 'btn ghost';
    d.textContent = 'PC download (Windows)';
    p.parentNode.insertBefore(p, d);
    $('ctaFine').textContent = 'Add it to your home screen to use it like an app.';
  }

  function size(n) {
    return n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : Math.round(n / 1e6) + ' MB';
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function status() {
    fetch('/v1/public', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (j) {
        var s = $('status');
        s.className = 'status on';
        var t = j.talking + ' talking';
        if (j.waiting) t += ', ' + j.waiting + ' waiting';
        if (j.ownerBusy) t = 'busy right now';
        s.lastChild.textContent = 'A.M is online · ' + t;
        $('slots').textContent = j.slots;
      })
      .catch(function () {
        var s = $('status');
        s.className = 'status off';
        s.lastChild.textContent = 'A.M is offline';
      });
  }
  status();
  setInterval(status, 20000);

  fetch('/v1/downloads', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var box = $('dlList');
      box.textContent = '';
      var files = (j.files || []).filter(function (f) { return /\.exe$/.test(f.name); });
      if (!files.length) {
        box.appendChild(el('p', 'muted center', 'The PC download is not available right now. Try again soon.'));
        return;
      }
      // the easy connected copy first, then the standalone one
      files.sort(function (a, b) { return /Standalone/.test(a.name) - /Standalone/.test(b.name); });
      files.forEach(function (f) {
        var standalone = /Standalone/.test(f.name);
        var v = (/(\d+\.\d+\.\d+)/.exec(f.name) || [])[1] || '';
        var item = el('div', 'dl-item');
        var left = el('div');
        left.appendChild(el('h3', '', standalone ? 'Standalone' + (v ? ' ' + v : '') : 'Connect to A.M\'s PC' + (v ? ' ' + v : '')));
        left.appendChild(el('p', '', (standalone ? 'Runs fully on your own PC (needs Ollama and the models). ' : 'No AI needed on your PC. ') + size(f.size) + ' · Windows 64-bit'));
        var a = el('a', 'btn primary', 'Download');
        a.href = '/downloads/' + encodeURIComponent(f.name);
        a.setAttribute('download', f.name);
        item.appendChild(left);
        item.appendChild(a);
        if (f.sha256) {
          var sh = el('div', 'sha');
          sh.appendChild(document.createTextNode('SHA-256 '));
          sh.appendChild(el('code', '', f.sha256));
          item.appendChild(sh);
        }
        box.appendChild(item);
      });
    })
    .catch(function () {
      $('dlList').textContent = '';
      $('dlList').appendChild(el('p', 'muted center', 'Could not load the downloads.'));
    });
})();
