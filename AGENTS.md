# HomeWally – Entwicklungs-Richtlinien & Feature-Checkliste

Diese Datei definiert verbindliche Qualitäts- und Architektur-Anforderungen für **jede** Änderung und jedes neue Feature in diesem Repository. Alle Punkte müssen vor Abschluss einer Aufgabe geprüft und umgesetzt sein – ohne dass der Nutzer erneut danach fragen muss.

---

## 1. Alle Designs (Stile) sowie Hell- und Dunkelmodus

HomeWally unterstützt **7 Stile** (`<html data-style="...">`: `wally`, `classic`, `clear`, `flow`, `aurora`, `nodes`, `minimal`) und **2 Farbmodi** (`<html data-mode="light|dark">`).

- **Nur Design-Tokens verwenden:** Keine hartcodierten hellen/dunklen Hintergrund- oder Textfarben (`#fff`, `#000`, `rgba(0,0,0,...)`), außer gezielt mit geprüfter Kontrastwirkung in beiden Modi. Immer CSS-Custom-Properties nutzen: `--bg`, `--surface`, `--surface-2`, `--sheet`, `--tint-base`, `--line`, `--line-strong`, `--text`, `--muted`, `--accent`, `--accent-text`, `--today`, `--today-text`, `--ok`, `--danger`, `--radius`, `--shadow`.
- **Glas-Themes (`aurora`, `clear`, `flow`) besonders beachten:**
  - `--surface` ist in Glas-Themes halbtransparent. Dialoge, Modals, Sheets, Popover, Menüs und Vollbild-Overlays dürfen **niemals** durchsichtig über darunterliegendem Inhalt stehen.
  - Für solche Ebenen immer `var(--sheet, var(--surface))` (oder eine deckende Fläche) und ggf. `backdrop-filter` verwenden.
- **CSS-Kaskadenschichten (`@layer`) einhalten:** Die Reihenfolge `app`, `modules`, `themes` (in `index.html` definiert) respektieren. Modul-CSS gehört in `@layer modules`, Theme-Overrides in `src/themes.css` bzw. `src/wally.css` (`@layer themes`), damit Stile nicht durch ungeschichtete Regeln überschrieben werden.
- **Icons & Glyphen:** In Nicht-`classic`-Stilen werden `.ui-glyph` ausgeblendet und `.ui-icon` (SVG mit `stroke: currentColor`) eingeblendet. Neue Icons über `src/components/Icon.tsx` bereitstellen, damit sie sich automatisch an Stil und Modus anpassen.
- **Systemleisten & Vollbild:** Bei Änderungen an Vollbild-Overlays, Hintergründen oder Theme-Wechseln sicherstellen, dass `meta[name="theme-color"]` (PWA) und `setSystemBars` (Android in `src/App.tsx` / `AppLauncherPlugin.java`) farblich und beim Icon-Kontrast konsistent bleiben.
- **Wand-Tablet-Ergonomie (Landscape & Touch):** Großzügige Touch-Ziele, gute Lesbarkeit aus Armeslänge und konsistente Abstände (siehe auch Abschnitt 7 zu modulübergreifenden Layout-Richtlinien).

---

## 2. Export, Import, Reset & Persistenz

Jedes neue Feature mit Nutzereinstellungen oder gespeicherten Daten muss durchgängig in Sicherung und Wiederherstellung eingebunden sein.

- **Key-Konvention:** Alle `persisted()`-Stores (`src/lib/persisted.ts`) müssen den Präfix `fc.` tragen (z. B. `fc.birthdays`), damit der Werksreset (`resetApp()` in `src/lib/demoData.ts`) sie automatisch mitlöscht.
- **Vollständige Backup-Integration in `src/lib/backup.ts`:**
  1. `BackupData` um das neue Feld erweitern.
  2. `buildBackup()` exportiert den Store-Zustand (oder das Feld liegt bereits in `AppConfig` / `config.settings`).
  3. `parseBackup()` liest das Feld abwärtskompatibel ein (ältere Backups ohne das Feld müssen fehlerfrei importierbar bleiben!).
  4. `applyBackup()` stellt den Store via `.restore(...)` wieder her.
