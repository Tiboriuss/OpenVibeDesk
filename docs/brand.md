# OpenVibeDesk · Markenleitfaden

Dieser Leitfaden hält das gemeinsame Erscheinungsbild für App, Repository und Dokumentation fest. Produktverhalten und Bedienung folgen weiterhin dem [Settings-Konzept](settings-design.md), dem [Mail-Leitfaden](mail-design.md) und der [Architektur](architecture.md).

## Name und Zeichen

Der Produktname lautet **OpenVibeDesk**, mit den Großbuchstaben O, V und D. Die Kurzform **OVD** ist nach der ersten vollständigen Nennung möglich. Technische Speicher- und Paketkennungen sind keine sichtbaren Produktnamen und werden für ein Rebranding nicht ohne Migration geändert.

Das Signet bildet eine Eule aus den Buchstaben **O V D**: **O ist das linke Auge, V allein ist der violette Schnabel, D ist das rechte Auge.** O und D stehen in der hellen Standardvariante in Navy. Zusätzliche Schnabeldreiecke, Pupillen, Flügel oder eine zweite Eulenkontur verändern das Zeichen und gehören nicht zur Marke. Das V bleibt als eigener Buchstabe erkennbar.

Die Darstellung ist flach und geometrisch. Keine Verläufe, Glows, plastischen Materialien, 3D-Effekte, Konturen oder Schatten zum Logo hinzufügen. Proportionen, Buchstabenabstände und Farben der freigegebenen SVG-Dateien beibehalten; das Zeichen nicht aus einer ähnlichen Schrift neu setzen.

## Verbindliche Dateien

| Datei | Verwendung |
| --- | --- |
| [`logo.svg`](../assets/brand/logo.svg) | Logo mit dem vollständigen Schriftzug auf hellem Grund. |
| [`logo-dark.svg`](../assets/brand/logo-dark.svg) | Vorgegebene Variante für dunkle Hintergründe. Nicht durch automatische Farbinvertierung erzeugen. |
| [`mark.svg`](../assets/brand/mark.svg) | Signet ohne Schriftzug für kompakte Flächen. |
| [`mark-inverse.svg`](../assets/brand/mark-inverse.svg) | Weißes Signet mit lavendelfarbenem V auf dunklen Flächen, etwa der Titelleiste. |
| [`mark-mono.svg`](../assets/brand/mark-mono.svg), [`mark-white.svg`](../assets/brand/mark-white.svg) | Einfarbige Varianten in Navy beziehungsweise Weiß. |
| [`app-icon.svg`](../assets/brand/app-icon.svg) | Ausgangsdatei für App- und Plattformicons. Plattformdateien daraus exportieren. |
| [`app-icon.png`](../assets/brand/app-icon.png), [`app-icon.icns`](../assets/brand/app-icon.icns), [`app-icon.ico`](../assets/brand/app-icon.ico) | Exporte für Laufzeit/Linux, macOS und Windows. Kleine Zielgrößen sind in den Plattformdateien enthalten. |
| [`readme-header.svg`](../assets/brand/readme-header.svg) | Kopfbereich der Repository-README. Kein Ersatz für einen Screenshot der App. |
| [`palette.json`](../assets/brand/palette.json) | Farbwerte und Schriftfamilie zur Weiterverwendung. |

SVG ist die Quelle. Benötigte PNG- oder Plattformvarianten aus diesen Dateien mit transparentem Hintergrund beziehungsweise dem vorgesehenen Iconhintergrund exportieren. Keine entfernten Bild- oder Schriftabhängigkeiten in die Assets einbauen. Logoabbildungen erhalten den Alternativtext „OpenVibeDesk“; rein dekorative Wiederholungen neben einem bereits lesbaren Namen bleiben für Screenreader ausgeblendet.

## Freiraum, Größen und Hintergründe

Die Zeichenhöhe des Signets ist **H**. Rund um Signet und Logo bleibt mindestens **H/4** frei. Dieser Abstand zählt vom sichtbaren Zeichen beziehungsweise Schriftzug bis zu anderen Inhalten oder zum Rand der Trägerfläche. Das Logo nicht beschneiden, strecken, drehen oder mit fremden Elementen verschmelzen.

| Variante | Mindestgröße für normale Verwendung |
| --- | --- |
| Signet | 24 CSS-Pixel hoch; im Druck 8 mm. |
| Logo mit Schriftzug | 140 CSS-Pixel breit; im Druck 35 mm. |
| Appicon | Für jede Zielgröße aus der Iconquelle exportieren; auch 16, 24 und 32 Pixel visuell prüfen. |

Für kleine Flächen das Signet statt eines unlesbar verkleinerten Schriftzugs verwenden. Auf Weiß oder Surface kommt die helle Standardvariante zum Einsatz; auf Navy oder anderen ruhigen dunklen Flächen die dunkle Variante. Fotos und unruhige Hintergründe erhalten eine ausreichend große ruhige Trägerfläche mit dem vorgesehenen Freiraum.

