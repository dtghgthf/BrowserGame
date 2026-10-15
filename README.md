# Leuchtturmwärter (Arbeitstitel)

Koop-Browserspiel für 2–4 Spieler: Die Crew steuert ein Schiff durch einen nebligen, nächtlichen Ozean.
Das Schiff ist ein Querschnitt mit drei Decks; man läuft zu Stationen (Steuerrad, Scheinwerfer, Pumpe,
Werkstatt, Kanone) und hält das Schiff zusammen weiter.

**Stand: Phase 1 (spielbares Schiff, lokal) + Phase 2 (Look) sind umgesetzt.** Netzwerk kommt in Phase 3.

![Scheinwerfer im Nebel](screenshots/chromium-07-scheinwerfer-nebel.png)

| Oberdeck | Unterdeck mit Leck | Laternenlicht |
|---|---|---|
| ![](screenshots/chromium-01-oberdeck.png) | ![](screenshots/chromium-02-unterdeck-leck.png) | ![](screenshots/chromium-04-licht-mitteldeck.png) |
| **Debug-Overlay (F3)** | **Normal-Buffer (F7)** | **Touch (iPad-Viewport)** |
| ![](screenshots/chromium-03-debug-overlay.png) | ![](screenshots/chromium-05-normal-buffer.png) | ![](screenshots/chromium-08-touch-ipad.png) |
| **Steuerrad zum Drehen** | **Einstellungen (F9)** | |
| ![](screenshots/chromium-09-steuerrad-widget.png) | ![](screenshots/chromium-10-einstellungen.png) | |

---

## Start

Voraussetzung: Node.js 22 oder neuer.

```bash
npm install
npm run dev          # Dev-Server auf http://localhost:5173 (auch im WLAN erreichbar)
```

- **iPad / Handy testen:** Rechner und Gerät ins gleiche WLAN, auf dem Gerät `http://<IP-deines-Rechners>:5173` öffnen
  (die IP zeigt Vite beim Start unter „Network“ an).
- **Produktions-Build:** `npm run build`, dann `npm run preview` (Port 4173). Der Ordner `client/dist/` ist eine rein
  statische Seite und kann auf jedem Webspace / GitHub Pages / Netlify liegen.

Weitere Befehle:

| Befehl | Was es tut |
|---|---|
| `npm test` | Vitest für `shared/` (Simulation) und `client/` (Licht-Polygone, Pixel-Skalierung, Input) |
| `npm run typecheck` | `tsc --noEmit` für alle Pakete (`shared/` ohne DOM-Typen!) |
| `npm run build` | Typecheck + Vite-Build des Clients |
| `npm run assets` | Platzhalter-Grafiken neu erzeugen (von dir ersetzte Dateien bleiben erhalten) |
| `npm run verify` | Playwright: Dev-Server starten, Szenen-Screenshots nach `screenshots/`, Konsole prüfen, FPS messen |

### URL-Parameter (praktisch zum Testen, auch auf dem iPad ohne F-Tasten)

| Parameter | Wirkung |
|---|---|
| `?debug` | Debug-Overlay direkt an |
| `?p2` | zweiter lokaler Spieler direkt an |
| `?quality=high\|medium\|low` | Grafikstufe erzwingen (sonst automatisch, siehe unten) |
| `?sea=0.3` | Seegang (0 = Flaute, 0,75 = Standard, 1,3 = Sturm) |
| `?seed=42` | Zufalls-Seed der Simulation |
| `?tune` | Einstellungs-Panel direkt öffnen (auch im Produktions-Build) |
| `?h=300` | andere Ziel-Höhe der internen Auflösung |

---

## Steuerung

| Aktion | Tastatur (Spieler 1) | Spieler 2 (F2) | Touch |
|---|---|---|---|
| Laufen | A / D | ← / → | Stick links/rechts |
| Leiter rauf/runter | W / S | ↑ / ↓ | Stick hoch/runter |
| Springen | Leertaste | Shift rechts / Num 0 | Button ⤒ |
| Station betreten/verlassen, Luke öffnen/schließen, Leck reparieren, Planke holen | E | Enter / Num 1 | Button E |
| Objekt aufheben/ablegen, Planke an der Werkbank nehmen | F | Strg rechts / Num 2 / . | Button F |

Allein spielend steuern auch die Pfeiltasten Spieler 1.

