<!--
SPDX-FileCopyrightText: 2026 André Fiedler

SPDX-License-Identifier: CC-BY-SA-4.0
-->

# Cross-Toolkit API Convergence Design

## Status

Approved design for coordinated changes across:

- `circuitjson-toolkit`
- `gerber-toolkit`
- `altium-toolkit`
- `kicad-toolkit`
- `ecadforge_app`

The user explicitly approved incompatible public API names and return shapes,
requested CircuitJSON-centered internals and speed optimization, required all
unique capabilities to remain available, requested synchronized README and API
documentation, and requested minor-version releases whose notes call out the
breaking API changes.

This document is the umbrella contract. The bounded phase specifications in
this directory define repository-owned implementation scope.

## Motivation

The packages share coding conventions but not one public contract. Current root
exports range from 10 symbols in `gerber-toolkit` to 161 in
`altium-toolkit`. Identically named classes expose different methods,
parameters, defaults, side vocabularies, async behavior, and return values.

Altium and KiCad parse into native renderer models and then eagerly project a
second CircuitJSON graph. Both attach enumerable legacy properties to the
CircuitJSON array, retaining both graphs and making worker structured cloning
expensive. Gerber returns only its normalized CAM document. CircuitJSON parsing
uses a separate API and currently repeats full-model validation during one
parse. Generic netlist-query implementations are duplicated byte-for-byte in
Altium and KiCad.

The libraries also duplicate derived scans and rebuild interaction or render
indexes per operation. Large inputs pay for reports, raw records, decoded
assets, model metadata, and per-layer rerendering even when callers do not use
those results.

## Goals

- Define identical entrypoint layout, class names, method names, parameter
  shapes, result envelopes, diagnostics, and worker behavior across all four
  libraries.
- Make a valid CircuitJSON element array the only shared serializable model.
- Preserve every existing meaningful capability under either the shared core
  or an explicit format extension.
- Keep native source fidelity without representing private sidecars as standard
  CircuitJSON elements.
- Remove eager duplicate graphs and repeated validation/index construction.
- Provide request-scoped reusable contexts for rendering, querying, hit
  testing, manufacturing, diagnostics, and 3D preparation.
- Migrate ECAD Forge to the common contract and remove app-side compatibility
  workarounds that belong in libraries.
- Add reproducible correctness and performance verification.
- Publish coordinated minor releases with clear breaking-change migration
  notes.

## Non-Goals

- Do not make Gerber invent component, BOM, or netlist semantics absent from
  fabrication data.
- Do not move OLE, S-expression, aperture, native writer, or format-specific
  rendering logic into the shared core.
- Do not weaken geometry, validation, diagnostic, ordering, or source-fidelity
  behavior for speed.
- Do not add host UI state, file-picker wiring, interactive Three.js controls,
  or network providers to the libraries.
- Do not release any package before all repository-owned verification for that
  phase passes.

## Canonical Package Layout

Every library exposes the same common entrypoints:

```text
<package>
<package>/parser
<package>/project
<package>/renderers
<package>/interaction
<package>/query
<package>/manufacturing
<package>/simulation
<package>/scene3d
<package>/capabilities
<package>/extensions
<package>/testing
<package>/workers/parser.worker.mjs
<package>/styles/renderers.css
```

The package root is a compact high-level barrel. It does not re-export every
native parser helper or renderer internal. Source-specific public utilities are
reachable through `extensions` or additional documented format subpaths.
Every canonical class below is exported from both the package root and its
owning common subpath.

The common entrypoints export these canonical classes:

```js
Parser
ProjectLoader
CircuitJsonDocumentContext
PcbSvgRenderer
SchematicSvgRenderer
BomTableRenderer
PcbInteractionIndex
QueryService
ManufacturingService
SimulationService
PcbScene3dBuilder
PcbScene3dPreparator
ToolkitCapabilities
ToolkitError
```

All canonical entrypoints and classes resolve in every package. Capability
status is per operation, not per module. Hosts inspect `ToolkitCapabilities`
before offering optional operations; calling an unavailable operation still
throws `ERR_CAPABILITY_UNAVAILABLE` so an unchecked call cannot look like an
empty success.

## Parser Contract

### Input

All parsers use one input object:

```js
{
    fileName: string,
    data: string | ArrayBuffer | Uint8Array
}
```

Public methods:

```js
Parser.parse(input, options = {})
Parser.tryParse(input, options = {})
Parser.parseAsync(input, options = {})
Parser.supports(input)
```

Common options:

```js
{
    preserveRaw: false,
    decodeAssets: 'metadata',
    extensions: 'canonical',
    reports: [],
    retainSource: 'none',
    worker: 'auto',
    transferInput: false,
    signal: AbortSignal | undefined,
    onProgress: ((progress) => void) | undefined
}
```

`decodeAssets` is `'none' | 'metadata' | 'full'`. `extensions` is
`'none' | 'metadata' | 'canonical' | 'full' | string[]`; its default includes
the native structural data used by canonical services without unrelated reports,
raw bytes, or decoded payloads. Asset-dependent native fidelity additionally
requires decoded/retained/resolvable asset data. A string array selects
documented native feature ids. `extensions: 'full'` still excludes raw bytes
unless `preserveRaw` is true.
`reports` is an array of documented report ids, and `worker` is
`'auto' | true | false` for async calls. Synchronous calls reject
`worker: true`. `retainSource` is `'none' | 'reference'`; reference retention is
runtime-only, never duplicates the input, and forces `worker: 'auto'` to a
compatible direct path. `transferInput` applies only to async worker calls and
must be explicitly true before caller-owned buffers may be detached.
`Parser.supports()` performs bounded format detection without full parsing and
returns a boolean.

`parse()` is synchronous and throws `ToolkitError`. `parseAsync()` uses the
same result and error contract, may use a worker, observes cancellation, and
reports versioned progress stages. `tryParse()` converts every `ToolkitError`,
including unsupported input, into its failure branch; programmer errors outside
the public input contract and exceptions thrown by caller callbacks are not
silently swallowed.

### Document Result

Every successful parse returns:

```js
{
    schema: 'ecad-toolkit.document.v1',
    id: string,
    modelSchema: { name: 'circuit-json', version: '0.0.446' },
    model: CircuitJsonElement[],
    source: {
        format: 'circuitjson' | 'gerber' | 'altium' | 'kicad',
        fileName: string,
        fileType: string
    },
    extensions: Record<string, ToolkitExtension>,
    assets: ToolkitAsset[],
    diagnostics: ToolkitDiagnostic[],
    statistics: Record<string, number>
}
```

`model` is a pure CircuitJSON array without expando renderer fields. The result
envelope may contain native extension objects, but serializing `model` alone
always emits standards-shaped CircuitJSON.

Parser-created standard model arrays and their schema-owned nested values are
read-only and frozen during the same traversal that validates them. This keeps
the runtime validation proof sound without another scan. Preparing a caller-
supplied bare array validates and freezes its standard model graph in place;
callers that need mutation must pass their own copy.

`id` is stable within one project load and does not require hashing the whole
input. Standalone parsers derive it from normalized source identity; project
loaders deterministically disambiguate collisions.

Assets share this minimum shape:

```js
{
    id: string,
    kind: string,
    name: string,
    mediaType: string,
    byteLength: number,
    data: Uint8Array | string | null,
    source: object | null
}
```

`decodeAssets: 'none'` omits asset records, `'metadata'` returns `data: null`,
and `'full'` includes payloads. Each source parser owns exactly one top-level
extension key matching `source.format`; CircuitJSON documents use an empty
extension object unless caller-provided nonstandard data is explicitly wrapped
outside `model`.

Every source extension reserves `$meta`:

```js
{
    $meta: {
        schema: string,
        completeness: 'none' | 'metadata' | 'canonical' | 'full' | 'selected',
        included: string[],
        omitted: string[]
    },
    // Native fields follow.
}
```

With `extensions: 'none'`, the source namespace contains only `$meta` with
`completeness: 'none'`. Omitted native features are therefore explicit and can
be requested only by reparsing/reloading with the corresponding extension,
report, raw, or asset option. They are never represented as empty successful
data.

Asset metadata never hides a second payload copy in `extensions`. Decoding an
asset whose `data` is `null` requires a retained source reference, an injected
resolver, or reparsing with `decodeAssets: 'full'`; otherwise the operation
fails with `ERR_ASSET_DATA_REQUIRED`. Serialized and worker-cloned results never
carry runtime-only source references.

### Project Result

`ProjectLoader` mirrors the parser method style:

```js
ProjectLoader.load(entries, options = {})
ProjectLoader.tryLoad(entries, options = {})
ProjectLoader.loadAsync(entries, options = {})
ProjectLoader.supports(entries)
```

