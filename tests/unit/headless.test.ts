import { describe, it, expect } from 'vitest';
import { buildPinForDirectorySource } from '../../src/headless.js';

describe('buildPinForDirectorySource', () => {
  it('pins a directory source as bundle with bundleVersion, no repoUrl or artefactUrl', () => {
    const pin = buildPinForDirectorySource('/local/my-bundle', '2026.07.01');
    expect(pin.sourceType).toBe('bundle');
    expect(pin.installLayout).toBe('flat');
    expect(pin.bundleVersion).toBe('2026.07.01');
    expect(pin.bundleBaseUrl).toBeUndefined();
    expect(pin.repoUrl).toBeUndefined();
    expect(pin.artefactUrl).toBeUndefined();
  });
});
