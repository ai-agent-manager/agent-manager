import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { MainMenu } from "../../../src/components/MainMenu.js";

describe("MainMenu", () => {
    const noop = vi.fn();

    describe("conditional items", () => {
        it('shows "Search & Install" when hasBundleContents is true', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={true} onSelect={noop} />);
            expect(lastFrame()).toContain("Search & Install");
        });

        it('hides "Search & Install" when hasBundleContents is false', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={false} onSelect={noop} />);
            expect(lastFrame()).not.toContain("Search & Install");
        });

        it('shows "My Projects" when hasProjectsAccess is true', () => {
            const { lastFrame } = render(
                <MainMenu hasBundleContents={false} hasProjectsAccess={true} onSelect={noop} />,
            );
            expect(lastFrame()).toContain("My Projects");
        });

        it('hides "My Projects" when hasProjectsAccess is false', () => {
            const { lastFrame } = render(
                <MainMenu hasBundleContents={false} hasProjectsAccess={false} onSelect={noop} />,
            );
            expect(lastFrame()).not.toContain("My Projects");
        });

        it('hides "My Projects" by default', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={false} onSelect={noop} />);
            expect(lastFrame()).not.toContain("My Projects");
        });
    });

    describe("permanent items", () => {
        it('always shows "Maintenance & Updates"', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={false} onSelect={noop} />);
            expect(lastFrame()).toContain("Maintenance & Updates");
        });

        it('always shows "Manage Sources"', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={false} onSelect={noop} />);
            expect(lastFrame()).toContain("Manage Sources");
        });

        it('always shows "Exit"', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={false} onSelect={noop} />);
            expect(lastFrame()).toContain("Exit");
        });
    });
});
