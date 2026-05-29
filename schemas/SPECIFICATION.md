# `rovo-agent.yaml` Specification

**Schema**: `rovo-agent.schema.json` (JSON Schema 2020-12)
**API Version**: `rovo.atlassian.com/v1`

This document describes the `rovo-agent.yaml` manifest format used by the agent-manager to define and provision Atlassian Studio Rovo agents.

---

## Overview

A `rovo-agent.yaml` file is the declarative configuration for a single Rovo agent. It maps directly to the settings available in the Atlassian Studio UI: identity (name, description, behaviour), scenarios (default + custom), knowledge sources, and skills.

The manifest is parsed, validated against the JSON Schema, and then any external file references (`$file`) are resolved before the configuration is passed to the provisioner.

---

## Top-Level Structure

```yaml
apiVersion: rovo.atlassian.com/v1   # Required — fixed value
kind: StudioAgent                    # Required — fixed value

identity:          # Required — agent identity
  ...

scenarios:         # Required — agent scenarios
  ...

knowledgeSources:  # Optional — custom knowledge integrations
  ...
```

| Field              | Type     | Required | Description                                           |
|--------------------|----------|----------|-------------------------------------------------------|
| `apiVersion`       | `string` | Yes      | Must be `"rovo.atlassian.com/v1"`.                    |
| `kind`             | `string` | Yes      | Must be `"StudioAgent"`.                              |
| `identity`         | object   | Yes      | Agent identity — maps to the Identity page in Studio. |
| `scenarios`        | object   | Yes      | Agent scenarios — maps to the Scenarios section.      |
| `knowledgeSources` | array    | No       | Knowledge source integrations for `custom` knowledge. |

No additional top-level properties are allowed.

---

## `identity`

Defines who the agent is — its name, description, avatar, behaviour, and conversation starters. Maps to the Identity page in Atlassian Studio.

```yaml
identity:
  name: "My Agent"
  description: "A short description of what this agent does."
  avatar: "🤖"                     # Optional
  behavior: |                       # Or: { $file: ./identity/behavior.md }
    You are a helpful assistant...
  conversationStarters:             # Optional, max 3
    - "How can you help me?"
    - "Show me an example"
```

| Field                  | Type                    | Required | Constraints       | Description                                  |
|------------------------|-------------------------|----------|-------------------|----------------------------------------------|
| `name`                 | `string`                | Yes      | 1–30 characters   | Agent display name.                          |
| `description`          | `string`                | Yes      | 1–400 characters  | Short agent description.                     |
| `avatar`               | `string`                | No       |                   | Emoji avatar for the agent.                  |
| `behavior`             | `string` or `$file` ref | Yes      | Min 1 character   | Multi-line behaviour text (tone, style, approach). |
| `conversationStarters` | `string[]`              | No       | Max 3 items       | Conversation starter prompts shown to users. |

### Notes

