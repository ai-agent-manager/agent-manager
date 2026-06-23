import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SkillInfo } from "../bundle/scanner.js";
import type { InstallScope } from "../config/scopes.js";
import { ClaudeCodeProvisioner } from "../provisioners/ClaudeCodeProvisioner.js";
import { CopilotProvisioner } from "../provisioners/CopilotProvisioner.js";
import { CursorProvisioner } from "../provisioners/CursorProvisioner.js";
import { KiroProvisioner } from "../provisioners/KiroProvisioner.js";
import { SkillProvisioner } from "../provisioners/SkillProvisioner.js";
import type { InstalledSkill, ProvisionerScope, UninstallResult } from "../provisioners/types.js";
import { WindsurfProvisioner } from "../provisioners/WindsurfProvisioner.js";
import type { TelemetryValue } from "../telemetry.js";
import { trackTelemetryError, trackTelemetryEvent } from "../telemetry.js";
import { LoadingSpinner } from "./Spinner.js";
import { StatusMessage } from "./StatusMessage.js";

interface SkillSelectorProps {
    toolId: string;
    skills: SkillInfo[];
    bundleVersion: string;
    scope: InstallScope;
    repoRoot: string | null;
    bundleTelemetryProps: Record<string, TelemetryValue>;
    onBack: () => void;
    onDone: () => void;
}

function serialiseSkillNames(skillNames: string[]): string | undefined {
    if (skillNames.length === 0) {
        return undefined;
    }

    return [...skillNames].sort().join(":");
}

function getProvisioner(toolId: string, scope: InstallScope, repoRoot: string | null): SkillProvisioner {
    const options: ProvisionerScope | undefined =
        scope === "repo" && repoRoot ? { scope: "repo", repoRoot } : undefined;

    switch (toolId) {
        case "claude-code":
            return new ClaudeCodeProvisioner(options);
        case "windsurf":
            return new WindsurfProvisioner(options);
        case "github-copilot":
            return new CopilotProvisioner(options);
        case "cursor":
            return new CursorProvisioner(options);
        case "kiro":
            return new KiroProvisioner(options);
        default:
            throw new Error(`Unknown tool: ${toolId}`);
    }
}

