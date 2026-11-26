# Releases and installers

[Documentation](README.md) · [Getting started](getting-started.md#install-or-update-the-app) · [Development](../CONTRIBUTING.md#development)

Use the release page to download an installer and the changelog to see what changed. GitHub marks the current alpha releases as pre-releases. [GitHub Releases](https://github.com/Tiboriuss/OpenVibeDesk/releases) · [Changelog](../CHANGELOG.md)

The [release workflow](../.github/workflows/release.yml) builds macOS and Windows installer downloads when a GitHub release is published. It is an explicitly requested exception to the project's preference for local checks. Routine pushes and pull requests do not start this workflow.

The initial release pipeline produces packages without trusted publisher certificates. Mac apps use an ad-hoc signature to seal their packaged code and resources, without an Apple Developer ID certificate or notarization. Windows installers are unsigned. Installing a newer version over the existing app is supported through the installer/application identity and stable local data path; OVD can check for installers and open their downloads from Settings.

## Check for updates in OVD

Open **Settings → Updates** to see the installed version, run **Check for updates now** or change the startup check and release channel. Installed macOS and Windows builds check at startup by default. Choose **Preview and stable** for current alpha and beta releases, or **Stable only** for full releases. Both preferences are saved locally. A manual check also works with startup checking turned off.

OVD reads the public release list from this repository and compares semantic versions. It offers an update once GitHub shows the matching installer, release manifest and checksums as uploaded. The update dialog shows the version and opens the installer download or full release notes in your browser. The dot on the OVD-Bar's Settings icon leads to **Updates**. **Later** closes the dialog for the current session. **Don’t remind me about this version again** also clears the dot and keeps that version quiet after restart. You can still find it with a manual check and download it from Settings.

The Assistant can use the same update check, inspect the available release and change the saved preferences. Installation remains a separate action using the OS installer. A development checkout or a platform without a matching release installer reports its running version and leaves update checks unavailable.

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

App upgrades preserve the profile containing settings, drafts, chats, module configuration, module data and the local credential vault/key. Local credential identities remain stable. Updating from releases through v0.1.7 requires one-time credential reentry/sign-in because legacy OS entries are neither read nor imported automatically; they are left untouched. See [credential storage](getting-started.md#credential-storage). A different OS account has a separate profile. Do not delete profile files when replacing the application. Profile schema rollback/downgrading is not a supported recovery process; keep a backup of important data while the project is an early version.

Module updates are independent of app installer updates. Downloaded module packages remain under the existing profile, and changed third-party module code still needs its normal local approval.

**Upgrading MCP to v0.1.14.** Existing server connections and credentials carry over. Earlier versions saved tool approvals by name. Connect the server in **Settings → MCP**, review the tool definitions you still want to use and save the selection. OVD then remembers those definitions. [Review MCP tool changes](../modules/ovd-mcp/README.md#reviewing-tool-changes)

## Signing and operating-system approval

The Mac build uses `mac.identity: "-"` so electron-builder signs the completed app ad hoc, including its nested code and native dependencies. This provides a verifiable package seal without a signing certificate. It does not establish a trusted publisher identity or provide Apple notarization. The Windows installer has no publisher signature. macOS Gatekeeper and Windows SmartScreen may therefore warn or block opening; organization policy can also prevent installation.

For an expected unidentified-developer or unnotarized-app warning on Mac, first attempt to open the app, then use **System Settings → Privacy & Security → Open Anyway** if you trust that specific download and the option is available. See [Apple's instructions](https://support.apple.com/en-us/102445). Do not disable system protections globally or strip quarantine attributes as an installation workaround.

An **app is damaged** alert must be investigated separately: a broken download or invalid code/resource seal can cause it. It is not the normal approval prompt for the absence of a Developer ID certificate. Compare the download checksum, try a fresh download, and report the release and architecture if the error remains.

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
2. Create a GitHub release with a tag such as `0.2.0` or `v0.2.0-beta.1`, pointing at that source commit. A leading `v` is optional. Use a prerelease for an early build where appropriate.
3. Add release notes describing the actual changes, current platform validation and signing/notarization status, then publish the release. Saving a draft alone does not start the build.
4. Follow the release workflow in GitHub Actions. Each native runner installs the pinned dependencies and builds its own target: Apple Silicon Mac, Intel Mac, or Windows x64.
5. After all builds succeed, the upload job verifies the expected assets and hashes, checks that the release/tag still identify the built source, and attaches the installers, `SHA256SUMS.txt` and `RELEASE.json` to that same release.
6. Download and practically check the installers on their intended operating systems. Record the result in the release notes; successful packaging alone does not establish complete platform or upgrade support.

The release version comes from its tag. Tags must use `MAJOR.MINOR.PATCH`, optionally prefixed with `v` and optionally followed by a valid SemVer prerelease suffix. Both `0.2.0` and `v0.2.0` produce package version `0.2.0`; the exact original tag is retained for source and release checks. Numeric version components must fit the supported Windows version bounds (at most 65535). Build metadata (`+...`) is rejected. The version helper updates `package.json` only inside the CI checkout; it does not commit a version change to the branch.

Consequently, the checkout's `package.json` version may differ from the newest published installer. Read the release tag and `RELEASE.json` for the packaged version and source commit; a local development build is not automatically stamped with the latest release number.

Only the upload job has `contents: write`; platform builds use read access. The workflow uses GitHub's built-in token rather than a separate personal token or signing secret. It attaches assets to the original published release. OVD reads that same release list for its update checks.

### Retry a failed run

Inspect the failed job and correct the cause before retrying. For an upload-only failure, rerun the failed jobs so the workflow reuses its existing verified build artifacts rather than rebuilding a published version. No installers are uploaded unless every platform build succeeds and the final validation passes. On a rerun, already attached assets with matching content are retained. A conflicting asset is not silently replaced; investigate the version/source mismatch and publish a new version when the release contents have changed.

Keep published version tags and assets stable. A newer source revision should have a new version rather than replacing an existing release's installer under the same filename.

### Manual build without publishing

The workflow also supports an explicit **Run workflow** (`workflow_dispatch`) invocation. Select the source ref and optionally provide a plain version such as `0.2.0-beta.1`; leaving it empty uses the checked-in package version. This produces workflow artifacts for validation and does not create a GitHub release or attach release assets. Manual runs also perform targeted upgrade checks: Windows installs the EXE and a newer temporary installer in its disposable runner; Mac launches packaged apps with an isolated profile and replaces the first app with a newer temporary bundle. Fixture builds are excluded from release assets.

The manual version input always uses the plain version without a `v` prefix. Use this path to inspect installers before publishing a release. Local packaging commands remain available in [CONTRIBUTING.md](../CONTRIBUTING.md#development).

## Package integrity checks

Every macOS build in the release workflow, both published-release and manual runs, verifies its packaged app before uploading artifacts. The [signature verifier](../scripts/verify-mac-signature.cjs) requires the expected application identity and a sealed resource manifest, runs `codesign --verify --deep --strict`, and checks the architecture and strict signature of every nested Mach-O binary, including native `.node` dependencies. A failed check stops that build and prevents release asset publication. This gate checks integrity; a successful result is not a claim of Developer ID trust, notarization or runtime compatibility.

On Mac, run the same check against a copied app from the finished DMG, adjusting the path and architecture:

```sh
node scripts/verify-mac-signature.cjs --app /path/to/OpenVibeDesk.app --arch arm64
```

For an Intel package, use `--arch x64`. Also download the finished release through a browser and open it through Finder on the intended Mac, ideally in a fresh test environment. Browser downloads carry macOS quarantine information; directly launching a locally built executable does not exercise the same Gatekeeper path. Keep the download's quarantine information intact and record whether the expected app-specific approval works. [Apple's distribution diagnostics](https://developer.apple.com/forums/thread/706442) explain this distinction. A standard Gatekeeper trust rejection is expected without Developer ID signing and notarization; a damaged seal is a packaging failure.

## Upgrade validation

On 26 November 2026 an Apple Silicon Mac ran the published v0.1.13 app and then a local v0.1.14 development package using the same isolated profile. After replacing the app, it reopened with the saved settings, chat, unsent draft, module data and readable test credentials. The development package passed the resource-seal and architecture checks. This check exercised an app replacement on Apple Silicon. The GitHub workflow records the build and integrity results for the distributed installers.

For the v0.1.9 source on **11 November 2026**, the corrected Mac fixture passed with an isolated Apple Silicon package: launch and save through the real UI, then replacement with a temporary higher-version 0.1.10 package from the same source. Settings, chat identity, draft content, module data and local credentials survived. The ARM resource seal and all 14 nested Mach-O binaries also passed verification. That temporary higher version was not released. This is local replacement evidence, not a browser Gatekeeper test, physical Intel/Windows validation or proof of every historical profile migration.

A release check should install one version with a synthetic profile, create recognisable settings/chat/draft/module data and a synthetic local credential, quit the app, then install a newer version over it. Verify that the visible version changes, the app still opens, the data is retained, and the local credential remains readable. Also check the installer from a fresh account/profile and the relevant architecture.

Use isolated profiles and synthetic credentials; never validate upgrades by modifying a normal mailbox or personal data. Preserve ongoing-send safeguards when quitting. The Mac check uses the actual packaged renderer and local credential service, creates a chat and unsent draft through the window API, saves a synthetic credential in the main process, then confirms their restoration after replacing the application bundle. It redirects application data before the app main entry executes and does not read a normal user profile. This does not import or validate legacy OS credentials. The Windows installer check retains profile file hashes, including the vault/key, and reads the synthetic credential afterwards; it does not launch the Windows app to validate all runtime flows. Windows installation and runtime checks require Windows; a cross-built EXE or a successful macOS package is not equivalent evidence. Current practical results should be recorded with each release rather than inferred from the workflow configuration.
