import { describe, expect, it, vi } from "vitest";
import {
    checkForAppUpdate,
    compareVersions,
    createSelfUpdatePlan,
    runSelfUpdate,
    type SelfUpdatePlan,
} from "../../../src/lib/self-update.js";

describe("createSelfUpdatePlan", () => {
    it("targets the stable npm package for stable releases", () => {
        const plan = createSelfUpdatePlan("1.2.3", "@ai-agent-manager/cli");

        expect(plan.packageSpec).toBe("@ai-agent-manager/cli@latest");
        expect(plan.channelLabel).toBe("latest stable release");
        expect(plan.command).toBe("npm install --global @ai-agent-manager/cli@latest");
    });

    it("targets the beta package for prerelease builds", () => {
        const plan = createSelfUpdatePlan("1.2.3-beta.1", "@ai-agent-manager/cli");

        expect(plan.packageSpec).toBe("@ai-agent-manager/cli@beta");
        expect(plan.channelLabel).toBe("latest beta release");
        expect(plan.command).toBe("npm install --global @ai-agent-manager/cli@beta");
    });
});

describe("runSelfUpdate", () => {
    const stablePlan: SelfUpdatePlan = {
        packageSpec: "@ai-agent-manager/cli@latest",
        command: "npm install --global @ai-agent-manager/cli@latest",
        channelLabel: "latest stable release",
    };

    it("invokes npm with the expected arguments", async () => {
        const runner = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

        await runSelfUpdate(stablePlan, runner);

        expect(runner).toHaveBeenCalledTimes(1);
        expect(runner).toHaveBeenCalledWith(expect.stringMatching(/^npm(\.cmd)?$/), [
            "install",
            "--global",
            "@ai-agent-manager/cli@latest",
        ]);
    });

    it("throws a useful error when npm returns a non-zero exit code", async () => {
        const runner = vi.fn().mockResolvedValue({ stdout: "", stderr: "permission denied", exitCode: 1 });

        await expect(runSelfUpdate(stablePlan, runner)).rejects.toThrow("permission denied");
    });
});

describe("compareVersions", () => {
    it("treats a newer stable release as greater", () => {
        expect(compareVersions("1.2.0", "1.1.9")).toBe(1);
    });

    it("treats equal versions as equal", () => {
        expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    });

    it("treats stable releases as newer than prereleases", () => {
        expect(compareVersions("1.2.3", "1.2.3-beta.1")).toBe(1);
    });

    it("orders prerelease identifiers correctly", () => {
        expect(compareVersions("1.2.3-beta.2", "1.2.3-beta.1")).toBe(1);
    });
});

describe("checkForAppUpdate", () => {
    it("reports when a newer stable release is available", async () => {
        const runner = vi.fn().mockResolvedValue({ stdout: '"1.3.0"', stderr: "", exitCode: 0 });

        await expect(checkForAppUpdate("1.2.0", runner)).resolves.toEqual({
            currentVersion: "1.2.0",
            latestVersion: "1.3.0",
            updateAvailable: true,
            channelLabel: "latest stable release",
        });
    });

    it("reports no update when already on the latest beta release", async () => {
        const runner = vi.fn().mockResolvedValue({ stdout: '"1.2.3-beta.1"', stderr: "", exitCode: 0 });

        await expect(checkForAppUpdate("1.2.3-beta.1", runner)).resolves.toEqual({
            currentVersion: "1.2.3-beta.1",
            latestVersion: "1.2.3-beta.1",
            updateAvailable: false,
            channelLabel: "latest beta release",
        });
    });

    it("throws when npm view fails", async () => {
        const runner = vi.fn().mockResolvedValue({ stdout: "", stderr: "registry unavailable", exitCode: 1 });

        await expect(checkForAppUpdate("1.2.0", runner)).rejects.toThrow("registry unavailable");
    });
});
