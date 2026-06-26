import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PrResult {
  prUrl: string;
  created: true;
}

export interface PrSkipped {
  created: false;
  reason: 'not-github' | 'gh-not-installed' | 'user-declined';
}

export type PrOutcome = PrResult | PrSkipped;

export function isGithubRepo(remoteUrl: string): boolean {
  const patterns = [/github\.com/i, /git@github\.com/i];
  return patterns.some((pattern) => pattern.test(remoteUrl));
}

export async function isGhAvailable(): Promise<boolean> {
  try {
    await execFileAsync('which', ['gh']);
    return true;
  } catch {
    return false;
  }
}

export async function createDraftPr(
  remoteUrl: string,
  branchName: string,
  skillTitle: string,
  skillDescription: string,
): Promise<PrOutcome> {
  const available = await isGhAvailable();
  if (!available) {
    return { created: false, reason: 'gh-not-installed' };
  }

  try {
    const result = await execFileAsync('gh', [
      'pr',
      'create',
      '--draft',
      '--title',
      skillTitle,
      '--body',
      skillDescription,
      '--head',
      branchName,
    ]);

    // gh pr create outputs the PR URL on success
    const output = (result.stdout + result.stderr).trim();
    const urlMatch = output.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/);
    const prUrl = urlMatch?.[0] ?? '';

    return { created: true, prUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Warning: Failed to create PR: ${message}\n`);
    return { created: false, reason: 'gh-not-installed' };
  }
}