Entries are shaped as `{ name, data }`, with `data` using the parser input data
types. `load()` is synchronous. `loadAsync()` returns a promise, may use a
worker, and uses the same cancellation and progress behavior as `parseAsync()`.
`tryLoad()` uses the same discriminated success/error shape as `tryParse()`.
Successful loading returns:

```js
{
    schema: 'ecad-toolkit.project.v1',
    id: string,
    source: { format: string, entryNames: string[] },
    documents: DocumentResult[],
    project: {
        id: string,
        name: string,
        format: string,
        documentIds: string[],
        relationships: object[]
    } | null,
    extensions: Record<string, ToolkitExtension>,
    assets: ToolkitAsset[],
    diagnostics: ToolkitDiagnostic[],
    statistics: Record<string, number>
}
```

Loaders return partial successes with diagnostics. They throw when the input is
unsupported or no requested document succeeds.

Project-level `extensions`, `assets`, and `diagnostics` contain only project or
companion-entry data. Document-owned data remains on each `DocumentResult` and
is not duplicated. `ProjectLoader.supports()` returns a boolean using bounded
entry classification without parsing every entry.

Archive-capable loaders accept these common limits:

```js
{
    archiveLimits: {
        maxEntries: 4096,
        maxEntryBytes: 536870912,
        maxTotalBytes: 2147483648,
        maxCompressionRatio: 1000,
        maxArchiveDepth: 1
    }
}
```

Limits apply before or during inflation and failures use
`ERR_ARCHIVE_LIMIT_EXCEEDED`. Loaders classify by entry names, metadata, magic
bytes, and bounded candidate reads; they do not inflate every member merely to
detect a project. Ambiguous candidates are decoded incrementally in stable
entry-name order. Callers may lower limits but may not disable them with
non-finite values. Entry names normalize to safe relative POSIX paths; absolute
paths, NULs, traversal segments, and duplicate normalized paths fail with typed
archive errors. Nested archives are treated as ordinary assets after
`maxArchiveDepth` is reached.

## Common Consumer Contracts

Every consumer accepts a `DocumentResult`, a pure CircuitJSON array, or a
`CircuitJsonDocumentContext` as its first argument. This union is named
`DocumentInput` in documentation and JSDoc. Passing a prepared context reuses
its indexes. Passing another form prepares only the indexes needed by that
operation.

A bare CircuitJSON array has no source extension. Shared canonical behavior is
available, but a caller that explicitly requests native fidelity receives
`ERR_EXTENSION_DATA_REQUIRED`. A context retains the read-only originating
envelope, including `model`, `source`, `extensions`, and `assets`, so
source-native Gerber, Altium, and KiCad behavior remains available when the
context was created from a `DocumentResult`.

Canonical renderer methods are synchronous and deterministic:

```js
PcbSvgRenderer.render(document, options = {})
PcbSvgRenderer.renderLayers(document, options = {})
SchematicSvgRenderer.render(document, options = {})
BomTableRenderer.render(document, options = {})
```

The reusable `PcbRenderPlan` is an internal implementation detail behind
`PcbSvgRenderer`; consumers and source toolkits compose through the canonical
renderer facade and must not deep-import or forge prepared plans.

`PcbSvgRenderer` options use `side: 'top' | 'bottom'`, `layers`,
`fidelity: 'auto' | 'canonical' | 'native'`, and common SVG metadata/style
controls: `id`, `className`, `title`, `description`, `attributes`, and `style`.
`attributes` is a deterministic `data-*`/`aria-*` scalar map, while `style` is
a deterministic CSS custom-property map. The same controls apply to schematic
SVG output. `auto` uses native extension hooks when the envelope contains the
required data and otherwise renders canonical CircuitJSON. Explicit `native`
without the required extension fails with `ERR_EXTENSION_DATA_REQUIRED` rather
than approximating fidelity. `render()` returns one SVG string.
`renderLayers()` returns a serializable render set:

```js
{
    schema: 'ecad-toolkit.render-set.v1',
    items: [{ id, side, layerIds, svg }],
    diagnostics: ToolkitDiagnostic[],
    statistics: Record<string, number>
}
```

