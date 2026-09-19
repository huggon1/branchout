# nature-feed brand assets

`brand.svg` is the authored source: three content layers growing into a two-leaf sprout. The sidebar uses the same geometry in `src/ui/Icons.tsx`. The app icon uses a deep green tile, warm-white content lines and teal leaves; the menu bar uses the same geometry as a monochrome macOS template image so it adapts to appearance.

Run `npm run build:icons` on macOS to render the SVG with the pinned Electron runtime and create PNG/ICNS outputs. Commit the SVG, PNG and ICNS; the intermediate iconset is ignored. `npm run build` copies runtime PNGs into `dist/assets`, and packaging uses `app-icon.icns`.

The bundle identifiers, legacy `Feedloom` data directories, SQLite filename and IPC API remain stable across the rename to retain existing data and integrations.
