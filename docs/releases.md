# Release process status

The source checkout includes the NoLoader core, a plain Windows installer, and a locally built prepared launcher ZIP. No prepared artifact or signed release catalog has been published. The upstream Tauri updater has no configured endpoint, and no publisher key or public release repository is configured. The installer must not guess a URL or fall back to an unmodified launcher.

Before publishing a prepared launcher, a release must identify:

- exact upstream commit and NoLoader commit;
- NoLoader API and launcher versions;
- target operating system and architecture;
- toolchain and reproducible build inputs;
- artifact SHA-256 and a verifiable release signature;
- source changes and GPL-3.0 notices;
- third-party runtime/native dependency licenses.

The installer verifies signed catalog metadata and the artifact size and SHA-256 before writing files. It requires explicit confirmation before replacing the selected launcher folder, retains complete backups, and can restore the recorded original NoRisk folder after later updates. A public distribution is still blocked until the publisher configures a public artifact source, catalog and signing key; there is no public installable release yet.
