import { spawn } from 'node:child_process';

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
// Ink errors render in a red "ERROR" box; React reports hook misuse as "Invalid hook call".
const failure = /Invalid hook call|\bERROR\b/;

/**
 * Runs the interactive TUI under a real pseudo-terminal via the system `script`
 * utility (Ink needs raw-mode stdin, which pipes cannot provide) and resolves with
 * the screen text once `expected` appears. POSIX only: Windows has no `script`.
 */
export async function renderTuiInPty(options: { entry: string; args: string[]; cwd: string; expected: RegExp; env?: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<string> {
  const command = [process.execPath, options.entry, ...options.args];
  const [file, args] = process.platform === 'darwin'
    ? ['script', ['-q', '/dev/null', ...command]]
    : ['script', ['-qfec', command.map(quote).join(' '), '/dev/null']];
  // BSD `script` (macOS) cannot read a socket stdin, which is what Node pipes are there.
  const child = spawn(file, args, { cwd: options.cwd, env: { ...process.env, ...options.env, COLUMNS: '120', LINES: '40' }, stdio: [process.platform === 'darwin' ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: true });
  let raw = '';
  const screen = () => raw.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g, '');
  try {
    return await new Promise<string>((resolve, reject) => {
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
  } finally {
    // Kill the whole group: `script` and the CLI it runs on the pseudo-terminal.
    try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* Already gone. */ }
  }
}