`SchematicSvgRenderer.render()` selects a sheet with `sheetId` and returns one
SVG string. It accepts the same `fidelity` option and native-data failure
behavior as the PCB renderer. `BomTableRenderer.render()` returns deterministic
HTML; structured BOM data is provided by `QueryService`, not parsed back from
markup.

Interaction follows one reusable index contract:

```js
const index = PcbInteractionIndex.create(document, options = {})
index.hitTest({ x, y }, options = {})
index.pick({ x, y }, options = {})
```

Coordinates are CircuitJSON millimeters and angles are degrees. `hitTest()`
returns ordered hit records, and `pick()` returns the highest-priority hit or
`null`. Hit records
contain stable element ids, primitive ids, side/layer data, bounds, and source
references; they do not expose renderer-private objects.

Queries use a bound service so repeated operations share connectivity indexes:

```js
const query = QueryService.create(document, options = {})
query.query(request, options = {})
query.findComponents(criteria = {}, options = {})
query.findNets(criteria = {}, options = {})
query.traceConnectivity(request, options = {})
query.buildNetlist(options = {})
```

Query methods return JSON-compatible records keyed by stable CircuitJSON ids.
Criteria support exact, contains, and regular-expression matching without
executing caller code. `query()` returns
`{ schema: 'ecad-toolkit.query.v1', items, diagnostics, statistics }`;
convenience methods return the corresponding `items` arrays. Connectivity
traces retain ordered path and endpoint records from the existing shared
netlist-query feature set.

Manufacturing and simulation use discoverable export contracts:

```js
ManufacturingService.inspect(document, options = {})
ManufacturingService.listExports(document, options = {})
ManufacturingService.export(document, request, options = {})
SimulationService.build(document, options = {})
SimulationService.export(document, request, options = {})
SimulationService.run(document, request, options = {})
```

`inspect()` returns
`{ schema: 'ecad-toolkit.manufacturing.v1', placements, fabricationNotes,
exports, diagnostics, statistics }`. `listExports()` returns records shaped as
`{ id, format, mediaType, fileExtension, status, reason }` for formats such as
BOM, pick-and-place, DSN, fabrication notes, and source-native CAM outputs.
`export()` accepts `{ id, options }` and returns
`{ fileName, mediaType, data, diagnostics }`, where `data` is a string or
`Uint8Array`.

`SimulationService.build()` returns
`{ schema: 'ecad-toolkit.simulation.v1', circuits, analyses, models,
diagnostics, statistics }`. Simulation export uses the same `{ id, options }`
request and file result. `run()` accepts `{ analysisId, parameters }`; its
options require an injected `engine` and may contain `signal` and `onProgress`.
It resolves
`{ schema: 'ecad-toolkit.simulation-result.v1', status, traces, measurements,
diagnostics, statistics }`. Toolkits do not implicitly start a process or use a
network simulation service. `run()` is available only when the injected engine
supports the requested analysis. Unsupported exports and simulation operations
throw `ERR_CAPABILITY_UNAVAILABLE` rather than returning empty placeholders.

3D methods return data-only scene descriptions and never mount host UI objects:

```js
PcbScene3dBuilder.build(document, options = {})
PcbScene3dPreparator.prepare(document, options = {})
```

Both scene methods accept the renderer `fidelity` option. Explicit native
fidelity requires the relevant extension and asset data; canonical mode uses
only CircuitJSON, and auto mode selects the highest fully available path.

`build()` is synchronous and returns
`{ schema: 'ecad-toolkit.scene3d.v1', units: 'mm', coordinateSystem,
board, components, pads, tracks, vias, zones, texts, objects, materials,
assets, externalPlacements, diagnostics, statistics }`. The coordinate system
is right-handed, Z-up, with the top board side facing positive Z. `prepare()` is
asynchronous, supports `signal`/`onProgress`, resolves requested external or
embedded assets, and returns the same scene schema. External resolution is
dependency-injected as `resolveAsset(request, { signal })`; toolkits perform no
implicit filesystem or network access. Both methods preserve source-native
placement metadata in extension references while using CircuitJSON
millimeters/degrees and `top`/`bottom` sides in the shared scene.

These common method names, argument positions, option names/defaults,
sync/async rules, minimum result fields, empty behavior, and error behavior are
normative conformance data. A source package may add native behavior only under
its extension surface. A new source-neutral option, method, or result field
lands in the shared contract and all four package facades together; it is not
introduced unilaterally.

## CircuitJSON Core Ownership

`circuitjson-toolkit` owns source-neutral behavior:

- the pinned CircuitJSON schema snapshot and synchronization report;
- strict model validation and schema/version metadata;
- element, relation, connectivity, primitive, layer, and spatial indexes;
- document contexts and reusable derived models;
- generic BOM, manufacturing, diagnostics, support, and simulation services;
- generic schematic and PCB SVG foundations;
- generic interaction, hit-test, selection, and netlist-query behavior;
- common error, diagnostic, capability, worker, and benchmark contracts.

The core owns source-neutral preparation, schemas, indexes, and rendering
primitives. Each source toolkit owns its canonical renderer facade and composes
the shared canonical renderer foundation with native extension hooks; the
internal render plan is not a source-toolkit integration boundary. Gerber
ordering/polarity, native typography, Altium/KiCad fidelity rules, and source
placement policies are never approximated or moved into the core.

The initial schema synchronization target is upstream `circuit-json` version
`0.0.446`. Runtime code remains optimized for browser use; synchronization may
use the upstream package as a development-time reference without forcing its
multi-megabyte distribution into browser entrypoints.

The three source-format packages consume `circuitjson-toolkit` as the shared
runtime. The default npm dependency is distributed under
AGPL-3.0-or-later. A commercial alternative requires a separate agreement that
expressly covers `circuitjson-toolkit`; repository wording is not itself a
commercial license grant. Before publishing, each package records a
license-compliance review and updates README, NOTICE, dependency metadata,
packed notices, and release notes. Existing package-specific license statements
are not silently rewritten.

Every implementation moved or adapted into the core records source repository,
path, commit, copyright, and license. SPDX headers and license terms change only
with documented authorization from the relevant rightsholder. Where authority
or compatibility is unclear, behavior is reimplemented from the approved
contract and independent tests rather than copied.

## Extension Ownership

Extensions preserve meaningful native behavior that cannot be expressed
losslessly in standard CircuitJSON.

### Gerber

- ordered files and layers;
- dark/clear polarity sequence;
- apertures, macros, blocks, transforms, and step-repeat provenance;
- Excellon tools, hits, routes, slots, and plating provenance;
- file, aperture, and object attributes;
- source-faithful composite and separated CAM rendering data.

### Altium

- OLE/native streams, raw record registries, and binary diagnostics;
- SchDoc/PcbDoc/SchLib/PcbLib/IntLib/PrjPcb/PrjScr/PCBDwf metadata;
- native library writers and source-component export workflows;
- layer-stack, rule, union, pad/via, rigid-flex, Draftsman, and project data;
- embedded font/image/model payload metadata;
- format-specific visual fidelity and 3D placement policies.

### KiCad

- S-expression AST and native board/schematic metadata;
- project, library, PCM, jobset, DRU, worksheet, and legacy formats;
- CircuitJSON-to-KiCad project/library/module exporters;
- KiCad layer, pad-stack, stroke-font, model-path, WRL, and CLI behavior.

### CircuitJSON

- standards-native schema, validation, indexing, simulation, and export
  utilities that do not depend on a native ECAD source format.

## Capability Parity

`ToolkitCapabilities.inventory(options = {})` returns records with this common
shape:

```js
{
    id: string,
    category: string,
    operation: string,
    status: 'native' | 'shared' | 'derived' | 'unavailable',
    entrypoint: string,
    summary: string,
    reason: string,
    tested: boolean,
    documented: boolean
}
```

`id` is the stable `${category}.${operation}` capability id used by service
requests and host gating.

A feature present in one package is generalized into the shared core when its
semantics are meaningful for CircuitJSON. It remains a native extension when
the source format is essential. Inapplicable features are reported as
`unavailable`; they are not faked with empty data. Calling an unavailable
operation throws `ERR_CAPABILITY_UNAVAILABLE`.

## Feature Preservation Ledger

Before implementation, each repository freezes a machine-readable inventory of
its public exports, public methods, accepted options, documented result fields,
worker messages, and observable behaviors at the baseline commit. The combined
ledger has one record per feature:

- `circuitjson-toolkit@1.0.17`
- `gerber-toolkit@0.1.21`
- `altium-toolkit@1.1.41`
- `kicad-toolkit@1.0.29`

```js
{
    package: string,
    feature: string,
    kind: 'export' | 'method' | 'option' | 'field' | 'behavior',
    capabilityId: string,
    disposition: 'shared' | 'native-extension' | 'unavailable',
    replacement: string,
    availability: Record<string, 'native' | 'shared' | 'derived' | 'unavailable'>,
    reason: string,
    tests: string[],
    documentation: string[]
}
```

