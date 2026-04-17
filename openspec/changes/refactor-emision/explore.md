## Exploration: refactor-emision

### Current State
El sistema compila archivos privados TypeScript (`.mts`, `.c.ts`) a JavaScript y declaraciones usando una de dos estrategias: un comando de CLI (e.g. `bunx tsc`) o una API en memoria de TypeScript (fallback).
Actualmente la validación del comando CLI falla por diseño, forzando indirectamente el fallback la inmensa mayoría del tiempo, y el fallback usa una expresión regular errónea que adivina mal el nombre del archivo compilado y rompe la emisión. Los tests dependen enteramente del framework completo de Electron de VSCode, ralentizando la iteración.

### Affected Areas
- `src/extension.js` — Acá ocurre el hardcodeo de las extensiones `.js` y la búsqueda por expresiones regulares defectuosas.
- `src/core.js` — Construcción de los flags de consola y verificación de archivos, actualmente desfasado del test de existencia posterior.
- `test/suite/` y `package.json` — Sólo permite test mediante instancia completa de Electron, sin fast unit testing.

### Approaches
1. **Delegar Mapeo a TS + Node Unit Testing**
   - Corregir el CLI: usar `--outFile` si se requiere mapeo exacto, o mejor, que la extensión acepte la extensión final generada por `--outDir` leyéndola inteligentemente del FS.
   - Corregir el Fallback API: En vez de un `basename.replace(...)`, iterar `outputs.keys()` de TS en memoria e inferior la ruta `.js/mjs/cjs` y `.d.ts` resultante. Guardarlos sin re-forzar la extensión.
   - Aislar lógica y usar `bun test` o `node --test` para validar el `core.js` sin cargar VSCode.
   - Pros: Separa la lógica pura del I/O de VS Code. Mucho más rápido iterar. Evita bugs catastróficos en casos de uso de bordes con archivos `.ts`. Mantiene fidelidad ESM.
   - Cons: Requiere repensar la firma de `emitEntry`.
   - Effort: Low/Medium

### Recommendation
Proceder con la opción 1 (Delegar Mapeo a TS + Node Unit Testing). Extraer las funciones determinísticas de `extension.js` hacia `core.js` (como la de extraer correctos outputs) y enchufar un micro test ultrarrápido con el test runner nativo de `node:test` o `mocha` sin electron, ejecutando test mockeados. Así no dependemos del pesado entorno de extensión para verificar fallos de regex.

### Risks
- Romper flujos existentes de gente que se haya adaptado al bug de las extensiones forzadas (poco probable por ser un proyecto nuevo, pero posible).
- En el caso remoto de compilar múltiples entradas a la vez en fallback, `outputs.keys()` daría más resultados, aunque la arquitectura actual compila file-por-file.

### Ready for Proposal
Yes — Estamos listos para que el orquestador o la etapa `sdd-propose` redacten el plan detallado.
