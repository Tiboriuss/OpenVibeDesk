# OpenVibeDesk · Markenleitfaden

Maßgeblich ist das vom Nutzer gelieferte **CI-Paket 1.0 vom 28. Oktober 2026**. Die [CI-PDF](../assets/brand/reference/OpenVibeDesk-CI.pdf), [LIESMICH](../assets/brand/reference/LIESMICH.txt), [Design-Tokens](../assets/brand/source/tokens.json) und unveränderten SVG-Dateien bilden die gemeinsame Grundlage für App, Repository und Dokumentation.

Das Paket beschreibt seine Herkunft ausdrücklich: Die Bildmarke wurde aus einer bereitgestellten PNG-Vorlage als Bézier-Geometrie rekonstruiert, die Wortmarke konturbasiert vektorisiert und geglättet. Es handelt sich um eine **originalnahe Vektorrekonstruktion**, nicht um wiedergefundene ursprüngliche Vektordateien. Schutzräume, Mindestgrößen, Manrope und die UI-Regeln sind die im Paket neu definierten Empfehlungen. Frühere, aus einer Textbeschreibung abgeleitete Logorekonstruktionen und Farbwerte sind ersetzt.

## Name und Logo-Master

Der Produktname lautet **OpenVibeDesk**, als ein Wort mit den Großbuchstaben O, V und D. Die Kurzform **OVD** ist nach der ersten vollständigen Nennung möglich. Technische Speicher- und Paketkennungen bleiben von sichtbaren Namensänderungen getrennt.

Die gelieferte Bildmarke enthält die asymmetrischen Formen **O, V und D**, nach innen versetzte **Pupillen** und ein **freistehendes Dreieck** als eigenen Farbakzent. In der Primärvariante sind O, D, Pupillen und das obere V Navy; das darunterliegende Dreieck ist Violet. Diese Bestandteile, ihre Innenräume und Abstände werden gemeinsam aus dem gelieferten Master übernommen. Pupillen und Dreieck weder entfernen noch durch ein neu gezeichnetes V ersetzen.

Auch die Wortmarke liegt vollständig als Pfadgrafik vor. Der sichtbare Schriftzug wird **nicht neu als Text gesetzt**: Seine ursprüngliche Schrift lässt sich laut Paket nicht sicher bestimmen. Manrope ist die ergänzende Systemschrift für Oberfläche und Dokumente, keine Ersatzvorlage für die Wortmarke.

## Verbindliche Assets und Varianten

Die 20 gelieferten SVGs liegen direkt unter [`assets/brand/`](../assets/brand/). Sie sind maßgebliche Originaldateien des gelieferten CI-Pakets und bleiben unverändert. Kompatibilitätsdateien und erzeugte Plattformicons sind davon abgeleitete Exporte, keine zusätzlichen Logo-Master.

| Einsatz | Primärdatei | Weitere gelieferte Varianten |
| --- | --- | --- |
| Wort-Bild-Marke, übereinander | [`ovd-logo-primary.svg`](../assets/brand/ovd-logo-primary.svg) | `ovd-logo-inverse.svg`, `ovd-logo-mono-navy.svg`, `ovd-logo-mono-white.svg` |
| Horizontale Kombination | [`ovd-horizontal-primary.svg`](../assets/brand/ovd-horizontal-primary.svg) | `ovd-horizontal-inverse.svg`, `ovd-horizontal-mono-navy.svg`, `ovd-horizontal-mono-white.svg` |
| Bildmarke allein | [`ovd-symbol-primary.svg`](../assets/brand/ovd-symbol-primary.svg) | `ovd-symbol-inverse.svg`, `ovd-symbol-mono-navy.svg`, `ovd-symbol-mono-white.svg` |
| Wortmarke allein | [`ovd-wordmark-primary.svg`](../assets/brand/ovd-wordmark-primary.svg) | `ovd-wordmark-inverse.svg`, `ovd-wordmark-mono-navy.svg`, `ovd-wordmark-mono-white.svg` |
| App-Kacheln | [`ovd-app-violet.svg`](../assets/brand/ovd-app-violet.svg) | [`ovd-app-light.svg`](../assets/brand/ovd-app-light.svg), [`ovd-app-lavender.svg`](../assets/brand/ovd-app-lavender.svg), [`ovd-app-navy.svg`](../assets/brand/ovd-app-navy.svg) |

