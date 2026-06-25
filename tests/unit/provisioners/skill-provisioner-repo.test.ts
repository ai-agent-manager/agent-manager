import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readlink, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ClaudeCodeProvisioner } from "../../../src/provisioners/ClaudeCodeProvisioner.js";
import { WindsurfProvisioner } from "../../../src/provisioners/WindsurfProvisioner.js";
import { CopilotProvisioner } from "../../../src/provisioners/CopilotProvisioner.js";
import { AgentsProvisioner } from "../../../src/provisioners/AgentsProvisioner.js";
import { CursorProvisioner } from "../../../src/provisioners/CursorProvisioner.js";
import { KiroProvisioner } from "../../../src/provisioners/KiroProvisioner.js";
import type { SkillInfo } from "../../../src/bundle/scanner.js";
import { REPO_CONFIG_FILENAME } from "../../../src/bundle/repo-config.js";

describe("SkillProvisioner (repo scope)", () => {
  let tmpDir: string;
  let repoRoot: string;
  let bundleDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "agentman-repo-prov-"));
    repoRoot = path.join(tmpDir, "my-repo");
    bundleDir = path.join(tmpDir, "bundle");

    await mkdir(repoRoot, { recursive: true });
    await mkdir(bundleDir, { recursive: true });

    // Create a mock skill in the bundle
    const skillDir = path.join(bundleDir, "test-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "# Test Skill");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const mockSkill: SkillInfo = {
    dirName: "test-skill",
    dirPath: "", // set in beforeEach via bundleDir
    skillMdPath: "",
    meta: null,
  };

  function getSkillInfo(): SkillInfo {
    return {
      ...mockSkill,
      dirPath: path.join(bundleDir, "test-skill"),
      skillMdPath: path.join(bundleDir, "test-skill", "SKILL.md"),
    };
  }

  it("throws when repo scope is used without repoRoot", () => {
    expect(() => new ClaudeCodeProvisioner({ scope: "repo" })).toThrow("repoRoot is required");
  });

  describe("getEffectiveSkillsDir", () => {
    it("returns system path when scope is system", () => {
      const prov = new ClaudeCodeProvisioner();
      expect(prov.getEffectiveSkillsDir()).toBe(prov.getSkillsDir());
    });

    it("returns repo path when scope is repo", () => {
      const prov = new ClaudeCodeProvisioner({ scope: "repo", repoRoot });
      expect(prov.getEffectiveSkillsDir()).toBe(path.join(repoRoot, ".claude", "skills"));
    });
  });

  describe("repo-level paths per tool", () => {
    it("ClaudeCode installs to <repo>/.claude/skills/", () => {
      const prov = new ClaudeCodeProvisioner({ scope: "repo", repoRoot });
      expect(prov.getRepoSkillsDir(repoRoot)).toBe(path.join(repoRoot, ".claude", "skills"));
    });

    it("Windsurf installs to <repo>/.windsurf/skills/", () => {
      const prov = new WindsurfProvisioner({ scope: "repo", repoRoot });
      expect(prov.getRepoSkillsDir(repoRoot)).toBe(path.join(repoRoot, ".windsurf", "skills"));
    });

    it("Copilot installs to <repo>/.github/copilot/skills/", () => {
      const prov = new CopilotProvisioner({ scope: "repo", repoRoot });
      expect(prov.getRepoSkillsDir(repoRoot)).toBe(path.join(repoRoot, ".github", "copilot", "skills"));
    });

    it("Agents installs to <repo>/.agents/skills/", () => {
      const prov = new AgentsProvisioner({ scope: "repo", repoRoot });
      expect(prov.getRepoSkillsDir(repoRoot)).toBe(path.join(repoRoot, ".agents", "skills"));
    });

    it("Cursor installs to <repo>/.cursor/skills/", () => {
      const prov = new CursorProvisioner({ scope: "repo", repoRoot });
      expect(prov.getRepoSkillsDir(repoRoot)).toBe(path.join(repoRoot, ".cursor", "skills"));
    });

    it("Kiro installs to <repo>/.kiro/skills/", () => {
      const prov = new KiroProvisioner({ scope: "repo", repoRoot });
      expect(prov.getRepoSkillsDir(repoRoot)).toBe(path.join(repoRoot, ".kiro", "skills"));
    });
  });

  describe("install (repo scope)", () => {
    it("creates symlink in the repo skills directory", async () => {
      const prov = new ClaudeCodeProvisioner({ scope: "repo", repoRoot });
      const skill = getSkillInfo();

      const result = await prov.install([skill], "test-version-hash");

      expect(result.installed).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
      expect(result.installed[0].name).toBe("test-skill");

      // Verify symlink exists at repo path
      const expectedLink = path.join(repoRoot, ".claude", "skills", "test-skill");
      const target = await readlink(expectedLink);
      expect(target).toBe(skill.dirPath);
    });

    it("records installation in .agentman.json", async () => {
      const prov = new ClaudeCodeProvisioner({ scope: "repo", repoRoot });
      const skill = getSkillInfo();

      await prov.install([skill], "test-version-hash");

      const configRaw = await readFile(path.join(repoRoot, REPO_CONFIG_FILENAME), "utf-8");
      const config = JSON.parse(configRaw);
      expect(config.bundleVersion).toBe("test-version-hash");
      expect(config.installations["claude-code"]["test-skill"]).toBeDefined();
      expect(config.installations["claude-code"]["test-skill"].method).toBe("symlink");
    });
  });

  describe("getInstalled (repo scope)", () => {
    it("returns empty array when no skills installed", async () => {
      const prov = new ClaudeCodeProvisioner({ scope: "repo", repoRoot });
      const installed = await prov.getInstalled();
      expect(installed).toEqual([]);
    });

    it("lists installed skills from repo path", async () => {
      const prov = new ClaudeCodeProvisioner({ scope: "repo", repoRoot });
      const skill = getSkillInfo();

      await prov.install([skill], "test-version-hash");
      const installed = await prov.getInstalled();

      expect(installed).toHaveLength(1);
      expect(installed[0].name).toBe("test-skill");
    });
  });

  describe("uninstall (repo scope)", () => {
    it("removes symlink and config record", async () => {
      const prov = new ClaudeCodeProvisioner({ scope: "repo", repoRoot });
      const skill = getSkillInfo();

      await prov.install([skill], "test-version-hash");
      const result = await prov.uninstall(["test-skill"]);

      expect(result.removed).toEqual([{ name: "test-skill" }]);
      expect(result.errors).toEqual([]);

      const installed = await prov.getInstalled();
      expect(installed).toHaveLength(0);

      const configRaw = await readFile(path.join(repoRoot, REPO_CONFIG_FILENAME), "utf-8");
      const config = JSON.parse(configRaw);
      // Tool entry should be cleaned up since no skills remain
      expect(config.installations["claude-code"]).toBeUndefined();
    });
  });
});