**Stationen** (E): An jeder Station erscheint unten ein großes Bedienelement, das man mit Maus oder Finger benutzt
(oder weiter mit A/D):
- **Steuerrad:** am Rad entlang ziehen und drehen (±270°, die Messing-Speiche oben = Ruder mittig). Darunter Ruderlage und
  Kursabweichung (grün = auf Kurs).
- **Pumpe:** den Hebel rauf und runter ziehen (oder A und D **im Wechsel**). Jeder volle Hub pumpt Wasser ab.
- **Scheinwerfer:** auf der Kompass-Scheibe in die Richtung zeigen, in die der Kegel leuchten soll. Das Rollen des Schiffs
  wird ausgeglichen, solange man festhält.
- **Kanone:** zielen wie beim Scheinwerfer (Feuern kommt später).

E oder Leertaste verlässt die Station. Auf Touch-Geräten zeigen die Buttons E und F als Icon, was sie gerade tun würden
(Steuerrad, Pumpe, Luke, Hammer, Planke, Aufheben …). Ist ein Button grau, gibt es dort gerade nichts zu tun.

**Debug-Tasten**

| Taste | Wirkung |
|---|---|
| F3 | Debug-Overlay: FPS, Rapier-Collider, Leiter-Zonen, Schwerkraftvektor, Wasserstände/-flächen, Licht-Polygone |
| F7 | Zwischenbuffer anzeigen: Bild → Albedo → Normalen → Licht → Maske |
| L | Test-Leck erzeugen (abwechselnd Heck/Bug) |
| [ / ] | Seegang verringern / erhöhen |
| F4 | Rollwinkel fixieren (aus → +15° → −15° → +8°) – gut zum Testen des Rutschens |
| F6 | Nebel an/aus |
| F2 | zweiten lokalen Spieler hinzufügen/entfernen |
| F8 | Neustart |
| F9 | Einstellungen (auch über ⚙ oben rechts im Dev-Server) |

### Einmal durchspielen (Testablauf)
1. **L** drücken → „LECK!“, die nächste Figur ruft per Sprechblase, im Unterdeck spritzt Wasser herein.
2. Wasser sammelt sich auf der tiefen Seite, Schlagseite und Tiefgang nehmen zu (HUD links oben: „UD“ und „NEIGUNG“).
3. Leiter runter zur **Pumpe** (Unterdeck, Heck), E, dann A/D im Wechsel → Wasserstand sinkt.
4. Zur **Werkbank** (Mitteldeck), F → Planke in den Händen (man wird langsamer).
5. Zum Leck, E → Reparatur-Balken; danach ist das Loch geflickt und es läuft kein Wasser mehr nach.
6. Läuft der Rumpf zu 80 % voll, sinkt das Schiff und das Spiel startet nach 5 s neu.

---

## Werte live einstellen (F9 / ⚙)

Das Einstellungs-Panel ändert Spiel- und Grafikwerte **während des Spiels**: Helligkeit, Gamma, Mondlicht, Grundlicht unter
Deck, Laternen, Scheinwerfer, Nebel, Licht-Stufen, Laufgeschwindigkeit, Beschleunigung, Sprungkraft, Schwerkraft, Rutschen,
Seegang, Rollverhalten, Leck-Einstrom, Pumpe und mehr.

- Geänderte Werte werden **gold** markiert, ↺ setzt einen Wert zurück.
- Änderungen merkt sich das Gerät (localStorage), auch nach dem Neuladen.
- **„Als Standard speichern“** schreibt alle Werte über den Dev-Server (`npm run dev`) in
  `shared/src/tuning.json` (Spielwerte) und `client/src/look.json` (Grafik). Die Seite lädt dann mit den neuen
  Standardwerten neu – committen, fertig. Das funktioniert auch vom iPad aus, wenn es per WLAN auf den Dev-Server zugreift.
- Ohne Dev-Server (Produktions-Build) gibt es stattdessen „JSON kopieren“.
- Die Spielwerte laufen als Befehl durch die Simulation (`{ type: 'tune' }`) – in Phase 3 kann der Server sie genauso
  übernehmen, damit alle Geräte mit denselben Werten spielen.

---

## Projektstruktur

