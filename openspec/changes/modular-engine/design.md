# Design: Modular Smart Forge Engine

## Technical Approach
Decompose the monolith cleanly.

## Data Flow
`extension.js (Watcher)` -> `BatchOrchestrator (Debouncer)` -> `ManifestParser` -> `Builder (TSC + Bun)` -> `Extractor (Verify + Move)` -> `Logger (Alerts)`

## File Changes
| File | Action | Description |
|------|--------|-------------|
| `src/utils/i18n.js` | Create | Simple translation dictionary |
| `src/utils/logger.js` | Create | VS Code Output Channel wrapper |
| `src/engine/manifest.js` | Create | Regex header parser |
| `src/engine/builder.js` | Create | Executes `child_process` commands |
| `src/engine/extractor.js` | Create | Uses `vscode.workspace.fs` to move files safely |
| `src/engine/batchOrchestrator.js` | Modify | Coordinates the engine modules |
| `src/extension.js` | Modify | Gutted to just activation logics |

## Testing Strategy
- Unit tests run against `matrix.functional.test.js` to assert the boundary rules exactly.
