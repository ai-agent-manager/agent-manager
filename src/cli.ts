import { parseArgs } from "node:util";
import chalk from "chalk";
import { APP_DESCRIPTION, APP_VERSION } from "./app-info.js";

export const BANNER = `
${chalk.cyan(` █████╗  ██████╗ ███████╗███╗   ██╗████████╗`)}
${chalk.cyan(`██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝`)}
${chalk.cyan(`███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║`)}
${chalk.cyan(`██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║`)}
${chalk.cyan(`██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║`)}
${chalk.cyan(`╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝`)}

${chalk.cyan(`███╗   ███╗ █████╗ ███╗   ██╗ █████╗  ██████╗ ███████╗██████╗`)}
${chalk.cyan(`████╗ ████║██╔══██╗████╗  ██║██╔══██╗██╔════╝ ██╔════╝██╔══██╗`)}
${chalk.cyan(`██╔████╔██║███████║██╔██╗ ██║███████║██║  ███╗█████╗  ██████╔╝`)}
${chalk.cyan(`██║╚██╔╝██║██╔══██║██║╚██╗██║██╔══██║██║   ██║██╔══╝  ██╔══██╗`)}
${chalk.cyan(`██║ ╚═╝ ██║██║  ██║██║ ╚████║██║  ██║╚██████╔╝███████╗██║  ██║`)}
${chalk.cyan(`╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝`)}${chalk.cyan(`  v${APP_VERSION}`)}

${chalk.dim("  Your AI agent skills, sorted.")}
`;

export const HELP_TEXT = `  ${chalk.bold("Usage")}
    $ agentman <source>

  ${chalk.bold("Arguments")}
    source      Source to install skills from. Accepted formats:
                GitHub short: owner/repo
                GitHub repo:  https://github.com/org/repo[/tree/<ref>]
                Artefact zip: https://cdn.example.com/my-skill-1.2.0.zip
                Bundle URL:   https://bundles.example.com
                Local dir:    ./path/to/local-bundle

  ${chalk.bold("Options")}
    --update    Force re-download / re-import of the latest bundle
    --config    Path to ai-skills.yml for headless (non-interactive) install
    --version   Show version
    --help      Show this help

  ${chalk.bold("Examples")}
    $ agentman https://skills.example.com
    $ agentman https://skills.example.com --update
    $ agentman ./my-agents
    $ agentman /absolute/path/to/agents --update
    $ agentman my-org/my-skills-repo
    $ agentman https://github.com/org/my-skills-repo --config ai-skills.yml
    $ agentman https://github.com/org/my-skills-repo/tree/v2.0 --config ai-skills.yml
    $ agentman https://bundles.example.com --config ai-skills.yml
    $ agentman ./my-local-bundle`;

function printHelp(): void {
    const description = APP_DESCRIPTION ? `\n  ${APP_DESCRIPTION}\n` : "";
    console.log(`${description}\n${HELP_TEXT}\n`);
}

export function parseCli(argv: string[] = process.argv.slice(2)) {
    // Unknown flags are ignored rather than fatal.
    const { values, positionals } = parseArgs({
        args: argv,
        strict: false,
        allowPositionals: true,
        allowNegative: true,
        options: {
            update: { type: "boolean", default: false },
            config: { type: "string", short: "c" },
            help: { type: "boolean" },
            version: { type: "boolean" },
        },
    });

    if (values.version === true) {
        console.log(APP_VERSION);
        process.exit(0);
    }
    if (values.help === true) {
        printHelp();
        process.exit(0);
    }

    return {
        source: positionals[0],
        forceUpdate: values.update === true,
        configPath: typeof values.config === "string" && values.config ? values.config : undefined,
        showHelp: printHelp,
    };
}
