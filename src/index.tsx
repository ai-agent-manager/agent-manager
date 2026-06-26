#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { parseCli, BANNER } from "./cli.js";
import { App } from "./app.js";
import { resolveSource } from "./bundle/source.js";
import { startConsoleSpinner } from "./lib/console-spinner.js";
import {
    getBundleEndpointTelemetryValue,
    getBundleSourceTelemetryProperties,
    trackTelemetryError,
    trackTelemetryEvent,
} from "./telemetry.js";

const { source: sourceInput, forceUpdate, configPath, showHelp } = parseCli();

if (!sourceInput) {
    console.log(BANNER);
    console.log("  Error: Please provide a source (URL or directory path).\n");
    showHelp();
    process.exit(1);
}

console.log(BANNER);

const spinner = startConsoleSpinner("Resolving source...");

try {
    const source = await resolveSource(sourceInput);
    spinner.stop();
    trackTelemetryEvent({
        action: "agentman_started",
        properties: {
            forceUpdate,
            ...getBundleSourceTelemetryProperties(source),
        },
    });

    if (configPath) {
        const { runHeadless } = await import('./headless.js');
        await runHeadless(sourceInput, configPath, forceUpdate);
        process.exit(0);
    }

    render(<App source={source} forceUpdate={forceUpdate} />);
} catch (err) {
    spinner.stop();
    const sourceTelemetry = /^https?:\/\//i.test(sourceInput)
        ? {
              source: "url",
              bundleEndpoint: getBundleEndpointTelemetryValue(sourceInput),
          }
        : {
              source: "directory",
              bundleEndpoint: "local-directory",
          };
    trackTelemetryError("bundle_source_resolve_failed", err, sourceTelemetry);
    trackTelemetryError("agentman_start_failed", err, sourceTelemetry);
    console.log(`  Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
}
