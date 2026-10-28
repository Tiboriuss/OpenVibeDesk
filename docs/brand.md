# OpenVibeDesk Brand Guide

[Documentation index](README.md) · [Repository README](../README.md)

The authoritative source is the user-supplied **CI package 1.0 dated October 28, 2026**. The [CI PDF](../assets/brand/reference/OpenVibeDesk-CI.pdf), [package README](../assets/brand/reference/README.txt), [logo preview](../assets/brand/reference/logo-preview.png), [design tokens](../assets/brand/source/tokens.json), and unchanged SVG files provide the shared foundation for the app, repository, and documentation. The PDF and package README are English reference editions; translating the documentation does not change the supplied logo masters, font, or tokens.

The package states its provenance explicitly: the symbol was reconstructed from a supplied PNG reference as Bézier geometry, and the wordmark was vectorized from its outlines and smoothed. This is a **close vector reconstruction**, not a recovery of the original vector artwork. Clear space, minimum sizes, Manrope, and the UI rules are recommendations newly defined in the package. Earlier logo reconstructions and colors inferred from a text description have been replaced.

## Product name and logo masters

Write the product name as **OpenVibeDesk**, one word with capital O, V, and D. **OVD** may be used after the first full mention. Keep technical storage and package identifiers separate from changes to the visible product name.

The supplied symbol contains asymmetric **O, V, and D** shapes, inward-positioned **pupils**, and a **detached triangle** as a separate accent. In the primary version, O, D, the pupils, and the upper V are Navy; the triangle below is Violet. Use these parts, their negative spaces, and their spacing together from the supplied master. Do not remove the pupils or triangle, or replace them with a newly drawn V.

The wordmark is also supplied entirely as paths. **Do not typeset the visible wordmark again**: the package cannot reliably identify its original typeface. Manrope is the complementary system font for interfaces and documents, not a replacement template for the wordmark.

## Authoritative assets and variants

The 20 supplied SVGs live directly in [`assets/brand/`](../assets/brand/). They are the authoritative files from the supplied CI package and remain unchanged. Compatibility files and generated platform icons are derived exports, not additional logo masters.

| Use | Primary file | Other supplied variants |
| --- | --- | --- |
| Stacked symbol and wordmark | [`ovd-logo-primary.svg`](../assets/brand/ovd-logo-primary.svg) | [`ovd-logo-inverse.svg`](../assets/brand/ovd-logo-inverse.svg), [`ovd-logo-mono-navy.svg`](../assets/brand/ovd-logo-mono-navy.svg), [`ovd-logo-mono-white.svg`](../assets/brand/ovd-logo-mono-white.svg) |
| Horizontal combination | [`ovd-horizontal-primary.svg`](../assets/brand/ovd-horizontal-primary.svg) | [`ovd-horizontal-inverse.svg`](../assets/brand/ovd-horizontal-inverse.svg), [`ovd-horizontal-mono-navy.svg`](../assets/brand/ovd-horizontal-mono-navy.svg), [`ovd-horizontal-mono-white.svg`](../assets/brand/ovd-horizontal-mono-white.svg) |
| Symbol only | [`ovd-symbol-primary.svg`](../assets/brand/ovd-symbol-primary.svg) | [`ovd-symbol-inverse.svg`](../assets/brand/ovd-symbol-inverse.svg), [`ovd-symbol-mono-navy.svg`](../assets/brand/ovd-symbol-mono-navy.svg), [`ovd-symbol-mono-white.svg`](../assets/brand/ovd-symbol-mono-white.svg) |
| Wordmark only | [`ovd-wordmark-primary.svg`](../assets/brand/ovd-wordmark-primary.svg) | [`ovd-wordmark-inverse.svg`](../assets/brand/ovd-wordmark-inverse.svg), [`ovd-wordmark-mono-navy.svg`](../assets/brand/ovd-wordmark-mono-navy.svg), [`ovd-wordmark-mono-white.svg`](../assets/brand/ovd-wordmark-mono-white.svg) |
| App tiles | [`ovd-app-violet.svg`](../assets/brand/ovd-app-violet.svg) | [`ovd-app-light.svg`](../assets/brand/ovd-app-light.svg), [`ovd-app-lavender.svg`](../assets/brand/ovd-app-lavender.svg), [`ovd-app-navy.svg`](../assets/brand/ovd-app-navy.svg) |

**Primary** combines Navy and Violet on light surfaces. **Inverse** combines White and the lighter accent `#B8AAFF` on Navy. **Mono Navy** uses Navy throughout; **Mono White** uses White throughout, for example on Navy or Violet. Choose the appropriate variant. Do not automatically invert colors or substitute colors for each application.

The SVGs contain filled paths without strokes, embedded raster images, or external font and network dependencies. Negative spaces and areas outside the artwork are transparent; the explicitly designed app tiles have their own backgrounds. The tightly fitted `viewBox` does not automatically include the required clear space.

[`readme-header.svg`](../assets/brand/readme-header.svg) is a derived repository header using the supplied horizontal combination. It is not an application screenshot. Give logo images the alternative text "OpenVibeDesk"; hide decorative repetitions from screen readers when the name is already readable beside them.

## Clear space and minimum sizes

**x is the diameter of one pupil in the scaled symbol.** Leave at least **1 x** around the symbol and the complete symbol-and-wordmark combination. Keep text, edges, and other artwork outside this area. For the standalone wordmark, clear space on each side is **8.52% of its width**.

