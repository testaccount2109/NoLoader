# Release process status

The public source fork publishes a prepared Windows launcher archive, a self-contained installer, and a signed Tauri updater artifact for tagged `noloader-v*` releases. The installer reads the signed catalog from this fork's `noloader-catalog` branch and installs only artifacts whose catalog signature, size, and SHA-256 verify. The launcher checks the static `latest.json` manifest attached to the latest release and verifies the updater artifact with this fork's Tauri key. The upstream NoRisk updater API is not queried. Existing installations must first be migrated once with NoLoader Setup because they still contain the old updater endpoint and key.

The latest published release is [NoLoader Launcher 1.0.11](https://github.com/testaccount2109/noriskclient-launcher/releases/tag/noloader-v1.0.11), published October 25, 2026. The release includes the prepared Windows x64 launcher ZIP, signed updater `.exe` and signature, `latest.json`, installer, and signed catalog. The extension host version embedded in that launcher is `0.6.30-noloader.4`; the product release version and extension host version serve different purposes.

Before publishing a prepared launcher, a release must identify:

- exact upstream commit and NoLoader commit;
- NoLoader API and launcher versions;
- target operating system and architecture;
- toolchain and reproducible build inputs;
- artifact SHA-256 and a verifiable release signature;
- source changes and GPL-3.0 notices;
- third-party runtime/native dependency licenses.

The installer verifies signed catalog metadata and the artifact size and SHA-256 before writing files. It requires explicit confirmation before replacing the selected launcher folder, retains complete backups, and can restore the recorded original NoRisk folder after later updates. The release workflow publishes the prepared Windows build, signed updater artifact and manifest, and installer, then refreshes the signed raw catalog weekly. The Tauri signing key and catalog signing key are separate GitHub Actions secrets; neither private key belongs in the repository.
