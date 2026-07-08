import { execFile } from 'node:child_process';
import { readdir, readFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { getAgentmanDir } from '../config/paths.js';
import type { SkillInfo } from '../bundle/scanner.js';
import { parseFrontmatter } from '../lib/frontmatter.js';

const execFileAsync = promisify(execFile);

export interface GitImportResult {
  skills: SkillInfo[];
  clonePath: string;
}

/**
 * Clone a git repository and scan it for skills in the Claude Code
 * plugin marketplace format.
 *
 * Expected layout:
 *   .claude-plugin/plugin.json  (optional but conventional)
 *   skills/<name>/SKILL.md
 *
 * Returns discovered skills in the same SkillInfo shape the bundle
 * scanner uses.
 */
export async function importGitSkills(
  repoUrl: string,
  skillName: string,
): Promise<GitImportResult> {
  const cacheDir = path.join(getAgentmanDir(), 'git-cache');
  // Use a stable directory name based on the skill name
  const clonePath = path.join(cacheDir, skillName);

  // Remove existing clone to get a fresh copy
  await rm(clonePath, { recursive: true, force: true });

  // Shallow clone for speed
  await execFileAsync('git', ['clone', '--depth', '1', repoUrl, clonePath], {
    timeout: 60_000,
  });

  // Scan for skills
  const skills = await scanPluginSkills(clonePath);

  return { skills, clonePath };
}

/**
 * Scan a cloned plugin repo for skills in the marketplace format.
 * Looks for skills/<name>/SKILL.md
 */
async function scanPluginSkills(repoDir: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  // Primary location: skills/ directory
  const skillsDir = path.join(repoDir, 'skills');
  if (await dirExists(skillsDir)) {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dirPath = path.join(skillsDir, entry.name);
      const skillMdPath = path.join(dirPath, 'SKILL.md');
      if (await fileExists(skillMdPath)) {
        const meta = await readSkillMeta(skillMdPath);
        skills.push({
          dirName: entry.name,
          dirPath,
          skillMdPath,
          meta,
        });
      }
    }
  }

  // Also check root-level SKILL.md (single-skill plugin)
  const rootSkillMd = path.join(repoDir, 'SKILL.md');
  if (await fileExists(rootSkillMd)) {
    const meta = await readSkillMeta(rootSkillMd);
    skills.push({
      dirName: path.basename(repoDir),
      dirPath: repoDir,
      skillMdPath: rootSkillMd,
      meta,
    });
  }

  return skills;
}

async function readSkillMeta(skillMdPath: string) {
  try {
    const content = await readFile(skillMdPath, 'utf-8');
    const result = parseFrontmatter(content);
    return result?.meta ?? null;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}
