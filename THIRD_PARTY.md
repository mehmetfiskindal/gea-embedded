# Third-Party Notices

This repository vendors a small amount of third-party source code so firmware and simulator builds are reproducible without fetching those sources at build time.

Unless a file says otherwise, the project code outside `vendor/` is licensed under the GNU General Public License version 3 only. Vendored third-party files keep their original copyright notices and license terms.

## Moddable XS

- Path: `vendor/xs/`
- Upstream: https://github.com/Moddable-OpenSource/moddable
- Upstream source path: `xs/`
- Snapshot: copied from the Moddable SDK `xs/` tree; the exact source commit was not recorded when this snapshot was created.
- Local use: compiled directly by the ESP32 target and used to build the host `xsc` compiler.
- License notes: XS files carry a mix of Moddable SDK Runtime LGPLv3-or-later notices, Moddable SDK Tools GPLv3-or-later notices, and older Apache-2.0/Kinoma/Marvell notices. See `vendor/xs/README.md`, `vendor/xs/LICENSES/LGPL-3.0.txt`, `vendor/xs/LICENSES/NOTICE`, and the per-file headers.

## stb_image

- Path: `vendor/stb/stb_image.h`
- Upstream: https://github.com/nothings/stb
- License: public domain or MIT, as stated in the file.

## AnimatedGIF

- Path: `vendor/AnimatedGIF/`
- Upstream: https://github.com/bitbank2/AnimatedGIF
- License: Apache-2.0, as stated in the files.