- **Tests & Beschreibung:**
  - Round-Trip- und Abwärtskompatibilitäts-Test in `src/lib/backup.test.ts` ergänzen.
  - Bei größeren neuen Datenbereichen den Hinweistext `settings.backup.intro` in `src/i18n/de.ts` und `src/i18n/en.ts` aktuell halten.
- **Bewusste Ausnahmen (nie exportieren):**
  - Geheime Schlüssel (insbesondere der Gemini-API-Key – lokaler Key muss beim Import erhalten bleiben).
  - Große binäre Daten in IndexedDB (lokale Fotos).
  - Gerätespezifische Hardware-Telemetrie (z. B. `fc.batteryHistory`).
  - Flüchtige UI-/Sitzungszustände (aktiver Tab, Filterchips, Zoomstufen, Caches).

---

## 3. Sprachsteuerung & Sprachausgabe

Jedes neue benutzerrelevante Feature (Datenbereich, Kalenderart, Aktion, abfragbare Information oder Erinnerung) muss auf Sprachsteuerung und Sprachausgabe geprüft und bei Bedarf integriert werden.

- **Sprachausgabe (TTS) ausschließlich über `src/native/speech.ts`:**
  - Immer `speak()` / `stopSpeaking()` aus `src/native/speech.ts` nutzen – **niemals** `window.speechSynthesis` direkt aufrufen.
  - Hintergrund: Android WebView besitzt kein `speechSynthesis`; `speech.ts` nutzt unter Android automatisch das native `SpeechPlugin.java` und in der PWA die Web Speech API in der jeweiligen App-Sprache (`de` / `en`).
- **Einstellungen & Ruhezeit respektieren:**
  - Bei Sprachantworten die Nutzer-Einstellung `voice.speak` („Antworten vorlesen“) beachten.
  - Bei automatischen Ansagen/Erinnerungen `soundSettings` (inkl. Ruhezeit / Quiet Hours in `src/lib/sounds.ts`) respektieren.
- **Sprachbefehle (`src/voice/`) konsistent pflegen:**
  - `src/voice/command.ts`: neue Intent-/Command-Typen, JSON-Schema und Prompt-Beispiele ergänzen.
  - `src/voice/gemini.ts`: ggf. relevanten Kontext für Gemini mitgeben (keine unnötigen oder sensiblen Daten).
  - `src/voice/apply.ts`: Ausführung, natürliche, kurze gesprochene Rückmeldung (`speech`) sowie nach Möglichkeit Undo-Aktion implementieren.
  - `src/voice/answers.tsx`: visuelle Antwortkarte passend darstellen.
  - `src/voice/voice.test.ts`: Tests für Parsing, Ausführung und Sprachausgabe ergänzen.
- **Lokalisierung:** Alle gesprochenen Texte über `src/i18n/de.ts` und `src/i18n/en.ts` formulieren – natürlich klingend (keine Roh-IDs, ISO-Strings oder Sonderzeichen vorlesen lassen).

---

## 4. Dual-Plattform: PWA (Browser) & Android-App (Capacitor)

HomeWally läuft sowohl als **Web-App / installierte PWA** im Browser als auch als **native Android-App** (Capacitor 8, auch als Launcher/Kiosk). Beide Plattformen müssen immer gemeinsam mitgedacht werden.

- **Saubere Plattform-Erkennung:** Plattformabhängiges Verhalten über `isNative` aus `src/native/launcher.ts` steuern.
- **Android-exklusive Funktionen sauber kapseln:**
  - Features, die native Android-APIs voraussetzen (z. B. App-Launcher, Akku-Widget, App-Info/Deinstallation, native Systemleisten), dürfen in der PWA **nicht** als defekte/leere UI erscheinen – sie müssen im Web ausgeblendet oder sauber als nicht verfügbar behandelt werden.
  - Wenn ein neues Dashboard-Widget hinzukommt (auch Android-only), alle exhaustiven Typ-Mappings aktualisieren (`WidgetType` in `src/lib/dashboard.ts`, `src/dashboard/widgets/index.tsx`, `src/lib/demoData.test.ts`).
