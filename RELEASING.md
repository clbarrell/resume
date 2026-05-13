# Releasing

Releases are cut manually from a local machine. There is no CI release pipeline.

## Prerequisites

- A clean working tree on `main`, fully pushed to `origin`.
- `pnpm`, Xcode command line tools, and the GitHub CLI (`gh`) authenticated against `clbarrell/resume`.

## Steps

1. **Bump the version** in `package.json` (`version` field). Use semver; this is what electron-builder stamps into the artifact filenames.
2. **Commit the bump** and push to `main`:
   ```sh
   git commit -am "Release vX.Y.Z"
   git push origin main
   ```
3. **Build artifacts:**
   ```sh
   rm -rf release
   pnpm package
   ```
   Produces in `release/`:
   - `Resume-X.Y.Z-arm64.dmg` + `.zip` (Apple Silicon)
   - `Resume-X.Y.Z.dmg` + `.zip` (Intel)
   - `mac-arm64/Resume.app` and `mac/Resume.app` (unpacked, useful for local smoke testing)
4. **Smoke test** the arm64 DMG: mount it, drag to `/Applications`, launch, confirm sessions index and a resume command copies to the clipboard.
5. **Tag and push:**
   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
6. **Publish the GitHub release** with all four artifacts attached:
   ```sh
   gh release create vX.Y.Z \
     release/Resume-X.Y.Z-arm64.dmg \
     release/Resume-X.Y.Z.dmg \
     release/Resume-X.Y.Z-arm64-mac.zip \
     release/Resume-X.Y.Z-mac.zip \
     --title "vX.Y.Z" \
     --notes-file RELEASE_NOTES.md
   ```
   (Or `--notes "..."` inline. `gh` may create the release as a draft on first run — if so, `gh release edit vX.Y.Z --draft=false` to publish.)

## Signing & notarization

The build is **ad-hoc signed only** — no Developer ID certificate, no notarization. Downloaders will hit Gatekeeper on first launch:

- **macOS 15+ (Sequoia):** the right-click → Open bypass is gone. They have to open System Settings → Privacy & Security, scroll to the bottom, and click **Open Anyway**.
- **macOS 14 and earlier:** right-click `Resume.app` → **Open** → confirm.
- **"App is damaged" error** (most common with ZIPs): `xattr -dr com.apple.quarantine /Applications/Resume.app`.

Locally-built apps don't get the quarantine xattr, so they launch without any prompt — which means your dev experience is not representative of what users see. To test the real install flow, download the DMG from the GitHub release rather than running `pnpm package` and using the output directly.

To remove this friction, the path is: enroll in the Apple Developer Program ($99/yr), add a Developer ID Application certificate to the keychain, and extend `build.mac` in `package.json` with `identity` + a notarize config (and the matching `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` env vars at build time).

## Standard release notes template

```md
First-time install: download the DMG for your architecture, drag `Resume.app` to `/Applications`, then on first launch:

- **macOS 15+:** System Settings → Privacy & Security → **Open Anyway**.
- **macOS 14 and earlier:** right-click → **Open**.

If macOS says the app "is damaged":

\`\`\`
xattr -dr com.apple.quarantine /Applications/Resume.app
\`\`\`

## Downloads

- **Apple Silicon:** `Resume-X.Y.Z-arm64.dmg`
- **Intel:** `Resume-X.Y.Z.dmg`
```
