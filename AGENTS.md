# AGENTS

## Project Overview

- Repository: `CircuitJSON Toolkit` JavaScript library.
- Source is in `src/`.
- Tests are in `tests/`.
- Specifications are in `spec/`.
- Documentation is in `docs/`.
- The package contains dependency-free CircuitJSON validation, indexing, and
  utility helpers for browser and Node consumers.

## Build, Run, Test

- Install: `npm install`
- Test: `npm test`
- Format: `npm run format`
- Check formatting: `npm run check:format`

## Coding Style & Naming Conventions

- Prettier settings are in `.prettierrc.json`: 4-space indent, single quotes,
  no semicolons, no trailing commas.
- Keep files under 1000 lines; split modules/classes when they grow.
- Add JSDoc for every function/method, including private helpers.
- Add inline comments only where non-obvious behavior needs context.
- Utility modules should use class-based organization with static methods when
  appropriate.
- For single-class modules, name the `.mjs` file in CamelCase to match the
  class name.
- For private internals, use ECMAScript private elements.
- Prefer `async/await` for naturally asynchronous operations.

## Library Scope

- Include CircuitJSON element-array validation, parsing, indexing, unit helpers,
  deterministic renderer-neutral primitive helpers, deterministic SVG renderers,
  and small summary/export helpers.
- Do not include Three.js code, ECAD parser logic, UI wiring, host app state,
  DOM event orchestration, download UI, or source-format-specific compatibility
  adapters.

## Testing Guidelines

- Use repo scripts only: `npm test`.
- For every feature/fix/behavior change, add or update tests in `tests/`.
- Keep tests focused on observable CircuitJSON utility behavior.
- Tests must use small fake CircuitJSON samples only.

## Fix Quality Rules

- Fixes must always address the general behavior, not a specific example,
  fixture, file, project, or test case.
- Do not implement workarounds, cheats, allowlists, hard-coded example handling,
  or special-case logic to make one sample pass.
- When you encounter existing workaround code, cheating behavior, or
  example-specific handling, rewrite it into general-purpose behavior
  immediately when it is in scope for the change.
- Keep fixes universal and structural: derive behavior from the underlying data
  model, format, protocol, or UI contract instead of matching known sample text,
  filenames, labels, or project identifiers.
- After fixing code, run the appropriate repo-owned tests and do not modify tests
  just to make a workaround pass.

## Security & Configuration Tips

- Treat CircuitJSON files as untrusted input.
- Keep helpers local-first and dependency-free by default.
