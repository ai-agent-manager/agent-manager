import React, { useState, useEffect, useRef } from "react";
import path from "node:path";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { readConfig, listCachedBundles, updateSkillVersion, type CachedBundle } from "../bundle/cache.js";
import { readRepoConfig } from "../bundle/repo-config.js";
import { scanBundle } from "../bundle/scanner.js";
import { getBundleVersionDir } from "../config/paths.js";
import { getSkillTools } from "../config/tools.js";
import { findRepoRoot } from "../lib/repo.js";
import { LoadingSpinner } from "./Spinner.js";
import { StatusMessage } from "./StatusMessage.js";

interface SkillVersionManagerProps {
    onBack: () => void;
}

type SubScreen = "select-scope" | "skill-list" | "select-tool" | "select-version" | "align-all";

interface InstalledSkillWithTool {
    skillName: string;
    toolId: string;
    toolName: string;
    currentVersion: string;
    scope: "system" | "repo";
}

interface VersionAvailability {
    version: string;
    hasSkill: boolean;
    published: string;
    isCurrent: boolean;
}

function VersionMenuItem({ label }: { isSelected?: boolean; label: string }) {
    return <Text dimColor={label.includes("not in bundle")}>{label}</Text>;
}

function buildInstalledSkills(config: Awaited<ReturnType<typeof readConfig>>): InstalledSkillWithTool[] {
    const skills: InstalledSkillWithTool[] = [];
    for (const [toolId, skillRecords] of Object.entries(config.installations)) {
        const tool = getSkillTools().find((t) => t.id === toolId);
        const toolName = tool?.name ?? toolId;
        for (const [skillName, record] of Object.entries(skillRecords)) {
            skills.push({ skillName, toolId, toolName, currentVersion: record.bundleVersion, scope: "system" });
        }
    }
    return skills;
}

function buildRepoInstalledSkills(repoConfig: Awaited<ReturnType<typeof readRepoConfig>>): InstalledSkillWithTool[] {
    if (!repoConfig) return [];
    const skills: InstalledSkillWithTool[] = [];
    for (const [toolId, skillRecords] of Object.entries(repoConfig.installations)) {
        const tool = getSkillTools().find((t) => t.id === toolId);
        const toolName = tool?.name ?? toolId;
        for (const [skillName, record] of Object.entries(skillRecords)) {
            skills.push({
                skillName,
                toolId,
                toolName,
                currentVersion: record.bundleVersion ?? repoConfig.bundleVersion,
                scope: "repo",
            });
        }
    }
    return skills;
}