```
shared/   Simulation: Physik (Rapier2D), Regeln, State – kein DOM, kein Rendering
  src/layout/shipMap.ts      das Schiff als ASCII-Karte (hier umbauen!)
  src/tuning.json            alle Spielwerte (vom Einstellungs-Panel gespeichert)
  src/layout/parseLayout.ts  leitet Collider, Licht-Occluder, Leitern, Luken, Wasserräume ab
  src/simulation.ts          Simulation-Klasse: sim.step(inputs, dt, commands) → sim.state
  src/ship.ts, sea.ts        Wellenfunktion, Rollen/Heave, rotierte Schwerkraft
  src/water.ts               Wasser pro Kompartiment (Füllstand, Neigung, Fluss durch Luken)
  src/fixedStepper.ts        fester 60-Hz-Timestep mit Accumulator
client/   Rendering (PixiJS v8), Input, HUD
  src/render/GameRenderer.ts Low-Res-Pässe + Upscaling
  src/render/lighting/       Sichtbarkeits-Polygone + Light-System
  src/render/shaders.ts      alle GLSL-Shader (Licht, Composite/Nebel, Meer, Rumpfwasser)
  src/render/ShipView.ts     alles auf dem Schiff (inkl. schwingender Laternen als Deko-Physik)
  src/look.json              Grafikwerte: Helligkeit, Licht, Nebel (vom Einstellungs-Panel gespeichert)
  src/ui/StationWidget.ts    Steuerrad, Pumpenhebel, Kompass-Scheibe
  src/ui/TuningPanel.ts      Einstellungs-Panel (F9)
  public/assets/             Platzhalter-Grafiken (+ README zum Austausch gegen Aseprite-Exporte)
server/   leer – Phase 3 (Colyseus)
scripts/  Asset-Generator, Browser-Verifikation
```

Wichtige Prinzipien: Die Simulation bekommt nur **Inputs als Daten** und gibt **State als Daten** heraus. Das Schiff ist
kein Physik-Body: Innen wird im Schiffs-Koordinatensystem simuliert und stattdessen die **Schwerkraft gegen den Rollwinkel
gedreht**. Beim Rendern dreht sich der Schiffs-Container, das Meer liegt im Weltkoordinatensystem. Alle Entscheidungen mit
Begründung stehen in [`DECISIONS.md`](DECISIONS.md), der Arbeitsplan in [`PLAN.md`](PLAN.md).

---

## Was fertig ist

**Phase 1 – spielbares Schiff**
- Schiff mit 3 Decks + Mastkorb, 4 Leitern, 5 Luken (davon eine Frachtluke ohne Leiter), Schotten mit Türen
- Wellen (Summe von 4 Sinuswellen) → Rollen bis ±15° + Heave; Schwerkraft im Schiffs-Frame rotiert, Heave-Beschleunigung
  verändert das Gewicht
- Spieler: Laufen, Springen (Coyote-Time + Sprung-Puffer), Klettern, durch offene Luken klettern/fallen, Tragen (verlangsamt),
  Schwimmen bei hohem Wasserstand, Mann-über-Bord mit Respawn
- Spürbares, aber steuerbares Rutschen bei Schlagseite (bei 15° ca. 1,8 m/s Drift, Laufen 5,6 m/s)
- Kisten, Fässer, Planken rutschen und kippen, schwimmen auf Wasser
- Stationen: Steuerrad (Kurs + Rollverhalten + Krängung), Pumpe, Scheinwerfer, Werkstatt, Kanone (nur Zielen)
- Test-Leck (L), Einstrom abhängig von der Tiefe unter der echten Wasserlinie, Reparatur mit Planke
- Wasser pro Kompartiment, neigt sich (mit Schwappen), fließt durch offene Luken, erzeugt Schlagseite und Tiefgang;
  Sinken → Neustart
- Kamera folgt sanft und pixelgenau; HUD mit Kurs, Wasserständen, Neigung, Stations-UI, Kontext-Hinweisen
- Automatische Sprechblasen („Leck!“, „Planke nötig!“) als Basis für Kommunikation ohne Sprache
- Lokaler 2-Spieler-Modus (F2), Touch-Steuerung, Debug-Overlay (F3)

**Phase 2 – Look**
- Interne Auflösung ~480×270, ganzzahlig mit Nearest-Neighbor hochskaliert
- Lighting-Pipeline: Albedo-, Normalen-, Masken-, Licht- und Composite-Pass; Sichtbarkeits-Polygone gegen die Schiffswände,
  Normal Maps (`x.png` + `x_n.png`), posterisiertes Licht mit Bayer-Dithering (bleibt pixelig)
