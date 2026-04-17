const vscode = require('vscode');
const path = require('path');

/**
 * Detects if the current version is a pre-release (alpha, beta, rc).
 * Debug logs are ONLY emitted for pre-release versions.
 */
function isPreRelease() {
    try {
        const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
        return /-(alpha|beta|rc|dev|canary)/.test(pkg.version);
    } catch {
        return false; // If we can't read it, assume production
    }
}
const isPreReleaseConstant = isPreRelease();
class Logger {
    constructor() {
        this.channel = vscode.window.createOutputChannel("Forge TypeLayer", "log");
        this._debugEnabled = isPreReleaseConstant;
        if (this._debugEnabled) {
            this.channel.appendLine(`[BOOT] Debug logging ENABLED (pre-release detected)`);
        }
    }

    _ts() {
        return new Date().toISOString().split('T')[1].slice(0, -1);
    }

    info(message) {
        this.channel.appendLine(`[${this._ts()}] [INFO] ${message}`);
    }

    /**
     * Debug logs — ONLY visible on pre-release versions (alpha/beta/rc).
     * Production users never see this noise.
     */
    debug(message) {
        if (!this._debugEnabled) return;
        this.channel.appendLine(`[${this._ts()}] 🔍 [DEBUG] ${message}`);
    }

    warn(message) {
        this.channel.appendLine(`[${this._ts()}] ⚠️ [WARN] ${message}`);
    }

    error(message, err) {
        this.channel.appendLine(`[${this._ts()}] 💥 [ERROR] ${message}`);
        if (err) {
            this.channel.appendLine(err.stack || err.toString());
        }
    }

    show() {
        this.channel.show(true); // true = preserve focus
    }

    dispose() {
        this.channel.dispose();
    }
}

// Singleton pattern
const logger = new Logger();

module.exports = {
    logger
};
