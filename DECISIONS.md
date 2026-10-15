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
