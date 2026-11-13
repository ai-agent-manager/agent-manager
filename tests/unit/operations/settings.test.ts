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
// Keep the real mode resolver; mock only the call that mutates the process-wide client.
vi.mock('../../../src/telemetry.js', async (original) => ({
  ...await original<typeof import('../../../src/telemetry.js')>(), setTelemetryDisabledByConfig: vi.fn(),
}));

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
      startupUpdateChecksDisabled: true, telemetryDisabled: true, telemetryMode: 'not-configured', uiTheme: 'system',
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

  it('reports the effective telemetry mode separately from the saved preference', async () => {
    const endpoint = { AGENTMAN_TELEMETRY_URL: 'https://telemetry.example.com', AGENTMAN_TELEMETRY_SITE_ID: '7' };
    const tty = { stdinIsTTY: true, stdoutIsTTY: true };
    // Nothing configures an endpoint: the saved opt-out is kept but there is nothing to send to.
    expect((await getSettings({}, tty)).telemetryMode).toBe('not-configured');
    await updateSettings({ telemetryDisabled: true });
    expect(await getSettings({}, tty)).toMatchObject({ telemetryDisabled: true, telemetryMode: 'not-configured' });
    // An environment endpoint makes the saved preference decide.
    expect((await getSettings(endpoint, tty)).telemetryMode).toBe('disabled');
    await updateSettings({ telemetryDisabled: false });
    expect((await getSettings(endpoint, tty)).telemetryMode).toBe('enabled');
    // Environment opt-outs, CI and an explicitly non-interactive stream suppress a configured endpoint.
    expect((await getSettings({ ...endpoint, DO_NOT_TRACK: '1' }, tty)).telemetryMode).toBe('disabled');
    expect((await getSettings({ ...endpoint, CI: 'true' }, tty)).telemetryMode).toBe('disabled');
    expect((await getSettings(endpoint, { stdinIsTTY: true, stdoutIsTTY: false })).telemetryMode).toBe('disabled');
    // A piped stream reports undefined, not false, and is not suppressed (as the client behaves).
    expect((await getSettings(endpoint, {})).telemetryMode).toBe('enabled');
  });
});
