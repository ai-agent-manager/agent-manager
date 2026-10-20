import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { composeAgent, CompositionError } from "../../../src/lib/agent-composer.js";

describe("agent-composer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `agent-composer-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("composeAgent", () => {
    it("throws if root AGENT.md is missing", async () => {
      const agentDir = join(tempDir, "my-agent");
      await mkdir(agentDir);

      await expect(composeAgent(agentDir, "claude-code")).rejects.toThrow(CompositionError);
    });

    it("composes agent with tool adapter frontmatter + root body", async () => {
      const agentDir = join(tempDir, "my-agent");
      await mkdir(agentDir);
      await mkdir(join(agentDir, "claude-code"));

      // Root AGENT.md
      await writeFile(
        join(agentDir, "AGENT.md"),
        `---
name: Test Agent
description: A test agent
---

# Test Agent

This is the root body content.
`,
      );

      // Tool adapter AGENT.md
      await writeFile(
        join(agentDir, "claude-code", "AGENT.md"),
        `---
name: Test Agent
description: Claude Code specific
model: claude-sonnet-5
---

## Claude Code Integration

Tool-specific instructions here.
`,
      );

      const result = await composeAgent(agentDir, "claude-code");

      expect(result.content).toContain("name: Test Agent");
      expect(result.content).toContain("model: claude-sonnet-5");
      expect(result.content).toContain("# Test Agent");
      expect(result.content).toContain("This is the root body content.");
      expect(result.content).toContain("## Claude Code Integration");
      expect(result.content).toContain("Tool-specific instructions here.");
    });

    it("uses minimal frontmatter when no tool adapter exists", async () => {
      const agentDir = join(tempDir, "my-agent");
      await mkdir(agentDir);

      await writeFile(
        join(agentDir, "AGENT.md"),
        `---
name: Simple Agent
description: A simple agent
---

# Simple Agent

Just root content.
`,
      );

      const result = await composeAgent(agentDir, "claude-code");

      expect(result.content).toContain("name: Simple Agent");
      expect(result.content).toContain("description: A simple agent");
      expect(result.content).toContain("# Simple Agent");
      expect(result.content).toContain("Just root content.");
    });

    it("collects sibling files from tool adapter directory", async () => {
      const agentDir = join(tempDir, "my-agent");
      await mkdir(agentDir);
      await mkdir(join(agentDir, "claude-code"));

      await writeFile(
        join(agentDir, "AGENT.md"),
        `---
name: Agent With Files
description: Has sibling files
---

Content here.
`,
      );

      await writeFile(
        join(agentDir, "claude-code", "AGENT.md"),
        `---
name: Agent With Files
description: Tool adapter
---
`,
      );

      await writeFile(
        join(agentDir, "claude-code", "checklist.md"),
        "# Checklist\n- Item 1\n- Item 2",
      );

      await writeFile(
        join(agentDir, "claude-code", "template.md"),
        "# Template",
      );

      const result = await composeAgent(agentDir, "claude-code");

      expect(result.siblingFiles).toHaveLength(2);
      expect(result.siblingFiles.some((f) => f.endsWith("checklist.md"))).toBe(true);
      expect(result.siblingFiles.some((f) => f.endsWith("template.md"))).toBe(true);
    });

    it("accepts github-copilot directory for github-copilot tool id", async () => {
      const agentDir = join(tempDir, "my-agent");
      await mkdir(agentDir);
      await mkdir(join(agentDir, "github-copilot"));

      await writeFile(
        join(agentDir, "AGENT.md"),
        `---
name: Copilot Agent
description: For GitHub Copilot
---

Root content.
`,
      );

      await writeFile(
        join(agentDir, "github-copilot", "AGENT.md"),
        `---
name: Copilot Agent
description: Copilot adapter
---

Copilot instructions.
`,
      );

      const result = await composeAgent(agentDir, "github-copilot");

      expect(result.content).toContain("Copilot instructions.");
    });

    it("accepts copilot directory as fallback for github-copilot tool id", async () => {
      const agentDir = join(tempDir, "my-agent");
      await mkdir(agentDir);
      await mkdir(join(agentDir, "copilot"));

      await writeFile(
        join(agentDir, "AGENT.md"),
        `---
name: Copilot Agent
description: For GitHub Copilot
---

Root content.
`,
      );

      await writeFile(
        join(agentDir, "copilot", "AGENT.md"),
        `---
name: Copilot Agent
description: Copilot adapter
---

Copilot instructions.
`,
      );

      const result = await composeAgent(agentDir, "github-copilot");

      expect(result.content).toContain("Copilot instructions.");
    });
  });
});
