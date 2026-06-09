import path from 'node:path';
import { getHomeDir, getCursorSkillsDir } from '../lib/platform.js';

export interface ToolDefinition {
  id: string;
  name: string;
  /** Get the system-wide skills install directory for this tool */
  getSkillsDir: () => string;
  /** Get the repo-level skills install directory for this tool */
  getRepoSkillsDir: (repoRoot: string) => string;
  /** Note to display in the TUI (e.g., for Cursor's cross-client caveat) */
  note?: string;
  /** Note to display when installing at repo scope */
  repoNote?: string;
}

export const SKILL_TOOLS: ToolDefinition[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    getSkillsDir: () => path.join(getHomeDir(), '.claude', 'skills'),
    getRepoSkillsDir: (repoRoot: string) => path.join(repoRoot, '.claude', 'skills'),
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    getSkillsDir: () => path.join(getHomeDir(), '.codeium', 'windsurf', 'skills'),
    getRepoSkillsDir: (repoRoot: string) => path.join(repoRoot, '.windsurf', 'skills'),
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    getSkillsDir: () => path.join(getHomeDir(), '.copilot', 'skills'),
    getRepoSkillsDir: (repoRoot: string) => path.join(repoRoot, '.github', 'copilot', 'skills'),
  },
  {
    id: 'cursor',
    name: 'Cursor',
    getSkillsDir: () => getCursorSkillsDir(),
    getRepoSkillsDir: (repoRoot: string) => path.join(repoRoot, '.cursor', 'skills'),
  },
];

export function getToolById(id: string): ToolDefinition | undefined {
  return SKILL_TOOLS.find((t) => t.id === id);
}
