import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { getAgentmanDir } from '../config/paths.js';

const execFileAsync = promisify(execFile);

export interface GitContributeResult {
  branchName: string;
  clonePath: string;
  remoteUrl: string;
  skillName: string;
  targetPath: string;
}

export interface GitContributeError {
  error: string;
  hint?: string;
}

export async function contributeToRepo(
  remoteUrl: string,
  skillDirPath: string,
  skillName: string,
): Promise<GitContributeResult | GitContributeError> {
  const agentmanDir = getAgentmanDir();
  const tempBase = path.join(agentmanDir, 'contribute-temp');
  await mkdir(tempBase, { recursive: true });

  // Derive a repo slug from the URL for directory naming
  const repoSlug = remoteUrl.replace(/\.git$/i, '').replace(/[/\\:]/g, '_').replace(/^[_]+|[_]+$/g, '');
  const clonePath = path.join(tempBase, repoSlug);

  // Clean up any existing clone
  await rm(clonePath, { recursive: true, force: true });

  // Shallow clone
  try {
    await execFileAsync('git', ['clone', '--depth', '1', remoteUrl, clonePath], {
      timeout: 120_000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: `Failed to clone repository: ${message}`,
      hint: 'Check that the URL is correct and you have access to the repository.',
    };
  }

  // Generate unique branch name
  const shortHash = Math.random().toString(36).slice(2, 8);
  const branchName = `contribute/${skillName}/${shortHash}`;

  // Create and checkout the branch
  try {
    await execFileAsync('git', ['checkout', '-b', branchName], { cwd: clonePath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await rm(clonePath, { recursive: true, force: true });
    return { error: `Failed to create branch: ${message}` };
  }

  // Create target directory skills/<name>/
  const targetDir = path.join(clonePath, 'skills', skillName);
  await mkdir(targetDir, { recursive: true });

  // Copy skill directory contents into target
  try {
    const entries = await readdir(skillDirPath);
    for (const entry of entries) {
      await cp(path.join(skillDirPath, entry), path.join(targetDir, entry), { recursive: true, force: true });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await rm(clonePath, { recursive: true, force: true });
    return { error: `Failed to copy skill files: ${message}` };
  }

  // Configure git user
  let userName = '';
  let userEmail = '';
  try {
    userName = (await execFileAsync('git', ['config', 'user.name'], { cwd: clonePath })).stdout.trim();
  } catch {
    // Warn but continue — user config is nice but not required
    process.stderr.write('Warning: git user.name not configured. Commit will use system defaults.\n');
  }
  try {
    userEmail = (await execFileAsync('git', ['config', 'user.email'], { cwd: clonePath })).stdout.trim();
  } catch {
    process.stderr.write('Warning: git user.email not configured. Commit will use system defaults.\n');
  }

  // Stage and commit
  try {
    await execFileAsync('git', ['add', '.'], { cwd: clonePath });
    const commitResult = await execFileAsync('git', ['status', '--porcelain'], { cwd: clonePath });
    const statusOutput = commitResult.stdout.trim();
    if (statusOutput.length === 0) {
      await rm(clonePath, { recursive: true, force: true });
      return {
        error: 'No changes to commit. The skill may already exist in this repository.',
      };
    }

    const commitMsg = `Add skill: ${skillName}`;
    if (userName && userEmail) {
      await execFileAsync('git', [
        '-c',
        `user.name=${userName}`,
        '-c',
        `user.email=${userEmail}`,
        'commit',
        '-m',
        commitMsg,
      ]);
    } else {
      await execFileAsync('git', ['commit', '-m', commitMsg]);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await rm(clonePath, { recursive: true, force: true });
    return { error: `Failed to commit changes: ${message}` };
  }

  // Push branch
  try {
    await execFileAsync('git', ['push', '-u', 'origin', branchName], { cwd: clonePath, timeout: 60_000 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Check for authentication failure
    if (message.includes('Authentication') || message.includes('authentication') || message.includes('403') || message.includes('401')) {
      return {
        error: `Failed to push: authentication required`,
        hint: 'Ensure you are authenticated with the git host via SSH keys, credential helper, or personal access token.',
      };
    }
    await rm(clonePath, { recursive: true, force: true });
    return { error: `Failed to push branch: ${message}` };
  }

  const targetPath = `skills/${skillName}`;

  return { branchName, clonePath, remoteUrl, skillName, targetPath };
}
