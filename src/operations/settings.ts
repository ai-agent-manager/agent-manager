import { readConfig, updateConfig } from '../bundle/cache.js';
import { resolveTelemetryMode, setTelemetryDisabledByConfig, type TelemetryMode } from '../telemetry.js';

export interface SettingsPatch {
  startupUpdateChecksDisabled?: boolean;
  telemetryDisabled?: boolean;
  uiTheme?: 'system' | 'light' | 'dark';
}

export interface Settings extends Required<SettingsPatch> {
  /** Environment flags that force a setting off, regardless of its saved value. */
  envOverrides: Required<Pick<SettingsPatch, 'startupUpdateChecksDisabled' | 'telemetryDisabled'>>;
  /**
   * What this process would do with a telemetry event right now, as opposed to the saved
   * preference in `telemetryDisabled`. Callers of this facade (the UI server and desktop
   * shell) never hand a source's discovery telemetry block to the process-wide client, so
   * only environment variables can configure an endpoint here. The TUI and headless runs
   * do apply the active source's block and resolve their own mode from it.
   */
  telemetryMode: TelemetryMode;
}

type TtyState = { stdinIsTTY?: boolean; stdoutIsTTY?: boolean };

const enabled = (value: string | undefined): boolean => /^(1|true|yes|on)$/i.test(value ?? '');

export async function getSettings(
  env: NodeJS.ProcessEnv = process.env,
  ttyState: TtyState = { stdinIsTTY: process.stdin.isTTY, stdoutIsTTY: process.stdout.isTTY },
): Promise<Settings> {
  const config = await readConfig();
  const telemetryDisabled = config.telemetryDisabled ?? false;
  return {
    startupUpdateChecksDisabled: config.startupUpdateChecksDisabled ?? false,
    telemetryDisabled,
    telemetryMode: resolveTelemetryMode(undefined, env, ttyState, telemetryDisabled),
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
