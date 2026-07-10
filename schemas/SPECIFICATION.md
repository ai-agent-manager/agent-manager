# `rovo-agent.yaml` Specification

**Schema**: `rovo-agent.schema.json` (JSON Schema 2020-12)
**API Version**: `rovo.atlassian.com/v2-beta`

This document describes the `rovo-agent.yaml` manifest format used by the agent-manager to define and provision Atlassian Studio Rovo agents.

> **v1 archived.** The earlier `rovo.atlassian.com/v1` format (with a separate
> `identity` block, `behavior`, and `scenarios.default` / `scenarios.custom[]`)
> is no longer supported. Studio's editor moved to a single-page rich-text
> form, so the manifest now mirrors that flat shape.

---

## Overview

A `rovo-agent.yaml` file is the declarative configuration for a single Rovo agent. It maps directly to the settings available in the Atlassian Studio v2-beta single-page editor: name, description, instructions (rich text), conversation starters, knowledge scope, web search, deep research, skills, and subagents.

The manifest is parsed, validated against the JSON Schema, and any external file references (`$file`) are resolved before the configuration is passed to the provisioner.

---

## Top-Level Structure

```yaml
apiVersion: rovo.atlassian.com/v2-beta   # Required — fixed value
kind: StudioAgent                         # Required — fixed value

name: "My Agent"                          # Required
description: "Short description."         # Required
instructions: |                            # Required (string or $file)
  ...

# Optional fields
avatar: "🤖"
conversationStarters:
  - "..."
knowledge: all
webSearch: false
deepResearch: false
skills:
  - "..."

subagents:
  ...

knowledgeSources:
  ...
```

| Field                  | Type                    | Required | Description                                              |
|------------------------|-------------------------|----------|----------------------------------------------------------|
| `apiVersion`           | `string`                | Yes      | Must be `"rovo.atlassian.com/v2-beta"`.                  |
| `kind`                 | `string`                | Yes      | Must be `"StudioAgent"`.                                 |
| `name`                 | `string`                | Yes      | Agent display name (1–30 chars).                         |
| `description`          | `string`                | Yes      | Short agent description (1–400 chars).                   |
| `instructions`         | `string` or `$file` ref | Yes      | Rich-text instructions for the agent.                    |
| `avatar`               | `string`                | No       | Emoji or short avatar string.                            |
| `conversationStarters` | `string[]`              | No       | Up to 3 starter prompts shown in Studio.                 |
| `knowledge`            | `string`                | No       | Knowledge scope: `"all"` (default), `"custom"`, `"none"`. |
| `webSearch`            | `boolean`               | No       | Enable web search (default `false`).                     |
| `deepResearch`         | `boolean`               | No       | Enable deep research (default `false`).                  |
| `skills`               | `string[]`              | No       | Skill display names from Studio (e.g. `"Create page"`).  |
| `subagents`            | object                  | No       | Map of subagents — see below.                            |
| `knowledgeSources`     | array                   | No       | Knowledge integrations for `knowledge: custom`.          |

No additional top-level properties are allowed.

### Notes

- `instructions` is rendered into Studio's rich-text (ProseMirror) field. Plain Markdown is fine — Studio renders headings, lists, code, and links.
- If `conversationStarters` has more than 3 items, the parser truncates to the first 3 and emits a warning.

---

## `subagents`

Subagents are specialised behaviours triggered by natural-language conditions. Each subagent has its own instructions, knowledge scope, and skills. The map key is a stable identifier (used for diffs and lookups); the `name` is what users see in Studio.

```yaml
subagents:
  troubleshooting:
    name: "Troubleshooting"
    enabled: true
    trigger: "When someone reports an error or issue"
    instructions:
      $file: ./subagents/troubleshooting/instructions.md
    knowledge: custom
    deepResearch: true
    skills:
      - "Create work item"
```

| Field                  | Type                    | Required | Default | Description                                              |
|------------------------|-------------------------|----------|---------|----------------------------------------------------------|
| `name`                 | `string`                | Yes      |         | Subagent display name.                                   |
| `enabled`              | `boolean`               | Yes      |         | Whether the subagent is active.                          |
| `trigger`              | `string`                | No       |         | Natural language trigger (e.g. "When someone asks…").    |
| `instructions`         | `string` or `$file` ref | No       |         | Multi-line instructions for this subagent.               |
| `conversationStarters` | `string[]`              | No       |         | Subagent-scoped starters (max 3).                        |
| `knowledge`            | `string`                | No       |         | `"all"`, `"custom"`, or `"none"`.                        |
| `webSearch`            | `boolean`               | No       |         | Enable web search.                                       |
| `deepResearch`         | `boolean`               | No       |         | Enable deep research.                                    |
| `skills`               | `string[]`              | No       |         | Skill display names from Studio.                         |

### Notes

- `knowledge: "custom"` requires at least one entry in the top-level `knowledgeSources` array.
- `skills` values must match the display names from Studio (e.g. `"Create page"`).
- The map key (e.g. `troubleshooting`) is the stable identifier the agent-manager uses for diffs; the user-visible label is `name`.

---

## `knowledgeSources`

Optional array of knowledge source integrations. Required when `knowledge: "custom"` is used at any level. Maps to the Custom Knowledge dialog in Studio.

```yaml
knowledgeSources:
  - type: confluence
    filter: "all"
  - type: jira
    filter: "MY-PROJECT"
```

