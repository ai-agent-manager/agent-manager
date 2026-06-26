import path from "node:path";
import { SkillProvisioner } from "./SkillProvisioner.js";
import { getHomeDir } from "../lib/platform.js";
import type { ProvisionerScope } from "./types.js";

/**
 * Cross-client Agent Skills layout (~/.agents/skills/ and .agents/skills/).
 * Used by Pi, OpenClaw-style harnesses, and other tools adopting agentskills.io paths.
 */
export class AgentsProvisioner extends SkillProvisioner {
  readonly id = "agents";
  readonly name = "Agents";

  constructor(options?: ProvisionerScope) {
    super(options);
  }

  getSkillsDir(): string {
    return path.join(getHomeDir(), ".agents", "skills");
  }

  getRepoSkillsDir(repoRoot: string): string {
    return path.join(repoRoot, ".agents", "skills");
  }

  getNote(): string {
    return "Installs to the shared Agent Skills layout (~/.agents/skills/). Compatible with Pi and other cross-client harnesses.";
  }
}
