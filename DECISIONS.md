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
- **Seekarte wie ein Rennspiel (Feedback: „versteht man nicht direkt“):** Die gelbe Spur bleibt gerade in der Mitte, alles
  wird relativ zur Linie in der aktuellen Fahrtrichtung gezeichnet; Lenken lässt die Felsen seitlich wandern. Dazu
  „< LENKEN / LENKEN >“, „KURS FREI“, „NICHTS GESICHTET“ und am Steuerrad eine Legende. Vorher: absolute Draufsicht mit
  kleinen Strichen und „rot“ relativ zur momentanen Querposition – zu abstrakt. Ein erster Versuch mit einer gekrümmten,
  vorausberechneten Bahn (Ruder + Strömung über 50 s) lief sofort aus dem Bild. Die Strömung ist jetzt halb so stark
  (Steuern soll nötig, aber keine Daueraufgabe sein); `shared/src/navigation.ts` rechnet Spur und Gefahr für Karte,
  Felsen-Platzierung und den „Ruder!“-Zuruf gleich.

## Phase 5 – Mehr zu tun an Bord
- **Gefahren-Logik als Systeme (`shared/src/systems/*`)** statt weiter in `simulation.ts`: reine Funktionen über ein
  `SimContext`-Interface, das `Simulation` implementiert (emit, say, rand, leakAt, …). Neue Begegnungen sind so eigene
  Module; `simulation.ts` bleibt bei Spielern, Physik und Wasser.
- **Kisten haben Inhalt, ausgewürfelt beim Erzeugen** (seeded RNG im State) statt beim Öffnen: Alle Geräte sehen dasselbe,
  und die Vorhersage kann das Öffnen exakt nachrechnen. 1–3 Dinge aus einer gewichteten Tabelle (`systems/crates.ts`);
  eine Ratte kommt allein und frisst ein Stück Holz.
- **Werkzeuge gelten für die ganze Crew** (Hammer = schneller flicken, Brecheisen = schneller öffnen) statt als
  Trage-Gegenstände: man trägt ohnehin schon Planken, ein zweiter Slot wäre auf dem iPad unhandlich.
- **Planken sind jetzt eine Ressource:** Die Werkbank ist eine Station, an der man (wie an der Pumpe) hin und her sägt;
  jede Planke kostet ein Holz aus dem Vorrat (Start 6). Holz gibt es in Kisten und durch Zerlegen leerer Kisten an der
  Werkbank. Vorher gab es unbegrenzt Planken per Knopfdruck – Lecks waren nur eine Laufaufgabe.
- **Kanone laden:** Nach dem Schuss ist sie leer (`charge` 0). Allein lädt der Kanonier langsam selbst (3,2 s); ein
  Helfer holt eine Kugel am Kugelgestell, lädt sie (E) und stopft sie fest (kurze Aktion) – das geht schneller und der
  Kanonier kann dabei weiter zielen. Allein spielbar, zu zweit besser.
- **Scheinwerfer verbrennt Öl** (Tank reicht ~3 min), flackert bei Reserve, geht dann aus; Nachfüllen mit der Ölkanne,
  die Kanne am Ölfass auffüllen. Gibt dem Laufen zwischen den Decks einen weiteren Grund.
- Pumpen-Verschleiß aus dem Plan bewusst weggelassen: Die Pumpe ist schon die anstrengendste Station, eine Zwangspause
  hätte nur genervt.
- Für Aktionen, die etwas Getragenes benutzen (Öl abfüllen, Kugel laden), haben Vorrang vor Luken in der Nähe – sonst
  schnappt die Luke über dem Fass den Tastendruck weg.
- **Begegnungs-Tabelle statt fester Krake:** Alle ~240 m (±25 %) wird aus gewichteten Einträgen gezogen (Krake,
  Piraten, Eisfeld, Strudel, Treibgut; Gewichte in `tuning.json`, später pro Biom/Modifier überschrieben). Nur eine große
  Begegnung gleichzeitig (Krake/Piraten/Strudel), Eis und Treibgut dürfen dazukommen.
- **Feuer brennt auf Böden** (Luft-Tile mit Festem darunter) und wandert seitlich weiter: so bleibt es auf Decks und
  klettert nicht durch Wände. Wasser im Raum löscht es (Fluten als Notlösung), Regen auf dem offenen Deck langsam. Langes
  Feuer neben dem Rumpf brennt ein Leck, neben der Werkbank Holz weg; wer hineinläuft, wird weggeschleudert.
