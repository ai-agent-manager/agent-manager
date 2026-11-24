# Vendored Ink components

`SelectInput`, `TextInput` and `Spinner` are copies of `ink-select-input`,
`ink-text-input` and `ink-spinner` (MIT, Vadym Demedes).

Do not swap them back for the npm packages. Those packages declare `react` and
`ink` as open-ended peer dependencies (`>=18`, `>=4`). When npx upgrades a cached
install in place across a React or Ink major version, the stale top-level React and
Ink still satisfy those peers, so npm keeps them. The new versions get nested
under `@ai-agent-manager/cli` instead. The components then render with a second
React copy and crash with "Invalid hook call" (seen when upgrading 1.23.1 to 1.24.0).

Rule: no runtime dependency of the CLI may peer-depend on `react` or `ink`.