| Field    | Type     | Required | Description                                                    |
|----------|----------|----------|----------------------------------------------------------------|
| `type`   | `string` | Yes      | Integration type: `"confluence"`, `"jira"`, `"jsm"`, or `"atlassian-support-docs"`. |
| `filter` | `string` | No       | `"all"` for all content, or a specific space/project identifier. |

---

## `$file` References

Fields that accept large text content can reference external files instead of inlining content in the YAML.

### Supported Fields

- `instructions` (top-level)
- `subagents.<key>.instructions`

All other fields must be inline values.

### Syntax

Instead of an inline string:

```yaml
instructions: |
  You are a helpful assistant who...
```

Use a `$file` reference:

```yaml
instructions:
  $file: ./instructions.md
```

The object must contain exactly one property: `$file`, whose value is a relative file path.

### Path Rules

| Rule                  | Example (rejected)           | Reason                                                |
|-----------------------|------------------------------|-------------------------------------------------------|
| Must be relative      | `/etc/passwd`                | Absolute paths are rejected.                          |
| No `..` segments      | `../../secrets/key.txt`      | Directory traversal is rejected.                      |
| Must stay within dir  | (any path escaping base dir) | Resolved path must be within the agent directory.     |
| Must not be empty     | `""`                         | Empty path strings are rejected.                      |

Paths are resolved relative to the directory containing the `rovo-agent.yaml` file.

### Resolution Order

1. The YAML is parsed.
2. Best-effort normalisations are applied (e.g. truncating `conversationStarters`).
3. **Schema validation runs** — the raw structure (including `{ $file: "..." }` objects) is validated.
4. **`$file` references are resolved** — each `$file` value is replaced with the contents of the referenced file.
5. The configuration is normalised into the canonical in-memory shape and returned.

Schema errors (missing required fields, invalid types) are reported **before** any file I/O.

### Mixing Inline and `$file`

You can mix inline and `$file` within the same manifest:

```yaml
instructions:
  $file: ./instructions.md
subagents:
  quick-answer:
    name: "Quick Answer"
    enabled: true
    trigger: "When someone asks a simple question"
    instructions: "Just answer the question directly."
```

---

## Example: Minimal Inline Manifest

```yaml
apiVersion: rovo.atlassian.com/v2-beta
kind: StudioAgent

name: "Help Desk Agent"
description: "Answers common IT support questions."
instructions: |
  You are a friendly IT support agent.
  Answer questions clearly and concisely.
  If you don't know the answer, suggest contacting the IT help desk.

knowledge: all
webSearch: false
```

## Example: Manifest with `$file` References and Subagents

```yaml
apiVersion: rovo.atlassian.com/v2-beta
kind: StudioAgent

name: "Help Desk Agent"
description: "Answers common IT support questions."
instructions:
  $file: ./instructions.md

conversationStarters:
  - "I need help with my password"
  - "My VPN won't connect"

knowledge: custom
webSearch: false

subagents:
  password-reset:
    name: "Password Reset"
    enabled: true
    trigger: "When someone needs help resetting a password"
    instructions:
      $file: ./subagents/password-reset.md
    knowledge: all

knowledgeSources:
  - type: confluence
    filter: "IT"
```

With the corresponding file structure:

```
help-desk-agent/
├── rovo-agent.yaml
├── instructions.md
└── subagents/
    └── password-reset.md
```

---

## Validation

The manifest is validated against `rovo-agent.schema.json` (JSON Schema 2020-12). Validation errors are reported with the JSON Pointer path to the offending field.

### Common Validation Errors

| Error                                          | Cause                                              |
|------------------------------------------------|----------------------------------------------------|
| `Missing required property: name`              | Top-level `name` is absent.                        |
| `Missing required property: description`       | Top-level `description` is absent.                 |
| `Missing required property: instructions`      | Top-level `instructions` is absent.                |
| `apiVersion: must be equal to constant`        | `apiVersion` is not `rovo.atlassian.com/v2-beta`.  |
| `/name: must NOT have more than 30 characters` | Name exceeds Studio's 30-character limit.          |
| `/description: must NOT have more than 400 characters` | Description exceeds Studio's 400-character limit. |
| `subagents/<key>: missing required property 'enabled'` | Every subagent must declare `enabled: true | false`. |
| `$file path must be relative`                  | An absolute path was used in a `$file` reference.  |
| `$file path must not contain '..' segments`    | Directory traversal was attempted.                 |
| `failed to read $file '...'`                   | The referenced file does not exist or is unreadable. |

### Normalisation Warnings

| Warning                                        | Action                                             |
|------------------------------------------------|----------------------------------------------------|
| `conversationStarters has N items but Studio allows max 3` | Truncated to first 3 items.            |

---

## Internal Normalisation

For consumers that read the parsed config (e.g. provisioners, UI components),
the v2-beta YAML is normalised in-memory into a canonical shape that mirrors
the v1 internal model. This keeps downstream code stable:

| YAML field                              | Canonical config path                               |
|-----------------------------------------|-----------------------------------------------------|
| `name`                                  | `identity.name`                                     |
| `description`                           | `identity.description`                              |
| `avatar`                                | `identity.avatar`                                   |
| `conversationStarters`                  | `identity.conversationStarters`                     |
| `instructions`                          | `scenarios.default.instructions`                    |
| `knowledge` / `webSearch` / `deepResearch` / `skills` | `scenarios.default.*`                  |
| `subagents.<key>`                       | `scenarios.custom[]` (with `key` set)               |
| `knowledgeSources`                      | `knowledgeSources`                                  |
