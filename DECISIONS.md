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
- **Spieler-Controller: dynamischer Rapier-Body mit fester Rotation, Schwerkraft manuell (gravityScale 0).** Am Boden wird die Geschwindigkeit auf `Input × Tempo + Rutschtempo` geregelt, Rutschtempo = tangentiale Schwerkraft × 0,32 s (bei 15° ≈ 1,8 m/s, Laufen anfangs 4,2, jetzt 5,6 m/s): spürbar, aber immer steuerbar. In der Luft wirkt die seitliche Schwerkraft voll. Vorteil gegenüber reiner Reibung: exakt tunebar und unabhängig vom Rapier-Reibungsmodell.
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

## Feedback-Runde 1
- **Alle Spielwerte als Daten (`shared/src/tuning.json` + `tuning.ts`), jede Simulation hat ihre eigene Kopie.** Änderungen
  laufen als `SimCommand` `{ type: 'tune', patch }` – genau wie später übers Netzwerk. Feste Körpermaße (Kapselgröße) bleiben
  Konstanten (`PLAYER_SHAPE`), weil der Collider nicht live umgebaut werden soll.
- **Grafikwerte getrennt in `client/src/look.json`**, weil sie nur den Client betreffen (der Server braucht sie nicht).
  Helligkeit wirkt als Exposure + Gamma im Composite, Mond- und Innenlicht skalieren feste Farbtöne.
- **Speichern über einen Vite-Dev-Server-Endpunkt (`POST /__tuning`)** statt nur localStorage: so werden die Werte zu echten
  Projekt-Defaults im Repo. Der Endpunkt schreibt ausschließlich in die beiden JSON-Dateien und übernimmt nur Schlüssel, die
  dort schon existieren, und nur endliche Zahlen. Er existiert nur in `npm run dev`. Lokale, noch nicht gespeicherte
  Änderungen merkt sich das Gerät in localStorage.
- **Hellere Standardwerte:** Exposure 1,3, Gamma 0,85, mehr Mond- und Innenlicht, Laternen 2,1 statt 1,8 mit größerer
  Reichweite. **Laufen 5,6 statt 4,2 m/s** (Beschleunigung 44).
- **Analoger Stations-Input (`PlayerInput.target`)** statt Mausposition in der Simulation: Das UI-Widget erzeugt nur einen
  Zielwert (Ruderlage, Hebelstellung, Winkel), die Simulation bewegt die Station mit begrenzter Geschwindigkeit dorthin.
  Touch und Tastatur sind dadurch gleich stark, und der Input bleibt reine Daten fürs Netzwerk.
- **Stations-Widgets im Low-Res-HUD (Pixel-Art, Pointer-Events im Capture-Modus)**, damit ein Ziehen am Steuerrad nicht
  gleichzeitig den Touch-Stick startet. Steuerrad: ±270° Drehweg = volles Ruder; Kompass-Scheibe zeigt Weltrichtungen
  (Rollwinkel wird ausgeglichen).
- **Touch-Buttons als Pixel-Art im Spiel-Pixelraster** (Canvas-Elemente, CSS-Größe = Spielpixel × Skalierung) mit
  **Kontext-Icons** aus der Simulation (`interactionHints` liefert sprachunabhängige Icon-Schlüssel) – wichtig, weil im
  Unterricht nicht gesprochen wird.
- **Zoom-Schutz für iOS:** Safari ignoriert `user-scalable=no`. `touchstart/touchmove/touchend` werden außerhalb von
  Bereichen mit Klasse `allow-touch` (Einstellungs-Panel) per `preventDefault` blockiert, dazu `gesturestart` und `dblclick`.
  Pointer-Events (Stick, Buttons, Widgets) sind davon nicht betroffen.

## Phase 3 – Netzwerk
- **Colyseus 0.18 (`@colyseus/core` + `@colyseus/ws-transport`, Client `@colyseus/sdk`) statt des Meta-Pakets `colyseus`** –
  das Meta-Paket zieht Auth, Monitor, Playground und Redis mit, die wir nicht brauchen. API anhand der installierten
  `.d.ts`/Quellen geprüft (0.18 hat u. a. `onDrop`/`onReconnect`, automatisches Neuverbinden im SDK, `defineInput`).
- **Kein Colyseus-Schema-State, sondern eigene Snapshot-Nachrichten (msgpack).** Unser `GameState` ist schon reines JSON;
  ihn zusätzlich als Schema zu spiegeln wäre doppelte Arbeit und fehleranfällig. Colyseus' neues eingebautes
  Prediction-System (`defineInput`, `setFixedTimestep`) setzt Schema-State voraus – unser eigener Weg ist klein (zwei
  Klassen in `shared/src/net/`) und ohne Server testbar.
