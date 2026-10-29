# Module repositories

[Documentation index](README.md) · [Module authoring contract](../CONTRIBUTING.md#building-modules)

OVD can download and update prebuilt third-party modules from multiple sources. Open **Einstellungen → Module → Modulquellen** to add a source. A source is either a GitHub repository URL, such as `https://github.com/Tiboriuss/OpenVibeDesk-Modules`, or a direct HTTPS URL to a catalog JSON file. GitHub sources use `ovd-modules.json` at the root of their default branch. Each source can contain multiple modules.

## Configure a source

1. Choose **Repository hinzufügen**, enter a name and URL, and optionally enter a private access token.
2. Save the source. Saving configuration does not download or execute modules.
3. Use **Katalog laden** to fetch the source's published module list. Errors, access failures, empty catalogs and the last successful check remain visible per source.
4. Choose **Installieren** for a module or **Aktualisieren** for a newer version.
5. Review the module's declared access and approve its local file fingerprint before activation. Installation alone never runs its code. Changed code needs new approval, even when the assistant's **Ohne Abfragen** mode is enabled.

Installed modules contribute their normal tools, views, navigation and settings through the existing module contract. The built-in assistant, Mail, Files and MCP modules cannot be replaced through a repository. Sources do not add tool catalogs or package contents to every AI request.

The source editor preserves unsaved inputs across category changes and settings search. Leaving a token field empty retains the saved token. Use the explicit remove control to clear it. Changing a protected source URL requires replacing or removing its token, preventing accidental reuse for a different destination.

## Private company repositories

For GitHub, use a fine-grained personal access token restricted to the intended repository, with **Contents: Read-only**. Organization approval or SSO requirements may also apply. Public repositories need no token; GitHub API rate limits still apply. OVD uses the [Git trees](https://docs.github.com/en/rest/git/trees) and [Git blobs](https://docs.github.com/en/rest/git/blobs) APIs, both of which support fine-grained read access.

Tokens are stored in the operating system credential store, separately from `module-repositories.json`. The renderer receives only a token-present flag after saving. Tokens are not returned through assistant tools or included in workspace/chat state. HTTPS catalogs use the optional token as a Bearer token. Requests and package files must remain on the configured origin; redirects are rejected. Do not put credentials in URLs. Normal system TLS validation applies.

GitHub Enterprise, GitLab and other Git hosts do not have dedicated API adapters yet. They can serve the same catalog and package layout through a direct HTTPS endpoint with Bearer authentication. SSH URLs, arbitrary Git clone URLs, branch selection, OAuth login, device authorization, installer scripts and package-manager execution are not implemented.

Removing a source removes its configuration and credential reference; installed modules and their data remain. OVD does not silently transfer ownership of an installed module to a different source. Re-adding the exact original source URL recovers its provenance association; a different URL cannot take over existing packages. Edit the saved token for routine credential rotation.

## Publish a module

A module must already contain its runnable backend and bundled dependencies. Follow the [module contract](../CONTRIBUTING.md#building-modules); OVD does not run `npm install`, build commands or hooks during installation.

Start an empty catalog repository with the [catalog template](../examples/module-repository/ovd-modules.json), then prepare a package using the helper from the OVD checkout:

```sh
pnpm build
node scripts/prepare-module-repository.cjs examples/notes-module /path/to/OpenVibeDesk-Modules
```

The helper validates the module without executing it, copies it to `packages/<module-id>/<version>/`, computes SHA-256 for each file, and adds or replaces its listing in `ovd-modules.json`. Review and commit both the catalog and package files to your source repository. The helper performs no Git operation. The [Notes example](../examples/notes-module/README.md) is a starting point for a company module.

For an update, increment `module.json`'s version, prepare the new package, then publish both the new directory and updated catalog in one commit. Never rewrite a previously published version. Existing version directories remain available; the catalog advertises one current version per module ID.

```text
ovd-modules.json
packages/
  company-notes/
    1.0.0/
      module.json
      backend.cjs
      notes.html
```

Catalog format:

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

## Installation and update behavior

GitHub catalog reads resolve one immutable repository tree; package files come from that exact tree even if the branch moves during a download. Direct HTTPS sources use the published per-file hashes to detect mismatched content. Checksums detect inconsistency, but do not establish publisher trust independently of the source.

Downloads are staged in a hidden directory and checked for size, hashes, manifest identity, API compatibility and required entry files before replacement. The host rejects busy modules, built-in IDs, foreign folders and locally modified installations. Updates stop the affected module and close its views, preserve `module-data/<id>`, revoke the previous approval, and discover the new version without restarting unrelated modules. Disabled modules remain disabled. If installation or configuration persistence fails, the previous package is restored. A small recovery journal reconciles interrupted replacements at startup.

Third-party backend processes run with the user's OS rights. Separate processes isolate crashes; they are not an OS sandbox. Declared permissions describe requested access and appear in approval, rather than enforcing OS-level access limits. Only install code from sources you trust.

Current bounds are 50 sources, 200 module listings per source, a 2 MiB catalog response, and 200 files / 16 MiB per package. Package manifests retain the normal 64 KiB bound. Catalog checks and updates are explicitly requested; there is no scheduled download or automatic installation. Catalogs are held in memory and must be refreshed after an app restart. The installed files, source settings and provenance receipts persist.

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

Examples: “Show available modules from our company repository”, “Check for module updates”, or “Install version 1.1.0 of company-notes from that source”. A successful installation does not imply activation; tools report the actual result.
