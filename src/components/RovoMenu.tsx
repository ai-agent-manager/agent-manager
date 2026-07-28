import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import type { RovoAgentInfo } from "../bundle/scanner.js";
import { RovoProvisioner } from "../provisioners/RovoProvisioner.js";
import type {
    KnowledgePage,
    CreateAgentResult,
    ExistingKnowledgeBase,
    KnowledgeBaseStrategy,
} from "../provisioners/RovoProvisioner.js";
import { LoadingSpinner } from "./Spinner.js";
import { StatusMessage } from "./StatusMessage.js";
import type { TelemetryValue } from "../telemetry.js";
import { trackTelemetryError, trackTelemetryEvent } from "../telemetry.js";

interface RovoMenuProps {
    rovoAgents: RovoAgentInfo[];
    bundleTelemetryProps: Record<string, TelemetryValue>;
    onBack: () => void;
}

type RovoState =
    | "select-agent"
    | "enter-url"
    | "check-auth"
    | "authenticating"
    | "enter-confluence-url"
    | "enter-confluence-space"
    | "check-kb-exists"
    | "kb-exists-choice"
    | "select-mode"
    | "provisioning"
    | "done";

/**
 * Shared provisioner instance — keeps auth state check results consistent
 * and avoids re-instantiating on every render.
 */
function createProvisioner(onProgress: (msg: string) => void) {
    return new RovoProvisioner({ onProgress });
}

