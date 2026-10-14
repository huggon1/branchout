# Renderer

[Product specification](../../docs/product-spec.md) owns page behavior. UI changes follow the repository [AGENTS.md](../../AGENTS.md).

| Path | Responsibility |
| --- | --- |
| `components/TaskPanel.tsx` | Global task entry, grouped history, details, and clearing |
| `App.tsx` | Navigation and page assembly |
| `refactor.css` | Existing shell and responsive layouts |
| `components/MaterialReader.tsx` | Material directory and saved body reader |
| `components/TelegramSettings.tsx` | Collapsed connection summary, setup drawer, and chat authorization |
| `components/SettingsPage.tsx` | Settings assembly |
| `components/Primitives.tsx` | Controls, dialogs, and sanitized Markdown |
| `design/Components.tsx`, `design/tokens-and-controls.css` | Existing disclosure and control components |
| `bridge.ts`, `product-ui.ts` | Desktop calls and view mapping |
| `i18n/` | Interface language and labels |
