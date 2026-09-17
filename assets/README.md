# nature-feed brand assets

`brand.svg` is the authored source: a folded leaf with a shared stem. The sidebar uses the same path in `src/ui/Icons.tsx`. The app icon has a pine-green tile; the menu bar uses a monochrome template so macOS adapts it to appearance.

Run `npm run build:icons` on macOS to render the SVG with the pinned Electron runtime and create PNG/ICNS outputs. Commit the SVG, PNG and ICNS; the intermediate iconset is ignored. `npm run build` copies runtime PNGs into `dist/assets`, and packaging uses `app-icon.icns`.

The bundle identifiers, legacy `Feedloom` data directories, SQLite filename and IPC API remain stable across the rename to retain existing data and integrations.
