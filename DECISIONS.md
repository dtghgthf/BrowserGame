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

## Rendering (`client/`)
- **WebGL2 erzwungen (`preference: 'webgl'`), Shader in GLSL ES 3.00.** Ein Shader-Dialekt statt GLSL + WGSL; WebGL2 gibt es in Safari ab 15 (iPadOS 15 läuft auch auf alten iPads wie Air 2 / 5. Gen.). WebGPU bringt für 480×270 Pixel nichts.
- **Interne Auflösung: Höhe ≈ 270 px, ganzzahliger Skalierungsfaktor, Breite folgt dem Seitenverhältnis (240–640 px).** 1080p → 480×270 ×4, iPad (2048×1536) → 360×270 ×6 bzw. 341×256 – nie unscharfe, ungleich breite Pixel; kein Letterboxing bei 16:9 und 4:3. `?h=300` erzwingt eine andere Zielhöhe.
- **Sechs Pässe:** Albedo → Normalen → Maske (r = Schiff, g = innen, b = Meer + Wassertiefe) → Licht (additiv) → Composite (+ unbeleuchtete Ebene + HUD) → Upscale. Jeder Pass hat dieselbe Hierarchie (Welt-Container mit Kamera, Schiffs-Container mit Rollwinkel), damit alle Buffer pixelgenau übereinanderliegen.
- **Light-Buffer = volle interne Auflösung (480×270 ≈ 130 k Pixel), Fallback halbe Auflösung.** Bei 130 k Pixeln ist selbst eine alte iPad-GPU unterfordert; volle Auflösung gibt pixelgenaue Schattenkanten. Fällt die Framerate unter 50 fps, schaltet das Spiel automatisch auf CSS-Upscaling und dann auf einen halb so großen Light-Buffer (2×2-Lichtzellen, sieht weiterhin „pixelig“ aus). `?quality=high|medium|low` erzwingt eine Stufe.
- **Licht wird in RGBA8 mit halber Skalierung gespeichert** (×2 im Composite) – überhelle Lichter ohne Float-Render-Targets, die auf älterem iOS nicht verlässlich sind. Der Alpha-Kanal enthält die farblose Streuung für den Nebel.
- **Sichtbarkeits-Polygone im Schiffs-Koordinatensystem** (Winkel-Raycasting gegen die Occluder-Kanten aus der Tilemap, nur Kanten im Lichtradius). Sie hängen nicht vom Rollwinkel ab und werden gecacht, solange sich das Licht nicht bewegt; Strahlen dringen 4 px in Wände ein, damit Wandflächen beleuchtet werden.
- **Normal Maps: eigener Normal-Pass mit Mesh-Quads pro Sprite.** Der Shader dreht/spiegelt die Normalen mit der Weltmatrix des Sprites (Schiffsrolle, gekippte Kisten, nach links schauende Figuren). Konvention: G = oben (Laigter/SpriteIlluminator-Standard). Sprites ohne `_n.png` gelten als flach.
- **Lichtstufen (Posterisierung) mit 4×4-Bayer-Dithering, Nebel ebenfalls quantisiert.** Licht und Nebel bleiben „pixelig“; es gibt keine weichen Sub-Pixel-Verläufe.
- **Himmel, Mond und Sterne prozedural im Composite** (wo der Albedo-Buffer leer ist) – unbeleuchtet, immer hinter allem, kein Overdraw.
- **Meer: Wellenhöhe pro 2-px-Spalte auf der CPU** (exakt dieselbe Funktion wie in `shared/`), als Vertex-Attribut an den Shader. Im Software-Renderer kostete die Sinus-Summe pro Pixel ~25 % der Framezeit. Die Wassertiefe landet in der Maske und treibt die Reflexions-Andeutung im Composite.
- **Unbeleuchtete „Emissive“-Ebene** für Laternenflammen, Scheinwerferlinse, Leuchtturmlampe, Leck-Wasser, Wasser-Glanzlinie und Sprechblasen. Lesbarkeit geht vor Realismus: Ohne Sprache müssen Leck und Wasserstand auch im dunklen Laderaum erkennbar sein.
- **Reling-Tile `|`:** solide für die Physik, aber kein Licht-Occluder (sonst verschluckten die Pfosten im Mastkorb den Scheinwerferkegel).
- **Kamera folgt dem Spieler in Weltkoordinaten**, das Schiff dreht sich darunter. Die Kameraposition wird auf ganze Pixel gerundet, Sprites im Schiff auf ganze Schiffs-Pixel. Das Drehen von Pixel-Art mit Nearest-Sampling erzeugt leichtes „Pixelkriechen“ – bewusst akzeptiert (klassischer Rotsprite-Look, kein Blur).
- **Interpolation über Snapshots** (vorheriger/aktueller Sim-State, `alpha` aus dem Accumulator); Teleports (> 2 m) werden nicht interpoliert.
- **Input-Latching:** Ein Tastendruck bleibt bis zum nächsten Sim-Tick erhalten, auch wenn er zwischen zwei Ticks schon wieder losgelassen wurde.
- **Touch-Steuerung als DOM-Overlay** (Pointer Events), schwebender Stick links, Buttons rechts. Erscheint bei `pointer: coarse` oder beim ersten Touch.
- **Debug-Text als DOM** (scharf lesbar), Debug-Linien im Low-Res-Buffer. F7 zeigt Zwischenbuffer.
- **Uniform-Namen nicht mit Pixis eingebauten kollidieren lassen** (`uColor`, `uTransformMatrix`, …): Pixi setzt diese pro Mesh automatisch – ein eigenes `uColor` (vec3) erzeugte GL-Fehler und überschrieb die Lichtfarbe.

## Verifikation
- **Playwright 1.56.1 fest gepinnt**, passend zum vorinstallierten Chromium der Build-Umgebung. WebKit konnte hier nicht installiert werden (`playwright install` ist in der Umgebung untersagt); `scripts/verify-browser.mjs` testet WebKit automatisch mit, sobald es lokal installiert ist (`npx playwright install webkit`).
- **Headless-Chromium rendert per SwiftShader (Software-GPU auf 4 CPU-Kernen).** Die dort gemessenen FPS sagen nichts über echte Geräte aus; dokumentiert sind sie trotzdem (README), zusammen mit der reinen CPU-Zeit pro Frame.
