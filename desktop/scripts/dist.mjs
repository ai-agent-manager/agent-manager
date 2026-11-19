import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const env = { ...process.env };
for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
  if (!env[key]) delete env[key];
}
if (process.platform === 'win32') {
  delete env.CSC_LINK; delete env.CSC_KEY_PASSWORD;
  if (env.WIN_CSC_LINK) env.CSC_LINK = env.WIN_CSC_LINK;
  if (env.WIN_CSC_KEY_PASSWORD) env.CSC_KEY_PASSWORD = env.WIN_CSC_KEY_PASSWORD;
}
if (!env.CSC_LINK) env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
const notarize = process.platform === 'darwin' && env.CSC_LINK && env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID;
const child = spawn(process.execPath, [require.resolve('electron-builder/cli.js'), '--publish', 'never',
  ...(notarize ? ['--config.mac.notarize=true'] : []), ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
