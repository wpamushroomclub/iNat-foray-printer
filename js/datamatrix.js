// Minimal Data Matrix (ECC 200) encoder for digit strings, square symbols
// 10x10 to 26x26 (single data region). Placement follows ISO/IEC 16022
// Annex F; error correction is Reed-Solomon over GF(256), polynomial 0x12D.
(function (global) {
  'use strict';

  // [symbol size, data codewords, error-correction codewords]
  var SIZES = [[10, 3, 5], [12, 5, 7], [14, 8, 10], [16, 12, 12], [18, 18, 14],
    [20, 22, 18], [22, 30, 20], [24, 36, 24], [26, 44, 28]];

  var EXP = new Array(255);
  var LOG = new Array(256);
  (function () {
    for (var i = 0, x = 1; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x12d;
    }
  })();

  function mul(a, b) {
    return a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0;
  }

  // Error-correction codewords for data, using generator roots a^1..a^n.
  function reedSolomon(data, n) {
    var gen = [1];
    for (var i = 1; i <= n; i++) {
      var next = new Array(gen.length + 1).fill(0);
      for (var j = 0; j < gen.length; j++) {
        next[j] ^= gen[j];
        next[j + 1] ^= mul(gen[j], EXP[i]);
      }
      gen = next;
    }
    var ecc = new Array(n).fill(0);
    data.forEach(function (d) {
      var f = d ^ ecc[0];
      ecc.shift();
      ecc.push(0);
      for (var k = 0; k < n; k++) ecc[k] ^= mul(gen[k + 1], f);
    });
    return ecc;
  }

  // ASCII encodation: digit pairs as 130+nn, a lone digit as its code + 1.
  function encodeDigits(digits) {
    var cw = [];
    var i = 0;
    for (; i + 1 < digits.length; i += 2) cw.push(130 + parseInt(digits.substr(i, 2), 10));
    if (i < digits.length) cw.push(digits.charCodeAt(i) + 1);
    return cw;
  }

  // Maps each data-region module to (codeword, bit): value 10*chr + bit,
  // chr counting from 1 and bit 1 = most significant; 1 = fixed dark module.
  function placement(nrow, ncol) {
    var a = new Array(nrow * ncol).fill(0);
    function module(row, col, chr, bit) {
      if (row < 0) { row += nrow; col += 4 - ((nrow + 4) % 8); }
      if (col < 0) { col += ncol; row += 4 - ((ncol + 4) % 8); }
      a[row * ncol + col] = 10 * chr + bit;
    }
    function utah(row, col, chr) {
      module(row - 2, col - 2, chr, 1); module(row - 2, col - 1, chr, 2);
      module(row - 1, col - 2, chr, 3); module(row - 1, col - 1, chr, 4);
      module(row - 1, col, chr, 5); module(row, col - 2, chr, 6);
      module(row, col - 1, chr, 7); module(row, col, chr, 8);
    }
    function corner1(chr) {
      module(nrow - 1, 0, chr, 1); module(nrow - 1, 1, chr, 2); module(nrow - 1, 2, chr, 3);
      module(0, ncol - 2, chr, 4); module(0, ncol - 1, chr, 5); module(1, ncol - 1, chr, 6);
      module(2, ncol - 1, chr, 7); module(3, ncol - 1, chr, 8);
    }
    function corner2(chr) {
      module(nrow - 3, 0, chr, 1); module(nrow - 2, 0, chr, 2); module(nrow - 1, 0, chr, 3);
      module(0, ncol - 4, chr, 4); module(0, ncol - 3, chr, 5); module(0, ncol - 2, chr, 6);
      module(0, ncol - 1, chr, 7); module(1, ncol - 1, chr, 8);
    }
    function corner3(chr) {
      module(nrow - 3, 0, chr, 1); module(nrow - 2, 0, chr, 2); module(nrow - 1, 0, chr, 3);
      module(0, ncol - 2, chr, 4); module(0, ncol - 1, chr, 5); module(1, ncol - 1, chr, 6);
      module(2, ncol - 1, chr, 7); module(3, ncol - 1, chr, 8);
    }
    function corner4(chr) {
      module(nrow - 1, 0, chr, 1); module(nrow - 1, ncol - 1, chr, 2);
      module(0, ncol - 3, chr, 3); module(0, ncol - 2, chr, 4); module(0, ncol - 1, chr, 5);
      module(1, ncol - 3, chr, 6); module(1, ncol - 2, chr, 7); module(1, ncol - 1, chr, 8);
    }
    var chr = 1, row = 4, col = 0;
    do {
      if (row === nrow && col === 0) corner1(chr++);
      if (row === nrow - 2 && col === 0 && ncol % 4) corner2(chr++);
      if (row === nrow - 2 && col === 0 && ncol % 8 === 4) corner3(chr++);
      if (row === nrow + 4 && col === 2 && !(ncol % 8)) corner4(chr++);
      do {
        if (row < nrow && col >= 0 && !a[row * ncol + col]) utah(row, col, chr++);
        row -= 2; col += 2;
      } while (row >= 0 && col < ncol);
      row += 1; col += 3;
      do {
        if (row >= 0 && col < ncol && !a[row * ncol + col]) utah(row, col, chr++);
        row += 2; col -= 2;
      } while (row < nrow && col >= 0);
      row += 3; col += 1;
    } while (row < nrow || col < ncol);
    if (!a[nrow * ncol - 1]) a[nrow * ncol - 1] = a[nrow * ncol - ncol - 2] = 1;
    return a;
  }

  /**
   * Encodes a digit string. Returns {size, isDark(row, col)} where row 0 is
   * the top edge, or throws if the digits do not fit a 26x26 symbol.
   */
  function encode(digits) {
    var data = encodeDigits(String(digits));
    var spec = SIZES.filter(function (s) { return s[1] >= data.length; })[0];
    if (!spec) throw new Error('Too many digits for Data Matrix');
    var size = spec[0];
    // Pad: 129 first, then the 253-state randomised pad.
    if (data.length < spec[1]) data.push(129);
    while (data.length < spec[1]) {
      var r = ((149 * (data.length + 1)) % 253) + 1;
      var v = 129 + r;
      data.push(v > 254 ? v - 254 : v);
    }
    var cw = data.concat(reedSolomon(data, spec[2]));
    var n = size - 2;
    var map = placement(n, n);
    function isDark(row, col) {
      if (col === 0 || row === size - 1) return true;                   // solid L
      if (row === 0) return col % 2 === 0;                               // top clock track
      if (col === size - 1) return (size - 1 - row) % 2 === 0;           // right clock track
      var v = map[(row - 1) * n + (col - 1)];
      if (v === 1) return true;
      return !!(cw[Math.floor(v / 10) - 1] & (1 << (8 - (v % 10))));
    }
    return { size: size, isDark: isDark };
  }

  global.DataMatrix = { encode: encode };
})(typeof window !== 'undefined' ? window : globalThis);
