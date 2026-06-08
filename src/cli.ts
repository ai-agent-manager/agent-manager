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

export function parseCli() {
    const cli = meow(
        `
  ${chalk.bold("Usage")}
    $ agentman <source>

  ${chalk.bold("Arguments")}
    source      URL of the agent bundle server, or path to a local
                bundle directory.
                URL:       index.json is fetched from <url>/agents/index.json
                           and the latest versioned zip is downloaded.
                Directory: contents are copied into the local cache.
                           manifest.json is used if present; otherwise a
                           dev version is generated.

  ${chalk.bold("Options")}
    --update    Force re-download / re-import of the latest bundle
    --config    Path to ai-skills.yml for headless (non-interactive) install
    --type, -t  Source type hint: "git" or "http" (auto-detected if omitted)
    --version   Show version
    --help      Show this help

  ${chalk.bold("Examples")}
    $ agentman https://bootstrap.example.com
    $ agentman https://bootstrap.example.com --update
    $ agentman ./my-agents
    $ agentman /absolute/path/to/agents --update
    $ agentman https://github.com/org/skills-repo.git
    $ agentman file:///tmp/test-plugin --type=git
`,
        {
            importMeta: import.meta,
            flags: {
                update: {
                    type: "boolean",
                    default: false,
                },
                config: {
                    type: "string",
                    shortFlag: "c",
                },
                type: {
                    type: "string",
                    shortFlag: "t",
                },
            },
        },
    );

    const source = cli.input[0];

    return {
        source,
        forceUpdate: cli.flags.update,
        configPath: cli.flags.config,
        sourceType: cli.flags.type,
        showHelp: () => cli.showHelp(),
    };
}