- `behavior` accepts either an inline string or a [`$file` reference](#file-references). This is useful for large behaviour definitions.
- If `conversationStarters` has more than 3 items, the parser truncates to the first 3 and emits a warning.

---

## `scenarios`

Defines the agent's scenarios — instructions, knowledge scope, capabilities, and skills. Every agent has a `default` scenario and may have additional `custom` scenarios.

```yaml
scenarios:
  default:
    instructions: |
      Your primary task is...
    knowledge: all
    webSearch: false
    skills:
      - "Create page"

  custom:
    - name: "Troubleshooting"
      trigger: "When someone reports an error or issue"
      instructions:
        $file: ./scenarios/troubleshooting/instructions.md
      knowledge: custom
      deepResearch: true
      skills:
        - "Create work item"
```

### `scenarios.default`

The default scenario — always present, has no trigger, and no deep research toggle.

| Field          | Type                    | Required | Default | Description                                        |
|----------------|-------------------------|----------|---------|----------------------------------------------------|
| `instructions` | `string` or `$file` ref | Yes      |         | Multi-line instructions for this scenario.         |
| `knowledge`    | `string`                | No       | `"all"` | Knowledge scope: `"all"`, `"custom"`, or `"none"`. |
| `webSearch`    | `boolean`               | No       | `false` | Enable web search capability.                      |
| `skills`       | `string[]`              | No       |         | Skills available in this scenario (display names). |

### `scenarios.custom[]`

Additional custom scenarios with natural-language triggers.

| Field          | Type                    | Required | Default | Description                                                 |
|----------------|-------------------------|----------|---------|-------------------------------------------------------------|
| `name`         | `string`                | Yes      |         | Scenario display name.                                      |
| `trigger`      | `string`                | Yes      |         | Natural language trigger (e.g. "When someone asks about…"). |
| `instructions` | `string` or `$file` ref | Yes      |         | Multi-line instructions for this scenario.                  |
| `knowledge`    | `string`                | No       | `"all"` | Knowledge scope: `"all"`, `"custom"`, or `"none"`.          |
| `webSearch`    | `boolean`               | No       | `false` | Enable web search capability.                               |
| `deepResearch` | `boolean`               | No       | `false` | Enable deep research (only available on custom scenarios).  |
| `enabled`      | `boolean`               | No       | `true`  | Whether the scenario is enabled.                            |
| `skills`       | `string[]`              | No       |         | Skills available in this scenario (display names).          |

### Notes

- `knowledge: "custom"` requires at least one entry in the top-level `knowledgeSources` array.
- `skills` values must match the display names from Atlassian Studio (e.g. `"Create page"`, `"Create work item"`).
- The `deepResearch` toggle is only available on custom scenarios — the default scenario does not support it.

---

## `knowledgeSources`

Optional array of knowledge source integrations. Required when any scenario uses `knowledge: "custom"`. Maps to the Custom Knowledge dialog in Atlassian Studio.

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

Fields that accept large text content can reference external files instead of inlining the content in the YAML. This keeps the manifest concise and allows content to be authored as standalone Markdown or text files.

### Supported Fields

Only the following fields support `$file` references:

- `identity.behavior`
- `scenarios.default.instructions`
- `scenarios.custom[*].instructions`

All other fields must be inline values.

### Syntax

Instead of an inline string:

```yaml
behavior: |
  You are a helpful assistant who...
```

Use a `$file` reference:

```yaml
behavior:
  $file: ./identity/behavior.md
```

The object must contain exactly one property: `$file`, whose value is a relative file path.

### Path Rules

| Rule                  | Example (rejected)           | Reason                           |
|-----------------------|------------------------------|----------------------------------|
| Must be relative      | `/etc/passwd`                | Absolute paths are rejected.     |
| No `..` segments      | `../../secrets/key.txt`      | Directory traversal is rejected. |
| Must stay within dir  | (any path escaping base dir) | Resolved path must be within the agent directory. |
| Must not be empty     | `""`                         | Empty path strings are rejected. |

Paths are resolved relative to the directory containing the `rovo-agent.yaml` file.

### Resolution Order

1. The YAML is parsed.
2. Best-effort normalisations are applied (e.g. truncating `conversationStarters`).
3. **Schema validation runs** — the raw structure (including `{ $file: "..." }` objects) is validated against the JSON Schema.
4. **`$file` references are resolved** — each `$file` value is replaced with the contents of the referenced file.
5. The fully-resolved configuration is returned.

This means schema errors (e.g. missing required fields, invalid types) are reported **before** any file I/O occurs.

### Backwards Compatibility

Inline strings continue to work exactly as before. The `$file` mechanism is purely additive — manifests that don't use it require no changes.

You can also mix inline and `$file` within the same manifest:

```yaml
scenarios:
  default:
    instructions:
      $file: ./scenarios/default/instructions.md    # from file
  custom:
    - name: "Simple Scenario"
      trigger: "When someone asks a simple question"
      instructions: "Just answer the question directly."  # inline
```

---

## Example: Inline Manifest

A minimal manifest with all content inlined:

```yaml
apiVersion: rovo.atlassian.com/v1
kind: StudioAgent

identity:
  name: "Help Desk Agent"
  description: "Answers common IT support questions."
  behavior: |
    You are a friendly IT support agent.
    Answer questions clearly and concisely.

scenarios:
  default:
    instructions: |
      Help users with common IT support questions.
      If you don't know the answer, suggest they contact the IT help desk.
    knowledge: all
    webSearch: false
```

## Example: Manifest with `$file` References

The same agent with behaviour and instructions externalised:

```yaml
apiVersion: rovo.atlassian.com/v1
kind: StudioAgent

identity:
  name: "Help Desk Agent"
  description: "Answers common IT support questions."
  behavior:
    $file: ./identity/behavior.md

scenarios:
  default:
    instructions:
      $file: ./scenarios/default/instructions.md
    knowledge: all
    webSearch: false
```

With the corresponding file structure:

```
help-desk-agent/
├── rovo-agent.yaml
├── identity/
│   └── behavior.md
└── scenarios/
    └── default/
        └── instructions.md
```

---

## Validation

The manifest is validated against `rovo-agent.schema.json` (JSON Schema 2020-12). Validation errors are reported with the JSON Pointer path to the offending field.

### Common Validation Errors

| Error                                          | Cause                                              |
|------------------------------------------------|----------------------------------------------------|
| `Missing required property: identity`          | Top-level `identity` block is absent.              |
| `Missing required property: scenarios`         | Top-level `scenarios` block is absent.             |
| `Missing required property: default`           | `scenarios.default` is absent.                     |
| `/identity/name: must NOT have more than 30 characters` | Name exceeds Studio's 30-character limit. |
| `/identity/description: must NOT have more than 400 characters` | Description exceeds Studio's 400-character limit. |
| `$file path must be relative`                  | An absolute path was used in a `$file` reference.  |
| `$file path must not contain '..' segments`    | Directory traversal was attempted.                 |
| `failed to read $file '...'`                   | The referenced file does not exist or is unreadable. |

### Normalisation Warnings

Some non-conformant values are auto-corrected with a warning:

| Warning                                        | Action                                             |
|------------------------------------------------|----------------------------------------------------|
| `conversationStarters has N items but Studio allows max 3` | Truncated to first 3 items.           |
