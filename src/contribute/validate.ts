import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';
import { pathExists } from '../lib/fs.js';

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  skillName: string | null;
  description: string | null;
}

interface RawFrontmatter {
  name?: unknown;
  description?: unknown;
  tags?: unknown;
}

function parseRawFrontmatter(content: string): RawFrontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const [, yamlBlock] = match;
  try {
    const parsed = parseYaml(yamlBlock);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as RawFrontmatter;
  } catch {
    return null;
  }
}

export async function validateSkillDirectory(skillDirPath: string): Promise<ValidationResult> {
  const errors: ValidationError[] = [];

  // Check directory exists
  if (!(await pathExists(skillDirPath))) {
    return {
      valid: false,
      errors: [{ field: 'directory', message: `Directory not found: ${skillDirPath}` }],
      skillName: null,
      description: null,
    };
  }

  // Check for SKILL.md
  const skillMdPath = path.join(skillDirPath, 'SKILL.md');
  if (!(await pathExists(skillMdPath))) {
    return {
      valid: false,
      errors: [{ field: 'SKILL.md', message: `SKILL.md not found in ${skillDirPath}` }],
      skillName: null,
      description: null,
    };
  }

  // Read content
  let content: string;
  try {
    content = await readFile(skillMdPath, 'utf-8');
  } catch {
    return {
      valid: false,
      errors: [{ field: 'SKILL.md', message: `Failed to read SKILL.md: ${skillDirPath}` }],
      skillName: null,
      description: null,
    };
  }

  // Parse frontmatter (raw, without field validation)
  const raw = parseRawFrontmatter(content);
  if (!raw) {
    return {
      valid: false,
      errors: [{ field: 'frontmatter', message: 'Failed to parse frontmatter in SKILL.md' }],
      skillName: null,
      description: null,
    };
  }

  // Validate name
  const name = raw.name;
  let skillName: string | null = null;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    errors.push({ field: 'name', message: 'Frontmatter field "name" is required and must be a non-empty string' });
  } else {
    skillName = name;
  }

  // Validate description
  const description = raw.description;
  let descriptionStr: string | null = null;
  if (!description || typeof description !== 'string' || description.trim() === '') {
    errors.push({ field: 'description', message: 'Frontmatter field "description" is required and must be a non-empty string' });
  } else {
    descriptionStr = description;
  }

  return {
    valid: errors.length === 0,
    errors,
    skillName,
    description: descriptionStr,
  };
}
