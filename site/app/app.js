// A.M Chan phone app. Talks to the hub it was loaded from (the owner's PC).
//   /v1/signup, /v1/login   an account with a username and password (the owner lets it in once)
//   /v1/me                  who am I, am I approved, and my chats (up to 3)
//   /v1/chats               new / get / delete one of my chats
//   /v1/send, /v1/poll      one message into a chat, then wait for her answer (with my place in line)
// The hub keeps the chats, so they are the same on every device you log in on. The owner can read them.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  var memToken = '';
  var token = store.get('amToken') || '';
  var username = store.get('amUser') || '';
  var mode = store.get('amMode') === 'complex' ? 'complex' : 'simple';

  // ----- talking to the hub -----
  function api(route, body, ms) {
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, ms || 15000);
    var headers = { 'Content-Type': 'application/json' };
    if (token || memToken) headers['X-AM-Token'] = token || memToken;
    return fetch(route, { method: 'POST', headers: headers, body: JSON.stringify(body || {}), signal: ctl.signal, cache: 'no-store' }).then(function (res) {
      clearTimeout(t);
      return res.json().catch(function () { return {}; }).then(function (j) { return { net: true, status: res.status, json: j }; });
    }, function () {
      clearTimeout(t);
      return { net: false, status: 0, json: {} };
    });
  }

  // ----- screens -----
  var views = ['vAuth', 'vPending', 'vBlocked', 'vOffline', 'vChats', 'vChat'];
  var current = '';
  function show(v) {
    if (current === v) return;
    current = v;
    views.forEach(function (id) { $(id).hidden = id !== v; });
    if (v === 'vChat') { fit(); scrollEnd(); }
  }

  // ----- log in and sign up -----
  var signupMode = false;
  var consentText = '';
  function setTab(signup) {
    signupMode = signup;
    $('tabLogin').classList.toggle('on', !signup);
    $('tabSignup').classList.toggle('on', signup);
    $('signupExtra').hidden = !signup;
    $('authBtn').textContent = signup ? 'Create account' : 'Log in';
    $('passInput').autocomplete = signup ? 'new-password' : 'current-password';
    $('authError').hidden = true;
    if (signup && !consentText) {
      api('/v1/consent', {}).then(function (r) {
        consentText = (r.json && r.json.text) || 'The owner of this PC can read your chats and sees your connection address.';
        $('consentText').textContent = consentText;
      });
    } else $('consentText').textContent = consentText;
  }
  $('tabLogin').addEventListener('click', function () { setTab(false); });
  $('tabSignup').addEventListener('click', function () { setTab(true); });
  function authError(text) {
    $('authError').textContent = text;
    $('authError').hidden = !text;
  }
  async function login(u, p) {
    var r = await api('/v1/login', { username: u, password: p });
    if (!r.net) { authError("Couldn't reach A.M. Check your connection."); return false; }
    if (r.status !== 200) { authError(r.json.error || 'Something went wrong.'); return false; }
    token = r.json.token;
    memToken = token;
    store.set('amToken', token);
    username = r.json.username;
    store.set('amUser', username);
    return true;
  }
  $('authForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    authError('');
    var u = $('userInput').value.trim();
    var p = $('passInput').value;
    if (!u || !p) return;
    $('authBtn').disabled = true;
    try {
      if (signupMode) {
        if (!$('consentBox').checked) { authError('Tick the box to agree first.'); return; }
        var r = await api('/v1/signup', { username: u, password: p, consent: true });
        if (!r.net) { authError("Couldn't reach A.M. Check your connection."); return; }
        if (r.status !== 200) { authError(r.json.error || 'Something went wrong.'); return; }
      }
      if (await login(u, p)) {
        $('passInput').value = '';
        await refresh(true);
      }
    } finally {
      $('authBtn').disabled = false;
    }
  });

  function logout() {
    api('/v1/logout', {});
    token = '';
    memToken = '';
    store.del('amToken');
    stopFollowing();
    clearTimeout(pendingTimer);
    menu(false);
    setTab(false);
    show('vAuth');
  }
  $('logoutBtn').addEventListener('click', logout);
  $('pendingOut').addEventListener('click', logout);
  $('blockedOut').addEventListener('click', logout);

  // ----- who am I, and my chats -----
  var chats = [];
  var maxChats = 3;
  var pendingTimer = 0;
  async function refresh(goToList) {
    clearTimeout(pendingTimer);
    if (!token && !memToken) { setTab(false); return show('vAuth'); }
    var r = await api('/v1/me', {}, 10000);
    if (!r.net) {
      $('offlineText').textContent = navigator.onLine ? "Her home PC isn't online right now. Try again in a little while." : 'Your phone has no connection.';
      if (current !== 'vChat') show('vOffline');
      pendingTimer = setTimeout(function () { refresh(false); }, 6000);
      return;
    }
    if (r.status === 401) { token = ''; memToken = ''; store.del('amToken'); setTab(false); return show('vAuth'); }
    var j = r.json;
    username = j.username || username;
    maxChats = j.max || 3;
    if (j.status === 'pending') {
      $('pendingName').textContent = username;
      show('vPending');
      pendingTimer = setTimeout(function () { refresh(false); }, 4000);
    } else if (j.status === 'approved') {
      chats = j.chats || [];
      paintList();
      if (goToList || current === 'vPending' || current === 'vOffline' || current === 'vAuth' || current === '') show('vChats');
      if (current === 'vChat') $('topStatus').textContent = busy ? 'typing...' : 'online';
      pendingTimer = setTimeout(function () { refresh(false); }, 30000);
    } else {
      $('blockedText').textContent = j.status === 'banned' ? 'This account has been blocked.' : 'The owner turned off access for this account.';
      show('vBlocked');
      pendingTimer = setTimeout(function () { refresh(false); }, 30000);
    }
  }
  $('pendingCheck').addEventListener('click', function () { refresh(false); });
  $('offlineRetry').addEventListener('click', function () { refresh(false); });

  function ago(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }
  function paintList() {
    var box = $('chatList');
    box.textContent = '';
    $('chatsSub').textContent = chats.length + ' of ' + maxChats + ' chats';
    if (!chats.length) {
      var e = document.createElement('p');
      e.className = 'muted center pad';
      e.textContent = 'No chats yet. Start one!';
      box.appendChild(e);
    }
    chats.forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'chatrow';
      var open = document.createElement('button');
      open.type = 'button';
      open.className = 'chatopen';
      var t = document.createElement('b');
      t.textContent = c.title || 'New chat';
      var s = document.createElement('small');
      s.textContent = c.count + (c.count === 1 ? ' message' : ' messages') + ' · ' + ago(c.updated);
      open.appendChild(t);
      open.appendChild(s);
      open.addEventListener('click', function () { openChat(c.id); });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'chatdel';
      del.textContent = '🗑';
      del.setAttribute('aria-label', 'Delete this chat');
      del.addEventListener('click', function () {
        if (!del.classList.contains('sure')) {
          del.classList.add('sure');
          del.textContent = 'Delete?';
          setTimeout(function () { del.classList.remove('sure'); del.textContent = '🗑'; }, 3000);
          return;
        }
        api('/v1/chats', { action: 'delete', id: c.id }).then(function (r) {
          if (r.net && r.status === 200) { chats = r.json.chats || []; paintList(); }
        });
      });
      row.appendChild(open);
      row.appendChild(del);
      box.appendChild(row);
    });
    var full = chats.length >= maxChats;
    $('newChatBtn').disabled = full;
    $('chatLimit').hidden = !full;
    $('chatLimit').textContent = 'You can have ' + maxChats + ' chats. Delete one to start another.';
  }
  $('newChatBtn').addEventListener('click', async function () {
    var r = await api('/v1/chats', { action: 'new' });
    if (r.net && r.status === 200) { chats = r.json.chats || []; openChat(r.json.chat.id); }
    else if (r.net && r.status === 409) { chats = r.json.chats || chats; paintList(); }
  });

  // ----- a chat -----
  var chatId = '';
  var history = [];
  var busy = false;
  var jobId = '';
  var typingEl = null;
  var log = $('log');
  var followToken = 0;

  function scrollEnd() { log.scrollTop = log.scrollHeight; }
  function fill(el, text) {
    el.textContent = '';
    text.split('```').forEach(function (part, i) {
      if (i % 2) {
        var pre = document.createElement('pre');
        pre.textContent = part.replace(/^[a-z0-9+#-]*\n/i, '').replace(/\n$/, '');
        el.appendChild(pre);
      } else if (part) {
        // **bold** shows as bold; everything else is plain text, never HTML
        (i ? part.replace(/^\n/, '') : part).split(/(\*\*[^*\n]+\*\*)/).forEach(function (bit) {
          if (/^\*\*[^*\n]+\*\*$/.test(bit)) {
            var b = document.createElement('strong');
            b.textContent = bit.slice(2, -2);
            el.appendChild(b);
          } else if (bit) {
            el.appendChild(document.createTextNode(bit));
          }
        });
      }
    });
  }
  function bubble(kind, text) {
    var d = document.createElement('div');
    d.className = 'msg ' + kind;
    fill(d, text);
    log.appendChild(d);
    scrollEnd();
    return d;
  }
  function typing() {
    if (typingEl) return;
    typingEl = document.createElement('div');
    typingEl.className = 'msg ai';
    typingEl.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>'; // fixed markup, no user text
    log.appendChild(typingEl);
    scrollEnd();
  }
  function untyping() { if (typingEl) typingEl.remove(); typingEl = null; }
  function render() {
    log.textContent = '';
    if (!history.length) bubble('info', "Say hi to A.M. She's on her owner's PC, so there may be a short line. The owner can read this chat.");
    history.forEach(function (m) { bubble(m.role === 'user' ? 'me' : 'ai', m.content); });
  }
  function setBusy(b) {
    busy = b;
    $('sendBtn').disabled = b;
    $('topFace').classList.toggle('talking', b);
    $('topStatus').textContent = b ? 'typing...' : 'online';
    if (!b) { untyping(); $('queueBar').hidden = true; }
  }
  function setMode(m) {
    mode = m;
    store.set('amMode', m);
    $('modeSimple').classList.toggle('on', m === 'simple');
    $('modeComplex').classList.toggle('on', m === 'complex');
  }
  function net(down) { $('netBanner').hidden = !down; }
  function stopFollowing() { followToken++; jobId = ''; }

  async function openChat(id) {
    var r = await api('/v1/chats', { action: 'get', id: id });
    if (!r.net) { net(true); return; }
    if (r.status !== 200) { refresh(true); return; }
    stopFollowing();
    chatId = id;
    history = (r.json.messages || []).map(function (m) { return { role: m.role, content: m.content }; });
    setBusy(false);
    setMode(mode);
    render();
    show('vChat');
    // she was still answering when you left (or the phone slept): carry on waiting for her
    if (r.json.job && (r.json.job.status === 'queued' || r.json.job.status === 'running')) {
      setBusy(true);
      typing();
      jobId = r.json.job.job;
      follow(jobId, r.json.job);
    } else if (r.json.job && r.json.job.status === 'done') {
      refresh(false);
    }
  }
  $('backBtn').addEventListener('click', function () { stopFollowing(); setBusy(false); net(false); refresh(true); });

  function queueUi(j) {
    var bar = $('queueBar');
    if (j.status !== 'queued') { bar.hidden = true; return; }
    bar.hidden = false;
    var place = j.place || 1;
    $('queueTitle').textContent = place <= 1 && !j.ownerBusy ? "You're next" : 'You\'re number ' + place + ' in line';
    $('queueSub').textContent = j.ownerBusy || j.paused ? 'The owner is using A.M right now. You keep your place.' : (j.slots || 2) + ' people can talk to her at once.';
  }

  async function send(text) {
    if (busy || !chatId) return;
    history.push({ role: 'user', content: text });
    if (history.length === 1) log.textContent = '';
    bubble('me', text);
    setBusy(true);
    typing();
    var r = await api('/v1/send', { chat: chatId, text: text, mode: mode }, 15000);
    if (!r.net) return fail("Couldn't reach A.M. Check your connection and try again.", text);
    if (r.status === 401 || r.status === 403) { setBusy(false); refresh(true); return; }
    if (r.status === 200 || r.status === 409 && r.json.job) {
      jobId = r.json.job;
      return follow(jobId, r.json);
    }
    fail(r.json.error || 'Something went wrong.', text);
  }
  function fail(text, restore) {
    stopFollowing();
    if (restore && history.length && history[history.length - 1].role === 'user') {
      history.pop(); // lets you send it again
      $('input').value = restore;
      grow();
    }
    setBusy(false);
    render();
    bubble('err', text);
  }

  // waits for news about the job; the hub holds each question for up to 20 seconds, so this is quick and light
  async function follow(id, first) {
    var mine = ++followToken;
    var v = -1;
    var fails = 0;
    if (first) { v = first.v; queueUi(first); }
    while (mine === followToken) {
      var r = await api('/v1/poll', { job: id, v: v }, 35000);
      if (mine !== followToken) return;
      if (!r.net) {
        fails++;
        net(true);
        if (fails > 60) { net(false); return fail('Lost the connection to A.M.'); }
        await sleep(Math.min(8000, 800 * fails));
        continue;
      }
      net(false);
      fails = 0;
      if (r.status === 401 || r.status === 403) { stopFollowing(); setBusy(false); refresh(true); return; }
      if (r.status === 404) { stopFollowing(); setBusy(false); openChat(chatId); return; }
      var j = r.json;
      if (typeof j.v === 'number') v = j.v;
      if (j.status === 'queued') { queueUi(j); continue; }
      if (j.status === 'running') { $('queueBar').hidden = true; continue; }
      jobId = '';
      if (j.status === 'done') {
        history.push({ role: 'assistant', content: j.text || '...' });
        setBusy(false);
        bubble('ai', j.text || '...');
      } else if (j.status === 'cancelled') {
        setBusy(false);
        bubble('info', j.error || 'Cancelled.');
      } else {
        setBusy(false);
        bubble('err', j.error || 'A.M could not answer right now.');
      }
      return;
    }
  }

  // ----- the message box -----
  var input = $('input');
  function grow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }
  input.addEventListener('input', grow);
  var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  input.addEventListener('keydown', function (e) {
    // on a computer Enter sends and Shift+Enter makes a new line; on a phone Enter is always a new line
    if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.isComposing) {
      e.preventDefault();
      $('composer').requestSubmit();
    }
  });
  $('composer').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    grow();
    send(text.slice(0, 8000));
    if (!coarse) input.focus(); // on a phone, keep the keyboard from jumping around
  });
  $('cancelBtn').addEventListener('click', function () { if (jobId) api('/v1/cancel', { job: jobId }, 8000); });
  $('modeSimple').addEventListener('click', function () { setMode('simple'); });
  $('modeComplex').addEventListener('click', function () { setMode('complex'); });

  // ----- keyboard and screen size (the message box must never hide behind the keyboard) -----
  function fit() {
    var vv = window.visualViewport;
    var h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-h', h + 'px');
    $('app').style.transform = vv && vv.offsetTop ? 'translateY(' + vv.offsetTop + 'px)' : '';
    if (current === 'vChat') scrollEnd();
  }
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', fit);
    visualViewport.addEventListener('scroll', fit);
  }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', function () { setTimeout(fit, 250); });
  fit();

  // ----- menu, install -----
  function menu(open) {
    $('menuName').textContent = username || 'A.M Chan';
    $('menuNotice').textContent = 'The owner of this PC can read your chats.';
    $('menu').hidden = !open;
  }
  $('menuBtn2').addEventListener('click', function () { menu(true); });
  $('menuClose').addEventListener('click', function () { menu(false); });
  $('menu').addEventListener('click', function (e) { if (e.target === $('menu')) menu(false); });

  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  var ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  if (ios && !standalone) $('iosHint').hidden = false;
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    $('installBtn').hidden = false;
  });
  $('installBtn').addEventListener('click', function () {
    if (!deferred) return;
    deferred.prompt();
    deferred.userChoice.finally(function () { deferred = null; $('installBtn').hidden = true; menu(false); });
  });
  window.addEventListener('appinstalled', function () { $('installBtn').hidden = true; });

  window.addEventListener('online', function () { net(false); refresh(false); });
  window.addEventListener('offline', function () { net(true); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && current !== 'vAuth') refresh(false); });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(function () {});
  }

  setMode(mode);
  setTab(false);
  if (token) refresh(true);
  else show('vAuth');
})();
