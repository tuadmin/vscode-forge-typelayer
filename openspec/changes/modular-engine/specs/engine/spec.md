# Engine Specification

## ADDED Requirements

### Requirement: Modular Core Isolation
The system MUST decouple execution paths into dedicated files ensuring VS Code APIs are not conflated with raw Node OS modules.
#### Scenario: Raw File Saving
- GIVEN a user saves a `.source.ts` file
- WHEN the save event is pushed to the Batch Orchestrator
- THEN it must resolve via `manifest.js`, compile via `builder.js`, and extract via `extractor.js`.

### Requirement: Header Manifest Parsing
The system MUST extract imports from the target file to determine boundaries.
#### Scenario: Private Parent Import
- GIVEN a file imports `../_afuera.ts`
- WHEN the Manifest reads the header
- THEN it classifies `../_afuera.ts` as an external boundary, explicitly passing it externally to the bundler.

### Requirement: Extractor Safe Modification
The system MUST rewrite `.ts` to `.js` upon extraction for specific external matches.
#### Scenario: Missing External
- GIVEN the manifest identifies an external file `../_afuera.js`
- WHEN the extraction finishes
- THEN if the file physically does not exist in the workspace, the `logger.js` MUST output an Orphan Warning.

### Requirement: Gitignore Shield
The system MUST prevent shadow artifacts from polluting VCS.
#### Scenario: Fresh Install
- GIVEN the `.vscode/forge-temp` does not exist in `.gitignore`
- WHEN the compiler first runs
- THEN a prompt is presented asking to append it.
