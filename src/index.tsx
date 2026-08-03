#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { parseCli, BANNER } from "./cli.js";
import { App } from "./app.js";
import { resolveSource, resolvePersistedSource, type BundleSource } from "./bundle/source.js";
import { addSource, classifyStoredSource } from "./bundle/cache.js";
import { startConsoleSpinner } from "./lib/console-spinner.js";
import {
    getBundleEndpointTelemetryValue,
    getBundleSourceTelemetryProperties,
    trackTelemetryError,
    trackTelemetryEvent,
} from "./telemetry.js";

const { source: sourceInput, forceUpdate, configPath, showHelp } = parseCli();

console.log(BANNER);

// Headless mode is strict: it requires an explicit source argument and never
// falls back to persisted sources, so a CI run stays reproducible regardless of
// the config saved on the machine.
if (configPath) {
    if (!sourceInput) {
        console.log("  Error: --config requires a source argument.\n");
        showHelp();
        process.exit(1);
    }

    try {
        const source = await resolveSource(sourceInput);
        trackTelemetryEvent({
            action: "agentman_started",
            properties: { forceUpdate, ...getBundleSourceTelemetryProperties(source) },
        });
        const { runHeadless } = await import("./headless.js");
        await runHeadless(sourceInput, configPath, forceUpdate);
        process.exit(0);
    } catch (err) {
        trackTelemetryError("agentman_start_failed", err, telemetryForInput(sourceInput));
        console.log(`  Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
    }
}

const spinner = startConsoleSpinner("Resolving source...");

try {
    let source: BundleSource | undefined;

    if (sourceInput) {
        // One-liner: resolve exactly as before, then persist the source so a
        // later bare `agentman` invocation reaches the same place.
        source = await resolveSource(sourceInput);
        await addSource(classifyStoredSource(sourceInput), { setActive: true });
    } else {
        const resolved = await resolvePersistedSource();
        // No persisted source is not fatal: the TUI still opens so the user can
        // reach Source Management and add one, instead of hitting a dead end.
        source = resolved?.source;
    }

    spinner.stop();
    if (source) {
        trackTelemetryEvent({
            action: "agentman_started",
            properties: { forceUpdate, ...getBundleSourceTelemetryProperties(source) },
        });
    }

    render(<App source={source} forceUpdate={forceUpdate} />);
} catch (err) {
    spinner.stop();
    trackTelemetryError("bundle_source_resolve_failed", err, telemetryForInput(sourceInput));
    trackTelemetryError("agentman_start_failed", err, telemetryForInput(sourceInput));
    console.log(`  Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
}

function telemetryForInput(input: string | undefined): { source: string; bundleEndpoint: string } {
    if (input && /^https?:\/\//i.test(input)) {
        return { source: "url", bundleEndpoint: getBundleEndpointTelemetryValue(input) };
    }
    if (input) {
        return { source: "directory", bundleEndpoint: "local-directory" };
    }
    return { source: "persisted", bundleEndpoint: "persisted-source" };
}
