# macOS Preview Test

Use only the download links on the published GitHub release. Choose Apple Silicon
when About This Mac shows an Apple M-series chip, or Intel when it shows an Intel
processor. These previews require macOS 12 or later; actual version coverage is
recorded separately from the configured minimum.

## Check the Download

Compare the downloaded DMG's SHA-256 with its release checksum file:

```sh
shasum -a 256 /path/to/RepoDeck.dmg
hdiutil verify /path/to/RepoDeck.dmg
```

Replace the example path with the actual downloaded file. A matching checksum
checks transfer integrity, not application safety or permission to launch.

## Install and Test

1. Open the DMG and copy RepoDeck to Applications. Record whether the image opens
   successfully before trying to launch the app.
2. Eject the image and launch the copy in Applications.
3. If macOS blocks it, record the exact message and stop. Do not remove quarantine
   attributes or disable Gatekeeper. These previews are not Developer ID signed
   or notarized, so a security block is separate from a damaged disk image.
4. If launch succeeds, add a disposable folder with two Git repositories and a
   non-Git folder. Check discovery, file previews, changes and agent files.
5. Add a single repository separately, change its display name, then quit and
   reopen RepoDeck to check that settings survive.

Use synthetic test repositories, not confidential projects. Do not discard real
changes, reset preferences, or remove an existing installation as a test step.

## Report Results

Include the release version, macOS version, chip, DMG filename, checksum result,
image verification result and the exact step/error. Note whether the failure is
opening the image, copying the app or launching it. Redact usernames, repository
paths and private contents from screenshots or logs. Successful image verification
alone does not prove first launch, upgrade or uninstall behavior.
