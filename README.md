# Leuchtturmwärter

**Ein Koop-Browserspiel für 2–4 Leute – ohne Sprache, mit Teamwork.**
Bringt euer Schiff gemeinsam durch Sturm, Nebel und Kraken-Angriffe zum Leuchtturm.

### ▶ Jetzt spielen: **https://game.echterhofflabs.me**

![Scheinwerfer im Nebel](screenshots/chromium-07-scheinwerfer-nebel.png)

| | | |
|---|---|---|
| ![](screenshots/chromium-13-felsen-scheinwerfer.png) | ![](screenshots/chromium-14-krake-kanone.png) | ![](screenshots/chromium-15-ankunft.png) |
| ![](screenshots/chromium-16-seekarte.png) | ![](screenshots/chromium-04-licht-mitteldeck.png) | ![](screenshots/chromium-11-lobby.png) |

## Worum geht's?

Das Schiff ist ein Querschnitt mit drei Decks. Jede Person übernimmt Aufgaben an den Stationen:

- **Steuerrad** – Felsen ausweichen; die Seekarte zeigt den Kurs (gelb) und Felsen im Weg (rot)
- **Scheinwerfer** – im Mastkorb den Nebel absuchen, damit Felsen und der Krake früh entdeckt werden
- **Kanone** – Felsen zerschießen und den Kraken verjagen
- **Pumpe & Werkbank** – Wasser abpumpen, Planken holen, Lecks flicken

Je näher der Leuchtturm, desto stärker der Sturm. Reden ist nicht nötig: Pings markieren Stellen für alle, die Figuren rufen automatisch („Felsen!“, „Krake!“, „Ruder!“).

## Steuerung

| | Tastatur | Touch (iPad) |
|---|---|---|
| Laufen / Leiter | A/D, W/S | Stick |
| Springen | Leertaste | ⤒ |
| Station, Luke, Reparieren | E | E |
| Tragen, Kanone feuern | F | F |
| Ping | Rechtsklick / Q | ❗ |
| Menü / Ton aus | Esc / M | ☰ |

Online: „Neues Schiff“ erzeugt einen Raumcode aus 4 Buchstaben, die anderen treten damit bei. „Allein üben“ geht ohne Server.

**Neu in 2.0 (in Arbeit):** Kampagne mit sechs Etappen, Häfen und Upgrades, Tagesfahrt, Rollen, neue Gefahren (Feuer, Piraten, Eis, Strudel, Brecher), Kisten mit Inhalt, Stationen als 2.5D-Diorama und die **Werft** zum Bauen eigener Schiffe. Details in [`RELEASE_NOTES.md`](RELEASE_NOTES.md).

## Technik

- **TypeScript**, npm-Workspaces: `shared/` (deterministische Simulation, kein DOM), `client/`, `server/`
- **PixiJS v8** (WebGL2): Low-Res-Pixel-Rendering (~480×270) mit eigener Licht-Pipeline – Sichtbarkeits-Polygone, Normal Maps, Nebel-Shader
- **Rapier2D** für die Physik; das Schiff rollt, die Schwerkraft wird stattdessen gedreht
- **Colyseus**: autoritativer Server, Client-Side-Prediction mit Reconciliation, kompakte Binär-Snapshots
- Platzhalter-Grafiken und -Sounds werden per Skript erzeugt (`npm run assets`)

## Lokal starten

Voraussetzung: Node.js 22+

```bash
npm install
npm run dev     # Spiel-Server (Port 2567) + Client auf http://localhost:5173
```

Weitere Befehle: `npm test`, `npm run typecheck`, `npm run build`, `npm run verify` (Browser-Tests mit Playwright).
Für den Online-Betrieb: Client als statische Seite (`VITE_SERVER_URL=wss://…`), Server per `server/Dockerfile` / `fly.toml`.

Designentscheidungen stehen in [`DECISIONS.md`](DECISIONS.md), der Entwicklungsplan in [`PLAN.md`](PLAN.md), die Asset-Konventionen in [`client/public/assets/README.md`](client/public/assets/README.md).
