import { useStdout } from "ink";

/**
 * Rows reserved for everything that is not a list item — headers, search line,
 * scroll indicators, footer hints. Screens with more chrome pass their own.
 */
const DEFAULT_CHROME_ROWS = 10;
const MIN_VISIBLE = 3;

export interface ListViewport {
    /** First visible item index (inclusive). */
    start: number;
    /** Last visible item index (exclusive) — use with Array.slice. */
    end: number;
    hiddenAbove: number;
    hiddenBelow: number;
}

/**
 * Compute the slice of a list that fits on screen, keeping `cursor` in view.
 *
 * Ink redraws a frame by clearing the previous one, but it can only clear what
 * is still inside the terminal viewport. A list taller than the terminal
 * scrolls, and the part that scrolled off can no longer be cleared — so every
 * re-render leaves remnants of the previous frame behind. Windowing the list to
 * the terminal height keeps each frame clearable.
 */
export function useListViewport(
    itemCount: number,
    cursor: number,
    chromeRows: number = DEFAULT_CHROME_ROWS,
): ListViewport {
    const { stdout } = useStdout();
    const visibleCount = Math.max(MIN_VISIBLE, (stdout?.rows ?? 24) - chromeRows);
    const maxStart = Math.max(0, itemCount - visibleCount);
    // Centre the cursor once the list scrolls, clamped at both ends so the
    // first and last screens stay full.
    const start = Math.min(maxStart, Math.max(0, cursor - Math.floor(visibleCount / 2)));
    const end = start + visibleCount;

    return {
        start,
        end,
        hiddenAbove: start,
        hiddenBelow: Math.max(0, itemCount - end),
    };
}
