<!--
SPDX-FileCopyrightText: 2026 André Fiedler
SPDX-License-Identifier: CC-BY-SA-4.0
-->

# Query implementation provenance

Task 6 consolidates source-neutral query behavior in `circuitjson-toolkit`.
The implementation is an independent, contract-driven reimplementation over
CircuitJSON indexes. No source text or package-native data model from the
consulted Altium or KiCad implementations is copied into this repository.

## Adapted-module records

Every adapted module has a complete record for both consulted repositories.
The records deliberately distinguish behavior observation from implementation
reuse.

### RegexPattern.mjs

- Local path: `src/core/query/RegexPattern.mjs`

#### Altium Toolkit source

- Repository: `https://github.com/SunboX/altium-toolkit`
- Path: `src/core/netlist-query/RegexPattern.mjs`
- Inspected worktree commit: `9fa22e1028d96e583275093279bf6e03e8619588`
- Source-introducing commit: `e8a8cd551ad103cd0cf96bb5b5f5b816874ed72b`
- Copyright: `2026 André Fiedler`
- License: `GPL-3.0-or-later`

#### KiCad Toolkit source

- Repository: `https://github.com/SunboX/kicad-toolkit`
- Path: `src/core/netlist-query/RegexPattern.mjs`
- Inspected worktree commit: `c71c88d69d236accce123656dfa66914c0d5489c`
- Source-introducing commit: `02e38fe0b961a09d2ff25462b9b00207326743d2`
- Copyright: `2026 André Fiedler`
- License: `GPL-3.0-or-later`

#### Decision

- Consulted behavior: string-sourced regular-expression matching and reset
  behavior between tests.
- Reuse classification: behavior-only, independent bounded validation. No
  source text or algorithm implementation was copied.

### ComponentGrouping.mjs

- Local path: `src/core/query/ComponentGrouping.mjs`

#### Altium Toolkit source

- Repository: `https://github.com/SunboX/altium-toolkit`
- Path: `src/core/netlist-query/ComponentGrouping.mjs`
- Inspected worktree commit: `9fa22e1028d96e583275093279bf6e03e8619588`
- Source-introducing commit: `e8a8cd551ad103cd0cf96bb5b5f5b816874ed72b`
- Copyright: `2026 André Fiedler`
- License: `GPL-3.0-or-later`

#### KiCad Toolkit source

- Repository: `https://github.com/SunboX/kicad-toolkit`
- Path: `src/core/netlist-query/ComponentGrouping.mjs`
- Inspected worktree commit: `c71c88d69d236accce123656dfa66914c0d5489c`
- Source-introducing commit: `02e38fe0b961a09d2ff25462b9b00207326743d2`
- Copyright: `2026 André Fiedler`
- License: `GPL-3.0-or-later`

#### Decision

- Consulted behavior: deterministic grouping vocabulary and stable result
  ordering.
- Reuse classification: behavior-only, independent grouping over canonical
  CircuitJSON relations. No source text or algorithm implementation was copied.

### CircuitTraversal.mjs

- Local path: `src/core/query/CircuitTraversal.mjs`

#### Altium Toolkit source

- Repository: `https://github.com/SunboX/altium-toolkit`
- Path: `src/core/netlist-query/CircuitTraversal.mjs`
- Inspected worktree commit: `9fa22e1028d96e583275093279bf6e03e8619588`
- Source-introducing commit: `e8a8cd551ad103cd0cf96bb5b5f5b816874ed72b`
- Copyright: `2026 André Fiedler`
- License: `GPL-3.0-or-later`

#### KiCad Toolkit source

- Repository: `https://github.com/SunboX/kicad-toolkit`
- Path: `src/core/netlist-query/CircuitTraversal.mjs`
- Inspected worktree commit: `c71c88d69d236accce123656dfa66914c0d5489c`
- Source-introducing commit: `02e38fe0b961a09d2ff25462b9b00207326743d2`
- Copyright: `2026 André Fiedler`
- License: `GPL-3.0-or-later`

#### Decision

- Consulted behavior: ordered traversal, visited-net handling, and cycle
  termination. Sibling endpoint and traversal-bound fields were not consulted.
- Reuse classification: behavior-only, independent traversal. Endpoint and
  path-connector records are derived directly from CircuitJSON ports, nets, and
  explicit internal connections; no source text or algorithm was copied.

### QueryNetlistBuilder.mjs

- Local path: `src/core/query/QueryNetlistBuilder.mjs`

#### Altium Toolkit source

- Repository: `https://github.com/SunboX/altium-toolkit`
- Path: `src/core/netlist-query/QueryNetlistBuilder.mjs`
- Inspected worktree commit: `9fa22e1028d96e583275093279bf6e03e8619588`
- Source-introducing commit: `e8a8cd551ad103cd0cf96bb5b5f5b816874ed72b`
- Copyright: `2026 André Fiedler`
- License: `GPL-3.0-or-later`

#### KiCad Toolkit source

- Repository: `https://github.com/SunboX/kicad-toolkit`
- Path: `src/core/netlist-query/QueryNetlistBuilder.mjs`
- Inspected worktree commit: `c71c88d69d236accce123656dfa66914c0d5489c`
- Source-introducing commit: `02e38fe0b961a09d2ff25462b9b00207326743d2`
- Copyright: `2026 André Fiedler`
- License: `GPL-3.0-or-later`

#### Decision

- Consulted behavior: component, net, and pin result vocabulary.
- Reuse classification: behavior-only, independent construction from prepared
  CircuitJSON indexes. No source text or algorithm implementation was copied.

### QueryService.mjs

- Local path: `src/core/query/QueryService.mjs`

#### Altium Toolkit source

- Repository: `https://github.com/SunboX/altium-toolkit`
- Path: `src/core/netlist-query/LoadedDesignNetlistService.mjs`
- Inspected worktree commit: `9fa22e1028d96e583275093279bf6e03e8619588`
- Source-introducing commit: `e8a8cd551ad103cd0cf96bb5b5f5b816874ed72b`
- Copyright: `2026 André Fiedler`
- License: `GPL-3.0-or-later`

#### KiCad Toolkit source

- Repository: `https://github.com/SunboX/kicad-toolkit`
- Path: `src/core/netlist-query/LoadedDesignNetlistService.mjs`
- Inspected worktree commit: `c71c88d69d236accce123656dfa66914c0d5489c`
- Source-introducing commit: `02e38fe0b961a09d2ff25462b9b00207326743d2`
- Copyright: `2026 André Fiedler`
- License: `GPL-3.0-or-later`

#### Decision

- Consulted behavior: bound-service reuse and convenience query methods.
- Reuse classification: behavior-only, independent canonical query boundary
  over a prepared CircuitJSON context. No source text or algorithm was copied.

## CircuitJSON-owned inputs

- Repository: `https://github.com/SunboX/circuitjson-toolkit`
- Inspected commit: `ed46a237e6d71355d6400692509356fe3737c802`
- Paths: `src/core/CircuitJsonIndexer.mjs` and
  `src/core/context/CircuitJsonDocumentContext.mjs`
- Copyright: `2026 André Fiedler`
- License: `AGPL-3.0-or-later`
- Reuse classification: these repository-owned APIs are consumed directly as
  the single source of truth for element, relation, and connectivity data.

All new Task 6 software remains `AGPL-3.0-or-later`. Because no GPL source or
algorithm implementation is copied, no source-file relicensing occurs. The
consulted projects and their original GPL notices remain attributed here and in
`NOTICE.md`.
