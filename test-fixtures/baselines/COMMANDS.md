# Forge TypeLayer - Build Strategy Matrix

Este documento detalla la relación entre los Modos de Construcción (Estrategias) y los comandos que se disparan en el pipeline. Usá esto para definir tus `expectations` según el modo seleccionado en los tests.

## Matriz de Comandos por Estrategia

| Estrategia | Motor | Comando CLI Clave | Extracción (Fidelity) |
| :--- | :--- | :--- | :--- |
| **`FULL_BUNDLE`** | Bun | `bun build --outfile=...` (sin externals) | Se extrae un solo archivo `.js` que incluye todas las dependencias. |
| **`DOMAIN_BUNDLE`** | Bun | `bun build --external '../*'` | Agrupa archivos internos (`_`), pero deja afuera dependencias externas y de padres. |
| **`RECURSIVE_PURE`** | TSC | *Bypass Bundler* | Extrae el archivo principal + TODAS sus dependencias como archivos individuales `.js` separados. |
| **`STANDALONE`** | TSC | *Bypass Bundler* | Extrae ÚNICAMENTE el archivo principal. Las dependencias se quedan en el shadow virtual. |

---

## 1. FULL_BUNDLE (`full_bundle`)
Ideal para prototipado rápido donde no importan las dependencias externas.

**Comando Bun:**
```bash
bun build [entry] --outfile=[shadowTarget] --target=node --format=esm
```
*   **Comportamiento**: Bun resuelve todo el árbol e intenta inlinearlo en un solo bundle.

---

## 2. DOMAIN_BUNDLE (`domain_bundle`)
El modo híbrido estándar de Forge. Protege la integridad de los paquetes externos.

**Comando Bun:**
```bash
bun build [entry] --outfile=[shadowTarget] --target=node --format=esm --external '../*'
```
*   **Comportamiento**: Inline de archivos privados (del mismo nivel o hijos) pero marca las rutas de padres como "Externas" para evitar romper el árbol de directorios del usuario.

---

## 3. RECURSIVE_PURE (`recursive`)
Máxima fidelidad. Uso exclusivo de TSC para evitar cualquier alteración de Bun.

**Comando:**
*   **Compilación**: `tsc -p tsconfig.json` (ESNext)
*   **Bypass**: No se ejecuta `bun build`.
*   **Extracción**: El `extractor.js` recorre el manifiesto recursivamente y copia cada `.js` del shadow al workspace real.

---

## 4. STANDALONE (`standalone`)
Modo por defecto. Minimalista.

**Comando:**
*   **Compilación**: `tsc -p tsconfig.json`
*   **Bypass**: No se ejecuta `bun build`.
*   **Extracción**: Se extrae solo el `.js` del archivo de entrada actual.

---

## Diferencias en Fidelidad
*   **Full/Domain (Bun)**: El código puede ser optimizado (ej. `const` -> `var` si el target es viejo, aunque Forge intenta forzar modernidad).
*   **Recursive/Standalone (TSC)**: Fidelidad 1:1. Lo que produce TSC ESNext es lo que llega al usuario.
