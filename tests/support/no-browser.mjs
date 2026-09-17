// Load before the CLI entry point on every platform, including installed tarballs.
// Intercept only the OS-launch boundary; CLI argument parsing remains real.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync } from 'node:fs';
import path from 'node:path';

const original = childProcess.execFile;
childProcess.execFile = function (command, ...args) {
  if (/^(xdg-open|open|rundll32(?:\.exe)?)$/i.test(path.basename(command))) {
    // Do not record the URL: it contains the temporary bootstrap token.
    appendFileSync(process.env.AGENTMAN_TEST_BROWSER_SENTINEL, `${path.basename(command)}\n`);
    throw new Error('Test child attempted to launch a browser despite --no-open.');
  }
  return original.call(this, command, ...args);
};
syncBuiltinESMExports();