**Primary** kombiniert Navy und Violet auf hellen Flächen. **Inverse** kombiniert Weiß und den helleren Akzent `#B8AAFF` auf Navy. **Mono Navy** ist vollständig Navy; **Mono White** vollständig Weiß, etwa auf Navy oder Violet. Passende Varianten verwenden und Farben nicht automatisch invertieren oder pro Anwendung austauschen.

Die SVGs enthalten Füllpfade ohne Konturlinien, eingebettete Rasterbilder oder externe Schrift- und Netzwerkabhängigkeiten. Innenräume und die Flächen außerhalb des Zeichens sind transparent; die ausdrücklich gestalteten App-Kacheln haben ihren eigenen Hintergrund. Die knapp gesetzte `viewBox` enthält den notwendigen Schutzraum nicht automatisch.

[`readme-header.svg`](../assets/brand/readme-header.svg) ist ein abgeleiteter Repository-Kopfbereich mit der gelieferten horizontalen Kombination. Er ist kein Screenshot der Anwendung. Logoabbildungen erhalten den Alternativtext „OpenVibeDesk“; dekorative Wiederholungen neben einem bereits lesbaren Namen bleiben für Screenreader ausgeblendet.

## Schutzraum und Mindestgrößen

**x entspricht dem Durchmesser einer Pupille in der skalierten Bildmarke.** Rund um Bildmarke und die vollständige Wort-Bild-Kombination bleibt mindestens **1 x** frei. Keine Texte, Ränder oder anderen Zeichen in diesen Bereich setzen. Bei der alleinstehenden Wortmarke beträgt der Schutzraum je Seite **8,52 % ihrer Breite**.

| Variante | Digitale Mindestbreite | Empfohlene Mindestbreite im Druck |
| --- | --- | --- |
| Bildmarke | 48 px | 12 mm |
| Wort-Bild-Marke | 180 px | 45 mm |
| Horizontale Kombination | 240 px | 60 mm |
| Wortmarke allein | 140 px | 35 mm |
| App-Kachel | 64 px | Nicht festgelegt |

Die Maße beziehen sich auf die sichtbare Grafik ohne Schutzraum. Druckwerte sind eigenständige Empfehlungen; ein Probedruck entscheidet. Die Bildmarke innerhalb einer 64-Pixel-App-Kachel ist ungefähr 49 Pixel breit. Für kleinere Favicons oder Betriebssystemicons ist eine gesondert optimierte und visuell geprüfte Fassung nötig; die allgemeinen Mindestmaße werden dadurch nicht aufgehoben.

Das Logo nicht stauchen, strecken, drehen oder beschneiden. Keine Einzelteile verschieben, Buchstabenabstände ändern oder die Wortmarke neu setzen. Keine Konturlinien, Verläufe, Glows, Schatten, plastischen Materialien oder 3D-Effekte ergänzen. Auf unruhigen Hintergründen eine ruhige, zur Variante passende Trägerfläche mit ausreichendem Schutzraum verwenden.

## Farbrollen und Kontrast

Die kanonischen Farbwerte und Maßregeln stehen in [`source/tokens.json`](../assets/brand/source/tokens.json), die erzeugten CSS-Variablen in [`ovd-tokens.css`](../assets/brand/ovd-tokens.css). Keine zweite manuell gepflegte Palette daneben anlegen.

| Rolle | sRGB-Wert | Verwendung |
| --- | --- | --- |
| Navy | `#222844` | Primärlogo, Überschriften und dunkle Markenflächen. |
| Violet | `#6850F5` | Eigenständiger Logoakzent und primäre Aktionen. |
| Lavender | `#E8E5FD` | Sanfte Flächen, Auswahl und Referenzen. |
| Paper | `#F9F9FE` | Ruhiger Haupthintergrund. |
| White | `#FFFFFF` | Karten, Inhaltsflächen und inverse Logoanteile. |
| Ink | `#12182D` | Gut lesbarer Haupttext. |
| Muted | `#606579` | Sekundärer Text. |
| Inverse Accent | `#B8AAFF` | Heller Akzent auf Navy. |

Für normalen UI-Text mindestens **4,5:1** vorsehen. Die im Paket genannten Kontraste wurden anhand der relativen sRGB-Luminanz berechnet:

| Vordergrund / Hintergrund | Kontrast | Verwendung |
| --- | --- | --- |
| Navy / White | 14,43:1 | Normaler Text. |
| White / Violet | 5,18:1 | Text auf primären Aktionen. |
| Inverse Accent / Navy | 7,03:1 | Heller Akzenttext auf dunklem Grund. |
| Violet / Lavender | **4,21:1** | Für normalen UI-Text nicht ausreichend. |

