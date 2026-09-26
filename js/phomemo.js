// Direct printing to a Phomemo M110/M120/M220 without the Windows driver.
//
// Protocol (reverse-engineered by https://github.com/vivier/phomemo-tools):
//   ESC N 0x0d n     print speed   (1 slow .. 5 fast)
//   ESC N 0x04 n     print density (1 light .. 15 dark)
//   0x1f 0x11 n      media type    (0x0a labels with gaps, 0x0b continuous, 0x26 black marks)
//   GS v 0 m xL xH yL yH <data>   raster image, x = bytes per row, y = rows, 1 = black
//   0x1f 0xf0 0x05 0x00 / 0x1f 0xf0 0x03 0x00   end of label (feed to next gap)
//
// Transports: Web Serial (USB virtual COM port, or a paired Bluetooth
// "Standard Serial over Bluetooth" COM port) and Web Bluetooth (BLE).
(function (global) {
  'use strict';

  var MEDIA = { gaps: 0x0a, continuous: 0x0b, marks: 0x26 };

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v | 0)); }

  // Packs a black/white canvas into 1-bit rows, MSB first, 1 = black.
  // offsetDots shifts the image right to line it up with the label.
  function toRaster(canvas, offsetDots) {
    offsetDots = Math.max(0, offsetDots | 0);
    var w = canvas.width;
    var h = canvas.height;
    var px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    var bytesPerRow = Math.ceil((w + offsetDots) / 8);
    var out = new Uint8Array(bytesPerRow * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (px[i] < 128) {
          var bx = x + offsetDots;
          out[y * bytesPerRow + (bx >> 3)] |= 0x80 >> (bx & 7);
        }
      }
    }
    return { bytesPerRow: bytesPerRow, rows: h, data: out };
  }

  // Builds the full byte stream for a print job (one or more labels).
  function buildJob(canvases, opts) {
    opts = opts || {};
    var speed = clamp(opts.speed == null ? 3 : opts.speed, 1, 5);
    var density = clamp(opts.density == null ? 10 : opts.density, 1, 15);
    var media = MEDIA[opts.media] != null ? MEDIA[opts.media] : MEDIA.gaps;
    var parts = [];
    var total = 0;
    function push(arr) {
      var u = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
      parts.push(u);
      total += u.length;
    }
    canvases.forEach(function (canvas) {
      var r = toRaster(canvas, opts.offsetDots);
      push([0x1b, 0x4e, 0x0d, speed]);
      push([0x1b, 0x4e, 0x04, density]);
      push([0x1f, 0x11, media]);
      push([0x1d, 0x76, 0x30, 0x00,
        r.bytesPerRow & 0xff, r.bytesPerRow >> 8,
        r.rows & 0xff, r.rows >> 8]);
      push(r.data);
      push([0x1f, 0xf0, 0x05, 0x00]);
      push([0x1f, 0xf0, 0x03, 0x00]);
    });
    var job = new Uint8Array(total);
    var o = 0;
    parts.forEach(function (p) { job.set(p, o); o += p.length; });
    return job;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---- Web Serial (USB or Bluetooth COM port) ------------------------------
  function SerialPrinter() { this.port = null; }

  SerialPrinter.supported = function () { return 'serial' in navigator; };

  SerialPrinter.prototype.connect = async function () {
    if (this.port) return;
    var port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    this.port = port;
  };

  SerialPrinter.prototype.write = async function (bytes, onProgress) {
    var writer = this.port.writable.getWriter();
    try {
      var chunk = 4096;
      for (var o = 0; o < bytes.length; o += chunk) {
        await writer.write(bytes.subarray(o, o + chunk));
        if (onProgress) onProgress(Math.min(1, (o + chunk) / bytes.length));
      }
    } finally {
      writer.releaseLock();
    }
  };

  SerialPrinter.prototype.disconnect = async function () {
    if (!this.port) return;
    try { await this.port.close(); } catch (e) { /* already closed */ }
    this.port = null;
  };

  SerialPrinter.prototype.label = function () { return 'USB / COM port'; };

  // ---- Web Bluetooth (BLE) -------------------------------------------------
  // Phomemo label printers expose service 0xff00 with write characteristic
  // 0xff02. The others are common on generic thermal printers and are only
  // used if 0xff00 is not present.
  var BLE_SERVICES = [
    0xff00,
    0x18f0,
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455'
  ];
  var MIN_CHUNK = 20; // fits the default BLE MTU

  function BlePrinter() { this.device = null; this.ch = null; this.chunk = 128; }

  BlePrinter.supported = function () { return 'bluetooth' in navigator; };

  BlePrinter.prototype.connect = async function () {
    if (this.ch && this.device.gatt.connected) return;
    if (!this.device) {
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: BLE_SERVICES
      });
    }
    var server = await this.device.gatt.connect();
    var services = await server.getPrimaryServices();
    var fallback = null;
    for (var i = 0; i < services.length && !this.ch; i++) {
      var chars;
      try { chars = await services[i].getCharacteristics(); } catch (e) { continue; }
      for (var j = 0; j < chars.length; j++) {
        var p = chars[j].properties;
        if (!(p.write || p.writeWithoutResponse)) continue;
        if (/^0000ff02-/.test(chars[j].uuid)) { this.ch = chars[j]; break; }
        if (!fallback) fallback = chars[j];
      }
    }
    this.ch = this.ch || fallback;
    if (!this.ch) {
      this.device.gatt.disconnect();
      this.device = null;
      throw new Error('No writable printer characteristic found on this Bluetooth device.');
    }
  };

  BlePrinter.prototype.write = async function (bytes, onProgress) {
    var ch = this.ch;
    var noResponse = ch.properties.writeWithoutResponse;
    var o = 0;
    var sinceYield = 0;
    while (o < bytes.length) {
      var piece = bytes.slice(o, o + this.chunk);
      try {
        if (noResponse) await ch.writeValueWithoutResponse(piece);
        else await ch.writeValueWithResponse(piece);
      } catch (e) {
        // The negotiated MTU is smaller than our chunk: retry this piece smaller.
        if (this.chunk > MIN_CHUNK) { this.chunk = MIN_CHUNK; continue; }
        throw e;
      }
      o += piece.length;
      sinceYield += piece.length;
      // Without acknowledgements the printer's buffer can overflow; pace the stream.
      if (noResponse && sinceYield >= 1024) { sinceYield = 0; await sleep(20); }
      if (onProgress) onProgress(o / bytes.length);
    }
  };

  BlePrinter.prototype.disconnect = async function () {
    if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
    this.device = null;
    this.ch = null;
  };

  BlePrinter.prototype.label = function () {
    return 'Bluetooth' + (this.device && this.device.name ? ' (' + this.device.name + ')' : '');
  };

  global.Phomemo = {
    toRaster: toRaster,
    buildJob: buildJob,
    SerialPrinter: SerialPrinter,
    BlePrinter: BlePrinter
  };
})(window);
