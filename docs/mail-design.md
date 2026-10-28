# Leitfaden für eine moderne Mail-App

> Produktleitfaden aus dem vom Nutzer bereitgestellten Text. Er beschreibt das Ziel und die Reihenfolge des Ausbaus; welche Funktionen bereits vorhanden sind, steht in `README.md` und `docs/architecture.md`.

Die Mail-App soll sich im Alltag wie ein vollständiges E-Mail-Programm anfühlen: **Konten verbinden, Nachrichten lesen und organisieren, E-Mails schreiben und Entwürfe zuverlässig wiederfinden**. Die Oberfläche bleibt dabei übersichtlich und fügt sich in OpenVibeDesk ein.

Als technische Grundlage dienen zunächst **IMAP zum Lesen und Synchronisieren** sowie **SMTP zum Versenden**. Die Anmeldung erfolgt mit Benutzername und Passwort beziehungsweise App-Passwort; OAuth ist für eine spätere Ausbaustufe vorgesehen.

## 1. Grundprinzip der Oberfläche

Die Mail-App verwendet eine klassische, bewährte Aufteilung:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Mail                                         Suche          ⚙  ⋯       │
├──────────────┬────────────────────────┬─────────────────────────────────┤
│ Konten       │ Nachrichten            │ Geöffnete Nachricht             │
│              │                        │                                 │
│ + Neue Mail  │ Mara Schneider         │ Launch-Checkliste              │
│              │ Launch-Checkliste      │ Von: Mara                       │
│ Posteingang  │ Heute · 09:18          │ An: mich                        │
│ Entwürfe     │                        │                                 │
│ Gesendet     │ Team                   │ Hallo, kannst du …              │
│ Archiv       │ Projektbesprechung     │                                 │
│ Papierkorb   │ Gestern                │                                 │
│ Spam         │                        │ [Antworten] [Allen] [Weiterleiten]│
│              │                        │                                 │
│ Eigene Ordner│                        │ Anhänge                         │
└──────────────┴────────────────────────┴─────────────────────────────────┘
```

- **Links:** Konten, Ordner und der Button für eine neue Nachricht.
- **Mitte:** Nachrichtenliste mit Absender, Betreff, Vorschau, Datum und Status.
- **Rechts:** Inhalt der ausgewählten Nachricht mit den wichtigsten Aktionen.
- **Bei schmalen Fenstern:** Bereiche werden angepasst oder nacheinander angezeigt, damit die App bedienbar bleibt.

Die wichtigsten Aktionen sind direkt erreichbar. Seltenere Funktionen stehen in einem Menü hinter `⋯`. Icons erhalten Tooltips und zugängliche Beschriftungen.

## 2. Konten einrichten

Die App sollte mehrere IMAP-/SMTP-Konten unterstützen. Für den Einstieg reicht ein klarer Einrichtungsdialog:

In den Einstellungen hat jedes eingerichtete Konto einen eigenen aufklappbaren Bereich. Er zeigt Name, E-Mail-Adresse und den Einrichtungsstatus von Empfang und Versand. Allgemeine Angaben, IMAP und SMTP sind dort vorausgefüllt und bearbeitbar. Konten müssen zum Ändern ihrer Serverdaten nicht entfernt und neu angelegt werden. Die Konto-ID und die Zuordnung bestehender Entwürfe und SMTP-Einstellungen bleiben erhalten. Leere Passwortfelder bei unveränderter Verbindung behalten die gespeicherten Zugangsdaten; ein Wechsel von Server oder Anmeldung erfordert die im Formular ausdrücklich angeforderten Zugangsdaten.

### Persönliche Angaben

- Anzeigename, etwa „Tibor Müller“
- E-Mail-Adresse
- Optional eine abweichende Antwortadresse

### Eingangsserver: IMAP

- Serveradresse und Port
- Verschlüsselung: **TLS direkt** oder **STARTTLS**
- Benutzername
- Passwort oder App-Passwort

### Ausgangsserver: SMTP

- Serveradresse und Port
- Verschlüsselung: **TLS direkt** oder **STARTTLS**
- Benutzername und Passwort
- Option: dieselben Zugangsdaten wie für IMAP verwenden

IMAP und SMTP werden **getrennt geprüft**. So lässt sich beispielsweise erkennen, dass der Empfang funktioniert, der Versand aber noch falsch konfiguriert ist.

Ein möglicher Ablauf:

1. Name und E-Mail-Adresse eingeben.
2. Serverdaten automatisch vorschlagen, soweit zuverlässig verfügbar.
3. Fehlende oder abweichende Angaben manuell ergänzen.
4. IMAP und SMTP prüfen.
5. Konto speichern und Ordner synchronisieren.

Fehler sollten verständlich formuliert sein: „Anmeldung fehlgeschlagen“, „Server nicht erreichbar“ oder „Zertifikat ungültig“ helfen mehr als eine rohe Protokollmeldung. Technische Details können aufklappbar sein.

### Verschlüsselung und typische Ports

| Dienst | Übliche Einstellung | Typischer Port |
|---|---|---:|
| IMAP | TLS direkt | 993 |
| IMAP | STARTTLS | 143 |
| SMTP-Versand | TLS direkt | 465 |
| SMTP-Versand | STARTTLS | 587 |

Die Ports sind **Vorschläge**, keine festen Vorgaben; sie müssen änderbar bleiben. Bei TLS direkt beginnt die verschlüsselte Verbindung sofort. Bei STARTTLS wird die Verbindung zunächst aufgebaut und anschließend auf TLS umgestellt. In beiden Fällen muss die Verschlüsselung erfolgreich stehen, **bevor Zugangsdaten übertragen werden**. Zertifikate und Servernamen werden geprüft; ein fehlgeschlagenes STARTTLS darf nicht unbemerkt zu einer unverschlüsselten Verbindung führen. [RFC 8314](https://www.rfc-editor.org/rfc/rfc8314.html)

### Grenze ohne OAuth

Diese erste Version kann Konten nutzen, deren Anbieter eine Passwortanmeldung beziehungsweise ein App-Passwort für IMAP und SMTP erlaubt. Nicht jedes Konto wird damit funktionieren: Microsoft nennt für Outlook.com OAuth2 als Authentifizierungsmethode; Google beschreibt App-Passwörter als mögliche Alternative unter bestimmten Voraussetzungen. [Microsoft: Outlook.com-Einstellungen](https://support.microsoft.com/en-gb/outlook/pop-imap-and-smtp-settings-for-outlook-com), [Google: App-Passwörter](https://support.google.com/mail/answer/185833?hl=en)

Die Einrichtung sollte das klar sagen, statt ein unterstütztes Konto zu versprechen, das sich ohne OAuth nicht verbinden lässt.

## 3. Nachrichten lesen

### Nachrichtenliste

Jede Zeile zeigt möglichst kompakt:

- Absender oder Anzeigename
- Betreff
- Kurzen Textauszug
- Datum beziehungsweise Uhrzeit
- Ungelesen-Status
- Anhangsymbol, falls Anhänge vorhanden sind
- Optional eine Markierung wie Stern oder Flagge

Die Liste soll auch mit vielen Nachrichten flüssig bleiben. Ältere Nachrichten werden bei Bedarf nachgeladen.

### Nachrichtenansicht

Eine geöffnete Mail zeigt:

- Betreff
- Absender
- Empfänger und gegebenenfalls CC
- Datum und Uhrzeit
- Nachrichtentext
- Anhänge
- Aktionen zum Antworten, Weiterleiten, Archivieren und Löschen

Weitere Header und technische Details können über **„Details anzeigen“** aufgeklappt werden.

### Darstellung von HTML-Mails

Viele alltägliche Nachrichten enthalten HTML. Die App sollte deshalb Text- und HTML-Mails unterstützen, HTML aber als fremden Inhalt behandeln:

- Keine Skripte oder aktiven Inhalte ausführen.
- Externe Bilder zunächst blockieren und bei Bedarf laden lassen.
- Links erst durch eine bewusste Aktion öffnen.
- Inline-Bilder und normale Anhänge unterscheiden.
- Wenn möglich, eine Textansicht als Alternative anbieten.

HTML-Mail kann unter anderem ausführbare Inhalte und externe Ressourcen enthalten; die Anzeige braucht daher eine geeignete Isolation und Bereinigung. [RFC 8621, Abschnitt „HTML Email Display“](https://www.rfc-editor.org/rfc/rfc8621.html#section-9.2)

## 4. Schreiben und Antworten

Der Editor öffnet sich als eigenes Fenster oder als klar abgegrenzter Bereich. Für OpenVibeDesk passt ein **eigenes Entwurfsfenster**, das auch neben Mail und Chat verwendet werden kann.

### Felder und Funktionen

| Funktion | Erwartetes Verhalten |
|---|---|
| **Von** | Sendekonto beziehungsweise Absender auswählen |
| **An** | Einen oder mehrere direkte Empfänger eingeben |
| **CC** | Weitere sichtbare Empfänger hinzufügen |
| **BCC** | Verdeckte Empfänger hinzufügen |
| **Betreff** | Betreff eingeben und bearbeiten |
| **Nachricht** | Text schreiben und bearbeiten |
| **Anhänge** | Dateien hinzufügen, anzeigen und entfernen |
| **Signatur** | Optional eine kontobezogene Signatur einfügen |
| **Senden** | Nachricht ausdrücklich durch den Nutzer versenden |
| **Entwurf** | Änderungen automatisch lokal sichern |

CC und BCC können standardmäßig eingeklappt und bei Bedarf über einen gut sichtbaren Button eingeblendet werden.

### Empfänger

- Mehrere Adressen als einzelne Einträge darstellen.
- Adressen vor dem Versand prüfen, ohne unnötig restriktive eigene Regeln zu erfinden.
- Doppelte Empfänger nach Möglichkeit vermeiden.
- Bei mehreren Konten den passenden Absender gut sichtbar machen.
- Bei **Antworten** die `Reply-To`-Adresse beachten, wenn vorhanden.
- Bei **Allen antworten** die beteiligten sichtbaren Empfänger übernehmen und eigene Adressen sinnvoll herausfiltern.

**BCC muss besonders sorgfältig behandelt werden:** BCC-Adressen gehören zu den tatsächlichen SMTP-Empfängern, dürfen aber nicht versehentlich in für andere Empfänger sichtbaren Nachrichtenheadern auftauchen. [RFC 5322: Empfängerfelder](https://www.rfc-editor.org/rfc/rfc5322.html#section-3.6.3)

### Antworten und Weiterleiten

- **Antworten:** Antwort an den passenden Absender beziehungsweise `Reply-To`.
- **Allen antworten:** Antwort an den passenden Personenkreis, mit bearbeitbaren Empfängern.
- **Weiterleiten:** Inhalt in einer neuen Mail weitergeben; Anhänge können übernommen oder entfernt werden.
- Den ursprünglichen Inhalt beim Antworten erkennbar zitieren.
- Gesprächsbezüge über `Message-ID`, `In-Reply-To` und `References` erhalten, damit Mailprogramme Antworten zuordnen können. [RFC 5322: Nachrichtenidentifikation](https://www.rfc-editor.org/rfc/rfc5322.html#section-3.6.4)

### Formatierung

Für die erste Version ist ein **zuverlässiger Texteditor** wichtiger als ein komplexer Office-Editor. Eine einfache Formatierungsleiste kann anschließend folgen:

- Fett, kursiv, unterstrichen
- Absätze und Listen
- Links
- Zitate
- Entfernen von Formatierung

Wenn HTML versendet wird, sollte nach Möglichkeit auch eine passende Textversion erzeugt werden.

## 5. Entwürfe und Wiederherstellung

Entwürfe sind eine Kernfunktion. Ein geschlossener Editor oder ein Absturz darf nicht dazu führen, dass längere Texte verloren gehen.

Der Entwurf speichert:

- Sendekonto
- An, CC und BCC
- Betreff und Inhalt
- Anhänge und deren Status
- Bezug zur ursprünglichen Mail
- Zeitpunkt der letzten Speicherung

**Empfehlung für den Einstieg:**

1. Änderungen zunächst automatisch lokal speichern.
2. Nach einem Neustart wiederherstellen.
3. Sichtbar machen, ob der Entwurf lokal gespeichert ist.
4. Synchronisierung mit dem IMAP-Entwurfsordner als nächsten Schritt ergänzen.

Wenn Entwürfe später auf mehreren Geräten bearbeitet werden, müssen Konflikte erkennbar sein. Eine Version darf nicht stillschweigend eine andere überschreiben.

Bei Anhängen sollte die App rechtzeitig erkennen, wenn die ursprüngliche Datei verschoben oder gelöscht wurde. Für robuste Entwürfe kann sie eine verwaltete Kopie verwenden.

## 6. Versand und Status

Der Versandablauf sollte nachvollziehbar sein:

1. Empfänger, Sendekonto und Anhänge prüfen.
2. Nutzer klickt ausdrücklich auf **Senden**.
3. Die App übergibt die Nachricht über SMTP.
4. Nach Annahme durch den Server zeigt sie **„Gesendet“**.
5. Eine Kopie wird im Gesendet-Ordner abgelegt beziehungsweise mit dem Server abgeglichen.

Wichtig: Die Annahme durch den SMTP-Server bedeutet noch nicht, dass die Nachricht beim Empfänger gelesen wurde.

### Fehlerfälle

- **Verbindung oder Anmeldung fehlgeschlagen:** Entwurf erhalten, Fehler anzeigen.
- **Nur einzelne Empfänger abgelehnt:** klar anzeigen, welche betroffen sind und wie mit den übrigen verfahren wurde.
- **Server hat die Nachricht angenommen, aber Gesendet-Kopie konnte nicht gespeichert werden:** als gesendet kennzeichnen und nur das Speichern der Kopie erneut versuchen – nicht die Mail automatisch erneut versenden.
- **Verbindung bricht während des Sendens ab und der Status ist unklar:** Nutzer darauf hinweisen, dass die Mail möglicherweise bereits angenommen wurde. Ein unbedachter automatischer Neuversand kann Duplikate erzeugen. [RFC 1047](https://www.rfc-editor.org/rfc/rfc1047.html)

Manche Anbieter legen gesendete Nachrichten selbst ab. Die App sollte das beim Abgleich berücksichtigen, damit nicht unnötig doppelte Kopien entstehen. Die Kennzeichnung des Gesendet-Ordners und das Verhalten können je nach Server unterschiedlich sein. [RFC 6154](https://www.rfc-editor.org/rfc/rfc6154.html)

## 7. Ordner und alltägliche Aktionen

Die App bildet mindestens diese Bereiche ab:

- Posteingang
- Entwürfe
- Gesendet
- Archiv
- Papierkorb
- Spam
- Eigene Ordner und Unterordner

Ordnernamen können sich je nach Anbieter und Sprache unterscheiden. Die App sollte besondere Ordner anhand der vom Server angebotenen Kennzeichnungen erkennen und bei Bedarf eine manuelle Zuordnung anbieten. [RFC 6154: Special-Use Mailboxes](https://www.rfc-editor.org/rfc/rfc6154.html)

Typische Aktionen:

- Als gelesen oder ungelesen markieren
- Markieren beziehungsweise Flagge setzen
- In einen anderen Ordner verschieben
- Archivieren
- In den Papierkorb verschieben
- Aus dem Papierkorb wiederherstellen
- Dauerhaft löschen, mit eindeutiger Bestätigung
- Ordner erstellen und umbenennen, soweit der Server dies erlaubt

Bei mehreren Konten ist ein **gemeinsamer Posteingang** nützlich. Jede Nachricht muss dort weiterhin erkennen lassen, zu welchem Konto sie gehört.

## 8. Suche und Unterhaltungen

### Suche

Eine globale Suche sollte mindestens folgende Kriterien unterstützen:

- Absender und Empfänger
- Betreff
- Nachrichtentext, soweit verfügbar
- Ordner und Konto
- Ungelesen
- Nachrichten mit Anhängen
- Zeitraum

Wichtig ist eine ehrliche Anzeige des Suchumfangs: Eine lokale Suche findet nur Inhalte, die bereits heruntergeladen und indexiert wurden. Eine ergänzende Serversuche kann weitere Nachrichten finden, solange eine Verbindung besteht.

Beispiele:

```text
Mara Launch
from:mara@example.org
subject:Rechnung
has:attachment
is:unread
```

Solche Suchoperatoren sind nützlich, sollten aber nicht Voraussetzung sein: Die normalen Filter müssen auch ohne Fachsyntax bedienbar bleiben.

### Unterhaltungen

Nachrichten können optional zu einer Unterhaltung gruppiert werden. Grundlage sind in erster Linie die Nachrichten- und Antwort-IDs; der Betreff allein ist keine zuverlässige Zuordnung.

In der Unterhaltung sollte jede einzelne Nachricht weiterhin separat geöffnet, beantwortet, verschoben oder gelöscht werden können.

## 9. Anhänge

Zur Grundausstattung gehören:

- Anhänge anzeigen und herunterladen
- Mehrere Dateien an einen Entwurf anhängen
- Dateien per Drag & Drop hinzufügen
- Name und Größe anzeigen
- Anhänge vor dem Versand wieder entfernen
- Beim Download einen Speicherort wählen
- Downloadfehler und fehlende lokale Dateien verständlich anzeigen

Eine Vorschau für Bilder und PDFs ist hilfreich, kann aber nach der ersten stabilen Version folgen. Dateinamen und Dateitypen dürfen nicht blind als vertrauenswürdig behandelt werden.

## 10. Synchronisierung und Offline-Verhalten

IMAP ist die Verbindung zum vorhandenen Postfach. Die App hält zusätzlich einen lokalen Cache bereit, damit Nachrichten schnell angezeigt werden und bereits geladene Inhalte auch offline verfügbar sind.

### Grundregeln

- Konten und Ordner unabhängig voneinander synchronisieren.
- Zuerst aktuelle Nachrichten und Metadaten laden; ältere Inhalte bei Bedarf nachladen.
- Gelesen-Status, Markierungen und Verschiebungen mit dem Server abgleichen.
- Verbindungsabbrüche anzeigen und kontrolliert erneut verbinden.
- Offline-Zustand sichtbar machen.
- Änderungen, die offline vorgemerkt werden, als **ausstehend** kennzeichnen.
- Konflikte und fehlgeschlagene Änderungen nicht stillschweigend verwerfen.

Für einen zuverlässigen Abgleich müssen Nachrichten pro Ordner anhand von **UID und UIDVALIDITY** zugeordnet werden. Ändert sich UIDVALIDITY, müssen die bisherigen Zuordnungen für diesen Ordner neu geprüft werden. [RFC 9051: IMAP-UIDs](https://www.rfc-editor.org/rfc/rfc9051.html#section-2.3.1.1)

Soweit verfügbar, kann IMAP-IDLE neue Nachrichten zeitnah melden; eine regelmäßige Aktualisierung bleibt als Alternative sinnvoll.

## 11. Sicherheit und Datenschutz

Die App sollte ihre Sicherheitsgrenzen einfach und nachvollziehbar halten:

- Zugangsdaten im **Zugangsdaten-Speicher des Betriebssystems**, nicht im Klartext in der Datenbank.
- TLS und Zertifikate für IMAP und SMTP prüfen.
- Mailinhalte und Anhänge als nicht vertrauenswürdige Daten behandeln.
- Fremde HTML-Inhalte isoliert anzeigen.
- Keine automatischen Remote-Bilder ohne entsprechende Einstellung.
- Keine Passwörter, Mailinhalte oder vollständigen Nachrichten unnötig protokollieren.
- Lokale Datenbank, Anhänge und Backups im Datenschutzkonzept berücksichtigen.

**Transportverschlüsselung** schützt die Verbindung zum Mailserver. Sie ist nicht automatisch eine Ende-zu-Ende-Verschlüsselung der Nachricht. S/MIME oder OpenPGP können später hinzukommen.

## 12. Zusammenspiel mit dem OpenVibeDesk-Chat

Hier liegt der besondere Nutzen gegenüber einem gewöhnlichen Mailprogramm: Der Chat soll nicht nur über Mails sprechen, sondern die passende Stelle im Workspace öffnen können.

Beispiele:

- „Suche die Mail von Mara zur Launch-Checkliste.“
- „Fasse die letzte Nachricht von Jonas zusammen.“
- „Öffne diese Mail.“
- „Bereite eine Antwort vor und frag nach dem Termin.“
- „Welche Anhänge hat die Nachricht?“

Der Ablauf sollte sichtbar und nachvollziehbar sein:

```text
Nutzer fragt nach einer Mail
       ↓
