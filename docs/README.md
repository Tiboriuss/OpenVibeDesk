# Documentation

[Repository overview](../README.md)

OpenVibeDesk's documentation is maintained in English. The app currently uses primarily German interface labels; setup instructions include those exact labels where they help you find a control.

## Choose a starting point

- **Use OVD:** [Install and set up the app](getting-started.md), then connect your AI provider and mail account.
- **Add functionality:** [Install modules from repositories](module-repositories.md), including private company sources. The separate [OpenVibeDesk-Modules repository](https://github.com/Tiboriuss/OpenVibeDesk-Modules) publishes the downloadable catalog.
- **Build a company integration:** Follow the [module contract](../CONTRIBUTING.md#building-modules), adapt the [Notes example](../examples/notes-module/README.md), and [publish a module package](module-repositories.md#publish-a-module).
- **Connect an existing MCP server:** Use the [MCP guide](../modules/ovd-mcp/README.md); MCP server configuration is separate from installing an OVD module.
- **Work on the core:** Read [Contributing](../CONTRIBUTING.md), the [architecture](architecture.md) and the [maturation plan](maturation-plan.md).

## Use and develop OpenVibeDesk

| Guide | What it covers |
| --- | --- |
| [Getting started](getting-started.md) | Installer setup and manual updates, local startup, first-run configuration, data locations, and troubleshooting. |
| [Releases and installers](releases.md) | macOS/Windows packages without trusted publisher certificates, versioning, integrity checks, manual upgrades, and remaining validation. |
| [Contributing](../CONTRIBUTING.md) | Development, practical validation, and the contract for custom modules. |
| [Architecture](architecture.md) | Process boundaries, persistence, assistant integration, references, and current technical limits. |
| [Maturation plan](maturation-plan.md) | Prioritized work on existing modules, verified gaps, dependencies, current technical references and practical acceptance gates. |
| [Repository working rules](../AGENTS.md) | Product principles and requirements that apply to changes. |
| [ADR 0001: local desktop application](decisions/0001-local-desktop.md) | Why the app uses Electron and local storage without a dedicated backend server. |

## Product and visual design

| Guide | What it covers |
| --- | --- |
| [Mail design](mail-design.md) | Mail interaction requirements, assistant integration, and staged development goals. |
| [Settings design](settings-design.md) | Categories, search, progressive disclosure, persistence, and accessibility. |
| [Brand guide](brand.md) | Canonical logos, colors, typography, spacing, and asset reproduction. |
| [Application screenshots](../assets/screenshots/README.md) | Module views captured with fictional data, their source version and refresh guidance. |
| [Corporate identity PDF](../assets/brand/reference/OpenVibeDesk-CI.pdf) | Illustrated brand guidelines. |
| [Brand package notes](../assets/brand/reference/README.txt) | Asset provenance, supplied files, and reproduction instructions. |

Design guides include intended behavior that is not implemented yet. The [repository overview](../README.md#available-features) and [architecture](architecture.md) describe the current scope. Do not present a design target as a completed feature.

## Modules and examples

| Resource | What it demonstrates |
| --- | --- |
| [Module authoring contract](../CONTRIBUTING.md#building-modules) | Manifests, tools, UI contributions, approval, lifecycle, and resource references. |
| [Module repositories](module-repositories.md) | Public/private sources, catalog browsing, installation, updates, source conflicts, package publishing and Assistant control. |
| [Downloadable module catalog](https://github.com/Tiboriuss/OpenVibeDesk-Modules) | Separately published Notes and Skill Library modules, their source and package documentation. |
| [Notes module example](../examples/notes-module/README.md) | A standalone process module with its own HTML interface and settings. |
| [MCP module](../modules/ovd-mcp/README.md) | Server setup, tool approvals, credentials, and dynamic discovery. |
| [MCP server example](../examples/mcp-server/README.md) | A local server for exercising the MCP integration. |
| [Built-in module sources](../modules/) | The required assistant and optional Mail, Files, and MCP implementations. |

The app repository defines the host and module contract. A module repository publishes prebuilt packages for that host; it is not another OVD installation. Approved modules register their contributions with the same host, and the Assistant discovers their tools only when needed. See [module architecture](architecture.md#module-startup-and-context-budgets) for the implementation.

## Keeping documentation useful

Update the relevant guide when behavior changes. Keep commands, limits, source links, and current implementation claims aligned with the code. Use relative links between repository documents, update heading anchors after renaming sections, and link new guides from this index. Preserve code identifiers and actual interface labels rather than translating them into identifiers the app does not recognize.