No baseline feature may disappear without a ledger record and migration entry.
If its semantics can be derived from CircuitJSON, the shared core implements it
and every package exposes it as `shared` or `derived`. If the source format is
required, the owner retains it under its extension surface and other packages
report `unavailable` with a concrete reason. The conformance suite verifies the
ledger against entrypoints, capability inventories, tests, and documentation.

## Error and Diagnostic Contract

All public failures use `ToolkitError` with:

```js
{
    code: string,
    category: 'parse' | 'validation' | 'unsupported' | 'cancelled' | 'runtime',
    message: string,
    format: string,
    source: string,
    location: object | null,
    details: object,
    cause: { name: string, message: string, code: string | null } | null
}
```

The public `cause` is clone-safe. Implementations may retain the original native
error in a non-enumerable runtime-only field, but it is not part of the worker
or JSON contract.

Diagnostics use:

```js
{
    code: string,
    severity: 'info' | 'warning' | 'error',
    message: string,
    source: string,
    location: object | null,
    details: object
}
```

`tryParse()` returns `{ ok: true, value }` or
`{ ok: false, error, diagnostics }`. Direct and worker parsing normalize the
same error into the same fields. Unsupported worker messages, malformed ZIPs,
and cancellation are never silently ignored.

## Naming and Behavior Rules

- Public options use camelCase.
- PCB sides are `top` and `bottom`.
- Options are always the final optional object.
- Sync methods return values; async methods always return promises.
- `render()` methods return deterministic strings.
- `build()` methods return deterministic data-only models.
- `prepare()` methods perform meaningful async preparation rather than merely
  wrapping a synchronous call when the owning class is a `Preparator` or the
  method resolves assets. `CircuitJsonDocumentContext.prepare()` is the named
  synchronous context factory and is the sole common exception.
- Empty valid input produces a documented empty result; invalid or unsupported
  input produces a typed error.
- Previous undocumented aliases, snake-case options, `front`/`back` side
  values, hybrid arrays, and inconsistent empty/error behavior are not part of
  the new contract. The three explicitly documented viewer-compatibility
  exports are temporary exceptions, not canonical aliases.

## Data Flow and Performance

Each source parser follows:

```text
input
  -> native decode
  -> option-selected native extension data with lossless retained facts
  -> CircuitJSON projection
  -> one parse validation
  -> DocumentResult
```

`CircuitJsonDocumentContext.prepare(document, options = {})` creates a
request-scoped reusable context after parsing. It performs one context
validation and prepares only requested indexes or derived models. Renderers,
queries, hit tests, manufacturing, and 3D builders accept either a document
result or a prepared context and reuse the same context throughout one host
operation.

A parser-created in-process `DocumentResult` carries a runtime-only validation
proof on the envelope, never on `model`. Context preparation reuses that proof
and does not scan the model again. The proof is intentionally absent after JSON
serialization or worker structured cloning, so a deserialized or cross-thread
document is validated once when its first context is prepared. A bare array is
also validated once. The context owns the proof and caches; no process-global
mutable-model cache is introduced.

Performance requirements:

- no eager renderer-model plus CircuitJSON duplication;
- no repeated full validation inside one parse or context preparation;
- no eager raw/base64 payload retention unless `preserveRaw` requests it;
- no eager full asset decoding unless `decodeAssets` requests it;
- no eager QA/report families unless listed in `reports`;
- one prepared render plan for multi-layer SVG output;
- reusable interaction and spatial indexes for repeated hit testing;
- reusable connectivity indexes for repeated queries;
- worker output omits extension graphs not requested by the caller;
- cancellation and progress checks occur at natural parser/loader phases;
- no process-global mutable-model cache.

An extension is not a renamed second renderer graph. Altium and KiCad
extensions retain only source-native facts, relationships, and references that
cannot be reconstructed from CircuitJSON. Gerber may retain ordered native CAM
operations that geometrically overlap the CircuitJSON projection because dark/
clear polarity and aperture state are not losslessly representable; the feature
ledger enumerates that deliberate duplication.

## Worker Protocol

All parser workers implement `ecad-toolkit.worker.v1`. Requests and responses
are structured-cloneable and use these message shapes:

```js
{ protocol, type: 'parse', requestId, input, options }
{ protocol, type: 'loadProject', requestId, entries, options }
{ protocol, type: 'cancel', requestId }
{ protocol, type: 'progress', requestId, progress }
{ protocol, type: 'result', requestId, value }
{ protocol, type: 'error', requestId, error, diagnostics }
```

`requestId` is an opaque non-empty string. Progress is
`{ stage, completed, total, message }`, where `total` may be `null` when unknown;
`stage` is stable and versioned with the protocol. Host facades translate
`AbortSignal` into `cancel` and progress
messages into the caller's `onProgress` callback. Neither the signal nor the
callback is posted to the worker. Results match direct parsing/loading exactly
apart from runtime-only validation proofs, and errors are serialized
`ToolkitError` fields. Transferable internally owned output buffers use transfer
lists. Caller-owned input buffers transfer only with `transferInput: true`; the
default never detaches caller data. A typed-array view never transfers a larger
shared backing buffer that would detach unrelated caller bytes; the worker
facade copies the selected view when necessary.

Spatial acceleration is a broad phase only. Exact source predicates, geometry,
ordering, and diagnostic decisions remain authoritative.

Every repository exposes `npm run benchmark` and checks in a versioned baseline
report before production changes. The report records baseline Git ref, fixture
checksum, OS/CPU/runtime, warmup count, sample count, median time, result or
worker-clone bytes, and retained-heap observations. Primary large-input hotspots
named by each phase must reduce median time by at least 20 percent on the same
machine/runtime. Other large-input medians may not regress by more than 5
percent, and small-input medians may not regress by more than 10 percent.
Default structured-clone/result bytes may not grow; cases that remove a duplicate
native/CircuitJSON graph must shrink them by at least 25 percent. Heap numbers
are reported and investigated but are not a flaky pass/fail gate. Timing budgets
and raw samples live in benchmark reports rather than correctness tests.
Before production edits, each checked-in baseline marks the phase-named cases
`primary: true`; implementation may not select qualifying cases after seeing
results.

## ECAD Forge Integration

ECAD Forge replaces format-specific method branching with an adapter registry.
Each registered toolkit supplies the same parser, project loader, renderers,
query service, manufacturing service, capability inventory, and scene builder
interfaces.

The app stores `DocumentResult` objects and request-scoped prepared contexts.
Views read `document.model`; source-specific panels read
`document.extensions[format]`. The migration removes app-owned side vocabulary
conversion, duplicated netlist services, format-specific parser result
normalization, bounds repair, and compatibility-renderer-model workarounds once
the owning library provides the general behavior.

The app retains source-format detection and host orchestration. It does not
absorb parser, renderer, or native-extension logic.

## Testing Strategy

All production behavior changes follow test-first development. Fixtures remain
small, synthetic, repo-owned, and source-obfuscated.

Required verification layers:

1. `circuitjson-toolkit/testing` publishes versioned
   `runToolkitContract(toolkit, options)` and synthetic fixture exports. Shared
   API contract tests import that packed subpath and run against all four
   packages.
2. Public entrypoint snapshots pin names and subpath layout.
3. Parser tests pin input, result, error, cancellation, and progress behavior.
4. Schema tests verify pure CircuitJSON and extension separation.
5. Differential tests preserve native parse and deterministic render output.
6. Context tests prove validation/index preparation is not repeated.
7. Worker protocol tests cover browser and Node-compatible handling where
   supported.
8. Synthetic benchmarks measure parse, projection, query, interaction,
   multi-layer render, and worker-clone costs.
9. Each library runs its complete repository-owned `npm test` command.
10. ECAD Forge runs its complete suite, structured-data check, static build,
    and browser sanity checks for all four formats.

## Documentation

Each library updates:

- root `README.md`;
- `docs/api.md`;
- `docs/model-format.md`;
- `docs/testing.md`;
- capabilities documentation;
- `docs/migration.md`, generated or checked against the preservation ledger,
  with old-to-new mappings for every baseline export, method, option, field,
  behavior, hybrid property, and side alias;
- package scope when ownership moves.

CI fails when a baseline ledger row lacks a documented disposition or when a
retained mapping lacks a differential/contract test.

Common examples are textually identical except for package names. Native
extension documentation lists retained capabilities and explicitly states what
cannot be reconstructed from the source format.