- 5 schwingende Laternen (Pendel-Deko-Physik im Client, folgen der Schräglage) mit Flackern und harten Schatten
- Scheinwerfer im Mastkorb mit Kegel, hellt Nebel und Takelage auf
- Animierter Pixel-Nebel (Value-Noise, quantisiert), wird vom Licht-Buffer aufgehellt; Mond, Sterne, Leuchtturm mit
  rotierendem Strahl am Horizont
- Meer mit Wellen, Schaumkrone, Glitzern und Reflexions-Andeutung; Wasser im Rumpf mit Wellen-Shader
- Partikel: Gischt an Bug/Heck, Wasserstrahl bzw. Blasen am Leck, Pumpen-Schwall, Spritzer bei Mann über Bord
- Qualitätsstufen mit Auto-Fallback (siehe Performance)

## Was (noch) nicht fertig ist
- Netzwerk / Multiplayer über mehrere Geräte (Phase 3) – lokal gehen 2 Spieler an einer Tastatur
- Kanone feuern, Seemonster, Gefahren im Nebel, Ziel/Fortschritt (Leuchtturm erreichen), Sturm/Blitze
- Pings und weitere Sprechblasen, Sound/Musik
- Echte Grafiken (alles Platzhalter, aber austauschbar – siehe `client/public/assets/README.md`)
- Menü, Lobby, Einstellungen

## Bekannte Probleme
- **Safari/WebKit nicht automatisch getestet:** In der Build-Umgebung konnte WebKit nicht installiert werden. Das
  Verifikationsskript testet WebKit automatisch mit, sobald `npx playwright install webkit` lokal gelaufen ist.
- **FPS auf echten Geräten unbekannt:** Headless-Chromium rendert hier per Software (SwiftShader), siehe unten.
- **Pixelkriechen beim Rollen:** Gedrehte Pixel-Art mit Nearest-Sampling „flimmert“ leicht an Kanten. Bewusst so (kein
  Weichzeichnen); wer es ruhiger will, kann später das Schiff erst unrotiert rendern und dann als Ganzes drehen.
- Getragene Objekte haben keine Kollision (schweben über dem Kopf, können optisch in Decken ragen).
- Die Pumpe leert nur das Unterdeck; Wasser im Mitteldeck läuft über offene Luken dorthin. Wasser kann nicht nach oben
  gedrückt werden (keine Druckmodellierung).
- Im Mastkorb ist die Reling nur 1 Tile hoch – man kann herunterspringen (landet an Deck).
- Zwei lokale Spieler teilen sich eine Kamera (Mittelpunkt); sind sie weit auseinander, ist einer am Rand.
- Der Rollwinkel ist absichtlich kräftig; bei empfindlichen Spielern kann das auf Dauer unangenehm sein (Seegang mit `[`
  oder `?sea=` reduzieren).
- Sehr selten können an exakten Tile-Ecken einzelne Lichtpixel durch Wände „durchblitzen“.

---

## Performance

Gemessen mit `npm run verify` in der Cloud-Build-Umgebung: **Headless-Chromium ohne GPU** – WebGL läuft dort über
SwiftShader, also komplett auf 4 CPU-Kernen. Diese Zahlen sind eine Untergrenze und **nicht** auf echte Geräte übertragbar.

| Messung (1920×1080, intern 480×270 ×4) | FPS |
|---|---|
| leere WebGL-Seite (nur `clear`, `client/public/bench/empty.html`) als Vergleich | 47 |
| Spiel, Qualität **high** (WebGL-Upscaling) | 9,2 |
| Spiel, Qualität **medium** (CSS-Upscaling) | 24,5 |
| Spiel, Qualität **low** (CSS-Upscaling + halber Light-Buffer) | 25,6 |
| Spiel bei 480×270 ×1 (ohne Upscaling) | ~37 |

CPU-Anteil (JavaScript) im selben Browser: **2,6 ms pro Frame** inkl. Simulation, davon ein 60-Hz-Physik-Step **0,13 ms**;
ein kompletter Neuaufbau aller 6 Licht-Polygone **0,84 ms** (wird gecacht, solange Lichter stillstehen). Der Rest ist
Software-Rasterisierung von 5 Low-Res-Pässen à 130 000 Pixel plus Upscaling – genau das, was eine echte GPU (auch die eines
alten iPads) nebenbei erledigt.

