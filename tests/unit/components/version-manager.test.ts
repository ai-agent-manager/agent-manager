import { describe, it, expect } from 'vitest';
import { buildBrowseItems } from '../../../src/components/VersionManager.js';
import type { IndexEntry } from '../../../src/bundle/downloader.js';

describe('buildBrowseItems', () => {
  const remoteVersions: IndexEntry[] = [
    { version: '1.0.0', published: '2025-01-15T10:00:00' },
    { version: '1.1.0', published: '2025-02-20T12:00:00' },
    { version: '2.0.0', published: '2025-03-10T08:00:00' },
  ];

  it('returns versions in newest-first order', () => {
    const items = buildBrowseItems(remoteVersions, [], null);
    expect(items).toHaveLength(3);
    expect(items[0].value).toBe('2.0.0');
    expect(items[1].value).toBe('1.1.0');
    expect(items[2].value).toBe('1.0.0');
  });

  it('marks the current version with a bullet', () => {
    const items = buildBrowseItems(remoteVersions, ['2.0.0'], '2.0.0');
    const currentItem = items.find((i) => i.value === '2.0.0')!;
    expect(currentItem.label).toContain('\u25CF current');
    // Should NOT also show "cached" — current takes priority
    expect(currentItem.label).not.toContain('\u2713 cached');
  });

  it('marks cached (non-current) versions with a check mark', () => {
    const items = buildBrowseItems(remoteVersions, ['1.0.0', '2.0.0'], '2.0.0');
    const cachedItem = items.find((i) => i.value === '1.0.0')!;
    expect(cachedItem.label).toContain('\u2713 cached');
    expect(cachedItem.label).not.toContain('\u25CF current');
  });

  it('shows no suffix for versions that are neither cached nor current', () => {
    const items = buildBrowseItems(remoteVersions, ['2.0.0'], '2.0.0');
    const uncachedItem = items.find((i) => i.value === '1.1.0')!;
    expect(uncachedItem.label).not.toContain('\u25CF');
    expect(uncachedItem.label).not.toContain('\u2713');
  });

  it('includes the published date in each label', () => {
    const items = buildBrowseItems(remoteVersions, [], null);
    expect(items[0].label).toContain('2025-03-10');
    expect(items[1].label).toContain('2025-02-20');
    expect(items[2].label).toContain('2025-01-15');
  });

  it('returns an empty array when there are no remote versions', () => {
    const items = buildBrowseItems([], [], null);
    expect(items).toHaveLength(0);
  });

  it('handles a single remote version', () => {
    const single: IndexEntry[] = [
      { version: '1.0.0', published: '2025-01-15T10:00:00' },
    ];
    const items = buildBrowseItems(single, [], null);
    expect(items).toHaveLength(1);
    expect(items[0].value).toBe('1.0.0');
  });
});
