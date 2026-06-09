import { stat } from 'node:fs/promises';
import path from 'node:path';
import { scanBundle } from './scanner.js';
import type { SkillInfo } from './scanner.js';
import type { RepoSkillSource } from './skill-source.js';

export interface RepoScanResult {
  skills: SkillInfo[];
  /** The resolved skills directory used for scanning */
  skillsDir: string;
}

/**
 * Scan an extracted repository directory for installable skills.
 *
 * Resolution order:
 *   1. If source.skillPath is set, treat that path as a single skill directory.
 *   2. Otherwise, scan the `skills/` subdirectory at the repository root.
 *
 * Expects the standard layout: skills/<skill-id>/SKILL.md
 * Delegates to scanBundle() so skill discovery is consistent with bundle installs.
 *
 * Throws descriptive errors when no skills directory or no SKILL.md files are found.
 */
export async function scanRepoForSkills(
  extractDir: string,
  source: RepoSkillSource,
): Promise<RepoScanResult> {
  if (source.skillPath) {
    return scanSingleSkill(extractDir, source.skillPath, source.repoUrl);
  }
  return scanSkillsDirectory(extractDir, source.repoUrl);
}

async function scanSkillsDirectory(extractDir: string, repoUrl: string): Promise<RepoScanResult> {
  const skillsDir = path.join(extractDir, 'skills');

  if (!(await isDirectory(skillsDir))) {
    throw new Error(
      `No skills/ directory found in ${repoUrl}\n` +
        `  Expected skills to be under a "skills/" directory at the repository root.\n` +
        `  Each skill must contain a SKILL.md file: skills/<skill-id>/SKILL.md`,
    );
  }

  const contents = await scanBundle(skillsDir);

  if (contents.skills.length === 0) {
    throw new Error(
      `No skills found in ${repoUrl}\n` +
        `  Looked in: ${skillsDir}\n` +
        `  Each skill directory must contain a SKILL.md file.`,
    );
  }

  return { skills: contents.skills, skillsDir };
}

async function scanSingleSkill(
  extractDir: string,
  skillPath: string,
  repoUrl: string,
): Promise<RepoScanResult> {
  const skillDir = path.join(extractDir, skillPath);
  const skillMdPath = path.join(skillDir, 'SKILL.md');

  if (!(await isDirectory(skillDir))) {
    throw new Error(
      `Skill path not found in ${repoUrl}: "${skillPath}"\n` +
        `  Check that the path exists in the repository.`,
    );
  }

  if (!(await isFile(skillMdPath))) {
    throw new Error(
      `No SKILL.md found at "${skillPath}" in ${repoUrl}\n` +
        `  Expected: ${skillMdPath}`,
    );
  }

  const dirName = path.basename(skillDir);
  const skillsDir = path.dirname(skillDir);

  // Use scanBundle on the parent so we get full metadata resolution
  const contents = await scanBundle(skillsDir);
  const skill = contents.skills.find((s) => s.dirName === dirName);

  if (!skill) {
    throw new Error(
      `Could not resolve skill at "${skillPath}" in ${repoUrl}. ` +
        `Ensure the directory contains a valid SKILL.md file.`,
    );
  }

  return { skills: [skill], skillsDir };
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}
