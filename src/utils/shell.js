/**
 * shell.js
 * 
 * Utilities for cross-platform shell command construction and argument quoting.
 * Handles the differences between Windows (cmd.exe) and Unix (sh/bash).
 */

const isWin = process.platform === 'win32';

/**
 * Quotes an argument for use in a shell command.
 * 
 * Windows: Uses double quotes and escapes internal double quotes with backslashes.
 * Unix: Uses single quotes and handles internal single quotes correctly.
 * 
 * @param {string} arg - The argument to quote
 * @returns {string} The quoted argument
 */
function quoteArg(arg) {
    if (!arg) return '""';
    
    if (isWin) {
        // Windows cmd.exe: wrap in double quotes, escape internal " with \"
        return `"${arg.replace(/"/g, '\\"')}"`;
    } else {
        // Unix shells: wrap in single quotes, escape internal ' by ending quote, 
        // adding escaped ', and restarting quote.
        // Example: it's -> 'it'\''s'
        return `'${arg.replace(/'/g, "'\\''")}'`;
    }
}

module.exports = {
    quoteArg,
    isWin
};
