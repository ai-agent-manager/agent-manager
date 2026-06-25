import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { SkillVersionManager } from "../../../src/components/SkillVersionManager.js";

// Mock dependencies
vi.mock("../../../src/bundle/cache.js", () => ({
  readConfig: vi.fn(),
  listCachedBundles: vi.fn(),
  updateSkillVersion: vi.fn(),
}));

vi.mock("../../../src/bundle/repo-config.js", () => ({
  readRepoConfig: vi.fn(),
}));

vi.mock("../../../src/bundle/scanner.js", () => ({
  scanBundle: vi.fn(),
}));

vi.mock("../../../src/config/paths.js", () => ({
  getBundleVersionDir: vi.fn((version: string) => `/mock/.agentman/bundles/${version}`),
}));

vi.mock("../../../src/config/tools.js", () => ({
  getSkillTools: () => [
    { id: "claude-code", name: "Claude Code", getSkillsDir: () => "/mock/.claude/skills", getRepoSkillsDir: () => "/mock/.claude/skills" },
    { id: "windsurf", name: "Windsurf", getSkillsDir: () => "/mock/.windsurf/skills", getRepoSkillsDir: () => "/mock/.windsurf/skills" },
  ],
}));

vi.mock("../../../src/lib/repo.js", () => ({
  findRepoRoot: vi.fn(),
}));

import { readConfig, listCachedBundles, updateSkillVersion } from "../../../src/bundle/cache.js";
import { readRepoConfig } from "../../../src/bundle/repo-config.js";
import { scanBundle } from "../../../src/bundle/scanner.js";
import { findRepoRoot } from "../../../src/lib/repo.js";

const FRAME_WAIT_TIMEOUT_MS = 10_000;
const ASYNC_INK_TEST_TIMEOUT_MS = 15_000;

async function waitForFrameText(lastFrame: () => string | undefined, text: string): Promise<void> {
  await vi.waitFor(
    () => {
      expect(lastFrame() ?? "").toContain(text);
    },
    { timeout: FRAME_WAIT_TIMEOUT_MS, interval: 20 },
  );
}

async function selectSystemWideScope(stdin: { write: (input: string) => void }, lastFrame: () => string | undefined): Promise<void> {
  await waitForFrameText(lastFrame, "Which skills do you want to manage?");
  stdin.write("\r");
  await flushInkInput();
  await waitForFrameText(lastFrame, "Select a skill to change its version");
}

