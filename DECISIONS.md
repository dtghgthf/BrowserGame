# DECISIONS – Entscheidungen & Begründungen

Format: **Entscheidung** – Begründung.

## Werkzeuge & Versionen (Stand 15.10.2026)
- **TypeScript 7.0.2** (die native Go-Version von `tsc`) – aktuelle stabile Version, deutlich schnellerer Typecheck. Wir nutzen TS nur zum Typprüfen (`tsc --noEmit`), Vite transpiliert selbst, daher keine Kompatibilitätsprobleme mit Plugins.
- **Vite 8.3.4, Vitest 5.0.4, PixiJS 8.22.0, Rapier2D-compat 0.21.0** – jeweils aktuelle stabile Releases.
- **API-Prüfung über die installierten `.d.ts`-Dateien und Quellen in `node_modules`** – `pixijs.com` ist aus der Build-Umgebung per Netzwerk-Policy gesperrt. Die Typdeklarationen der installierten Version sind ohnehin die verbindlichste Quelle (z. B. Mesh-Shader-Uniforms `uProjectionMatrix`/`uWorldTransformMatrix`/`uTransformMatrix`, `GlProgram` mit `#version 300 es`).
- **`tsx` als Dev-Dependency** – führt das Asset-Generator-Skript (TypeScript, importiert das Schiffs-Layout aus `shared/`) direkt aus.
- **Keine PNG-Bibliothek** – der Generator enthält einen ~40-Zeilen-PNG-Encoder auf Basis von `node:zlib`. Eine Dependency weniger.

## Monorepo
- **`@lw/shared` exportiert direkt TypeScript-Quellen (`exports: ./src/index.ts`)** – Vite und Vitest verarbeiten das ohne Build-Schritt; der spätere Colyseus-Server kann `tsx` nutzen oder `shared` bündeln.
- **`shared/tsconfig.json` hat `lib: ["ES2022"]` und `types: []`** – damit ist jede DOM-Nutzung in `shared/` ein Typfehler. Zusätzlich prüft ein Vitest-Test, dass keine `pixi.js`-Imports und keine `window`/`document`-Zugriffe in `shared/src` existieren.
- **`npm run build` = Typecheck `shared` + `server` + `vite build` des Clients**; `npm run typecheck` prüft alle Pakete einzeln mit `tsc --noEmit` (unterschiedliche `lib`-Einstellungen pro Paket).

