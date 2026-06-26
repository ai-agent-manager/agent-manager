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

export interface CliResult {
    source: string | undefined;
    forceUpdate: boolean;
    configPath: string | undefined;
    sourceType: string | undefined;
    showHelp: () => void;
    command: "bundle" | "contribute";
    skillDir: string | undefined;
}

export function parseCli(): CliResult {
    const cli = meow(
        `
  ${chalk.bold("Usage")}
    $ agentman <source>
    $ agentman contribute <skill-dir>

  ${chalk.bold("Commands")}
    <source>      URL of the agent bundle server, or path to a local
                  bundle directory. (default)
    contribute    Submit a skill to a git repository

  ${chalk.bold("Arguments")}
    source        URL of the agent bundle server, or path to a local
                  bundle directory.
                  URL:       index.json is fetched from <url>/agents/index.json
                              and the latest versioned zip is downloaded.
                  Directory: contents are copied into the local cache.
                              manifest.json is used if present; otherwise a
                              dev version is generated.
    skill-dir     Path to the skill directory containing SKILL.md with valid frontmatter

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
    $ agentman contribute ./my-skill https://github.com/org/skills-repo.git
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

    const firstArg = cli.input[0];
    const isContribute = firstArg === "contribute";

    if (isContribute) {
        return {
            command: "contribute",
            skillDir: cli.input[1],
            source: undefined,
            forceUpdate: false,
            configPath: undefined,
            sourceType: undefined,
            showHelp: () => cli.showHelp(),
        };
    }

    const source = cli.input[0];

    return {
        command: "bundle",
        source,
        forceUpdate: cli.flags.update,
        configPath: cli.flags.config,
        sourceType: cli.flags.type,
        skillDir: undefined,
        showHelp: () => cli.showHelp(),
    };
}
