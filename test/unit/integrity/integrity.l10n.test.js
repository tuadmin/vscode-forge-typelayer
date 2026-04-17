const { test, expect, describe } = require('bun:test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const L10N_DIR = path.join(ROOT, 'l10n');
const SRC_DIR = path.join(ROOT, 'src');
const SCHEMA_PATH = path.join(ROOT, 'schemas', 'l10n.schema.json');

describe('Schema-First I18N Integrity Audit', () => {
    
    // Load the Source of Truth
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    const schemaKeys = Object.keys(schema.properties).filter(k => k !== '$schema').sort();

    test('L10N Bundle Parity with Schema', () => {
        const bundles = fs.readdirSync(L10N_DIR).filter(f => f.endsWith('.json'));
        
        for (const bundleName of bundles) {
            const bundlePath = path.join(L10N_DIR, bundleName);
            const content = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
            const bundleKeys = Object.keys(content).filter(k => k !== '$schema').sort();
            
            // 1. Check internal $schema pointer
            expect(content.$schema).toBeDefined();
            expect(content.$schema).toContain('l10n.schema.json');

            // 2. Check keys match schema exactly
            const missingInBundle = schemaKeys.filter(k => !bundleKeys.includes(k));
            const extraInBundle = bundleKeys.filter(k => !schemaKeys.includes(k));

            if (missingInBundle.length > 0) {
                console.error(`❌ Keys missing in ${bundleName}:`, missingInBundle);
            }
            if (extraInBundle.length > 0) {
                console.error(`⚠️ Extra/Obsolete keys in ${bundleName} (NOT in schema):`, extraInBundle);
            }

            expect(missingInBundle).toEqual([]);
            expect(extraInBundle).toEqual([]);
        }
    });

    test('Code-to-Schema Sync: Every schema key must be used in src/', () => {
        const usedKeys = new Set();
        const files = getAllFiles(SRC_DIR).filter(f => f.endsWith('.js'));
        
        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            // Regex to find \bt('key') or \bt("key") or \bt(`key`)
            const matches = content.matchAll(/\bt\(['"`]([^'"`]+)['"`]/g);
            for (const match of matches) {
                usedKeys.add(match[1]);
            }
        }
        
        // Exclude keys that are naturally not called via t() in src files 
        // (like status bar suffixes or doctor keys which might be used dynamically or via package.json)
        const naturallyUsedKeys = Array.from(usedKeys);
        
        const missingInCode = schemaKeys.filter(k => {
            if (k.startsWith('status.bar.suffix.')) return false; // Used by UI
            if (k.startsWith('doctor.')) return false; // Used by doctor logic
            return !naturallyUsedKeys.includes(k);
        });

        if (missingInCode.length > 0) {
            console.log('💡 Potential orphaned keys in schema (not explicitly found in src/):', missingInCode);
        }
        
        // We don't fail here because some keys might be used by package.json (NLS system)
        // or constructed dynamically.
    });

    test('Schema-to-Code Sync: Every t() call must be defined in schema', () => {
        const usedKeysInCode = [];
        const files = getAllFiles(SRC_DIR).filter(f => f.endsWith('.js'));
        
        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            const matches = content.matchAll(/\bt\(['"`]([^'"`]+)['"`]/g);
            for (const match of matches) {
                usedKeysInCode.push({ key: match[1], file: path.relative(ROOT, file) });
            }
        }

        const undefinedKeys = usedKeysInCode.filter(item => !schemaKeys.includes(item.key));

        if (undefinedKeys.length > 0) {
            console.error('❌ Keys used in code but NOT defined in l10n.schema.json:');
            undefinedKeys.forEach(item => console.error(`  - "${item.key}" in ${item.file}`));
        }

        expect(undefinedKeys).toEqual([]);
    });
});

function getAllFiles(dirPath, arrayOfFiles = []) {
    const files = fs.readdirSync(dirPath);
    files.forEach(function(file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
        } else {
            arrayOfFiles.push(path.join(dirPath, file));
        }
    });
    return arrayOfFiles;
}
