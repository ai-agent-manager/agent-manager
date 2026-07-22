import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { listProjects, getProject, type Project } from "../api/index.js";
import { LoadingSpinner } from "./Spinner.js";
import { StatusMessage } from "./StatusMessage.js";

interface ProjectsMenuProps {
    apiBaseUrl: string;
    bearerToken: string;
    /** Whether the resolved catalogue has skills to install. */
    hasSkills?: boolean;
    /** Whether the resolved catalogue has Rovo agents to provision. */
    hasRovoAgents?: boolean;
    /** Re-open this project's detail view (e.g. after returning from install). */
    initialProjectId?: string | null;
    onBack: () => void;
    onInstallSkills: (project: Project) => void;
    onProvisionAgents: (project: Project) => void;
}

type View =
    | { kind: "loading-list" }
    | { kind: "list"; projects: Project[] }
    | { kind: "loading-detail"; projectId: string; projects: Project[] }
    | { kind: "detail"; project: Project; projects: Project[] }
    | { kind: "error"; message: string; projects?: Project[] };

/**
 * My Projects — list projects the authenticated user can access, then show
 * details and project-scoped install / provision actions.
 */
export function ProjectsMenu({
    apiBaseUrl,
    bearerToken,
    hasSkills = false,
    hasRovoAgents = false,
    initialProjectId = null,
    onBack,
    onInstallSkills,
    onProvisionAgents,
}: ProjectsMenuProps) {
    const [view, setView] = useState<View>(() =>
        initialProjectId
            ? { kind: "loading-detail", projectId: initialProjectId, projects: [] }
            : { kind: "loading-list" },
    );

    useEffect(() => {
        if (view.kind !== "loading-list") return;

        let cancelled = false;

        (async () => {
            try {
                const projects = await listProjects(apiBaseUrl, bearerToken);
                if (!cancelled) {
                    setView({ kind: "list", projects });
                }
            } catch (err) {
                if (!cancelled) {
                    setView({
                        kind: "error",
                        message: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [view.kind, apiBaseUrl, bearerToken]);

    useEffect(() => {
        if (view.kind !== "loading-detail") return;

        let cancelled = false;
        const { projectId, projects } = view;
        const cached = projects.find((p) => p.id === projectId);

        (async () => {
            let list = projects;
            let listCached = cached;

            try {
                // When resuming into detail with an empty list, refresh the list first.
                if (projects.length === 0) {
                    list = await listProjects(apiBaseUrl, bearerToken);
                }
                listCached = list.find((p) => p.id === projectId) ?? cached;

                const fresh = await getProject(apiBaseUrl, bearerToken, projectId);
                if (cancelled) return;

                const project = fresh ?? listCached;
                if (!project) {
                    setView({
                        kind: "error",
                        message: `Project not found: ${projectId}`,
                        projects: list,
                    });
                    return;
                }
                setView({ kind: "detail", project, projects: list });
            } catch (err) {
                if (cancelled) return;
                if (listCached) {
                    setView({ kind: "detail", project: listCached, projects: list });
                    return;
                }
                try {
                    list = await listProjects(apiBaseUrl, bearerToken);
                    listCached = list.find((p) => p.id === projectId);
                    if (listCached) {
                        if (!cancelled) {
                            setView({ kind: "detail", project: listCached, projects: list });
                        }
                        return;
                    }
                    if (!cancelled) {
                        setView({
                            kind: "error",
                            message: err instanceof Error ? err.message : String(err),
                            projects: list,
                        });
                    }
                } catch (listErr) {
                    if (!cancelled) {
                        setView({
                            kind: "error",
                            message:
                                listErr instanceof Error ? listErr.message : String(listErr),
                        });
                    }
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [view, apiBaseUrl, bearerToken]);

    const goBackFromDetail = useCallback(() => {
        if (view.kind === "detail") {
            setView({ kind: "list", projects: view.projects });
        } else if (view.kind === "error" && view.projects) {
            setView({ kind: "list", projects: view.projects });
        } else {
            onBack();
        }
    }, [view, onBack]);

    useInput(
        (_input, key) => {
            if (key.escape) {
                goBackFromDetail();
            }
        },
        { isActive: view.kind === "detail" || view.kind === "error" },
    );

    if (view.kind === "loading-list" || view.kind === "loading-detail") {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <LoadingSpinner
                    message={
                        view.kind === "loading-list"
                            ? "Loading your projects..."
                            : "Loading project details..."
                    }
                />
            </Box>
        );
    }

    if (view.kind === "error") {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>My Projects</Text>
                <Text> </Text>
                <StatusMessage type="error" message={view.message} />
                <Text> </Text>
                <SelectInput
                    items={[{ label: "← Back", value: "__back__" }]}
                    onSelect={goBackFromDetail}
                />
            </Box>
        );
    }

    if (view.kind === "detail") {
        const { project } = view;

        const detailItems = [
            ...(hasSkills
                ? [
                      {
                          label: "Install Agent Skills        Set up skills for this project",
                          value: "install-skills" as const,
                      },
                  ]
                : []),
            ...(hasRovoAgents
                ? [
                      {
                          label: "Provision Rovo Agents       Create agents for this project",
                          value: "provision-agents" as const,
                      },
                  ]
                : []),
            { label: "← Back to projects", value: "__back__" as const },
        ];

        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>{project.name}</Text>
                <Text> </Text>
                {project.description ? <Text>{project.description}</Text> : null}
                {project.description ? <Text> </Text> : null}
                <SelectInput
                    items={detailItems}
                    onSelect={(item) => {
                        if (item.value === "__back__") {
                            setView({ kind: "list", projects: view.projects });
                            return;
                        }
                        if (item.value === "install-skills") {
                            onInstallSkills(project);
                            return;
                        }
                        if (item.value === "provision-agents") {
                            onProvisionAgents(project);
                        }
                    }}
                />
            </Box>
        );
    }

    const { projects } = view;

    if (projects.length === 0) {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <Text bold>My Projects</Text>
                <Text> </Text>
                <Text dimColor>You do not have access to any projects yet.</Text>
                <Text> </Text>
                <SelectInput
                    items={[{ label: "← Back", value: "__back__" }]}
                    onSelect={onBack}
                />
            </Box>
        );
    }

    const items = [
        ...projects.map((project) => ({
            label: `${project.name.padEnd(28)}${project.description ?? ""}`.slice(0, 80),
            value: project.id,
        })),
        { label: "← Back", value: "__back__" },
    ];

    return (
        <Box flexDirection="column" marginLeft={2}>
            <Text bold>My Projects</Text>
            <Text dimColor>Select a project to view details</Text>
            <Text> </Text>
            <SelectInput
                items={items}
                onSelect={(item) => {
                    if (item.value === "__back__") {
                        onBack();
                        return;
                    }
                    setView({ kind: "loading-detail", projectId: item.value, projects });
                }}
            />
        </Box>
    );
}
