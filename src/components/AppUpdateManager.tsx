import React, { useMemo, useState } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { APP_VERSION } from "../app-info.js";
import { createSelfUpdatePlan, runSelfUpdate } from "../lib/self-update.js";
import { trackTelemetryError, trackTelemetryEvent } from "../telemetry.js";
import { LoadingSpinner } from "./Spinner.js";
import { StatusMessage } from "./StatusMessage.js";
import { useEscapeBack } from "../lib/use-escape-back.js";

interface AppUpdateManagerProps {
    onBack: () => void;
    onExit: (message: string) => void;
}

type MessageType = "success" | "error";

export function AppUpdateManager({ onBack, onExit }: AppUpdateManagerProps) {
    const plan = useMemo(() => createSelfUpdatePlan(), []);
    const [isUpdating, setIsUpdating] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [messageType, setMessageType] = useState<MessageType>("success");

    useEscapeBack(onBack, !isUpdating);

    if (isUpdating) {
        return <LoadingSpinner message="Updating Agent Manager application..." />;
    }

    return (
        <Box flexDirection="column" marginLeft={2}>
            <Text bold>Update Agent Manager application</Text>
            <Text dimColor> This updates the Agent Manager CLI itself.</Text>
            <Text dimColor> It does not change cached bundles, installed skills, or Rovo agent definitions.</Text>
            <Text dimColor>{` Current version: v${APP_VERSION}`}</Text>
            <Text dimColor>{` Update command: ${plan.command}`}</Text>
            <Text dimColor> This performs a global npm install for the CLI package.</Text>
            {plan.channelLabel === "latest beta release" && (
                <Text dimColor> Beta updates require GitHub Packages authentication in your npm configuration.</Text>
            )}
            <Text> </Text>

            {message && <StatusMessage type={messageType} message={message} />}
            {message && <Text> </Text>}

            <SelectInput
                items={[
                    {
                        label: `Update Agent Manager app to ${plan.channelLabel}`,
                        value: "update",
                    },
                    { label: "← Back", value: "back" },
                ]}
                onSelect={(item) => {
                    if (item.value === "back") {
                        onBack();
                        return;
                    }

                    setIsUpdating(true);
                    trackTelemetryEvent({
                        action: "app_self_update_started",
                        properties: {
                            channel: plan.channelLabel,
                            currentVersion: APP_VERSION,
                        },
                    });

                    (async () => {
                        try {
                            await runSelfUpdate(plan);
                            trackTelemetryEvent({
                                action: "app_self_update_completed",
                                properties: {
                                    channel: plan.channelLabel,
                                    currentVersion: APP_VERSION,
                                },
                            });
                            onExit("Agent Manager updated. Restart agentman to use the new application version.");
                        } catch (error) {
                            trackTelemetryError("app_self_update_failed", error, {
                                channel: plan.channelLabel,
                                currentVersion: APP_VERSION,
                            });
                            setMessageType("error");
                            setMessage(error instanceof Error ? error.message : String(error));
                        } finally {
                            setIsUpdating(false);
                        }
                    })();
                }}
            />
        </Box>
    );
}
