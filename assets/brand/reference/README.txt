OPENVIBEDESK - CORPORATE IDENTITY 1.0
Source package date: October 28, 2026
English reference edition for the OpenVibeDesk repository

CONTENTS AND REPOSITORY LAYOUT
reference/OpenVibeDesk-CI.pdf  CI guide: 9 pages, vector artwork and embedded fonts
reference/logo-preview.png   Unchanged logo-only preview from the supplied package
./                           20 master SVGs, CSS color variables and SVG checksums
source/                      Editable geometry, design tokens and build scripts
fonts/                       Manrope Variable (Google Fonts version) and SIL OFL 1.1

Paths above are relative to assets/brand/ in the repository. The source package
placed its SVGs in an assets/ subdirectory; this repository stores them directly
in assets/brand/. The documentation text and PDF generator are translated into
English. Master SVGs, JSON sources, the font and build_assets.py are unchanged.

QUICK START
Primary stacked logo: ovd-logo-primary.svg
Standalone symbol: ovd-symbol-primary.svg
Horizontal combination: ovd-horizontal-primary.svg
Violet app tile: ovd-app-violet.svg

SVGs are transparent except for assets explicitly designed as app tiles.
The wordmark consists entirely of paths. Displaying the SVGs requires neither a
font nor a network connection. SVG viewBoxes fit the artwork tightly; add the
clear space described in the guide when placing them. The standalone wordmark
requires clear space equal to 8.52% of its width on each side.

REBUILD THE MASTER SVGS
Python 3.9 or later is sufficient; no additional packages are needed.
Run from the repository root:

    python3 assets/brand/source/build_assets.py --out assets/brand

To write an independent output directory instead:

    python3 assets/brand/source/build_assets.py --out ./rebuilt

The build is deterministic: identical JSON sources produce byte-identical SVGs.
SHA-256 checksums are in assets/brand/SHA256SUMS.txt. The original PNG is no longer
required. The scripts do not download files from the internet.

EDIT THE MASTER
source/symbol.json      Six symbol Bézier paths, 717 x 266 units
source/wordmark.json    Thirteen wordmark paths, 866 x 122 units
source/tokens.json      Color roles, typography, spacing and minimum sizes
source/build_assets.py Variant composition, positions and scaling

Change the base geometry once, then regenerate the variants. All visible parts
are filled paths without strokes; negative spaces remain transparent. CSS
variables are in ovd-tokens.css. SVG color values are deliberately embedded so
the files work independently of the consuming application's CSS.

OPTIONAL: REBUILD THE ENGLISH PDF
The original package used Python 3.12. Create a fresh virtual environment and
install the pinned packages from the repository root:

    python3 -m venv .venv
    .venv/bin/python -m pip install -r assets/brand/source/requirements.txt
    .venv/bin/python assets/brand/source/build_ci.py

The default output is assets/brand/reference/OpenVibeDesk-CI.pdf. An alternative
output destination can be selected with --out /path/to/guide.pdf. The generator
resolves assets and fonts relative to its own location, so it works from any
working directory. It reads existing master SVGs without changing them. Rebuild
the SVGs first only if their editable sources were deliberately changed.

PDF content and layout are in source/build_ci.py. Font instances are generated
temporarily from the supplied variable TTF. Render and visually inspect every
page after changing the guide. This build uses local fonts and needs no online
font source. It is an optional documentation build, not an app build step.

PROVENANCE AND DESIGN DECISIONS
The sole visual source was the supplied PNG reference, 1536 x 1024 pixels.
Its large upper stacked logo was chosen as the master because smaller variants
in that image differ in their details.

The symbol was reconstructed from the visible outlines as smooth Bézier
geometry. The wordmark was vectorized from its contours and smoothed. Raster
noise, lighting and small color variations were not retained. This geometry is
a close reconstruction, not a recovered original vector asset. The exact
original wordmark typeface cannot be reliably identified from the image, so the
wordmark must not be typeset again as replacement text.

The master colors are deliberately standardized sRGB values derived from the
image. Navy and Violet make up the logo. The lighter inverse accent, clear
space, minimum sizes, Manrope system font and UI rules are recommendations
newly defined for this CI system. No earlier brand guideline was available.
Recommended print sizes are independent minimums, not pixel-to-print conversions.

FONTS AND REFERENCES
Manrope comes from the Google Fonts repository, ofl/manrope:
https://github.com/google/fonts/tree/main/ofl/manrope
The license associated with this specific font file is fonts/OFL.txt.
Do not substitute another Manrope distribution without checking it.

Contrast is calculated from relative sRGB luminance and rounded in the guide:
Navy on White: 14.43:1; White on Violet: 5.18:1;
#B8AAFF on Navy: 7.03:1; Violet on Lavender: 4.21:1.
Violet on Lavender is insufficient for normal UI text; use Navy or Ink instead.
https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html

Repository brand guide: ../../../docs/brand.md
Documentation index: ../../../docs/README.md
