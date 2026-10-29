# Releases and installers

[Documentation](README.md) · [Getting started](getting-started.md#install-or-update-the-app) · [Development](../CONTRIBUTING.md#development)

The [release workflow](../.github/workflows/release.yml) builds macOS and Windows installer downloads when a GitHub release is published. It is an explicitly requested exception to the project's preference for local checks. Routine pushes and pull requests do not start this workflow.

The initial release pipeline produces packages without trusted publisher signing. Mac packages are not notarized. Installing a newer version over the existing app is supported through the installer/application identity and stable local data path; an in-app automatic updater is not implemented.

## Download and update

Downloads are attached to the existing [GitHub Release](https://github.com/Tiboriuss/OpenVibeDesk/releases) after every platform build succeeds. A published release may therefore appear before its installer assets are ready. If a build fails, inspect its workflow run; the release is not a claim that all installers have already finished.

| Asset | Intended computer |
| --- | --- |
| `OpenVibeDesk-<version>-mac-arm64.dmg` | Apple Silicon Mac |
| `OpenVibeDesk-<version>-mac-x64.dmg` | Intel Mac |
| `OpenVibeDesk-<version>-win-x64.exe` | Windows x64 (Intel/AMD) |
| `SHA256SUMS.txt` | SHA-256 hashes for the installer downloads |
| `RELEASE.json` | Release version, source/build provenance, signing status and installation notes |

Finish current work and quit OVD before updating. On Mac, open the newer DMG and replace **OpenVibeDesk.app** in the same Applications folder. On Windows, run the newer EXE using the same Windows account and installation location. The per-user installer recognizes the existing application and updates its files; uninstalling first is unnecessary. See the [step-by-step installation guide](getting-started.md#install-or-update-the-app).

The application identity remains stable:

| Identity | Value and purpose |
| --- | --- |
| Application ID | `org.openworkspace.desktop` — installer identity |
| Product name | `OpenVibeDesk` — application/shortcut name |
| Internal package name | `ai-workspace` — retained for compatibility |
| User profile | `<appData>/ai-workspace` — local state outside installed application files |

App upgrades preserve the profile containing settings, drafts, chats, module configuration and module data. OS credential-store service names also remain unchanged. A different OS account has a separate profile. Do not delete profile files when replacing the application. Profile schema rollback/downgrading is not a supported recovery process; keep a backup of important data while the project is an early version.

Module updates are independent of app installer updates. Downloaded module packages remain under the existing profile, and changed third-party module code still needs its normal local approval.

## Unsigned package behavior

These packages do not have an Apple Developer ID signature/notarization or a Windows publisher certificate. macOS Gatekeeper and Windows SmartScreen may warn or block opening. Approve only the specific OVD download if you trust its source; do not disable system protections globally. Organization policies may disallow unsigned apps entirely.

Checksums help detect a mismatched or corrupted download. They are not a substitute for code signing or independent proof of publisher identity. Compare a computed SHA-256 hash with the corresponding entry in `SHA256SUMS.txt`:

```sh
# macOS: replace the example version and architecture with your download.
shasum -a 256 OpenVibeDesk-0.2.0-mac-arm64.dmg
```

```powershell
# Windows PowerShell.
Get-FileHash .\OpenVibeDesk-0.2.0-win-x64.exe -Algorithm SHA256
```

## Publish a release

Keep **Enable release immutability** disabled in the repository settings for this workflow. Installers are attached after the `published` event, and GitHub's immutable releases reject later asset uploads. The publisher checks this setting's effect and stops before uploading if the target release is immutable. Supporting immutable releases would require a different flow that builds and uploads to a draft before publishing it.

1. Finish and push the intended source commit, including the release workflow.
2. Create a GitHub release with a tag such as `v0.2.0` or `v0.2.0-beta.1`, pointing at that source commit. Use a prerelease for an early build where appropriate.
3. Add release notes describing the actual changes, current platform validation and unsigned status, then publish the release. Saving a draft alone does not start the build.
4. Follow the release workflow in GitHub Actions. Each native runner installs the pinned dependencies and builds its own target: Apple Silicon Mac, Intel Mac, or Windows x64.
5. After all builds succeed, the upload job verifies the expected assets and hashes, checks that the release/tag still identify the built source, and attaches the installers, `SHA256SUMS.txt` and `RELEASE.json` to that same release.
6. Download and practically check the installers on their intended operating systems. Record the result in the release notes; successful packaging alone does not establish complete platform or upgrade support.

The release version comes from its tag. Tags must use `vMAJOR.MINOR.PATCH`, optionally followed by a valid SemVer prerelease suffix. Numeric version components must fit the supported Windows version bounds (at most 65535). Build metadata (`+...`) is rejected. The version helper updates `package.json` only inside the CI checkout; it does not commit a version change to the branch.

Only the upload job has `contents: write`; platform builds use read access. The workflow uses GitHub's built-in token rather than a separate personal token or signing secret. It does not publish an additional release or enable in-app updates.

### Retry a failed run

Inspect the failed job and correct the cause before retrying. No installers are uploaded unless every platform build succeeds and the final validation passes. On a rerun, already attached assets with matching content are retained. A conflicting asset is not silently replaced; investigate the version/source mismatch and publish a new version when the release contents have changed.

Keep published version tags and assets stable. A newer source revision should have a new version rather than replacing an existing release's installer under the same filename.

### Manual build without publishing

The workflow also supports an explicit **Run workflow** (`workflow_dispatch`) invocation. Select the source ref and optionally provide a plain version such as `0.2.0-beta.1`; leaving it empty uses the checked-in package version. This produces workflow artifacts for validation and does not create a GitHub release or attach release assets.

The manual version uses the same validation rules as a release version, without the leading `v`. Use this path to inspect installers before publishing a release. Local packaging commands remain available in [CONTRIBUTING.md](../CONTRIBUTING.md#development).

## Upgrade validation

A release check should install one version with a synthetic profile, create recognisable settings/chat/draft/module data, quit the app, then install a newer version over it. Verify that the visible version changes, the app still opens, the data is retained, and OS credentials remain available. Also check the installer from a fresh account/profile and the relevant architecture.

Use isolated profiles and synthetic credentials; never validate upgrades by modifying a normal mailbox or personal data. Preserve ongoing-send safeguards when quitting. Windows installation and runtime checks require Windows; a cross-built EXE or a successful macOS package is not equivalent evidence. Current practical results should be recorded with each release rather than inferred from the workflow configuration.