export function RovoMenu({ rovoAgents, bundleTelemetryProps, onBack }: RovoMenuProps) {
    const [state, setState] = useState<RovoState>("select-agent");
    const [selectedAgent, setSelectedAgent] = useState<RovoAgentInfo | null>(null);
    const [studioUrl, setStudioUrl] = useState("");
    const [urlSubmitted, setUrlSubmitted] = useState(false);
    const [confluenceBaseUrl, setConfluenceBaseUrl] = useState("");
    const [confluenceSpaceKey, setConfluenceSpaceKey] = useState("");
    const [confluenceDetailsSubmitted, setConfluenceDetailsSubmitted] = useState(false);
    const [knowledgePages, setKnowledgePages] = useState<KnowledgePage[]>([]);
    const [progress, setProgress] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [headless, setHeadless] = useState(false);
    const [existingKb, setExistingKb] = useState<ExistingKnowledgeBase | null>(null);
    const [kbStrategy, setKbStrategy] = useState<KnowledgeBaseStrategy | undefined>(undefined);

    /** True when the currently selected agent has knowledge-base files to upload */
    const agentHasKnowledgeBase = (selectedAgent?.knowledgeBaseFiles.length ?? 0) > 0;

    /**
     * After auth is confirmed (or just completed), decide the next screen:
     * if the agent has a knowledge base and Confluence details haven't been
     * captured yet, collect them first — otherwise go straight to mode selection.
     */
    const afterAuth = () => {
        if (agentHasKnowledgeBase && !confluenceDetailsSubmitted) {
            setState("enter-confluence-url");
        } else {
            setState("select-mode");
        }
    };

    // -------------------------------------------------------------------------
    // select-agent: pick which Rovo agent to provision
    // -------------------------------------------------------------------------
    if (state === "select-agent") {
        const items = [
            ...rovoAgents.map((agent) => ({
                label: `${(agent.config.identity.name ?? agent.dirName).padEnd(30)}${agent.config.identity.description ?? ""}`,
                value: agent.dirName,
            })),
            { label: "\u2190 Back", value: "__back__" },
        ];

        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>Available Rovo agents in this bundle:</Text>
                <Text> </Text>
                <SelectInput
                    limit={12}
                    items={items}
                    onSelect={(item) => {
                        if (item.value === "__back__") {
                            onBack();
                            return;
                        }
                        const agent = rovoAgents.find((a) => a.dirName === item.value);
                        if (agent) {
                            setSelectedAgent(agent);
                            setError(null);
                            // If URL was already entered in a previous round, skip straight to auth check
                            setState(urlSubmitted ? "check-auth" : "enter-url");
                        }
                    }}
                />
            </Box>
        );
    }

    // -------------------------------------------------------------------------
    // enter-url: ask for Studio URL (once per session)
    // -------------------------------------------------------------------------
    if (state === "enter-url") {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>Provision: {selectedAgent?.config.identity.name ?? selectedAgent?.dirName}</Text>
                <Text> </Text>
                <Text>Enter your Atlassian Studio URL:</Text>
                <Text dimColor> (e.g., https://studio.atlassian.com/s/YOUR-WORKSPACE-ID/agents)</Text>
                <Text> </Text>
                <Box>
                    <Text> URL: </Text>
                    <TextInput
                        value={studioUrl}
                        onChange={setStudioUrl}
                        onSubmit={(url) => {
                            if (!url.trim()) return;
                            setStudioUrl(url.trim());
                            setUrlSubmitted(true);
                            setState("check-auth");
                        }}
                    />
                </Box>
            </Box>
        );
    }

    // -------------------------------------------------------------------------
    // check-auth: see if we have a valid saved session
    // -------------------------------------------------------------------------
    if (state === "check-auth") {
        return (
            <CheckAuth
                studioUrl={studioUrl}
                bundleTelemetryProps={bundleTelemetryProps}
                onHasAuth={afterAuth}
                onNeedsAuth={() => setState("authenticating")}
                onError={(err) => {
                    setError(err);
                    setState("done");
                }}
            />
        );
    }

    // -------------------------------------------------------------------------
    // authenticating: headed browser for interactive login
    // -------------------------------------------------------------------------
    if (state === "authenticating") {
        return (
            <Authenticate
                studioUrl={studioUrl}
                bundleTelemetryProps={bundleTelemetryProps}
                onProgress={setProgress}
                onSuccess={() => {
                    setProgress("");
                    afterAuth();
                }}
                onError={(err) => {
                    setError(err);
                    setState("done");
                }}
                progress={progress}
            />
        );
    }

    // -------------------------------------------------------------------------
    // enter-confluence-url: capture the Confluence base URL (once per session)
    // -------------------------------------------------------------------------
    if (state === "enter-confluence-url") {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>Knowledge base detected — Confluence upload</Text>
                <Text> </Text>
                <Text>
                    {selectedAgent?.knowledgeBaseFiles.length ?? 0} Markdown file(s) found in{" "}
                    <Text color="cyan">assets/knowledge-base/</Text>. They will be uploaded as Confluence pages under a
                    folder named after the agent.
                </Text>
                <Text> </Text>
                <Text>Enter your Confluence base URL:</Text>
                <Text dimColor> (e.g., https://yourcompany.atlassian.net)</Text>
                <Text> </Text>
                <Box>
                    <Text> URL: </Text>
                    <TextInput
                        value={confluenceBaseUrl}
                        onChange={setConfluenceBaseUrl}
                        onSubmit={(url) => {
                            if (!url.trim()) return;
                            setConfluenceBaseUrl(url.trim().replace(/\/+$/, ""));
                            setState("enter-confluence-space");
                        }}
                    />
                </Box>
            </Box>
        );
    }

    // -------------------------------------------------------------------------
    // enter-confluence-space: capture the Confluence space key
    // -------------------------------------------------------------------------
    if (state === "enter-confluence-space") {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>Knowledge base detected — Confluence upload</Text>
                <Text> </Text>
                <Text>Enter the Confluence space key where pages should be created:</Text>
                <Text dimColor> (e.g., TEAM — the key shown in your space URL)</Text>
                <Text> </Text>
                <Box>
                    <Text> Space key: </Text>
                    <TextInput
                        value={confluenceSpaceKey}
                        onChange={setConfluenceSpaceKey}
                        onSubmit={(key) => {
                            if (!key.trim()) return;
                            setConfluenceSpaceKey(key.trim().toUpperCase());
                            setConfluenceDetailsSubmitted(true);
                            setState("check-kb-exists");
                        }}
                    />
                </Box>
            </Box>
        );
    }

    // -------------------------------------------------------------------------
    // check-kb-exists: check if Confluence pages already exist for this agent
    // -------------------------------------------------------------------------
    if (state === "check-kb-exists") {
        return (
            <CheckKbExists
                confluenceBaseUrl={confluenceBaseUrl}
                confluenceSpaceKey={confluenceSpaceKey}
                agentName={selectedAgent?.config.identity.name ?? selectedAgent?.dirName ?? ""}
                bundleTelemetryProps={bundleTelemetryProps}
                onExists={(existing) => {
                    setExistingKb(existing);
                    setState("kb-exists-choice");
                }}
                onNotExists={() => {
                    setExistingKb(null);
                    setKbStrategy(undefined);
                    setState("select-mode");
                }}
                onError={(err) => {
                    setError(err);
                    setState("done");
                }}
            />
        );
    }

    // -------------------------------------------------------------------------
    // kb-exists-choice: ask user to overwrite or reuse existing pages
    // -------------------------------------------------------------------------
    if (state === "kb-exists-choice" && existingKb) {
        const items = [
            { label: "Overwrite — update existing pages with latest content", value: "overwrite" },
            { label: "Reuse — use the existing page links as-is", value: "reuse" },
        ];

        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold color="yellow">
                    Existing knowledge base found in Confluence
                </Text>
                <Text> </Text>
                <Text>
                    A page titled <Text color="cyan">"{existingKb.parentPage.title}"</Text> already exists with{" "}
                    {existingKb.childPages.length} child page(s):
                </Text>
                {existingKb.childPages.map((p) => (
                    <Text key={p.url}>
                        {" "}
                        • <Text color="cyan">{p.title}</Text>
                    </Text>
                ))}
                <Text> </Text>
                <Text>What would you like to do?</Text>
                <Text> </Text>
                <SelectInput
                    items={items}
                    onSelect={(item) => {
                        setKbStrategy(item.value as KnowledgeBaseStrategy);
                        setState("select-mode");
                    }}
                />
            </Box>
        );
    }

    // -------------------------------------------------------------------------
    // select-mode: headed or headless for provisioning
    // -------------------------------------------------------------------------
    if (state === "select-mode") {
        const items = [
            { label: "Headed (watch the browser)", value: "headed" },
            { label: "Headless (run in background)", value: "headless" },
        ];

        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>Provision: {selectedAgent?.config.identity.name ?? selectedAgent?.dirName}</Text>
                <Text> </Text>
                <Text>How should the browser run during agent creation?</Text>
                <Text> </Text>
                <SelectInput
                    items={items}
                    onSelect={(item) => {
                        setHeadless(item.value === "headless");
                        setState("provisioning");
                    }}
                />
            </Box>
        );
    }

    // -------------------------------------------------------------------------
    // provisioning: automate agent creation using saved auth
    // -------------------------------------------------------------------------
    if (state === "provisioning") {
        return (
            <Provision
                studioUrl={studioUrl}
                config={selectedAgent!.config}
                headless={headless}
                confluenceBaseUrl={agentHasKnowledgeBase ? confluenceBaseUrl : undefined}
                confluenceSpaceKey={agentHasKnowledgeBase ? confluenceSpaceKey : undefined}
                knowledgeBaseFiles={agentHasKnowledgeBase ? selectedAgent!.knowledgeBaseFiles : undefined}
                knowledgeBaseStrategy={kbStrategy}
                existingKnowledgeBase={existingKb ?? undefined}
                bundleTelemetryProps={bundleTelemetryProps}
                onProgress={setProgress}
                onSuccess={(result) => {
                    setProgress("");
                    setKnowledgePages(result.knowledgePages);
                    setState("done");
                }}
                onError={(err) => {
                    setError(err);
                    setState("done");
                }}
                progress={progress}
            />
        );
    }

    // -------------------------------------------------------------------------
    // done: show result and return to agent selection
    // -------------------------------------------------------------------------
    return (
        <Box flexDirection="column" marginLeft={2}>
            {error ? (
                <StatusMessage type="error" message={error} />
            ) : (
                <>
                    <StatusMessage
                        type="success"
                        message={`Rovo agent "${selectedAgent?.config.identity.name ?? selectedAgent?.dirName}" provisioned successfully!`}
                    />
                    {knowledgePages.length > 0 && (
                        <>
                            <Text> </Text>
                            <Text bold>Knowledge base pages created in Confluence:</Text>
                            {knowledgePages.map((p) => (
                                <Text key={p.url}>
                                    {" "}
                                    <Text color="cyan">{p.title}</Text> {p.url}
                                </Text>
                            ))}
                        </>
                    )}
                </>
            )}
            <Text> </Text>
            <SelectInput
                items={[
                    { label: "Provision another agent", value: "another" },
                    { label: "\u2190 Back to menu", value: "back" },
                ]}
                onSelect={(item) => {
                    if (item.value === "another") {
                        setError(null);
                        setSelectedAgent(null);
                        setKnowledgePages([]);
                        setExistingKb(null);
                        setKbStrategy(undefined);
                        setState("select-agent");
                    } else {
                        onBack();
                    }
                }}
            />
        </Box>
    );
}

