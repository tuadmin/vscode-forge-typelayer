## Exploration: CI/CD Workflow for Marketplace & GitHub Releases

### Current State
El proyecto actualmente no tiene un pipeline de CI/CD automatizado en Github Actions (`.github/workflows/`). Cualquier publicación o testing de Pull Requests recaería en ejecución manual, haciéndolo vulnerable a PRs defectuosos de terceros y procesos tediosos de empaquetado para Alpha/Release.

### Affected Areas
- Directorio `.github/workflows/` (a crear).
- Script `build.yml` o `publish.yml` para centralizar la orquestación.

### Pipeline Requirements
1. **Pull Request Gatekeeper**: Cualquier PR hacia `main` debe desencadenar la **Triple Corona de Tests** (`test:fast`, `test:bun`, `test:e2e`). Si un test falla, el PR se bloquea.
2. **Release vs Pre-Release (Alpha)**:
   - Tags tipo `v1.0.0` -> Lanzan un empaquetado formal y lo publican al VS Code Marketplace y Open VSX como versión `Release`.
   - Tags tipo `v1.0.0-alpha.1` -> Se empaquetan y suben a las tiendas bajo la directiva pre-release (`--pre-release` en vsce).
3. **GitHub Releases Hooks**: El archivo compilado `.vsix` debe atraparse e inyectarse en el apartado "Releases" del propio Github para que sirva de mirror offline a tiendas cerradas.
4. **Secret Handshake**: Validar si `secrets.VSCE_PAT` y `secrets.OVSX_PAT` están vigentes antes de intentar el deploy, para evitar fallos fantasma al final del pipeline en forks donde no existen secretos.

### Approaches
- **Single File Orchestration**: Un solo archivo `ci.yml`.
  - Disparadores: `pull_request` (caminos de código) y `push` a `tags` que hagan match con `v*`.
  - Job 1: `Tests`. Falla rápido si algo rompe.
  - Job 2: `Publish` (depende del Job 1). Solo corre en `push` a un tag, chequea que los tokens existan.
  - Uso de `npx vsce publish` y `npx ovsx publish`. Para VSCE se usa `VSCE_PAT`.
  - Uso del action de `softprops/action-gh-release` para agarrar el `.vsix` y subirlo al panel real de Github Releases atado al Tag.

### Recommendation
Implementar la orquestación en un único pipeline YAML que separe jobs (Test -> Publish). Esto da una capa gráfica hermosa en Actions.

### Ready for Proposal
Yes, redactando el plan para aprobar.
