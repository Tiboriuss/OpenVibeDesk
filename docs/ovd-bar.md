# OVD-Bar

[Documentation](README.md) · [Settings design](settings-design.md) · [Architecture](architecture.md)

The **OVD-Bar** is OVD's compact floating launcher for the Assistant, modules and Settings. It replaces the former sidebar/Dock presentation. Module navigation and attention signals still use the existing generic Host contracts.

## Adjust the bar

Open the bar's **…** menu and choose **OVD-Bar anpassen …**, or use **Settings → OVD-Bar**. Right-click and Shift+F10 open the same menu.

| Control | Behavior |
| --- | --- |
| Orientation | Vertical or horizontal, independently of placement. |
| Size | Scales icons and their hit areas together, from 80% to 140%; 100% is the default. |
| Position | Left, right, top or bottom of the current display, or freely placed. Drag the grip to move it; dragging switches to free placement. |
| Opacity | Background opacity from 70% to 100%, default 96%. Icons and focus indicators remain opaque. |
| Keep in front | Uses the existing always-on-top preference. Enabled by default. |
| Collapse when idle | Optional; off by default. After 800ms without hover, focus or an open menu, the bar becomes a small reachable launcher. Hover or keyboard focus expands it; activating the launcher focuses its controls. |
| Entries and order | Move the actual available entries with Up/Down controls. Disabled modules retain their saved position for reactivation. |

The menu also offers common size, placement and background presets, and **OpenVibeDesk beenden** through the existing quit/save checks. Settings retain compact groups and searchable terms including “sidebar,” “dock,” “transparency” and “orientation.” Sliders commit at the end of pointer/keyboard adjustment or on blur; other controls save immediately. A failed settings save retains the edited value with a retry action. The reset action restores bar appearance/behavior defaults; entry order has its own reset.

The bar opens without taking focus from the current application. Its size is limited to the display work area. With many modules, only the navigation strip scrolls; the grip and menu stay reachable. Horizontal bars also accept vertical-wheel scrolling. Tab enters the toolbar; arrow keys follow its orientation, and Home/End reach the first entry/menu. The optional attention animation respects reduced motion. Where the renderer exposes reduced transparency or forced colors, those preferences override the decorative surface treatment.

## Assistant control

No new tools are added to the initial model context. The Assistant discovers the required functions in `ovd-assistant`, then uses the same validated settings and navigation services as the interface.

For example, `settings.update` can make the bar horizontal at the bottom:

```json
{
  "barOrientation": "horizontal",
  "barPosition": "bottom",
  "barSize": 40,
  "barOpacity": 90,
  "barAutoHide": true,
  "dockAlwaysOnTop": true
}
```

`barSize` is an integer from 32 to 56, with 40 representing the 100% button size. `barOpacity` is an integer percentage from 70 to 100. `settings.get` returns saved values; `settings.open` with `category: "dock"` opens OVD-Bar settings. `navigation.get` and `navigation.move` inspect/reorder available entries. Internal `dock` category/view IDs and `dockAlwaysOnTop` remain stable for existing integrations and profiles. Changing the bar does not activate modules or modify their code approvals.

For exact free placement, `bar.get` returns the current and expanded bounds, preferences and available display work areas. `bar.move` accepts integer `x`/`y` screen coordinates in device-independent pixels and an optional `displayId` from that result. It uses the same position persistence as dragging, switches to free placement, constrains the bar to the work area and returns the actual saved bounds. It does not take keyboard focus. Display coordinates may be negative; the Host validates the requested display instead of assuming the primary screen.

## Persistence and platform behavior

Preferences are part of the existing workspace settings and are published after a successful save. Older profiles receive validated defaults while retaining their foreground preference and custom entry order. Free placement is stored separately in `<userData>/ovd-bar-position.json` as normalized coordinates and a display ID. The Host constrains restored bounds to the current work area and responds to display addition/removal, scale and work-area changes. It preserves an unreadable position file rather than silently replacing it.

The transparent native window remains non-resizable at the operating-system frame; size changes use the shared settings and Host bounds calculation. Electron documents [limitations of transparent windows](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles), including native resizing and transparent hit regions. OVD keeps those regions small and does not claim desktop blur or click-through. Window placement/foreground behavior still depends on the OS/window manager; this change does not establish Windows/Linux visual certification.

The Host controller owns geometry, collapse and verified-window IPC. The renderer owns appearance and keyboard navigation, following the [W3C toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/). See [settings schema](../shared/ovd-bar.ts), [layout contract](../shared/ovd-bar-layout.ts), [native controller](../electron/ovd-bar.ts), [renderer](../src/OvdBar.tsx) and [settings UI](../src/OvdBarSettings.tsx).

## Verification scope

Verified on **11 November 2026**.

Isolated Electron profiles with synthetic modules and a local provider exercised legacy defaults, native layout, size/opacity, real Settings controls, failed-save retry, overlapping edits, keyboard navigation, attention acknowledgement and a 40-entry overflow. A 350px Settings viewport retained all controls. Position checks covered drag/settings races, simulated display changes, unreadable-file preservation and fresh-process restoration. Actual Assistant requests discovered and invoked settings changes and `bar.get`/`bar.move`; the saved free position survived restart.

Visible macOS windows separately verified inactive startup, actual focus/blur and hover expansion without focus takeover. Vertical and horizontal bars at maximum size protected the first click inside the former collapsed handle, while a deliberate subsequent click still opened the module and acknowledged its notice. The build and all 51 existing tests passed; no new permanent test suite was added. Physical multi-monitor operation, Windows/Linux interaction and a complete assistive-technology assessment remain outside this verification.
