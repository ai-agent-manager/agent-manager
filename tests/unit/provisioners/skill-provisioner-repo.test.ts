import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readlink, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ClaudeCodeProvisioner } from "../../../src/provisioners/ClaudeCodeProvisioner.js";
import { DevinDesktopProvisioner } from "../../../src/provisioners/DevinDesktopProvisioner.js";
import { CopilotProvisioner } from "../../../src/provisioners/CopilotProvisioner.js";
import { AgentsProvisioner } from "../../../src/provisioners/AgentsProvisioner.js";
import { CursorProvisioner } from "../../../src/provisioners/CursorProvisioner.js";
import { KiroProvisioner } from "../../../src/provisioners/KiroProvisioner.js";
import type { SkillInfo } from "../../../src/bundle/scanner.js";
import type { SkillSourcePin } from "../../../src/bundle/skill-source.js";
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

    it("Devin Desktop installs to <repo>/.windsurf/skills/", () => {
      const prov = new DevinDesktopProvisioner({ scope: "repo", repoRoot });
      expect(prov.getRepoSkillsDir(repoRoot)).toBe(path.join(repoRoot, ".windsurf", "skills"));
    });

    it("Copilot installs to <repo>/.github/skills/", () => {
      const prov = new CopilotProvisioner({ scope: "repo", repoRoot });
      expect(prov.getRepoSkillsDir(repoRoot)).toBe(path.join(repoRoot, ".github", "skills"));
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

    it("threads sourcePin into the written install record", async () => {
      const prov = new ClaudeCodeProvisioner({ scope: "repo", repoRoot });
      const skill = getSkillInfo();
      const pin: SkillSourcePin = {
        sourceType: "bundle",
        installLayout: "flat",
        bundleVersion: "test-version-hash",
      };

      await prov.install([skill], "test-version-hash", pin);

      const configRaw = await readFile(path.join(repoRoot, REPO_CONFIG_FILENAME), "utf-8");
      const config = JSON.parse(configRaw);
      const record = config.installations["claude-code"]["test-skill"];
      expect(record.sourcePin).toEqual(pin);
      expect(record.sourcePin.sourceType).toBe("bundle");
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

    it('surfaces the pinned artefact version for artefact-sourced installs', async () => {
      const prov = new ClaudeCodeProvisioner({ scope: 'repo', repoRoot });
      const skill = getSkillInfo();

      await prov.install([skill], '', {
        sourceType: 'artefact',
        installLayout: 'namespaced',
        artefactUrl: 'https://cdn.example.com/test-skill-1.2.0.zip',
        sha256: 'a'.repeat(64),
        artefactVersion: '1.2.0',
      });
      const installed = await prov.getInstalled();

      expect(installed).toHaveLength(1);
      expect(installed[0].bundleVersion).toBe('1.2.0');
    });

    it('surfaces the pinned git ref for repo-sourced installs', async () => {
      const prov = new ClaudeCodeProvisioner({ scope: 'repo', repoRoot });
      const skill = getSkillInfo();

      await prov.install([skill], '', {
        sourceType: 'repo',
        installLayout: 'namespaced',
        repoUrl: 'https://github.com/org/skills',
        ref: 'v2.0',
      });
      const installed = await prov.getInstalled();

      expect(installed).toHaveLength(1);
      expect(installed[0].bundleVersion).toBe('v2.0');
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
  describe("existing skills agentman did not install", () => {
    let originalHome: { HOME?: string; USERPROFILE?: string };

    beforeEach(async () => {
      originalHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
      process.env.HOME = path.join(tmpDir, "home");
      process.env.USERPROFILE = path.join(tmpDir, "home");
      const personal = path.join(repoRoot, ".claude", "skills", "test-skill");
      await mkdir(personal, { recursive: true });
      await writeFile(path.join(personal, "SKILL.md"), "PERSONAL");
    });

    afterEach(() => {
      process.env.HOME = originalHome.HOME;
      process.env.USERPROFILE = originalHome.USERPROFILE;
    });

    const personalSkillMd = () => path.join(repoRoot, ".claude", "skills", "test-skill", "SKILL.md");

    it("refuses to replace them by default", async () => {
      const prov = new ClaudeCodeProvisioner({ scope: "repo", repoRoot });
      const result = await prov.install([getSkillInfo()], "v1");

      expect(result.installed).toHaveLength(0);
      expect(result.errors[0].error).toContain("not installed by agentman");
      expect(await readFile(personalSkillMd(), "utf8")).toBe("PERSONAL");
    });

    it("skips them under the keep policy", async () => {
      const prov = new ClaudeCodeProvisioner({ scope: "repo", repoRoot });
      const result = await prov.install([getSkillInfo()], "v1", undefined, { existing: "keep" });

      expect(result.installed).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings?.[0]).toContain("Kept existing");
      expect(await readFile(personalSkillMd(), "utf8")).toBe("PERSONAL");
    });

    it("backs them up before replacing under the backup policy", async () => {
      const prov = new ClaudeCodeProvisioner({ scope: "repo", repoRoot });
      const result = await prov.install([getSkillInfo()], "v1", undefined, { existing: "backup" });

      expect(result.errors).toHaveLength(0);
      expect(await readFile(personalSkillMd(), "utf8")).toBe("# Test Skill");
      const backup = result.warnings?.[0].match(/to (.+) before replacing/)?.[1];
      expect(backup).toBeDefined();
      expect(await readFile(path.join(backup!, "SKILL.md"), "utf8")).toBe("PERSONAL");
    });

    it("replaces its own earlier installs without asking", async () => {
      const prov = new ClaudeCodeProvisioner({ scope: "repo", repoRoot });
      await rm(path.join(repoRoot, ".claude", "skills", "test-skill"), { recursive: true });
      await prov.install([getSkillInfo()], "v1");

      const result = await prov.install([getSkillInfo()], "v2");

      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toBeUndefined();
    });
  });
  describe("existing skills declaring the same name", () => {
    let originalHome: { HOME?: string; USERPROFILE?: string };
    const namespacedPin: SkillSourcePin = {
      sourceType: "repo",
      installLayout: "namespaced",
      repoUrl: "https://github.com/acme/skills",
      ref: "main",
    };

    beforeEach(async () => {
      originalHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
      process.env.HOME = path.join(tmpDir, "home");
      process.env.USERPROFILE = path.join(tmpDir, "home");
      const personal = path.join(repoRoot, ".claude", "skills", "my-notes");
      await mkdir(personal, { recursive: true });
      await writeFile(path.join(personal, "SKILL.md"), "---\nname: test-skill\n---\nPERSONAL");
    });

    afterEach(() => {
      process.env.HOME = originalHome.HOME;
      process.env.USERPROFILE = originalHome.USERPROFILE;
    });

    it("refuses to install a duplicate under a different folder name", async () => {
      const prov = new ClaudeCodeProvisioner({ scope: "repo", repoRoot });
      const result = await prov.install([getSkillInfo()], "v1", namespacedPin);

      expect(result.installed).toHaveLength(0);
      expect(result.errors[0].error).toContain('my-notes already declares the skill name "test-skill"');
    });

    it("backs up the differently named folder under the backup policy", async () => {
      const prov = new ClaudeCodeProvisioner({ scope: "repo", repoRoot });
      const result = await prov.install([getSkillInfo()], "v1", namespacedPin, { existing: "backup" });

      expect(result.errors).toHaveLength(0);
      expect(result.warnings?.[0]).toContain('Backed up existing "my-notes"');
      const remaining = await readdir(path.join(repoRoot, ".claude", "skills"));
      expect(remaining).toEqual(["github.com~acme~skills~test-skill"]);
    });

    it("matches declared names exactly and ignores unrelated skills", async () => {
      const other = path.join(repoRoot, ".claude", "skills", "unrelated");
      await mkdir(other, { recursive: true });
      await writeFile(path.join(other, "SKILL.md"), "---\nname: something-else\n---\n");
      const prov = new ClaudeCodeProvisioner({ scope: "repo", repoRoot });

      const clashes = await prov.findUnmanagedClashes([
        { linkName: "x~test-skill", name: "test-skill" },
        { linkName: "y~test-skill", name: "Test-Skill" },
      ]);

      expect(clashes.get("x~test-skill")).toEqual(["my-notes"]);
      expect(clashes.has("y~test-skill")).toBe(false);
    });
  });
});
