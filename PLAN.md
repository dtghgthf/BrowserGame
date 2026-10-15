# PLAN – Leuchtturmwärter, Phase 1 + 2

Legende: `[x]` erledigt, `[ ]` offen. Jeder Schritt endet mit `npm run build`, `npm run typecheck`, `npm test` und einem Commit.

## Schritt 0 – Grundgerüst
- [x] npm-Workspaces `shared/`, `client/`, `server/` (leer), TypeScript strict, Vite, Vitest
- [x] `PLAN.md`, `DECISIONS.md`
- [x] Root-Skripte: `dev`, `build`, `typecheck`, `test`, `assets`, `verify`

## Schritt 1 – Schiffs-Layout (shared)
- [x] ASCII-Karte des Schiffs (3 Decks, Mast + Mastkorb, Leitern, Luken, Wände, Marker)
- [x] Parser: Kollisions-Rechtecke (gemergt), Occluder-Kanten für Licht, Leitern, Luken, Kompartimente (Wasserräume), Marker
- [x] Tests: Parser, Kompartimente, keine DOM/Pixi-Abhängigkeit in `shared/`

## Schritt 2 – Wellen, Schiffsbewegung, Schwerkraft, fester Timestep (shared)
- [x] Wellenfunktion (Summe von Sinuswellen), Roll ±15°, Heave
- [x] Schwerkraftvektor im Schiffs-Frame entgegengesetzt rotiert (+ Heave-Beschleunigung)
- [x] `FixedStepper` (Accumulator, 60 Hz, Alpha für Interpolation)
- [x] Tests: Schwerkraftrotation, fester Timestep

## Schritt 3 – Physik & Spieler (shared, Rapier)
- [x] Rapier-Welt im Schiffs-Frame, statische Collider aus Layout, Luken als schaltbare Collider
- [x] Spieler: Laufen, Springen, Rutschen bei Schlagseite, Leitern, Durchfallen durch Luken, One-Way-Plattformen
- [x] Lose Objekte (Kisten, Fässer, Planken), Aufheben/Tragen/Ablegen (Tragen verlangsamt)
- [x] Tests: Spieler landet auf Deck, rutscht bei Schräglage, Leiter

## Schritt 4 – Wasser, Leck, Stationen (shared)
- [x] Füllstand pro Kompartiment, geneigte Oberfläche, Fluss durch offene Luken
- [x] Leck (Debug-Taste), Einströmung abhängig von Tiefe unter Wasserlinie
- [x] Pumpe (Stationsmodus, abwechselnd links/rechts pumpen)
- [x] Steuerrad (Kurs, Rollverhalten), Scheinwerfer (Winkel), Werkstatt (Planke holen)
- [x] Reparatur mit Planke; Schlagseite durch Wassermoment; Sinken → Neustart
- [x] Tests: Wasserfluss, Pumpe, Leck-Reparatur

## Schritt 5 – Assets (Platzhalter-Pixel-Art)
- [x] Generator-Skript: eigener PNG-Encoder, Normal Maps (`_n.png`), Aseprite-kompatibles Spritesheet-JSON
- [x] Rumpf (3 Decks), Rückwand, Spielerfigur (Lauf-Animation + Mantel-Layer zum Einfärben), Kiste, Fass, Planke, Laterne, Steuerrad, Pumpe, Scheinwerfer, Kanone, Werkbank, Pixel-Font

## Schritt 6 – Client Phase 1 (spielbar)
- [x] PixiJS v8 (WebGL), Low-Res-RenderTexture, ganzzahliges Nearest-Upscaling
- [x] Game-Loop: fester Timestep + Interpolation
- [x] Schiffs-Container rotiert um Rollwinkel, Meer im Weltkoordinatensystem
- [x] Kamera: sanft, pixelgenau
- [x] Tastatur-Input → Input-Daten, Stations-UI, HUD

## Schritt 7 – Debug-Overlay, Touch, lokaler 2-Spieler-Modus
- [x] F3: FPS, Collider, Schwerkraftvektor, Wasserstände, Licht-Polygone
- [x] Touch: virtueller Stick + Buttons, automatisch auf Touch-Geräten
- [x] Optional: zweiter Spieler auf Pfeiltasten

## Schritt 8 – Lighting-Pipeline (Phase 2)
- [x] Albedo-Pass, Normal-Pass, Masken-Pass
- [x] Sichtbarkeits-Polygone pro Licht gegen Occluder, additiver Light-Buffer mit Normal Mapping
- [x] ≥ 3 schwingende Laternen (Client-Deko-Physik), Scheinwerferkegel
- [x] Composite-Shader: Ambient + Lichter, Licht-Quantisierung/Dithering

## Schritt 9 – Nebel, Meer, Rumpfwasser, Partikel
- [x] Nebel als animierter Noise-Shader, vom Scheinwerfer aufgehellt
- [x] Meer mit Wellen + Reflexions-Andeutung
- [x] Wasser im Rumpf mit Wellen-Shader
- [x] Partikel: Gischt, Tropfen am Leck

## Schritt 10 – Verifikation & Doku
- [x] Playwright: Screenshots (Oberdeck, Unterdeck, Debug, Licht) Chromium (+ WebKit falls verfügbar), Konsole prüfen — WebKit in der Build-Umgebung nicht installierbar, Skript unterstützt es
- [x] FPS-Messung headless, dokumentiert
- [x] `README.md` (Deutsch): Start, Steuerung, Stand, bekannte Probleme, manuelle Tests, Vorschlag Phase 3

## Zusätzlich erledigt
- [x] Reling-Tiles (`|`), Buffer-Ansicht F7, Qualitätsstufen mit Auto-Fallback
- [x] Asset-Generator schützt von Hand ersetzte Grafiken (`.generated.json`)
- [x] Client-Tests (Sichtbarkeits-Polygone, Pixel-Skalierung, Input-Latching), Sink-/Neustart-Test
