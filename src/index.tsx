#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { parseCli, BANNER } from "./cli.js";
import { App } from "./app.js";
import { resolveSource } from "./bundle/source.js";
// SHIM: git source detection — to be superseded by discovery mechanism (PR #16, PR #14)
import { isGitSource } from "./discovery/git-source-shim.js";
import {
    getBundleEndpointTelemetryValue,
    getBundleSourceTelemetryProperties,
    trackTelemetryError,
    trackTelemetryEvent,
} from "./telemetry.js";

const { source: sourceInput, forceUpdate, configPath, sourceType, showHelp } = parseCli();

if (!sourceInput) {
    console.log(BANNER);
    console.log("  Error: Please provide a source (URL or directory path).\n");
    showHelp();
    process.exit(1);
}

console.log(BANNER);

try {
    const source = await resolveSource(sourceInput, sourceType);
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
    // SHIM: git source telemetry fallback — to be superseded by discovery mechanism (PR #16, PR #14)
    const sourceTelemetry = isGitSource(sourceInput, sourceType)
        ? { source: "git", bundleEndpoint: "git-repo" }
        : /^https?:\/\//i.test(sourceInput)
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
