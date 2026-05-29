import { parse as parseYaml } from 'yaml';

export interface AssetConfig {
  name: string;
  description: string;
  tags?: string[];
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
