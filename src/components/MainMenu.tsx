import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";

export type MainMenuAction =
    | "browse-skills"
    | "url-install"
    | "install-skills"
    | "manage-installed"
    | "manage-skill-versions"
    | "rovo-agents"
    | "manage-versions"
    | "update-app"
    | "exit";

interface MainMenuProps {
    hasBundleContents: boolean;
    hasRovoAgents: boolean;
    onSelect: (action: MainMenuAction) => void;
}

export function MainMenu({ hasBundleContents, hasRovoAgents, onSelect }: MainMenuProps) {
    const items = [
        ...(hasBundleContents
            ? [
                  {
                      label: "Browse & Install Skills     Search skills, inspect sources, install",
                      value: "browse-skills" as MainMenuAction,
                  },
                  {
                      label: "Bulk Install by Tool        Pick a tool, then select skills to sync",
                      value: "install-skills" as MainMenuAction,
                  },
                  {
                      label: "Manage Skill Versions       Change individual skill versions",
                      value: "manage-skill-versions" as MainMenuAction,
                  },
              ]
            : []),
        {
            label: "Install from URL            GitHub repo, artefact zip, or bundle URL",
            value: "url-install" as MainMenuAction,
        },
        {
            label: "Manage Installed Skills     Update, remove, or inspect installed skills",
            value: "manage-installed" as MainMenuAction,
        },
        ...(hasRovoAgents
            ? [
                  {
                      label: "Provision Rovo Agents       Create agents in Atlassian Studio",
                      value: "rovo-agents" as MainMenuAction,
                  },
              ]
            : []),
        {
            label: "Manage Bundle Versions      View installed bundle versions, update or downgrade",
            value: "manage-versions" as MainMenuAction,
        },
        {
            label: "Update Agent Manager App    Update this CLI application to the latest version",
            value: "update-app" as MainMenuAction,
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
