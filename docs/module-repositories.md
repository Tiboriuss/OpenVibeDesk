# Module repositories

[Documentation index](README.md) · [Getting started](getting-started.md) · [Module authoring contract](../CONTRIBUTING.md#building-modules) · [Public module catalog](https://github.com/Tiboriuss/OpenVibeDesk-Modules)

OVD can download, install and update prebuilt modules from public or private repositories. A company can distribute its own tools this way without changing the OVD application. Installed modules use the same contribution contract as local modules: they can add windows, navigation, settings, tools and chat references. Their authors provide both the interface and the Assistant functions.

A **source** is a configured GitHub repository or HTTPS catalog endpoint. Its **catalog** lists available modules and their current versions. A **package** contains one module's runnable files. Adding a source makes its catalog discoverable; it does not install every module in that repository.

| Integration | How it reaches OVD | How it is updated |
| --- | --- | --- |
| Bundled Assistant, Mail, Files and MCP | Included with the app; the Assistant is required and the other three are optional. | Install a newer OVD release. Repositories cannot replace these modules. |
| Downloaded module | Select a package from a configured source, install it, then approve and activate its code. | Refresh the catalog, select the advertised newer version, then approve the changed code. |
| Module under local development | Copy a complete module folder into the profile's `modules/` directory and restart OVD. | Update the local files and restart; changed code needs new approval. |
| MCP server | Configure a server and approve its tools in the bundled MCP module. | Managed separately from module packages; see the [MCP guide](../modules/ovd-mcp/README.md). |

Repository catalogs and unused tool schemas stay out of normal chat requests. The Assistant first finds a matching installed module, then loads only the tools it needs. Repository discovery is a separate, explicit operation.

## Configure a source

Open **Settings → Modules** (**Einstellungen → Module**). The **Module sources** (**Modulquellen**) group manages repositories; the **Module catalog** (**Modulkatalog**) group shows their packages.

1. Expand **Repository hinzufügen**, enter a name and a supported URL, and optionally enter an access token for a private source.
2. Select **Quelle hinzufügen**. Saving configuration does not download or execute modules.
3. In **Modulkatalog**, select **Katalog laden**. Use **Alle Quellen** to refresh all saved sources or select a single source. Each source shows its own status and last successful check.
4. Search by module title, ID or description and choose **Installieren** for the desired package.
5. Select **Freigeben & aktivieren**, review the module's declared access and approve its local file fingerprint. Installation alone never runs its code. Changed code needs new approval, even when the Assistant's **Ohne Abfragen** mode is enabled.
6. Open the module from its navigation entry, if it contributes one, or ask the Assistant to use its functions. The installed module also appears in the normal module list. Its navigation order can be changed under **Seitenleiste & Dock**.

Supported source addresses:

| Source | URL to enter | Expected catalog |
| --- | --- | --- |
| GitHub.com | `https://github.com/owner/repository` | `ovd-modules.json` at the root of the repository's default branch. |
| Direct HTTPS | `https://modules.example.com/company/ovd-modules.json` | JSON at that exact address; package paths resolve relative to its containing directory. |

Use the repository root for GitHub, not a `/tree/`, `/blob/`, release or ZIP URL. For direct HTTPS, enter the final `.json` URL without redirects. URLs cannot contain credentials, query parameters or fragments.

### Try the public catalog

Add **OpenVibeDesk Modules** with this URL and leave the token empty:

```text
https://github.com/Tiboriuss/OpenVibeDesk-Modules
```

The [catalog repository](https://github.com/Tiboriuss/OpenVibeDesk-Modules) provides installable examples and their editable source. [Notes](https://github.com/Tiboriuss/OpenVibeDesk-Modules/tree/main/modules/sample-notes) demonstrates a small module with a window, settings and shared read/write tools. [Skill Library](https://github.com/Tiboriuss/OpenVibeDesk-Modules/tree/main/modules/skill-library) demonstrates module-owned chat references and explicitly selected working instructions. Check each module's guide and the loaded catalog for its current version and host requirements. These modules are optional downloads, not bundled app features.

The source editor preserves unsaved inputs across category changes and settings search. Leaving a token field empty retains the saved token. Use the explicit remove control to clear it. Changing a protected source URL requires replacing or removing its token, preventing accidental reuse for a different destination.

## Private company repositories

For GitHub, the user must have access to the repository. Create a fine-grained personal access token restricted to the intended repository, with **Contents: Read-only**, and enter it in the source's **Zugriffstoken** field. Organization approval or SSO requirements may also apply. Public repositories need no token; GitHub API rate limits still apply. OVD reads the default branch through GitHub's [commits](https://docs.github.com/en/rest/commits/commits#list-commits), [Git trees](https://docs.github.com/en/rest/git/trees#get-a-tree) and [Git blobs](https://docs.github.com/en/rest/git/blobs#get-a-blob) APIs, which support this read permission.

Tokens are stored in the operating system credential store, separately from `module-repositories.json`. The renderer receives only a token-present flag after saving. Tokens are not returned through assistant tools or included in workspace/chat state. HTTPS catalogs use the optional token as a Bearer token. Requests and package files must remain on the configured origin; redirects are rejected. Do not put credentials in URLs. Normal system TLS validation applies.

GitHub Enterprise, GitLab and other Git hosts do not have dedicated API adapters yet. They can serve the same catalog and package layout through a direct HTTPS endpoint with Bearer authentication. SSH URLs, arbitrary Git clone URLs, branch selection, OAuth login, device authorization, installer scripts and package-manager execution are not implemented.

For a small company, the deployment path is: publish the prebuilt company module in a private catalog repository, give each intended user repository access, then add that source to their OVD profile. Access to a private catalog controls downloads; it is not a remote revocation mechanism for code already installed on a user's machine. There is no central deployment or organization administration console.

Removing a source removes its configuration and saved token; installed modules and their data remain. OVD does not silently transfer ownership of an installed module to a different source. Re-adding the exact original source URL recovers its provenance association; a different URL cannot take over existing packages. Edit the saved token for routine credential rotation.

## Publish a module

A module must already contain its runnable backend, UI assets and bundled dependencies. Follow the [module contract](../CONTRIBUTING.md#building-modules); OVD does not run `npm install`, build commands or hooks during installation. Use a unique stable module ID outside the reserved `ovd-` prefix. The ID is also the module's local data identity, so changing it creates a different module.

Keep editable source separate from published packages. For example:

```text
ovd-modules.json                  # Current listings and per-file hashes
modules/company-notes/           # Editable source (OVD does not install this path)
packages/company-notes/1.0.0/     # Runnable files listed in the catalog
```

Start with the [Notes example](../examples/notes-module/README.md) or the editable modules in the [public catalog repository](https://github.com/Tiboriuss/OpenVibeDesk-Modules). Rename the example's module ID and tool names together for your own module. Provide useful descriptions and keywords for discovery, bounded results with pagination, and the same validated functions for the interface and Assistant.

From an OVD checkout with its [development dependencies installed](getting-started.md#start-from-a-checkout), build the host tooling and prepare the example into a separate catalog directory that does not already contain this package version:

```sh
pnpm build
node scripts/prepare-module-repository.cjs examples/notes-module /path/to/your-module-catalog
```

The helper creates a catalog if none exists; the [empty catalog template](../examples/module-repository/ovd-modules.json) is also available. It validates the module without executing it, copies it to `packages/<module-id>/<version>/`, computes SHA-256 for each file, and adds or replaces its listing in `ovd-modules.json`. For your own module, replace `examples/notes-module` with its prebuilt folder. Review and commit source, catalog and package files in your catalog repository. The helper performs no Git operation.

Before publishing, install the staged package in a separate OVD profile and exercise both its interface and Assistant functions. Check persistence after restart, disabling, cancellation and any confirmations or recovery behavior the module claims. Preserve module-owned data when changing versions and describe any data migration or platform requirements in the module's guide. The helper validates package structure; it does not establish runtime correctness.

For an update, increment `module.json`'s version, prepare the new package, then publish both the new directory and updated catalog to the default branch in one commit. Never rewrite a previously published version: the helper refuses to replace an existing version directory. Existing version directories remain available; the catalog advertises one current version per module ID. A GitHub Release is not required for module distribution. OVD reads the committed catalog and package files, not release attachments.

For direct HTTPS hosting, publish the same catalog and package tree under one origin. Upload the new immutable package files before exposing the new catalog, so all its hashes point to available content.

### Catalog format

This example describes a hypothetical company module:

```json
{
  "version": 1,
  "title": "Company modules",
  "modules": [
    {
      "id": "company-notes",
      "title": "Company notes",
      "description": "Shared tools and UI for local company notes.",
      "version": "1.0.0",
      "apiVersion": 1,
      "package": {
        "path": "packages/company-notes/1.0.0",
        "files": [
          { "path": "module.json", "sha256": "<64 lowercase hexadecimal characters>" },
          { "path": "backend.cjs", "sha256": "<64 lowercase hexadecimal characters>" },
          { "path": "notes.html", "sha256": "<64 lowercase hexadecimal characters>" }
        ]
      }
    }
  ]
}
```

The hashes above are placeholders; use the helper to generate valid values. Every runtime/UI asset must be listed. Paths are portable relative paths, without traversal, hidden files, URL components, Windows reserved names or case-insensitive collisions. Git symlinks and submodules are rejected. The canonical schema is [shared/module-repositories.ts](../shared/module-repositories.ts).

Catalog format `version: 1`, module `apiVersion: 1` and the package's own version are separate values. The module ID, package version and API version must agree with `module.json`. Package versions have the form `major.minor.patch` with an optional prerelease suffix; build metadata (`+...`) is not supported. The current catalog has no dependency resolver, platform selector or minimum-host-version field. Authors must document their host and platform requirements: API version 1 alone does not prove that an older OVD build understands every newer manifest field.

## Installation and update behavior

GitHub catalog reads resolve one immutable repository tree; package files come from that exact tree even if the branch moves during a download. Direct HTTPS sources use the published per-file hashes to detect mismatched content. Checksums detect inconsistency, but do not establish publisher trust independently of the source.

To check for updates, return to **Modulkatalog** and select **Katalog laden**. A newer advertised package shows **Aktualisieren** with the old and new versions. Finish work and save edits in that module before updating. The catalog does not offer a downgrade or a reinstall of the same version, even if the publisher has changed its files.

Downloads are staged in a hidden directory and checked for size, hashes, manifest identity, API compatibility and required entry files before replacement. The host rejects busy modules, built-in IDs, foreign folders and locally modified installations. Updates stop the affected module and close its views, preserve `module-data/<id>`, revoke the previous approval, and discover the new version without restarting unrelated modules. Disabled modules remain disabled. A successfully installed update waits for approval and activation; it does not resume the old code automatically. If installation or configuration persistence fails, OVD attempts to restore the previous package. A recovery journal reconciles interrupted replacements at startup; a failed rollback asks the user to restart OVD.

Downloaded code lives in `<userData>/modules/<module-id>/`. Sources and installation receipts are in `<userData>/module-repositories.json`; approvals and disabled state are in `module-settings.json`. Module-owned data remains separate in `module-data/<module-id>/`. See [Local data](getting-started.md#local-data) for the profile location. Disabling a module or removing a source does not uninstall its files or delete its data. A module uninstall/data-deletion action is not currently provided.

Third-party backend processes run with the user's OS rights. Separate processes isolate crashes; they are not an OS sandbox. Declared permissions describe requested access and appear in approval, rather than enforcing OS-level access limits. Only install code from sources you trust.

Current bounds are 50 sources, 200 module listings per source, a 2 MiB catalog response, and 200 files / 16 MiB per package. Package manifests retain the normal 64 KiB bound. Catalog checks and updates are explicitly requested; there is no scheduled download or automatic installation. Catalogs are held in memory and must be refreshed after an app restart. The installed files, source settings and provenance receipts persist.

### Status and troubleshooting

| What you see | Meaning and next step |
| --- | --- |
| **Noch nicht geladen** | The source is saved but has no loaded catalog in this session. Select **Katalog laden**. |
| A source error with older entries still visible | A refresh failed. Older entries are retained for context, but installation from that source is blocked until it loads successfully. |
| **Verfügbar** | The module is not installed. Choose **Installieren**, then approve and activate it. |
| **Installiert** / approval required | Files are present but code is awaiting approval. Use **Freigeben & aktivieren**. |
| **Nicht kompatibel** | The catalog advertises an unsupported module API. Check the module's host requirements. Newer manifest fields can also be rejected during package validation. |
| **Konflikt mit installiertem Modul** | That ID is already local, owned by another source, installed in another folder or modified locally. OVD preserves it instead of overwriting it. Use a distinct ID for a development fork. |
| Access denied or HTTP 404 | Check the URL, default-branch catalog, token access/expiry and any organization approval. GitHub may also return an access error for a rate limit. |
| Checksum mismatch or missing package file | The published files do not match the catalog. Ask the publisher to publish a consistent new version; the existing installation remains intact. |
| Module is busy | Let its active operation finish and save open edits, then retry the update deliberately. |

Module updates and OVD application updates are separate. Use [release installers](releases.md) for a newer host and this catalog workflow for a newer optional package.

## Assistant control

The assistant discovers these functions lazily in `ovd-assistant`:

| Capability | Behavior |
| --- | --- |
| `modules.repositories_list` | Read bounded source metadata and loading status; never tokens. |
| `modules.repository_prepare` | Prepare a source's title and URL in Settings. The user enters credentials and saves. |
| `modules.repositories_refresh` | Fetch catalogs from saved sources, with per-source errors. |
| `modules.repository_catalog` | Search/page through module metadata and update status; content is untrusted. |
| `modules.repository_install` | Install or update the exact source/module/version under the configured action-confirmation policy. |
| `modules.repository_remove` | Remove a source under the configured action-confirmation policy. |
| `modules.set_enabled` | Activate/disable modules, retaining mandatory approval for new or changed third-party code. |

Examples: “Prepare the OpenVibeDesk Modules repository in Settings”, “Show available modules from our company repository”, “Check for module updates”, or “Install the offered version of Notes from that source”. The Assistant can prepare the source form but cannot supply saved secrets or save a new source itself. Installation targets the exact advertised source, module ID and version; a successful download does not imply activation. Separate code approval remains required, including under **Without confirmations**.