Auf Lavender normalen Text in **Navy oder Ink** setzen; Violet dort nicht als normale Textfarbe verwenden. Zustände, Transparenz, Fokus und neue Hintergrundkombinationen gesondert prüfen. Eine korrekte Logofarbe allein belegt keine Barrierefreiheit der Anwendung. Erfolg, Fehler, Abbruch und unklarer Ausgang zusätzlich durch Text oder Icon unterscheiden. Für den Druck CMYK-Werte erst mit dem Zielprofil der Druckerei ableiten; die leuchtende Bildschirmfarbe kann abweichen.

## Typografie und UI-Maße

Die ergänzende Systemschrift ist **Manrope** in den Gewichten **400, 500, 600, 700 und 800**. Verwendet wird die konkret mitgelieferte Datei [`Manrope-Variable.ttf`](../assets/brand/fonts/Manrope-Variable.ttf) mit ihrer [SIL Open Font License 1.1](../assets/brand/fonts/OFL.txt) und dem [Herkunftshinweis](../assets/brand/fonts/SOURCE.txt). Keine externe Schriftanfrage und keinen ungeprüften Austausch gegen eine andere Manrope-Distribution einführen.

Die Größenskala aus dem CI-Dokument:

| Rolle | Schriftgrad / Zeilenhöhe | Gewicht |
| --- | --- | --- |
| H1 | 40 / 48 px | 800 |
| H2 | 28 / 36 px | 700 |
| Fließtext | 16 / 24 px | 400 |
| Label | 14 / 20 px | 600 |

Text linksbündig setzen, Hierarchie klar halten und ausreichend Abstand lassen. Kompakte Produktansichten, größere Texteinstellungen und zugängliche Icons folgen ergänzend den bestehenden [Produktgrundsätzen](../AGENTS.md), dem [Settings-Konzept](settings-design.md) und dem [Mail-Leitfaden](mail-design.md). Die Beispieloberfläche im CI-Dokument ist eine Gestaltungsempfehlung und keine zusätzliche Funktionsspezifikation.

Das Abstandsmaß folgt einem **4-Pixel-Raster** mit 4, 8, 12, 16, 24, 32, 48 und 64 Pixeln. Die empfohlenen Radien betragen **8 Pixel für Controls**, **16 Pixel für Karten** und ungefähr **22 % der Kachelgröße für App-Kacheln**. Allgemeine Workspace- und Referenztexte bleiben unabhängig von einzelnen Modulen.

## Quellen und Reproduktion

Editierbare Geometrie, Wortmarkenpfade und Buildskripte liegen unter [`assets/brand/source/`](../assets/brand/source/). Die Bildmarke besitzt sechs Bézier-Pfade auf einer Basis von 717 × 266 Einheiten, die Wortmarke dreizehn Pfade auf 866 × 122 Einheiten. Varianten werden aus denselben Quellen zusammengesetzt; keine SVG-Variante einzeln nachzeichnen.

Der SVG-Build benötigt Python ab 3.9 und ausschließlich die Standardbibliothek. Die Skripte sind unverändert aus dem CI-Paket übernommen. Weil die gelieferten SVGs im Repository direkt unter `assets/brand/` liegen, ist das Ausgabeverzeichnis ausdrücklich anzugeben. Aus der Repositorywurzel:

```sh
python3 assets/brand/source/build_assets.py --out assets/brand
```

Gleiche JSON-Quellen erzeugen byte-identische SVGs. [`SHA256SUMS.txt`](../assets/brand/SHA256SUMS.txt) enthält die gelieferten Prüfsummen für die 20 Varianten. Die Basisgeometrie und Design-Tokens bleiben die einzige Quelle für bewusste zukünftige Anpassungen; keine zusätzliche Rekonstruktion aus Vorschau oder Textbeschreibung einführen.

Der optionale PDF-Neubau und seine Abhängigkeiten sind in [LIESMICH](../assets/brand/reference/LIESMICH.txt) beschrieben. Das originale PDF-Skript setzt die Paketordnerstruktur voraus; es ist kein zusätzlicher App-Buildschritt. Screenshots für Veröffentlichungen zeigen echte Oberflächen mit synthetischen Daten und enthalten keine persönlichen Mail-, Chat- oder Zugangsdaten.
