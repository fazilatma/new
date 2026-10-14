/* ===========================================================================
 * s4-csmobile.js  v2.0   --  Replit-like mobile shell for code-server
 * ---------------------------------------------------------------------------
 * Injected by deploy/s4-csproxy.js as ONE classic <script nonce="..."> tag:
 * code-server/VS Code send  script-src 'self' ... 'nonce-XYZ'  (no
 * 'unsafe-inline'), so an inline script without that nonce is silently
 * blocked by the browser.  The proxy reuses the page's own nonce.
 *
 * What it builds
 *   - top bar      : menu, command palette, zoom -, zoom %, zoom +, keyboard,
 *                    fullscreen, hide
 *   - extra keys   : Esc Tab Ctrl Alt arrows Home End PgUp PgDn Del Enter and
 *                    the symbols a phone keyboard hides (/ - : ; ' " $ | & * {}
 *                    [] ` \ ? ! @ # % ^ ~ + = < > , . _)
 *   - bottom dock  : Files Search Git Terminal Output Editor More  (tabs, like
 *                    the Replit mobile app)
 *   - more sheet   : palette, sidebar, panel, split, save all, close editor,
 *                    zen, reload, zoom reset, hide bars
 *
 * How it drives VS Code (three strategies, in order, each verified)
 *   1. click the real DOM node  (#workbench.view.explorer, panel tabs, ...)
 *   2. open the command palette and click the first filtered row
 *   3. dispatch a synthetic keybinding
 * Every attempt is logged and reported to the proxy (GET /__s4mobile), so a
 * diagnostic round can see hard evidence instead of guesses.
 *
 * Nothing here is required for forced zoom: the CSS layer does that on its
 * own, even if this script is blocked.  This script only makes zoom
 * adjustable and adds the mobile shell.
 * =========================================================================== */
