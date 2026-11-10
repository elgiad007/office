# Package and release Office

[Documentation index](README.md)

## Build release ZIPs

On Windows PowerShell, create a hosting ZIP with:

```powershell
./scripts/package.ps1
```

For a Windows ZIP, download an official PHP x64 NTS distribution, compare its hash with the official manifest, then:

```powershell
./scripts/package.ps1 -WindowsRuntimeArchive .runtime/php.zip -ExpectedSha256 <official-sha256>
```

The packaging script copies only release sources and an empty data directory. It never includes your live `data/`, `.runtime/` or test output. Release ZIPs and clean extracted build folders go into ignored `dist/`.

## Prepare a GitHub release

Set the release version in [`app/VERSION`](../app/VERSION). Office shows it beneath the heading in **Keyboard shortcuts** (`?`). Place an official PHP x64 NTS ZIP at `.runtime/php.zip`. To save its published checksum, create `.runtime/.env` with this line, replacing the placeholder with the 64-character SHA-256 for that ZIP:

```dotenv
OFFICE_PHP_SHA256=<published SHA-256>
```

Double-click **Build Office Release.bat** in the repository root. The builder reads the saved value and verifies the ZIP on every build. If the setting is missing, the builder prompts for the checksum. Update the saved value when you replace the PHP ZIP. Git and the release packager both exclude `.runtime/`.

You can also run the release builder from PowerShell:

```powershell
./scripts/release.ps1
```

Pass `-ExpectedSha256` to override the saved value. If you use `-WindowsRuntimeArchive` to select a PHP ZIP, also pass `-ExpectedSha256` for that archive. To bundle portable Apache in the Windows ZIP, also supply `-ApacheRuntimeArchive` and `-ApacheExpectedSha256`.

For a manual unsigned release of version `0.1.0`, upload `portable-office-v0.1.0-hosting.zip`, `portable-office-v0.1.0-windows.zip`, and `SHA256SUMS.txt` from `dist/release-v0.1.0/`. Use tag `v0.1.0` and select the commit that matches the packaged files. When you rebuild the same version, enter `y` at the overwrite prompt to replace the existing release after the new build succeeds. Press Enter to cancel and keep the existing release.

## Publish a signed release

For signed releases, configure the GitHub Actions `office-release` environment with an `OFFICE_RELEASE_PRIVATE_KEY` secret and an `OFFICE_RELEASE_PUBLIC_KEY` variable. Use a matching RSA PEM key pair of at least 3072 bits and keep the private key outside the repository. The public key ships in both packages. Keep it stable across releases so installed copies can verify updates.

Commit the new `app/VERSION` and push its matching tag (for example, `v0.1.1`). The release workflow tests and packages the tagged code, signs the manifest, and publishes the two ZIPs, `SHA256SUMS.txt`, and `office-update.json` to GitHub Releases. To build the same signed artifacts locally in PowerShell 7, pass `-ReleasePublicKeyFile` and `-SigningKeyFile` to `scripts/release.ps1`.

See [the implementation plan](implementation-plan.md) for staged work and acceptance criteria. No real-account or shared-host compatibility is implied by local tests.
