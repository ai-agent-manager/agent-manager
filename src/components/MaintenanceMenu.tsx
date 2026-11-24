import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { useEscapeBack } from "../lib/use-escape-back.js";

export type MaintenanceAction =
    | "bulk-sync"
    | "skill-versions"
    | "manage-installed"
    | "bundle-versions"
    | "update-app"
    | "back";

interface MaintenanceMenuProps {
    hasBundleContents: boolean;
    hasSource: boolean;
    onSelect: (action: MaintenanceAction) => void;
    onBack: () => void;
}

export function MaintenanceMenu({ hasBundleContents, hasSource, onSelect, onBack }: MaintenanceMenuProps) {
    useEscapeBack(onBack);

    const items = [
        ...(hasBundleContents
            ? [
                  {
                      label: "Bulk Sync by Tool           Pick a tool, then select skills to sync",
                      value: "bulk-sync" as MaintenanceAction,
                  },
                  {
                      label: "Manage Skill Versions       Change individual skill versions",
                      value: "skill-versions" as MaintenanceAction,
                  },
              ]
            : []),
        {
            label: "Manage Installed Skills     Update, remove, or inspect installed skills",
            value: "manage-installed" as MaintenanceAction,
        },
        ...(hasSource
            ? [
                  {
                      label: "Manage Bundle Versions      View bundle versions, update or downgrade",
                      value: "bundle-versions" as MaintenanceAction,
                  },
              ]
            : []),
        {
            label: "Update Agent Manager App    Update this CLI application to the latest version",
            value: "update-app" as MaintenanceAction,
        },
        {
            label: "← Back",
            value: "back" as MaintenanceAction,
        },
    ];

    return (
        <Box flexDirection="column" marginLeft={2}>
            <Text bold>Maintenance & updates</Text>
            <Text> </Text>
            <SelectInput
                items={items}
                onSelect={(item) => {
                    if (item.value === "back") onBack();
                    else onSelect(item.value);
                }}
            />
        </Box>
    );
}
