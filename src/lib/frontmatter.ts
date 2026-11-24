import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

export interface AssetConfig {
  name: string;
  description: string;
  tags?: string[];
}

/**
 * The `name` declared in a markdown file's frontmatter, if any. Unlike
 * parseFrontmatter this needs no other fields, so it works on any SKILL.md.
 */
export function parseFrontmatterName(content: string): string | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;
  try {
    const name = parseYaml(match[1])?.name;
    return typeof name === 'string' && name.trim() ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** The `name` declared by the SKILL.md at `skillMdPath`, if readable. */
export async function readDeclaredSkillName(skillMdPath: string): Promise<string | undefined> {
  try {
    return parseFrontmatterName(await readFile(skillMdPath, 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * Parse YAML frontmatter from a markdown file's content.
 * Returns the parsed AssetConfig and the body content after the frontmatter.
 */
export function parseFrontmatter(content: string): { meta: AssetConfig; body: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const [, yamlBlock, body] = match;
  try {
    const parsed = parseYaml(yamlBlock);
    if (!parsed || typeof parsed.name !== 'string' || typeof parsed.description !== 'string') {
      return null;
    }
    const meta: AssetConfig = {
      name: parsed.name,
      description: parsed.description,
      tags: Array.isArray(parsed.tags) ? parsed.tags : undefined,
    };
    return { meta, body: body.trim() };
  } catch {
    return null;
  }
}
