import React from "react";
import { Box, Text, useInput } from "ink";
import type { StartupUpdateNotice } from "../lib/startup-update-checks.js";

interface StartupNoticePanelProps {
    notices: StartupUpdateNotice[];
    enabled: boolean;
    onOpenAppUpdate: () => void;
    onCheckBundleUpdates: () => void;
}

export function StartupNoticePanel({
    notices,
    enabled,
    onOpenAppUpdate,
    onCheckBundleUpdates,
}: StartupNoticePanelProps) {
    useInput((input) => {
        if (!enabled) {
            return;
        }

        const lowered = input.toLowerCase();

        if (lowered === "u" && notices.some((notice) => notice.kind === "app")) {
            onOpenAppUpdate();
            return;
        }

        if (lowered === "b" && notices.some((notice) => notice.kind === "bundle")) {
            onCheckBundleUpdates();
        }
    });

    if (notices.length === 0) {
        return null;
    }

    return (
        <Box
            marginTop={1}
            marginBottom={1}
            marginLeft={2}
            marginRight={2}
            borderStyle="round"
            borderColor="cyan"
            paddingX={1}
            flexDirection="column"
        >
            <Text bold color="cyan">
                Updates Available
            </Text>
            <Text dimColor> Quick actions are available directly from the main menu.</Text>
            <Text> </Text>
            {notices.map((notice) => (
                <Box key={`${notice.kind}-${notice.message}`} flexDirection="column" marginBottom={1}>
                    <Text>{notice.message}</Text>
                    <Text
                        dimColor
                    >{` Press ${notice.shortcutKey.toUpperCase()} to ${notice.actionLabel.toLowerCase()}.`}</Text>
                </Box>
            ))}
        </Box>
    );
}
