# Assets – Austausch gegen eigene Grafiken und Sounds

Alle Dateien hier sind **Platzhalter**, erzeugt von `npm run assets` (`scripts/generate-assets.ts`).
Du kannst jede Datei 1:1 durch einen Aseprite-Export mit gleichem Namen ersetzen.
`npm run assets` erkennt ersetzte Dateien (Hash-Liste in `.generated.json`) und lässt sie in Ruhe;
nur `npm run assets:force` überschreibt alles mit den Platzhaltern.

## Konventionen
- **Normal Maps:** `name_n.png` neben `name.png`, gleiche Größe und gleiches Layout.
  R = +x (rechts), **G = +y nach oben**, B = zum Betrachter (Standard von Laigter / SpriteIlluminator).
  Fehlt eine `_n.png`, wird das Sprite als flach beleuchtet.
- **Sprite-Sheets:** Aseprite „Export Sprite Sheet“ → JSON Data, Format *Hash* oder *Array*, mit
  „Tags“ (frameTags = Animationen) und „Slices“ (Pivot-Punkte). Nearest-Neighbor, keine Ränder nötig
  (2 px Padding empfohlen, weil gedrehte Sprites sonst Nachbarpixel erwischen können).
- **Pivots:** Slice mit Pivot. Im Props-Atlas heißt jeder Slice wie sein Frame; im Spieler-Sheet gilt
  ein einziger Slice für alle Frames. Ohne Slice: Mitte des Frames.

## Dateien
| Datei | Inhalt | Vertrag |
|---|---|---|
| `ship_back.png` (+`_n`) | Rückwände, Leitern, Mast, Rah, Takelage, hintere Reling | exakt 576×216 px = 72×27 Tiles à 8 px, Tile (0,0) oben links – muss zur ASCII-Karte in `shared/src/layout/shipMap.ts` passen |
| `ship_hull.png` (+`_n`) | Rumpf, Decks, Wände, Bugspriet (vor den Figuren) | gleiche Größe wie oben; Luken-Tiles transparent lassen (eigene Sprites) |
| `player.png` (+`_n`), `player.json` | Figur ohne Mantel, 16×24 px pro Frame, Pivot (8,23) = Füße | Tags: `idle, run, jump, fall, climb, station, repair, swim, carry_idle, carry_run` |
| `player_coat.png` | nur der Mantel in Weiß/Grau, gleiches Layout wie `player.png` | wird pro Spieler eingefärbt |
| `props.png` (+`_n`), `props.json` | Atlas: `crate, barrel, plank, lantern, lantern_flame, wheel, helm, pump, pump_handle, searchlight_base, searchlight_head, searchlight_glow, cannon, cannon_carriage, workbench, hatch_closed, hatch_open, leak, patch, bubble, icon_leak, icon_plank, icon_help, icon_water, icon_wheel, icon_rock, icon_monster, icon_land, icon_here, lighthouse, lighthouse_glow, moon, rock_a, rock_b, rock_c, kraken_head, kraken_eyes, kraken_tentacle_a, kraken_tentacle_b, ball`, UI: `ui_*` | Frame-Namen = Schlüssel; `*_glow`/`*_flame`/`kraken_eyes` werden unbeleuchtet (leuchtend) gezeichnet

Die Kollisionsgrößen der Objekte stehen in `shared/src/physics.ts` (`OBJECT_SPECS`) und passen zu den
Sprite-Größen (16 px = 1 m). Werden Sprites größer/kleiner, dort mitziehen.

## Sounds (`sfx/`)
Alle Sounds sind synthetisierte Platzhalter (`scripts/assets/sfx.ts`), 22 kHz mono, 16 Bit WAV. Eine Datei mit
**gleichem Namen** ersetzen genügt – z. B. aus Ableton als WAV (44,1 oder 48 kHz, 16 Bit) exportieren. Ersetzte Dateien
überschreibt `npm run assets` nicht. Fehlt eine Datei, bleibt es an der Stelle einfach still.

- **Varianten:** `step_1.wav`, `step_2.wav`, … werden zufällig abgewechselt. Neue Varianten (`step_5.wav`) zusätzlich in
  `sfx/index.json` eintragen.
- **Loops** (`loop_sea`, `loop_wind`, `loop_rain`, `loop_leak`) müssen nahtlos loopen. Ihre Lautstärke regelt das Spiel
  (Seegang, Sturm, Lecks in der Nähe); unter Deck klingen Meer und Sturm gedämpft.
- Weitere Formate: In `sfx/index.json` darf ein Eintrag eine Endung haben (`"loop_sea.m4a"`), dann wird diese Datei geladen.

| Datei | Wann |
|---|---|
| `step_*`, `ladder_*`, `jump`, `land` | Laufen, Leiter, Springen, Landen |
| `pickup`, `drop`, `station` | Aufheben, Ablegen, Station betreten |
| `hatch_open`, `hatch_close` | Luke |
| `pump` | jeder Pumpenhub |
| `leak_start`, `hammer_*`, `repaired` | neues Leck, Reparieren, geflickt |
| `splash_small`, `splash_big`, `sink` | Spritzer, Mann über Bord, Schiff gesunken |
| `cannon`, `rock_hit`, `rock_break` | Kanone, Felsen gerammt, Felsen zerschossen |
| `kraken_roar`, `kraken_hit` | Krake taucht auf / greift an / flieht, Treffer |
| `ping`, `shout`, `ui_click` | Ping, automatischer Zuruf (Sprechblase) |
| `thunder`, `foghorn`, `arrive` | Donner nach Blitzen, Nebelhorn bei „Land in Sicht“, Ankunft |
| `creak_*` | knarzendes Holz (öfter bei Seegang) |
| `loop_sea`, `loop_wind`, `loop_rain`, `loop_leak` | Hintergrund |

## App-Icons
`icon-180.png` (iPhone), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (Android, Motiv in den mittleren 75 %)
und `favicon-32.png` erzeugt `npm run assets` aus `scripts/assets/icon.ts` (32×32 Pixel, ohne Glättung hochskaliert).
Eigene Icons einfach mit gleichem Namen und gleicher Größe ersetzen – sie werden dann nicht mehr überschrieben.
