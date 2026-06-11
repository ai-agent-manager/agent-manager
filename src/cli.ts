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
    source      Source to install skills from. Accepted formats:
                GitHub repo:  https://github.com/org/repo[/tree/<ref>]
                Artefact zip: https://cdn.example.com/my-skill-1.2.0.zip
                Bundle URL:   https://bundles.example.com
                Local dir:    ./path/to/local-bundle

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
    $ agentman https://github.com/org/my-skills-repo --config ai-skills.yml
    $ agentman https://github.com/org/my-skills-repo/tree/v2.0 --config ai-skills.yml
    $ agentman https://cdn.example.com/my-skill-1.2.0.zip --config ai-skills.yml
    $ agentman https://bundles.example.com --config ai-skills.yml
    $ agentman https://bundles.example.com --update
    $ agentman ./my-local-bundle
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
