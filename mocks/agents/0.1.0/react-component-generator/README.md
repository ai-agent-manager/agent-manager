---
name: React Component Generator
description: Agent skill that scaffolds React components with co-located tests, stories, and TypeScript types from a plain-language description.
tags:
  - agent-skill
  - frontend
  - react
phases:
  - build_and_release
---

# React Component Generator

This skill generates production-ready React components from a natural-language description of the UI you need.

## What It Produces

For each component the skill creates:

| File | Purpose |
|------|---------|
| `ComponentName.tsx` | Functional component with props interface |
| `ComponentName.test.tsx` | Unit tests using React Testing Library |
| `ComponentName.stories.tsx` | Storybook stories for visual review |
| `index.ts` | Barrel export |

## Usage

Run the skill from your AI coding tool:

```
Generate a SearchBar component with debounced input, clear button, and loading spinner
```

The skill analyses your description, infers prop types, and writes the component files into the directory you specify.

## Configuration

Place a `.component-generator.yaml` in your project root to customise defaults:

```yaml
testFramework: vitest        # vitest | jest
styling: css-modules         # css-modules | tailwind | styled-components
storybook: true
```
