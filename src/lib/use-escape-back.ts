import { useInput } from "ink";

/**
 * Registers Escape as "go back one level" so the key behaves the same on every
 * screen. `SelectInput`-based screens don't handle Escape themselves, so this
 * hook is what makes Esc uniform alongside any on-screen "← Back" item.
 *
 * `isActive` gates the handler for components that render their own sub-screens
 * from a single mount: without it the parent's handler stays live underneath the
 * sub-screen, so one Escape unwinds two levels (or fires twice alongside the
 * sub-screen's own handler).
 */
export function useEscapeBack(onBack: () => void, isActive = true): void {
    useInput(
        (_input, key) => {
            if (key.escape) {
                onBack();
            }
        },
        { isActive },
    );
}
