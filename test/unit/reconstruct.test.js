const assert = require('assert');
const core = require('../../src/core');

describe('reconstruction', () => {
  test('builds reconstructed source header and includes js', () => {
    const out = core.buildReconstructedSource('export const x = 1;\n', 'export declare const x: number;\n', 'index.js');
    assert.ok(out.includes('Reconstructed draft source'));
    assert.ok(out.includes('export const x = 1;'));
    assert.ok(out.includes('export declare const x: number;'));
  });
});
