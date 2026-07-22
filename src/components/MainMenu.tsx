import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";

export type MainMenuAction =
    | "my-projects"
    | "search-install"
    | "maintenance"
    | "source-management"
    | "settings"
    | "exit";

interface MainMenuProps {
    hasBundleContents: boolean;
    /** Show My Projects when authenticated, api.features.projects is enabled, and an API base URL is available. */
    hasProjectsAccess?: boolean;
    onSelect: (action: MainMenuAction) => void;
}

export function MainMenu({ hasBundleContents, hasProjectsAccess = false, onSelect }: MainMenuProps) {
    const items = [
        ...(hasProjectsAccess
            ? [
                  {
                      label: "My Projects                 View projects you have access to",
                      value: "my-projects" as MainMenuAction,
                  },
              ]
            : []),
        ...(hasBundleContents
            ? [
                  {
                      label: "Search & Install            Search skills & agents, then install or provision",
                      value: "search-install" as MainMenuAction,
                  },
              ]
            : []),
        {
            label: "Maintenance & Updates       Update, sync, manage versions and installed items",
            value: "maintenance" as MainMenuAction,
        },
        {
            label: "Manage Sources              Configure sources (Git repo, HTTP, local archive)",
            value: "source-management" as MainMenuAction,
        },
        {
            label: "Settings & Config           Startup update checks, telemetry",
            value: "settings" as MainMenuAction,
        },
        {
            label: "Exit                        See you next time!",
            value: "exit" as MainMenuAction,
        },
    ];

    return (
        <Box flexDirection="column" marginLeft={2}>
            <Text bold>What would you like to do?</Text>
            <Text> </Text>
            <SelectInput items={items} onSelect={(item) => onSelect(item.value)} />
        </Box>
    );
}
