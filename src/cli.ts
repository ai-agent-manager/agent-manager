import meow from "meow";
import chalk from "chalk";
import { APP_VERSION } from "./app-info.js";

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

export function parseCli(argv = process.argv.slice(2)) {
    const cli = meow(
        `
  ${chalk.bold("Usage")}
    $ agentman <source>
    $ agentman ui [source] [--port 19877] [--no-open]

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

  ${chalk.bold("Web UI")}
    ui          Launch the local web UI in your browser
    --port      Listen on this port (0 selects an available port)
    --no-open   Print the URL without opening a browser

  ${chalk.bold("Examples")}
    $ agentman https://skills.example.com
    $ agentman https://skills.example.com --update
    $ agentman ./my-agents
    $ agentman /absolute/path/to/agents --update
    $ agentman my-org/my-skills-repo
    $ agentman https://github.com/org/my-skills-repo --config ai-skills.yml
    $ agentman https://github.com/org/my-skills-repo/tree/v2.0 --config ai-skills.yml
    $ agentman https://bundles.example.com --config ai-skills.yml
    $ agentman ./my-local-bundle
`,
        {
            importMeta: import.meta,
            argv,
            flags: {
                update: {
                    type: "boolean",
                    default: false,
                },
                config: {
                    type: "string",
                    shortFlag: "c",
                },
                port: { type: "number", default: 19877 },
                open: { type: "boolean", default: true },
            },
        },
    );

    if (argv.includes('--help')) cli.showHelp(0);

    const command = cli.input[0] === 'ui' ? 'ui' : 'tui';
    const source = cli.input[command === 'ui' ? 1 : 0];
    const portExplicit = argv.some((arg) => arg === '--port' || arg.startsWith('--port='));
    if (command === 'ui' && cli.flags.config !== undefined) throw new Error('ui cannot be combined with --config. Use agentman <source> --config <file> for headless installation.');
    if (command === 'ui' && cli.input.length > 2) throw new Error('ui accepts at most one source.');
    if (!Number.isInteger(cli.flags.port) || cli.flags.port < 0 || cli.flags.port > 65535) throw new Error('--port must be an integer between 0 and 65535.');
    if (command !== 'ui' && (portExplicit || argv.includes('--no-open') || argv.includes('--open'))) throw new Error('--port and --no-open require the ui command.');

    return {
        command,
        source,
        port: cli.flags.port,
        portExplicit,
        open: cli.flags.open,
        forceUpdate: cli.flags.update,
        configPath: cli.flags.config,
        showHelp: () => cli.showHelp(),
    };
}
