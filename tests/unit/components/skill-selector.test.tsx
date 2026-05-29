import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import type { SkillInfo } from "../../../src/bundle/scanner.js";
import { SkillSelector } from "../../../src/components/SkillSelector.js";
import type { InstalledSkill } from "../../../src/provisioners/types.js";

const { trackTelemetryEvent, trackTelemetryError } = vi.hoisted(() => ({
    trackTelemetryEvent: vi.fn(),
    trackTelemetryError: vi.fn(),
}));

vi.mock("../../../src/telemetry.js", () => ({
    trackTelemetryEvent,
    trackTelemetryError,
}));

const mockProvisioner = {
    name: "Mock Tool",
    getNote: vi.fn(() => null as string | null),
    getInstalled: vi.fn<() => Promise<InstalledSkill[]>>(),
    install: vi.fn(),
    uninstall: vi.fn(),
};

vi.mock("../../../src/provisioners/ClaudeCodeProvisioner.js", () => ({
    ClaudeCodeProvisioner: vi.fn(() => mockProvisioner),
}));
vi.mock("../../../src/provisioners/WindsurfProvisioner.js", () => ({
    WindsurfProvisioner: vi.fn(() => mockProvisioner),
}));
vi.mock("../../../src/provisioners/CopilotProvisioner.js", () => ({
    CopilotProvisioner: vi.fn(() => mockProvisioner),
}));
vi.mock("../../../src/provisioners/CursorProvisioner.js", () => ({
    CursorProvisioner: vi.fn(() => mockProvisioner),
}));

function makeSkill(dirName: string, name?: string, description?: string): SkillInfo {
    return {
        dirName,
        dirPath: `/bundle/${dirName}`,
        skillMdPath: `/bundle/${dirName}/SKILL.md`,
        meta: name ? { name, description: description ?? "", tags: [] } : null,
    };
}

function makeInstalled(name: string, bundleVersion: string): InstalledSkill {
    return {
        name,
        bundleVersion,
        installedAt: new Date().toISOString(),
        method: "symlink",
        path: `/skills/${name}`,
    };
}

const SKILLS: SkillInfo[] = [
    makeSkill("web-skill", "Web Skill", "Helps with web dev"),
    makeSkill("api-skill", "API Skill", "Helps with APIs"),
];

const BUNDLE_VERSION = "abc1234567890";

const defaultProps = {
    toolId: "claude-code",
    skills: SKILLS,
    bundleVersion: BUNDLE_VERSION,
    scope: "system" as const,
    repoRoot: null,
    bundleTelemetryProps: {
        source: "url",
        bundleEndpoint: "https://example.com/skills",
    },
    onBack: vi.fn(),
    onDone: vi.fn(),
};

