## Exploration: Emit Path Resolution & Cross-Runtime Consistency

### Issue 1: The `.c.ts` (Compiled Mode) Identifier
- **Current State:** A file named `foo.c.ts` is treated as a normal `.ts` file with prefix `foo.c`. It emits `foo.c.js` and `foo.c.d.ts`.
- **Problem:** User intends `.c.ts` to be a special marker (similar to a lock or compiled target marker) so developers can add `*.c.ts` to `.gitignore`. They want `foo.c.ts` to compile down to `foo.js` and `foo.d.ts` (stripping the `.c.`). If it keeps the `.c.`, it collides with type definitions or other logical boundaries.
- **Goal:** Update the `predictEmitPaths` logic to strip `.c.ts` (and possibly `.c.mts`, `.c.cts`) down to the core filename `foo` so output is `foo.js`/`foo.mjs`.

### Issue 2: Empty `.d.ts` Files under Bun/MTS
- **Current State:** Compiling `.mts` files under Bun (or internal fallback API overriding TS options) produces an empty TypeScript declaration file.
- **Problem:** `tsc` requires very specific `compilerOptions` to properly emit declarations for `.mts`. Currently, when `core.js` calls the API or external command for `.mts`, we inject `--module es2022 --moduleResolution bundler`. This can sometimes cause TS to fail type extraction implicitly if `isolatedModules` or entry references aren't fully resolved standalone, resulting in a blank `.d.ts` file without outright throwing an error.
- **Goal:** Unify the compiler options for all runtimes. Guarantee that whether we use `Node+API`, `Bun+tsc`, or `Deno+tsc`, the resulting `.mjs` and `.d.mts` have consistent content. We may need to tweak `buildCompilerOptions` and external `ts` args, perhaps switching `moduleResolution: node` even for `.mts` when emitting standalone.

### Approaches
1. **Fix path matching:** Modify regex in `predictEmitPaths` from `/\.(ts|mts|cts)$/` to `/\.(c\.)?(ts|mts|cts)$/`. Replace logic.
2. **Standardize TS Args:** Evaluate `allowJs` and `isolatedModules` inside compiler options. If `tsc` produces empty `.d.ts` for standalone `.mts`, it's usually because it assumes `bundler` resolution lacks context and drops declarations. Reverting `moduleResolution` to `node` for standalone compilation ensures it emits properly.
3. **Expand Testing Suite:** Our tests (`core.fast.test.js`) must inject a `.mts` and a `.c.ts` mock file to strictly verify the predicted paths and the compiler output strings (ensuring they aren't blank).

### Ready for Proposal
Yes, creating an Implementation Plan for user approval.
