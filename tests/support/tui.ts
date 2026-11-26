import { spawn } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
// Ink errors render in a red "ERROR" box; React reports hook misuse as "Invalid hook call".
const failure = /Invalid hook call|\bERROR\b/;

/**
 * Runs the interactive TUI and resolves with the screen text once `expected` appears.
 * Ink needs a TTY with raw-mode stdin, which pipes cannot provide. On POSIX the CLI runs
 * under a real pseudo-terminal via the system `script` utility; Windows has no `script`,
 * so there (or with `mode: 'fake-tty'`) a preload makes the CLI's piped stdio look like
 * a terminal. Both run the shipped entry point and its module resolution unchanged.
 */
export async function renderTui(options: { entry: string; args: string[]; cwd: string; expected: RegExp; env?: NodeJS.ProcessEnv; timeoutMs?: number; mode?: 'pty' | 'fake-tty' }): Promise<string> {
  const mode = options.mode ?? (process.platform === 'win32' ? 'fake-tty' : 'pty');
  const command = mode === 'fake-tty'
    ? [process.execPath, '--import', new URL('./fake-tty.mjs', import.meta.url).href, options.entry, ...options.args]
    : [process.execPath, options.entry, ...options.args];
  const [file, args] = mode === 'fake-tty' ? [command[0]!, command.slice(1)]
    : process.platform === 'darwin' ? ['script', ['-q', '/dev/null', ...command]]
    : ['script', ['-qfec', command.map(quote).join(' '), '/dev/null']];
  // Ink only writes its final frame, on exit, when it detects CI (`CI`/`CONTINUOUS_INTEGRATION`).
  const env = { ...process.env, ...options.env, COLUMNS: '120', LINES: '40', CI: 'false', CONTINUOUS_INTEGRATION: 'false' };
  // BSD `script` (macOS) cannot read a socket stdin, which is what Node pipes are there.
  // `detached` makes `script` a process-group leader so cleanup can signal the group.
  const child = spawn(file, args, { cwd: options.cwd, env, stdio: [mode === 'pty' && process.platform === 'darwin' ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: mode === 'pty' });
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
  let raw = '';
  const screen = () => stripVTControlCharacters(raw).replaceAll('\r', '');
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    // `script` runs the CLI in its own session on the pty, out of reach of a group
    // signal; killing `script` closes the pty and the CLI exits on the resulting SIGHUP.
    try {
      if (mode === 'pty') process.kill(-child.pid!, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch (error) {
      // It exited between the check and the signal; anything else is a real leak.
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    await exited;
  };
  let rendered: string;
  try {
    rendered = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`TUI did not render ${options.expected} within ${options.timeoutMs ?? 20_000}ms:\n${screen()}`)), options.timeoutMs ?? 20_000);
      const check = () => {
        const text = screen();
        if (failure.test(text)) { clearTimeout(timer); reject(new Error(`TUI failed to render:\n${text}`)); }
        else if (options.expected.test(text)) { clearTimeout(timer); resolve(text); }
      };
      child.stdout!.on('data', (chunk) => { raw += chunk; check(); });
      child.stderr!.on('data', (chunk) => { raw += chunk; check(); });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code) => { clearTimeout(timer); reject(new Error(`TUI exited (${code}) before rendering ${options.expected}:\n${screen()}`)); });
    });
  } catch (error) {
    // The render failure is the result; a cleanup error must not replace it.
    await stop().catch(() => undefined);
    throw error;
  }
  await stop();
  return rendered;
}
