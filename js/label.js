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
    var stripW = Math.round(W * 0.21);
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
    var rows = [
      { text: String(obs.id), bold: true, weight: 1.25 },
      { text: obs.username, weight: 1 },
      { text: dt, weight: 1 },
      { text: species, italic: italic, weight: 1 }
    ];
    var totalWeight = rows.reduce(function (s, r) { return s + r.weight; }, 0);
    var unit = stripInner / (totalWeight * 1.12);
    var sy = 0;
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