export function SkillVersionManager({ onBack }: SkillVersionManagerProps) {
    const [loading, setLoading] = useState(true);
    const [subScreen, setSubScreen] = useState<SubScreen>("select-scope");
    const [selectedScope, setSelectedScope] = useState<"system" | "repo" | null>(null);
    const [installedSkills, setInstalledSkills] = useState<InstalledSkillWithTool[]>([]);
    const [cachedBundles, setCachedBundles] = useState<CachedBundle[]>([]);
    const [selectedSkill, setSelectedSkill] = useState<InstalledSkillWithTool | null>(null);
    const [selectedSkillInstances, setSelectedSkillInstances] = useState<InstalledSkillWithTool[]>([]);
    const [versionAvailability, setVersionAvailability] = useState<VersionAvailability[]>([]);
    const [versionSelectionNotice, setVersionSelectionNotice] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [messageType, setMessageType] = useState<"success" | "error">("success");
    const [scanning, setScanning] = useState(false);
    const [updating, setUpdating] = useState(false);
    const [detectedRepoRoot, setDetectedRepoRoot] = useState<string | null>(null);
    const [detectedRepoName, setDetectedRepoName] = useState<string | null>(null);
    const messageTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        return () => {
            if (messageTimerRef.current) {
                clearTimeout(messageTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        (async () => {
            const [config, bundles, repoRoot] = await Promise.all([readConfig(), listCachedBundles(), findRepoRoot()]);
            setDetectedRepoRoot(repoRoot);
            if (repoRoot) {
                setDetectedRepoName(path.basename(repoRoot));
            }
            const systemSkills = buildInstalledSkills(config);

            let repoSkills: InstalledSkillWithTool[] = [];
            if (repoRoot) {
                const repoConfig = await readRepoConfig(repoRoot);
                repoSkills = buildRepoInstalledSkills(repoConfig);
            }

            setInstalledSkills([...systemSkills, ...repoSkills]);
            setCachedBundles(bundles);
            setLoading(false);
        })();
    }, []);

    const refreshSkills = async () => {
        const config = await readConfig();
        const systemSkills = buildInstalledSkills(config);

        let repoSkills: InstalledSkillWithTool[] = [];
        const repoRoot = await findRepoRoot();
        if (repoRoot) {
            const repoConfig = await readRepoConfig(repoRoot);
            repoSkills = buildRepoInstalledSkills(repoConfig);
        }

        setInstalledSkills([...systemSkills, ...repoSkills]);
    };

    const loadAvailableVersions = async (skillName: string) => {
        const versions: VersionAvailability[] = [];

        for (const bundle of cachedBundles) {
            try {
                const bundleDir = getBundleVersionDir(bundle.version);
                const contents = await scanBundle(bundleDir);
                const hasSkill = contents.skills.some((s) => s.dirName === skillName);

                versions.push({
                    version: bundle.version,
                    hasSkill,
                    published: bundle.published,
                    isCurrent: bundle.isCurrent,
                });
            } catch {
                versions.push({
                    version: bundle.version,
                    hasSkill: false,
                    published: bundle.published,
                    isCurrent: bundle.isCurrent,
                });
            }
        }

        setVersionAvailability(versions);
        setVersionSelectionNotice(null);
    };

    const resetToScopeScreen = () => {
        setSubScreen("select-scope");
        setSelectedScope(null);
        setSelectedSkill(null);
        setSelectedSkillInstances([]);
        setVersionSelectionNotice(null);
    };

    if (loading) {
        return <LoadingSpinner message="Loading installed skills..." />;
    }

    if (scanning) {
        return <LoadingSpinner message="Scanning bundle versions..." />;
    }

    if (updating) {
        return <LoadingSpinner message="Updating skill version..." />;
    }

    if (message) {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <StatusMessage type={messageType} message={message} />
                <Text dimColor> Returning to menu...</Text>
            </Box>
        );
    }

    // Step 1: Select scope
    if (subScreen === "select-scope") {
        const isInRepo = detectedRepoRoot !== null;
        const systemSkills = installedSkills.filter((s) => s.scope === "system");
        const repoSkills = installedSkills.filter((s) => s.scope === "repo");

        const items = [
            {
                label: `System-wide              ${systemSkills.length} skill(s) installed`,
                value: "system" as const,
            },
            {
                label: isInRepo
                    ? `This repository          ${detectedRepoName} — ${repoSkills.length} skill(s) installed`
                    : "This repository          (not in a git repository)",
                value: "repo" as const,
            },
            {
                label: "\u2190 Back",
                value: "__back__" as const,
            },
        ];

        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>Manage Skill Versions</Text>
                <Text dimColor> Which skills do you want to manage?</Text>
                <Text> </Text>
                <SelectInput
                    items={items}
                    onSelect={(item) => {
                        if (item.value === "__back__") {
                            onBack();
                            return;
                        }
                        if (item.value === "repo" && !isInRepo) {
                            return;
                        }
                        setSelectedScope(item.value);
                        setSubScreen("skill-list");
                    }}
                />
                {!isInRepo && (
                    <Text color="yellow" dimColor>
                        {"  "}Repo-level management requires running agentman from inside a git repository.
                    </Text>
                )}
            </Box>
        );
    }

    // Step 2: Show skills for the selected scope
    if (subScreen === "skill-list" && selectedScope) {
        const scopedSkills = installedSkills.filter((s) => s.scope === selectedScope);

        if (scopedSkills.length === 0) {
            const scopeLabel =
                selectedScope === "repo" ? `this repository (${detectedRepoName ?? "repo"})` : "system-wide";
            return (
                <Box flexDirection="column" marginLeft={2}>
                    <Text bold>Manage Skill Versions</Text>
                    <Text> </Text>
                    <Text>No skills installed {scopeLabel}.</Text>
                    <Text> </Text>
                    <Text dimColor> Install skills first, then return here to manage versions.</Text>
                    <Text> </Text>
                    <SelectInput
                        items={[{ label: "\u2190 Back", value: "back" }]}
                        onSelect={() => resetToScopeScreen()}
                    />
                </Box>
            );
        }

        // Group by skill name
        const uniqueSkills = Array.from(new Set(scopedSkills.map((s) => s.skillName))).map((skillName) => {
            const instances = scopedSkills.filter((s) => s.skillName === skillName);
            return { skillName, instances, count: instances.length };
        });

        const scopeTitle = selectedScope === "repo" ? `This repository (${detectedRepoName ?? "repo"})` : "System-wide";

        const allVersions = scopedSkills.map((s) => s.currentVersion);
        const uniqueVersions = [...new Set(allVersions)];
        const hasMixedVersions = uniqueVersions.length > 1;

        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>Manage Skill Versions — {scopeTitle}</Text>
                <Text dimColor> Select a skill to change its version</Text>
                <Text> </Text>
                <Text dimColor>
                    {" "}
                    {"Skill Name".padEnd(30)}
                    {"Tool".padEnd(20)}Version
                </Text>
                <Text dimColor> {"-".repeat(60)}</Text>
                {uniqueSkills.map((skill) => (
                    <React.Fragment key={skill.skillName}>
                        {skill.instances.map((instance, idx) => (
                            <Text key={`${skill.skillName}-${instance.toolId}`}>
                                {"  "}
                                {idx === 0 ? skill.skillName.padEnd(30) : "".padEnd(30)}
                                {instance.toolName.padEnd(20)}
                                <Text color="cyan">{instance.currentVersion}</Text>
                            </Text>
                        ))}
                    </React.Fragment>
                ))}
                {hasMixedVersions && (
                    <>
                        <Text> </Text>
                        <Text color="yellow"> ⚠ Skills are on different versions ({uniqueVersions.join(", ")})</Text>
                    </>
                )}
                <Text> </Text>
                <SelectInput
                    items={[
                        ...uniqueSkills.map((s) => ({ label: `Change ${s.skillName}`, value: s.skillName })),
                        ...(hasMixedVersions ? [{ label: "Align all to same version", value: "__align__" }] : []),
                        { label: "\u2190 Back", value: "__back__" },
                    ]}
                    onSelect={(item) => {
                        if (item.value === "__back__") {
                            resetToScopeScreen();
                        } else if (item.value === "__align__") {
                            setSubScreen("align-all");
                        } else {
                            (async () => {
                                const instances = scopedSkills.filter((s) => s.skillName === item.value);
                                setSelectedSkillInstances(instances);

                                if (instances.length === 1) {
                                    setSelectedSkill(instances[0]);
                                    setScanning(true);
                                    await loadAvailableVersions(instances[0].skillName);
                                    setScanning(false);
                                    setSubScreen("select-version");
                                } else {
                                    setSubScreen("select-tool");
                                }
                            })();
                        }
                    }}
                />
            </Box>
        );
    }

    // Step 3 (optional): Select tool when a skill is installed across multiple tools in the same scope
    if (subScreen === "select-tool") {
        if (selectedSkillInstances.length === 0) {
            return (
                <Box flexDirection="column" marginLeft={2}>
                    <Text bold>Manage Skill Versions</Text>
                    <Text> </Text>
                    <SelectInput
                        items={[{ label: "\u2190 Back", value: "back" }]}
                        onSelect={() => setSubScreen("skill-list")}
                    />
                </Box>
            );
        }
        const skillName = selectedSkillInstances[0].skillName;
        const items = [
            ...selectedSkillInstances.map((instance) => ({
                label: `${instance.toolName.padEnd(20)} (v${instance.currentVersion})`,
                value: instance.toolId,
            })),
            { label: "\u2190 Back", value: "__back__" },
        ];

        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>Select Tool for {skillName}</Text>
                <Text dimColor> This skill is installed for multiple tools. Which one do you want to update?</Text>
                <Text> </Text>
                <SelectInput
                    items={items}
                    onSelect={(item) => {
                        if (item.value === "__back__") {
                            setSubScreen("skill-list");
                            setSelectedSkillInstances([]);
                            setVersionSelectionNotice(null);
                            return;
                        }

                        (async () => {
                            const instance = selectedSkillInstances.find((i) => i.toolId === item.value);
                            if (instance) {
                                setSelectedSkill(instance);
                                setScanning(true);
                                await loadAvailableVersions(instance.skillName);
                                setScanning(false);
                                setSubScreen("select-version");
                            }
                        })();
                    }}
                />
            </Box>
        );
    }

    // Step 4: Select version
    if (subScreen === "select-version") {
        if (!selectedSkill) {
            return (
                <Box flexDirection="column" marginLeft={2}>
                    <Text bold>Manage Skill Versions</Text>
                    <Text> </Text>
                    <SelectInput
                        items={[{ label: "\u2190 Back", value: "back" }]}
                        onSelect={() => setSubScreen("skill-list")}
                    />
                </Box>
            );
        }
        const otherSkillVersions = installedSkills
            .filter((s) => s.scope === selectedSkill.scope && s.skillName !== selectedSkill.skillName)
            .map((s) => s.currentVersion);
        const uniqueOtherVersions = [...new Set(otherSkillVersions)];
        const unavailableVersionCount = versionAvailability.filter((version) => !version.hasSkill).length;

        const items = [
            ...versionAvailability.map((version) => ({
                label: [
                    version.version,
                    version.version === selectedSkill.currentVersion ? "\u25CF current" : "",
                    !version.hasSkill ? "not in bundle" : "",
                    version.isCurrent ? "\u25CF active bundle" : "",
                ]
                    .filter(Boolean)
                    .join("  "),
                value: version.version,
            })),
            { label: "\u2190 Back", value: "__back__" },
        ];

        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>Change Version: {selectedSkill.skillName}</Text>
                <Text dimColor> Tool: {selectedSkill.toolName}</Text>
                <Text dimColor> Current version: {selectedSkill.currentVersion}</Text>
                {uniqueOtherVersions.length === 1 && uniqueOtherVersions[0] !== selectedSkill.currentVersion && (
                    <Text color="yellow"> ⚠ Other skills in this scope are on {uniqueOtherVersions[0]}</Text>
                )}
                {uniqueOtherVersions.length > 1 && (
                    <Text color="yellow"> ⚠ Other skills in this scope are on mixed versions — consider aligning</Text>
                )}
                <Text> </Text>
                <Text>Select a version to install:</Text>
                {unavailableVersionCount > 0 && (
                    <Text dimColor>
                        {" "}
                        Skill versions marked "not in bundle" were added in a later bundle and cannot be selected.
                    </Text>
                )}
                {versionSelectionNotice && <Text color="yellow"> {versionSelectionNotice}</Text>}
                <Text> </Text>
                <SelectInput
                    items={items}
                    itemComponent={VersionMenuItem}
                    onHighlight={() => setVersionSelectionNotice(null)}
                    onSelect={(item) => {
                        if (item.value === "__back__") {
                            setSubScreen("skill-list");
                            setSelectedSkill(null);
                            setVersionSelectionNotice(null);
                            return;
                        }

                        const selectedVersion = versionAvailability.find((version) => version.version === item.value);
                        if (!selectedVersion?.hasSkill) {
                            setVersionSelectionNotice(
                                `Selected skill not in bundle ${item.value}. Choose a version where ${selectedSkill.skillName} exists.`,
                            );
                            return;
                        }

                        (async () => {
                            setVersionSelectionNotice(null);
                            setUpdating(true);
                            const result = await updateSkillVersion(
                                selectedSkill.toolId,
                                selectedSkill.skillName,
                                item.value,
                                selectedSkill.scope === "repo"
                                    ? { scope: "repo", repoRoot: detectedRepoRoot ?? undefined }
                                    : undefined,
                            );

                            if (result.success) {
                                await refreshSkills();
                                setMessageType("success");
                                setMessage(`${selectedSkill.skillName} updated to version ${item.value}`);
                                if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
                                messageTimerRef.current = setTimeout(() => {
                                    setMessage(null);
                                    setSubScreen("skill-list");
                                    setSelectedSkill(null);
                                    setSelectedSkillInstances([]);
                                    messageTimerRef.current = null;
                                }, 2000);
                            } else {
                                setMessageType("error");
                                setMessage(`Error: ${result.error}`);
                                if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
                                messageTimerRef.current = setTimeout(() => {
                                    setMessage(null);
                                    setSubScreen("skill-list");
                                    setSelectedSkill(null);
                                    setSelectedSkillInstances([]);
                                    messageTimerRef.current = null;
                                }, 3000);
                            }
                            setUpdating(false);
                        })();
                    }}
                />
            </Box>
        );
    }

    // Step 5: Align all skills to the same version
    if (subScreen === "align-all" && selectedScope) {
        const scopedSkills = installedSkills.filter((s) => s.scope === selectedScope);

        const items = [
            ...cachedBundles.map((b) => ({
                label: `${b.version}  ${b.published.slice(0, 10)}${b.isCurrent ? "  ● active" : ""}`,
                value: b.version,
            })),
            { label: "\u2190 Back", value: "__back__" },
        ];

        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>Align All Skills</Text>
                <Text dimColor> Update all {scopedSkills.length} skill(s) in this scope to a single version</Text>
                <Text> </Text>
                <SelectInput
                    items={items}
                    onSelect={(item) => {
                        if (item.value === "__back__") {
                            setSubScreen("skill-list");
                            return;
                        }

                        (async () => {
                            setUpdating(true);
                            const targetVersion = item.value;
                            let successCount = 0;
                            const failures: string[] = [];

                            for (const skill of scopedSkills) {
                                if (skill.currentVersion === targetVersion) {
                                    successCount++;
                                    continue;
                                }
                                const result = await updateSkillVersion(
                                    skill.toolId,
                                    skill.skillName,
                                    targetVersion,
                                    skill.scope === "repo"
                                        ? { scope: "repo", repoRoot: detectedRepoRoot ?? undefined }
                                        : undefined,
                                );
                                if (result.success) {
                                    successCount++;
                                } else {
                                    failures.push(`${skill.skillName} (${skill.toolName}): ${result.error}`);
                                }
                            }

                            await refreshSkills();

                            if (failures.length === 0) {
                                setMessageType("success");
                                setMessage(`All ${successCount} skill(s) aligned to ${targetVersion}`);
                            } else {
                                setMessageType("error");
                                setMessage(
                                    `${successCount} updated, ${failures.length} failed: ${failures.join("; ")}`,
                                );
                            }

                            if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
                            messageTimerRef.current = setTimeout(() => {
                                setMessage(null);
                                setSubScreen("skill-list");
                                messageTimerRef.current = null;
                            }, 2500);

                            setUpdating(false);
                        })();
                    }}
                />
            </Box>
        );
    }

    // Defensive fallback
    return (
        <Box flexDirection="column" marginLeft={2}>
            <Text bold>Manage Skill Versions</Text>
            <Text> </Text>
            <SelectInput items={[{ label: "\u2190 Back", value: "back" }]} onSelect={() => resetToScopeScreen()} />
        </Box>
    );
}
