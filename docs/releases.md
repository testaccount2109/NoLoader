# Release process status

The public source fork includes the NoLoader core, a plain Windows installer, and a locally built prepared launcher ZIP. No prepared artifact or signed release catalog has been published. The upstream Tauri updater has no configured endpoint. The P-256 catalog key is pinned in the source and its private half is stored as an Actions secret. The installer must not guess a URL or fall back to an unmodified launcher.

Before publishing a prepared launcher, a release must identify:

- exact upstream commit and NoLoader commit;
- NoLoader API and launcher versions;
- target operating system and architecture;
- toolchain and reproducible build inputs;
- artifact SHA-256 and a verifiable release signature;
- source changes and GPL-3.0 notices;
- third-party runtime/native dependency licenses.

The installer verifies signed catalog metadata and the artifact size and SHA-256 before writing files. It requires explicit confirmation before replacing the selected launcher folder, retains complete backups, and can restore the recorded original NoRisk folder after later updates. The release workflow publishes the prepared Windows build and installer and refreshes the signed raw catalog weekly. The first tagged release still needs to complete before there is a public installable binary.