- **Autoritativer Server rechnet die echte Simulation (60 Hz), Snapshot alle 3 Ticks (20 Hz), komplett statt Delta.**
  ~3 KB pro Snapshot (msgpack) → ~60 KB/s pro Gerät. Bewusst einfach; Delta-Kompression/Quantisierung erst, wenn es nötig wird.
- **Zustand vollständig in `GameState`:** Controller-Interna (Luftzeit, Sprung-Puffer, Fallgeschwindigkeit,
  Plattform-Filter), Winkelgeschwindigkeit und Respawn-Punkt der Objekte, Debug-Rollwinkel und Leck-Zeiger lagen vorher im
  `Simulation`-Objekt. Jetzt kann `Simulation.loadState()` einen Server-Snapshot übernehmen und exakt weiterrechnen
  (Test: zwei Simulationen laufen nach `loadState` identisch weiter).
- **Inputs mit Sequenznummer, eine pro Tick; Server bestätigt pro Spieler die letzte angewandte (`acks`).** Der Client
  wendet eigene Inputs sofort an (Prediction), merkt sie sich und rechnet nach jedem Snapshot ab dem Server-Zustand alle
  unbestätigten neu (Reconciliation). Andere Spieler werden mit ihrem zuletzt vom Server gesehenen Input weitergerechnet
  (`prevInput` – erzeugt keine neuen Tastendrücke). Ergebnis im Test: Vorhersage und Server stimmen für denselben Tick auf
  < 2 cm überein.
- **Inputs gepackt:** 7 Tasten als Bitmaske + optionaler Analogwert (Steuerrad/Hebel) → `[ersteSeq, bits, target, …]`.
  Alles vom Netz wird validiert (`decodeInputs`, `parseCommand`, `sanitizeName`, Tuning nur bekannte Schlüssel).
- **Jitter-Puffer auf dem Server (2 Inputs) und Obergrenze (12):** Inputs kommen in Schüben (WLAN, Framerate). Läuft die
  Warteschlange leer, wartet der Server, bis wieder 2 da sind, statt jeden Tick einzeln zu „raten“ – jeder geratene Tick
  kostet den Client eine kleine Korrektur. Ohne Input für 0,25 s bleibt die Figur stehen (Tab im Hintergrund).
- **Korrekturen werden als ausklingender Versatz gezeigt** (Zeitkonstante 120 ms) statt als Sprung; Sprünge über 2 m
  (Respawn, Neustart) werden nicht geglättet.
- **Ereignisse:** Was der eigene Spieler auslöst (Sprung, Aufheben, Luke, Pumpenhub), kommt sofort aus der Vorhersage; alles
  andere aus den gesammelten Server-Events. So gibt es keine doppelten Effekte durch das Neuberechnen.
- **Raumcode = Colyseus-`roomId`** (4 Buchstaben ohne I/O, in `onCreate` gesetzt), Räume privat (nur per Code beitretbar).
- **Host = wer den Raum öffnet:** Nur der Host darf Debug- und Tuning-Befehle senden (im Klassenraum drückt sonst jemand
  dauernd L). Tuning-Änderungen verteilt der Server an alle; beim Beitreten bekommt jeder die aktuellen Werte.
- **Neuverbinden:** `onDrop` → `allowReconnection(45 s)`; die Figur bleibt halb durchsichtig an Bord. Das SDK verbindet bei
  Abbrüchen selbst neu, nach einem Neuladen der Seite hilft das Reconnection-Token in `sessionStorage`.
- **Protokoll-Version** wird beim Beitreten geprüft (`onAuth`), damit ein alter Client nach einem Server-Update eine klare
  Meldung bekommt statt seltsamer Fehler.
- **Server-Zeitmessung selbst:** Das Delta, das Colyseus an `setSimulationInterval` übergibt, war in 0.18 fast 0 (die
  Raum-Uhr wird an anderer Stelle mitgetickt) – der Server lief dadurch mit ~3 statt 60 Ticks/s. Jetzt misst der Raum die
  Zeit mit `performance.now()` und füttert den bekannten `FixedStepper`.
- **Server läuft mit `tsx` direkt aus TypeScript** (auch in Produktion): kein Build-Schritt, `shared/` wird genauso
  importiert wie im Client. Docker-Image installiert nur Server- und Shared-Abhängigkeiten (~47 MB `node_modules`).
- **Server-Adresse im Client:** `?server=` → `VITE_SERVER_URL` (Vercel) → im Dev-Modus derselbe Rechner auf Port 2567
  (damit das iPad im WLAN ohne Einstellungen mitspielen kann) → sonst kein Online-Modus.