async function flushInkInput(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("SkillVersionManager", () => {
  let mockOnBack: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnBack = vi.fn();
    vi.clearAllMocks();
    vi.mocked(scanBundle).mockReset();
    // Default: not inside a repo
    vi.mocked(findRepoRoot).mockResolvedValue(null);
    vi.mocked(readRepoConfig).mockResolvedValue(null);
  });

  it("shows loading state initially", () => {
    vi.mocked(readConfig).mockImplementation(() => new Promise(() => {})); // Never resolves
    vi.mocked(listCachedBundles).mockImplementation(() => new Promise(() => {}));

    const { lastFrame } = render(<SkillVersionManager onBack={mockOnBack} />);

    expect(lastFrame()).toContain("Loading installed skills...");
  });

  it("shows scope selection screen after loading", async () => {
    vi.mocked(readConfig).mockResolvedValue({ installations: {} });
    vi.mocked(listCachedBundles).mockResolvedValue([]);

    const { lastFrame } = render(<SkillVersionManager onBack={mockOnBack} />);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(lastFrame()).toContain("Manage Skill Versions");
    expect(lastFrame()).toContain("System-wide");
    expect(lastFrame()).toContain("This repository");
  });

  it("shows empty state when no system-wide skills installed", async () => {
    vi.mocked(readConfig).mockResolvedValue({ installations: {} });
    vi.mocked(listCachedBundles).mockResolvedValue([]);

    const { lastFrame, stdin } = render(<SkillVersionManager onBack={mockOnBack} />);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Select "System-wide" (first item)
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain("No skills installed system-wide");
    expect(lastFrame()).toContain("Install skills first");
  });

  it("lists installed skills with versions after selecting scope", async () => {
    vi.mocked(readConfig).mockResolvedValue({
      installations: {
        "claude-code": {
          "hello-world-skill": {
            bundleVersion: "1.0.0",
            installedAt: "2026-04-03T10:00:00Z",
            method: "symlink",
          },
          "goodbye-skill": {
            bundleVersion: "2.0.0",
            installedAt: "2026-04-03T12:00:00Z",
            method: "symlink",
          },
        },
      },
    });
    vi.mocked(listCachedBundles).mockResolvedValue([
      { version: "1.0.0", published: "2026-04-03T10:00:00Z", bundleDir: "/mock/1.0.0", isCurrent: false },
      { version: "2.0.0", published: "2026-04-03T12:00:00Z", bundleDir: "/mock/2.0.0", isCurrent: true },
    ]);

    const { lastFrame, stdin } = render(<SkillVersionManager onBack={mockOnBack} />);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Select "System-wide"
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain("Manage Skill Versions");
    expect(lastFrame()).toContain("hello-world-skill");
    expect(lastFrame()).toContain("goodbye-skill");
    expect(lastFrame()).toContain("Claude Code");
    expect(lastFrame()).toContain("1.0.0");
    expect(lastFrame()).toContain("2.0.0");
  });

  it("groups skills installed across multiple tools", async () => {
    vi.mocked(readConfig).mockResolvedValue({
      installations: {
        "claude-code": {
          "hello-world-skill": {
            bundleVersion: "1.0.0",
            installedAt: "2026-04-03T10:00:00Z",
            method: "symlink",
          },
        },
        windsurf: {
          "hello-world-skill": {
            bundleVersion: "1.0.0",
            installedAt: "2026-04-03T10:00:00Z",
            method: "symlink",
          },
        },
      },
    });
    vi.mocked(listCachedBundles).mockResolvedValue([
      { version: "1.0.0", published: "2026-04-03T10:00:00Z", bundleDir: "/mock/1.0.0", isCurrent: true },
    ]);

    const { lastFrame, stdin } = render(<SkillVersionManager onBack={mockOnBack} />);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Select "System-wide"
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain("hello-world-skill");
    expect(lastFrame()).toContain("Claude Code");
    expect(lastFrame()).toContain("Windsurf");
  });

  it("shows different versions when skills have mixed versions", async () => {
    vi.mocked(readConfig).mockResolvedValue({
      installations: {
        "claude-code": {
          "skill-a": {
            bundleVersion: "1.0.0",
            installedAt: "2026-04-03T10:00:00Z",
            method: "symlink",
          },
        },
        windsurf: {
          "skill-a": {
            bundleVersion: "2.0.0",
            installedAt: "2026-04-03T12:00:00Z",
            method: "symlink",
          },
        },
      },
    });
    vi.mocked(listCachedBundles).mockResolvedValue([
      { version: "1.0.0", published: "2026-04-03T10:00:00Z", bundleDir: "/mock/1.0.0", isCurrent: false },
      { version: "2.0.0", published: "2026-04-03T12:00:00Z", bundleDir: "/mock/2.0.0", isCurrent: true },
    ]);

    const { lastFrame, stdin } = render(<SkillVersionManager onBack={mockOnBack} />);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Select "System-wide"
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain("skill-a");
    expect(lastFrame()).toContain("Claude Code");
    expect(lastFrame()).toContain("Windsurf");
    expect(lastFrame()).toContain("1.0.0");
    expect(lastFrame()).toContain("2.0.0");
  });

  it("shows scanning spinner while loading available versions for a skill", async () => {
    vi.mocked(readConfig).mockResolvedValue({
      installations: {
        "claude-code": {
          "hello-world-skill": {
            bundleVersion: "1.0.0",
            installedAt: "2026-04-03T10:00:00Z",
            method: "symlink",
          },
        },
      },
    });
    vi.mocked(listCachedBundles).mockResolvedValue([
      { version: "1.0.0", published: "2026-04-03T10:00:00Z", bundleDir: "/mock/1.0.0", isCurrent: true },
    ]);

    // Never resolves — keeps the component in scanning state indefinitely
    vi.mocked(scanBundle).mockImplementation(() => new Promise(() => {}));

    const { lastFrame, stdin } = render(<SkillVersionManager onBack={mockOnBack} />);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Select "System-wide"
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain("Manage Skill Versions");

    // Select "Change hello-world-skill" (first item in skill list)
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain("Scanning bundle versions...");
  });

  it("shows error icon when updateSkillVersion fails", async () => {
    vi.mocked(readConfig).mockResolvedValue({
      installations: {
        "claude-code": {
          "hello-world-skill": {
            bundleVersion: "1.0.0",
            installedAt: "2026-04-03T10:00:00Z",
            method: "symlink",
          },
        },
      },
    });
    vi.mocked(listCachedBundles).mockResolvedValue([
      { version: "2.0.0", published: "2026-04-03T12:00:00Z", bundleDir: "/mock/2.0.0", isCurrent: true },
    ]);
    vi.mocked(scanBundle).mockResolvedValue({
      skills: [{ dirName: "hello-world-skill", dirPath: "/mock/2.0.0/hello-world-skill", meta: null }],
      rovoAgents: [],
    } as any);
    vi.mocked(updateSkillVersion).mockResolvedValue({ success: false, error: "Permission denied" });

    const { lastFrame, stdin } = render(<SkillVersionManager onBack={mockOnBack} />);

    await selectSystemWideScope(stdin, lastFrame);

    // Select "Change hello-world-skill" → scanning → select-version screen
    stdin.write("\r");
    await flushInkInput();
    await waitForFrameText(lastFrame, "Select a version to install");

    // Select version 2.0.0
    stdin.write("\r");
    await flushInkInput();
    await waitForFrameText(lastFrame, "Permission denied");

    // Should show error icon (✘ U+2718), not success icon (✔ U+2714)
    expect(lastFrame()).toContain("\u2718");
    expect(lastFrame()).not.toContain("\u2714");
    expect(lastFrame()).toContain("Permission denied");
  }, ASYNC_INK_TEST_TIMEOUT_MS);

  it("shows cached versions that do not contain the selected skill and blocks selecting them", async () => {
    vi.mocked(readConfig).mockResolvedValue({
      installations: {
        "claude-code": {
          "hello-world-skill": {
            bundleVersion: "1.3.0",
            installedAt: "2026-04-03T10:00:00Z",
            method: "symlink",
          },
        },
      },
    });
    vi.mocked(listCachedBundles).mockResolvedValue([
      { version: "1.3.0", published: "2026-04-03T12:00:00Z", bundleDir: "/mock/1.3.0", isCurrent: true },
      { version: "1.1.0", published: "2026-04-03T10:00:00Z", bundleDir: "/mock/1.1.0", isCurrent: false },
    ]);
    vi.mocked(scanBundle).mockImplementation(async (bundleDir: string) => {
      if (bundleDir.includes("1.3.0")) {
        return {
          skills: [{ dirName: "hello-world-skill", dirPath: "/mock/1.3.0/hello-world-skill", meta: null }],
          rovoAgents: [],
        } as any;
      }

      return {
        skills: [],
        rovoAgents: [],
      } as any;
    });

    const { lastFrame, stdin } = render(<SkillVersionManager onBack={mockOnBack} />);

    await selectSystemWideScope(stdin, lastFrame);

    stdin.write("\r");
    await flushInkInput();
    await waitForFrameText(lastFrame, "Select a version to install");

    expect(lastFrame()).toContain("1.3.0");
    expect(lastFrame()).toContain("1.1.0");
    expect(lastFrame()).toContain("not in bundle");
    expect(lastFrame()).toContain("cannot be selected");

    stdin.write("\u001B[B");
    await flushInkInput();
    await waitForFrameText(lastFrame, "1.1.0");
    stdin.write("\r");
    await flushInkInput();
    await waitForFrameText(lastFrame, "Selected skill not in bundle 1.1.0");

    expect(lastFrame()).toContain("Selected skill not in bundle 1.1.0");
    expect(updateSkillVersion).not.toHaveBeenCalled();
  }, ASYNC_INK_TEST_TIMEOUT_MS);

  it("calls onBack when back is selected from scope screen", async () => {
    vi.mocked(readConfig).mockResolvedValue({ installations: {} });
    vi.mocked(listCachedBundles).mockResolvedValue([]);

    const { lastFrame, stdin } = render(<SkillVersionManager onBack={mockOnBack} />);

    await waitForFrameText(lastFrame, "Which skills do you want to manage?");

    // Navigate to "← Back" (3rd item: System-wide, This repository, ← Back)
    stdin.write("\u001B[B"); // arrow down
    await flushInkInput();
    await waitForFrameText(lastFrame, "This repository");
    stdin.write("\u001B[B"); // arrow down
    await flushInkInput();
    await waitForFrameText(lastFrame, "← Back");
    stdin.write("\r");
    await flushInkInput();

    await vi.waitFor(() => {
      expect(mockOnBack).toHaveBeenCalledOnce();
    });
  }, ASYNC_INK_TEST_TIMEOUT_MS);

  it("shows mixed-version warning and align option when skills differ", async () => {
    vi.mocked(readConfig).mockResolvedValue({
      installations: {
        "claude-code": {
          "skill-a": {
            bundleVersion: "1.0.0",
            installedAt: "2026-04-03T10:00:00Z",
            method: "symlink",
          },
          "skill-b": {
            bundleVersion: "2.0.0",
            installedAt: "2026-04-03T12:00:00Z",
            method: "symlink",
          },
        },
      },
    });
    vi.mocked(listCachedBundles).mockResolvedValue([
      { version: "1.0.0", published: "2026-04-03T10:00:00Z", bundleDir: "/mock/1.0.0", isCurrent: false },
      { version: "2.0.0", published: "2026-04-03T12:00:00Z", bundleDir: "/mock/2.0.0", isCurrent: true },
    ]);

    const { lastFrame, stdin } = render(<SkillVersionManager onBack={mockOnBack} />);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Select "System-wide"
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    const frame = lastFrame();
    expect(frame).toContain("Skills are on different versions");
    expect(frame).toContain("Align all to same version");
  });

  it("does not show align option when all skills are on same version", async () => {
    vi.mocked(readConfig).mockResolvedValue({
      installations: {
        "claude-code": {
          "skill-a": {
            bundleVersion: "1.0.0",
            installedAt: "2026-04-03T10:00:00Z",
            method: "symlink",
          },
          "skill-b": {
            bundleVersion: "1.0.0",
            installedAt: "2026-04-03T12:00:00Z",
            method: "symlink",
          },
        },
      },
    });
    vi.mocked(listCachedBundles).mockResolvedValue([
      { version: "1.0.0", published: "2026-04-03T10:00:00Z", bundleDir: "/mock/1.0.0", isCurrent: true },
    ]);

    const { lastFrame, stdin } = render(<SkillVersionManager onBack={mockOnBack} />);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Select "System-wide"
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    const frame = lastFrame();
    expect(frame).not.toContain("Skills are on different versions");
    expect(frame).not.toContain("Align all to same version");
  });
});
