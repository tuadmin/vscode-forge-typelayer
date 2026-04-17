# Proposal: Modular Smart Forge Engine

## Intent
The `extension.js` file has grown into an unmaintainable monolith, blending UI, file watching, and batch compilation logic. We will extract this into a "Smart Forge Engine" module cluster, adhering exactly to our new Hybrid Safe-Batch architecture with a Head Manifest for external dependencies, TSC incremental caching for generation, and strict Workspace FS usage to appease VS Code watchers.

## Scope
### In Scope
- Splitting `extension.js` into `manifest.js`, `builder.js`, `extractor.js`, `logger.js`, and `i18n.js`.
- Implementing the Header Manifest Regex parser.
- Implementing `.gitignore` warnings for the Virtual Box (`.vscode/forge-temp/`).
- Implementing Output Channel warnings for missing orphaned external `.js` files.

### Out of Scope
- Altering the visual Webview functionality.
- Modifying how the actual tsconfigs work beyond the virtual shadow dir.

## Approach
We will utilize a module extractor pattern to isolate the Builder (child_process) from the Extractor (workspace.fs). A central `batchOrchestrator.js` will wire them together. Message strings will be pushed to an `i18n.js` map to eliminate literal string fatigue.
