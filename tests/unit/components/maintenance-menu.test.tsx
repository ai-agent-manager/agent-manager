import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { MaintenanceMenu } from "../../../src/components/MaintenanceMenu.js";

const ESC = String.fromCharCode(27);

async function flushInkInput(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

type Stdin = { write: (input: string) => void };

async function press(stdin: Stdin, input: string): Promise<void> {
    stdin.write(input);
    await flushInkInput();
}

describe("MaintenanceMenu", () => {
    const noop = vi.fn();

    describe("conditional items", () => {
        it('shows "Bulk Sync by Tool" and "Manage Skill Versions" when hasBundleContents is true', () => {
            const { lastFrame } = render(<MaintenanceMenu hasBundleContents={true} onSelect={noop} onBack={noop} />);
            expect(lastFrame()).toContain("Bulk Sync by Tool");
            expect(lastFrame()).toContain("Manage Skill Versions");
        });

        it('hides them when hasBundleContents is false', () => {
            const { lastFrame } = render(<MaintenanceMenu hasBundleContents={false} onSelect={noop} onBack={noop} />);
            expect(lastFrame()).not.toContain("Bulk Sync by Tool");
            expect(lastFrame()).not.toContain("Manage Skill Versions");
        });
    });

    describe("permanent items", () => {
        it("always shows the manage/update items and Back", () => {
            const { lastFrame } = render(<MaintenanceMenu hasBundleContents={false} onSelect={noop} onBack={noop} />);
            expect(lastFrame()).toContain("Manage Installed Skills");
            expect(lastFrame()).toContain("Manage Bundle Versions");
            expect(lastFrame()).toContain("Update Agent Manager App");
            expect(lastFrame()).toContain("← Back");
        });
    });

    it("calls onBack when Escape is pressed", async () => {
        const onBack = vi.fn();
        const { lastFrame, stdin } = render(
            <MaintenanceMenu hasBundleContents={true} onSelect={noop} onBack={onBack} />,
        );
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Maintenance & updates");
        });
        await flushInkInput();

        await press(stdin, ESC);
        await vi.waitFor(() => {
            expect(onBack).toHaveBeenCalled();
        });
    });
});