- **Eimer statt Feuerlöscher:** schöpfen im gefluteten Raum (nimmt dort Wasser weg) oder über die Reling, ausschütten
  löscht – oder kippt das Wasser dorthin, wo man steht (über Bord = weg). Der Eimer ist damit auch eine Lenzhilfe.
- **Piraten fahren vor dem Bug im nahen Meer** statt daneben im fernen Band: so trifft die vorhandene ballistische Kanone
  sie ohne zweite Zielachse. Ihre Kugeln sind echte Flugbahnen auf das Deck (Treffer auf Rumpf neben Leckstelle = Leck,
  sonst Feuer). Der Enterhaken bremst das Schiff auf 45 %, bis jemand ihn am Bug kappt. Besiegte Piraten werfen Ladung
  über Bord (Treibgut).
- **Treibgut fischt man vom offenen Deck**, wenn es in der eigenen Spur längsseits treibt: das einzige Ziel, auf das man
  zusteuern will statt auszuweichen.
- **Mann über Bord mit Rettungsring:** Allein bleibt der kurze Respawn-Timer; ist noch jemand an Bord (und das Schiff hat
  einen Rettungsring), wartet der Schwimmer bis zu 30 s. Der Ring ist eine Station: zielen und werfen (F), Schwimmer
  greift zu, dann Hand über Hand einholen (links/rechts wie die Pumpe). Die Leine ist 22 m lang, das Schiff zieht den Ring
  mit.
- **Brecher und Blitze nur im Sturm** (Seegang ≥ 1,0), mit 2 s Vorwarnung und Zuruf „Welle!“: Wer auf dem offenen Deck
  steht und sich nicht an einer Station festhält, wird Richtung Heck geschleudert – über die Heckwand heißt Mann über Bord.

## Phase 6 – Kampagne, Hafen, Upgrades, Modifikatoren, Rollen
- **Kampagne als Routen-Graph** (`shared/src/campaign.ts`): 6 Spalten = 6 Etappen, 2–3 Wahlmöglichkeiten pro Spalte, die
  letzte Etappe ist immer die Sturmfront vor dem Leuchtturm. Jede Etappe ist eine kürzere Fahrt (560–1000 m) mit einem
  Biom, das die Begegnungs-Gewichte und das Wetter verschiebt. Alles hängt am Seed: Server und jeder Client leiten daraus
  dasselbe ab.
- **Effektives Tuning wird berechnet statt gespeichert:** `base (tune-Befehle) ⊕ Modifikatoren ⊕ Biom ⊕ Upgrades`
  (`effectiveTuning`). Die Simulation rechnet es bei jedem neuen Leg, Kauf, Tune-Befehl und `loadState` neu – so muss nichts
  davon im Snapshot stehen und die Vorhersage nutzt automatisch dieselben Zahlen. Der Tuning-Regler bearbeitet die Basis.
- **Modifikatoren und Upgrades als kleine Funktionen** auf dem Tuning (statt reiner JSON-Daten): Viele sind Faktoren
  („× 1,35 Pumpenhub“), das ist als Code lesbarer und typgeprüft. Neue Tuning-Schlüssel nur, wo es vorher keinen Regler gab
  (`bilgeRate`, `hullArmor`, `rewardFactor`, Rollen-Faktoren).
- **Hafen an Bord statt eigenem Menü:** Status `harbor`, das Schiff liegt still vor einer Kaimauer. Die Route wählt, wer am
  Kartentisch steht (A/D oder auf die Karte zeigen, F = sofort ablegen); ohne Wahl legt das Schiff nach 60 s mit der
  ersten Möglichkeit ab. Kein Abstimmungssystem – ohne Sprache wäre eine Abstimmung schwer zu verstehen, und der Tisch ist
  ein Ort, an den man zeigen (pingen) kann. Der Händler sind drei Stände auf dem Oberdeck (Kiste + Symbol + Preis), gekauft
  wird mit E – wie jede andere Interaktion.
- **Was weitergeht:** Münzen, Holz, Werkzeug, Upgrades und alle Statistiken. Was neu ist: Rumpf (Hafenarbeiter flicken
  und lenzen), Kisten (neu gepackt), Gefahren. Holz wird im Hafen auf den Startwert aufgefüllt – sonst reicht es nach
  zwei Etappen nicht mehr (Balance-Lauf: 4–8 Lecks pro Etappe).
