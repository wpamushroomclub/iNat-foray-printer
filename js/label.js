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

  // Draws a Data Matrix of the digits with squares of up to maxModule dots,
  // fitting within size x size dots. Returns the drawn size or 0 if it cannot fit.
  function drawDataMatrix(ctx, digits, x, y, size, maxModule) {
    var dm = global.DataMatrix.encode(digits);
    var m = Math.min(maxModule, Math.floor(size / dm.size));
    if (m < 1) return 0;
    for (var r = 0; r < dm.size; r++) {
      for (var c = 0; c < dm.size; c++) {
        if (dm.isDark(r, c)) ctx.fillRect(x + c * m, y + r * m, m, m);
      }
    }
    return dm.size * m;
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

  // What the main QR code types when scanned: two fields separated by a Tab.
  function qrPayload(obs, opts) {
    return opts && opts.qrUsernameFirst
      ? obs.username + '\t' + obs.id
      : obs.id + '\t' + obs.username;
  }

  function dateTime(obs) {
    return obs.time ? obs.date + ' ' + obs.time : obs.date;
  }

  /**
   * Renders a label for one observation.
   * obs:  {id, username, date, time, species, rank, place}
   * opts: {widthMm, heightMm, rotation, qrUsernameFirst}
   *       (rotation: degrees counter-clockwise)
   * Returns a canvas of widthMm*8 x heightMm*8 dots (swapped at 90/270).
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
    // The side strip is cut off along the divider and kept with the physical
    // voucher, so it carries its own barcode and details: a barcode plus two
    // text rows (about 20 dots each) at 24% of the label width.
    var stripW = Math.round(W * 0.24);
    var ruleW = Math.max(3, Math.round(4 * k));
    var ruleX = W - stripW;
    var mainRight = ruleX - Math.round(10 * k);
    var italic = !!ITALIC_RANKS[obs.rank];
    var species = obs.species || 'Unknown';
    var place = obs.place || '';

    // --- Main panel -------------------------------------------------------
    var qrSize = drawQr(ctx, qrPayload(obs, opts), pad, pad, Math.round(H * 0.42));

    var tx = pad + qrSize + Math.round(14 * k);
    var tw = mainRight - tx;
    var y = pad;

    ctx.font = font(Math.round(15 * k));
    y += Math.round(15 * k);
    ctx.fillText('iNat #', tx, y);

    var idPx = fitSize(ctx, String(obs.id), tw, Math.round(40 * k), Math.round(16 * k), { bold: true });
    ctx.font = font(idPx, { bold: true });
    y += Math.round(idPx * 0.95);
    ctx.fillText(String(obs.id), tx, y);

    var userPx = fitSize(ctx, obs.username, tw, Math.round(26 * k), Math.round(14 * k));
    ctx.font = font(userPx);
    y += Math.round(userPx * 1.15);
    ctx.fillText(ellipsize(ctx, obs.username, tw), tx, y);

    if (obs.userFullName) {
      var namePx = fitSize(ctx, obs.userFullName, tw, Math.round(22 * k), Math.round(14 * k));
      ctx.font = font(namePx);
      y += Math.round(namePx * 1.15);
      ctx.fillText(ellipsize(ctx, obs.userFullName, tw), tx, y);
    }

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
    var cutGap = Math.round(10 * k);                     // clearance for an imprecise cut
    var stripInner = stripW - ruleW - cutGap - Math.round(16 * k); // usable across; 2 mm clear of the edge, which the printer cannot reach
    var along = H - 2 * pad;                             // usable along the strip
    ctx.save();
    ctx.translate(ruleX + ruleW + cutGap, H - pad);
    ctx.rotate(-Math.PI / 2);
    // Data Matrix of the iNat number nearest the cut line, with the number
    // beside it, then the date and time, then the species.
    // Squares of 3+ dots survive thermal ink spread, where thin 1D bars merge.
    var barH = Math.round(38 * k); // 12x12 symbol at 3 dots per square
    var dmSize = drawDataMatrix(ctx, String(obs.id), 0, 0, barH, 4);
    var idX = dmSize + Math.round(8 * k);
    var sideIdPx = fitSize(ctx, String(obs.id), along - idX, Math.round(barH * 0.8), Math.round(11 * k), { bold: true });
    ctx.font = font(sideIdPx, { bold: true });
    ctx.fillText(ellipsize(ctx, String(obs.id), along - idX), idX, Math.round(barH / 2 + sideIdPx * 0.36));

    var rows = [{ text: dt }, { text: species, italic: italic }];
    var sy = barH + Math.round(2 * k);
    var rowH = (stripInner - sy) / rows.length;
    rows.forEach(function (row) {
      var px = fitSize(ctx, row.text, along, Math.floor(rowH / 1.12), Math.round(11 * k), row);
      ctx.font = font(px, row);
      ctx.fillText(ellipsize(ctx, row.text, along), 0, Math.round(sy + rowH / 2 + px * 0.36));
      sy += rowH;
    });
    ctx.restore();

    binarize(ctx, W, H);

    return rotate(canvas, +opts.rotation || 0);
  }

  // Rotates a canvas counter-clockwise by 0, 90, 180 or 270 degrees.
  function rotate(canvas, degCcw) {
    var W = canvas.width;
    var H = canvas.height;
    var turns = ((Math.round(degCcw / 90) % 4) + 4) % 4;
    if (!turns) return canvas;
    var out = document.createElement('canvas');
    out.width = turns % 2 ? H : W;
    out.height = turns % 2 ? W : H;
    var octx = out.getContext('2d');
    if (turns === 1) octx.translate(0, W);
    else if (turns === 2) octx.translate(W, H);
    else octx.translate(H, 0);
    octx.rotate(-turns * Math.PI / 2);
    octx.drawImage(canvas, 0, 0);
    return out;
  }

  global.LabelRenderer = {
    DOTS_PER_MM: DOTS_PER_MM,
    render: render,
    qrPayload: qrPayload
  };
})(window);
