# Agentman Chrome Extension - User Guide

Complete guide for installing and using the Agentman Chrome Extension to provision Atlassian Rovo agents.

---

## Table of Contents

- [What is Agentman?](#what-is-agentman)
- [Before You Start](#before-you-start)
- [Installation](#installation)
- [Getting Started](#getting-started)
- [Provisioning Your First Agent](#provisioning-your-first-agent)
- [Understanding Agent Components](#understanding-agent-components)
- [Common Questions](#common-questions)
- [Troubleshooting](#troubleshooting)
- [Getting Help](#getting-help)

---

## What is Agentman?

Agentman is a Chrome Extension that makes it easy to create and configure AI agents in Atlassian Rovo Studio. Instead of manually filling out forms and configuring settings, Agentman automates the entire process.

**What Agentman does for you:**
- ✅ Automatically fills in agent names and descriptions
- ✅ Adds complete instruction sets with proper formatting
- ✅ Creates and configures subagents (specialized helpers)
- ✅ Sets up triggers for when subagents should activate
- ✅ Enables all the right settings
- ✅ Saves you hours of manual configuration

**How it works:**
1. You define your agent configuration in a simple file
2. The Agentman Chrome Extension reads that configuration
3. It automates the creation process in Atlassian Rovo Studio
4. Your agent is ready to use in minutes

---

## Before You Start

### What You'll Need

**1. Chrome or Edge Browser**
- Google Chrome (version 88 or later)
- OR Microsoft Edge (version 88 or later)

**2. Atlassian Rovo Studio Access**
- Active Atlassian account
- Access to https://studio.atlassian.com
- Permissions to create agents in your workspace

**3. Node.js Installed**
- Node.js version 22 or higher
- Check your version: Open Terminal (Mac/Linux) or Command Prompt (Windows) and type:
  ```bash
  node --version
  ```
  You should see something like `v22.0.0` or higher

**Don't have Node.js?**
Download it from [nodejs.org](https://nodejs.org/) and install the LTS (Long Term Support) version.

**4. Agent Configuration Files**
- At least one agent configuration (YAML file)
- These are typically provided by your team or organization
- If you're creating your own, see the [Creating Agent Configurations](#creating-agent-configurations) section

---

## Installation

### Step 1: Install Agent Manager

The Chrome Extension works with the Agent Manager CLI (Command Line Interface). Install it first:

**Open your Terminal (Mac/Linux) or Command Prompt (Windows) and run:**

```bash
npx -y @ai-agent-manager/cli@latest https://your-bundle-server-url
```

> **Note:** Replace `https://your-bundle-server-url` with the URL provided by your team or organization. For example: `https://bootstrap.example.com`

> **Important:** Chrome Extension menu options are hidden unless the feature flag is enabled.
>
> **macOS/Linux:**
> ```bash
> AGENTMAN_CHROME_EXTENSION=1 npx -y @ai-agent-manager/cli@latest https://your-bundle-server-url
> ```
>
> **Windows PowerShell:**
> ```powershell
> $env:AGENTMAN_CHROME_EXTENSION="1"; npx -y @ai-agent-manager/cli@latest https://your-bundle-server-url
> ```

**What this does:**
- Downloads and installs the latest Agent Manager
- Connects to your organization's agent bundle server
- Opens an interactive menu

### Step 2: Install the Chrome Extension

From the Agent Manager menu that just opened:

1. **Use arrow keys** to navigate to **"Install Chrome Extension"**
2. **Press Enter** to select it
3. **Wait** for the installation to complete (takes about 5 seconds)

**You'll see a message like this:**

**On macOS/Linux:**
```
✓ Chrome extension installed successfully!

Next steps:
1. Restart Chrome/Edge
2. Approve the extension installation prompt
```

**On Windows:**
```
✓ Extension files copied successfully!

To complete installation:
1. Open Registry Editor (regedit)
2. Navigate to: HKEY_LOCAL_MACHINE\SOFTWARE\Google\Chrome\Extensions
3. Create a key named: jfplibfgoojmkffdcglchjdkpliiljbh
4. Add these string values:
   - path: C:\Users\YourName\.agentman\chrome-extension\agentman.crx
   - version: 0.1.1
5. Restart Chrome
```

### Step 3: Complete Installation

**For macOS/Linux users:**

1. **Quit Chrome/Edge completely** (not just close windows):
   - Mac: Press `Cmd + Q` while Chrome/Edge is active
   - Linux: Right-click Chrome/Edge icon and select "Quit"

2. **Restart Chrome/Edge**

3. **Look for the installation prompt** at the top of the browser:
   ```
   "Agentman - Rovo Agent Provisioner" has been added to Chrome
   [Add extension]  [Remove]
   ```

4. **Click "Add extension"**

5. **Verify installation:**
   - Look for the robot icon (🤖) in your browser toolbar
   - Click it - you should see the Agentman popup

**For Windows users:**

Follow the printed instructions to add the registry keys, then:

1. **Quit Chrome/Edge completely**
2. **Restart Chrome/Edge**
3. **Follow steps 3-5 from macOS/Linux instructions above**

**Installation complete!** The robot icon (🤖) should now appear in your browser toolbar.

---

## Getting Started

Now that the extension is installed, let's connect it to your agent configurations.

### Step 1: Start the Agent Manager Server

The Chrome Extension needs a running server to fetch your agent configurations.

**In your Terminal/Command Prompt, run:**

**macOS/Linux:**
```bash
AGENTMAN_CHROME_EXTENSION=1 npx -y @ai-agent-manager/cli@latest https://your-bundle-server-url
```

**Windows PowerShell:**
```powershell
$env:AGENTMAN_CHROME_EXTENSION="1"; npx -y @ai-agent-manager/cli@latest https://your-bundle-server-url
```

> **Remember:** Use the same URL you used during installation

**From the menu, select:**

1. **"Provision Rovo Agents"** (press Enter)
2. **"Chrome Extension"** (press Enter)

**You'll see output like this:**

```
Starting server for Chrome Extension provisioning...

✓ Server running on http://127.0.0.1:19876
✓ Auth token: 00000000-0000-0000-0000-000000000000

The server is ready to accept connections from the Chrome Extension.

Available agents:
  • Epic Elaboration Agent
  • Code Review Agent
  • Meeting Notes Agent

Click the extension icon (🤖) in your browser and paste the auth token to connect.

Press Ctrl+C to stop the server.
```

**Important:**
- **Keep this terminal window open** - closing it stops the server
- **Copy the auth token** (the long string after "Auth token:") - you'll need it in the next step

### Step 2: Connect the Extension

Now let's connect the Chrome Extension to the server you just started.

1. **Click the robot icon (🤖)** in your browser toolbar

2. **You'll see the Agentman popup:**
   ```
   ┌─────────────────────────────────┐
   │  Agentman - Rovo Provisioner    │
   ├─────────────────────────────────┤
   │                                 │
   │  Auth Token:                    │
   │  [________________________]     │
   │                                 │
   │         [Connect]               │
   │                                 │
   └─────────────────────────────────┘
   ```

3. **Paste the auth token** you copied from the terminal:
   - Click in the "Auth Token" field
   - Paste (Ctrl+V / Cmd+V)

4. **Click "Connect"**

5. **Wait a moment** - the extension fetches your available agents

6. **Success!** You should now see a list of available agents:
   ```
   ┌─────────────────────────────────┐
   │  Agentman - Rovo Provisioner    │
   ├─────────────────────────────────┤
   │  Connected ✓                    │
   │                                 │
   │  Available Agents:              │
   │                                 │
   │  Epic Elaboration Agent         │
   │  [Provision]                    │
   │                                 │
   │  Code Review Agent              │
   │  [Provision]                    │
   │                                 │
   │  Meeting Notes Agent            │
   │  [Provision]                    │
   │                                 │
   └─────────────────────────────────┘
   ```

**You're now ready to provision agents!**

---

## Provisioning Your First Agent

Let's create your first Rovo agent using Agentman. This process takes about 2-3 minutes.

### Step 1: Open Atlassian Rovo Studio

1. **Open a new browser tab**

2. **Navigate to:** https://studio.atlassian.com

3. **Sign in** with your Atlassian account (if not already signed in)

4. **Go to your workspace's agents page:**
   - Click on your workspace name (top-left)
   - Select "Agents" from the sidebar
   - OR navigate directly to: https://studio.atlassian.com/workspace/agents

**You should see the Agents dashboard where you can create and manage agents.**

### Step 2: Choose an Agent to Provision

1. **Click the robot icon (🤖)** in your browser toolbar

2. **Review the available agents** in the popup

3. **Choose an agent** you want to create. For this example, let's use "Epic Elaboration Agent"

4. **Click "Provision"** next to the agent name

### Step 3: Watch the Provisioning Process

**Agentman will now automate the agent creation process. You'll see:**

**A progress bar showing each step:**

```
Creating Epic Elaboration Agent...

✓ Filling agent name...
✓ Filling agent description...
✓ Adding main instructions...
✓ Creating subagent 1 of 5: Material Gathering
✓ Creating subagent 2 of 5: Epic Analysis
✓ Creating subagent 3 of 5: Jira Epic Creation
✓ Creating subagent 4 of 5: Confluence Doc Creation
✓ Creating subagent 5 of 5: Team Review Support
✓ Activating agent...

Success! Agent created successfully.
```

**This typically takes 30-60 seconds.**

**What's happening behind the scenes:**

1. **Name & Description:** Agentman fills in the agent's name and description
2. **Main Instructions:** Adds the complete instruction set with proper markdown formatting
3. **Subagents:** Creates specialized helper agents (if configured)
   - Sets each subagent's name
   - Adds their specific instructions
   - Configures when they should activate
4. **Skills:** Attaches any required skills (like "Search Jira" or "Create Issues")
5. **Activation:** Automatically clicks the "Activate" button

**You don't need to do anything - just watch!**

### Step 4: Verify Your Agent

Once provisioning completes:

1. **Go to your Agents page** in Studio (if not already there)

2. **Find your newly created agent** in the list (e.g., "Epic Elaboration Agent")

3. **Click on it** to open the agent details

4. **Verify everything looks correct:**

   ✅ **Name** is correct (e.g., "Epic Elaboration Agent")
   
   ✅ **Description** is filled in
   
   ✅ **Instructions** are present and properly formatted:
   ```
   ### Your Role & Goal
   
   You are an Epic Elaboration Agent...
   
   ### Workflow
   
   1. First step
   2. Second step
   ```
   
   ✅ **Subagents** are created (check the "Scenarios" section):
   - Material Gathering
   - Epic Analysis
   - Jira Epic Creation
   - Confluence Doc Creation
   - Team Review Support
   
   ✅ **Each subagent has:**
   - A name
   - A trigger (when to activate)
   - Instructions
   - Green "Active" badge
   
   ✅ **Skills** are attached (if applicable)

5. **Test your agent:**
   - Click "Try it out" or "Test" button
   - Ask a question related to the agent's purpose
   - Verify it responds appropriately

**Congratulations! You've successfully provisioned your first Rovo agent!**

---

## Understanding Agent Components

Let's break down what was just created.

### Main Agent

**The main agent is the "parent" agent that users interact with.**

**Components:**

- **Name:** Human-readable name (e.g., "Epic Elaboration Agent")
- **Description:** Brief summary of what the agent does
- **Instructions:** Detailed guide on the agent's role, workflow, and capabilities

**Example Instructions:**

```markdown
### Your Role & Goal

You are an Epic Elaboration Agent that helps product teams analyze and 
elaborate Jira epics by gathering context, analyzing requirements, and 
creating comprehensive documentation.

### Workflow

1. Gather materials from Jira, Confluence, and other sources
2. Analyze epic scope and dependencies
3. Create detailed documentation
4. Support team review and iteration
```

### Subagents (Scenarios)

**Subagents are specialized helpers that handle specific tasks.**

**Why subagents?**
- Break complex workflows into focused steps
- Each subagent is an expert at one thing
- Automatically activate based on triggers
- Make agents more maintainable and understandable

**Example Subagents:**

**1. Material Gathering**
- **Trigger:** "gather information", "find related documents", "search for context"
- **Purpose:** Searches Jira and Confluence for relevant information
- **When it activates:** User asks to collect background information

**2. Epic Analysis**
- **Trigger:** "analyze epic", "review requirements", "assess scope"
- **Purpose:** Analyzes epic content and identifies gaps
- **When it activates:** User asks to analyze or review an epic

**3. Jira Epic Creation**
- **Trigger:** "create epic", "make jira epic", "generate epic"
- **Purpose:** Creates new Jira epics with proper formatting
- **When it activates:** User asks to create a new epic

**4. Confluence Doc Creation**
- **Trigger:** "create document", "write confluence page", "generate doc"
- **Purpose:** Creates documentation in Confluence
- **When it activates:** User asks to document something

**5. Team Review Support**
- **Trigger:** "review with team", "get feedback", "share for review"
- **Purpose:** Facilitates team review and feedback
- **When it activates:** User asks for team input

### Skills

**Skills are tools that agents can use to perform actions.**

**Common skills:**
- **Search with JQL:** Search Jira issues using Jira Query Language
- **Create Jira issues:** Create new issues, epics, or tasks
- **Search Confluence:** Find documentation pages
- **Create Confluence pages:** Create new documentation
- **Update work items:** Modify existing Jira issues

**Skills are configured in the agent YAML file and automatically attached during provisioning.**

### Knowledge & Settings

**Additional agent settings:**

- **Knowledge:** What the agent can access
  - `all` - Access all workspace content
  - `custom` - Access specific sources only
  - `none` - No knowledge access

- **Web Search:** Whether agent can search the web

- **Deep Research:** Enable advanced research capabilities

---

## Common Questions

### How do I provision multiple agents?

**Easy! Just repeat the provisioning process:**

1. Keep the Agent Manager server running (don't close the terminal)
2. Go back to Studio
3. Click the robot icon (🤖)
4. Click "Provision" on a different agent
5. Wait for completion

**You can provision as many agents as you need, one at a time.**

### Can I update an existing agent?

**Currently, Agentman creates new agents. To update an existing agent:**

**Option 1: Manual update**
1. Go to Studio
2. Open the agent you want to update
3. Edit fields manually

**Option 2: Delete and recreate**
1. Delete the old agent in Studio
2. Use Agentman to provision a fresh copy
3. ⚠️ **Warning:** This will lose any custom changes you made

**Option 3: Use version control (recommended for teams)**
1. Update the agent YAML configuration file
2. Provision a new version
3. Test the new version
4. Delete the old version when ready

### What if provisioning fails?

**If something goes wrong during provisioning:**

1. **Check the error message** in the extension popup

2. **Common issues:**
   - **"Connection refused"**: Server not running - restart Agent Manager
   - **"Invalid token"**: Token expired - get a new token and reconnect
   - **"500 Internal Server Error"**: Required field missing - check agent config

3. **Retry steps:**
   - Close the error popup
   - Click "Provision" again
   - If it fails again, see [Troubleshooting](#troubleshooting)

### How do I get agent configuration files?

**Agent configurations are typically:**

- **Provided by your organization** via a bundle server
- **Created by your team** and shared through Agent Manager
- **Created by you** (see [Creating Agent Configurations](#creating-agent-configurations))

**If you don't have any agents showing in the extension:**

1. Check that the bundle server URL is correct
2. Verify your organization has published agent bundles
3. Contact your team lead or administrator

### Can I use this with Edge browser?

**Yes! The extension works with both Chrome and Edge.**

**Installation is the same:**
1. Install via Agent Manager CLI
2. Restart Edge
3. Approve the extension

**Usage is identical:**
1. Click robot icon (🤖)
2. Connect with auth token
3. Provision agents

### Do I need to keep the terminal open?

**Yes, while using the extension:**

- **Keep the terminal open** where you ran the Agent Manager server
- **Don't close it** until you're done provisioning agents
- **Closing it stops the server** and disconnects the extension

**To stop the server when done:**
- Press `Ctrl+C` in the terminal
- Or just close the terminal window

**Next time you want to use the extension:**
- Start the server again: `npx -y @ai-agent-manager/cli@latest <url>`
- Select "Provision Rovo Agents → Chrome Extension"
- Reconnect with the new auth token

---

## Troubleshooting

### Extension icon not appearing

**Problem:** Robot icon (🤖) not visible in browser toolbar

**Solutions:**

1. **Check if extension is installed:**
   - Chrome: Go to `chrome://extensions`
   - Edge: Go to `edge://extensions`
   - Look for "Agentman - Rovo Agent Provisioner"

2. **If not listed:** Reinstall via Agent Manager CLI

3. **If listed but disabled:**
   - Click the toggle to enable it
   - Refresh your browser tabs

4. **If listed and enabled:**
   - Click the puzzle icon (🧩) in the toolbar
   - Find "Agentman - Rovo Agent Provisioner"
   - Click the pin icon to pin it to the toolbar

### Can't connect to server

**Problem:** "Connection refused" or "Failed to connect" error

**Solutions:**

1. **Verify server is running:**
   - Check the terminal where you started Agent Manager
   - You should see "Server running on http://127.0.0.1:19876"

2. **Restart the server:**
   - Press `Ctrl+C` in the terminal
   - Run the command again: `npx -y @ai-agent-manager/cli@latest <url>`
   - Select "Provision Rovo Agents → Chrome Extension"

3. **Get a fresh auth token:**
   - Copy the new token from the terminal
   - Paste it in the extension popup
   - Click "Connect"

4. **Check firewall/antivirus:**
   - Ensure they're not blocking localhost connections
   - Temporarily disable and try again

### Invalid token error

**Problem:** "Invalid auth token" or "Unauthorized" error

**Solutions:**

1. **Copy the correct token:**
   - Look in the terminal for "Auth token:"
   - Copy the entire token (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

2. **Paste carefully:**
   - Don't add extra spaces
   - Make sure you copied the complete token

3. **Get a new token:**
   - Tokens can expire
   - Restart the server to generate a fresh token

### Agent instructions are empty

**Problem:** Agent created but instructions field is blank

**Solutions:**

1. **Check browser console:**
   - Press `F12` to open Developer Tools
   - Go to "Console" tab
   - Look for error messages

2. **Reload the extension:**
   - Go to `chrome://extensions`
   - Click the reload icon (🔄) on Agentman extension card
   - Try provisioning again

3. **Refresh Studio page:**
   - Close Studio tab
   - Open a new tab and go to Studio
   - Try provisioning again

4. **Contact support** if the issue persists

### Subagent triggers missing

**Problem:** Subagents created but "When to use" field is empty

**Solutions:**

1. **Verify agent configuration:**
   - Check that the YAML file includes `trigger:` for each subagent
   - Example:
     ```yaml
     subagents:
       material-gathering:
         trigger: gather information, find documents, search
     ```

2. **Reprovision:**
   - Delete the agent in Studio
   - Provision again with corrected configuration

3. **Manual fix:**
   - Open the agent in Studio
   - Edit each subagent
   - Add triggers manually

### Provisioning gets stuck

**Problem:** Progress bar stops updating or hangs on a step

**Solutions:**

1. **Wait 2-3 minutes:**
   - Sometimes Studio is slow to respond
   - Give it time before canceling

2. **Refresh and retry:**
   - Refresh the Studio page
   - Click "Provision" again

3. **Check Studio UI:**
   - Navigate to the Agents page manually
   - See if the agent was partially created
   - Delete partial agent before retrying

4. **Restart everything:**
   - Stop the server (`Ctrl+C`)
   - Restart Agent Manager
   - Reconnect extension
   - Try provisioning again

---

## Creating Agent Configurations

Want to create your own agents? Here's how.

### Basic Agent YAML Structure

Create a file named `rovo-agent.yaml`:

```yaml
apiVersion: rovo.atlassian.com/v2-beta
kind: StudioAgent

name: My Custom Agent
description: Brief description of what this agent does

instructions: |
  ### Your Role & Goal
  
  Describe what the agent does and who it helps.
  
  ### Workflow
  
  1. First step - what happens
  2. Second step - next action
  3. Final step - outcome

skills:
  - Search with JQL
  - Create Jira issues

knowledge: all
webSearch: false
deepResearch: false

subagents:
  task-analyzer:
    name: Task Analyzer
    enabled: true
    trigger: analyze task, review requirements, assess complexity
    instructions: |
      ### Your Role
      
      You analyze tasks and assess their complexity.
      
      ### Steps
      
      1. Review task description
      2. Identify dependencies
      3. Estimate complexity
    skills:
      - Search with JQL
```

### Field Descriptions

**Required fields:**

- `apiVersion`: Always `rovo.atlassian.com/v2-beta`
- `kind`: Always `StudioAgent`
- `name`: Agent name (appears in Studio)
- `description`: Brief summary (1-2 sentences)
- `instructions`: Main agent instructions (use markdown)

**Optional fields:**

- `skills`: List of skills to attach
- `knowledge`: `all`, `custom`, or `none`
- `webSearch`: `true` or `false`
- `deepResearch`: `true` or `false`
- `subagents`: Dictionary of subagent configurations

**Subagent fields:**

- `name`: Subagent name
- `enabled`: `true` or `false`
- `trigger`: Comma-separated phrases that activate this subagent
- `instructions`: Subagent-specific instructions (use markdown)
- `skills`: Skills available to this subagent

### Adding Your Agent to Agent Manager

1. **Add your agent in the correct place:**

   **If your team uses a remote bundle server (recommended):**
   - Add a new agent directory to the bundle source repository (alongside other agents)
   - Commit and publish a new bundle version

   **If you are testing locally only:**
   - Create a local bundle root with your agent as a subdirectory

   ```bash
   mkdir -p ~/my-local-bundle/my-custom-agent
   cd ~/my-local-bundle/my-custom-agent
   ```

2. **Create `rovo-agent.yaml`:**
   - Copy the template above
   - Customize for your use case
   - Save as `rovo-agent.yaml`

3. **Verify it's available:**

   **Remote bundle server flow:** run Agent Manager against your server URL.

   **Local testing flow:** run Agent Manager against your local bundle root.
   ```bash
   AGENTMAN_CHROME_EXTENSION=1 npx -y @ai-agent-manager/cli@latest ~/my-local-bundle
   ```
   Your agent should appear in the list.

4. **Provision it:**
   - Start the server (Provision Rovo Agents → Chrome Extension)
   - Connect the extension
   - Click "Provision" next to your new agent

### Example: Simple Meeting Notes Agent

```yaml
apiVersion: rovo.atlassian.com/v2-beta
kind: StudioAgent

name: Meeting Notes Agent
description: Captures and organizes meeting notes into Confluence pages

instructions: |
  ### Your Role
  
  You help teams capture, organize, and distribute meeting notes efficiently.
  
  ### What You Do
  
  1. Guide users through capturing key meeting points
  2. Organize notes with clear structure (attendees, agenda, decisions, action items)
  3. Create formatted Confluence pages
  4. Link to related Jira issues
  
  ### Best Practices
  
  - Use clear headings and bullet points
  - Highlight action items and owners
  - Tag relevant team members
  - Link to related documentation

skills:
  - Create Confluence pages
  - Search Confluence
  - Search with JQL

knowledge: all
webSearch: false

subagents:
  note-capture:
    name: Note Capture
    enabled: true
    trigger: take notes, capture meeting, record discussion
    instructions: |
      Help the user capture meeting notes in a structured format.
      
      Ask for:
      - Meeting date and attendees
      - Agenda items
      - Key discussion points
      - Decisions made
      - Action items with owners
  
  confluence-publisher:
    name: Confluence Publisher
    enabled: true
    trigger: publish notes, create page, save to confluence
    instructions: |
      Create a formatted Confluence page with the meeting notes.
      
      Format:
      - Title: "[Date] - [Meeting Name] Meeting Notes"
      - Attendees list
      - Agenda sections
      - Decisions box (highlighted)
      - Action items table (with checkboxes)
    skills:
      - Create Confluence pages
```

---

## Getting Help

### Documentation Resources

- **This guide:** Complete user walkthrough
- **HOW-IT-WORKS.md:** Technical architecture and workflows (in chrome-extension folder)
- **README.md:** Quick start reference (in chrome-extension folder)

### Support Channels

**For technical issues:**
- Check [Troubleshooting](#troubleshooting) section above
- Search existing issues: [GitHub Issues](https://github.com/your-org/agent-manager/issues)
- Create a new issue with:
  - What you were trying to do
  - What went wrong
  - Error messages (screenshots help!)
  - Browser and extension version

**For agent configuration help:**
- Review [Creating Agent Configurations](#creating-agent-configurations)
- See root [README Examples Folder section](../README.md#examples-folder) for what `examples/` is used for
- Check example agents in `~/.agentman/bundles/`
- Ask your team lead or organization admin

**For Atlassian Rovo questions:**
- Visit [Atlassian Rovo documentation](https://www.atlassian.com/software/rovo)
- Contact Atlassian support

### Quick Reference

**Start the server:**
```bash
npx -y @ai-agent-manager/cli@latest https://your-bundle-server-url
```
Select: Provision Rovo Agents → Chrome Extension

**Connect extension:**
1. Click robot icon (🤖)
2. Paste auth token
3. Click "Connect"

**Provision agent:**
1. Open Studio (https://studio.atlassian.com)
2. Click robot icon (🤖)
3. Click "Provision" next to agent

**Stop the server:**
- Press `Ctrl+C` in terminal

**Check extension status:**
- Chrome: `chrome://extensions`
- Edge: `edge://extensions`

---

**Happy agent provisioning! 🤖**

If you encounter any issues or have questions, don't hesitate to reach out through the support channels above.