- **Web-APIs vs. Android WebView:**
  - **Berechtigungen (Android):** Für Standort, Mikrofon, Paket-Deinstallation usw. immer die nötigen `<uses-permission>`-Einträge und nicht-zwingende `<uses-feature android:required="false" />` in `android/app/src/main/AndroidManifest.xml` prüfen/ergänzen.
  - **Berechtigungs-Ablehnung:** Verständliche Fehlermeldungen für beide Plattformen (unter Android nach Möglichkeit mit direktem Knopf zu den App-Einstellungen über `openAppInfo()`).
  - **Native Plugins (`android/app/src/main/java/io/github/indigodev/homewally/`):** TypeScript-Wrapper unter `src/native/` defensiv typisieren und gegen Web-Aufrufe oder fehlende native Methoden absichern (`.catch(...)` / sinnvolle Fallbacks).
  - **PWA-Besonderheiten:** Datei-Export (Blob-Download), Safe-Areas, Offline-Verhalten, `manifest.webmanifest`, `index.html` und `theme-color` im Blick behalten.

---

## 5. Mehrsprachigkeit (alle vorhandenen Sprachen)

Jedes Feature muss in **allen** in `src/i18n/index.ts` registrierten Sprachen (aktuell `de` und `en` sowie jede künftig ergänzte Sprache in `LANGUAGES` / `MESSAGES`) vollständig und natürlich funktionieren.

- **Keine hartcodierten Texte:** Alle sichtbaren und gesprochenen Strings (Labels, Buttons, Tooltips, Fehlermeldungen, Bestätigungsdialoge, Sprachbefehls-Antworten, Katalog-Einträge wie Lebensmittel/Fächer, Widget-Titel/-Beschreibungen) ausschließlich über `t(...)` aus `src/i18n/` beziehen.
- **Vollständige Sprach-Parität:** Jeden neuen Schlüssel in allen Sprachdateien (`src/i18n/de.ts`, `src/i18n/en.ts`, …) zeitgleich mit identischer Struktur pflegen (`src/i18n/i18n.test.ts` prüft dies).
- **Locale-bewusste Formatierung:** Daten, Uhrzeiten, Wochentage, Zahlen, Sortierungen und Pluralformen (`Plural` / `Intl.PluralRules`) immer über `locale()` / `t(..., { n })` statt fester deutscher oder englischer Formate darstellen.
- **Sprachsteuerung & Demo-Daten:** Auch Voice-Prompts/Beispiele, TTS-Ansagen (`src/native/speech.ts`) und Demo-Daten (`src/lib/demoData.ts`) müssen die aktive App-Sprache sauber unterstützen.

---

## 6. Widgets & Größenstufen (Dashboard)

Bei jedem neuen Dashboard-Widget – sowie bei funktionalen Erweiterungen bestehender Widgets – muss von Anfang an geprüft werden, in welchen Größenstufen es sinnvoll vorliegen soll (`SIZES` in `src/lib/dashboard.ts`: `s` 1×1, `m` 2×1, `t` 1×2, `l` 2×2, `xl` 3×2).