// =============================================================================
// Sub-components that trigger async effects on mount
// =============================================================================

/**
 * Checks for valid auth state and calls the appropriate callback.
 */
function CheckAuth({
    studioUrl,
    bundleTelemetryProps,
    onHasAuth,
    onNeedsAuth,
    onError,
}: {
    studioUrl: string;
    bundleTelemetryProps?: Record<string, TelemetryValue>;
    onHasAuth: () => void;
    onNeedsAuth: () => void;
    onError: (err: string) => void;
}) {
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const provisioner = new RovoProvisioner();
                const { available, reason } = await provisioner.detect();
                if (!available) {
                    if (!cancelled) onError(reason ?? "Playwright not available");
                    return;
                }
                const hasAuth = await provisioner.hasValidAuth();
                if (cancelled) return;
                if (hasAuth) {
                    onHasAuth();
                } else {
                    onNeedsAuth();
                }
            } catch (err) {
                trackTelemetryError("rovo_auth_check_failed", err, bundleTelemetryProps);
                if (!cancelled) onError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [studioUrl]);

    return (
        <Box flexDirection="column" marginLeft={2}>
            <LoadingSpinner message="Checking authentication status..." />
        </Box>
    );
}

/**
 * Launches a headed browser for interactive login, saves auth state on success.
 */
