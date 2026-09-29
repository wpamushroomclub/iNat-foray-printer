// UI wiring: search, selection, preview and the print/export actions.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var DEFAULTS = {
    widthMm: 60, heightMm: 40, density: 10, speed: 3, media: 'gaps', offsetDots: 0, rotation: '270',
    shiftMm: 1.5
  };
  var SETTING_INPUTS = {
    widthMm: 's-width', heightMm: 's-height', density: 's-density', speed: 's-speed',
    media: 's-media', offsetDots: 's-offset', rotation: 's-rotate',
    shiftMm: 's-shift'
  };

  var state = {
    all: [],          // everything found for the user and date
    found: '',        // status line for the last search
    observations: [], // those shown, after the fungi filter
    selected: new Set(),
    activeId: null,
    settings: Object.assign({}, DEFAULTS),
    serial: null,
    ble: null,
    busy: false
  };

  // ---- Persistence (best effort; storage may be unavailable) ---------------
  function load(key) {
    try { return JSON.parse(localStorage.getItem('foray.' + key)); } catch (e) { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem('foray.' + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  // ---- Status --------------------------------------------------------------
  function status(msg, isError) {
    var el = $('status');
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }
  function conn(msg, isError) {
    var el = $('conn');
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ---- Settings ------------------------------------------------------------
  function readSettings() {
    var s = state.settings;
    Object.keys(SETTING_INPUTS).forEach(function (key) {
      var el = $(SETTING_INPUTS[key]);
      if (el.type === 'checkbox') s[key] = el.checked;
      else if (el.type === 'number') {
        var v = parseFloat(el.value);
        s[key] = isFinite(v) ? v : DEFAULTS[key];
      } else s[key] = el.value;
    });
    save('settings', s);
  }
  function writeSettings() {
    var s = state.settings;
    Object.keys(SETTING_INPUTS).forEach(function (key) {
      var el = $(SETTING_INPUTS[key]);
      if (el.type === 'checkbox') el.checked = !!s[key];
      else el.value = s[key];
    });
  }

  // ---- Table ---------------------------------------------------------------
  function byId(id) {
    for (var i = 0; i < state.observations.length; i++) {
      if (state.observations[i].id === id) return state.observations[i];
    }
    return null;
  }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'className') node.className = props[k];
      else if (k === 'text') node.textContent = props[k];
      else node.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function renderTable() {
    var body = $('obs-body');
    body.textContent = '';
    if (!state.observations.length) {
      body.appendChild(el('tr', { className: 'empty' }, [
        el('td', { colspan: '6', text: state.all.length
          ? 'None of the observations are fungi, lichens or slime molds. Untick the filter to see them.'
          : 'No observations found for that user and date.' })
      ]));
      return;
    }
    state.observations.forEach(function (o) {
      var cb = el('input', { type: 'checkbox', 'aria-label': 'Print label for ' + o.id });
      cb.checked = state.selected.has(o.id);
      cb.addEventListener('click', function (e) { e.stopPropagation(); });
      cb.addEventListener('change', function () {
        if (cb.checked) state.selected.add(o.id); else state.selected.delete(o.id);
        updateControls();
      });

      var photo = o.photo ? el('img', { src: o.photo, alt: '', loading: 'lazy' }) : el('img', { alt: '' });
      var species = el('td', null, [
        el('span', { className: o.rank && o.rank !== 'kingdom' ? 'sci' : '', text: o.species || 'Unknown' }),
        o.commonName ? el('span', { className: 'common', text: o.commonName }) : null
      ]);
      var tr = el('tr', { 'data-id': String(o.id) }, [
        el('td', { className: 'c-check' }, [cb]),
        el('td', { className: 'c-photo' }, [photo]),
        el('td', { className: 'mono' }, [el('a', { href: o.url, target: '_blank', rel: 'noopener', text: String(o.id) })]),
        el('td', { className: 'mono', text: o.time || '—' }),
        species,
        el('td', { className: 'c-place', text: o.place })
      ]);
      tr.addEventListener('click', function (e) {
        if (e.target.tagName === 'A') return;
        setActive(o.id);
      });
      tr.addEventListener('dblclick', function () {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });
      body.appendChild(tr);
    });
    highlightActive();
  }

  function highlightActive() {
    var rows = $('obs-body').querySelectorAll('tr[data-id]');
    rows.forEach(function (r) { r.classList.toggle('active', Number(r.getAttribute('data-id')) === state.activeId); });
  }

  function setActive(id) {
    state.activeId = id;
    highlightActive();
    renderPreview();
  }

  function selectedObservations() {
    return state.observations.filter(function (o) { return state.selected.has(o.id); });
  }

  function updateControls() {
    var n = state.selected.size;
    var has = state.observations.length > 0;
    $('count').textContent = n + ' of ' + state.observations.length + ' selected';
    $('select-all').disabled = !has || state.busy;
    $('select-none').disabled = !has || state.busy;
    var none = n === 0 || state.busy;
    $('print-driver').disabled = none;
    $('print-serial').disabled = none || !Phomemo.SerialPrinter.supported();
    $('print-ble').disabled = none || !Phomemo.BlePrinter.supported();
    $('export-csv').disabled = none;
    $('download-png').disabled = !state.activeId;
    var label = n === 1 ? ' 1 label' : ' ' + n + ' labels';
    $('print-driver').textContent = 'Print' + label + ' via Windows printer';
  }

  // ---- Preview & rendering -------------------------------------------------
  function renderOne(o) {
    return LabelRenderer.render(o, state.settings);
  }

  function renderPreview() {
    var o = byId(state.activeId);
    var target = $('preview');
    var ctx = target.getContext('2d');
    if (!o) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, target.width, target.height);
      $('preview-cap').textContent = 'Preview: select a row';
      updateControls();
      return;
    }
    var c = renderOne(o);
    target.width = c.width;
    target.height = c.height;
    target.classList.toggle('portrait', c.height > c.width);
    ctx.drawImage(c, 0, 0);
    $('preview-cap').textContent = 'Preview of ' + o.id + ' at ' + state.settings.widthMm + ' × ' +
      state.settings.heightMm + ' mm (' + c.width + ' × ' + c.height + ' dots). Paper exits from the top edge.';
    updateControls();
  }

  // ---- Search --------------------------------------------------------------
  // Shows only fungi, lichens and slime molds when the filter is ticked.
  // Newly shown observations start selected; hidden ones are deselected.
  function applyFilter() {
    var only = $('fungi-only').checked;
    var shown = new Set(state.observations.map(function (o) { return o.id; }));
    state.observations = state.all.filter(function (o) { return !only || o.fungal; });
    var ids = new Set(state.observations.map(function (o) { return o.id; }));
    state.observations.forEach(function (o) { if (!shown.has(o.id)) state.selected.add(o.id); });
    state.selected.forEach(function (id) { if (!ids.has(id)) state.selected.delete(id); });
    if (!ids.has(state.activeId)) state.activeId = state.observations.length ? state.observations[0].id : null;
    renderTable();
    renderPreview();
    updateControls();
    var hidden = state.all.length - state.observations.length;
    if (state.found) {
      status(state.found + (hidden ? ' Hiding ' + hidden + ' that ' +
        (hidden === 1 ? 'is not a fungus, lichen or slime mold.' : 'are not fungi, lichens or slime molds.') : ''));
    }
  }

  async function find(e) {
    e.preventDefault();
    var username = $('username').value.trim().replace(/^@/, '');
    var date = $('date').value;
    var field = $('date-field').value;
    if (!username || !date) return;
    save('username', username);
    save('dateField', field);
    $('find-btn').disabled = true;
    status('Searching iNaturalist…');
    try {
      var obs = isDemo()
        ? demoObservations(username, date)
        : await INat.fetchDay(username, date, field, function (got, total) {
          status('Loaded ' + got + ' of ' + total + '…');
        });
      state.all = obs;
      state.observations = [];
      state.selected = new Set();
      state.activeId = null;
      state.found = obs.length
        ? 'Found ' + obs.length + ' observation' + (obs.length === 1 ? '' : 's') + ' by ' + username + ' on ' + date + '.'
        : 'No observations by ' + username + ' ' + (field === 'created' ? 'uploaded' : 'observed') + ' on ' + date + '.';
      applyFilter();
    } catch (err) {
      status('Could not load observations: ' + err.message, true);
    } finally {
      $('find-btn').disabled = false;
      updateControls();
    }
  }

  // ---- Printing: Windows driver (browser print dialog) ---------------------
  // Only Chromium browsers (Chrome, Edge) pass the page orientation through to
  // the driver. Firefox shows portrait in its preview but sends a landscape
  // job, which the M220 driver prints turned 90°.
  var DRIVER_NOTE = 'Printing via the Windows printer only comes out the right way round ' +
    'in Chrome or Edge; this browser may print the label turned 90°.';
  function driverOrientationReliable() { return !!navigator.userAgentData; }

  function printViaDriver() {
    var list = selectedObservations();
    if (!list.length) return;
    if (!driverOrientationReliable()) conn(DRIVER_NOTE, true);
    var canvases = list.map(renderOne);
    // Image size follows the rendered label, which is swapped when rotated 90°.
    var w = canvases[0].width / LabelRenderer.DOTS_PER_MM;
    var h = canvases[0].height / LabelRenderer.DOTS_PER_MM;
    var frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    var doc = frame.contentDocument;
    doc.open();
    doc.write('<!doctype html><html><head><title>iNat labels</title><style>' +
      // An explicit size wider than tall makes Chrome send a landscape job,
      // which the M220 driver turns 90° clockwise. Forcing portrait sends the
      // page as-is onto the driver's 60 x 40 mm paper.
      '@page{size:portrait;margin:0}' +
      'html,body{margin:0;padding:0}' +
      'img{display:block;width:' + w + 'mm;height:' + h + 'mm;image-rendering:pixelated;break-inside:avoid}' +
      'img:not(:last-child){break-after:page;page-break-after:always}' +
      '</style></head><body></body></html>');
    doc.close();
    var loads = list.map(function (o, i) {
      var img = doc.createElement('img');
      img.alt = String(o.id);
      doc.body.appendChild(img);
      return new Promise(function (resolve) {
        img.onload = img.onerror = resolve;
        img.src = canvases[i].toDataURL('image/png');
      });
    });
    Promise.all(loads).then(function () {
      var win = frame.contentWindow;
      var cleanup = function () { setTimeout(function () { frame.remove(); }, 500); };
      win.addEventListener('afterprint', cleanup);
      win.focus();
      win.print();
      setTimeout(cleanup, 120000);
    });
  }

  // ---- Printing: direct (Web Serial / Web Bluetooth) -----------------------
  async function printDirect(kind) {
    var list = selectedObservations();
    if (!list.length) return;
    var printer = kind === 'ble'
      ? (state.ble = state.ble || new Phomemo.BlePrinter())
      : (state.serial = state.serial || new Phomemo.SerialPrinter());
    state.busy = true;
    updateControls();
    try {
      conn('Connecting…');
      await printer.connect();
      for (var i = 0; i < list.length; i++) {
        var job = Phomemo.buildJob([renderOne(list[i])], state.settings);
        var prefix = 'Printing ' + (i + 1) + ' of ' + list.length + ' on ' + printer.label();
        conn(prefix + '…');
        await printer.write(job, function (p) { conn(prefix + '… ' + Math.round(p * 100) + '%'); });
      }
      conn('Sent ' + list.length + ' label' + (list.length === 1 ? '' : 's') + ' to ' + printer.label() + '.');
    } catch (err) {
      if (err && err.name === 'NotFoundError') conn('No printer chosen.');
      else {
        conn('Printing failed: ' + (err && err.message ? err.message : err), true);
        try { await printer.disconnect(); } catch (e) { /* ignore */ }
      }
    } finally {
      state.busy = false;
      updateControls();
    }
  }

  // ---- Export --------------------------------------------------------------
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\r\n\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    var list = selectedObservations();
    var cols = [
      ['inat_id', 'id'], ['username', 'username'], ['observer_name', 'userFullName'], ['date', 'date'],
      ['time', 'time'], ['species', 'species'], ['common_name', 'commonName'], ['rank', 'rank'],
      ['location', 'place'], ['latitude', 'latitude'], ['longitude', 'longitude'], ['url', 'url']
    ];
    var lines = [cols.map(function (c) { return c[0]; }).concat('qr_code').join(',')];
    list.forEach(function (o) {
      lines.push(cols.map(function (c) { return csvCell(o[c[1]]); }).concat(csvCell(LabelRenderer.qrPayload(o))).join(','));
    });
    // BOM so Excel opens it as UTF-8.
    download(new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }),
      'inat-labels-' + ($('date').value || today()) + '.csv');
  }

  function downloadPng() {
    var o = byId(state.activeId);
    if (!o) return;
    renderOne(o).toBlob(function (blob) { download(blob, 'inat-' + o.id + '.png'); }, 'image/png');
  }

  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---- Demo data (?demo=1) -------------------------------------------------
  function isDemo() { return /[?&]demo=1\b/.test(location.search); }

  function demoObservations(username, date) {
    var rows = [
      [279870013, '09:42', 'Hydnellum scrobiculatum', 'species', 'Zoned Tooth', 'Epping Forest, Loughton, UK'],
      [279870080, '10:05', 'Amanita muscaria', 'species', 'Fly Agaric', 'Epping Forest, Loughton, UK'],
      [279870396, '10:31', 'Cortinarius', 'genus', 'Webcaps', 'Wake Valley Pond, Epping Forest, Essex, England, United Kingdom'],
      [279870839, '11:12', 'Hypholoma fasciculare', 'species', 'Sulphur Tuft', 'High Beach, Waltham Abbey, UK'],
      [279871281, '', 'Agaricomycetes', 'class', 'Mushroom-forming Fungi', 'Epping Forest, UK'],
      [279871502, '11:40', 'Quercus robur', 'species', 'English Oak', 'Epping Forest, Loughton, UK', false]
    ];
    return rows.map(function (r) {
      return {
        id: r[0], username: username, userFullName: 'Morgan Fielding', date: date, time: r[1], species: r[2],
        rank: r[3], commonName: r[4], fungal: r[6] !== false, place: r[5], latitude: '51.6612', longitude: '0.0512',
        obscured: false, photo: '', url: 'https://www.inaturalist.org/observations/' + r[0]
      };
    });
  }

  // ---- Init ----------------------------------------------------------------
  function init() {
    state.settings = Object.assign({}, DEFAULTS, load('settings') || {});
    writeSettings();
    $('username').value = load('username') || '';
    $('date').value = today();
    $('date-field').value = load('dateField') || 'observed';
    $('fungi-only').checked = load('fungiOnly') !== false;

    $('find-form').addEventListener('submit', find);
    $('fungi-only').addEventListener('change', function () {
      save('fungiOnly', $('fungi-only').checked);
      applyFilter();
    });
    $('select-all').addEventListener('click', function () {
      state.observations.forEach(function (o) { state.selected.add(o.id); });
      renderTable();
      updateControls();
    });
    $('select-none').addEventListener('click', function () {
      state.selected.clear();
      renderTable();
      updateControls();
    });
    $('print-driver').addEventListener('click', printViaDriver);
    $('print-serial').addEventListener('click', function () { printDirect('serial'); });
    $('print-ble').addEventListener('click', function () { printDirect('ble'); });
    $('export-csv').addEventListener('click', exportCsv);
    $('download-png').addEventListener('click', downloadPng);
    Object.keys(SETTING_INPUTS).forEach(function (key) {
      $(SETTING_INPUTS[key]).addEventListener('change', function () { readSettings(); renderPreview(); });
    });

    var notes = [];
    if (!driverOrientationReliable()) notes.push(DRIVER_NOTE);
    if (!Phomemo.SerialPrinter.supported()) notes.push('USB/COM printing needs Chrome or Edge on a computer.');
    if (!Phomemo.BlePrinter.supported()) notes.push('Bluetooth printing needs Chrome or Edge.');
    conn(notes.join(' '));
    if (isDemo()) {
      status('Demo mode: Find returns sample observations without contacting iNaturalist.');
      if (!$('username').value) $('username').value = 'foray_demo';
    }
    renderPreview();
    updateControls();
  }

  // Fonts must be ready before drawing on canvas, or the first preview uses a fallback.
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(init);
})();