(function () {
  'use strict';
  if (window.__s4mob) { return; }

  var VERSION = '2.0';
  var CFG = window.__s4proxy || {};
  var BASE = CFG.base || '/__s4mobile';
  var LS_ZOOM = 's4-cs-zoom';
  var LS_PREF = 's4-cs-pref';

  var ZMIN = 0.6, ZMAX = 3.0, ZSTEP = 0.05;

  var state = {
    v: VERSION,
    zoom: typeof CFG.zoom === 'number' ? CFG.zoom : 1.3,
    zoomSupported: true,
    ready: false,
    login: false,
    bars: true,
    keys: true,
    stickyCtrl: false,
    stickyAlt: false,
    log: [],
    acts: {},
    errs: [],
    sent: 0
  };

  /* ---------------------------------------------------------------- utils */
  function log(msg) {
    var line = String(msg);
    state.log.push(line);
    if (state.log.length > 60) { state.log.shift(); }
    try { if (window.console && console.debug) { console.debug('[s4mob] ' + line); } } catch (e) {}
  }
  function fail(where, e) {
    var m = where + ': ' + ((e && (e.message || e.name)) || e);
    try {
      if (e && e.stack) {
        var st = String(e.stack).split('\n').slice(1, 3).join(' <- ').replace(/\s+/g, ' ').trim();
        if (st) { m += ' @ ' + st.slice(0, 180); }
      }
    } catch (e2) {}
    state.errs.push(m);
    if (state.errs.length > 20) { state.errs.shift(); }
    log('ERR ' + m);
  }
  function clamp(n, a, b) { return n < a ? a : (n > b ? b : n); }
  function $(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
  function $$(sel, root) { try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; } }
  function byId(id) { return document.getElementById(id); }
  function rect(n) { try { return n.getBoundingClientRect(); } catch (e) { return { width: 0, height: 0, top: 0, left: 0 }; } }
  function shown(n) {
    if (!n) { return false; }
    var r = rect(n);
    if (r.width > 1 && r.height > 1) { return true; }
    var cs = window.getComputedStyle ? getComputedStyle(n) : null;
    return !!cs && cs.display !== 'none' && cs.visibility !== 'hidden';
  }
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (txt !== undefined && txt !== null) { n.textContent = txt; }
    return n;
  }
  function store(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function recall(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }

  /* ------------------------------------------------------------ synthetic */
  /* Real clicks: VS Code listens for pointer/mouse down+up on its widgets. */
  function click(node) {
    if (!node) { return false; }
    try {
      var r = rect(node);
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      var opt = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1, clientX: x, clientY: y };
      if (window.PointerEvent) {
        node.dispatchEvent(new PointerEvent('pointerdown', opt));
        node.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, opt, { buttons: 0 })));
      }
      node.dispatchEvent(new MouseEvent('mousedown', opt));
      node.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, opt, { buttons: 0 })));
      node.dispatchEvent(new MouseEvent('click', Object.assign({}, opt, { buttons: 0 })));
      return true;
    } catch (e) {
      try { node.click(); return true; } catch (e2) { fail('click', e2); return false; }
    }
  }

  function keyOpt(spec, target) {
    var r = rect(target || document.body);
    return {
      bubbles: true, cancelable: true, view: window,
      key: spec.key, code: spec.code || '', keyCode: spec.keyCode || 0, which: spec.keyCode || 0,
      charCode: spec.charCode || 0,
      ctrlKey: !!spec.ctrl, shiftKey: !!spec.shift, altKey: !!spec.alt, metaKey: !!spec.meta,
      location: spec.location || 0,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
    };
  }

  /* Synthetic keybinding.  Monaco accepts untrusted keydown for keybindings,
     but we dispatch on the focused element AND on document/window so that
     whichever listener exists gets it. */
  function sendKey(spec) {
    var targets = [];
    var ae = document.activeElement;
    if (ae && ae !== document.body) { targets.push(ae); }
    var ta = $('.monaco-editor textarea.inputarea') || $('.xterm-helper-textarea');
    if (ta && targets.indexOf(ta) < 0) { targets.push(ta); }
    targets.push(document.body);
    var sent = 0;
    for (var i = 0; i < targets.length; i++) {
      try {
        var t = targets[i];
        t.dispatchEvent(new KeyboardEvent('keydown', keyOpt(spec, t)));
        t.dispatchEvent(new KeyboardEvent('keyup', keyOpt(spec, t)));
        sent++;
      } catch (e) { fail('sendKey ' + (spec.key || '?'), e); }
    }
    return sent > 0;
  }

  function typeChar(ch) {
    var ae = document.activeElement;
    var cls = (ae && ae.className ? String(ae.className) : '');
    /* xterm.js builds its data from keydown, not from insertText */
    if (/xterm/.test(cls)) {
      var code = ch.toUpperCase().charCodeAt(0);
      return sendKey({ key: ch, code: '', keyCode: code, charCode: code,
                       ctrl: state.stickyCtrl, alt: state.stickyAlt });
    }
    /* Monaco takes text from the textarea input path -> execCommand is the
       same route an on-screen keyboard uses. */
    try {
      if (document.execCommand && document.execCommand('insertText', false, ch)) { return true; }
    } catch (e) { /* fall through */ }
    try {
      var t = ae || $('.monaco-editor textarea.inputarea');
      if (t) {
        t.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: ch }));
        t.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
        return true;
      }
    } catch (e2) { fail('typeChar', e2); }
    return sendKey({ key: ch, keyCode: ch.charCodeAt(0), charCode: ch.charCodeAt(0),
                     ctrl: state.stickyCtrl, alt: state.stickyAlt });
  }

  /* --------------------------------------------------------- quick input */
  function paletteBox() {
    var box = $('.quick-input-widget');
    return shown(box) ? box : null;
  }

  function openPalette(cb) {
    var box = paletteBox();
    if (box) { cb(true, 'already-open'); return; }
    sendKey({ key: 'P', code: 'KeyP', keyCode: 80, ctrl: true, shift: true });
    setTimeout(function () {
      box = paletteBox();
      if (box) { cb(true, 'key'); return; }
      /* clicking is more reliable than synthetic keys: try the command center
         (the pill in the middle of the title bar), then the menu bar. */
      var cand = ['.command-center', '.command-center-center', '.monaco-toolbar.command-center',
                  '.part.titlebar .menubar .menubar-menu-button', '.menubar .menubar-menu-button'];
      for (var i = 0; i < cand.length; i++) {
        var n = $(cand[i]);
        if (n && shown(n) && click(n)) { log('palette-open-click ' + cand[i]); break; }
      }
      setTimeout(function () { cb(!!paletteBox(), paletteBox() ? 'click' : 'none'); }, 320);
    }, 260);
  }

  function setNativeValue(input, value) {
    try {
      var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
      var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) { desc.set.call(input, value); return true; }
    } catch (e) { /* fall through */ }
    input.value = value;
    return false;
  }

  /* Type a command title into the palette and click the best row. */
  function runPalette(title, cb) {
    openPalette(function (ok, how) {
      if (!ok) { log('palette-unavailable(' + how + ')'); cb(false, 'palette-unavailable'); return; }
      var box = paletteBox();
      var input = box ? box.querySelector('input') : null;
      if (!input) { log('palette-no-input'); cb(false, 'palette-no-input'); return; }
      try { input.focus(); } catch (e) {}
      setNativeValue(input, title);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(function () {
        var rows = $$('.quick-input-list .monaco-list-row', box);
        var hit = null;
        for (var i = 0; i < rows.length; i++) {
          var txt = (rows[i].textContent || '').toLowerCase();
          if (txt.indexOf(title.toLowerCase()) >= 0 || txt.indexOf(title.split(':').pop().trim().toLowerCase()) >= 0) { hit = rows[i]; break; }
        }
        if (!hit) { hit = rows[0] || null; }
        if (hit) {
          log('palette-rows=' + rows.length + ' pick="' + (hit.textContent || '').slice(0, 46) + '"');
          click(hit);
          setTimeout(function () { cb(true, 'palette'); }, 220);
        } else {
          sendKey({ key: 'Enter', code: 'Enter', keyCode: 13 });
          setTimeout(function () { cb(true, 'palette-enter'); }, 220);
        }
      }, 320);
    });
  }

  function closePalette() {
    var box = paletteBox();
    if (box) { sendKey({ key: 'Escape', code: 'Escape', keyCode: 27 }); }
  }

  /* -------------------------------------------------------------- actions */
  var ACTIONS = {
    files:  { label: 'Files', ico: '\uD83D\uDCC1',
              ids: ['workbench.view.explorer'],
              titles: ['View: Show Explorer', 'Explorer: Focus on Explorer View'],
              keys: [{ key: 'E', code: 'KeyE', keyCode: 69, ctrl: true, shift: true }],
              verify: function () { var n = byId('workbench.view.explorer'); return (n && /checked|selected|active/.test(n.className + (n.getAttribute('aria-checked') || ''))) || shown($('.explorer-folders-view')); } },
    search: { label: 'Search', ico: '\uD83D\uDD0D',
              ids: ['workbench.view.search'],
              titles: ['View: Show Search', 'Search: Focus on Search View'],
              keys: [{ key: 'F', code: 'KeyF', keyCode: 70, ctrl: true, shift: true }],
              verify: function () { var n = byId('workbench.view.search'); return (n && /checked|selected|active/.test(n.className)) || shown($('.search-view')); } },
    git:    { label: 'Git', ico: '\u2387',
              ids: ['workbench.view.scm'],
              titles: ['View: Show Source Control', 'Source Control: Focus on Source Control View'],
              keys: [{ key: 'G', code: 'KeyG', keyCode: 71, ctrl: true, shift: true }],
              verify: function () { var n = byId('workbench.view.scm'); return (n && /checked|selected|active/.test(n.className)) || shown($('.scm-view')); } },
    ext:    { label: 'Ext', ico: '\u29C9',
              ids: ['workbench.view.extensions'],
              titles: ['View: Show Extensions'],
              keys: [{ key: 'X', code: 'KeyX', keyCode: 88, ctrl: true, shift: true }],
              verify: function () { var n = byId('workbench.view.extensions'); return !!(n && /checked|selected|active/.test(n.className)); } },
    term:   { label: 'Terminal', ico: '>_',
              ids: ['workbench.panel.terminal'],
              titles: ['Terminal: Create New Terminal', 'View: Toggle Terminal', 'Terminal: Focus Terminal'],
              keys: [{ key: '`', code: 'Backquote', keyCode: 192, ctrl: true }],
              verify: function () { return shown($('.xterm')) || shown($('.terminal-wrapper')) || shown($('.pane-body .xterm')); },
              after: function () { var t = $('.xterm-helper-textarea'); if (t) { try { t.focus(); } catch (e) {} } } },
    output: { label: 'Output', ico: '\u2261',
              ids: ['workbench.panel.output'],
              titles: ['View: Toggle Output', 'Output: Show Output Channel'],
              keys: [{ key: 'U', code: 'KeyU', keyCode: 85, ctrl: true, shift: true }],
              verify: function () { return shown($('.output')) || shown($('.pane-body .output-view')) || shown($('.monaco-editor.output')); } },
    editor: { label: 'Editor', ico: '\u270E',
              ids: [],
              titles: ['View: Focus Active Editor Group', 'View: Close Panel'],
              keys: [{ key: '1', code: 'Digit1', keyCode: 49, ctrl: true }],
              verify: function () { return shown($('.editor-instance .monaco-editor')); } },
    palette: { label: 'Commands', ico: '\u2318', ids: [], titles: [], keys: [{ key: 'P', code: 'KeyP', keyCode: 80, ctrl: true, shift: true }] },
    sidebar: { label: 'Sidebar', ico: '\u25E7', ids: [], titles: ['View: Toggle Primary Side Bar Visibility'], keys: [{ key: 'B', code: 'KeyB', keyCode: 66, ctrl: true }] },
    panel:   { label: 'Panel', ico: '\u25A4', ids: [], titles: ['View: Toggle Panel'], keys: [{ key: 'J', code: 'KeyJ', keyCode: 74, ctrl: true }] },
    save:    { label: 'Save all', ico: '\uD83D\uDCBE', ids: [], titles: ['File: Save All'], keys: [] },
    split:   { label: 'Split', ico: '\u25EB', ids: [], titles: ['View: Split Editor Right'], keys: [{ key: '\\', code: 'Backslash', keyCode: 220, ctrl: true }] },
    close:   { label: 'Close tab', ico: '\u2715', ids: [], titles: ['View: Close Editor'], keys: [{ key: 'W', code: 'KeyW', keyCode: 87, ctrl: true }] },
    zen:     { label: 'Zen', ico: '\u26F6', ids: [], titles: ['View: Toggle Zen Mode'], keys: [] },
    reload:  { label: 'Reload', ico: '\u27F3', ids: [], titles: ['Developer: Reload Window'], keys: [] },
    ai_test: { label: 'Test AI Models', ico: '\uD83E\uDDEA', ids: [], titles: [], run: function() {
      fetch('http://127.0.0.1:8080/?ai_test_start=1&only_untested=0', {mode: 'no-cors'}).then(function() {
        toast('🧪 AI Models Test triggered');
      }).catch(function() {
        toast('🧪 AI Models Test requested');
      });
    } },
    sync_gh: { label: 'Sync GitHub', ico: '\u27F3', ids: [], titles: ['Git: Pull', 'Git: Sync'], run: function() {
      toast('🔄 Syncing newest branch code from GitHub...');
      fetch('/__s4mobile/update', {method: 'POST'}).then(function() {
        toast('✅ Code synced from GitHub');
      }).catch(function() {
        toast('✅ Sync requested');
      });
    } },
    import_ai: { label: 'Import AI Models', ico: '\u2913', ids: [], titles: [], run: function() {
      var jsonStr = prompt('Paste AI Providers JSON:');
      if (jsonStr && jsonStr.trim()) {
        fetch('http://127.0.0.1:8080/', {
          method: 'POST',
          body: new URLSearchParams({action: 'ai_import_providers', providers_json: jsonStr})
        }).then(function() {
          toast('✅ AI Providers JSON imported');
        }).catch(function() {
          toast('✅ Import submitted');
        });
      }
    } },
    undo:    { label: 'Undo', ico: '\u21B6', ids: [], titles: [], keys: [{ key: 'z', code: 'KeyZ', keyCode: 90, ctrl: true }] },
    redo:    { label: 'Redo', ico: '\u21B7', ids: [], titles: [], keys: [{ key: 'z', code: 'KeyZ', keyCode: 90, ctrl: true, shift: true }] },
    find:    { label: 'Find', ico: '\u2315', ids: [], titles: [], keys: [{ key: 'f', code: 'KeyF', keyCode: 70, ctrl: true }] }
  };

  /* Strategy ladder: DOM click -> command palette -> synthetic keybinding.
     Each rung is verified with the action's own predicate and logged. */
  function act(name) {
    var a = ACTIONS[name];
    if (!a) { log('act-unknown:' + name); return; }
    if (a.run) { a.run(); return; }
    log('act ' + name);
    var i, n;
    for (i = 0; i < (a.ids || []).length; i++) {
      n = byId(a.ids[i]) || $(a.ids[i]);
      if (n && shown(n) && click(n)) {
        confirmAct(a, name, 'click#' + a.ids[i]);
        return;
      }
    }
    var titles = a.titles || [];
    if (titles.length) {
      runPalette(titles[0], function (ok, how) {
        if (ok) { confirmAct(a, name, how); return; }
        if (titles[1]) {
          runPalette(titles[1], function (ok2, how2) {
            if (ok2) { confirmAct(a, name, how2 + ':' + titles[1]); } else { keyFallback(a, name); }
          });
        } else { keyFallback(a, name); }
      });
      return;
    }
    keyFallback(a, name);
  }

  function keyFallback(a, name) {
    var ks = a.keys || [];
    if (!ks.length) { log('act ' + name + ': no strategy'); toast(a.label + ': no route found'); return; }
    for (var i = 0; i < ks.length; i++) { sendKey(ks[i]); }
    confirmAct(a, name, 'key');
  }

  function confirmAct(a, name, how) {
    setTimeout(function () {
      var ok = true;
      if (typeof a.verify === 'function') {
        try { ok = !!a.verify(); } catch (e) { ok = false; fail('verify ' + name, e); }
      }
      state.acts[name] = how + (ok ? ':ok' : ':unverified');
      log('act ' + name + ' -> ' + state.acts[name]);
      if (ok && typeof a.after === 'function') { try { a.after(); } catch (e) { fail('after ' + name, e); } }
      if (!ok) { toast(a.label + ': ' + how + ' (not confirmed)'); }
      dirty = true;
    }, 520);
  }

  /* ----------------------------------------------------------------- zoom */
  function zoomSupported() {
    try { return !!(window.CSS && CSS.supports && CSS.supports('zoom', '1.5')); } catch (e) { return false; }
  }

  function applyZoom(z, persist) {
    z = clamp(Math.round(z * 100) / 100, ZMIN, ZMAX);
    state.zoom = z;
    var root = document.documentElement;
    try {
      root.style.setProperty('--s4-zoom', String(z));
      root.style.setProperty('--s4-inv', String(Math.round((1 / z) * 1e6) / 1e6));
    } catch (e) { fail('applyZoom vars', e); }
    var wb = $('.monaco-workbench');
    if (wb) { wb.style.zoom = String(z); }
    if (!wb && document.body) { document.body.style.zoom = String(z); }
    var pct = byId('s4mob-zoomval');
    if (pct) { pct.textContent = Math.round(z * 100) + '%'; }
    if (persist !== false) { store(LS_ZOOM, String(z)); }
    /* VS Code re-measures on resize; without this the layout keeps the old
       geometry after a zoom change. */
    relayout();
    dirty = true;
    return z;
  }

  var relayoutTimer = 0;
  function relayout() {
    if (relayoutTimer) { return; }
    relayoutTimer = setTimeout(function () {
      relayoutTimer = 0;
      try { window.dispatchEvent(new Event('resize')); } catch (e) {}
    }, 60);
  }

  function setZoomBy(d) { applyZoom(state.zoom + d); toast(Math.round(state.zoom * 100) + '% zoom'); }

  /* ------------------------------------------------------------- viewport */
  var VIEWPORT = 'width=device-width, initial-scale=1, minimum-scale=0.25, maximum-scale=10, user-scalable=yes, viewport-fit=cover';
  function fixViewport() {
    var metas = $$('meta[name="viewport"]');
    for (var i = 0; i < metas.length; i++) {
      var c = metas[i].getAttribute('content') || '';
      if (/user-scalable\s*=\s*no/i.test(c) || /maximum-scale\s*=\s*1(\.0+)?\s*([;,]|$)/i.test(c)) {
        metas[i].setAttribute('content', VIEWPORT);
        metas[i].setAttribute('data-s4', 'viewport-fixed');
        log('viewport fixed (was: ' + c.slice(0, 70) + ')');
      } else if (!metas[i].getAttribute('data-s4')) {
        metas[i].setAttribute('content', VIEWPORT);
        metas[i].setAttribute('data-s4', 'viewport-fixed');
        log('viewport set');
      }
    }
    if (!metas.length) {
      var m = document.createElement('meta');
      m.name = 'viewport'; m.content = VIEWPORT; m.setAttribute('data-s4', 'viewport-added');
      (document.head || document.documentElement).appendChild(m);
      log('viewport added');
    }
  }

  /* --------------------------------------------------------------- layout */
  function setBarVars() {
    var root = document.documentElement;
    /* NOTE: these must not be called top/dock/keys - `dock` and `keysRow` are
       the module-level element references and a local `var dock` would shadow
       them (that single bug killed the whole shell at boot). */
    var topH = state.bars ? 40 : 0;
    var dockH = state.bars ? 52 : 0;
    var keysH = (state.bars && state.keys) ? 44 : 0;
    root.style.setProperty('--s4-top-h', topH + 'px');
    root.style.setProperty('--s4-dock-h', dockH + 'px');
    root.style.setProperty('--s4-keys-h', keysH + 'px');
    if (topBar) { topBar.classList.toggle('s4-hidden', !state.bars); }
    if (dock) { dock.classList.toggle('s4-hidden', !state.bars); }
    if (keysRow) { keysRow.classList.toggle('s4-hidden', !(state.bars && state.keys)); }
    if (handle) { handle.style.display = state.bars ? 'none' : 'block'; }
    relayout();
    dirty = true;
  }

  var topBar = null, dock = null, keysRow = null, sheet = null, toastNode = null, handle = null;
  var activeTab = '';

  function button(cls, txt, title, fn) {
    var b = el('button', cls, txt);
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    b.type = 'button';
    b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); try { fn(); } catch (e) { fail('button ' + txt, e); } });
    return b;
  }

  function buildTop() {
    topBar = el('div', '');
    topBar.id = 's4mob-top';
    topBar.appendChild(button('s4-btn', '\u2630', 'Menu / sidebar', function () { act('sidebar'); }));
    topBar.appendChild(button('s4-btn', '\u2318', 'Command palette', function () { act('palette'); }));
    topBar.appendChild(button('s4-btn', 'A\u2212', 'Zoom out', function () { setZoomBy(-ZSTEP * 2); }));
    var z = button('s4-btn s4-wide', '', 'Reset zoom to 100%', function () { applyZoom(1); toast('100% zoom'); });
    z.id = 's4mob-zoomval';
    z.textContent = Math.round(state.zoom * 100) + '%';
    topBar.appendChild(z);
    topBar.appendChild(button('s4-btn', 'A+', 'Zoom in', function () { setZoomBy(ZSTEP * 2); }));
    var t = el('span', 's4-title');
    t.id = 's4mob-title';
    t.textContent = 'code-server';
    topBar.appendChild(t);
    topBar.appendChild(el('span', 's4-spacer'));
    topBar.appendChild(button('s4-btn', state.keys ? '\u2328' : '\u2328\u0338', 'Extra keys row', function () {
      state.keys = !state.keys; savePref(); setBarVars(); toast(state.keys ? 'Extra keys shown' : 'Extra keys hidden');
    }));
    topBar.appendChild(button('s4-btn', '\u26F6', 'Fullscreen', toggleFullscreen));
    topBar.appendChild(button('s4-btn', '\u2013', 'Hide bars', function () { setBars(false); }));
    document.body.appendChild(topBar);
  }

  var TABS = [
    { k: 'files', ico: '\uD83D\uDCC1', label: 'Files' },
    { k: 'search', ico: '\uD83D\uDD0D', label: 'Search' },
    { k: 'git', ico: '\u2387', label: 'Git' },
    { k: 'term', ico: '>_', label: 'Terminal' },
    { k: 'output', ico: '\u2261', label: 'Output' },
    { k: 'editor', ico: '\u270E', label: 'Editor' },
    { k: 'more', ico: '\u22EF', label: 'More' }
  ];

  function buildDock() {
    dock = el('div', '');
    dock.id = 's4mob-dock';
    dock.setAttribute('role', 'tablist');
    for (var i = 0; i < TABS.length; i++) {
      (function (tab) {
        var b = el('button', 's4-tab');
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('data-tab', tab.k);
        b.appendChild(el('span', 's4-ico', tab.ico));
        b.appendChild(el('span', 's4-lbl', tab.label));
        b.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          if (tab.k === 'more') { openSheet(); return; }
          activeTab = tab.k;
          markTab();
          act(tab.k);
        });
        dock.appendChild(b);
      })(TABS[i]);
    }
    document.body.appendChild(dock);
  }

  function markTab() {
    var bs = $$('#s4mob-dock .s4-tab');
    for (var i = 0; i < bs.length; i++) {
      var on = bs[i].getAttribute('data-tab') === activeTab;
      bs[i].classList.toggle('s4-on', on);
      bs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  var KEYSET = [
    { t: 'Esc', s: { key: 'Escape', code: 'Escape', keyCode: 27 } },
    { t: 'Tab', s: { key: 'Tab', code: 'Tab', keyCode: 9 } },
    { t: 'Ctrl', mod: 'ctrl' },
    { t: 'Alt', mod: 'alt' },
    { c: '/' }, { c: '-' }, { c: ':' }, { c: ';' }, { c: '.' }, { c: ',' },
    { c: '"' }, { c: "'" }, { c: '`' }, { c: '\\' }, { c: '|' }, { c: '&' },
    { c: '*' }, { c: '?' }, { c: '!' }, { c: '@' }, { c: '#' }, { c: '$' },
    { c: '%' }, { c: '^' }, { c: '~' }, { c: '+' }, { c: '=' }, { c: '_' },
    { c: '(' }, { c: ')' }, { c: '[' }, { c: ']' }, { c: '{' }, { c: '}' },
    { c: '<' }, { c: '>' },
    { t: '\u2190', s: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 } },
    { t: '\u2191', s: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 } },
    { t: '\u2193', s: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 } },
    { t: '\u2192', s: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 } },
    { t: 'Home', s: { key: 'Home', code: 'Home', keyCode: 36 } },
    { t: 'End', s: { key: 'End', code: 'End', keyCode: 35 } },
    { t: 'PgUp', s: { key: 'PageUp', code: 'PageUp', keyCode: 33 } },
    { t: 'PgDn', s: { key: 'PageDown', code: 'PageDown', keyCode: 34 } },
    { t: 'Del', s: { key: 'Backspace', code: 'Backspace', keyCode: 8 } },
    { t: 'Enter', s: { key: 'Enter', code: 'Enter', keyCode: 13 } }
  ];

  function buildKeys() {
    keysRow = el('div', '');
    keysRow.id = 's4mob-keys';
    for (var i = 0; i < KEYSET.length; i++) {
      (function (k) {
        var b = el('button', 's4-key', k.t || k.c);
        b.type = 'button';
        b.setAttribute('data-key', k.t || k.c);
        /* touchstart fires before the on-screen keyboard steals focus */
        b.addEventListener('pointerdown', function (ev) { ev.preventDefault(); });
        b.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          if (k.mod === 'ctrl') { state.stickyCtrl = !state.stickyCtrl; b.classList.toggle('s4-on', state.stickyCtrl); toast('Ctrl ' + (state.stickyCtrl ? 'on' : 'off')); return; }
          if (k.mod === 'alt') { state.stickyAlt = !state.stickyAlt; b.classList.toggle('s4-on', state.stickyAlt); toast('Alt ' + (state.stickyAlt ? 'on' : 'off')); return; }
          if (k.c) { typeChar(k.c); clearSticky(); return; }
          if (k.s) {
            var spec = Object.assign({}, k.s, { ctrl: state.stickyCtrl, alt: state.stickyAlt });
            sendKey(spec);
            clearSticky();
            state.acts['key:' + (k.t || k.s.key)] = (state.acts['key:' + (k.t || k.s.key)] || 0) + 1;
            dirty = true;
          }
        });
        keysRow.appendChild(b);
      })(KEYSET[i]);
    }
    document.body.appendChild(keysRow);
  }

  function clearSticky() {
    if (!state.stickyCtrl && !state.stickyAlt) { return; }
    state.stickyCtrl = false; state.stickyAlt = false;
    var bs = $$('#s4mob-keys .s4-key.s4-on');
    for (var i = 0; i < bs.length; i++) { bs[i].classList.remove('s4-on'); }
  }

  var SHEET = [
    { k: 'palette', ico: '\u2318', label: 'Commands' },
    { k: 'sidebar', ico: '\u25E7', label: 'Sidebar' },
    { k: 'panel', ico: '\u25A4', label: 'Panel' },
    { k: 'save', ico: '\uD83D\uDCBE', label: 'Save all' },
    { k: 'split', ico: '\u25EB', label: 'Split' },
    { k: 'close', ico: '\u2715', label: 'Close tab' },
    { k: 'find', ico: '\u2315', label: 'Find' },
    { k: 'undo', ico: '\u21B6', label: 'Undo' },
    { k: 'redo', ico: '\u21B7', label: 'Redo' },
    { k: 'ext', ico: '\u29C9', label: 'Extensions' },
    { k: 'zen', ico: '\u26F6', label: 'Zen' },
    { k: 'reload', ico: '\u27F3', label: 'Reload' },
    { k: 'ai_test', ico: '\uD83E\uDDEA', label: 'Test AI Models' },
    { k: 'sync_gh', ico: '\u27F3', label: 'Sync GitHub' },
    { k: 'import_ai', ico: '\u2913', label: 'Import AI JSON' }
  ];

  function buildSheet() {
    sheet = el('div', '');
    sheet.id = 's4mob-sheet';
    var panel = el('div', 's4-panel');
    panel.appendChild(el('div', 's4-h', 'More actions'));
    var grid = el('div', 's4-grid');
    for (var i = 0; i < SHEET.length; i++) {
      (function (item) {
        var c = el('button', 's4-cell');
        c.type = 'button';
        c.appendChild(el('span', 's4-ico', item.ico));
        c.appendChild(el('span', '', item.label));
        c.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          closeSheet();
          setTimeout(function () { act(item.k); }, 120);
        });
        grid.appendChild(c);
      })(SHEET[i]);
    }
    panel.appendChild(grid);
    panel.appendChild(el('div', 's4-h', 'Zoom & layout'));
    var zg = el('div', 's4-grid');
    var mk = function (ico, label, fn) {
      var c = el('button', 's4-cell');
      c.type = 'button';
      c.appendChild(el('span', 's4-ico', ico));
      c.appendChild(el('span', '', label));
      c.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); fn(); });
      return c;
    };
    zg.appendChild(mk('A\u2212', 'Zoom out', function () { setZoomBy(-ZSTEP * 2); }));
    zg.appendChild(mk('A+', 'Zoom in', function () { setZoomBy(ZSTEP * 2); }));
    zg.appendChild(mk('100%', 'Reset zoom', function () { applyZoom(1); toast('100% zoom'); }));
    zg.appendChild(mk('150%', 'Zoom 150%', function () { applyZoom(1.5); toast('150% zoom'); }));
    zg.appendChild(mk('\u2328', state.keys ? 'Hide keys' : 'Show keys', function () {
      state.keys = !state.keys; savePref(); setBarVars(); closeSheet();
    }));
    zg.appendChild(mk('\u26F6', 'Fullscreen', function () { toggleFullscreen(); closeSheet(); }));
    panel.appendChild(zg);
    panel.appendChild(mk('\u2715', 'Close', closeSheet));
    sheet.appendChild(panel);
    sheet.addEventListener('click', function (ev) { if (ev.target === sheet) { closeSheet(); } });
    document.body.appendChild(sheet);

    /* restore handle, visible only when the bars are hidden */
    handle = el('button', 's4-btn', '\u22EE', 'Show mobile bars');
    handle.id = 's4mob-handle';
    handle.style.cssText = 'position:fixed;right:6px;bottom:calc(6px + var(--s4-safe-b));z-index:2147483002;' +
      'background:var(--s4-bg);border:1px solid var(--s4-border);border-radius:50%;width:40px;height:40px;' +
      'min-width:40px;display:none;';
    handle.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); setBars(true); });
    document.body.appendChild(handle);
  }

  function openSheet() { if (sheet) { sheet.classList.add('s4-open'); } }
  function closeSheet() { if (sheet) { sheet.classList.remove('s4-open'); } }

  function setBars(on) {
    state.bars = !!on;
    savePref();
    setBarVars();
    toast(state.bars ? 'Mobile bars shown' : 'Bars hidden - tap the round button to bring them back');
  }

  var toastTimer = 0;
  function toast(msg) {
    if (!toastNode) {
      toastNode = el('div', '');
      toastNode.id = 's4mob-toast';
      document.body.appendChild(toastNode);
    }
    toastNode.textContent = String(msg);
    toastNode.classList.add('s4-show');
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { toastNode.classList.remove('s4-show'); }, 2200);
  }

  function toggleFullscreen() {
    try {
      var d = document;
      if (!d.fullscreenElement && !d.webkitFullscreenElement) {
        var p = (d.documentElement.requestFullscreen || d.documentElement.webkitRequestFullscreen);
        if (p) { p.call(d.documentElement); log('fullscreen on'); }
      } else {
        var x = (d.exitFullscreen || d.webkitExitFullscreen);
        if (x) { x.call(d); log('fullscreen off'); }
      }
    } catch (e) { fail('fullscreen', e); toast('Fullscreen unavailable'); }
  }

  /* --------------------------------------------------------------- pinch */
  function bindPinch() {
    var start = 0, startZoom = 1, active = false;
    function dist(t) {
      var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    document.addEventListener('touchstart', function (e) {
      if (e.touches && e.touches.length === 2) { start = dist(e.touches); startZoom = state.zoom; active = true; }
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!active || !e.touches || e.touches.length !== 2) { return; }
      var d = dist(e.touches);
      if (start < 10) { return; }
      /* our own pinch drives layout zoom, so the app stays coherent */
      if (e.cancelable) { e.preventDefault(); }
      applyZoom(startZoom * (d / start), false);
    }, { passive: false });
    document.addEventListener('touchend', function (e) {
      if (active && (!e.touches || e.touches.length < 2)) {
        active = false;
        store(LS_ZOOM, String(state.zoom));
        var pct = byId('s4mob-zoomval');
        if (pct) { pct.textContent = Math.round(state.zoom * 100) + '%'; }
      }
    }, { passive: true });
  }

  /* ------------------------------------------------------------ shortcuts */
  function bindKeys() {
    /* Ctrl/Cmd + -/= /0 stay handy with a hardware keyboard or Termux:API */
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) { return; }
      var k = (e.key || '').toLowerCase();
      if (k === '=' || k === '+') { e.preventDefault(); setZoomBy(ZSTEP * 2); }
      else if (k === '-') { e.preventDefault(); setZoomBy(-ZSTEP * 2); }
      else if (k === '0') { e.preventDefault(); applyZoom(1); }
    }, true);
    window.addEventListener('resize', function () { dirty = true; });
    /* ?z=1.8 / #z=1.8 override, handy for a bookmark */
    try {
      var m = /[?&#]z=([0-9.]+)/.exec(window.location.search + window.location.hash);
      if (m) { applyZoom(parseFloat(m[1])); log('zoom from url=' + m[1]); }
    } catch (e) {}
  }

  /* --------------------------------------------------------------- report */
  var dirty = true;
  function snapshot() {
    return {
      v: VERSION, ts: Date.now(),
      zoom: state.zoom, zoomSupported: state.zoomSupported,
      ready: state.ready, login: state.login,
      bars: state.bars, keys: state.keys,
      workbench: !!$('.monaco-workbench'),
      tabs: $$('#s4mob-dock .s4-tab').length,
      extraKeys: $$('#s4mob-keys .s4-key').length,
      inner: [window.innerWidth, window.innerHeight],
      docW: document.documentElement.clientWidth,
      wbW: (function () { var n = $('.monaco-workbench'); return n ? [n.clientWidth, n.clientHeight] : null; })(),
      acts: state.acts, errs: state.errs.slice(-8), log: state.log.slice(-24),
      ua: (navigator.userAgent || '').slice(0, 180)
    };
  }
  function report(force) {
    if (!force && !dirty) { return; }
    dirty = false;
    var body;
    try { body = JSON.stringify(snapshot()); } catch (e) { fail('report json', e); return; }
    try {
      fetch(BASE + '/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body,
        keepalive: true
      }).then(function () { state.sent++; }, function () {});
    } catch (e) {
      try {
        var x = new XMLHttpRequest();
        x.open('POST', BASE + '/report', true);
        x.setRequestHeader('content-type', 'application/json');
        x.send(body);
      } catch (e2) { fail('report', e2); }
    }
  }

  function savePref() {
    store(LS_PREF, JSON.stringify({ bars: state.bars, keys: state.keys }));
  }
  function loadPref() {
    var z = parseFloat(recall(LS_ZOOM) || '');
    if (z > 0) { state.zoom = clamp(z, ZMIN, ZMAX); }
    try {
      var p = JSON.parse(recall(LS_PREF) || '{}');
      if (typeof p.bars === 'boolean') { state.bars = p.bars; }
      if (typeof p.keys === 'boolean') { state.keys = p.keys; }
    } catch (e) {}
  }

  /* ------------------------------------------------------------- boot */
  function isLogin() {
    var p = window.location.pathname || '';
    return /\/login\/?$/.test(p) || !!$('.login-form') || !!$('#login-form');
  }

  function boot() {
    loadPref();
    state.zoomSupported = zoomSupported();
    state.login = isLogin();
    fixViewport();
    applyZoom(state.zoom, false);

    buildTop();
    buildKeys();
    buildDock();
    buildSheet();
    setBarVars();
    bindPinch();
    bindKeys();

    if (!state.zoomSupported) {
      log('zoom unsupported by this engine; pinch-zoom is unlocked instead');
      toast('This browser ignores CSS zoom - pinch to zoom instead');
    }

    var t = byId('s4mob-title');
    if (t) { t.textContent = state.login ? 'code-server login' : 'code-server'; }

    /* keep the viewport honest: VS Code can rewrite it while booting */
    var ticks = 0;
    var iv = setInterval(function () {
      ticks++;
      fixViewport();
      if (ticks > 40) { clearInterval(iv); }
    }, 750);

    state.ready = true;
    log('shell ready zoom=' + state.zoom + ' supported=' + state.zoomSupported + ' login=' + state.login);
    report(true);
    setInterval(function () { report(false); }, 3000);
    setInterval(function () { report(true); }, 30000);
    window.addEventListener('pagehide', function () { report(true); });
  }

  function waitForBody(cb) {
    var done = false, mo = null, iv = 0;
    function go() {
      if (done) { return; }
      done = true;
      if (mo) { try { mo.disconnect(); } catch (e) {} }
      if (iv) { clearInterval(iv); }
      cb();
    }
    if (document.body) { go(); return; }
    try {
      mo = new MutationObserver(function () { if (document.body) { go(); } });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* polling below covers it */ }
    var n = 0;
    iv = setInterval(function () {
      n++;
      if (document.body) { go(); }
      else if (n > 200) { clearInterval(iv); iv = 0; log('body never appeared'); }
    }, 50);
  }

  window.__s4mob = {
    version: VERSION,
    state: state,
    snapshot: snapshot,
    zoom: function (z) { return applyZoom(z); },
    act: act,
    actions: Object.keys(ACTIONS),
    bars: setBars,
    toast: toast
  };

  try {
    waitForBody(function () {
      try { boot(); } catch (e) { fail('boot', e); }
    });
  } catch (e) { fail('init', e); }
})();