Wenn nur eine Druckfarbe möglich ist, werden alle Bestandteile gemeinsam in Navy, Schwarz oder Weiß ausgegeben. Diese monochrome Ausnahme behält die vollständige Geometrie; einzelne Buchstaben werden weder entfernt noch unterschiedlich eingefärbt. Der Regelfall bleibt das zweifarbige Original.

## Farbrollen

| Farbe | Wert | Aufgabe |
| --- | --- | --- |
| Navy | `#17243B` | O und D im Standardlogo, Haupttext, dunkle Markenflächen. |
| Beak Purple | `#48379F` | Ausschließlich das V innerhalb des farbigen Standard-Signets; auch für kräftige violette Textakzente geeignet. |
| Accent | `#6455C7` | Primäre Aktionen, aktive Zustände und Fokus im hellen Interface. |
| Lavender | `#EBE9FF` | Dezente Auswahl- und Referenzflächen. |
| Surface | `#F4F6FA` | Ruhiger App- und Abschnittshintergrund. |
| Weiß | `#FFFFFF` | Inhaltsflächen und Text auf ausreichend dunklen Aktionsflächen. |

Das Logo bekommt keine zusätzlichen Farben. Die Rollenfarben ersetzen keine verständlichen Zustände: Erfolg, Fehler, Abbruch und unklarer Ausgang bleiben mit Text oder Icon unterscheidbar. Die Farbe allein trägt keine notwendige Information.

Die folgenden Kontraste sind aus den angegebenen sRGB-Werten berechnet, auf zwei Stellen gerundet und gelten für vollständig deckende Flächen:

| Vordergrund / Hintergrund | Kontrast |
| --- | --- |
| Navy / Weiß | 15,53:1 |
| Navy / Surface | 14,36:1 |
| Navy / Lavender | 13,04:1 |
| Beak Purple / Weiß | 9,04:1 |
| Weiß / Accent | 5,73:1 |
| Accent / Surface | 5,29:1 |
| Accent / Lavender | 4,81:1 |

Für normalen Text mindestens **4,5:1**, für große Schrift und notwendige grafische Bedienelemente mindestens **3:1** vorsehen. Zustände mit Transparenz, Hover, deaktivierten Elementen oder neuen Hintergrundfarben gesondert prüfen. Accent auf Navy erreicht nur **2,71:1** und eignet sich dort nicht als notwendiger Text oder einziges sichtbares Bedienelement. Auf dunklen Flächen stattdessen ausreichend helle Text- und Fokusfarben verwenden. Ein korrektes Logo ersetzt keine Kontrastprüfung der eigentlichen Oberfläche.

## Schrift und Oberfläche

Der Schriftzug lautet immer **OpenVibeDesk**. Für Oberfläche und Dokumentation verwenden wir den vorhandenen lokalen Sans-Serif-Stack `Arial, Helvetica, sans-serif`. Normaler Text verwendet Gewicht 400, hervorgehobene Beschriftungen und Überschriften 700. Die Marke benötigt keine externen Schriftanfragen. Zusätzliche Schriften werden erst zusammen mit den zugehörigen lokalen Dateien und Lizenzen eingeführt.

Größen und Abstände unterstützen die kompakte Bedienung: klare Hierarchie, gut lesbarer Fließtext, kurze Beschriftungen und ein konsistentes Abstandsmaß von 4 Pixeln. Bestehende Einstellungen für größere Schrift bleiben wirksam. Icons folgen dem vorhandenen Symbolsatz und besitzen bei alleiniger Verwendung ein zugängliches Label.

Die Marke fügt der Oberfläche keine zusätzliche Dekoration oder Höhe hinzu. Titelleisten bleiben kompakt, Chataktionen liegen außerhalb der Nutzer-Sprechblase, Einstellungen gruppieren Details bei Bedarf in Akkordeons. Allgemeine Referenz- und Workspace-Texte bleiben unabhängig von einzelnen Modulen. Für zusammengehörige Funktionen werden gleiche Begriffe, Icons und Zustände verwendet.

## Sprache und Anwendung

Texte beschreiben konkrete Funktionen und Ergebnisse. Kurze aktive Sätze, nachvollziehbare Statusangaben und eindeutige Aktionsnamen passen zu OpenVibeDesk. Keine unbelegten Versprechen über vollständige Automatisierung, Datenschutz oder Plattformunterstützung verwenden. Screenshots zeigen echte Oberflächen mit synthetischen Daten und enthalten keine persönlichen Mail-, Chat- oder Zugangsdaten.

Bei einer neuen Oberfläche oder Veröffentlichung die passende Originaldatei, Freiraum, Lesbarkeit auf dem Zielhintergrund und Darstellung bei kleiner Größe prüfen. Neue Markenvarianten gehören zuerst in diesen Leitfaden und die gemeinsamen Assets; sie werden nicht pro Modul neu erfunden.
