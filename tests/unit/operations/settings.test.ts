import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSettings, updateSettings } from '../../../src/operations/settings.js';
import { readConfig, updateConfig } from '../../../src/bundle/cache.js';
import { setTelemetryDisabledByConfig } from '../../../src/telemetry.js';

let testHome: string;
vi.mock('../../../src/lib/platform.js', async (original) => ({
  ...await original<typeof import('../../../src/lib/platform.js')>(), getHomeDir: () => testHome,
}));
vi.mock('../../../src/telemetry.js', () => ({ setTelemetryDisabledByConfig: vi.fn() }));

beforeEach(async () => {
  testHome = await mkdtemp(path.join(os.tmpdir(), 'agentman-settings-'));
  vi.clearAllMocks();
});
afterEach(async () => { await rm(testHome, { recursive: true, force: true }); });

describe('settings service', () => {
  it('patches settings without replacing sources or unrelated config', async () => {
    await updateConfig((config) => { config.baseUrl = 'https://skills.example.com'; });
    await updateSettings({ startupUpdateChecksDisabled: true });
    await updateSettings({ telemetryDisabled: true });
    expect(await getSettings({})).toEqual({
      startupUpdateChecksDisabled: true, telemetryDisabled: true,
      envOverrides: { startupUpdateChecksDisabled: false, telemetryDisabled: false },
    });
    expect((await readConfig()).baseUrl).toBe('https://skills.example.com');
    expect(setTelemetryDisabledByConfig).toHaveBeenLastCalledWith(true);
    await updateSettings({ telemetryDisabled: false });
    expect((await readConfig()).startupUpdateChecksDisabled).toBe(true);
  });

  it('reports environment overrides separately from saved preferences', async () => {
    const settings = await getSettings({ DO_NOT_TRACK: 'true', AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS: 'on' });
    expect(settings.telemetryDisabled).toBe(false);
    expect(settings.startupUpdateChecksDisabled).toBe(false);
    expect(settings.envOverrides).toEqual({ startupUpdateChecksDisabled: true, telemetryDisabled: true });
    expect((await getSettings({ DISABLE_TELEMETRY: 'false' })).envOverrides.telemetryDisabled).toBe(false);
  });
});
