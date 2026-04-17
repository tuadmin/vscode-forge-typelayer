let vscode;
try {
    vscode = require('vscode');
} catch {
    // Running outside of VS Code (e.g. unit tests)
}
const path = require('path');
const fs = require('fs');

/**
 * SOURCE OF TRUTH: All translations come from l10n/bundle.l10n.json
 * This utility bridges the gap between VS Code's runtime l10n and the unit test environment.
 */
let testDictionary = null;

function loadTestDictionary() {
    if (testDictionary) return testDictionary;
    try {
        const baseDir = path.join(__dirname, '..', '..', 'l10n');
        const enPath = path.join(baseDir, 'bundle.l10n.json');
        const esPath = path.join(baseDir, 'bundle.l10n.es.json');
        
        testDictionary = {
            en: JSON.parse(fs.readFileSync(enPath, 'utf8')),
            es: JSON.parse(fs.readFileSync(esPath, 'utf8'))
        };
        return testDictionary;
    } catch {
        return { en: {}, es: {} };
    }
}

function t(key, ...args) {
    if (key === '$schema') return ''; // Safety check

    // 1. VS Code Native Way (Preferred at runtime)
    if (vscode && vscode.l10n && typeof vscode.l10n.t === 'function') {
        const nativeResult = vscode.l10n.t(key, ...args);
        // If nativeResult is different from key, it found a translation.
        // If it's the same, it might have failed to load the bundle (common in Dev Host).
        if (nativeResult !== key) return nativeResult;
    }

    // 2. Fallback for Terminal/Test Environment / Failed Native l10n
    const dict = loadTestDictionary();
    const locale = (typeof process !== 'undefined' && process.env.LANG && process.env.LANG.startsWith('es')) ? 'es' : 'en';
    
    let text = dict[locale]?.[key] || dict['en']?.[key] || key;
    
    // Simple placeholder replacement for tests
    args.forEach((arg, i) => {
        text = text.replace(`{${i}}`, arg);
    });
    
    return text;
}

module.exports = {
    t
};
