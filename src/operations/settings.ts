import { readConfig, updateConfig } from '../bundle/cache.js';
import { setTelemetryDisabledByConfig } from '../telemetry.js';

export interface SettingsPatch {
  startupUpdateChecksDisabled?: boolean;
  telemetryDisabled?: boolean;
  uiTheme?: 'system' | 'light' | 'dark';
}

export interface Settings extends Required<SettingsPatch> {
  /** Environment flags that force a setting off, regardless of its saved value. */
  envOverrides: Required<Pick<SettingsPatch, 'startupUpdateChecksDisabled' | 'telemetryDisabled'>>;
}

const enabled = (value: string | undefined): boolean => /^(1|true|yes|on)$/i.test(value ?? '');

export async function getSettings(env: NodeJS.ProcessEnv = process.env): Promise<Settings> {
  const config = await readConfig();
  return {
    startupUpdateChecksDisabled: config.startupUpdateChecksDisabled ?? false,
    telemetryDisabled: config.telemetryDisabled ?? false,
    uiTheme: config.uiTheme === 'light' || config.uiTheme === 'dark' ? config.uiTheme : 'system',
    envOverrides: {
      startupUpdateChecksDisabled: enabled(env.AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS),
      telemetryDisabled: [env.DISABLE_TELEMETRY, env.DO_NOT_TRACK, env.AGENTMAN_TELEMETRY_DISABLED].some(enabled),
    },
  };
}

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  await updateConfig((config) => {
    if (patch.startupUpdateChecksDisabled !== undefined) {
      config.startupUpdateChecksDisabled = patch.startupUpdateChecksDisabled;
    }
    if (patch.telemetryDisabled !== undefined) {
      config.telemetryDisabled = patch.telemetryDisabled;
      setTelemetryDisabledByConfig(patch.telemetryDisabled);
    }
    if (patch.uiTheme !== undefined) config.uiTheme = patch.uiTheme;
  });
  return getSettings();
}
