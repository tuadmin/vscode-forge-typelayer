const fs = require('fs');
const path = require('path');

/**
 * Parses the header of a source file to extract its import/export dependency bounds.
 * Reads line by line until logic begins.
 */
function parseHeaderManifest(sourceAbsPath) {
    const manifest = {
        externals: [],  // Files that break the domain boundary (no '_' or parent dir)
        inlines: [],    // Private files within the same domain (starts with '_', child/same dir)
        hasImports: false,
        isPure: true    // Files with zero dependencies (good for fidelity guarantee)
    };

    if(!fs.existsSync(sourceAbsPath)) {
        return manifest;
    }

    const content = fs.readFileSync(sourceAbsPath, 'utf8');
    const lines = content.split('\n');

    // Regex to capture standard ESM imports/exports
    const regex = /^\s*(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]/m;

    for (const line of lines) {
        const trimmed = line.trim();
        
        // Skip empties and comments
        if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
            continue;
        }

        const match = line.match(regex);
        if (match) {
            manifest.hasImports = true;
            manifest.isPure = false;
            const importPath = match[1];

            // Only track local imports
            if (importPath.startsWith('.')) {
                classifyImport(importPath, manifest);
            }
        } else if (trimmed && !trimmed.startsWith('import ') && !trimmed.startsWith('export ')) {
            // Once we hit actual logic or code, we stop paring to save CPU limits
            break;
        }
    }

    return manifest;
}

function classifyImport(importPath, manifest) {
    const basename = path.basename(importPath);
    const isParent = importPath.startsWith('../');
    const isPrivate = basename.startsWith('_');

    const entry = {
        raw: importPath,
        isTs: importPath.endsWith('.ts'),
        normalized: importPath.endsWith('.ts') ? importPath.replace(/\.ts$/, '') : importPath // base name for flags
    };

    if (isPrivate && !isParent) {
        // Condition: "Rellenar el pavo". Same/Child dir AND starts with _
        manifest.inlines.push(entry);
    } else {
        // Condition: "Lo que está fuera se queda afuera". 
        // Either explicitly touches parent bounds, or lacks privacy flag.
        manifest.externals.push(entry);
    }
}

module.exports = {
    parseHeaderManifest
};
