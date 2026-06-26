import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
    readRepoConfig,
    writeRepoConfig,
    recordRepoInstall,
    removeRepoInstallRecord,
    pinRepoVersion,
    REPO_CONFIG_FILENAME,
    type RepoAgentmanConfig,
} from "../../../src/bundle/repo-config.js";

describe("repo-config", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(path.join(os.tmpdir(), "agentman-repo-config-"));
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    describe("readRepoConfig", () => {
        it("returns null when config does not exist", async () => {
            const config = await readRepoConfig(tmpDir);
            expect(config).toBeNull();
        });

        it("throws when config exists but contains invalid JSON", async () => {
            const { writeFile } = await import("node:fs/promises");
            await writeFile(path.join(tmpDir, REPO_CONFIG_FILENAME), "{ invalid json");

            await expect(readRepoConfig(tmpDir)).rejects.toThrow();
        });

        it("reads an existing config file", async () => {
            const expected: RepoAgentmanConfig = {
                bundleVersion: "abc123",
                installations: {
                    "claude-code": {
                        "my-skill": { installedAt: "2025-01-01T00:00:00Z", method: "symlink" },
                    },
                },
            };
            const { writeFile } = await import("node:fs/promises");
            await writeFile(path.join(tmpDir, REPO_CONFIG_FILENAME), JSON.stringify(expected));

            const config = await readRepoConfig(tmpDir);
            expect(config).toEqual(expected);
        });
    });

    describe("writeRepoConfig", () => {
        it("writes the config file with trailing newline", async () => {
            const config: RepoAgentmanConfig = {
                bundleVersion: "def456",
                installations: {},
            };
            await writeRepoConfig(tmpDir, config);

            const raw = await readFile(path.join(tmpDir, REPO_CONFIG_FILENAME), "utf-8");
            expect(raw.endsWith("\n")).toBe(true);
            expect(JSON.parse(raw)).toEqual(config);
        });
    });

    describe("recordRepoInstall", () => {
        it("creates config if it does not exist", async () => {
            await recordRepoInstall(
                tmpDir,
                "claude-code",
                "my-skill",
                {
                    installedAt: "2025-01-01T00:00:00Z",
                    method: "symlink",
                },
                "abc123",
            );

            const config = await readRepoConfig(tmpDir);
            expect(config).not.toBeNull();
            expect(config!.bundleVersion).toBe("abc123");
            expect(config!.installations["claude-code"]["my-skill"]).toEqual({
                bundleVersion: "abc123",
                installedAt: "2025-01-01T00:00:00Z",
                method: "symlink",
            });
        });

        it("updates existing config with new skill", async () => {
            await recordRepoInstall(
                tmpDir,
                "claude-code",
                "skill-a",
                {
                    installedAt: "2025-01-01T00:00:00Z",
                    method: "symlink",
                },
                "abc123",
            );

            await recordRepoInstall(
                tmpDir,
                "claude-code",
                "skill-b",
                {
                    installedAt: "2025-01-02T00:00:00Z",
                    method: "copy",
                },
                "abc123",
            );

            const config = await readRepoConfig(tmpDir);
            expect(Object.keys(config!.installations["claude-code"])).toHaveLength(2);
        });

        it("does not overwrite top-level bundleVersion on subsequent installs", async () => {
            await recordRepoInstall(
                tmpDir,
                "claude-code",
                "skill-a",
                {
                    installedAt: "2025-01-01T00:00:00Z",
                    method: "symlink",
                },
                "version-1",
            );

            await recordRepoInstall(
                tmpDir,
                "windsurf",
                "skill-b",
                {
                    installedAt: "2025-01-02T00:00:00Z",
                    method: "symlink",
                },
                "version-2",
            );

            const config = await readRepoConfig(tmpDir);
            // Top-level bundleVersion stays at initial value; per-skill versions are independent
            expect(config!.bundleVersion).toBe("version-1");
            expect(config!.installations["claude-code"]["skill-a"].bundleVersion).toBe("version-1");
            expect(config!.installations["windsurf"]["skill-b"].bundleVersion).toBe("version-2");
        });
    });

    describe("removeRepoInstallRecord", () => {
        it("removes a skill from the config", async () => {
            await recordRepoInstall(
                tmpDir,
                "claude-code",
                "skill-a",
                {
                    installedAt: "2025-01-01T00:00:00Z",
                    method: "symlink",
                },
                "abc123",
            );

            await removeRepoInstallRecord(tmpDir, "claude-code", "skill-a");

            const config = await readRepoConfig(tmpDir);
            expect(config!.installations["claude-code"]).toBeUndefined();
        });

        it("does nothing if config does not exist", async () => {
            await removeRepoInstallRecord(tmpDir, "claude-code", "nonexistent");
            const config = await readRepoConfig(tmpDir);
            expect(config).toBeNull();
        });

        it("cleans up empty tool entries", async () => {
            await recordRepoInstall(
                tmpDir,
                "claude-code",
                "skill-a",
                {
                    installedAt: "2025-01-01T00:00:00Z",
                    method: "symlink",
                },
                "abc123",
            );

            await recordRepoInstall(
                tmpDir,
                "windsurf",
                "skill-b",
                {
                    installedAt: "2025-01-02T00:00:00Z",
                    method: "symlink",
                },
                "abc123",
            );

            await removeRepoInstallRecord(tmpDir, "claude-code", "skill-a");

            const config = await readRepoConfig(tmpDir);
            expect(config!.installations["claude-code"]).toBeUndefined();
            expect(config!.installations["windsurf"]).toBeDefined();
        });
    });

    describe("pinRepoVersion", () => {
        it("creates config with pinned version if none exists", async () => {
            await pinRepoVersion(tmpDir, "pinned-hash");

            const config = await readRepoConfig(tmpDir);
            expect(config!.bundleVersion).toBe("pinned-hash");
            expect(config!.installations).toEqual({});
        });

        it("updates version on existing config without removing installations", async () => {
            await recordRepoInstall(
                tmpDir,
                "claude-code",
                "skill-a",
                {
                    installedAt: "2025-01-01T00:00:00Z",
                    method: "symlink",
                },
                "old-version",
            );

            await pinRepoVersion(tmpDir, "new-version");

            const config = await readRepoConfig(tmpDir);
            expect(config!.bundleVersion).toBe("new-version");
            expect(config!.installations["claude-code"]["skill-a"]).toBeDefined();
        });
    });
});
