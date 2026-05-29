import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { MainMenu } from "../../../src/components/MainMenu.js";

describe("MainMenu", () => {
    const noop = vi.fn();

    describe("conditional items", () => {
        it('shows "Install Agent Skills" when hasBundleContents is true', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={true} hasRovoAgents={false} onSelect={noop} />);
            expect(lastFrame()).toContain("Install Agent Skills");
        });

        it('hides "Install Agent Skills" when hasBundleContents is false', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={false} hasRovoAgents={false} onSelect={noop} />);
            expect(lastFrame()).not.toContain("Install Agent Skills");
        });

        it('shows "Manage Skill Versions" when hasBundleContents is true', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={true} hasRovoAgents={false} onSelect={noop} />);
            expect(lastFrame()).toContain("Manage Skill Versions");
        });

        it('hides "Manage Skill Versions" when hasBundleContents is false', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={false} hasRovoAgents={false} onSelect={noop} />);
            expect(lastFrame()).not.toContain("Manage Skill Versions");
        });

        it('shows "Provision Rovo Agents" when hasRovoAgents is true', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={false} hasRovoAgents={true} onSelect={noop} />);
            expect(lastFrame()).toContain("Provision Rovo Agents");
        });

        it('hides "Provision Rovo Agents" when hasRovoAgents is false', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={false} hasRovoAgents={false} onSelect={noop} />);
            expect(lastFrame()).not.toContain("Provision Rovo Agents");
        });
    });

    describe("permanent items", () => {
        it('always shows "Manage Bundle Versions"', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={false} hasRovoAgents={false} onSelect={noop} />);
            expect(lastFrame()).toContain("Manage Bundle Versions");
        });

        it('always shows "Update Agent Manager App"', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={false} hasRovoAgents={false} onSelect={noop} />);
            expect(lastFrame()).toContain("Update Agent Manager App");
        });

        it('always shows "Exit"', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={false} hasRovoAgents={false} onSelect={noop} />);
            expect(lastFrame()).toContain("Exit");
        });
    });
});