describe("SkillSelector", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockProvisioner.getInstalled.mockResolvedValue([]);
        mockProvisioner.install.mockResolvedValue({ installed: [], errors: [] });
        mockProvisioner.uninstall.mockResolvedValue({ removed: [], errors: [] });
        mockProvisioner.getNote.mockReturnValue(null);
    });

    describe("initial render", () => {
        it("shows a loading spinner while getInstalled is pending", () => {
            mockProvisioner.getInstalled.mockReturnValue(new Promise(() => {}));
            const { lastFrame } = render(<SkillSelector {...defaultProps} />);
            expect(lastFrame()).toContain("Checking installed skills");
        });

        it("renders the skill list once getInstalled resolves", async () => {
            const { lastFrame } = render(<SkillSelector {...defaultProps} />);

            await vi.waitFor(() => {
                expect(lastFrame()).toContain("Web Skill");
            });

            expect(lastFrame()).toContain("API Skill");
        });

        it("shows an error and tracks telemetry when installed skills cannot be loaded", async () => {
            mockProvisioner.getInstalled.mockRejectedValue(new Error("permissions issue"));
            const { lastFrame } = render(<SkillSelector {...defaultProps} />);

            await vi.waitFor(() => {
                expect(lastFrame()).toContain("permissions issue");
            });

            expect(trackTelemetryError).toHaveBeenCalledWith("installed_skills_load_failed", expect.any(Error), {
                source: "url",
                bundleEndpoint: "https://example.com/skills",
                tool: "claude-code",
                scope: "system",
            });
        });

        it("renders the Back option at the bottom of the list", async () => {
            const { lastFrame } = render(<SkillSelector {...defaultProps} />);

            await vi.waitFor(() => {
                expect(lastFrame()).toContain("← Back");
            });
        });
    });

    describe("status labels", () => {
        it('shows "not installed" for skills absent from the installed list', async () => {
            const { lastFrame } = render(<SkillSelector {...defaultProps} />);

            await vi.waitFor(() => {
                expect(lastFrame()).toContain("not installed");
            });
        });

        it('shows "installed" with a short hash for skills at the current bundle version', async () => {
            mockProvisioner.getInstalled.mockResolvedValue([makeInstalled("web-skill", BUNDLE_VERSION)]);
            const { lastFrame } = render(<SkillSelector {...defaultProps} />);

            await vi.waitFor(() => {
                expect(lastFrame()).toContain(`installed (${BUNDLE_VERSION.slice(0, 7)})`);
            });
        });

        it('shows "outdated" for skills installed at a different bundle version', async () => {
            mockProvisioner.getInstalled.mockResolvedValue([makeInstalled("web-skill", "old0000000000")]);
            const { lastFrame } = render(<SkillSelector {...defaultProps} />);

            await vi.waitFor(() => {
                expect(lastFrame()).toContain("outdated (old0000)");
            });
        });
    });

    describe("pre-selection", () => {
        it("pre-checks skills that are already installed", async () => {
            mockProvisioner.getInstalled.mockResolvedValue([makeInstalled("web-skill", BUNDLE_VERSION)]);
            const { lastFrame } = render(<SkillSelector {...defaultProps} />);

            await vi.waitFor(() => {
                const frame = lastFrame()!;
                const webLine = frame.split("\n").find((line) => line.includes("Web Skill"))!;
                const apiLine = frame.split("\n").find((line) => line.includes("API Skill"))!;
                expect(webLine).toContain("[✓]");
                expect(apiLine).toContain("[ ]");
            });
        });
    });

    describe("keyboard: cursor", () => {
        it("moves the cursor down with the down arrow key", async () => {
            const { lastFrame, stdin } = render(<SkillSelector {...defaultProps} />);
            await vi.waitFor(() => expect(lastFrame()).toContain("Web Skill"));

            expect(
                lastFrame()!
                    .split("\n")
                    .find((line) => line.includes("Web Skill")),
            ).toContain("❯");

            stdin.write("\u001B[B");
            await vi.waitFor(() => {
                expect(
                    lastFrame()!
                        .split("\n")
                        .find((line) => line.includes("API Skill")),
                ).toContain("❯");
            });
        });

        it("moves the cursor back up with the up arrow key", async () => {
            const { lastFrame, stdin } = render(<SkillSelector {...defaultProps} />);
            await vi.waitFor(() => expect(lastFrame()).toContain("Web Skill"));

            stdin.write("\u001B[B");
            await vi.waitFor(() => {
                expect(
                    lastFrame()!
                        .split("\n")
                        .find((line) => line.includes("API Skill")),
                ).toContain("❯");
            });

            stdin.write("\u001B[A");
            await vi.waitFor(() => {
                expect(
                    lastFrame()!
                        .split("\n")
                        .find((line) => line.includes("Web Skill")),
                ).toContain("❯");
            });
        });
    });

    describe("keyboard: space toggle", () => {
        it("selects an unselected skill with space", async () => {
            const { lastFrame, stdin } = render(<SkillSelector {...defaultProps} />);
            await vi.waitFor(() => expect(lastFrame()).toContain("Web Skill"));

            expect(
                lastFrame()!
                    .split("\n")
                    .find((line) => line.includes("Web Skill")),
            ).toContain("[ ]");

            stdin.write(" ");
            await vi.waitFor(() => {
                expect(
                    lastFrame()!
                        .split("\n")
                        .find((line) => line.includes("Web Skill")),
                ).toContain("[✓]");
            });
        });

        it("deselects a selected skill with a second space", async () => {
            mockProvisioner.getInstalled.mockResolvedValue([makeInstalled("web-skill", BUNDLE_VERSION)]);
            const { lastFrame, stdin } = render(<SkillSelector {...defaultProps} />);

            await vi.waitFor(() => {
                expect(
                    lastFrame()!
                        .split("\n")
                        .find((line) => line.includes("Web Skill")),
                ).toContain("[✓]");
            });

            stdin.write(" ");
            await vi.waitFor(() => {
                expect(
                    lastFrame()!
                        .split("\n")
                        .find((line) => line.includes("Web Skill")),
                ).toContain("[ ]");
            });
        });
    });

    describe("install result", () => {
        it("shows a hint when selected skills were already installed at a different version", async () => {
            mockProvisioner.getInstalled.mockResolvedValue([makeInstalled("web-skill", "old0000000000")]);
            mockProvisioner.install.mockResolvedValue({ installed: [], errors: [] });

            const { lastFrame, stdin } = render(<SkillSelector {...defaultProps} />);
            await vi.waitFor(() => expect(lastFrame()).toContain("Web Skill"));

            stdin.write("\r");

            await vi.waitFor(() => {
                expect(lastFrame()).toContain("already at a different version");
                expect(lastFrame()).toContain("Manage Skill Versions");
            });
        });

        it("does not show the hint when all selected skills are at the current version", async () => {
            mockProvisioner.getInstalled.mockResolvedValue([makeInstalled("web-skill", BUNDLE_VERSION)]);
            mockProvisioner.install.mockResolvedValue({ installed: [], errors: [] });

            const { lastFrame, stdin } = render(<SkillSelector {...defaultProps} />);
            await vi.waitFor(() => expect(lastFrame()).toContain("Web Skill"));

            stdin.write("\r");

            await vi.waitFor(() => {
                expect(lastFrame()).toContain("skill(s) installed");
            });

            expect(lastFrame()).not.toContain("already at a different version");
        });
    });

    describe("keyboard: escape and back option", () => {
        it("calls onBack when escape is pressed", async () => {
            const onBack = vi.fn();
            const { lastFrame, stdin } = render(<SkillSelector {...defaultProps} onBack={onBack} />);
            await vi.waitFor(() => expect(lastFrame()).toContain("Web Skill"));

            stdin.write("\u001B");
            await vi.waitFor(() => expect(onBack).toHaveBeenCalled());
        });

        it("calls onBack when Enter is pressed on the Back option", async () => {
            const onBack = vi.fn();
            const { lastFrame, stdin } = render(<SkillSelector {...defaultProps} onBack={onBack} />);
            await vi.waitFor(() => expect(lastFrame()).toContain("← Back"));

            stdin.write("\u001B[B");
            await vi.waitFor(() => {
                expect(
                    lastFrame()!
                        .split("\n")
                        .find((line) => line.includes("API Skill")),
                ).toContain("❯");
            });

            stdin.write("\u001B[B");
            await vi.waitFor(() => {
                expect(
                    lastFrame()!
                        .split("\n")
                        .find((line) => line.includes("← Back")),
                ).toContain("❯");
            });

            await new Promise((resolve) => setTimeout(resolve, 0));
            stdin.write("\r");

            await vi.waitFor(() => expect(onBack).toHaveBeenCalled());
        });
    });

    describe("telemetry", () => {
        it("tracks install counts when the selection is confirmed", async () => {
            mockProvisioner.getInstalled.mockResolvedValue([]);
            mockProvisioner.install.mockResolvedValue({
                installed: [{ name: "web-skill", method: "symlink", path: "/skills/web-skill" }],
                errors: [],
            });

            const { lastFrame, stdin } = render(<SkillSelector {...defaultProps} />);
            await vi.waitFor(() => expect(lastFrame()).toContain("Web Skill"));

            const webLine =
                lastFrame()!
                    .split("\n")
                    .find((line) => line.includes("Web Skill")) ?? "";
            if (!webLine.includes("[✓]")) {
                stdin.write(" ");
                await vi.waitFor(() => {
                    expect(
                        lastFrame()!
                            .split("\n")
                            .find((line) => line.includes("Web Skill")),
                    ).toContain("[✓]");
                });
            }

            await new Promise((resolve) => setTimeout(resolve, 0));
            stdin.write("\r");

            await vi.waitFor(() => expect(mockProvisioner.install).toHaveBeenCalledWith([SKILLS[0]], BUNDLE_VERSION));

            expect(trackTelemetryEvent).toHaveBeenCalledWith({
                action: "skills_installed",
                properties: {
                    source: "url",
                    bundleEndpoint: "https://example.com/skills",
                    tool: "claude-code",
                    scope: "system",
                    installed: 1,
                    failed: 0,
                    requestedSkills: "web-skill",
                    installedSkills: "web-skill",
                    failedSkills: undefined,
                },
                value: 1,
            });
        });

        it("tracks uninstall counts when deselecting an installed skill", async () => {
            mockProvisioner.getInstalled.mockResolvedValue([makeInstalled("web-skill", BUNDLE_VERSION)]);
            mockProvisioner.uninstall.mockResolvedValue({ removed: [{ name: "web-skill" }], errors: [] });
            mockProvisioner.install.mockResolvedValue({ installed: [], errors: [] });

            const { lastFrame, stdin } = render(<SkillSelector {...defaultProps} />);

            await vi.waitFor(() => {
                expect(
                    lastFrame()!
                        .split("\n")
                        .find((line) => line.includes("Web Skill")),
                ).toContain("[✓]");
            });

            stdin.write(" ");
            await vi.waitFor(() => {
                expect(
                    lastFrame()!
                        .split("\n")
                        .find((line) => line.includes("Web Skill")),
                ).toContain("[ ]");
            });

            await new Promise((resolve) => setTimeout(resolve, 0));
            stdin.write("\r");

            await vi.waitFor(() => expect(mockProvisioner.uninstall).toHaveBeenCalledWith(["web-skill"]));

            expect(trackTelemetryEvent).toHaveBeenCalledWith({
                action: "skills_uninstalled",
                properties: {
                    source: "url",
                    bundleEndpoint: "https://example.com/skills",
                    tool: "claude-code",
                    scope: "system",
                    count: 1,
                    failed: 0,
                    requestedSkills: "web-skill",
                    skills: "web-skill",
                    uninstalledSkills: "web-skill",
                    failedSkills: undefined,
                },
                value: 1,
            });
        });

        it("tracks uninstall failures when removing a skill does not fully succeed", async () => {
            mockProvisioner.getInstalled.mockResolvedValue([makeInstalled("web-skill", BUNDLE_VERSION)]);
            mockProvisioner.uninstall.mockResolvedValue({
                removed: [],
                errors: [{ name: "web-skill", error: "permission denied" }],
            });
            mockProvisioner.install.mockResolvedValue({ installed: [], errors: [] });

            const { lastFrame, stdin } = render(<SkillSelector {...defaultProps} />);

            await vi.waitFor(() => {
                expect(
                    lastFrame()!
                        .split("\n")
                        .find((line) => line.includes("Web Skill")),
                ).toContain("[✓]");
            });

            stdin.write(" ");
            await vi.waitFor(() => {
                expect(
                    lastFrame()!
                        .split("\n")
                        .find((line) => line.includes("Web Skill")),
                ).toContain("[ ]");
            });

            await new Promise((resolve) => setTimeout(resolve, 0));
            stdin.write("\r");

            await vi.waitFor(() => expect(mockProvisioner.uninstall).toHaveBeenCalledWith(["web-skill"]));

            expect(trackTelemetryEvent).toHaveBeenCalledWith({
                action: "skills_uninstalled",
                properties: {
                    source: "url",
                    bundleEndpoint: "https://example.com/skills",
                    tool: "claude-code",
                    scope: "system",
                    count: 0,
                    failed: 1,
                    requestedSkills: "web-skill",
                    skills: undefined,
                    uninstalledSkills: undefined,
                    failedSkills: "web-skill",
                },
                value: 0,
            });

            await vi.waitFor(() => {
                expect(lastFrame()).toContain("1 error(s)");
                expect(lastFrame()).toContain("uninstall web-skill: permission denied");
            });
        });
    });
});
