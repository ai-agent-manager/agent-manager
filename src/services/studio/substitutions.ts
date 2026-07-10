import type { KnowledgePage } from '../confluence/types.js';
import type { RovoAgentConfig } from '../../bundle/scanner.js';

// ---------------------------------------------------------------------------
// In-memory knowledge-base URL substitution
// ---------------------------------------------------------------------------

/**
 * Replace every `filename.md` reference in a string with a Markdown link
 * `[title](url)` pointing to the corresponding Confluence page.
 *
 * For example, given a Confluence page `{ title: '01_epic_breakdown_analysis', url: 'https://…' }`:
 *
 *   Before: `- 01_epic_breakdown_analysis.md (7 sections, simplified)`
 *   After:  `- [01_epic_breakdown_analysis](https://…) (7 sections, simplified)`
 *
 * The replacement happens in-memory before the text is pasted into Studio —
 * no source files are modified.
 */
export function substituteKbFilenames(text: string, pages: KnowledgePage[]): string {
  let result = text;
  for (const page of pages) {
    const filename = `${page.title}.md`;
    // Escape special regex characters in the filename (underscores, dots, etc.)
    const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Avoid double-wrapping if already a Markdown link
    const pattern = new RegExp(`(?<![([])${escaped}(?!\\])`, 'g');
    result = result.replace(pattern, `[${page.title}](${page.url})`);
  }
  return result;
}

/**
 * Return a deep copy of `config` with all knowledge-base filename references
 * in text fields replaced with Confluence page URLs (via {@link substituteKbFilenames}).
 *
 * Fields processed:
 *  - `scenarios.default.instructions`
 *  - `scenarios.custom[*].instructions`
 */
export function applyKbUrlSubstitutions(config: RovoAgentConfig, pages: KnowledgePage[]): RovoAgentConfig {
  if (pages.length === 0) return config;
  return {
    ...config,
    scenarios: {
      default: {
        ...config.scenarios.default,
        instructions: substituteKbFilenames(config.scenarios.default.instructions, pages),
      },
      custom: config.scenarios.custom?.map((s) => ({
        ...s,
        instructions: substituteKbFilenames(s.instructions, pages),
      })),
    },
  };
}
