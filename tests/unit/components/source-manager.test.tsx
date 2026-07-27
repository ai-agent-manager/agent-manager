import React from "react";
import { Text } from "ink";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import type { StoredSource } from "../../../src/bundle/cache.js";

const ESC = String.fromCharCode(27);
const ENTER = "\r";

const configState: { sources: StoredSource[]; activeSource?: StoredSource } = { sources: [] };

vi.mock("../../../src/bundle/cache.js", () => ({
    readConfig: vi.fn(async () => ({ installations: {}, ...configState })),
    addSource: vi.fn(async () => {}),
    removeSource: vi.fn(async () => {}),
    setActiveSource: vi.fn(async () => {}),
    classifyStoredSource: (input: string): StoredSource =>
        /^https?:\/\//i.test(input) ? { kind: "discovery", value: input } : { kind: "directory", value: input },
}));

vi.mock("../../../src/components/UrlInstallFlow.js", () => ({
    UrlInstallFlow: ({ onBack: _onBack }: { onBack: () => void }) => <Text>URL install flow</Text>,
}));

const { SourceManager } = await import("../../../src/components/SourceManager.js");
const { addSource, setActiveSource } = await import("../../../src/bundle/cache.js");

async function flushInkInput(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

type Stdin = { write: (input: string) => void };

async function press(stdin: Stdin, input: string): Promise<void> {
    stdin.write(input);
    await flushInkInput();
}

beforeEach(() => {
    vi.clearAllMocks();
    configState.sources = [];
    configState.activeSource = undefined;
});

describe("SourceManager", () => {
    it("lists persisted sources and marks the active one", async () => {
        configState.sources = [
            { kind: "discovery", value: "https://a.example.com" },
            { kind: "directory", value: "./b" },
        ];
        configState.activeSource = { kind: "discovery", value: "https://a.example.com" };

        const { lastFrame } = render(<SourceManager onBack={() => {}} />);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Source management");
        });
        const frame = lastFrame()!;
        expect(frame).toContain("https://a.example.com");
        expect(frame).toContain("./b");
        expect(frame).toContain("●");
    });

    it("shows an empty-state hint when no sources are saved", async () => {
        const { lastFrame } = render(<SourceManager onBack={() => {}} />);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("No sources saved yet");
        });
    });

    it("sets a source active when selected", async () => {
        configState.sources = [{ kind: "discovery", value: "https://a.example.com" }];

        const { lastFrame, stdin } = render(<SourceManager onBack={() => {}} />);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("https://a.example.com");
        });
        await flushInkInput();

        await press(stdin, ENTER);
        await vi.waitFor(() => {
            expect(setActiveSource).toHaveBeenCalledWith({ kind: "discovery", value: "https://a.example.com" });
        });
    });

    it("adds a typed source, classifying a URL as discovery", async () => {
        const { lastFrame, stdin } = render(<SourceManager onBack={() => {}} />);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("＋ Add a source");
        });
        await flushInkInput();

        // First item is "Add a source" when the list is empty.
        await press(stdin, ENTER);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Add a source");
        });

        await press(stdin, "https://new.example.com");
        await press(stdin, ENTER);

        await vi.waitFor(() => {
            expect(addSource).toHaveBeenCalledWith(
                { kind: "discovery", value: "https://new.example.com" },
                { setActive: true },
            );
        });
    });

    it("goes back on Escape", async () => {
        const onBack = vi.fn();
        const { lastFrame, stdin } = render(<SourceManager onBack={onBack} />);
        await vi.waitFor(() => {
            expect(lastFrame()).toContain("Source management");
        });
        await flushInkInput();

        await press(stdin, ESC);
        await vi.waitFor(() => {
            expect(onBack).toHaveBeenCalled();
        });
    });
});