Assistent sucht mit einem begrenzten Werkzeug
       ↓
Passende Treffer werden ausgewählt oder bei Unklarheit nachgefragt
       ↓
Mailfenster öffnet die entsprechende Nachricht
       ↓
Assistent beantwortet die Frage oder bereitet einen Entwurf vor
```

Dabei gelten klare Grenzen:

- Der Nutzer soll erkennen können, **welche Mail** der Assistent verwendet.
- Mailinhalte sind Daten und können selbst Anweisungen enthalten; sie erhalten keine automatische Befehlsgewalt über den Assistenten.
- Mailinhalte, die für eine KI-Antwort benötigt werden, können an den ausgewählten Anbieter übertragen werden. Das muss in der Oberfläche nachvollziehbar sein.
- Der Assistent darf einen Entwurf vorbereiten und öffnen.
- **Versenden erfolgt erst nach ausdrücklicher Freigabe durch den Nutzer.**
- Für spätere Aktionen wie Verschieben oder Löschen sind eigene, verständliche Berechtigungen vorzusehen.

## 13. Empfohlene Umsetzung in OpenVibeDesk

Der bestehende Aufbau mit Electron, React, getrennten Fenstern und einem lokalen Main-Prozess passt grundsätzlich zu diesem Konzept.

Eine mögliche Aufteilung:

```text
Mail-Oberfläche
    │
    ├── Nachrichtenliste und Mailansicht
    ├── Entwurfsfenster
    └── Kontoeinstellungen
             │
             ▼
      Typisierte Schnittstelle
             │
             ▼
      Mail-Dienste im Main-Prozess
      ├── Konten und Zugangsdaten
      ├── IMAP-Synchronisierung
      ├── SMTP-Versand
      ├── MIME-Verarbeitung
      ├── Anhänge
      └── Lokale Speicherung und Suche
             │
             ▼
      Begrenzte Workspace-Werkzeuge für den Chat