- **Gesunken = neuer Lauf** (Roguelite), in der Kampagne mit neuem Seed, die Tagesfahrt mit demselben (nochmal versuchen).
- **Tagesfahrt:** Seed aus dem UTC-Datum, zwei Modifikatoren. Online wählt der Server den Seed (gleicher Tag für alle Räume).
  Bestleistungen nur lokal (`localStorage`) – kein Server-Speicher, kostet nichts. Eine globale Rangliste wäre mit
  Supabase möglich (Tabelle Tag/Crew/Etappen/Münzen, Eintrag vom Server), ist aber bewusst noch nicht eingebaut.
- **Rollen sind kleine Boni** (Faktor 0,6–1,3) an einer Station, kein Muss: Jede Station bleibt für alle bedienbar. Die
  Rolle steht als Buchstabe am Namensschild.
- **Balance-Skript** (`npx tsx scripts/balance.ts [seeds] [good|average|slow]`): eine Bot-Crew mit Reaktionszeiten. Ergebnis
  (8 Seeds, Etappe 3): alle Biome überlebbar, Riff und Krakengrund mit den meisten Lecks (≈8), Ruhige See ≈2–4. Die Bots
  pumpen dauerhaft – echte Crews sind schwächer verteilt, deshalb wurde nichts härter gemacht.

## Phase 7 – Stationen als 2.5D-Diorama
- **Eigene 2.5D-Schicht in Pixi statt Three.js** („2D-Sprites im 3D-Raum“): `Camera25` (Orbit-Kamera mit Yaw, Pitch,
  Dolly, Roll) projiziert Punkte in Schiffskoordinaten mit Tiefe; jede Karte ist eine Pixi-`PerspectiveMesh` mit
  perspektivisch korrekten UVs. Die Karten liegen in denselben Render-Passes wie alles andere (Albedo, Normal, Maske,
  Unlit) – Licht, Normal Maps, posterisiertes Licht, Dither und Nebel gelten unverändert. Kein zweiter WebGL-Kontext, keine
  neue Abhängigkeit.
- **Unsichtbarer Schnitt:** Die Kamera startet bei Yaw = Pitch = 0 mit 16 px/m genau dort, wo das Ziel im 2D-Bild steht,
  und mit dem Rollwinkel des Schiffs – die Ebene z = 0 deckt sich dann pixelgenau mit dem 2D-Bild. Danach Dolly + Schwenk
  in 0,65 s; das 2D-Schiff wird dabei ausgeblendet (Überblendung statt hartem Wechsel, weil der Raum nur einen Ausschnitt
  zeigt). Das Meer bleibt der 2D-Weltlayer dahinter.
- **Das Set wird aus dem Layout gebaut** (funktioniert damit auch für Schiffe aus dem Editor): Ausschnitt der Rückwand-
  Grafik bei z = −1,6, Dielen als liegende Karten, Decke, und innen der Ausschnitt der Rumpf-Grafik als offene
  „Puppenhaus-Front“ bei z = +1,3. Der Ausschnitt reicht nur so weit wie der begehbare Boden (Wände, Rand des Mastkorbs).
  An Deck keine Front (sie stand vor der Kanone), dafür die ferne Reling getönt hinten.
- **Spieler auf Tiefenspuren:** Wer die Station bedient, steht auf ihrer Bedienspur; alle anderen laufen je nach
  Blickrichtung vor (z = +0,85) oder hinter (z = −0,85) der Station, mit weichem Übergang. Figuren und Requisiten sind
  Billboards (zur Kamera gedreht), damit die Seitenansicht-Sprites nicht flach wirken.
- **Schatten als planare Projektion** jeder Karte vom Hauptlicht (Laterne des Raums, sonst die Szenenlampe) auf den Boden,
  begrenzt durch die Rückwand: eine schwarze, halbtransparente Kopie derselben Textur. Billig, pixelig, bewegt sich mit
  der schwingenden Laterne.
- **Licht im Diorama:** Die Schiffslichter (Sichtbarkeits-Polygone gegen Tiles) passen nicht zu den projizierten
  Positionen; während der Ansicht sind sie aus, stattdessen bis zu vier unverdeckte Weltlichter an projizierten Punkten
  (Laterne, Kerze, Scheinwerferkegel, ein warmes Fülllicht in dunklen Räumen).
