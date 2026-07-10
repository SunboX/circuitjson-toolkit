<!--
SPDX-FileCopyrightText: 2026 André Fiedler

SPDX-License-Identifier: CC-BY-SA-4.0
-->

# KiCad Toolkit Convergence Design

## Goal

Migrate `kicad-toolkit` to the shared API and strict CircuitJSON core while
retaining its broad native parser, project, library, export, rendering, and CLI
feature set and reducing eager intermediate graphs.

## Parser and Extension Boundary

KiCad decoding retains source text parsing, S-expression ASTs, board/schematic
models, libraries, project metadata, PCM, jobsets, rules, worksheets, legacy
formats, and native diagnostics. The common result contains pure CircuitJSON
and `extensions.kicad`; it does not attach the renderer model, raw AST, or board
as array properties.

The local shallow `CircuitJsonModelSchema` and generic adapter utilities are
replaced by the shared schema/context. KiCad-specific CircuitJSON projection
logic remains local where it interprets KiCad semantics, but reusable field,
metadata, connectivity, geometry, and validation helpers move to the shared
core.

CircuitJSON-to-KiCad project, library, and module exporters; model resolution;
PCM; CLI snapshot support; stroke font; layer/pad-stack rules; WRL behavior;
and native report builders remain public through extensions and focused native
subpaths.

## Common Capability Alignment

Switch the duplicated netlist-query files to shared exports. Align parser,
project loader, renderer, interaction, scene3d, capability, worker, diagnostic,
side, and empty/error behavior with the common contract.

Replace the monolithic hard-coded parity inventory with the shared capability
record shape plus concise KiCad-native extension records. Existing capability
coverage remains documented and tested.

## Performance

- Avoid retaining source text, tokens, AST, renderer model, CircuitJSON, and all
  report sidecars simultaneously by default.
- Make raw AST/board data and the eleven eager PCB report families opt-in or
  lazy.
- Avoid reparsing/reconverting project documents to obtain renderer models.
- Render selected layers from one prepared plan.
- Reuse interaction, connectivity, and spatial indexes.
- Version the worker protocol and minimize cloned result detail.
- Add progress/cancellation checks to archive/project parsing.
- Preserve exact S-expression and native export semantics.

The required 20-percent primary improvements are large synthetic board
parse/projection plus worker-clone cost and multi-layer PCB rendering from one
prepared plan.

## Testing

- Test-first common API, project, error, worker, and capability contracts.
- Differential parser and CircuitJSON projection tests.
- Existing native library/project/export/PCM/CLI/render/3D tests.
- Lazy-option and extension-retention tests.
- Synthetic parse, project, report, layer-render, query, interaction, and worker
  benchmarks.
- Complete KiCad suite plus relevant ECAD Forge integration tests.

## Documentation and Release Candidate

Update README, API, model-format, testing, scope, capabilities, and migration
documentation. Retain detailed native export documentation under the extension
surface while making the common examples match the other packages.

Prepare `kicad-toolkit@1.1.0` against exact `circuitjson-toolkit@1.1.0`.
Release notes prominently disclose breaking calls/results, preserved
KiCad-native features, dependency/license implications, and measured
performance results. Run `npm test`, `npm run check:format`,
`npm run benchmark`, `git diff --check`, lockfile/dependency checks,
packed-subpath import smoke tests, and `npm pack --dry-run`. The coordinated
release phase publishes only after the complete candidate matrix passes.

## Acceptance Criteria

- Parser output is a common envelope with pure valid CircuitJSON.
- KiCad-native parsing and reverse-export capabilities remain available.
- Shared query/schema/interaction behavior is no longer duplicated.
- Default parsing avoids unused raw/report graphs.
- Full tests and benchmark gates pass.