**Light-Buffer-Auflösung:** volle interne Auflösung (480×270). Das sind 130 000 Pixel – auf GPUs vernachlässigbar und
nötig für pixelgenaue Schattenkanten. Fällt die Framerate trotzdem 3 s lang unter 50 fps, schaltet das Spiel automatisch
erst auf CSS-Upscaling (`medium`), dann auf einen Light-Buffer mit halber Auflösung (`low`). Die aktuelle Stufe steht im
Debug-Overlay (F3 bzw. `?debug`).

---

## Was du manuell testen musst
- [ ] **iPad + Safari:** Seite per WLAN öffnen, `?debug` anhängen → FPS ablesen (Ziel: stabil 60, Qualität bleibt „high“).
      Falls die Stufe auf medium/low fällt: Ist das Bild trotzdem pixelscharf (CSS `image-rendering: pixelated`)?
- [ ] **Safari am Mac** und **Chrome auf den Schul-Laptops** (1366×768 → intern 455×256 ×3): Darstellung, FPS, Konsole.
- [ ] **Touch:** Stick (laufen, Leiter hoch/runter), Buttons ⤒/E/F mit Kontext-Icons, Steuerrad mit dem Finger drehen,
      Pumpenhebel ziehen, Scheinwerfer-Scheibe. **Doppeltippen auf einen Button darf nicht mehr zoomen** (iOS ignoriert
      `user-scalable=no`, deshalb werden die Touch-Gesten jetzt per Skript blockiert – nur auf einem echten iPad prüfbar).
      Mehrere Finger gleichzeitig (Stick + Springen)? Lässt sich das Einstellungs-Panel noch scrollen?
- [ ] **Gefühl:** Rutschen bei Schlagseite (F4 fixiert ±15°), Sprunghöhe, Tempo beim Tragen, Pumpen vs. Leck-Einstrom –
      alles im Einstellungs-Panel (F9) live justieren und als Standard speichern.
- [ ] **Licht:** Schatten der Laternen an Schotten/Decken, Scheinwerfer im Nebel (F6 schaltet den Nebel zum Vergleich ab).
- [ ] **Zwei Spieler lokal** (F2): beide Steuerungen gleichzeitig, Kamera.
- [ ] Optional: `npx playwright install webkit` und `npm run verify` für die WebKit-Screenshots.

---

## Vorschlag für Phase 3 (Netzwerk)

Ziel: 2–4 Geräte im Klassenraum, eins erstellt einen Raum, die anderen treten mit einem kurzen Code bei.

1. **Server-Paket mit Colyseus** (`server/`): ein Room „ship“, der genau die `Simulation` aus `shared/` mit 60 Hz laufen lässt
   (Rapier-compat läuft auch in Node). Vor dem Einbau die aktuelle Colyseus-Doku (Version 0.18) für Room-API und
   State-Sync prüfen – es gab mehrere Breaking Changes.
2. **Inputs statt Positionen senden:** Clients schicken nur ihr `PlayerInput` (7 Bits) mit Tick-Nummer, z. B. 30× pro
   Sekunde und bei jeder Änderung. Debug-Befehle laufen schon jetzt als `SimCommand` und können genauso übertragen werden.
3. **State-Sync:** Der Server sendet ~20–30× pro Sekunde einen Snapshot (Schiff, Spieler, Objekte, Luken, Wasser, Lecks,
   Stationen – der `GameState` ist bereits reines, serialisierbares JSON). Entweder über Colyseus-Schema (Delta-Patches) oder
   als kompakter Binär-Snapshot per Message.
4. **Client:** fremde Spieler/Objekte mit ~100 ms Verzögerung zwischen Snapshots interpolieren (die Snapshot-Interpolation
   existiert schon); den eigenen Spieler per Client-Side-Prediction lokal vorausrechnen und bei Abweichung sanft korrigieren.
   Schiffsbewegung und Wellen sind deterministisch aus der Zeit ableitbar → nur die Zeit synchronisieren.
5. **Kommunikation ohne Sprache:** Pings (Taste/Touch auf eine Stelle → Marker + Icon für alle), mehr automatische
   Sprechblasen (Wasser steigt, Station unbesetzt, Planke gebraucht), Rollen-Farben der Mäntel.
6. **Lobby:** Raumcode (4 Buchstaben), Name + Mantelfarbe, Reconnect nach WLAN-Abbruch (Schul-WLAN!).
7. **Hosting, günstig:** Client als statische Seite (GitHub Pages/Netlify, kostenlos), Colyseus-Server auf einem kleinen
   VPS für wenige Euro im Monat; für Tests reicht der eigene Laptop im Schul-WLAN.
