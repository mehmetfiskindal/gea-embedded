# Moddable XS Vendor Snapshot

This directory is a vendored snapshot of the `xs/` subtree from the Moddable SDK:

https://github.com/Moddable-OpenSource/moddable

The firmware build uses these sources directly. In particular, the ESP32 target compiles the XS runtime sources and builds the host `xsc` compiler from `tools/xsc.c`.

## Provenance

- Upstream repository: `https://github.com/Moddable-OpenSource/moddable`
- Upstream path: `xs/`
- Snapshot commit: not recorded when this copy was created
- Refresh policy: when updating this directory, replace it from a specific upstream commit and record that commit here.

## License Notes

The files in this directory retain their original upstream notices. Current headers include:

- Moddable SDK Runtime files under GNU LGPLv3 or later.
- Moddable SDK Tools files under GNU GPLv3 or later.
- Older Kinoma/Marvell notices under Apache-2.0 in many runtime files.
- Additional upstream notices in `LICENSES/NOTICE`.

The GPLv3 text is available at the repository root in `../../LICENSE`. The LGPLv3 text is included in `LICENSES/LGPL-3.0.txt`.

For proprietary or commercial product terms outside the open-source licenses, see [Moddable's commercial licensing information](https://www.moddable.com/license).