export function SkillSelector({
    toolId,
    skills,
    bundleVersion,
    scope,
    repoRoot,
    bundleTelemetryProps,
    onBack,
    onDone,
}: SkillSelectorProps) {
    const [installed, setInstalled] = useState<InstalledSkill[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [cursor, setCursor] = useState(0);
    const [loading, setLoading] = useState(true);
    const [installing, setInstalling] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [result, setResult] = useState<{
        installed: number;
        uninstalled: number;
        skipped: number;
        errors: string[];
    } | null>(null);

    const provisioner = getProvisioner(toolId, scope, repoRoot);
    const note = provisioner.getNote();

    useEffect(() => {
        (async () => {
            try {
                const currentlyInstalled = await provisioner.getInstalled();
                setInstalled(currentlyInstalled);
                setSelected(new Set(currentlyInstalled.map((item) => item.name)));
            } catch (error) {
                trackTelemetryError("installed_skills_load_failed", error, {
                    ...bundleTelemetryProps,
                    tool: toolId,
                    scope,
                });
                setLoadError(error instanceof Error ? error.message : String(error));
            } finally {
                setLoading(false);
            }
        })();
    }, [toolId]);

    useInput((input, key) => {
        if (installing || loading || result) {
            return;
        }

        if (key.upArrow) {
            setCursor((current) => Math.max(0, current - 1));
            return;
        }

        if (key.downArrow) {
            setCursor((current) => Math.min(skills.length, current + 1));
            return;
        }

        if (input === " " && cursor < skills.length) {
            const skill = skills[cursor];
            setSelected((previous) => {
                const next = new Set(previous);
                if (next.has(skill.dirName)) {
                    next.delete(skill.dirName);
                } else {
                    next.add(skill.dirName);
                }
                return next;
            });
            return;
        }

        if (key.return) {
            if (cursor === skills.length) {
                onBack();
                return;
            }

            setInstalling(true);

            (async () => {
                const toInstall = skills.filter((skill) => selected.has(skill.dirName));
                const toUninstall = installed
                    .filter((installedSkill) => !selected.has(installedSkill.name))
                    .map((installedSkill) => installedSkill.name);

                let uninstallResult: UninstallResult = { removed: [], errors: [] };

                if (toUninstall.length > 0) {
                    uninstallResult = await provisioner.uninstall(toUninstall);
                    trackTelemetryEvent({
                        action: "skills_uninstalled",
                        properties: {
                            ...bundleTelemetryProps,
                            tool: toolId,
                            scope,
                            count: uninstallResult.removed.length,
                            failed: uninstallResult.errors.length,
                            requestedSkills: serialiseSkillNames(toUninstall),
                            skills: serialiseSkillNames(uninstallResult.removed.map((skill) => skill.name)),
                            uninstalledSkills: serialiseSkillNames(uninstallResult.removed.map((skill) => skill.name)),
                            failedSkills: serialiseSkillNames(uninstallResult.errors.map((skill) => skill.name)),
                        },
                        value: uninstallResult.removed.length,
                    });
                }

                const newInstalls = toInstall.filter(
                    (skill) => !installed.find((installedSkill) => installedSkill.name === skill.dirName),
                );

                const skipped = toInstall.filter((skill) => {
                    const existingInstall = installed.find((installedSkill) => installedSkill.name === skill.dirName);
                    return Boolean(existingInstall && existingInstall.bundleVersion !== bundleVersion);
                }).length;

                const installResult = await provisioner.install(newInstalls, bundleVersion);

                trackTelemetryEvent({
                    action: "skills_installed",
                    properties: {
                        ...bundleTelemetryProps,
                        tool: toolId,
                        scope,
                        installed: installResult.installed.length,
                        failed: installResult.errors.length,
                        requestedSkills: serialiseSkillNames(toInstall.map((skill) => skill.dirName)),
                        installedSkills: serialiseSkillNames(installResult.installed.map((skill) => skill.name)),
                        failedSkills: serialiseSkillNames(installResult.errors.map((skill) => skill.name)),
                    },
                    value: installResult.installed.length,
                });

                setResult({
                    installed: installResult.installed.length,
                    uninstalled: uninstallResult.removed.length,
                    skipped,
                    errors: [
                        ...uninstallResult.errors.map((entry) => `uninstall ${entry.name}: ${entry.error}`),
                        ...installResult.errors.map((entry) => `${entry.name}: ${entry.error}`),
                    ],
                });
                setInstalling(false);

                setTimeout(() => onDone(), 2000);
            })();
            return;
        }

        if (key.escape) {
            onBack();
        }
    });

    if (loading) {
        return <LoadingSpinner message="Checking installed skills..." />;
    }

    if (loadError) {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <StatusMessage type="error" message={loadError} />
                <Text dimColor> Press Esc to go back.</Text>
            </Box>
        );
    }

    if (installing) {
        return <LoadingSpinner message="Applying skill changes..." />;
    }

    if (result) {
        const scopeLabel = scope === "repo" ? "to repository" : "system-wide";
        const summaryParts = [`${result.installed} skill(s) installed`, `${result.uninstalled} skill(s) uninstalled`];

        return (
            <Box flexDirection="column" marginLeft={2}>
                <StatusMessage
                    type={result.errors.length > 0 ? "warning" : "success"}
                    message={`${summaryParts.join(", ")} ${scopeLabel}${result.errors.length > 0 ? `, ${result.errors.length} error(s)` : ""}`}
                />
                {result.errors.map((entry, index) => (
                    <Text key={index} color="red">
                        {" "}
                        {entry}
                    </Text>
                ))}
                {result.skipped > 0 && (
                    <Text color="yellow">
                        {" "}
                        {result.skipped} skill(s) already at a different version — use 'Manage Skill Versions' to
                        update.
                    </Text>
                )}
                <Text dimColor> Returning to menu...</Text>
            </Box>
        );
    }

    const getStatus = (skillName: string): string => {
        const installedSkill = installed.find((item) => item.name === skillName);
        if (!installedSkill) {
            return "not installed";
        }

        if (installedSkill.bundleVersion === bundleVersion) {
            return `installed (${installedSkill.bundleVersion.slice(0, 7)})`;
        }

        return `outdated (${installedSkill.bundleVersion.slice(0, 7)})`;
    };

    const scopeLabel = scope === "repo" ? "this repository" : "system-wide";

    return (
        <Box flexDirection="column" marginLeft={2}>
            <Text bold>
                Select skills to install for {provisioner.name} <Text dimColor>({scopeLabel})</Text>:
            </Text>
            {note && scope === "system" && <Text color="yellow"> {note}</Text>}
            <Text> </Text>
            {skills.map((skill, index) => {
                const isSelected = selected.has(skill.dirName);
                const isCursor = index === cursor;
                const status = getStatus(skill.dirName);
                const displayName = skill.meta?.name ?? skill.dirName;
                const description = skill.meta?.description ?? "";

                return (
                    <Text key={skill.dirName}>
                        {isCursor ? "  ❯ " : "    "}
                        {isSelected ? "[✓]" : "[ ]"} {displayName.padEnd(28)}
                        <Text dimColor>{description.slice(0, 40).padEnd(40)}</Text>
                        <Text
                            color={
                                status.includes("outdated") ? "yellow" : status.includes("installed") ? "green" : "gray"
                            }
                        >
                            {` ${status}`}
                        </Text>
                    </Text>
                );
            })}
            <Text>
                {cursor === skills.length ? "  ❯ " : "    "}
                {"← Back"}
            </Text>
            <Text> </Text>
            <Text dimColor> Space to check/uncheck (install/uninstall), Enter to confirm, Esc to go back</Text>
        </Box>
    );
}
