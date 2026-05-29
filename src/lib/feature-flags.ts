/**
 * Feature flags controlled by environment variables.
 *
 * Set AGENTMAN_CHROME_EXTENSION=1 to enable the Chrome Extension provisioning
 * option under "Provision Rovo Agents" in the interactive menu.
 */
export const featureFlags = {
    chromeExtension: process.env.AGENTMAN_CHROME_EXTENSION === "1",
};
