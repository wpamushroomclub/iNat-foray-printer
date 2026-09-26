// Label rendering: draws one observation onto a 1-bit canvas at the printer's
// native resolution (203 dpi = 8 dots per mm), so the preview is exactly what
// gets printed.
(function (global) {
  'use strict';

  var DOTS_PER_MM = 8;
  var FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
  var INK_THRESHOLD = 150; // luminance below this prints black

  // Taxon ranks that are conventionally italicised (genus and below).
  var ITALIC_RANKS = {
    genus: 1, genushybrid: 1, subgenus: 1, section: 1, subsection: 1,
    complex: 1, species: 1, hybrid: 1, subspecies: 1, variety: 1, form: 1
  };

  function font(px, opts) {
    opts = opts || {};
    return (opts.italic ? 'italic ' : '') + (opts.bold ? '700 ' : '400 ') + px + 'px ' + FONT;
  }

  // Largest font size (maxPx..minPx) at which text fits in maxWidth.
  function fitSize(ctx, text, maxWidth, maxPx, minPx, opts) {
    for (var px = maxPx; px > minPx; px--) {
      ctx.font = font(px, opts);
      if (ctx.measureText(text).width <= maxWidth) return px;
    }
    return minPx;
  }

  // Shortens text with an ellipsis until it fits (uses the ctx's current font).
  function ellipsize(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    var s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  }

  // Word-wraps text into at most maxLines lines; the last line is ellipsized.
  function wrap(ctx, text, maxWidth, maxLines) {
    var words = String(text).split(/\s+/).filter(Boolean);
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var candidate = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = words[i];
        if (lines.length === maxLines) break;
      }
    }
    if (lines.length < maxLines && line) lines.push(line);
    var used = lines.join(' ').split(/\s+/).filter(Boolean).length;
    if (used < words.length && lines.length) {
      lines[lines.length - 1] = ellipsize(ctx, lines[lines.length - 1] + ' ' + words.slice(used).join(' '), maxWidth);
    }
    return lines.map(function (l) { return ellipsize(ctx, l, maxWidth); });
  }

  // Fits text on one line if it can at >= preferMinPx, otherwise wraps it
  // over up to maxLines lines at wrapPx. Returns {px, lines}.
  function fitOrWrap(ctx, text, maxWidth, maxPx, preferMinPx, wrapPx, maxLines, opts) {
    var px = fitSize(ctx, text, maxWidth, maxPx, preferMinPx, opts);
    ctx.font = font(px, opts);
    if (ctx.measureText(text).width <= maxWidth) return { px: px, lines: [text] };
    ctx.font = font(wrapPx, opts);
    return { px: wrapPx, lines: wrap(ctx, text, maxWidth, maxLines) };
  }

  // Code 128 bar/space widths for symbol values 0..106 (106 = stop).
  var C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 ' +
    '221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
    '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 ' +
    '212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
    '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 ' +
    '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
    '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 ' +
    '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
    '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 ' +
    '214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
    '114131 311141 411131 211412 211214 211232 2331112').split(' ');

  // Encodes a digit string as Code 128 symbol values: code set C (digit
  // pairs), switching to code set B for a trailing odd digit.
  function code128Digits(digits) {
    var values = [105]; // Start C
    var i = 0;
    for (; i + 1 < digits.length; i += 2) values.push(parseInt(digits.substr(i, 2), 10));
    if (i < digits.length) {
      values.push(100); // Code B
      values.push(digits.charCodeAt(i) - 32);
    }
    var sum = values[0];
    for (var j = 1; j < values.length; j++) sum += j * values[j];
    values.push(sum % 103, 106);
    return values;
  }

  // Draws a Code 128 barcode with bars running across the current y axis.
  // Returns the drawn length (excluding quiet zones) or 0 if it cannot fit.
  function drawCode128(ctx, digits, x, y, maxLen, height) {
    var widths = code128Digits(digits).map(function (v) { return C128[v]; }).join('');
    var modules = 0;
    for (var i = 0; i < widths.length; i++) modules += +widths[i];
    var quiet = 10; // modules of white either side, required by scanners
    var m = Math.min(3, Math.floor(maxLen / (modules + 2 * quiet)));
    if (m < 1) return 0;
    var len = modules * m;
    var cx = x + Math.floor((maxLen - len) / 2);
    for (var b = 0; b < widths.length; b++) {
      var w = +widths[b] * m;
      if (b % 2 === 0) ctx.fillRect(cx, y, w, height);
      cx += w;
    }
    return len;
  }

  function drawQr(ctx, payload, x, y, maxSize) {
    var qr = global.qrcode(0, 'M');
    qr.addData(payload, 'Byte');
    qr.make();
    var n = qr.getModuleCount();
    var cell = Math.max(1, Math.floor(maxSize / n));
    ctx.fillStyle = '#000';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(x + c * cell, y + r * cell, cell, cell);
      }
    }
    return n * cell;
  }

  // Forces every pixel to pure black or white, as the thermal head will print it.
  function binarize(ctx, w, h) {
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      var v = lum < INK_THRESHOLD ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function qrPayload(obs) {
    return obs.id + '\t' + obs.username;
  }

  function dateTime(obs) {
    return obs.time ? obs.date + ' ' + obs.time : obs.date;
  }

  /**
   * Renders a label for one observation.
   * obs:  {id, username, date, time, species, rank, place}
   * opts: {widthMm, heightMm, rotate180}
   * Returns a canvas of widthMm*8 x heightMm*8 dots.
   */
  function render(obs, opts) {
    var W = Math.round(opts.widthMm * DOTS_PER_MM);
    var H = Math.round(opts.heightMm * DOTS_PER_MM);
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'alphabetic';

    // Scale all measurements from the 60 x 40 mm reference design.
    var k = Math.min(W / 480, H / 320);
    var pad = Math.round(12 * k);
    var stripW = Math.round(W * 0.25);
    var ruleW = Math.max(3, Math.round(4 * k));
    var ruleX = W - stripW;
    var mainRight = ruleX - Math.round(10 * k);
    var italic = !!ITALIC_RANKS[obs.rank];
    var species = obs.species || 'Unknown';
    var place = obs.place || '';

    // --- Main panel -------------------------------------------------------
    var qrSize = drawQr(ctx, qrPayload(obs), pad, pad, Math.round(H * 0.42));

    var tx = pad + qrSize + Math.round(14 * k);
    var tw = mainRight - tx;
    var y = pad;

    ctx.font = font(Math.round(15 * k));
    y += Math.round(15 * k);
    ctx.fillText('iNat #', tx, y);

    var idPx = fitSize(ctx, String(obs.id), tw, Math.round(46 * k), Math.round(16 * k), { bold: true });
    ctx.font = font(idPx, { bold: true });
    y += Math.round(idPx * 0.95);
    ctx.fillText(String(obs.id), tx, y);

    var userPx = fitSize(ctx, obs.username, tw, Math.round(26 * k), Math.round(14 * k));
    ctx.font = font(userPx);
    y += Math.round(userPx * 1.15);
    ctx.fillText(ellipsize(ctx, obs.username, tw), tx, y);

    var dt = dateTime(obs);
    var dtPx = fitSize(ctx, dt, tw, Math.round(22 * k), Math.round(14 * k));
    ctx.font = font(dtPx);
    y += Math.round(dtPx * 1.2);
    ctx.fillText(ellipsize(ctx, dt, tw), tx, y);

    var mainW = mainRight - pad;
    y = Math.max(y, pad + qrSize) + Math.round(8 * k);

    var sp = fitOrWrap(ctx, species, mainW, Math.round(30 * k), Math.round(20 * k), Math.round(20 * k), 2,
      { bold: true, italic: italic });
    ctx.font = font(sp.px, { bold: true, italic: italic });
    sp.lines.forEach(function (line) {
      y += Math.round(sp.px * 1.05);
      ctx.fillText(line, pad, y);
    });

    if (place) {
      // Largest size (24..16) at which the whole place name fits in the space left.
      var placePx, lineH, placeLines;
      for (placePx = Math.round(24 * k); placePx >= Math.round(16 * k); placePx--) {
        lineH = Math.round(placePx * 1.15);
        var linesLeft = Math.max(1, Math.floor((H - pad - y) / lineH));
        ctx.font = font(placePx);
        placeLines = wrap(ctx, place, mainW, linesLeft);
        if (!/…$/.test(placeLines[placeLines.length - 1])) break;
      }
      placeLines.forEach(function (line) {
        y += lineH;
        ctx.fillText(line, pad, y);
      });
    }

    // --- Divider ----------------------------------------------------------
    ctx.fillRect(ruleX, Math.round(4 * k), ruleW, H - Math.round(8 * k));

    // --- Side strip, rotated 90 degrees (reads bottom to top) --------------
    var stripInner = stripW - ruleW - Math.round(8 * k); // usable across the strip
    var along = H - 2 * pad;                             // usable along the strip
    ctx.save();
    ctx.translate(ruleX + ruleW + Math.round(4 * k), H - pad);
    ctx.rotate(-Math.PI / 2);
    // Barcode of the iNat number next to the divider, then text rows.
    var barH = Math.round(stripInner * 0.34);
    drawCode128(ctx, String(obs.id), 0, 0, along, barH);
    var rows = [
      { text: String(obs.id), bold: true, weight: 1.15 },
      { text: obs.username, weight: 1 },
      { text: dt, weight: 1 },
      { text: species, italic: italic, weight: 1 }
    ];
    var totalWeight = rows.reduce(function (s, r) { return s + r.weight; }, 0);
    var sy = barH + Math.round(2 * k);
    var unit = (stripInner - sy) / (totalWeight * 1.12);
    rows.forEach(function (row) {
      var opts2 = { bold: row.bold, italic: row.italic };
      var px = fitSize(ctx, row.text, along, Math.floor(unit * row.weight), Math.round(11 * k), opts2);
      ctx.font = font(px, opts2);
      sy += Math.round(unit * row.weight * 1.12 * 0.5 + px * 0.36);
      ctx.fillText(ellipsize(ctx, row.text, along), 0, sy);
      sy += Math.round(unit * row.weight * 1.12 * 0.5 - px * 0.36);
    });
    ctx.restore();

    binarize(ctx, W, H);

    if (opts.rotate180) {
      var out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      var octx = out.getContext('2d');
      octx.translate(W, H);
      octx.rotate(Math.PI);
      octx.drawImage(canvas, 0, 0);
      return out;
    }
    return canvas;
  }

  global.LabelRenderer = {
    DOTS_PER_MM: DOTS_PER_MM,
    render: render,
    qrPayload: qrPayload
  };
})(window);
