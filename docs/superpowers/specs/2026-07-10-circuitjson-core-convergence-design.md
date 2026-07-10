<!--
SPDX-FileCopyrightText: 2026 André Fiedler

SPDX-License-Identifier: CC-BY-SA-4.0
-->

# CircuitJSON Core Convergence Design

## Goal

Make `circuitjson-toolkit` the fast, strict, source-neutral runtime shared by
all ECAD format toolkits. This is the first implementation workstream and
defines the contracts consumed by every later phase.

## Scope

- Synchronize the local schema snapshot to upstream `circuit-json@0.0.446`.
- Publish common document, project, error, diagnostic, capability, worker, and
  progress contracts.
- Add the canonical parser, project, renderer, query, manufacturing,
  simulation, scene3d, interaction, capabilities, extensions, testing, worker,
  and style
  entrypoints.
- Add `CircuitJsonDocumentContext` with request-scoped prepared indexes.
- Consolidate the byte-identical Altium/KiCad netlist-query behavior in this
  package through an authorized move or contract-driven reimplementation, then
  adapt it to standards-native CircuitJSON with documented legacy conversion
  outside the core.
- Generalize existing CircuitJSON BOM, manufacturing, interaction, diagnostic,
  SVG, and SPICE behavior behind the canonical service names.
- Add the shared API conformance harness used by all source toolkits.
- Add the machine-readable cross-package feature preservation ledger and checks
  that tie every baseline export, option, field, and behavior to a shared,
  native-extension, or unavailable disposition.

## Document Context

`CircuitJsonDocumentContext.prepare(document, options = {})` is synchronous and
accepts a `DocumentResult`, a CircuitJSON array, or an existing context. For an
existing context it preserves object identity while ensuring every newly
requested index exists.

The context owns:

- the read-only originating document envelope, source, extensions, and assets;
- validated elements;
- elements by type and stable id;
- relation, group, subcircuit, component, source-trace, and connectivity maps;
- renderer-neutral PCB primitives;
- physical and virtual layer models;
- primitive bounds and spatial lookup structures;
- lazily created BOM, diagnostics, manufacturing, support, and query models.

Preparation validates once and constructs each requested index at most once.
It does not use a process-global `WeakMap` for mutable caller arrays. A context
is discarded when its request/session owner releases it. Its model is immutable
for the context lifetime; caller mutation requires a new context.

Validation freezes schema-owned standard model values during the same traversal
so parser validation proofs cannot become stale before first context use.
Caller-supplied bare arrays are likewise frozen in place after validation.

When the input is an in-process parser result, preparation reuses the
envelope's runtime-only validation proof. Bare, serialized, and cross-thread
models are validated once during preparation because that proof is not
serialized or cloned.

## Validation and Extensions

`CircuitJsonDocument` strictly validates standard elements. Private
`altium_toolkit_*`, `kicad_toolkit_*`, or `gerber_toolkit_*` rows are rejected
as standard model elements. Native data belongs in the document envelope's
`extensions` object.

Schema synchronization produces a deterministic snapshot report containing
the upstream version, element types, identifier fields, and variant sets. The
runtime remains dependency-light and browser-safe; the upstream schema package
is a development/reference input, not an automatically loaded browser bundle.

Pin `circuit-json@0.0.446` exactly as a development/reference dependency. The
snapshot report records package/version, registry integrity checksum, source
URL, and license. `npm pack --dry-run`, packed-entrypoint tests, and a browser
dependency-graph test prove it is absent from runtime dependencies and browser
bundles unless a later design explicitly approves inclusion.

## Common Services

The core exposes:

- `Parser` for standalone CircuitJSON text and bytes;
- `ProjectLoader` for one or more named CircuitJSON inputs;
- `PcbSvgRenderer`, `SchematicSvgRenderer`, and `BomTableRenderer`;
- `PcbInteractionIndex` for reusable exact hit testing and picking;
- `QueryService` for repeated component/net/connectivity queries;
- `ManufacturingService` for placement, DSN, fabrication-note, and supported
  download models;
- `SimulationService` for compatible CircuitJSON/SPICE simulation data;
- data-only `PcbScene3dBuilder` and `PcbScene3dPreparator` interfaces without
  mounting Three.js runtime objects;
- `ToolkitCapabilities`, `ToolkitError`, and worker protocol utilities.

Existing uniquely named exports may be removed or renamed because this release
is intentionally incompatible. The migration guide maps every removed public
name to its canonical replacement or extension owner.

The only temporary root compatibility exports mandated for 1.1.x are
`CircuitJsonDocument`, `CircuitJsonIndexer`, and `CircuitJsonUnits`, because the
currently released `pcb-scene3d-viewer@1.1.50` imports them directly. They are
tested against the viewer's packed-consumer suite and documented as
noncanonical/deprecated.

Moving or adapting source-toolkit code requires a provenance record containing
repository, path, commit, copyright, and license. Copyright notices are
preserved, and SPDX/license changes require documented rightsholder authority.

## Performance

- Eliminate repeated `assertModel()` calls inside one parse/index operation.
- Pass prepared indexes into BOM, manufacturing, diagnostics, and support
  builders rather than rescanning through independent entrypoints.
- Allow renderers and interaction methods to consume a prepared context.
- Prepare one PCB render plan for all selected layers.
- Use request-scoped spatial indexes for repeated hit testing and geometry
  candidate lookup while retaining exact narrow-phase predicates.
- Keep derived reports lazy.
- Add benchmark cases for 50,000-element parsing/indexing, repeated hit tests,
  repeated netlist queries, multi-layer rendering, and context reuse.

The required 20-percent primary improvements are the 50,000-element
parse-plus-context path and the repeated query/hit-test context-reuse path.

## Testing

- Test-first schema, envelope, error, worker, capability, and entrypoint tests.
- Differential tests for existing CircuitJSON parse/render/manufacturing/SPICE
  output.
- Tests proving one validation and one index construction per context path.
- Shared conformance fixtures exported for source toolkit tests.
- Complete `npm test`, formatting check, package dry run, and benchmark report.

## Documentation and Release Candidate

Update README, API, model-format, testing, scope, capabilities, and migration
documentation. Document the runtime dependency/license implications for
downstream toolkits.

Prepare the `circuitjson-toolkit@1.1.0` candidate with a prominent breaking API
section. Run `npm test`, `npm run check:format`, `npm run benchmark`,
`git diff --check`, packed-subpath import smoke tests, and `npm pack --dry-run`.
The coordinated release phase publishes it only after the complete downstream
candidate matrix passes, then verifies tag, GitHub release, npm version, and npm
`gitHead` before any source toolkit publish.

## Acceptance Criteria

- The shared contracts are stable and tested before source toolkit migration.
- Standard models validate against the synchronized `0.0.446` snapshot.
- Private extension rows are rejected from the standard array.
- Context reuse removes repeated validation/index preparation.
- Existing meaningful CircuitJSON capabilities remain available through the
  canonical services.
- The full suite and benchmark gates pass.
