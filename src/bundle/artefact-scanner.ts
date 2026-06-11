import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter, type AssetConfig } from '../lib/frontmatter.js';
import { parseArtefactUrl } from './artefact-downloader.js';
import { scanBundle } from './scanner.js';
import type { SkillInfo } from './scanner.js';
import type { ArtefactSkillSource } from './skill-source.js';

export interface ArtefactScanResult {
  skills: SkillInfo[];
  /** The resolved directory used for skill discovery */
  skillsDir: string;
}

/**
 * Scan an extracted artefact directory for installable skills and validate
 * that the artefact is a supported skill package.
 *
 * Supported layouts, in resolution order:
 *   1. SKILL.md at the artefact root        → single skill named after the zip
 *   2. <skill-id>/SKILL.md directories      → one or more skills (bundle layout)
 *   3. <wrapper>/<skill-id>/SKILL.md        → single top-level wrapper directory
 *      containing skill directories (descended once)
 *
 * Delegates to scanBundle() for directory layouts so metadata resolution and
 * rovo-agent validation behave identically to bundle installs.
 *
 * Throws a descriptive error when no SKILL.md can be found — the artefact is
 * not a supported skill package and must not be installed.
 */
export async function scanArtefactForSkills(
  extractDir: string,
  source: ArtefactSkillSource,
): Promise<ArtefactScanResult> {
  // 1. Single-skill artefact: SKILL.md at the root
  const rootSkillMd = path.join(extractDir, 'SKILL.md');
  if (await isFile(rootSkillMd)) {
    const { name } = parseArtefactUrl(source.artefactUrl);
    const meta = await readRootMeta(extractDir, rootSkillMd);
    return {
      skills: [{ dirName: name, dirPath: extractDir, skillMdPath: rootSkillMd, meta }],
      skillsDir: extractDir,
    };
  }

  // 2. Bundle layout: skill directories at the root
  const rootContents = await scanBundle(extractDir);
  if (rootContents.skills.length > 0) {
    return { skills: rootContents.skills, skillsDir: extractDir };
  }

  // 3. Single top-level wrapper directory containing skill directories
  const entries = await readdir(extractDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));
  if (dirs.length === 1) {
    const wrapperDir = path.join(extractDir, dirs[0].name);
    const wrapped = await scanBundle(wrapperDir);
    if (wrapped.skills.length > 0) {
      return { skills: wrapped.skills, skillsDir: wrapperDir };
    }
  }

  throw new Error(
    `No skills found in artefact: ${source.artefactUrl}\n` +
      `  Expected a SKILL.md at the artefact root, or skill directories\n` +
      `  each containing a SKILL.md file.`,
  );
}

/**
 * Resolve display metadata for a root-level skill: prefer README.md
 * frontmatter, fall back to SKILL.md frontmatter.
 */
async function readRootMeta(extractDir: string, skillMdPath: string): Promise<AssetConfig | null> {
  for (const candidate of [path.join(extractDir, 'README.md'), skillMdPath]) {
    try {
      const content = await readFile(candidate, 'utf-8');
      const result = parseFrontmatter(content);
      if (result?.meta) return result.meta;
    } catch {
      // Try the next candidate
    }
  }
  return null;
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}
