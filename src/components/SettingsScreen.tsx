import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { LoadingSpinner } from "./Spinner.js";
import { readConfig, updateConfig } from "../bundle/cache.js";
import { setTelemetryDisabledByConfig } from "../telemetry.js";
import { useEscapeBack } from "../lib/use-escape-back.js";

interface SettingsScreenProps {
    onBack: () => void;
}

export function SettingsScreen({ onBack }: SettingsScreenProps) {
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
            label: `Telemetry               ${telemetryDisabled ? "disabled" : "enabled"}`,
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
            <Text> </Text>
            <Text dimColor>
                {"  "}Environment variables (e.g. DISABLE_TELEMETRY,
                AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS) still take precedence.
            </Text>
        </Box>
    );
}
