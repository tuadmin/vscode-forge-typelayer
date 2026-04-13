# Internal Spec — Forge TypeLayer v6

## Product name

**Forge TypeLayer**

## Intent

Forge TypeLayer enables a private TypeScript-style authoring workflow that produces public JavaScript and declaration artifacts.

The project is optimized for:
- JavaScript-first repositories,
- maintainable type contracts,
- mixed runtime/tooling ecosystems,
- reviewability and future modification by humans or AI systems.

## Non-negotiables

1. OFF by default.
2. Public artifacts are the external contract.
3. Private source is backstage by default.
4. Lint-first emit when enabled.
5. Comments should explain purpose and maintenance reason.
6. Use public VS Code APIs for compatibility with VS Code and compatible forks.
7. Keep the spec updated whenever behavior changes.

## Documentation rule

All source code should include useful comments that explain:
- what the block does,
- why it exists,
- what tradeoff or maintenance concern it addresses.

Comments should improve long-term maintainability, not narrate trivial syntax.

## Localization

Default/native language is English.

The extension should also provide at least a basic Spanish translation for package metadata and visible user-facing strings where practical.

### Mechanism
- `package.nls.json` as English default.
- `package.nls.es.json` for Spanish package-level translations.
- `l10n/` bundles for runtime UI strings.

VS Code supports localized package contribution files and l10n tooling for extension strings. [web:177][web:174][web:186]

## Presentation page

The root `README.md` acts as the presentation page in extension marketplaces and should remain polished, concise, and aligned with product positioning. Marketplace documentation explicitly uses the README for the extension page. [web:179][web:185]

## Compatibility

Forge TypeLayer should target the standard VS Code extension API surface and avoid proprietary-only APIs.

This improves the chance of compatibility with VS Code and compatible forks that support the public extension model. Public examples show that many VS Code-compatible environments consume standard marketplace/extension artifacts. [web:184][web:178]

## Modes

### OFF
No automatic emit.

### MANUAL
Emit only through explicit commands.

### AUTO
Saving a file under a declared subtree triggers emit of the owning public entrypoint.

## Lint-first policy

Before emit, the extension should validate the file or entrypoint.

### Order
1. Workspace linter if available.
2. Runtime-native lint if appropriate.
3. Minimal validation fallback.

If lint/validation fails, emit must stop and the user must receive a clear explanation.

ESLint provides a Node.js API and configuration model suitable for this role. [web:158][web:159]

## Runtime strategy

Supported:
- `typescript-api`
- `tsc`
- `bun`
- `deno`
- `auto`

### AUTO precedence
1. Deno signals and binary.
2. Bun signals and binary.
3. Local `tsc`.
4. Global `tsc`.
5. TypeScript API fallback.

## Alias strategy

Do not invent a parallel alias model.

Respect workspace sources of truth such as:
- `tsconfig.json`
- `jsconfig.json`
- Deno config `imports`
- Deno import map style workflows where relevant
- lint resolver configuration

This keeps behavior closer to the actual project toolchain. Bun can use `tsconfig.json` path remapping, and ESLint resolvers can integrate with TypeScript alias config. [web:167][web:160]

## Workspace doctor

A dedicated command should provide a concise report with:
- chosen runtime,
- lint strategy,
- manifest path,
- detected config hints,
- warnings about missing or conflicting configuration.

## Tests

Tests must cover:
- runtime detection,
- command construction,
- lint strategy detection,
- ownership resolution,
- reconstruction,
- binary spawn wrapper,
- workspace doctor report generation.

VS Code extension tests should continue using the official harness. [web:136]

## PR reviewer checklist

The PR approver should verify:
- spec updated,
- README still accurate,
- default mode still OFF,
- code comments still explain intent and tradeoffs,
- localization files still valid,
- compatible APIs only,
- tests updated.

## AI restructuring checklist

If an AI system restructures the project, preserve:
- Forge TypeLayer branding,
- compatibility goals,
- English-first plus Spanish support,
- manifest-based boundary,
- lint-before-emit,
- runtime fallback safety,
- README/spec/tests coherence.

## GitHub automation

The repository should include GitHub Actions workflows for:
- CI on push and pull request,
- release on semantic version tag `v0.0.0`,
- packaging to VSIX,
- publication to Visual Studio Marketplace and Open VSX,
- pre-publish test execution.

### CI requirements
- Install Node.js.
- Install Bun.
- Install Deno.
- Run extension tests through the official VS Code test harness. [web:136][web:194]
- Use Xvfb or equivalent in CI because Electron-based VS Code tests may need a virtual display in GitHub Actions. [web:197]

### Release trigger
- Trigger on pushed tag matching `v*.*.*`.
- Validate that tests pass before publishing.
- Package VSIX.
- Create GitHub Release.
- Publish to both markets when tokens exist.

### Publication targets
- Visual Studio Marketplace via `vsce`. [web:179]
- Open VSX via `ovsx`. [web:199][web:201]
