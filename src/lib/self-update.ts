import { spawn } from "node:child_process";
import { APP_NAME, APP_VERSION } from "../app-info.js";

const BETA_PACKAGE_NAME = "@ai-agent-manager/cli";

export interface SelfUpdatePlan {
    packageSpec: string;
    command: string;
    channelLabel: string;
}

export interface AppUpdateCheckResult {
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    channelLabel: string;
}

export interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

interface ParsedSemver {
    major: number;
    minor: number;
    patch: number;
    prerelease: string[];
}

export function createSelfUpdatePlan(appVersion: string = APP_VERSION, packageName: string = APP_NAME): SelfUpdatePlan {
    const isPrerelease = appVersion.includes("-");
    const packageSpec = isPrerelease ? `${BETA_PACKAGE_NAME}@beta` : `${packageName}@latest`;
    const channelLabel = isPrerelease ? "latest beta release" : "latest stable release";

    return {
        packageSpec,
        command: `npm install --global ${packageSpec}`,
        channelLabel,
    };
}

function parseSemver(version: string): ParsedSemver {
    const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);

    if (!match) {
        throw new Error(`Invalid version: ${version}`);
    }

    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ? match[4].split(".") : [],
    };
}

function comparePrerelease(left: string[], right: string[]): number {
    if (left.length === 0 && right.length === 0) {
        return 0;
    }

    if (left.length === 0) {
        return 1;
    }

    if (right.length === 0) {
        return -1;
    }

    const maxLength = Math.max(left.length, right.length);

    for (let index = 0; index < maxLength; index += 1) {
        const leftPart = left[index];
        const rightPart = right[index];

        if (leftPart === undefined) {
            return -1;
        }

        if (rightPart === undefined) {
            return 1;
        }

        const leftNumeric = /^\d+$/.test(leftPart);
        const rightNumeric = /^\d+$/.test(rightPart);

        if (leftNumeric && rightNumeric) {
            const difference = Number(leftPart) - Number(rightPart);
            if (difference !== 0) {
                return difference > 0 ? 1 : -1;
            }
            continue;
        }

        if (leftNumeric !== rightNumeric) {
            return leftNumeric ? -1 : 1;
        }

        const comparison = leftPart.localeCompare(rightPart);
        if (comparison !== 0) {
            return comparison > 0 ? 1 : -1;
        }
    }

    return 0;
}

export function compareVersions(left: string, right: string): number {
    const leftVersion = parseSemver(left);
    const rightVersion = parseSemver(right);

    if (leftVersion.major !== rightVersion.major) {
        return leftVersion.major > rightVersion.major ? 1 : -1;
    }

    if (leftVersion.minor !== rightVersion.minor) {
        return leftVersion.minor > rightVersion.minor ? 1 : -1;
    }

    if (leftVersion.patch !== rightVersion.patch) {
        return leftVersion.patch > rightVersion.patch ? 1 : -1;
    }

    return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

function parseNpmViewVersion(stdout: string): string {
    const trimmed = stdout.trim();

    if (!trimmed) {
        throw new Error("npm view returned an empty version response");
    }

    try {
        const parsed = JSON.parse(trimmed) as string | string[];
        if (Array.isArray(parsed)) {
            const version = parsed.at(-1);
            if (!version) {
                throw new Error("npm view returned an empty version array");
            }
            return version;
        }

        return parsed;
    } catch {
        return trimmed;
    }
}

export async function runCommand(command: string, args: string[]): Promise<CommandResult> {
    return await new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("error", reject);
        child.on("close", (exitCode) => {
            resolve({
                stdout,
                stderr,
                exitCode: exitCode ?? 1,
            });
        });
    });
}

export async function runSelfUpdate(plan: SelfUpdatePlan, runner: CommandRunner = runCommand): Promise<CommandResult> {
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = await runner(npmCommand, ["install", "--global", plan.packageSpec]);

    if (result.exitCode !== 0) {
        const errorOutput = result.stderr.trim() || result.stdout.trim();
        throw new Error(errorOutput || `Self-update failed with exit code ${result.exitCode}`);
    }

    return result;
}

export async function checkForAppUpdate(
    appVersion: string = APP_VERSION,
    runner: CommandRunner = runCommand,
): Promise<AppUpdateCheckResult> {
    const plan = createSelfUpdatePlan(appVersion);
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = await runner(npmCommand, ["view", plan.packageSpec, "version", "--json"]);

    if (result.exitCode !== 0) {
        const errorOutput = result.stderr.trim() || result.stdout.trim();
        throw new Error(errorOutput || `Version check failed with exit code ${result.exitCode}`);
    }

    const latestVersion = parseNpmViewVersion(result.stdout);

    return {
        currentVersion: appVersion,
        latestVersion,
        updateAvailable: compareVersions(latestVersion, appVersion) > 0,
        channelLabel: plan.channelLabel,
    };
}
