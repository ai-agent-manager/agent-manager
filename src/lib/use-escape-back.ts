import { useInput } from "ink";

/**
 * Registers Escape as "go back one level" so the key behaves the same on every
 * screen. `SelectInput`-based screens don't handle Escape themselves, so this
 * hook is what makes Esc uniform alongside any on-screen "← Back" item.
 */
export function useEscapeBack(onBack: () => void): void {
    useInput((_input, key) => {
        if (key.escape) {
            onBack();
        }
    });
}
