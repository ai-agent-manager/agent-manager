import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import type { Project } from "../../../src/api/types.js";

const listProjects = vi.fn();
const getProject = vi.fn();

vi.mock("../../../src/api/index.js", () => ({
    listProjects: (...args: unknown[]) => listProjects(...args),
    getProject: (...args: unknown[]) => getProject(...args),
}));

vi.mock("../../../src/components/Spinner.js", () => ({
    LoadingSpinner: function MockLoadingSpinner({ message }: { message: string }) {
        return <Text>{message}</Text>;
    },
}));

vi.mock("../../../src/components/StatusMessage.js", () => ({
    StatusMessage: function MockStatusMessage({ message }: { message: string }) {
        return <Text>{message}</Text>;
    },
}));

const { ProjectsMenu } = await import("../../../src/components/ProjectsMenu.js");

const testAuthSession = {
    discoveryBaseUrl: "https://discovery.example.com",
    auth: {
        required: true,
        oidcDiscoveryUrl: "https://idp.example.com/.well-known/openid-configuration",
        clientId: "cli",
    },
};

const sampleProjects: Project[] = [
    {
        id: "proj-1",
        teamId: "team-1",
        name: "Alpha",
        description: "First project",
        toolIds: ["claude-code", "cursor"],
        restrictAgents: false,
        restrictSkills: true,
        allowedAgentIds: [],
        allowedSkillIds: ["web-frontend-skill"],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
    },
    {
        id: "proj-2",
        teamId: "team-1",
        name: "Beta",
        toolIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
    },
];

function waitForFrame(
    getFrame: () => string | undefined,
    predicate: (frame: string) => boolean,
    timeoutMs = 2000,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
            const frame = getFrame() ?? "";
            if (predicate(frame)) {
                resolve(frame);
                return;
            }
            if (Date.now() - started > timeoutMs) {
                reject(new Error(`Timed out waiting for frame. Last frame:\n${frame}`));
                return;
            }
            setTimeout(tick, 20);
        };
        tick();
    });
}

async function flushInkInput(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setImmediate(resolve));
}

