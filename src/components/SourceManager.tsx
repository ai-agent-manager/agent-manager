import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { LoadingSpinner } from "./Spinner.js";
import { UrlInstallFlow } from "./UrlInstallFlow.js";
import { useEscapeBack } from "../lib/use-escape-back.js";
import {
    readConfig,
    addSource,
    removeSource,
    setActiveSource,
    classifyStoredSource,
    type StoredSource,
} from "../bundle/cache.js";

interface SourceManagerProps {
    onBack: () => void;
}

type Screen = "menu" | "add" | "remove" | "url-install";

function sourceLabel(source: StoredSource, active: boolean): string {
    return `${active ? "●" : " "} ${source.kind.padEnd(9)} ${source.value}`;
}

export function SourceManager({ onBack }: SourceManagerProps) {
    const [screen, setScreen] = useState<Screen>("menu");
    const [loaded, setLoaded] = useState(false);
    const [sources, setSources] = useState<StoredSource[]>([]);
    const [active, setActive] = useState<StoredSource | null>(null);
    const [addValue, setAddValue] = useState("");
    const [note, setNote] = useState<string | null>(null);

    // Escape unwinds exactly one level: from the sources menu it leaves the
    // screen, from a sub-screen it returns to the sources menu. Both handlers
    // are registered unconditionally and gated by `isActive`, so hook order
    // stays stable. `url-install` is excluded — UrlInstallFlow owns Escape
    // while it is mounted.
    useEscapeBack(onBack, screen === "menu");
    useEscapeBack(() => setScreen("menu"), screen === "add" || screen === "remove");

    const reload = async () => {
        const config = await readConfig();
        setSources(config.sources ?? []);
        setActive(config.activeSource ?? null);
        setLoaded(true);
    };

    useEffect(() => {
        void reload();
    }, []);

    if (!loaded) {
        return <LoadingSpinner message="Loading sources..." />;
    }

    if (screen === "url-install") {
        return <UrlInstallFlow onBack={() => setScreen("menu")} />;
    }

    if (screen === "add") {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>Add a source</Text>
                <Text> </Text>
                <Box>
                    <Text>{"  "}URL or local path: </Text>
                    <TextInput
                        value={addValue}
                        onChange={setAddValue}
                        onSubmit={(val) => {
                            const trimmed = val.trim();
                            if (!trimmed) return;
                            void (async () => {
                                await addSource(classifyStoredSource(trimmed), { setActive: true });
                                setAddValue("");
                                setNote(`Added ${trimmed} and set it active. Restart agentman to load it.`);
                                await reload();
                                setScreen("menu");
                            })();
                        }}
                        placeholder="https://bootstrap.example.com or ./my-agents"
                    />
                </Box>
                <Text dimColor>{"  "}GitHub repositories and discovery URLs are detected automatically; paths are stored as local directories. Esc to cancel.</Text>
            </Box>
        );
    }

    if (screen === "remove") {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>Remove a source</Text>
                <Text> </Text>
                <SelectInput
                    limit={12}
                    items={[
                        ...sources.map((s, i) => ({ key: `${s.kind}:${s.value}`, label: sourceLabel(s, false), value: i })),
                        { key: "back", label: "← Back", value: -1 },
                    ]}
                    onSelect={(item) => {
                        if (item.value === -1) {
                            setScreen("menu");
                            return;
                        }
                        void (async () => {
                            await removeSource(sources[item.value]!);
                            await reload();
                            setScreen("menu");
                        })();
                    }}
                />
            </Box>
        );
    }

    const items = [
        ...sources.map((s, i) => ({
            key: `${s.kind}:${s.value}`,
            label: sourceLabel(s, active !== null && s.kind === active.kind && s.value === active.value),
            value: `select:${i}`,
        })),
        // Divider between the sources list and the actions, so the two groups
        // read as distinct sections. Selecting it is a no-op.
        ...(sources.length > 0 ? [{ key: "__sep__", label: "──────────────", value: "__sep__" }] : []),
        { key: "add", label: "Add a source (URL or local path)", value: "add" },
        ...(sources.length > 0 ? [{ key: "remove", label: "Remove a source", value: "remove" }] : []),
        { key: "url-install", label: "Install a skill from a URL", value: "url-install" },
        { key: "back", label: "← Back", value: "back" },
    ];

    return (
        <Box flexDirection="column" marginLeft={2}>
            <Text bold>Source management</Text>
            <Text> </Text>
            {sources.length === 0 && <Text dimColor>{"  "}No sources saved yet. Add one below.</Text>}
            {note && <Text color="green">{"  "}{note}</Text>}
            <SelectInput
                limit={12}
                items={items}
                onSelect={(item) => {
                    if (item.value === "__sep__") {
                        return;
                    }
                    if (item.value === "add") {
                        setNote(null);
                        setScreen("add");
                    } else if (item.value === "remove") {
                        setScreen("remove");
                    } else if (item.value === "url-install") {
                        setScreen("url-install");
                    } else if (item.value === "back") {
                        onBack();
                    } else if (item.value.startsWith("select:")) {
                        const index = Number(item.value.slice("select:".length));
                        void (async () => {
                            await setActiveSource(sources[index]!);
                            setNote(`Active source set to ${sources[index]!.value}. Restart agentman to load it.`);
                            await reload();
                        })();
                    }
                }}
            />
            <Text> </Text>
            <Text dimColor>{"  "}● marks the active source · Enter selects · Esc back</Text>
        </Box>
    );
}
