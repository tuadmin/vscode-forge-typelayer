<div align="center">

![Forge TypeLayer Logo](icon.png)

</div>

# Forge TypeLayer v1.0.1
**The Pragmatic Switch for the Real-World Engineer.**

Forge TypeLayer is a VS Code extension designed specifically for developers who value absolute architectural control but operate in pragmatic, high-velocity environments. It bridges the gap between strict **TypeScript-as-Source** and clean, unencumbered **JavaScript-as-Artifact**.

---

## 🏛 The Core Philosophy
In complex or mixed ecosystems, your runtime (Browser, Node, Deno) often expects pure JavaScript, but you want TypeScript as your private, iron-clad *Source of Truth*. 

Forge TypeLayer allows you to author in TS and automatically "forge" your artifacts (JS + Definition files) on every save. It enforces a **Single Source of Truth** pattern, ensuring your public contracts are always in sync with your private architecture.

---

## 🛠 Features for the Trenches

### 1. Intelligent Runtime Matrix (Fallback Engine)
Forge automatically detects your environment and chooses the most efficient compilation strategy:
- **🚀 Bun (Premium Experience):** If Bun is detected, Forge uses its high-performance bundler. This is the fastest path, handling module resolution and dependency inlining in sub-milliseconds. 
- **🦕 Deno:** If Bun is missing but Deno is available, Forge uses Deno's native TypeScript support. Note that since the deprecation of `deno bundle`, our engine orchestrates a fast transpilation layer that maintains 100% compatibility.
- **🛡️ TSC (Safety Fallback):** If no modern runtimes are found, Forge falls back to the standard TypeScript Compiler (TSC). It's slower but universally reliable.

### 2. Guarded Artifacts (Auto-Watermarking)
Forge automatically injects a `DO NOT EDIT DIRECTLY` watermark in all generated files. This prevents accidental manual edits in definition files or compiled JS, protecting your source of truth from architectural decay.

### 3. Smart Debounce & Short-Circuiting
- **Zero-I/O for Comments:** If you save a file that only contains comments or TODOs, Forge detects the lack of logic and aborts execution to protect your SSD and battery life.
- **Micro-Batching:** Saving 10 files at once? Forge debounces these into a single execution batch, preventing background process spikes.

### 4. Schema-First Integrity (i18n)
The entire extension operates under a **Schema-First** internationalization system. Every log, error, and notification is formally defined in a JSON Schema, ensuring 100% language parity (currently English & Spanish) and structural integrity.

---

## ⚙️ How it works

Forge respects specific naming conventions to automatically map your private source to public artifacts:

| Source Convention | Artifact 1 (Logic) | Artifact 2 (Types) |
| :--- | :--- | :--- |
| `*.forge.ts` | `.js` | `.d.ts` |
| `*.source.ts` | `.js` | `.d.ts` |
| `*.source.mts` | `.mjs` | `.d.mts` |
| `*.f.ts` (Legacy) | `.js` | `.d.ts` |

> [!TIP]
> **Why use these suffixes?** Descriptive suffixes like `.forge.ts` prevent VS Code from getting confused between the source and the output, avoiding "Duplicate identifier" errors in the editor.

---

## 📦 Requirements
Forge TypeLayer is zero-config. It works out of the box if you have **TypeScript** installed in your project, but for the best experience, we recommend:
1. **[Bun](https://bun.sh/):** Recommended for near-instant builds.
2. **[pnpm/npm/yarn]:** Standard package managers to handle your dependencies.

---

<div align="center">
  <blockquote>Stop fighting configurations. Start forging code.</blockquote>
</div>

---

## Privacy & Data Security

Forge TypeLayer is built with a **Privacy-First** philosophy:
- **Zero Data Collection**: We do not collect, store, or transmit any telemetry, PII, or code snippets.
- **Local Processing**: All compilation and forges occur strictly on your machine using your local environment (Bun, Deno, or TSC).
- **No Network Activity**: The extension does not perform any external network requests.

---

## License
Apache-2.0 - See [LICENSE](LICENSE) for details.