## Simulation (`shared/`)
- **Koordinaten: y zeigt nach unten (wie der Bildschirm), Einheit Meter, 1 Tile = 0,5 m = 8 px (16 px/m).** Positive Winkel drehen im Uhrzeigersinn. Spart überall Vorzeichen-Umrechnungen zwischen Simulation und PixiJS.
- **Schiff als ASCII-Tilemap (`shared/src/layout/shipMap.ts`).** Kollision (gemergte Rechtecke), Licht-Occluder, Leitern, Luken, Wasser-Kompartimente, Stationen und Spawnpunkte werden daraus abgeleitet. Ein Schiffsumbau ist damit eine Textänderung; die Rumpf-PNGs müssen die gleichen Maße haben (72×27 Tiles = 576×216 px).
- **Kompartimente = 4-zusammenhängende Innenraum-Regionen.** Türen in Schotten verbinden Räume eines Decks zu einem Kompartiment (Wasser fließt durch Türen ohnehin frei); Decks sind durch Luken getrennt. Ergebnis: „Mitteldeck“ und „Unterdeck“.
- **`Simulation`-Klasse statt freier `step(state, inputs, dt)`-Funktion.** Rapier hält eine veränderliche WASM-Welt, die nicht in reine Daten passt. Die Klasse kapselt sie; nach außen gilt trotzdem das Prinzip „Inputs (Daten) rein → `state` (reine, serialisierbare Daten) raus“: `sim.step(inputs, dt, commands)`. Debug-Befehle (Leck, Wasser, Seegang, Roll fixieren, Reset) sind ebenfalls Daten (`SimCommand`).
- **Fester Timestep über `FixedStepper` (Accumulator, max. 6 Steps/Frame, Frame-Zeit auf 0,25 s begrenzt).** Verhindert die „Todesspirale“ auf langsamen Geräten.
- **Rollen kommt aus der Wellen-Steigung, nicht aus Bug-/Heck-Höhen.** Ein 36 m-Schiff würde in realistischen Wellen kaum kippen. Ziel-Rollwinkel = −atan(gemittelte Wellensteigung) × Response, begrenzt auf ±15°, mit Feder-Dämpfer-Trägheit (≈ 4 s Periode). Wasser im Rumpf (Moment) und Ruder erzeugen zusätzlich Schlagseite (bis ±26° gesamt).
- **Schwerkraft im Schiffs-Frame = R(−roll)·(0, g·(1 − a_heave·0,6/9,81)).** Die Heave-Beschleunigung lässt Sprünge auf Wellenbergen leicht anders wirken.
- **Spieler-Controller: dynamischer Rapier-Body mit fester Rotation, Schwerkraft manuell (gravityScale 0).** Am Boden wird die Geschwindigkeit auf `Input × Tempo + Rutschtempo` geregelt, Rutschtempo = tangentiale Schwerkraft × 0,32 s (bei 15° ≈ 1,8 m/s, Laufen 4,2 m/s): spürbar, aber immer steuerbar. In der Luft wirkt die seitliche Schwerkraft voll. Vorteil gegenüber reiner Reibung: exakt tunebar und unabhängig vom Rapier-Reibungsmodell.
- **Spieler-Kapsel 0,44 × 1,28 m** – schmaler als eine Luke (0,5 m), sonst passt man nicht hindurch. Das Sprite darf breiter wirken.
- **Spieler kollidieren nicht miteinander** (Koop im engen Schiff: sonst blockiert man sich an Leitern/Türen).
- **Offene Luken mit Leiter sind One-Way-Plattformen** (eigene Kollisionsgruppe, pro Spieler über den Collision-Filter aktiviert, solange der Spieler nicht klettert und nicht in der Luke steckt). Offene Luken ohne Leiter (Frachtluke) sind echte Löcher. Geschlossene Luken sind solide, blockieren Wasser und Licht. Schließen ist blockiert, solange etwas in der Öffnung steckt.
- **Getragene Objekte werden deaktiviert** (`body.setEnabled(false)`) und über dem Kopf gerendert; beim Ablegen wird per Shape-Query eine freie Position vor/über/hinter dem Spieler gesucht. Kein Kinematic-Body, der durch Wände schieben könnte.
- **Lose Objekte schlafen nie** (`setCanSleep(false)`): Die Schwerkraft ändert sich jeden Step, schlafende Bodies würden nicht rutschen. Reibung mit `CoefficientCombineRule.Min` (Kiste μ = 0,12 → rutscht ab ≈ 7°).
- **Wasser: Volumen pro Kompartiment, Oberfläche als Gerade mit „Slosh“-Feder.** Füllhöhe wird per Bisektion gegen die echte (gekrümmte) Raumform gelöst (Spalten-Profile). Fluss durch offene Luken nach Ausfluss-Formel Q = 0,6·b·√(2gh). Wassermoment → Schlagseite, Gesamtwasser → Tiefgang und trägeres Rollen; Leck-Einstrom ∝ √(Tiefe unter der echten Wasserlinie − Innenwasserstand). Ab 80 % Füllung sinkt das Schiff → automatischer Neustart nach 5 s.
- **Pumpe: A/D (oder W/S) abwechselnd, jeder volle Hub entfernt 0,16 m².** Ein Spieler im Takt (~3–4 Hübe/s) schafft etwas mehr als ein Leck (~0,43 m²/s) – Pumpen hilft, ersetzt aber nicht die Reparatur.
- **Automatische Sprechblasen** (`player.bubble`) als Architektur-Hook für die Kommunikation ohne Sprache: Der nächstgelegene Spieler „ruft“ bei einem neuen Leck, wer ohne Planke reparieren will, zeigt „Planke!“.
- **Determinismus:** Seeded PRNG im State, keine `Math.random`-Aufrufe in `shared/`. Test: zwei Simulationen mit identischen Inputs ergeben byte-identischen State.
