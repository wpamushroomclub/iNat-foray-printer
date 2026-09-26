# iNat Foray Printer

A single web page that finds all of an iNaturalist user's observations for one
day, lets you tick which ones you want, and prints a specimen label for each on
a **Phomemo M220** (60 × 40 mm / 2.36″ × 1.57″ labels by default).

There is no install and no build step. It is plain HTML and JavaScript.

## Label layout

```
 paper output direction ▲
┌───────────────────────────────────────┬─────┐
│ ▄▄▄▄▄▄▄  iNat #                       │  2  │
│ █ QR  █  293293734                    │  9  │   QR code = "<iNat #><TAB><username>"
│ █     █  lostculture                  │  3  │
│ ▀▀▀▀▀▀▀  2026-09-09 09:42             │  …  │   Side strip (rotated 90°):
│ Hydnellum scrobiculatum               │     │     iNat #, username,
│ Epping Forest, Loughton, UK           │     │     date + time, species
└───────────────────────────────────────┴─────┘
```

* Scientific names at genus rank and below are printed in italics.
* The date and time are the observation's local time.
* The location is iNaturalist's place name (`place_guess`), wrapped and sized
  to fit.
* When scanned, the QR code types the number, a Tab, then the username. A
  scanner used as a keyboard therefore fills two spreadsheet cells.

## Using it

1. Open `index.html` in **Chrome or Edge**, either from disk or hosted (for
   example on GitHub Pages).
2. Enter an iNat username and a date, then choose **Find**. You can match by
   the date observed (the default) or the date uploaded.
3. All results start selected. Use **Select all**, **Deselect all**, or the
   checkboxes. Click a row to preview its label.
4. Print using one of the methods below.

To try the page without a network connection or a real account, open
`index.html?demo=1`.

## Printing methods

| Button | What it needs | How it works |
|---|---|---|
| **Print via Windows printer** | The M220 Windows driver ([phomemo.com/pages/drivers](https://phomemo.com/pages/drivers/)) | Opens the browser print dialog with one 60 × 40 mm page per label |
| **Print direct: USB / COM port** | Chrome or Edge on a computer; no driver | Sends printer commands over the USB virtual COM port, or over a paired Bluetooth serial COM port (Web Serial) |
| **Print direct: Bluetooth** | Chrome or Edge with Bluetooth; no driver | Sends printer commands over Bluetooth LE (Web Bluetooth) |
| **Export CSV** | Nothing | Fallback: a spreadsheet to import into Labelife, including a `qr_code` column |

### Windows printer: first-time setup

In the print dialog:

* **Destination:** Phomemo M220
* **More settings → Paper size:** 60 × 40 mm. If that size isn't listed, add
  it in the driver's *Printing preferences*.
* **Margins:** None
* **Scale:** Default (100%)

Chrome remembers these settings for next time.

### Direct printing: calibration

Direct printing sends the label as a 480 × 320 dot image (8 dots = 1 mm).
Open **Label & printer settings** to adjust:

* **Density** (1–15): how dark the print is. Raise it if the print is faint.
* **Speed** (1–5).
* **Media:** labels with gaps (default), continuous roll, or black-mark labels.
* **Left offset:** shifts the image right if the print sits too far left on
  the label.
* **Rotate 180°:** use this if the label comes out upside down.

Settings are saved in the browser.

## Files

| Path | Purpose |
|---|---|
| `index.html`, `css/app.css` | Page and styles |
| `js/inat.js` | iNaturalist API search, with paging and time-zone handling |
| `js/label.js` | Draws a label onto a 1-bit canvas at 203 dpi |
| `js/phomemo.js` | M110/M120/M220 printer protocol, plus the Web Serial and Web Bluetooth connections |
| `js/app.js` | Selection, preview, printing and CSV export |
| `vendor/qrcode.js` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 (MIT) |

The printer protocol comes from the reverse-engineering work in
[vivier/phomemo-tools](https://github.com/vivier/phomemo-tools).
