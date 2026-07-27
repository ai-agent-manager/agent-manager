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
    });

    describe("permanent items", () => {
        it('always shows "Maintenance & Updates"', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={false} onSelect={noop} />);
            expect(lastFrame()).toContain("Maintenance & Updates");
        });

        it('always shows "Source Management"', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={false} onSelect={noop} />);
            expect(lastFrame()).toContain("Source Management");
        });

        it('always shows "Exit"', () => {
            const { lastFrame } = render(<MainMenu hasBundleContents={false} onSelect={noop} />);
            expect(lastFrame()).toContain("Exit");
        });
    });
});
