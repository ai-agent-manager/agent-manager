import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { ClaudeCodeAgentProvisioner } from "../../../src/provisioners/ClaudeCodeAgentProvisioner.js";
import { CopilotAgentProvisioner } from "../../../src/provisioners/CopilotAgentProvisioner.js";
import { CursorAgentProvisioner } from "../../../src/provisioners/CursorAgentProvisioner.js";

describe("AgentProvisioner", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `agent-provisioner-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("checkDependencies", () => {
    it("returns installed and missing skills", async () => {
      // Create a fake installed skill
      const skillsDir = join(tempDir, ".claude", "skills");
      await mkdir(join(skillsDir, "installed-skill"), { recursive: true });

      // Mock getSkillsDir to use our temp directory
      const provisionerWithTempDir = new TestAgentProvisioner(tempDir);

      const result = await provisionerWithTempDir.checkDependencies({
        bundle: "self",
        skills: ["installed-skill", "missing-skill"],
      });

      expect(result.installed).toContain("installed-skill");
      expect(result.missing).toContain("missing-skill");
    });

    it("returns all missing when no skills installed", async () => {
      const provisionerWithTempDir = new TestAgentProvisioner(tempDir);

      const result = await provisionerWithTempDir.checkDependencies({
        bundle: "self",
        skills: ["skill-a", "skill-b"],
      });

      expect(result.installed).toHaveLength(0);
      expect(result.missing).toEqual(["skill-a", "skill-b"]);
    });

    it("returns all installed when all skills exist", async () => {
      const skillsDir = join(tempDir, ".claude", "skills");
      await mkdir(join(skillsDir, "skill-a"), { recursive: true });
      await mkdir(join(skillsDir, "skill-b"), { recursive: true });

      const provisionerWithTempDir = new TestAgentProvisioner(tempDir);

      const result = await provisionerWithTempDir.checkDependencies({
        bundle: "self",
        skills: ["skill-a", "skill-b"],
      });

      expect(result.installed).toEqual(["skill-a", "skill-b"]);
      expect(result.missing).toHaveLength(0);
    });
  });

  describe("getInstalled", () => {
    it("returns empty array when no agents installed", async () => {
      const agentsDir = join(tempDir, ".claude", "agents");
      await mkdir(agentsDir, { recursive: true });

      const provisionerWithTempDir = new TestAgentProvisioner(tempDir);
      const installed = await provisionerWithTempDir.getInstalled();

      expect(installed).toHaveLength(0);
    });

    it("returns installed agents with kind discriminator", async () => {
      const agentsDir = join(tempDir, ".claude", "agents");
      await mkdir(join(agentsDir, "test-agent"), { recursive: true });
      await writeFile(join(agentsDir, "test-agent", "AGENT.md"), "---\nname: Test\n---\n");

      const provisionerWithTempDir = new TestAgentProvisioner(tempDir);
      const installed = await provisionerWithTempDir.getInstalled();

      expect(installed.length).toBeGreaterThan(0);
      expect(installed[0].kind).toBe("agent");
      expect(installed[0].tools).toContain("claude-code");
    });
  });
});

// Test provisioner that uses a temp directory
class TestAgentProvisioner extends ClaudeCodeAgentProvisioner {
  constructor(private tempDir: string) {
    super({ scope: "system" });
  }

  override getAgentsDir(): string {
    return join(this.tempDir, ".claude", "agents");
  }

  override getSkillsDir(): string {
    return join(this.tempDir, ".claude", "skills");
  }
}

describe("CopilotAgentProvisioner", () => {
  it("returns correct id and name", () => {
    const provisioner = new CopilotAgentProvisioner({ scope: "system" });
    expect(provisioner.id).toBe("github-copilot");
    expect(provisioner.name).toBe("GitHub Copilot");
  });

  it("returns correct system agents directory", () => {
    const provisioner = new CopilotAgentProvisioner({ scope: "system" });
    expect(provisioner.getAgentsDir()).toBe(join(homedir(), ".copilot", "agents"));
  });

  it("returns correct repo agents directory", () => {
    const provisioner = new CopilotAgentProvisioner({ scope: "repo", repoRoot: "/project" });
    expect(provisioner.getRepoAgentsDir("/project")).toBe(join("/project", ".github", "agents"));
  });
});

describe("CursorAgentProvisioner", () => {
  it("returns correct id and name", () => {
    const provisioner = new CursorAgentProvisioner({ scope: "system" });
    expect(provisioner.id).toBe("cursor");
    expect(provisioner.name).toBe("Cursor");
  });

  it("returns correct system agents directory", () => {
    const provisioner = new CursorAgentProvisioner({ scope: "system" });
    expect(provisioner.getAgentsDir()).toBe(join(homedir(), ".cursor", "agents"));
  });

  it("returns correct repo agents directory", () => {
    const provisioner = new CursorAgentProvisioner({ scope: "repo", repoRoot: "/project" });
    expect(provisioner.getRepoAgentsDir("/project")).toBe(join("/project", ".cursor", "agents"));
  });
});
