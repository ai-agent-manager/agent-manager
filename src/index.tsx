#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { parseCli, BANNER } from "./cli.js";
import { App } from "./app.js";
import type { BundleSource } from "./bundle/source.js";
import { resolveSkillSource } from "./bundle/skill-source.js";
import {
    getSkillSourceTelemetryProperties,
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

try {
    const source = await resolveSkillSource(sourceInput);
    trackTelemetryEvent({
        action: "agentman_started",
        properties: {
            forceUpdate,
            ...getSkillSourceTelemetryProperties(source),
        },
    });

    if (configPath) {
        const { runHeadless } = await import('./headless.js');
        await runHeadless(sourceInput, configPath, forceUpdate);
        process.exit(0);
    }

    // Repo and artefact sources require headless mode (TUI support is a future enhancement)
    if (source.type === 'repo') {
        console.log('  Repository sources require headless mode. Use the --config flag:');
        console.log(`    agentman ${sourceInput} --config ai-skills.yml\n`);
        process.exit(1);
    }

    if (source.type === 'artefact') {
        console.log('  Artefact sources are not yet supported in interactive mode.\n');
        process.exit(1);
    }

    // Bundle source — bridge to the legacy BundleSource type that the TUI expects
    const bundleSource: BundleSource = source.baseUrl
        ? { type: 'url', baseUrl: source.baseUrl }
        : { type: 'directory', dirPath: source.dirPath! };

    render(<App source={bundleSource} forceUpdate={forceUpdate} />);
} catch (err) {
    const sourceTelemetry = /^https?:\/\//i.test(sourceInput)
        ? { source: "url" }
        : { source: "directory" };
    trackTelemetryError("agentman_start_failed", err, sourceTelemetry);
    console.log(`  Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
}
