/**
 * Agent composition logic for harness agents.
 *
 * Composes a root AGENT.md with tool-specific adapters at install time.
 * The composition produces a single AGENT.md file with:
 *   - Frontmatter from the tool adapter (authoritative for harness-specific config)
 *   - Body from the root AGENT.md (shared instructions)
 *   - Optional additional body from the tool adapter (tool-specific additions)
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.js';

/**
 * Error types that can occur during agent composition.
 */
export type CompositionErrorType =
  | 'missing_root'
  | 'missing_tool_adapter'
  | 'invalid_root_frontmatter'
  | 'invalid_adapter_frontmatter'
  | 'missing_sibling'
  | 'write_failed';

/**
 * Structured error from agent composition. Extends Error so callers using
 * `error instanceof Error` (standard catch-block pattern) get a real message.
 */
export class CompositionError extends Error {
  type: CompositionErrorType;
  toolId?: string;
  filePath?: string;

  constructor(options: { type: CompositionErrorType; message: string; toolId?: string; filePath?: string }) {
    super(options.message);
    this.name = 'CompositionError';
    this.type = options.type;
    this.toolId = options.toolId;
    this.filePath = options.filePath;
  }
}

/**
 * Result of composing an agent for a specific tool.
 */
export interface ComposedAgent {
  /** The composed AGENT.md content (frontmatter + body) */
  content: string;
  /** Non-AGENT.md files from the tool directory to copy alongside */
  siblingFiles: string[];
}

/**
 * Parse YAML frontmatter from a string, returning the raw YAML block and body.
 * Unlike parseFrontmatter, this doesn't validate the structure.
 */
function extractFrontmatter(
  content: string,
): { yamlBlock: string; body: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const [, yamlBlock, body] = match;
  return { yamlBlock, body: body.trim() };
}

/**
 * Compose an agent for installation to a specific tool.
 *
 * Composition rules:
 * 1. Tool adapter frontmatter is authoritative (harness-specific config)
 * 2. Root AGENT.md provides shared markdown body
 * 3. Tool adapter can append additional body content
 * 4. Sibling files from tool directory are collected for copying
 *
 * @param agentDir - Absolute path to the agent directory (containing AGENT.md)
 * @param toolId - The tool ID (e.g., 'claude-code', 'cursor', 'github-copilot')
 * @returns The composed agent content and sibling file paths
 * @throws CompositionError if composition fails
 */
export async function composeAgent(
  agentDir: string,
  toolId: string,
): Promise<ComposedAgent> {
  // Read root AGENT.md
  const rootAgentMdPath = path.join(agentDir, 'AGENT.md');
  let rootContent: string;
  try {
    rootContent = await readFile(rootAgentMdPath, 'utf-8');
  } catch {
    throw new CompositionError({
      type: 'missing_root',
      message: `Root AGENT.md not found at ${rootAgentMdPath}`,
      filePath: rootAgentMdPath,
    });
  }

  // Parse root AGENT.md (body only, we don't use its frontmatter)
  const rootParsed = parseFrontmatter(rootContent);
  const rootBody = rootParsed?.body ?? rootContent.trim();

  // Check for tool adapter directory
  // For github-copilot, accept both 'github-copilot' and 'copilot' (prefer 'github-copilot')
  let toolDirName: string;
  if (toolId === 'github-copilot') {
    const githubCopilotPath = path.join(agentDir, 'github-copilot', 'AGENT.md');
    const copilotPath = path.join(agentDir, 'copilot', 'AGENT.md');

    let preferGitHubCopilot = false;
    try {
      await stat(githubCopilotPath);
      preferGitHubCopilot = true;
    } catch {
      // github-copilot directory doesn't exist, check copilot
    }

    toolDirName = preferGitHubCopilot ? 'github-copilot' : 'copilot';
  } else {
    toolDirName = toolId;
  }

  const toolAdapterDir = path.join(agentDir, toolDirName);
  const toolAdapterPath = path.join(toolAdapterDir, 'AGENT.md');

  // Check if tool adapter exists
  let hasToolAdapter = false;
  try {
    const s = await stat(toolAdapterPath);
    hasToolAdapter = s.isFile();
  } catch {
    // Tool adapter doesn't exist - use root-only fallback
  }

  let adapterFrontmatter = '';
  let adapterBody = '';
  let siblingFiles: string[] = [];

  if (hasToolAdapter) {
    // Read tool adapter AGENT.md
    let adapterContent: string;
    try {
      adapterContent = await readFile(toolAdapterPath, 'utf-8');
    } catch {
      throw new CompositionError({
        type: 'missing_tool_adapter',
        message: `Tool adapter AGENT.md not found at ${toolAdapterPath}`,
        toolId,
        filePath: toolAdapterPath,
      });
    }

    // Extract frontmatter and body from adapter
    const adapterExtracted = extractFrontmatter(adapterContent);
    if (adapterExtracted) {
      adapterFrontmatter = `---\n${adapterExtracted.yamlBlock}\n---\n\n`;
      adapterBody = adapterExtracted.body;
    } else {
      // Adapter has no frontmatter - use entire content as body
      adapterBody = adapterContent.trim();
    }

    // Collect sibling files from tool adapter directory
    siblingFiles = await collectSiblingFiles(toolAdapterDir);
  } else {
    // No tool adapter - use minimal frontmatter from root if available
    if (rootParsed?.meta) {
      const { name, description } = rootParsed.meta;
      adapterFrontmatter = `---\nname: ${name}\ndescription: ${description}\n---\n\n`;
    }
  }

  // Compose: adapter frontmatter + root body + adapter body (if present)
  const combinedBody = adapterBody
    ? `${rootBody}\n\n${adapterBody}`
    : rootBody;

  const content = `${adapterFrontmatter}${combinedBody}`;

  return { content, siblingFiles };
}

/**
 * Collect non-AGENT.md files from a tool adapter directory.
 * These files should be copied alongside the composed AGENT.md.
 */
async function collectSiblingFiles(toolDir: string): Promise<string[]> {
  const siblings: string[] = [];

  try {
    const entries = await readdir(toolDir, { withFileTypes: true });
    for (const entry of entries) {
      // Only collect files (not directories), exclude AGENT.md
      if (entry.isFile() && entry.name !== 'AGENT.md') {
        siblings.push(path.join(toolDir, entry.name));
      }
    }
  } catch {
    // Directory doesn't exist or can't be read - return empty
  }

  return siblings;
}
