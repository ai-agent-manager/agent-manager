import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startConsoleSpinner } from "../../../src/lib/console-spinner.js";

describe("startConsoleSpinner", () => {
    let writeSpy: ReturnType<typeof vi.spyOn>;
    let originalIsTTY: boolean | undefined;

    beforeEach(() => {
        originalIsTTY = process.stdout.isTTY;
        Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
        writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        vi.useFakeTimers();
    });

    afterEach(() => {
        Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("writes the initial frame immediately on start", () => {
        const spinner = startConsoleSpinner("Loading...");
        expect(writeSpy).toHaveBeenCalledTimes(1);
        const firstWrite = writeSpy.mock.calls[0][0] as string;
        expect(firstWrite).toContain("Loading...");
        expect(firstWrite).toMatch(/\r/);
        spinner.stop();
    });

    it("advances frames on each timer tick", () => {
        const spinner = startConsoleSpinner("Testing...");
        writeSpy.mockClear();

        vi.advanceTimersByTime(80);
        expect(writeSpy).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(80);
        expect(writeSpy).toHaveBeenCalledTimes(2);

        spinner.stop();
    });

    it("stop clears the line and stops ticking", () => {
        const spinner = startConsoleSpinner("Loading...");
        writeSpy.mockClear();
        spinner.stop();

        const stopWrite = writeSpy.mock.calls[writeSpy.mock.calls.length - 1][0] as string;
        // The clear sequence: \r + spaces + \r
        expect(stopWrite).toMatch(/^\r\s*\r$/);

        writeSpy.mockClear();
        vi.advanceTimersByTime(160);
        expect(writeSpy).not.toHaveBeenCalled();
    });

    it("stop is idempotent", () => {
        const spinner = startConsoleSpinner("Loading...");
        spinner.stop();
        const callCount = writeSpy.mock.calls.length;
        spinner.stop();
        expect(writeSpy).toHaveBeenCalledTimes(callCount);
    });

    it("update changes the displayed message", () => {
        const spinner = startConsoleSpinner("Initial...");
        writeSpy.mockClear();
        spinner.update("Updated!");
        const lastWrite = writeSpy.mock.calls[writeSpy.mock.calls.length - 1][0] as string;
        expect(lastWrite).toContain("Updated!");
        spinner.stop();
    });

    it("update after stop is a no-op", () => {
        const spinner = startConsoleSpinner("Loading...");
        spinner.stop();
        const callCount = writeSpy.mock.calls.length;
        spinner.update("Should not appear");
        expect(writeSpy).toHaveBeenCalledTimes(callCount);
    });

    describe("non-TTY mode", () => {
        beforeEach(() => {
            Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
            writeSpy.mockRestore();
        });

        it("uses console.log instead of stdout.write", () => {
            const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
            const spinner = startConsoleSpinner("Loading...");
            expect(logSpy).toHaveBeenCalledTimes(1);
            expect(logSpy.mock.calls[0][0]).toContain("Loading...");
            spinner.stop();
            logSpy.mockRestore();
        });

        it("update and stop are no-ops in non-TTY mode", () => {
            const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
            const writeMock = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
            const spinner = startConsoleSpinner("Loading...");
            logSpy.mockClear();
            writeMock.mockClear();
            spinner.update("New message");
            spinner.stop();
            expect(logSpy).not.toHaveBeenCalled();
            expect(writeMock).not.toHaveBeenCalled();
            logSpy.mockRestore();
            writeMock.mockRestore();
        });
    });
});
