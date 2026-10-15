# Assets – Austausch gegen eigene Grafiken

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
| `props.png` (+`_n`), `props.json` | Atlas: `crate, barrel, plank, lantern, lantern_flame, wheel, helm, pump, pump_handle, searchlight_base, searchlight_head, searchlight_glow, cannon, cannon_carriage, workbench, hatch_closed, hatch_open, leak, patch, bubble, icon_leak, icon_plank, icon_help, icon_water, lighthouse, lighthouse_glow, moon` | Frame-Namen = Schlüssel; `*_glow`/`*_flame` werden unbeleuchtet (leuchtend) gezeichnet |

Die Kollisionsgrößen der Objekte stehen in `shared/src/physics.ts` (`OBJECT_SPECS`) und passen zu den
Sprite-Größen (16 px = 1 m). Werden Sprites größer/kleiner, dort mitziehen.
