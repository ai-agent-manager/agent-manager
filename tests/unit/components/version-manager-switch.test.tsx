import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { VersionManager } from '../../../src/components/VersionManager.js';
import { switchBundleVersion } from '../../../src/operations/versions.js';
import { trackTelemetryEvent } from '../../../src/telemetry.js';

const menu = vi.hoisted(() => ({ current: undefined as undefined | {
  items: Array<{ value: string; label: string }>;
  onSelect: (item: { value: string }) => void;
} }));
vi.mock('ink-select-input', () => ({ default: (props: typeof menu.current) => { menu.current = props; return null; } }));
vi.mock('../../../src/bundle/cache.js', () => ({
  readConfig: vi.fn(async () => ({ installations: {
    'claude-code': { skill: { bundleVersion: '1.0.0', installedAt: '2026-01-01', method: 'symlink' } },
  } })),
  listCachedBundles: vi.fn(async () => [
    { version: '1.0.0', published: '2026-01-01', isCurrent: true },
    { version: '2.0.0', published: '2026-01-02', isCurrent: false },
  ]),
  removeCachedBundle: vi.fn(),
}));
vi.mock('../../../src/bundle/repo-config.js', () => ({ readRepoConfig: vi.fn(async () => ({ installations: {} })) }));
vi.mock('../../../src/lib/repo.js', () => ({ findRepoRoot: vi.fn(async () => '/example/repo') }));
vi.mock('../../../src/operations/versions.js', () => ({
  switchBundleVersion: vi.fn(), listRemoteVersions: vi.fn(), downloadBundleVersion: vi.fn(),
}));
vi.mock('../../../src/telemetry.js', () => ({
  getBundleSourceTelemetryProperties: vi.fn(() => ({ source: 'url' })),
  trackTelemetryEvent: vi.fn(), trackTelemetryError: vi.fn(),
}));

async function choose(value: string) {
  await vi.waitFor(() => expect(menu.current?.items.some((item) => item.value === value)).toBe(true));
  menu.current!.onSelect({ value });
}

beforeEach(() => { vi.clearAllMocks(); menu.current = undefined; });

it.each([true, false])('uses the shared switch operation with sync=%s and retains telemetry', async (syncInstalled) => {
  const failures = syncInstalled ? ['claude-code/skill: failure'] : [];
  vi.mocked(switchBundleVersion).mockResolvedValue({ failures });
  const onVersionChanged = vi.fn();
  const view = render(<VersionManager currentVersion="1.0.0" source={{ type: 'url', baseUrl: 'https://skills.example.com' }}
    onBack={vi.fn()} onVersionChanged={onVersionChanged} />);
  try {
    await choose('switch');
    await choose('2.0.0');
    await choose(syncInstalled ? 'yes' : 'no');
    await vi.waitFor(() => expect(onVersionChanged).toHaveBeenCalledWith('2.0.0'));
    expect(switchBundleVersion).toHaveBeenCalledExactlyOnceWith({ version: '2.0.0', syncInstalled, repoRoot: '/example/repo' });
    expect(trackTelemetryEvent).toHaveBeenCalledWith({
      action: 'bundle_version_switched', properties: {
        source: 'url', version: '2.0.0', syncedInstalledSkills: String(syncInstalled), failedUpdates: String(failures.length),
      },
    });
  } finally { view.unmount(); }
});
