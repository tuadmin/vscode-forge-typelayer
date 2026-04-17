# Documentación de Desarrollo - Forge TypeLayer (v2026)

Este documento centraliza el conocimiento técnico y los procedimientos operativos del proyecto. Es la fuente de la verdad para desarrolladores y agentes de IA.

---

## 🔐 Gestión de Secretos y CI/CD (Vital)

La publicación automatizada depende de tokens que expiran cada 90 días. No pierdas tiempo buscando en la documentación oficial desactualizada; usá estas rutas directas:

### 1. Visual Studio Marketplace (VSCE_PAT)
Es necesario para publicar en la tienda oficial de Microsoft.
- **Estado:** Requiere suscripción activa o tarjeta asociada en la organización.
- **Portal:** [Azure DevOps - Personal Access Tokens](https://dev.azure.com/{Tu_Organización}/_usersSettings/tokens)
- **Scopes:** Seleccionar `Extensions` y `Marketplace`.
- **Configuración:** Agregar el valor resultante en los [Secrets de GitHub](https://github.com/{Proyecto}/settings/secrets/actions) como `VSCE_PAT`.

### 2. Open VSX Registry (OVSX_PAT)
Para la comunidad open-source (Eclipse/VSCodium).
- **Portal:** [Open VSX Token Settings](https://open-vsx.org/user-settings/tokens)
- **Configuración:** Agregar en GitHub como `OVSX_PAT`.

---

## 🏛 Filosofía del Engine

Forge es un **orquestador de contratos**. El objetivo es que trabajes en una capa privada de TypeScript y el motor "forje" los artefactos públicos (`.js` + `.d.ts`) asegurando consistencia total.

### Principios de Diseño:
- **Runtime Matrix:** El motor detecta Bun (Premium), Deno o TSC automáticamente.
- **Defensa de Artefactos:** Marcamos cada archivo generado con watermarks y bloqueamos la edición accidental. El código fuente es sagrado.
- **Eficiencia SSD:** Si un archivo solo tiene comentarios o está vacío, el motor aborta la ejecución para ahorrar ciclos de CPU e I/O.

---

## 🏗 Arquitectura del Flujo

1. **Orchestrator (`batchOrchestrator.js`):** Debouncer de 100ms que agrupa saves masivos.
2. **Builder (`builder.js`):** Crea un `tsconfig.json` dinámico en `.vscode/forge-temp/` para aislar el proceso de build.
3. **Extractor (`extractor.js`):** Mapea los sufijos (`.source.ts` -> `.js`) e inyecta los watermarks de seguridad.

---

## 🛡️ Protocolo de Integridad I18n (Schema-First)

Mantenemos paridad total (EN/ES) usando un contrato rígido de esquemas. No se aceptan llaves sueltas en el código.

1. **Schema SoT:** Se define la key y su descripción técnica en `schemas/l10n.schema.json`.
2. **Traducción:** Se añade a `l10n/bundle.l10n.json` (EN) y `bundle.l10n.es.json` (ES).
3. **Verificación:** Ejecutar `npm run test:audit` para asegurar sincronización total.

---

## 🧪 Estrategia de Testing (Pipeline)

- `npm run test:audit`: Valida esquemas e integridad de idiomas (obligatorio antes de subir).
- `npm run test:unit`: Valida la lógica de negocio y matrices de nombres.
- `npm run test:e2e`: Lanza la extensión en un entorno real de VS Code.

---

<div align="center">
  <blockquote>"La simplicidad para el usuario es complejidad bien gestionada internamente."</blockquote>
</div>