```

Die Oberfläche ruft benannte Funktionen auf; sie erhält keinen allgemeinen Zugriff auf Netzwerk, Dateisystem oder Zugangsdaten. Der Chat verwendet dieselben fachlichen Funktionen über gesondert freigegebene Werkzeuge.

Vor einer größeren echten Maildatenbank sollte das bisherige einfache Speichermodell durch ein geeignetes Schema für Konten, Ordner, Nachrichten, Entwürfe, Anhänge und Synchronisierungsstände ergänzt werden.

## 14. Reihenfolge für die Umsetzung

| Schritt | Inhalt | Ergebnis |
|---|---|---|
| **1. Konto und Empfang** | Kontoeinrichtung, Zugangsdaten, TLS, IMAP-Verbindung, Ordner, Posteingang | Echte Nachrichten sicher lesen |
| **2. Alltagstaugliche Mailansicht** | HTML/Text, Anhänge, Suche, Status, Verschieben und Papierkorb | Mailbestand sinnvoll nutzen |
| **3. Schreiben und Entwürfe** | Editor, An/CC/BCC, Antworten, Weiterleiten, Anhänge, lokale Wiederherstellung | Nachrichten zuverlässig vorbereiten |
| **4. Versand** | SMTP, klare Statusmeldungen, Gesendet-Ordner, Fehlerbehandlung | Nachrichten bewusst versenden |
| **5. Workspace-Assistent** | Mail suchen, auswählen, öffnen, zusammenfassen und Entwürfe vorbereiten | Chat und Mail arbeiten zusammen |
| **6. Komfort** | Mehrere Konten, gemeinsamer Posteingang, Signaturen, bessere Suche und Vorschauen | Rundes Alltagswerkzeug |

Mehrere Konten können früher kommen, wenn sie für deinen konkreten Einsatz notwendig sind. **OAuth, Kalender, Exchange-Sonderfunktionen und umfangreiche Unternehmensverwaltung** sind für diesen ersten Leitfaden keine Voraussetzung.

Für die praktische Prüfung würde ich zunächst mit einem dafür vorgesehenen Testpostfach arbeiten: Empfang, Antwort, CC/BCC, Anhänge, Entwürfe nach Neustart, Offline-Verhalten und Versandfehler lassen sich damit direkt durchspielen.

Die Option **KI → Workspace-Zugriff → Ohne Abfragen** überspringt nach ausdrücklichem Speichern die einzelnen Bestätigungsdialoge für beauftragte Assistentenaktionen. Sie ist standardmäßig ausgeschaltet; manuelles Senden behält seinen Dialog. SMTP-Ergebnisse werden als `sent`, `failed`, `cancelled` oder `uncertain` an Oberfläche und Assistent zurückgegeben. Ein bereits angenommener oder unklarer Versand wird nicht automatisch wiederholt. Leere Fehlerfelder dürfen einen erfolgreichen Versand nicht als fehlgeschlagen markieren.