function Authenticate({
    studioUrl,
    bundleTelemetryProps,
    onProgress,
    onSuccess,
    onError,
    progress,
}: {
    studioUrl: string;
    bundleTelemetryProps?: Record<string, TelemetryValue>;
    onProgress: (msg: string) => void;
    onSuccess: () => void;
    onError: (err: string) => void;
    progress: string;
}) {
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const provisioner = createProvisioner(onProgress);
                await provisioner.authenticate(studioUrl);
                if (!cancelled) onSuccess();
            } catch (err) {
                trackTelemetryError("rovo_authenticate_failed", err, bundleTelemetryProps);
                if (!cancelled) onError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [studioUrl]);

    return (
        <Box flexDirection="column" marginLeft={2}>
            <Text bold>Authenticating with Atlassian...</Text>
            <Text> </Text>
            <LoadingSpinner message={progress || "Launching browser..."} />
            <Text> </Text>
            <Text dimColor> A browser window should have opened.</Text>
            <Text dimColor> Please log in — SSO, 2FA, and other methods are supported.</Text>
            <Text dimColor> The window will close automatically once login is detected.</Text>
        </Box>
    );
}

/**
 * Checks if knowledge-base pages already exist in Confluence for the agent.
 */
function CheckKbExists({
    confluenceBaseUrl,
    confluenceSpaceKey,
    agentName,
    bundleTelemetryProps,
    onExists,
    onNotExists,
    onError,
}: {
    confluenceBaseUrl: string;
    confluenceSpaceKey: string;
    agentName: string;
    bundleTelemetryProps?: Record<string, TelemetryValue>;
    onExists: (existing: ExistingKnowledgeBase) => void;
    onNotExists: () => void;
    onError: (err: string) => void;
}) {
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const provisioner = new RovoProvisioner();
                const existing = await provisioner.checkExistingKnowledgeBase({
                    confluenceBaseUrl,
                    confluenceSpaceKey,
                    agentName,
                });
                if (cancelled) return;
                if (existing) {
                    onExists(existing);
                } else {
                    onNotExists();
                }
            } catch (err) {
                trackTelemetryError("rovo_kb_check_failed", err, bundleTelemetryProps);
                if (!cancelled) onError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [confluenceBaseUrl, confluenceSpaceKey, agentName]);

    return (
        <Box flexDirection="column" marginLeft={2}>
            <LoadingSpinner message="Checking for existing knowledge base pages in Confluence..." />
        </Box>
    );
}

