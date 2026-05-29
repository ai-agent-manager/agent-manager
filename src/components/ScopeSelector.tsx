import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { InstallScope } from "../config/scopes.js";
import { findRepoRoot, getRepoName } from "../lib/repo.js";
import { readRepoConfig } from "../bundle/repo-config.js";
import { LoadingSpinner } from "./Spinner.js";
import { trackTelemetryError } from "../telemetry.js";

interface ScopeSelectorProps {
    onSelect: (scope: InstallScope, repoRoot: string | null) => void;
    onBack: () => void;
}

export function ScopeSelector({ onSelect, onBack }: ScopeSelectorProps) {
    const [repoRoot, setRepoRoot] = useState<string | null>(null);
    const [repoName, setRepoName] = useState<string | null>(null);
    const [pinnedVersion, setPinnedVersion] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const root = await findRepoRoot();
                setRepoRoot(root);
                if (root) {
                    const name = await getRepoName();
                    setRepoName(name);
                    const config = await readRepoConfig(root);
                    setPinnedVersion(config?.bundleVersion ?? null);
                }
            } catch (error) {
                trackTelemetryError("repo_scope_detection_failed", error);
            }
            setLoading(false);
        })();
    }, []);

    if (loading) {
        return <LoadingSpinner message="Detecting repository..." />;
    }

    const isInRepo = repoRoot !== null;

    const items = [
        {
            label: "System-wide              Install to your home directory (all projects)",
            value: "system" as const,
        },
        {
            label: isInRepo
                ? `This repository          Install to ${repoName ?? "repo"}/${pinnedVersion ? ` (pinned: ${pinnedVersion.slice(0, 7)})` : ""}`
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
            <Text bold>Where do you want to install skills?</Text>
            <Text> </Text>
            <SelectInput
                items={items}
                onSelect={(item) => {
                    if (item.value === "__back__") {
                        onBack();
                        return;
                    }
                    if (item.value === "repo" && !isInRepo) {
                        // Disabled — do nothing
                        return;
                    }
                    onSelect(item.value, item.value === "repo" ? repoRoot : null);
                }}
            />
            {!isInRepo && (
                <Text color="yellow" dimColor>
                    {"  "}Repo-level installation requires running agentman from inside a git repository.
                </Text>
            )}
        </Box>
    );
}