- **Bedienen direkt am Requisit:** Das bestehende Stations-Widget übernimmt die Eingabe, nur sein Mittelpunkt und Radius
  kommen aus der Projektion (Radnabe, Hebeldrehpunkt, Säge). Damit bleibt die Simulation unberührt; Tastatur geht wie
  vorher. Am Kartentisch bleibt die Routenkarte zusätzlich flach eingeblendet – schräg auf dem Tisch ist sie nicht lesbar.
- **Seekarte und Routenkarte als Render-Textur** auf Karten im Set (Pinnwand neben dem Rad, Pergament auf dem Tisch).
- **Kiste öffnen** bekommt ein eigenes Set (Kamera schräg von oben): Brecheisen, Deckel am Scharnier, Stroh, Beute steigt
  auf; die Popups mit den Namen werden in die Szene projiziert. Jeder Druck auf A/D (Brecheisen) beschleunigt das Öffnen
  – so hat die Interaktion auch auf dem iPad etwas zu tun.
- Abschaltbar im Menü („Stationen in 3D“) und bei Qualitätsstufe *low* immer aus; `?stage3d=0` für Tests.

## Phase 8 – Schiffs-Editor
- **Ein Schiff ist nur seine ASCII-Karte** (+ Name). Alles andere – Kollision, Licht, Leitern, Kompartimente, Leckstellen,
  Diorama-Sets – leitet `parseLayout` schon daraus ab. Die Wasserlinie (`origin`) wird aus dem Volumen geschätzt, damit
  niemand sie von Hand setzen muss.
- **Prüfung statt Verbot:** Der Editor lässt alles zu und zeigt Fehler (Rumpf undicht, Steuerrad/Pumpe/Werkbank/Startplatz
  fehlt, Station nicht erreichbar, keine Leckstelle) und Warnungen (keine Kanone/kein Scheinwerfer) mit markierten Feldern.
  Probefahrt und „Als mein Schiff“ gehen nur ohne Fehler; der Server prüft dasselbe noch einmal und fällt sonst auf das
  Standard-Schiff zurück.
- **Kein Server-Speicher:** Schiffe liegen im `localStorage` und reisen als Code (Lauflänge + base64url) im Link
  (`?ship=…`). Kostenlos, kein Konto, kein Moderationsproblem. Eine Online-Galerie wäre später über Supabase möglich.
- **Online:** Wer einen Raum erstellt, gibt den Code seines Schiffs mit. Der Server baut die Simulation damit und schickt
  den Code in der Begrüßung mit; hat ein Beitretender ein anderes Schiff geladen, lädt die Seite mit dem Schiff des Raums neu
  und tritt mit dem Reconnect-Token wieder bei. Der Codec ist ohnehin layout-unabhängig.
- **Rumpfgrafik zur Laufzeit:** Die Zeichenfunktionen des Asset-Generators sind reine Pixelpuffer und liegen jetzt in
  `client/src/render/procedural/`; der Generator importiert sie von dort. Das Standard-Schiff nutzt weiter die
  (eventuell handgemalten) PNGs, eigene Schiffe bekommen generierte Texturen.
- **Bug und Heck kommen aus dem Layout** (`hullEnds`): Felsen-Abstand, Krake, Piraten-Schaluppe, Treibgut und die
  Händler-Stände richten sich nach der Schiffslänge. Für das Standard-Schiff ändert sich nichts.
- Grenzen: 24–96 × 12–32 Felder, Name bis 24 Zeichen. Upgrade-Slots aus dem Plan (`+`) sind entfallen – alle Upgrades
  wirken als Tuning-Werte und brauchen keinen Platz im Schiff.

## Nachgeholt nach Phase 8
- **Ladung los:** Kisten und Fässer starten festgezurrt (feste Physik-Körper). Ab 11° Krängung können Zurrings reißen
  (Wahrscheinlichkeit wächst mit der Neigung); lose Ladung ist wieder ein normaler Körper. Ihr Einfluss auf die
  Schlagseite wird wie Wasser gerechnet, aber **relativ zum Stauplatz** (Gewicht × Verschiebung) – sonst hätte das
  Standard-Schiff schon ohne losgerissene Ladung Schlagseite. Festzurren geht an jedem Ladeplatz (Kisten-/Fass-Marker
  der Karte) statt an eigenen Zurr-Haken (`g`): funktioniert so automatisch für Editor-Schiffe und braucht keine neue
  Grafik. Wer eine festgezurrte Kiste aufhebt, bindet sie los; geöffnet wird sie auch festgezurrt. Balance mit Bot-Crew:
  ruhige See ~0, Sturm ~3, Riff (Felsentreffer) ~6 losgerissene Teile pro Etappe.
