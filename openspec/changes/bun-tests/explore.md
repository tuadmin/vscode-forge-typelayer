## Exploration: Restructure Tests to Bun

### Current State
El sistema de testing actual depende de `@vscode/test-electron` ejecutado vía `test/runTest.js` con Node.js. Al inicializar, tira errores de IPC handle, file watcher de network shares en MacOS, y un error fatal notificando que el `test/suite/index.js` no es un test runner válido para VS Code. 
Adicionalmente, los tests dentro de `test/suite/*.test.js` no invocan la API nativa de VS Code (comprobado vía búsqueda de imports), sino que prueban puramente la lógica de `core.js`. Usar Electron para esto es matar moscas a cañonazos y el entorno entero falla.

### Affected Areas
- Directorio de testing: `test/` (Específicamente limpiar la basura de integración de VSCode).
- Paquetes en `package.json`: Remover dependencias de `@vscode/test-electron` y Mocha, y cambiar commands a `bun test`.
- Archivos `.test.js`: Hay que adaptarlos ligeramente. Usan la interfaz TDD de Mocha (`suite()`). Bun soporta `describe()` por defecto, por lo que requerimos migración de nomenclatura.

### Approaches
1. **Migrar toda la suite a `bun test` y eliminar dependencias de Electron**
   - Eliminar `runTest.js` y `suite/index.js` porque pertenecen a VSCode Testing API.
   - Cambiar todas las instancias de `suite('...', () => {})` a `describe('...', () => {})` en los archivos de `test/suite/`.
   - Modificar el package.json para que el comando `test` sea simplemente `bun test`.
   - Ventajas: Extrema velocidad, usa recursos del motor base cruzado de Bun, cero dependencias infladas, cero problemas de sockets de red/MacOS, tests en microsegundos.
   - Desventajas: Perdemos testing de integración directo a interfaz de VS Code (e.g. click de botones ficticios), lo cual no se usa en este proyecto actualmente.

### Recommendation
Implementar la migración frontal 100% a Bun. Dado que ya comprobé que los tests no hacen `require('vscode')`, es una migración limpia de lógica pura.

### Risks
- CI Environment: GitHub Actions debe asegurar tener el contenedor `setup-bun` en su pipeline para que `bun test` corra, Node no lo reconocerá (aunque Bun puede correr sin node, el CI YAML debería considerarlo).
- `core.fast.test.js`: El test que introduje usa `node:test`, habría que homogeneizarlo y que todo corra bajo `bun test` para unificación semántica y misma herramienta cross.

### Ready for Proposal
Yes, redactando el plan.