- **Sinnvolle Größenvarianten anbieten:** Prüfen, ob neben einer kompakten Kachel (`s` 1×1) weitere Größen mit echtem Mehrwert sinnvoll sind (z. B. zusätzliche Details in `m` 2×1, Liste/Verlauf/Graph in `t` 1×2 oder `l` 2×2, Übersicht in `xl` 3×2).
- **Inhalt & Layout pro Größe anpassen:** Jede freigegebene Größe muss den verfügbaren Platz sinnvoll nutzen – kompakt ohne Überladung bei kleinen Größen, mehr Information/Visualisierung bei großen Größen, niemals einfach leer gestreckt oder abgeschnitten.
- **Normal- & Bearbeitungsmodus prüfen:** Jede Größenvariante muss sowohl im regulären Betrieb als auch im Dashboard-Bearbeitungsmodus (inkl. Größenmenü, Verschieben und Raster-Packen) stabil bleiben.
- **Vollständige Registrierung:** Bei neuen Widgets `WidgetType` & `DEFS` in `src/lib/dashboard.ts`, Renderer in `src/dashboard/widgets/index.tsx`, i18n-Einträge (`dashboard.widgets.<type>`) sowie `src/lib/demoData.test.ts` aktualisieren.

---

## 7. Modulübergreifende Layout-, Höhen- & Überlauf-Richtlinien

Die strengen Layout-Regeln des Dashboards (Höhe/Länge, Raster-Stabilität, saubere Grenzen) gelten **überall** in der gesamten App – also genauso im Wetter-Modul, Kalender, Einkaufsliste, To-dos, Stundenplan, Fotorahmen, Spielecke, Apps, Einstellungen und in jedem neuen Modul.

- **Höhen- & Längenkontrolle (kein Überlappen, kein Quetschen):**
  - Kopfzeilen, Filterleisten und Fußzeilen/Credits (z. B. `.wx-credit`) dürfen niemals von Kacheln, Listen oder Karten überlagert oder aus dem sichtbaren Bereich gedrückt werden.
  - Scrollbare Bereiche mit klaren Flex-/Grid-Grenzen (`min-height: 0`, `min-width: 0`, bei wachsendem Inhalt `flex: 1 0 auto` + Scroll-Container) aufbauen statt Inhalte abzuschneiden.
- **Stabile Abmessungen in allen Zuständen:** Umschalten in Bearbeitungsmodi, Einblenden von Toolbars/Bannern oder Hinzufügen von Einträgen darf keine Zeilenhöhen verzerren oder das Gesamtlayout springen lassen.
- **Sauberes Verhalten bei wenig & viel Inhalt:** Jede Ansicht muss mit 0 Einträgen, wenigen Einträgen und vielen Einträgen (durch kontrolliertes Scrollen, sinnvolle Skalierung/Kompaktstufen, Umbruch oder Ellipsis) gut aussehen.
- **Kein ungewolltes Abschneiden (Overflow):** Badges, Warnpunkte, Tooltips, Popover und Menüs dürfen nicht durch `overflow: hidden` an Eltern-Containern abgeschnitten werden; bei horizontal scrollbaren Leisten (z. B. Personen-Filter) klare Übergänge (Edge-Fade) verwenden.
- **Quer- und Hochformat:** Alle Module auf Wand-Tablets im Querformat (typisch 16:10 / 16:9) **und** auf schmaleren bzw. hochformatigen Viewports sauber nutzbar halten – ohne ungewollte horizontale Scrollbalken.

---

## 8. Allgemeine Projekt-Standards

- **Audio-Feedback:** Bei passenden Nutzeraktionen (z. B. Abhaken, Anlegen, Löschen) konsistent `src/lib/sounds.ts` anbinden (respektiert Stummschaltung und Ruhezeit).
- **Mitglieder-Löschung & Datenintegrität:** Wenn neue Daten auf Familienmitglieder referenzieren, beim Entfernen eines Mitglieds (`src/store.tsx`) verwaiste Referenzen sauber bereinigen.
- **Verifikation vor Abschluss:** Vor jeder Fertigmeldung / jedem Commit muss `npm run check` (`typecheck`, `lint`, `format:check`, `test`) sowie `npm run build` fehlerfrei durchlaufen (in Windows PowerShell via `npm.cmd`).
- **Dokumentation:** Bei neuen sichtbaren Features `README.md` aktuell halten.
