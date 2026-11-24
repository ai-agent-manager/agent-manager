import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { ClaudeCodeAgentProvisioner } from "../../../src/provisioners/ClaudeCodeAgentProvisioner.js";
import { CopilotAgentProvisioner } from "../../../src/provisioners/CopilotAgentProvisioner.js";
import { CursorAgentProvisioner } from "../../../src/provisioners/CursorAgentProvisioner.js";
import { recordInstall } from "../../../src/bundle/cache.js";

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
    let originalHome: { HOME?: string; USERPROFILE?: string };
    let skillsDir: string;

    beforeEach(() => {
      originalHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
      process.env.HOME = tempDir;
      process.env.USERPROFILE = tempDir;
      skillsDir = join(tempDir, ".claude", "skills");
    });

    afterEach(() => {
      process.env.HOME = originalHome.HOME;
      process.env.USERPROFILE = originalHome.USERPROFILE;
    });

    it("returns installed and missing skills", async () => {
      await mkdir(join(skillsDir, "installed-skill"), { recursive: true });

      const result = await new ClaudeCodeAgentProvisioner({ scope: "system" }).checkDependencies({
        bundle: "self",
        skills: ["installed-skill", "missing-skill"],
      });

      expect(result.installed).toContain("installed-skill");
      expect(result.missing).toContain("missing-skill");
    });

    it("returns all missing when no skills installed", async () => {
      const result = await new ClaudeCodeAgentProvisioner({ scope: "system" }).checkDependencies({
        bundle: "self",
        skills: ["skill-a", "skill-b"],
      });

      expect(result.installed).toHaveLength(0);
      expect(result.missing).toEqual(["skill-a", "skill-b"]);
    });

    it("returns all installed when all skills exist", async () => {
      await mkdir(join(skillsDir, "skill-a"), { recursive: true });
      await mkdir(join(skillsDir, "skill-b"), { recursive: true });

      const result = await new ClaudeCodeAgentProvisioner({ scope: "system" }).checkDependencies({
        bundle: "self",
        skills: ["skill-a", "skill-b"],
      });

      expect(result.installed).toEqual(["skill-a", "skill-b"]);
      expect(result.missing).toHaveLength(0);
    });

    it("reports same-named skills agentman did not install as unmanaged", async () => {
      await mkdir(join(skillsDir, "personal"), { recursive: true });
      await mkdir(join(skillsDir, "managed"), { recursive: true });
      await recordInstall("claude-code", "managed", { installedAt: "now", method: "symlink" });

      const result = await new ClaudeCodeAgentProvisioner({ scope: "system" }).checkDependencies({
        bundle: "self",
        skills: ["personal", "managed"],
      });

      expect(result.installed).toEqual(["personal", "managed"]);
      expect(result.unmanaged).toEqual(["personal"]);
    });

    it("reports a differently named folder declaring the dependency's name", async () => {
      await mkdir(join(skillsDir, "my-notes"), { recursive: true });
      await writeFile(join(skillsDir, "my-notes", "SKILL.md"), "---\nname: skill-a\n---\n");

      const result = await new ClaudeCodeAgentProvisioner({ scope: "system" }).checkDependencies({
        bundle: "self",
        skills: ["skill-a"],
      });

      expect(result.unmanaged).toEqual(["skill-a"]);
      expect(result.clashes).toEqual({ "skill-a": ["my-notes"] });
    });

    it("treats a namespaced agentman install as satisfying the dependency", async () => {
      await mkdir(join(skillsDir, "bootstrap~skill-a"), { recursive: true });
      await recordInstall("claude-code", "bootstrap/skill-a", {
        installedAt: "now",
        method: "symlink",
        linkName: "bootstrap~skill-a",
      });

      const result = await new ClaudeCodeAgentProvisioner({ scope: "system" }).checkDependencies({
        bundle: "self",
        skills: ["skill-a"],
      });

      expect(result.installed).toEqual(["skill-a"]);
      expect(result.missing).toHaveLength(0);
      expect(result.unmanaged).toHaveLength(0);
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
