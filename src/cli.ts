import meow from "meow";
import { styleText } from "node:util";
import { APP_VERSION } from "./app-info.js";

export const BANNER = `
${styleText("cyan", ` █████╗  ██████╗ ███████╗███╗   ██╗████████╗`)}
${styleText("cyan", `██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝`)}
${styleText("cyan", `███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║`)}
${styleText("cyan", `██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║`)}
${styleText("cyan", `██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║`)}
${styleText("cyan", `╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝`)}

${styleText("cyan", `███╗   ███╗ █████╗ ███╗   ██╗ █████╗  ██████╗ ███████╗██████╗`)}
${styleText("cyan", `████╗ ████║██╔══██╗████╗  ██║██╔══██╗██╔════╝ ██╔════╝██╔══██╗`)}
${styleText("cyan", `██╔████╔██║███████║██╔██╗ ██║███████║██║  ███╗█████╗  ██████╔╝`)}
${styleText("cyan", `██║╚██╔╝██║██╔══██║██║╚██╗██║██╔══██║██║   ██║██╔══╝  ██╔══██╗`)}
${styleText("cyan", `██║ ╚═╝ ██║██║  ██║██║ ╚████║██║  ██║╚██████╔╝███████╗██║  ██║`)}
${styleText("cyan", `╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝`)}${styleText("cyan", `  v${APP_VERSION}`)}

${styleText("dim", "  Your AI agent skills, sorted.")}
`;

export function parseCli() {
    const cli = meow(
        `
  ${styleText("bold", "Usage")}
    $ agentman <source>

  ${styleText("bold", "Arguments")}
    source      Source to install skills from. Accepted formats:
                GitHub short: owner/repo
                GitHub repo:  https://github.com/org/repo[/tree/<ref>]
                Artefact zip: https://cdn.example.com/my-skill-1.2.0.zip
                Bundle URL:   https://bundles.example.com
                Local dir:    ./path/to/local-bundle

  ${styleText("bold", "Options")}
    --update    Force re-download / re-import of the latest bundle
    --config    Path to ai-skills.yml for headless (non-interactive) install
    --version   Show version
    --help      Show this help

  ${styleText("bold", "Examples")}
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
            flags: {
                update: {
                    type: "boolean",
                    default: false,
                },
                config: {
                    type: "string",
                    shortFlag: "c",
                },
            },
        },
    );

    const source = cli.input[0];

    return {
        source,
        forceUpdate: cli.flags.update,
        configPath: cli.flags.config,
        showHelp: () => cli.showHelp(),
    };
}