| Variant | Digital minimum width | Recommended print minimum width |
| --- | --- | --- |
| Symbol | 48 px | 12 mm |
| Stacked logo | 180 px | 45 mm |
| Horizontal combination | 240 px | 60 mm |
| Wordmark only | 140 px | 35 mm |
| App tile | 64 px | Not specified |

Sizes refer to the visible artwork, excluding clear space. Print sizes are independent recommendations; check a physical proof. The symbol inside a 64-pixel app tile is approximately 49 pixels wide. Smaller favicons or operating system icons require a separately optimized and visually reviewed version; this does not override the general minimum sizes.

Do not compress, stretch, rotate, or crop the logo. Do not move individual parts, change letter spacing, or typeset a replacement wordmark. Do not add strokes, gradients, glows, shadows, dimensional materials, or 3D effects. On busy backgrounds, use a quiet supporting surface appropriate to the variant, with sufficient clear space.

## Color roles and contrast

Canonical color values and sizing rules are in [`source/tokens.json`](../assets/brand/source/tokens.json); generated CSS variables are in [`ovd-tokens.css`](../assets/brand/ovd-tokens.css). Do not maintain a second manual palette alongside them.

| Role | sRGB value | Use |
| --- | --- | --- |
| Navy | `#222844` | Primary logo, headings, and dark brand surfaces. |
| Violet | `#6850F5` | Separate logo accent and primary actions. |
| Lavender | `#E8E5FD` | Soft surfaces, selection, and references. |
| Paper | `#F9F9FE` | Quiet main background. |
| White | `#FFFFFF` | Cards, content surfaces, and inverse logo parts. |
| Ink | `#12182D` | Readable primary text. |
| Muted | `#606579` | Secondary text. |
| Inverse Accent | `#B8AAFF` | Lighter accent on Navy. |

Provide at least **4.5:1** contrast for normal UI text. The package's contrast ratios use relative sRGB luminance:

| Foreground / background | Contrast | Use |
| --- | --- | --- |
| Navy / White | 14.43:1 | Normal text. |
| White / Violet | 5.18:1 | Text on primary actions. |
| Inverse Accent / Navy | 7.03:1 | Light accent text on a dark surface. |
| Violet / Lavender | **4.21:1** | Insufficient for normal UI text. |

Use **Navy or Ink** for normal text on Lavender; do not use Violet there as a normal text color. Check states, transparency, focus, and new background combinations separately. Correct logo colors alone do not establish application accessibility. Distinguish success, failure, cancellation, and uncertain outcomes with text or icons as well. Derive print CMYK values with the printer's target profile; the bright screen color may reproduce differently.

## Typography and UI dimensions

The complementary system font is **Manrope**, using weights **400, 500, 600, 700, and 800**. Use the supplied [`Manrope-Variable.ttf`](../assets/brand/fonts/Manrope-Variable.ttf), its [SIL Open Font License 1.1](../assets/brand/fonts/OFL.txt), and its [source notice](../assets/brand/fonts/SOURCE.txt). Do not introduce external font requests or replace it with another Manrope distribution without review.

The CI document defines this type scale:

| Role | Font size / line height | Weight |
| --- | --- | --- |
| H1 | 40 / 48 px | 800 |
| H2 | 28 / 36 px | 700 |
| Body | 16 / 24 px | 400 |
| Label | 14 / 20 px | 600 |

Left-align text, maintain a clear hierarchy, and leave adequate spacing. Compact product views, larger text settings, and accessible icons also follow the existing [product principles](../AGENTS.md), [settings design](settings-design.md), and [mail design](mail-design.md). The example interface in the CI document is a visual recommendation, not an additional functional specification.

Spacing follows a **4-pixel grid**: 4, 8, 12, 16, 24, 32, 48, and 64 pixels. Recommended radii are **8 pixels for controls**, **16 pixels for cards**, and approximately **22% of the tile size for app tiles**. General workspace and reference labels remain independent of individual modules.

## Sources and reproduction

Editable geometry, wordmark paths, and build scripts live in [`assets/brand/source/`](../assets/brand/source/). The symbol has six Bézier paths on a 717 × 266-unit canvas; the wordmark has thirteen paths on an 866 × 122-unit canvas. Compose variants from those same sources rather than redrawing individual SVG variants.

The SVG build requires Python 3.9 or later and only the standard library. `build_assets.py`, the master SVGs, the font, and the JSON sources remain unchanged from the supplied package. Since this repository stores SVGs directly in `assets/brand/`, specify the output directory explicitly. From the repository root:

```sh
python3 assets/brand/source/build_assets.py --out assets/brand
```

The same JSON sources produce byte-identical SVGs. [`SHA256SUMS.txt`](../assets/brand/SHA256SUMS.txt) contains the supplied checksums for all 20 variants. Geometry and design tokens remain the single source for deliberate future changes; do not introduce another reconstruction from a preview or text description.

The optional English PDF generator has been adapted to this repository layout. Install the dependencies in [`source/requirements.txt`](../assets/brand/source/requirements.txt), then run:

```sh
python3 assets/brand/source/build_ci.py
```

The default output is [`reference/OpenVibeDesk-CI.pdf`](../assets/brand/reference/OpenVibeDesk-CI.pdf). Use `--out /path/to/guide.pdf` to select another destination. The generator reads the existing master SVGs and supplied local font; it does not rebuild or modify them. See the [package README](../assets/brand/reference/README.txt) for details. This documentation build is separate from the app build.

Published screenshots must show real interfaces with synthetic data and exclude personal mail, chats, and credentials. External references retained from the supplied package are [Manrope on Google Fonts](https://github.com/google/fonts/tree/main/ofl/manrope) and [WCAG 2.2 contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