- **Strudel zu zweit:** Das Steuerrad hat einen Helfer-Platz (`StationState.helper`). Mit Helfer wirkt nur 45 % des Sogs;
  beide können drehen. Verlässt der Steuermann das Rad, übernimmt der Helfer. Allein ruft der Steuermann um Hilfe.
- **Pumpen-Verschleiß:** Hitze (in `charge` der Pumpe) steigt pro Hub und kühlt ständig ab. Über 80 % schaffen die Hübe nur
  noch 45 % – eine weiche Grenze statt einer Sperre, damit es nicht nervt. Etwa 30 s Dauerpumpen im schnellen Takt bis
  „heiß“, wenige Sekunden Pause zum Abkühlen. Der Maschinist erzeugt keine Hitze.
- **Routenwahl als Abstimmung:** Jede Person stimmt am Kartentisch ab (wer an den Tisch tritt, stimmt für die angezeigte
  Etappe; ein zweiter Platz „Mitwählen“ erlaubt zwei gleichzeitig). Die Etappe mit den meisten Stimmen der anwesenden
  Spieler gilt; Gleichstand entscheidet der Seed des Laufs (auf allen Rechnern gleich, ohne Zufallszahl zu verbrauchen).
  Haben alle gewählt, legt das Schiff nach 10 s ab; F („Ablegen“) wirkt erst, wenn alle gewählt haben (allein sofort).
- **Upgrades, die man sieht:** statt der gestrichenen `+`-Slots optionale Marker in der Karte: `C` (zweite Kanone) und
  `L` (Laterne). Die Station existiert immer im State (`optional`), ist aber erst nach dem Kauf sichtbar und bedienbar –
  so bleibt die Stationsliste über den ganzen Lauf gleich (Client-Ansichten und Codec hängen an den Indizes). Angeboten
  werden die Upgrades nur, wenn das Schiff einen Platz dafür hat (Editor-Schiffe ohne `C`/`L` sehen sie nie).
- **Proviantkiste:** ein Verbrauchs-Angebot im Hafen; die Hafenarbeiter stellen eine volle Kiste an den Stand.
- **Ergebnis teilen:** Am Ende einer Kampagne/Tagesfahrt erscheint eine Karte mit Text und „Ergebnis teilen“ (Web Share
  API, sonst Zwischenablage). Weiterhin keine Online-Rangliste.
- **Kiste als Behälter:** Eine geöffnete Kiste nimmt bis zu 4 Planken, Kugeln oder leere Eimer auf (`contents` wird
  wiederverwendet); getragen reisen sie mit. Wird die Kiste an der Werkbank zerlegt, fällt der Inhalt heraus.
- **Öl zapfen** ist jetzt eine kurze Aktion (1,6 s, A/D beschleunigt) statt sofort – damit es eine Nahansicht wie das
  Kistenöffnen bekommt: Fass mit Zapfhahn, Öl läuft in die Kanne. Gegenstände direkt neben Kiste/Fass werden in dieser
  Nahansicht ausgeblendet, damit nichts vor der Kamera steht.
- **Stationsposen von vorne:** In der 2.5D-Ansicht steht die Station zwischen Kamera und Figur – die Figur blickt also zur
  Kamera. Statt „von hinten“-Sprites gibt es deshalb Front-Sprites (gleiche Farben, Mantel-Ebene zum Einfärben) mit Armen
  vom Schultergelenk zu frei gesetzten Händen. Die Pumpen-Pose folgt dem Hebel, die anderen laufen nur, während die Station
  sich bewegt. Das Manometer der Pumpe hängt jetzt an der Wand dahinter (es verdeckte das Gesicht).
- **Werft-Zoom:** Mausrad, Knöpfe oder zwei Finger zoomen um den Punkt unter dem Zeiger; ein zweiter Finger bricht den
  gerade begonnenen Strich ab (Rückgängig), damit Pinch-Zoom nichts übermalt. Der Rahmen scrollt (`margin: auto` statt
  Flex-Zentrierung, sonst wären linke/obere Ränder unerreichbar).
