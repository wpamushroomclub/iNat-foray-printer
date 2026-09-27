# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.2] - 2026-09-27

### Fixed

- The side strip's last line (the species) could fall off the edge of the
  label. The whole label now shifts 1.5 mm left, towards the QR code, for
  every printing method.

### Added

- **Shift left (mm)** in Label & printer settings, to tune that shift for a
  particular printer.

## [1.0.1] - 2026-09-27

### Fixed

- Opening the page at an address without a trailing slash (for example
  `/tools/inat-foray-printer`) loaded it without its styles and scripts; it
  now adds the slash.
- The footer's MIT License link opens the license on GitHub instead of
  downloading a file when the page is hosted.

## [1.0.0] - 2026-09-27

First release.

### Added

- Find one iNaturalist user's observations for a day, by date observed or
  date uploaded, and choose which to print.
- 60 × 40 mm Phomemo M220 labels: QR code (iNat # and username), observer
  name, date and time, species and location.
- A cut-off side strip with a Data Matrix code of the iNat number, kept with
  the physical voucher.
- Printing through the Windows driver, direct over USB/COM port or
  Bluetooth, and CSV export for Labelife.
- Settings for label size, density, speed, media, offset, rotation and QR
  field order.
- Demo mode (`index.html?demo=1`).
- WPMC website styling, MIT License.

[Unreleased]: https://github.com/wpamushroomclub/iNat-foray-printer/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/wpamushroomclub/iNat-foray-printer/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/wpamushroomclub/iNat-foray-printer/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/wpamushroomclub/iNat-foray-printer/releases/tag/v1.0.0
