<!--
SPDX-FileCopyrightText: 2026 André Fiedler
SPDX-License-Identifier: CC-BY-SA-4.0
-->

# Query implementation provenance

Task 6 consolidates source-neutral query behavior in `circuitjson-toolkit`.
The implementation is an independent, contract-driven reimplementation over
CircuitJSON indexes. No source text or package-native data model from the
consulted Altium or KiCad implementations is copied into this repository.

## Consulted duplicate implementations

### Altium Toolkit

- Repository: `https://github.com/SunboX/altium-toolkit`
- Inspected worktree: `../altium-toolkit-api-convergence`
- Inspected worktree commit: `9fa22e1028d96e583275093279bf6e03e8619588`
- Source-introducing commit: `e8a8cd551ad103cd0cf96bb5b5f5b816874ed72b`
- Paths: `src/core/netlist-query/RegexPattern.mjs`,
  `src/core/netlist-query/ComponentGrouping.mjs`,
  `src/core/netlist-query/CircuitTraversal.mjs`,
  `src/core/netlist-query/QueryNetlistBuilder.mjs`, and
  `src/core/netlist-query/LoadedDesignNetlistService.mjs`
- Copyright: `2026 André Fiedler`
- License: `GPL-3.0-or-later`
- Reuse classification: observable behavior, result-field vocabulary, and
  repository-owned fake-test expectations were reviewed. Source logic and
  algorithm shape were not copied; the Task 6 modules are independently
  implemented from the approved shared contract and CircuitJSON indexes.

### KiCad Toolkit

- Repository: `https://github.com/SunboX/kicad-toolkit`
- Inspected worktree: `../kicad-toolkit-api-convergence`
- Inspected worktree commit: `c71c88d69d236accce123656dfa66914c0d5489c`
- Source-introducing commit: `02e38fe0b961a09d2ff25462b9b00207326743d2`
- Paths: `src/core/netlist-query/RegexPattern.mjs`,
  `src/core/netlist-query/ComponentGrouping.mjs`,
  `src/core/netlist-query/CircuitTraversal.mjs`,
  `src/core/netlist-query/QueryNetlistBuilder.mjs`, and
  `src/core/netlist-query/LoadedDesignNetlistService.mjs`
- Copyright: `2026 André Fiedler`
- License: `GPL-3.0-or-later`
- Reuse classification: observable behavior, result-field vocabulary, and
  repository-owned fake-test expectations were reviewed. The files are
  byte-identical to the Altium copies, but no source logic or algorithm shape
  is copied into the independent Task 6 implementation.

## CircuitJSON-owned inputs

- Repository: `https://github.com/SunboX/circuitjson-toolkit`
- Inspected commit: `ed46a237e6d71355d6400692509356fe3737c802`
- Paths: `src/core/CircuitJsonIndexer.mjs` and
  `src/core/context/CircuitJsonDocumentContext.mjs`
- Copyright: `2026 André Fiedler`
- License: `AGPL-3.0-or-later`
- Reuse classification: these repository-owned APIs are consumed directly as
  the single source of truth for element, relation, and connectivity data.

## Task 6 module decisions

| Module                    | Consulted behavior                                                  | Reuse decision                                                |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| `RegexPattern.mjs`        | String-sourced regular-expression matching and per-test state reset | Independent bounded validator; no source or algorithm copying |
| `ComponentGrouping.mjs`   | Deterministic component ordering and grouping vocabulary            | Independent stable-ID grouping over CircuitJSON rows          |
| `CircuitTraversal.mjs`    | Ordered connectivity results, endpoints, and cycle termination      | Independent bounded traversal over derived CircuitJSON edges  |
| `QueryNetlistBuilder.mjs` | Component, net, and pin result vocabulary                           | Independent construction from prepared context indexes        |
| `QueryService.mjs`        | Bound service reuse and convenience query methods                   | Independent canonical `ecad-toolkit.query.v1` service         |

All new Task 6 software remains `AGPL-3.0-or-later`. Because no GPL source or
algorithm implementation is copied, no source-file relicensing occurs. The
consulted projects and their original GPL notices remain attributed here and in
`NOTICE.md`.