describe("ProjectsMenu", () => {
    beforeEach(() => {
        listProjects.mockReset();
        getProject.mockReset();
    });

    it("shows a loading message then lists projects", async () => {
        listProjects.mockResolvedValueOnce(sampleProjects);

        const { lastFrame } = render(
            <ProjectsMenu
                apiBaseUrl="https://api.example.com"
                authSession={testAuthSession}
                onBack={vi.fn()}
                onInstallSkills={vi.fn()}
                onProvisionAgents={vi.fn()}
            />,
        );

        expect(lastFrame()).toContain("Loading your projects");

        const frame = await waitForFrame(lastFrame, (f) => f.includes("Alpha"));
        expect(frame).toContain("My Projects");
        expect(frame).toContain("Alpha");
        expect(frame).toContain("Beta");
        expect(listProjects).toHaveBeenCalledWith("https://api.example.com", testAuthSession);
    });

    it("shows an empty state when there are no projects", async () => {
        listProjects.mockResolvedValueOnce([]);

        const { lastFrame } = render(
            <ProjectsMenu
                apiBaseUrl="https://api.example.com"
                authSession={testAuthSession}
                onBack={vi.fn()}
                onInstallSkills={vi.fn()}
                onProvisionAgents={vi.fn()}
            />,
        );

        const frame = await waitForFrame(lastFrame, (f) =>
            f.includes("You do not have access to any projects yet"),
        );
        expect(frame).toContain("My Projects");
    });

    it("shows an error when listing fails", async () => {
        listProjects.mockRejectedValueOnce(new Error("API error 401: Unauthorised"));

        const { lastFrame } = render(
            <ProjectsMenu
                apiBaseUrl="https://api.example.com"
                authSession={testAuthSession}
                onBack={vi.fn()}
                onInstallSkills={vi.fn()}
                onProvisionAgents={vi.fn()}
            />,
        );

        const frame = await waitForFrame(lastFrame, (f) => f.includes("API error 401"));
        expect(frame).toContain("My Projects");
    });

    it("shows project details when a project is selected", async () => {
        listProjects.mockResolvedValueOnce(sampleProjects);
        getProject.mockResolvedValueOnce(sampleProjects[0]);

        const { lastFrame, stdin } = render(
            <ProjectsMenu
                apiBaseUrl="https://api.example.com"
                authSession={testAuthSession}
                onBack={vi.fn()}
                onInstallSkills={vi.fn()}
                onProvisionAgents={vi.fn()}
            />,
        );

        await waitForFrame(lastFrame, (f) => f.includes("Alpha"));
        stdin.write("\r");

        const frame = await waitForFrame(lastFrame, (f) => f.includes("First project"));
        expect(frame).toContain("Alpha");
        expect(frame).toContain("First project");
        expect(frame).not.toContain("Tools");
        expect(frame).not.toContain("Catalogue access");
        expect(getProject).toHaveBeenCalledWith("https://api.example.com", testAuthSession, "proj-1");
    });

    it("offers install actions and invokes the callbacks", async () => {
        listProjects.mockResolvedValueOnce(sampleProjects);
        getProject.mockResolvedValueOnce(sampleProjects[0]);
        const onInstallSkills = vi.fn();
        const onProvisionAgents = vi.fn();

        const { lastFrame, stdin } = render(
            <ProjectsMenu
                apiBaseUrl="https://api.example.com"
                authSession={testAuthSession}
                hasSkills
                hasRovoAgents
                onBack={vi.fn()}
                onInstallSkills={onInstallSkills}
                onProvisionAgents={onProvisionAgents}
            />,
        );

        await waitForFrame(lastFrame, (f) => f.includes("Alpha"));
        stdin.write("\r");

        const detail = await waitForFrame(lastFrame, (f) => f.includes("Install Agent Skills"));
        expect(detail).toContain("Provision Rovo Agents");

        stdin.write("\r");
        await waitForFrame(lastFrame, () => onInstallSkills.mock.calls.length > 0);
        expect(onInstallSkills).toHaveBeenCalledWith(sampleProjects[0]);
        expect(onProvisionAgents).not.toHaveBeenCalled();
    });

    it("falls back to the list payload when detail fetch fails", async () => {
        listProjects.mockResolvedValueOnce(sampleProjects);
        getProject.mockRejectedValueOnce(new Error("API error 500"));

        const { lastFrame, stdin } = render(
            <ProjectsMenu
                apiBaseUrl="https://api.example.com"
                authSession={testAuthSession}
                onBack={vi.fn()}
                onInstallSkills={vi.fn()}
                onProvisionAgents={vi.fn()}
            />,
        );

        await waitForFrame(lastFrame, (f) => f.includes("Alpha"));
        stdin.write("\r");

        const frame = await waitForFrame(lastFrame, (f) => f.includes("Alpha"));
        expect(frame).toContain("Alpha");
        expect(frame).not.toContain("Tools");
    });

    it("omits description when a project has none", async () => {
        listProjects.mockResolvedValueOnce([sampleProjects[1]]);
        getProject.mockResolvedValueOnce(sampleProjects[1]);

        const { lastFrame, stdin } = render(
            <ProjectsMenu
                apiBaseUrl="https://api.example.com"
                authSession={testAuthSession}
                onBack={vi.fn()}
                onInstallSkills={vi.fn()}
                onProvisionAgents={vi.fn()}
            />,
        );

        await waitForFrame(lastFrame, (f) => f.includes("Beta"));
        stdin.write("\r");

        const frame = await waitForFrame(lastFrame, (f) => f.includes("Back to projects"));
        expect(frame).toContain("Beta");
        expect(frame).not.toContain("First project");
    });

    it("calls onBack from the empty state", async () => {
        listProjects.mockResolvedValueOnce([]);
        const onBack = vi.fn();

        const { lastFrame, stdin } = render(
            <ProjectsMenu
                apiBaseUrl="https://api.example.com"
                authSession={testAuthSession}
                onBack={onBack}
                onInstallSkills={vi.fn()}
                onProvisionAgents={vi.fn()}
            />,
        );

        await waitForFrame(lastFrame, (f) =>
            f.includes("You do not have access to any projects yet"),
        );
        stdin.write("\r");

        await waitForFrame(lastFrame, () => onBack.mock.calls.length > 0);
        expect(onBack).toHaveBeenCalled();
    });

    it("resumes into project detail when initialProjectId is set", async () => {
        listProjects.mockResolvedValueOnce(sampleProjects);
        getProject.mockResolvedValueOnce(sampleProjects[0]);

        const { lastFrame } = render(
            <ProjectsMenu
                apiBaseUrl="https://api.example.com"
                authSession={testAuthSession}
                initialProjectId="proj-1"
                onBack={vi.fn()}
                onInstallSkills={vi.fn()}
                onProvisionAgents={vi.fn()}
            />,
        );

        expect(lastFrame()).toContain("Loading project details");

        const frame = await waitForFrame(lastFrame, (f) => f.includes("First project"));
        expect(frame).toContain("Alpha");
        expect(listProjects).toHaveBeenCalled();
        expect(getProject).toHaveBeenCalledWith("https://api.example.com", testAuthSession, "proj-1");
    });

    it("shows an error when a resumed project cannot be found", async () => {
        listProjects.mockResolvedValueOnce([]);
        getProject.mockResolvedValueOnce(null);

        const { lastFrame } = render(
            <ProjectsMenu
                apiBaseUrl="https://api.example.com"
                authSession={testAuthSession}
                initialProjectId="missing"
                onBack={vi.fn()}
                onInstallSkills={vi.fn()}
                onProvisionAgents={vi.fn()}
            />,
        );

        const frame = await waitForFrame(lastFrame, (f) => f.includes("Project not found: missing"));
        expect(frame).toContain("My Projects");
    });

    it("hides install actions when skills and agents are unavailable", async () => {
        listProjects.mockResolvedValueOnce(sampleProjects);
        getProject.mockResolvedValueOnce(sampleProjects[0]);

        const { lastFrame, stdin } = render(
            <ProjectsMenu
                apiBaseUrl="https://api.example.com"
                authSession={testAuthSession}
                onBack={vi.fn()}
                onInstallSkills={vi.fn()}
                onProvisionAgents={vi.fn()}
            />,
        );

        await waitForFrame(lastFrame, (f) => f.includes("Alpha"));
        stdin.write("\r");

        const frame = await waitForFrame(lastFrame, (f) => f.includes("Back to projects"));
        expect(frame).not.toContain("Install Agent Skills");
        expect(frame).not.toContain("Provision Rovo Agents");
    });

    it("invokes onProvisionAgents from the detail menu", async () => {
        listProjects.mockResolvedValueOnce(sampleProjects);
        getProject.mockResolvedValueOnce(sampleProjects[0]);
        const onProvisionAgents = vi.fn();

        const { lastFrame, stdin } = render(
            <ProjectsMenu
                apiBaseUrl="https://api.example.com"
                authSession={testAuthSession}
                hasSkills
                hasRovoAgents
                onBack={vi.fn()}
                onInstallSkills={vi.fn()}
                onProvisionAgents={onProvisionAgents}
            />,
        );

        await waitForFrame(lastFrame, (f) => f.includes("Alpha"));
        stdin.write("\r");
        await waitForFrame(lastFrame, (f) => f.includes("Install Agent Skills"));

        // Move to Provision Rovo Agents (second item) and confirm.
        stdin.write("\u001B[B");
        await flushInkInput();
        stdin.write("\r");
        await flushInkInput();

        await waitForFrame(lastFrame, () => onProvisionAgents.mock.calls.length > 0);
        expect(onProvisionAgents).toHaveBeenCalledWith(sampleProjects[0]);
    });

    it("returns to the project list from detail via Back", async () => {
        listProjects.mockResolvedValueOnce(sampleProjects);
        getProject.mockResolvedValueOnce(sampleProjects[0]);

        const { lastFrame, stdin } = render(
            <ProjectsMenu
                apiBaseUrl="https://api.example.com"
                authSession={testAuthSession}
                onBack={vi.fn()}
                onInstallSkills={vi.fn()}
                onProvisionAgents={vi.fn()}
            />,
        );

        await waitForFrame(lastFrame, (f) => f.includes("Alpha"));
        stdin.write("\r");
        await waitForFrame(lastFrame, (f) => f.includes("Back to projects"));
        stdin.write("\r");

        const frame = await waitForFrame(lastFrame, (f) => f.includes("Select a project"));
        expect(frame).toContain("Alpha");
        expect(frame).toContain("Beta");
    });

    it("returns to the project list from detail via Escape", async () => {
        listProjects.mockResolvedValueOnce(sampleProjects);
        getProject.mockResolvedValueOnce(sampleProjects[0]);

        const { lastFrame, stdin } = render(
            <ProjectsMenu
                apiBaseUrl="https://api.example.com"
                authSession={testAuthSession}
                onBack={vi.fn()}
                onInstallSkills={vi.fn()}
                onProvisionAgents={vi.fn()}
            />,
        );

        await waitForFrame(lastFrame, (f) => f.includes("Alpha"));
        stdin.write("\r");
        await waitForFrame(lastFrame, (f) => f.includes("First project"));
        stdin.write("\u001B");
        await flushInkInput();

        const frame = await waitForFrame(lastFrame, (f) => f.includes("Select a project"));
        expect(frame).toContain("Alpha");
    });

    it("calls onBack from the project list", async () => {
        listProjects.mockResolvedValueOnce(sampleProjects);
        const onBack = vi.fn();

        const { lastFrame, stdin } = render(
            <ProjectsMenu
                apiBaseUrl="https://api.example.com"
                authSession={testAuthSession}
                onBack={onBack}
                onInstallSkills={vi.fn()}
                onProvisionAgents={vi.fn()}
            />,
        );

        await waitForFrame(lastFrame, (f) => f.includes("Alpha"));
        stdin.write("\u001B[B"); // Beta
        await flushInkInput();
        stdin.write("\u001B[B"); // Back
        await flushInkInput();
        stdin.write("\r");
        await flushInkInput();

        await waitForFrame(lastFrame, () => onBack.mock.calls.length > 0);
        expect(onBack).toHaveBeenCalled();
    });

    it("falls back to the list cache when resumed detail fetch fails", async () => {
        listProjects.mockResolvedValueOnce(sampleProjects);
        getProject.mockRejectedValueOnce(new Error("API error 500"));

        const { lastFrame } = render(
            <ProjectsMenu
                apiBaseUrl="https://api.example.com"
                authSession={testAuthSession}
                initialProjectId="proj-1"
                onBack={vi.fn()}
                onInstallSkills={vi.fn()}
                onProvisionAgents={vi.fn()}
            />,
        );

        const frame = await waitForFrame(lastFrame, (f) => f.includes("First project"));
        expect(frame).toContain("Alpha");
        expect(listProjects).toHaveBeenCalledTimes(1);
    });
});
