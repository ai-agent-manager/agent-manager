import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { LoadingSpinner } from "./Spinner.js";
import { readConfig, updateConfig } from "../bundle/cache.js";
import { resolveTelemetryMode, setTelemetryDisabledByConfig, type TelemetryMode } from "../telemetry.js";
import type { DiscoveryTelemetry } from "../discovery/types.js";
import { useEscapeBack } from "../lib/use-escape-back.js";

const TELEMETRY_MODE_LABELS: Record<TelemetryMode, string> = {
    enabled: "enabled",
    disabled: "disabled",
    "not-configured": "not configured",
};

interface SettingsScreenProps {
    onBack: () => void;
    /**
     * Telemetry block of the active source's discovery document — undefined
     * when the active source has no discovery file or it does not explicitly
     * enable telemetry. The reported telemetry mode must respect this (issue
     * #95), so an active source without telemetry shows as off, not enabled.
     */
    discoveryTelemetry?: DiscoveryTelemetry;
}

export function SettingsScreen({ onBack, discoveryTelemetry }: SettingsScreenProps) {
    const [loaded, setLoaded] = useState(false);
    const [startupDisabled, setStartupDisabled] = useState(false);
    const [telemetryDisabled, setTelemetryDisabled] = useState(false);

    useEscapeBack(onBack);

    useEffect(() => {
        (async () => {
            const config = await readConfig();
            setStartupDisabled(config.startupUpdateChecksDisabled ?? false);
            setTelemetryDisabled(config.telemetryDisabled ?? false);
            setLoaded(true);
        })();
    }, []);

    const toggleStartup = async () => {
        const next = !startupDisabled;
        setStartupDisabled(next);
        await updateConfig((config) => {
            config.startupUpdateChecksDisabled = next;
        });
    };

    const toggleTelemetry = async () => {
        const next = !telemetryDisabled;
        setTelemetryDisabled(next);
        setTelemetryDisabledByConfig(next);
        await updateConfig((config) => {
            config.telemetryDisabled = next;
        });
    };

    // Effective mode for the active source: what event sending would actually
    // do right now (endpoint from the discovery file or env vars, env opt-outs,
    // CI/non-interactive suppression, and the persisted config opt-out).
    const telemetryMode: TelemetryMode = useMemo(
        () =>
            resolveTelemetryMode(
                discoveryTelemetry,
                process.env,
                { stdinIsTTY: process.stdin.isTTY, stdoutIsTTY: process.stdout.isTTY },
                telemetryDisabled,
            ),
        [discoveryTelemetry, telemetryDisabled],
    );

    if (!loaded) {
        return <LoadingSpinner message="Loading settings..." />;
    }

    const items = [
        {
            key: "startup",
            label: `Startup update checks   ${startupDisabled ? "disabled" : "enabled"}`,
            value: "startup",
        },
        {
            key: "telemetry",
            label: `Telemetry               ${TELEMETRY_MODE_LABELS[telemetryMode]}`,
            value: "telemetry",
        },
        { key: "back", label: "← Back", value: "back" },
    ];

    return (
        <Box flexDirection="column" marginLeft={2}>
            <Text bold>Settings &amp; config</Text>
            <Text> </Text>
            <Text dimColor>{"  "}Enter toggles a setting · Esc back</Text>
            <Text> </Text>
            <SelectInput
                items={items}
                onSelect={(item) => {
                    if (item.value === "startup") void toggleStartup();
                    else if (item.value === "telemetry") void toggleTelemetry();
                    else onBack();
                }}
            />
        </Box>
    );
}