- **Schiffswahl in der Lobby:** Auswahl aus Standard + gespeicherten Schiffen; ein anderes Schiff lädt die Seite neu, weil
  die Rumpfgrafik beim Start gezeichnet wird.
- **Ganzes Schiff in 2.5D (`stage/ShipSet.ts`):** Die festen Kacheln des Grundrisses werden von der Rückwand bis zur offenen
  Front extrudiert (Böden/Decken/Wände als Flächen, Rumpfgrafik als Schnittkante vorne, Hintergrundgrafik hinten). Weil
  alles dieselbe Tiefe hat, lässt sich exakt sortieren: zuerst weit weg von der Augenhöhe, dann weit weg von der
  Augen-Spalte; die Front zuletzt. Dinge im Stationsraum sortieren dazwischen nach Tiefe (`ROOM_BAND`), alles in anderen
  Räumen bekommt die Gitter-Reihenfolge und wird so von Böden/Wänden verdeckt. Große Karten werden in Zellen zerlegt, damit
  eine Zelle hinter der Kamera nicht die ganze Karte (früher: den Boden) verschwinden lässt. Das Meer hängt als Vorhang
  hinter dem Schiff – vorne bleibt es offen wie der 2D-Querschnitt.
- **Ziehen relativ statt absolut:** Säge, Hebel, Leine und Kurbel merken sich beim Greifen Wert und Zeigerposition und folgen
  dann 1:1 (gleicher Pixelmaßstab wie die Anzeige); die Simulation begrenzt weiterhin die Geschwindigkeit.
- **Scheinwerfer in 2.5D per Kurbel** (4:1 übersetzt), weil das Zeigen auf die Lampe in der Nahansicht unklar war. In 2D
  bleibt das Zeigen auf die Skala.
- **Zielhilfen (`ui/AimAids.ts`):** Die 2.5D-Szene zeigt das Meer ums Schiff nicht passend, daher Peilungs-Ring um
  Rohr/Lampe statt Markierungen am Ort; in 2D Markierungen am Ziel bzw. Pfeile am Rand.
- **Leuchtturm hinter dem Schiff:** Lichter mit `behindShip` werden im Licht-Shader dort verworfen, wo die Maske Schiff zeigt.
- **2D-Ebenen:** Spieler liegen jetzt vor der Rumpfgrafik (Geländer im Krähennest schnitt sonst durch die Figur).
- **Rettungsring bleibt 2D:** Fangen braucht den weiten Blick übers Meer; die Kamera rückt dafür ~1/3 Bildbreite hinter
  das Heck, die Bedienung sitzt rechts unten. Schwimmer bleiben in einer Rettungszone (`rescueZone()`: bis Leinenlänge − 2 m
  hinter dem Heck) und fallen mit `swimDrift` zurück – sonst zog das Schiff mit voller Fahrt davon.
- **Kurze Eingaben:** Richtungstasten werden wie Sprung/E/F bis zum nächsten Tick gehalten, der Ziel-Wert eines Fingertipps
  ebenfalls (Kartentisch: Antippen der Etappe).
- **Kanone ebenfalls 2D**, Kamera ~1/3 Bildbreite zur Schussseite (Bug), Bedienung links unten.
- **Stärke als zweite Achse:** `StationState.power` (0..1) und `PlayerInput.target2` (Protokoll v5: je Tick Bits, target,
  target2). Startgeschwindigkeit = `ballSpeed`/`ringSpeed` × (`powerMin` + (1 − `powerMin`) × power); Treffer und Schaden
  hängen nicht davon ab. Ziehen ist relativ: seitlich `AIM_RAD_PER_PX` rad/px (nach rechts = im Uhrzeigersinn wie D),
  50 px hoch/runter = volle Stärke.
- **Deko-Schalter in Schiffen:** `ShipDesign.decorOff` (Kacheln, rein optisch; die Simulation ignoriert sie). Link-Code
  Version 2 hängt sie hinter den Namen; ohne Schalter bleibt es Version 1, alte Codes ändern sich nicht. Ein Schalter auf der
  Mastspalte über dem Deck nimmt den Mast (samt Krähennest-Gitter) weg, einer auf dem Deck oder direkt darüber die Reling an
  dieser Spalte. Krähennest = Luke über dem Deck mit freier Luft darunter; Masten werden nicht durch Innenräume gezeichnet.
  Beim unveränderten Standard-Grundriss gilt weiter die handgemalte Grafik.
