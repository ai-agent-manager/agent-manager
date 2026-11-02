import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { LoadingSpinner } from "./Spinner.js";
import { getSettings, updateSettings } from "../operations/settings.js";
import { useEscapeBack } from "../lib/use-escape-back.js";

interface SettingsScreenProps {
    onBack: () => void;
}

export function SettingsScreen({ onBack }: SettingsScreenProps) {
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [startupDisabled, setStartupDisabled] = useState(false);
    const [telemetryDisabled, setTelemetryDisabled] = useState(false);

    useEscapeBack(onBack);

    useEffect(() => {
        (async () => {
            const config = await getSettings();
            setStartupDisabled(config.startupUpdateChecksDisabled ?? false);
            setTelemetryDisabled(config.telemetryDisabled ?? false);
            setLoaded(true);
        })().catch((error) => { setError(error instanceof Error ? error.message : String(error)); setLoaded(true); });
    }, []);

    const toggle = async (setting: 'startup' | 'telemetry') => {
        if (saving) return;
        setSaving(true);
        setError(null);
        try {
            const updated = await updateSettings(setting === 'startup'
                ? { startupUpdateChecksDisabled: !startupDisabled }
                : { telemetryDisabled: !telemetryDisabled });
            setStartupDisabled(updated.startupUpdateChecksDisabled);
            setTelemetryDisabled(updated.telemetryDisabled);
        } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
        } finally { setSaving(false); }
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
            {error && <Text color="red">{error}</Text>}
            {saving && <Text dimColor>Saving...</Text>}
            <Text> </Text>
            <Text dimColor>{"  "}Enter toggles a setting · Esc back</Text>
            <Text> </Text>
            <SelectInput
                items={items}
                onSelect={(item) => {
                    if (item.value === "startup") void toggle("startup");
                    else if (item.value === "telemetry") void toggle("telemetry");
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
