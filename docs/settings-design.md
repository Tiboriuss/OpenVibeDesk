# Settings-Konzept

Die Einstellungen orientieren sich an dem gemeinsamen Leitfaden „KI Chat Leitfaden“: eine kompakte Desktop-Oberfläche mit den Stärken von Raycast und VS Code. Zuerst zeigen wir den aktuellen Zustand und häufig genutzte Optionen; Details erscheinen bei Bedarf.

## Navigation und Darstellung

- Ein eigenständiges, skalierbares Einstellungsfenster enthält eine globale Suche, Kategoriennavigation mit Icons und einen Inhaltsbereich mit kompakten Einstellungszeilen. Bei schmalen Fenstern passt sich die Navigation an.
- Kategorien folgen den Aufgaben der Nutzer. Neue Bereiche wie Mail, Agent oder MCP kommen hinzu, sobald die jeweilige Funktion existiert, statt leere Platzhalter vorzugeben.
- Zusammengehörende Einstellungen stehen in aufklappbaren Gruppen. Deren Überschriften zeigen sinnvolle Zustandszusammenfassungen, ohne Geheimnisse offenzulegen. Mehrere Gruppen können offen sein; ihr Zustand bleibt erhalten. Suche öffnet passende Bereiche vorübergehend.
- Mail-Einstellungen werden pro Konto gruppiert: Name und E-Mail-Adresse identifizieren das Konto, darunter stehen die bearbeitbaren Angaben für IMAP-Empfang und SMTP-Versand. Bestehende Konten werden vorausgefüllt; Empfang und Versand lassen sich getrennt prüfen und speichern. Ungespeicherte Änderungen anderer Konten bleiben dabei erhalten.
- Beschriftungen und kurze Hilfetexte sind verständlich. Technische Details kommen nur bei Bedarf hinzu. Das Layout unterstützt Tastaturbedienung, sichtbaren Fokus und Screenreader.

## Suche und Erweiterbarkeit

- Die Suche findet Einstellungen über Kategorien hinweg, auch in geschlossenen Gruppen, und berücksichtigt Beschriftungen, Beschreibungen, IDs und Synonyme.
- Neue Einstellungen sollen mit ihren Metadaten in die bestehende Registry und Suche aufgenommen werden. Die Architektur soll spätere modulare Einstellungen für Provider, Mail und Integrationen ermöglichen, ohne bereits nicht vorhandene Integrationen vorzutäuschen.
- Unter **Module → Seitenleiste & Dock** lässt sich die tatsächliche Appnavigation mit Auf-/Ab-Pfeilen anordnen. Eine gespeicherte eigene Reihenfolge gilt sofort in allen Fenstern und nach Neustarts; neu hinzukommende Einträge werden dahinter ergänzt, Positionen deaktivierter Module bleiben erhalten. „Auf Standard zurücksetzen“ stellt die Vorgaben der Module wieder her. Die Kategoriennavigation des Einstellungsfensters ist davon unabhängig.
- Filter für geänderte oder erweiterte Werte, Deep Links und Import/Export sind mögliche spätere Ergänzungen.

## Speicherung und Sicherheit

- Einfache Optionen werden direkt übernommen und gespeichert; bei Fehlern wird der tatsächliche gespeicherte Zustand wiederhergestellt und der Fehler angezeigt. Zugangsdaten und zusammengehörende Verbindungseinstellungen werden ausdrücklich übernommen.
- Ungespeicherte Eingaben bleiben bei Navigation, Suche und Auf- und Zuklappen erhalten und dürfen beim Verlassen nicht unbemerkt verloren gehen. Zustandsänderungen und Fehler werden erkennbar angezeigt.
- Wo sinnvoll, lassen sich geänderte Einstellungen einzeln auf ihren Standardwert zurücksetzen. Geheimnisse bleiben im Zugangsdaten-Speicher des Betriebssystems und erscheinen nicht in Statusübersichten oder Suchdaten.
