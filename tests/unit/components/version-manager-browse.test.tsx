import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import type { BundleSource } from '../../../src/bundle/source.js';
import type { DiscoveryDocument } from '../../../src/discovery/types.js';

const FRAME_WAIT_MS = 5_000;

// ── mock all async deps the component calls in useEffect ──────────────────────

vi.mock('../../../src/bundle/cache.js', () => ({
  listCachedBundles: vi.fn(async () => []),
  readConfig: vi.fn(async () => ({ baseUrl: 'http://localhost:8080', telemetry: true })),
  setCurrentBundle: vi.fn(async () => {}),
  removeCachedBundle: vi.fn(async () => {}),
  updateSkillVersion: vi.fn(async () => {}),
}));

vi.mock('../../../src/lib/repo.js', () => ({
  findRepoRoot: vi.fn(async () => null),
}));

vi.mock('../../../src/bundle/repo-config.js', () => ({
  readRepoConfig: vi.fn(async () => null),
}));

vi.mock('../../../src/config/tools.js', () => ({
  getSkillTools: vi.fn(() => []),
}));

vi.mock('../../../src/telemetry.js', () => ({
  getBundleSourceTelemetryProperties: vi.fn(() => ({})),
  trackTelemetryError: vi.fn(),
  trackTelemetryEvent: vi.fn(),
}));

// ── import component after mocks ──────────────────────────────────────────────

const { VersionManager } = await import('../../../src/components/VersionManager.js');

// ── helpers ───────────────────────────────────────────────────────────────────

const stubDiscovery: DiscoveryDocument = { version: '1', sources: [] };

const discoverySource: BundleSource = {
  type: 'discovery',
  baseUrl: 'http://localhost:8080',
  discovery: stubDiscovery,
};

const directorySource: BundleSource = {
  type: 'directory',
  dirPath: '/tmp/bundle',
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('VersionManager — Browse available versions visibility', () => {
  it('shows "Browse available versions" for a discovery source', async () => {
    const { lastFrame } = render(
      <VersionManager
        currentVersion="1.0.0"
        source={discoverySource}
        onBack={vi.fn()}
      />
    );
    await vi.waitFor(
      () => expect(lastFrame()).toContain('Browse available versions'),
      { timeout: FRAME_WAIT_MS, interval: 20 },
    );
  });

  it('hides "Browse available versions" for a directory source', async () => {
    const { lastFrame } = render(
      <VersionManager
        currentVersion="1.0.0"
        source={directorySource}
        onBack={vi.fn()}
      />
    );
    await vi.waitFor(
      () => expect(lastFrame()).toContain('Switch active version'),
      { timeout: FRAME_WAIT_MS, interval: 20 },
    );
    expect(lastFrame()).not.toContain('Browse available versions');
  });
});
