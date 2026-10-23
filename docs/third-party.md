# Third-party software and redistribution notes

NoLoader is an unofficial community build of NoRisk Launcher. The source checkout is under GPL-3.0; keep the upstream copyright and license notices, mark modified files as changed, and publish the corresponding source and build scripts with any binary release. The GPL does not grant rights to use another party's trademarks as an endorsement. The NoRisk name in this project identifies the upstream launcher being extended.

## Bundled Windows runtime files

| Component | Version/source | License and included notice |
| --- | --- | --- |
| FFmpeg shared libraries | [BtbN FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds), `n8.1.2` `win64-gpl-shared` archive, pinned by SHA-256 in `scripts/setup-native-deps.mjs` | GPL-3.0; `ffmpeg-LICENSE.txt` and `ffmpeg-NOTICE.txt` |
| OBS graphics hooks | [OBS Studio tag 32.1.1](https://github.com/obsproject/obs-studio/tree/32.1.1), delivered in the pinned native dependency archive | GPL-2.0-or-later; `graphics-hook-GPL-2.0.txt` and `graphics-hook-NOTICE.txt` |
| NoRisk capture engine | Built from this repository's Rust sources | Covered by the upstream launcher source license and corresponding source release |

The NoLoader release workflow packages the required runtime files and their notices beside the launcher executable. `scripts/pack-capture-runtime.mjs` uses the same manifest when building the standalone capture archive.

## Other shipped dependencies

The launcher frontend bundles packages pinned in `yarn.lock`; `THIRD_PARTY_ICONS.md` records the icon sets included in the generated icon bundle. The Windows release process must retain those notices and the Rust dependency metadata when packaging the executable. Do not distribute a release if a bundled component's source or license terms are unknown.

The installer itself is published with the launcher source repository and remains under the repository's GPL-3.0 terms. Its code-signing catalog is signed by a separate ECDSA P-256 publisher key; that key is not a software license and grants no branding rights.