- **Hosting-Empfehlung Fly.io mit `auto_stop_machines`, genau eine Maschine:** Räume liegen im Arbeitsspeicher, also darf
  es nur eine Instanz geben; die Maschine schläft ohne Verbindungen (bezahlt wird fast nur die Spielzeit).
- **Lobby und Menü als DOM** (nicht im Pixel-HUD): Texteingabe und iPad-Tastatur funktionieren nur mit echten
  Eingabefeldern. Profil (Name, Farbe) in `localStorage`.
- **Raumcode und Besatzung im HUD unter dem Kurs-Panel**, weil oben rechts die Menü-/Einstellungs-Knöpfe liegen.

## Phase 4 – Spielinhalt, Kommunikation, Sound
- **Binär-Snapshots mit Schema (`shared/src/net/codec.ts`):** Positionen als int16 in mm, Geschwindigkeiten /400, Winkel
  /8000, Aufzählungen als Byte, alles andere float32. Das Schema ist aus den State-Interfaces getypt (fehlt ein Feld, kompiliert
  es nicht), ein Rundreise-Test vergleicht jeden Wert. 3,5 KB → 0,8 KB pro Snapshot. Events bleiben msgpack (selten, vielgestaltig).
  Delta-Kompression bewusst nicht: Ganz-Snapshots sind robust gegen Verbindungsabbrüche und einfach.
- **Seitliche Position (`ship.lateral`) statt 2D-Seekarte in der Simulation:** Die Seitenansicht kann „neben dem Kurs“
  nicht zeigen. Felsen haben deshalb eine Querposition, das Schiff driftet mit dem Kurswinkel quer – die Seekarte (Draufsicht)
  macht das sichtbar. Felsen entstehen um die **vorausberechnete** Position bei Ankunft (aktueller Kurs), sonst wäre
  Nichtstun (Abdriften) die sicherste Strategie.
- **Entdecken durch den Scheinwerfer** (Strahl-Winkel gegen Richtung zum Felsen, Reichweite 95 m) statt automatisch: gibt
  dem Scheinwerfer eine echte Aufgabe und erzwingt Absprache Scheinwerfer ↔ Steuerrad – ohne Sprache über Seekarte und Zurufe.
- **Felsen in der Spur stehen auf dem nahen Meer, die anderen auf dem fernen Band** (kleiner, blasser): einfache Tiefe ohne
  zweite Kamera.
- **Kanone ballistisch mit eigener „Welt-Schwerkraft“ (12 m/s²)** statt der stilisierten Spieler-Schwerkraft (22): schöne
  Flugbahnen, Reichweite ~45 m. Kugeln zerstören nur Felsen in der eigenen Spur.
- **Krake als Zustandsautomat** (auftauchen → nähern → angreifen → fliehen) mit Lebenspunkten; hat er keine Planke mehr zum
  Zerbrechen, drückt er Wasser direkt ins Unterdeck – sonst wäre er nach drei Lecks harmlos.
- **Sinken ab 42 % des Rumpfvolumens** (vorher 80 %): Wasser kann nicht nach oben gedrückt werden, das Unterdeck allein ist
  47 % – mit 80 % konnte das Schiff praktisch nie sinken. Simuliert: ohne Crew sinkt es nach 3–5 Minuten.
- **Pings als `SimCommand` mit Bedeutung aus dem Ort** (Leck, Station, Luke, Meer = Gefahr, sonst „hierher“): ein Klick
  genügt, kein Auswahlmenü – wichtig auf dem iPad. Online darf jeder pingen (max. 4/s), der Server setzt die Spieler-Id.
- **Automatische Zurufe in der Simulation** (mit Abklingzeiten im State), damit sie auf allen Geräten gleich erscheinen.
- **Ankunft:** Status `arrived`, das Schiff bremst in 4 s ab und steht vor der Insel (26 m hinter dem Ziel), Kamera schwenkt
  hin, Bilanz im HUD, Neustart nach 15 s.
- **Sounds synthetisiert im Asset-Generator** (eigener kleiner Synthesizer + WAV-Encoder, deterministisch) statt
  Sound-Bibliothek oder Downloads: keine Lizenzfragen, austauschbar wie die Grafiken (Hash-Liste schützt ersetzte Dateien),
  `index.json` listet die Dateien. 22 kHz mono hält es bei ~3 MB; die Sounds werden erst nach dem ersten Tippen geladen.
- **Web Audio mit zwei Bussen** (Effekte, Ambience mit Tiefpass für „unter Deck“), Lautstärke/Pan nach Abstand zum eigenen
  Spieler. Eigene Ereignisse kommen aus der Vorhersage (sofort), fremde aus den Server-Events – keine doppelten Sounds.
- **Regen/Blitz rein im Client** (Math.random erlaubt, weil ohne Einfluss aufs Spiel); Blitz hellt über die Exposure auf.