ECAD Forge updates its architecture, testing, and troubleshooting documentation
to describe document envelopes, contexts, and the toolkit registry.

## Version and Release Plan

Requested minor versions:

| Package | Current | Release |
| --- | --- | --- |
| `circuitjson-toolkit` | `1.0.17` | `1.1.0` |
| `gerber-toolkit` | `0.1.21` | `0.2.0` |
| `altium-toolkit` | `1.1.41` | `1.2.0` |
| `kicad-toolkit` | `1.0.29` | `1.1.0` |
| `ecadforge_app` | `1.9.28` | `1.10.0` |

The user explicitly requested minor bumps despite incompatible API changes.
Release notes therefore use a prominent `Breaking API convergence` section,
show old-to-new imports and calls, explain the new result envelope, identify
retained extensions, and summarize verified performance changes.

Before any stable publish, create candidate tarballs with `npm pack` for the
core and all three source toolkits. Install the core tarball into each source
toolkit and every direct workspace consumer. Install the complete candidate set
together into ECAD Forge, run clean-install dependency checks, and run all
downstream shared-contract, full-suite, and app release gates. Registry
publication starts only after this candidate matrix passes.

`pcb-scene3d-viewer@1.1.50` is an in-scope compatibility consumer but not an
additional requested release. `circuitjson-toolkit@1.1.x` therefore retains and
tests deprecated compatibility exports for its current direct imports:
`CircuitJsonDocument`, `CircuitJsonIndexer`, and `CircuitJsonUnits`. The viewer
suite runs against the packed 1.1.0 candidate. These aliases are noncanonical
and may be removed only after a separately authorized viewer migration/release.

Release dependency DAG:

1. Publish and verify `circuitjson-toolkit@1.1.0` after the candidate matrix.
2. Pin the verified core exactly, then publish and verify Gerber, Altium, and
   KiCad independently in any order.
3. Pin all four verified toolkit versions exactly in ECAD Forge, commit the
   lockfile, and prove `npm ls circuitjson-toolkit` resolves one compatible
   `1.1.0` instance for the app and viewer.
4. Run app release gates, push `main`, create the release, and watch
   `Deploy to FTP (main)` to conclusion `success`.

Each source toolkit declares exact `circuitjson-toolkit@1.1.0`; ECAD Forge uses
exact versions for all deliberately incompatible toolkit releases. Every
package commits its updated lockfile and passes a clean `npm ci` before publish
or deployment.

For every npm package, local version, package-lock version, Git commit, tag,
GitHub release, npm version, and npm `gitHead` must agree. A tag or GitHub
release without a successful publish is a partial release. ECAD Forge is not
reported deployed until the final workflow succeeds.

If any publish or parity check fails, stop downstream releases and keep ECAD
Forge on its previously verified lockfile. Never reuse a published version;
repair with a new patch release, record the exact partial state, and resume only
after npm, Git tag, GitHub release, and npm `gitHead` agree.

## Workstream Decomposition

Implementation proceeds in dependency order:

1. `2026-07-10-circuitjson-core-convergence-design.md`
2. `2026-07-10-gerber-toolkit-convergence-design.md`
3. `2026-07-10-altium-toolkit-convergence-design.md`
4. `2026-07-10-kicad-toolkit-convergence-design.md`
5. `2026-07-10-ecadforge-integration-release-design.md`

Altium and KiCad may execute in parallel after the CircuitJSON core contract is
stable. Gerber may also execute in parallel after the adapter/context contract
lands. ECAD Forge integration and releases wait for all library workstreams.

## Acceptance Criteria

- All four libraries expose the canonical entrypoint and behavior contract.
- Pure parser models validate as CircuitJSON `0.0.446` without private element
  types.
- Every previous meaningful feature is shared, retained as an extension, or
  explicitly classified unavailable with a reason.
- Every baseline ledger row has a tested and documented disposition.
- No parser returns a hybrid CircuitJSON/renderer-model array.
- Direct and worker parsing return equivalent envelopes and errors.
- Prepared contexts eliminate repeated validation and derived-index work within
  one operation.
- Correctness suites, differential tests, and repository suites pass.
- Benchmarks meet the stated large/small input requirements.
- README, API, model, testing, capabilities, migration, and app documentation
  are current.
- ECAD Forge consumes the new APIs for all four formats.
- All five requested minor releases are published and verified in dependency
  order.
- The ECAD Forge deployment workflow concludes successfully.