/**
 * Runs agent provisioning using saved auth state.
 */
function Provision({
    studioUrl,
    config,
    headless,
    confluenceBaseUrl,
    confluenceSpaceKey,
    knowledgeBaseFiles,
    knowledgeBaseStrategy,
    existingKnowledgeBase,
    bundleTelemetryProps,
    onProgress,
    onSuccess,
    onError,
    progress,
}: {
    studioUrl: string;
    config: import("../bundle/scanner.js").RovoAgentConfig;
    headless: boolean;
    confluenceBaseUrl?: string;
    confluenceSpaceKey?: string;
    knowledgeBaseFiles?: import("../bundle/scanner.js").KnowledgeBaseFile[];
    knowledgeBaseStrategy?: KnowledgeBaseStrategy;
    existingKnowledgeBase?: ExistingKnowledgeBase;
    bundleTelemetryProps?: Record<string, TelemetryValue>;
    onProgress: (msg: string) => void;
    onSuccess: (result: CreateAgentResult) => void;
    onError: (err: string) => void;
    progress: string;
}) {
    useEffect(() => {
        let cancelled = false;
        const hasKnowledgeBase = Boolean(
            confluenceBaseUrl && confluenceSpaceKey && (knowledgeBaseFiles?.length ?? 0) > 0,
        );
        (async () => {
            try {
                trackTelemetryEvent({
                    action: "rovo_provision_started",
                    properties: {
                        ...bundleTelemetryProps,
                        mode: headless ? "headless" : "headed",
                        knowledgeBase: hasKnowledgeBase ? "yes" : "no",
                        knowledgeStrategy: knowledgeBaseStrategy ?? (existingKnowledgeBase ? "overwrite" : "new"),
                    },
                });
                const provisioner = createProvisioner(onProgress);
                const result = await provisioner.createAgent({
                    studioUrl,
                    config,
                    headless,
                    confluenceBaseUrl,
                    confluenceSpaceKey,
                    knowledgeBaseFiles,
                    knowledgeBaseStrategy,
                    existingKnowledgeBase,
                });
                trackTelemetryEvent({
                    action: "rovo_provision_succeeded",
                    properties: {
                        ...bundleTelemetryProps,
                        mode: headless ? "headless" : "headed",
                        knowledgeBase: hasKnowledgeBase ? "yes" : "no",
                        knowledgePages: result.knowledgePages.length,
                    },
                    value: result.knowledgePages.length,
                });
                if (!cancelled) onSuccess(result);
            } catch (err) {
                trackTelemetryError("rovo_provision_failed", err, {
                    ...bundleTelemetryProps,
                    mode: headless ? "headless" : "headed",
                    knowledgeBase: hasKnowledgeBase ? "yes" : "no",
                });
                if (!cancelled) onError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [studioUrl, config, headless]);

    return (
        <Box flexDirection="column" marginLeft={2}>
            <Text bold>Provisioning Rovo Agent...</Text>
            <Text> </Text>
            <LoadingSpinner message={progress || "Starting..."} />
            {!headless && (
                <>
                    <Text> </Text>
                    <Text dimColor> A browser window should have opened. You can watch the automation there.</Text>
                </>
            )}
        </Box>
    );
}

// =============================================================================
// Testing exports
// Exported under a single namespace to keep the public API surface clean.
// =============================================================================

/** @internal — for unit tests only */
export const testing = { CheckAuth, Authenticate, CheckKbExists, Provision };
