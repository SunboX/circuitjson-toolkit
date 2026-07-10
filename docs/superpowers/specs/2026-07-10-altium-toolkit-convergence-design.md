<!--
SPDX-FileCopyrightText: 2026 André Fiedler

SPDX-License-Identifier: CC-BY-SA-4.0
-->

# Altium Toolkit Convergence Design

## Goal

Migrate `altium-toolkit` to the shared API, remove hybrid CircuitJSON arrays and
duplicated generic services, retain every native Altium capability as an
explicit extension, and reduce eager parsing/rendering costs.

## Parser and Extension Boundary

Native decoding remains responsible for OLE, binary/ascii streams, schematic,
PCB, libraries, projects, Draftsman, raw records, embedded payloads, and native
diagnostics. The parser returns pure CircuitJSON plus `extensions.altium`.

The current shallow `CircuitJsonModelSchema`, enumerable renderer-model array
properties, non-enumerable `rendererModel`, and private custom CircuitJSON rows
are replaced by the shared validator and explicit extension envelope. Standard
elements must pass the shared schema; native reports and sidecars remain fully
available in `extensions.altium` when their documented options request them.

Native SchLib/PcbLib writers, batch export, source-component client, binary
helpers, report builders, layer/rule/rigid-flex metadata, embedded assets, and
3D placement policies stay public through `altium-toolkit/extensions` and
focused native subpaths.

## Missing Common Capabilities

Implement the previously designed but absent `ProjectLoader`, capability
inventory, and readiness behavior through the common project and capabilities
contracts. Project loading supports named entries and archives, partial parse
diagnostics, companion assets, and conservative project-reference matching.

Delete the duplicated generic netlist-query implementation after switching the
public query entrypoint to `circuitjson-toolkit`. Generic BOM, interaction,
schema, diagnostics, and renderer foundations use the shared core; Altium
fidelity hooks remain native.

## Performance

- Route by reliable file evidence before broad printable scans where possible.
- Avoid duplicate all-stream maps and repeated stream reconstruction.
- Make raw byte slices, base64 records, QA reports, route/review/statistics,
  embedded payload decoding, and STEP bounds opt-in or lazy.
- Reduce model-registry linear scans with prepared lookup maps.
- Use spatial candidate indexes for 3D body/component matching without changing
  exact placement policies.
- Render multiple layers from one prepared plan.
- Reuse interaction indexes for hit testing and selection.
- Worker responses omit native graphs and decoded payloads unless requested.

The required 20-percent primary improvements are large synthetic PcbDoc
parse/projection plus worker-clone cost and multi-layer PCB rendering from one
prepared plan.

## Testing

- Test-first common parser/project/error/worker/capability contract coverage.
- Differential CircuitJSON projection and native extension coverage.
- Existing deterministic schematic, PCB, BOM, library, export, and 3D tests.
- Lazy-option tests proving omitted work stays omitted and requested features
  retain current data.
- Synthetic parse, stream, report, layer-render, model-registry, interaction,
  and worker-clone benchmarks.
- Complete Altium suite plus relevant ECAD Forge integration tests.

## Documentation and Release Candidate

Update README, API, model-format, testing, scope, capabilities, and migration
documentation. The migration guide lists old root/parser/renderer exports and
their canonical or extension replacements.

Prepare `altium-toolkit@1.2.0` against exact `circuitjson-toolkit@1.1.0`.
Release notes prominently disclose the breaking result/API changes, retained
native extensions, dependency/license implications, and measured performance
results. Run `npm test`, `npm run check:format`, `npm run benchmark`,
`git diff --check`, lockfile/dependency checks, packed-subpath import smoke
tests, and `npm pack --dry-run`. The coordinated release phase publishes only
after the complete candidate matrix passes.

## Acceptance Criteria

- Parser output is a common envelope with pure valid CircuitJSON.
- No Altium-native capability is discarded.
- Shared behavior is no longer duplicated in this repository.
- Default parsing avoids unused raw/report/asset work.
- Full tests and benchmark gates pass.
