<!--
SPDX-FileCopyrightText: 2026 André Fiedler
SPDX-License-Identifier: CC-BY-SA-4.0
-->

# Canonical API

Version 1.1.0 exposes one common API contract for `circuitjson-toolkit`,
`gerber-toolkit`, `altium-toolkit`, and `kicad-toolkit`. CircuitJSON is the
shared immutable model. Every common service accepts a canonical
`DocumentResult`, its `model` array, or a prepared `CircuitJsonDocumentContext`
unless a narrower input is stated below.

The 1.1.0 convergence is intentionally breaking. Use the canonical classes in
this document for new code. Thirty-seven previous CircuitJSON-specific classes
remain under `circuitjson-toolkit/extensions`; the three documented viewer
compatibility classes remain on the root. See [migration.md](migration.md).

### `SelfAdjustingComputation`

The root API exports the shared synchronous change-propagation runtime used by
ECAD Forge and reusable toolkit consumers. It records dynamic property reads
for stable named computations, maintains reverse reader lists, validates only
the traces reached from explicit changed roots, and replaces stale control-flow
dependencies after re-execution.

```js
import { SelfAdjustingComputation } from 'circuitjson-toolkit'

const runtime = new SelfAdjustingComputation()
const results = runtime.propagate(
    { locale: 'en', status: 'ready' },
    [['status']],
    [
        {
            name: 'status-label',
            computation: (state) => state.locale + ':' + state.status
        }
    ]
)
```

Computations must be synchronous and treat their tracked input as read-only.
`forget(name)` reclaims one trace, `clear()` reclaims the graph, and
`getStatistics()` exposes bounded trace counts. Plain objects and arrays are
traversed; non-plain objects are atomic identity dependencies unless the
constructor's `isAtomic(value, path)` option selects an earlier boundary.
Callers must supply conservative changed paths and test propagated results
against a fresh execution for the same input.

## Common conventions

### Document input

Parser calls use an input record:

```js
{
    fileName: 'board.json',
    data: string | ArrayBuffer | Uint8Array,
    assets?: object[]
}
```

`Parser.parse()` and `Parser.parseAsync()` return the exact
`ecad-toolkit.document.v1` envelope:

```js
{
    schema: 'ecad-toolkit.document.v1',
    id: 'document-...',
    modelSchema: { name: 'circuit-json', version: '0.0.446' },
    model: [],
    source: { format: 'circuitjson', fileName: 'board.json', fileType: 'circuitjson' },
    extensions: {},
    assets: [],
    diagnostics: [],
    statistics: {}
}
```

The shared fields have the same names and meanings in every source toolkit.
Source-only facts belong in `extensions.<format>` and are never discarded to
make the common shape smaller.

Validated source documents own selected extension values as one deeply
immutable, descriptor-safe snapshot. This uses a distinct 128 MiB payload and
4,000,000-item ceiling so large native renderer graphs do not inherit the
compact metadata limit. The shared worker protocol applies the same ownership
boundary after structured cloning. Canonical standalone documents retain a
250 MB byte ceiling; exact multi-document projects use a 256 MiB aggregate
ceiling with independent 250 MB document and project-metadata limits. Binary
values preserve their `ArrayBuffer`/typed-view shape behind defensive copy
access, so payload bytes do not inflate into one JavaScript number per byte.

### Errors

Public failures are `ToolkitError` instances. The stable serialized fields are
`name`, `message`, `code`, `category`, `format`, `source`, `details`, and
`cause`. `error.toJSON()` produces a clone-safe record. `ToolkitError.from()`
normalizes an unknown failure without invoking hostile accessors.

### Progress, cancellation, and workers

Asynchronous parser and project calls accept:

- `signal`: an `AbortSignal`;
- `onProgress(progress)`: ordered clone-safe progress rows;
- `worker`: `false`, `true`, or `'auto'`;
- `transferInput`: explicit permission to detach transferable caller input.

`worker: 'auto'` falls back to direct work only when worker construction is
unavailable. Protocol, post-message, parser, and runtime errors stay visible.
Worker and direct results have the same serialized shape.

Requests waiting behind active worker work take ownership immediately after
admission. The default mode clones the exact binary graph into a private queue
snapshot and leaves caller buffers intact. `transferInput: true` detaches exact
transferable buffers at admission; partial views, resizable buffers, and
shared buffers are isolated without detaching unrelated caller bytes.

`retainSource` is exactly `'none' | 'reference'` and defaults to `'none'`.
`'reference'` is an in-process parser option: the returned document has a
non-enumerable `sourceReference` property whose value is the exact caller input
object. The toolkit neither freezes nor copies that caller object, and
serialization or structured cloning intentionally omits the reference.
`worker: true` rejects this mode because cross-thread caller identity cannot be
preserved; `worker: 'auto'` selects the direct path instead.

### Reusing work

Prepare a context once when several operations use the same document:

```js
const context = CircuitJsonDocumentContext.prepare(document, {
    indexes: ['elements', 'relations', 'connectivity', 'spatial']
})
```

Validation, indexes, render primitives, and other derived values are cached by
the context. Public outputs remain detached or immutable; a caller cannot
mutate later results through a returned object.

Hosts that receive a document from the platform structured-clone algorithm may
use the explicit provenance-aware entry point:

```js
const context = CircuitJsonDocumentContext.prepareStructuredClone(
    message.data,
    {
        indexes: ['elements', 'relations']
    }
)
```

`prepareStructuredClone()` has the same options, return type, validation,
ownership, limits, and derived-cache behavior as `prepare()`. It avoids
exception-driven raw-buffer brand checks for ordinary objects by relying on the
standard local prototypes guaranteed by a completed platform structured clone.
Use it only for the exact structured-cloned result (or a graph created entirely
by the toolkit after that boundary). Use `prepare()` for arbitrary caller-owned,
cross-realm, proxy-backed, or prototype-modified input. The general path keeps
intrinsic binary slots authoritative and preserves altered-prototype
`ArrayBuffer`, `SharedArrayBuffer`, typed-array, and `DataView` values.

To split model validation and extension sealing across host tasks, use the
cooperative equivalent:

```js
const context = await CircuitJsonDocumentContext.prepareStructuredCloneAsync(
    message.data,
    {
        indexes: ['elements', 'relations'],
        ownership: 'exclusive',
        yield: () => scheduler.yield()
    }
)
```

`ownership: 'exclusive'` is mandatory. It transfers the exact platform
structured-clone graph destructively; the caller must relinquish all aliases
and shared-memory writers until the promise settles. The optional `yield`
callback is awaited after model validation and repeatedly between bounded
slices of dense-array traversal, Map/Set normalization, immutable text
accounting, binary copying and installation, and property locking. Individual
plain extension records are limited to 16,384 properties on this path.

Existing `CircuitJsonDocumentContext` inputs are already immutable and are
reused immediately without an ownership declaration. During a new transfer,
ordinary extension records retain their identity. Dense arrays are normalized
into clean arrays while retaining graph aliases and cycles, so non-clone hidden
properties cannot leave mutable state in the prepared context.

Acquired containers are shape-locked and their descriptors are checked during
sealing. This is not a transactional snapshot of retained aliases: a caller
that violates exclusive ownership can change a node before it is acquired, and
a rejected transfer may leave part of the graph locked. Without an injected
callback the method uses `scheduler.yield()` when available, then falls back to
a zero-delay host task. The promise resolves to the same prepared context
returned by the synchronous methods, including the same requested indexes and
cache behavior. Use `prepareStructuredClone()` for uninterrupted same-thread
adoption or `prepare()` for arbitrary caller-owned graphs.

## Root entrypoint

`circuitjson-toolkit` has an exact 18-class root. The 15 canonical classes are:

- `Parser`
- `ProjectLoader`
- `CircuitJsonDocumentContext`
- `PcbSvgRenderer`
- `SchematicSvgRenderer`
- `BomTableRenderer`
- `PcbInteractionIndex`
- `QueryService`
- `ManufacturingService`
- `SimulationService`
- `PcbScene3dBuilder`
- `PcbScene3dPreparator`
- `SelfAdjustingComputation`
- `ToolkitCapabilities`
- `ToolkitError`

`CircuitJsonDocument`, `CircuitJsonIndexer`, and `CircuitJsonUnits` remain
temporarily on the root for viewer compatibility. All other former root
exports are explicitly retained by `/extensions`.

### `CircuitJsonDocument.normalizeModel(model, options?)`

Projects supported pre-union aliases onto the canonical element union. The
default copy-on-write call preserves the exact input and element identities
when no projection is needed. `{ owned: true }` may update a toolkit-owned
mutable model in place before its single validation/proof pass.

The canonical union is the pinned upstream schema plus the source-neutral
`schematic_image` and `schematic_sheet_symbol` contracts. Use
`CircuitJsonElementValidator.knownElementTypes()` for the exact upstream
snapshot, `canonicalElementTypes()` for all accepted types, and
`extensionElementTypes()` for the toolkit-owned additions.

Pinned PCB text rows may also retain the validated source-fidelity fields
`font_width`, `font_height`, `stroke_width`, `source_anchor_alignment`,
`is_hidden`, `source_layer`, `source_type`, and `source_text_kind`. Board note
rotation uses `ccw_rotation`; fabrication note mirroring uses `is_mirrored`.
Canonical upstream properties remain authoritative when they exist. In
particular, `pcb_note_text.anchor_alignment` keeps the narrower upstream enum,
while `source_anchor_alignment` can preserve the exact nine-position source
anchor for lossless rendering.

The projection covers legacy schematic table row/column/span geometry, PCB
artwork `points`/`width` paths, pad-clearance diagnostic relations, courtyard
line/path/polygon forms, outer-layer aliases, and retained stroke dash fields.
It derives geometry from the supplied data and does not recognize filenames,
fixtures, vendors, or application state.

### `CircuitJsonPcbHolePrimitiveModel.build(element, center)`

Normalizes circular, rectangular, pill, and polygon-plated holes for shared
rendering and interaction consumers. Polygon `pad_outline` points determine
rotation-local outer width and height; pill drill width, height, diameter, and
board-space rotation remain distinct from outer-pad rotation. Legal
`outer_width`, `outer_height`, `rect_ccw_rotation`, and `hole_ccw_rotation`
variants are preserved. The returned geometry includes the parsed rectangular
`cornerRadius`. Rotated rectangular bounds use the exact visible
rounded-rectangle support dimensions, with the effective radius clamped from
zero through half the smaller outer dimension. A zero radius therefore retains
sharp-rectangle bounds, while a half-minor-dimension radius has the same support
extent as a pill. Import this retained source-neutral helper from
`circuitjson-toolkit/extensions`.

Packed release checks reject any missing or additional root export.

## Parser

Import from the root or `circuitjson-toolkit/parser`.

### `DocumentResult.createValidatedOwned(fields, runtime?)`

Creates the same validated `ecad-toolkit.document.v1` envelope as
`DocumentResult.createValidated(fields, runtime?)`, but adopts ordinary model
and extension graph nodes that the calling toolkit just constructed. The
model and retained extension nodes keep their identities and are validated and
deeply frozen in place. The envelope schema, parameters, source-reference
runtime option, and public return fields are unchanged. Binary payloads still
pass through the defensive binary-property boundary.

This is a destructive ownership transfer for source-toolkit convergence
builders. Call it only when the complete ordinary graph is newly created,
mutable, has standard local built-ins, and is no longer shared with code that
expects to mutate it. Raw parser input, arbitrary caller objects, cross-realm
values, proxies, and prototype-modified graphs must use
`DocumentResult.createValidated()` instead. The method is exported from
`circuitjson-toolkit/parser`, not from the exact root surface.

### `Parser.parse(input, options?)`

Synchronously detects, decodes, validates, and returns one canonical document.
Synchronous calls reject `worker: true`.

### `Parser.parseAsync(input, options?)`

Asynchronous equivalent with progress, cancellation, and worker support.
Direct execution snapshots binary input windows and selected assets before the
first progress callback. A callback may mutate caller buffers without changing
the in-flight result. Worker inputs rely on the already isolated protocol copy
and are not copied again in the receiver.

### `Parser.tryParse(input, options?)`

Returns either `{ ok: true, value }` or
`{ ok: false, error, diagnostics }` instead of throwing a public parse failure.

### `Parser.supports(input)`

Performs bounded format detection and returns a boolean.

The parser subpath additionally exports `ParserWorkerClient`,
`ToolkitWorkerProtocol`, and the `TOOLKIT_WORKER_PROTOCOL` version constant for
hosts that own a custom worker lifecycle.

### `ToolkitAsset.measure(asset)`

Returns the exact resident payload byte length without copying. Binary lengths
come from intrinsic platform slots and text uses a non-allocating UTF-8 scan.

### `ToolkitAsset.prepare(asset, options?)`

Accepts `mode: 'none' | 'metadata' | 'full'`. `none` validates and measures but
returns `null`; `metadata` returns canonical metadata with `data: null` and
makes no payload copy; `full` creates exactly one protected payload snapshot.
The optional `acceptPayload(byteLength, identity)` callback runs before payload
allocation. Accessors, custom prototypes, and hidden fields are rejected
without executing accessors. When `mediaType` is omitted, standard ECAD model,
image, JSON, PDF, and ZIP suffixes are inferred from `name`; an explicit
`mediaType` always wins. WRL and VRML resolve to `model/vrml`, while STEP and
STP resolve to `model/step`.

### `ToolkitAsset.prepareAll(assets, options?)`

Applies the same contract to an exact dense asset array. Privately branded
prepared assets are idempotent, so parser/project/result boundaries do not
copy a full payload again.

### `ParserWorkerClient` instance attempts

`client.parseAttempt(input, options?)` and
`client.loadProjectAttempt(entries, options?)` return `{ ok: true, value }` on
success or `{ ok: false, error, unavailable }` on failure. `unavailable` is true
only when that exact request's locally injected worker factory or construction
boundary fails. The authorization is consumed by that result and cannot be
replayed by throwing the returned error from another request.

Source toolkits can use these methods to implement `worker: 'auto'` without
hiding failures: fall back to direct execution only for `unavailable: true`;
input validation, post-message, remote parser, protocol, cancellation, queue,
disposed-client, and worker runtime failures all return `unavailable: false`.

## Projects

Import from the root or `circuitjson-toolkit/project`.

### `ProjectLoader.load(entries, options?)`

Synchronously loads a bounded dense array of `{ name, data, assets? }` entries
and returns an `ecad-toolkit.project.v1` envelope. Unsupported entries are
classified consistently; archive limits and duplicate paths are validated
before parsing.

Attached `entry.assets` payload bytes are included in `maxEntryBytes` and
`maxTotalBytes` before parsing in every decode mode. Direct and worker paths use
the same `ToolkitAsset` preparation and accounting pass.

The loader captures one bounded, known-field snapshot before callbacks, host
yields, or worker dispatch. `maxEntries` is enforced from the array length
before any entry record is inspected. Later caller mutation cannot change
classification, accounting, or direct/worker behavior, and unknown hidden or
symbol entry fields are ignored consistently.

### `ProjectLoader.loadAsync(entries, options?)`

Asynchronous equivalent with common progress, cancellation, and worker
behavior.

### `ProjectLoader.tryLoad(entries, options?)`

Returns a discriminated success or failure record without throwing public load
failures.

### `ProjectLoader.supports(entries)`

Returns whether the bounded entry collection contains supported project input.

### `ZipArchiveInspector.inspect(data, options?)`

Preflights bounded ZIP central and local records before inflation, including
exact local/central filename agreement. Entry rows
include `crc32`, compressed/uncompressed sizes, `localOffset`, and
`payloadOffset`; fixed local metadata must exactly match the central directory,
while data-descriptor fields must be zero or matching.
`maxCompressionRatio` compares total declared uncompressed member bytes with
total compressed member bytes, independent of ZIP comments or container
padding. Empty archives use ratio zero; a nonempty declared output with zero
compressed bytes is rejected as an infinite ratio.

### `ZipArchiveInspector.verifyExtractedBytes(entry, data)`

Checks the exact extracted byte length and CRC32 against an entry returned by
`inspect()`. It returns `true` or throws `ToolkitError` with
`ERR_ARCHIVE_INVALID` and expected/actual integrity details.

## Prepared document context

### `CircuitJsonDocumentContext.prepare(document, options?)`

Validates once and returns an immutable request-scoped context. `options.indexes`
may request `elements`, `identifiers`, `relations`, `connectivity`, and
`spatial` indexes. The compact `identifiers` index exposes an `elementsById`
set without duplicating the element graph.

The class constructor is not a public construction path. It throws before
observing caller input; use `prepare()` so every context carries a
validation-bound authority that downstream viewers and applications can trust.

### `CircuitJsonDocumentContext.prepareStructuredCloneAsync(input, options?)`

Cooperatively validates and adopts an exact platform structured-clone result.
`options.ownership` must be the literal string `exclusive`; it declares a
destructive transfer and requires the caller to relinquish every alias and
shared-memory writer until settlement. `options.indexes` accepts the same names
as `prepare()`. `options.yield` may be an async or synchronous function; it is
awaited after model validation and between bounded slices of extension
adoption and sealing. If omitted, the runtime uses `scheduler.yield()` when
present or a zero-delay host task. The method returns a promise for the same
immutable context shape. The cooperative path enforces the normal extension
limits plus a 16,384-property limit on each individual plain record.

When `input` is already a `CircuitJsonDocumentContext`, the method performs no
transfer and reuses it immediately, so `options.ownership` is not required.
Transferred ordinary records are adopted in place; dense arrays are normalized
to clean arrays with aliases and cycles preserved.

Use this only at a provenance boundary that guarantees standard local
built-ins and ordinary enumerable string properties. Large strings, binary
payloads, dense arrays, and Map/Set values are processed across cooperative
pauses, then acquired containers are progressively locked before the proof and
envelope are sealed. Mutation before a node is acquired is outside the
exclusive-transfer contract and cannot be detected reliably; rejection can
leave a partially locked graph. Use `prepareStructuredClone()` for
uninterrupted same-thread adoption and `prepare()` for untrusted or otherwise
arbitrary caller graphs.

### `context.getIndex(name)` and `context.hasIndex(name)`

Access a prepared index or check its presence.

### `context.getOrCreateDerived(namespace, key, factory)`

Creates a derived value once per context and stable namespace/key pair. This is
the common extension point for services that need to share expensive work.

### `context.statistics`

Returns stable validation, index-build, and derived-build counters.

## Renderers

Import from the root or `circuitjson-toolkit/renderers`. Renderer output is
deterministic, local, and independent of DOM APIs.

### `PcbSvgRenderer.render(document, options?)`

Returns one SVG string. Common options include `side`, selected/hidden layers,
hidden object categories, viewport controls, and shared style controls.

### `PcbSvgRenderer.renderLayers(document, options?)`

Returns `{ schema, items, diagnostics, statistics }`. Every item contains
`id`, `side`, `layerIds`, and `svg`. All layers share one primitive preparation.

### `SchematicSvgRenderer.render(document, options?)`

Returns one schematic SVG. Sheet selection and table/debug presentation use
the same option names across toolkits. Canonical `schematic_image` rows resolve
their exact `asset_id` from `document.assets`; full asset mode renders the
payload, while metadata-only or unresolved assets are omitted without a
placeholder. `schematic_sheet_symbol` renders a hierarchical child box and is
never treated as a selectable `schematic_sheet` page. Since 1.1.2, every
primitive emits explicit SVG fill paint: open arcs, polylines, and shapes use
`fill="none"`; filled primitives keep valid authored paint or fall back to
`var(--schematic-fill-color, #f1d8bd)`. Generic component and symbol bodies use
the same fill variable plus
`var(--schematic-default-ink-color, #008aa3)` for their stroke.

### `BomTableRenderer.render(document, options?)`

Returns deterministic BOM HTML from standard source-component fields. Legacy
prepared row input is retained only as a compatibility path.

The optional stylesheet is available at
`circuitjson-toolkit/styles/renderers.css`.

## PCB interaction

Import from the root or `circuitjson-toolkit/interaction`.

### `PcbInteractionIndex.create(document, options?)`

Creates a reusable exact interaction service. Common defaults are `side`,
`tolerance`, `hiddenLayers`, and `hiddenObjects`.

### `index.hitTest(point, options?)`

Returns ordered exact hits after spatial broad-phase filtering. Every row uses
the common fields `elementId`, `primitiveId`, `kind`, `side`, `layerId`,
`bounds`, `distance`, `componentId`, `componentKey`, `netName`, `groupIds`, and
`source`.

### `index.pick(point, options?)`

Returns the first exact hit or `null`.

### `index.selectBounds(bounds, options?)`

Returns the normalized selection bounds, center point, candidates, selected
candidate, component keys, and net names.

### `index.selectArea(bounds, options?)`

Returns the same normalized selection as `selectBounds`. `selectArea` is the
shared alias used by source toolkits.

### `index.selectionAt(point, options?)`

Returns point selection candidates and stable component-first/net-first
selection state.

### `index.snap(point, options?)`

Returns `{ snapped, point }` for the nearest prepared anchor inside tolerance.

### `index.resolveLayers()`

Returns clone-safe `{ physicalLayers, virtualLayers }`.

### `index.resolveDiagnosticFocus(diagnosticId)`

Returns `{ id, point, bounds, relatedPrimitiveIds }` or `null`.

`PcbSpatialIndex` is also exported from the interaction subpath for bounded,
immutable spatial record indexing.

## Queries

Import from the root or `circuitjson-toolkit/query`.

### `QueryService.create(document, options?)`

Returns a service bound to reusable element, relation, and connectivity
indexes.

### `service.query(request, options?)`

`request.select` is `components` or `nets`; `request.where` accepts `field`,
`pattern`, `match`, `flags`, and `caseSensitive`. The result is
`{ schema: 'ecad-toolkit.query.v1', items, diagnostics, statistics }`.

### `service.findComponents(criteria?, options?)`

Returns matching common component records.

### `service.findNets(criteria?, options?)`

Returns matching common net records.

### `service.traceConnectivity(request, options?)`

Returns ordered connectivity records from canonical source identifiers with
bounded traversal controls.

### `service.buildNetlist(options?)`

Returns a detached canonical query netlist.

### `service.statistics`

Reports validation, index, and netlist build counts.

## Manufacturing

Import from the root or `circuitjson-toolkit/manufacturing`.

### `ManufacturingService.inspect(document, options?)`

Returns `{ schema, placements, fabricationNotes, exports, diagnostics,
statistics }`.

### `ManufacturingService.listExports(document, options?)`

Returns availability rows for `fabrication-notes-json`, `pick-place-csv`, and
`routing-dsn`. An unavailable export remains discoverable with a reason.

### `ManufacturingService.export(document, request, options?)`

Builds a requested available export and returns
`{ fileName, mediaType, data: Uint8Array, diagnostics }`.

## Simulation

Import from the root or `circuitjson-toolkit/simulation`.

### `SimulationService.build(document, options?)`

Builds the common simulation description and capability status from canonical
simulation elements.

### `SimulationService.export(document, request, options?)`

Runs an explicitly injected engine or export adapter. No simulator, process,
filesystem, or network access is implicit. Unsupported analyses remain
discoverable and fail with `ERR_CAPABILITY_UNAVAILABLE` when invoked.

The previous `SpiceSimulationService` remains in `/extensions`.

## PCB 3D scene data

Import from the root or `circuitjson-toolkit/scene3d`.

### `PcbScene3dBuilder.build(document, options?)`

Synchronously returns a data-only `ecad-toolkit.scene3d.v1` scene in
millimeters, using a right-handed Z-up coordinate system. It performs no asset
I/O and has no Three.js dependency.

### `PcbScene3dPreparator.prepare(document, options?)`

Asynchronously builds the same canonical scene and resolves only explicitly
requested assets through `options.resolveAsset(request, { signal })`.
Prepared assets are immutable and safe to reuse. `signal` cancels outstanding
work; resolution and concurrency limits are bounded.

Runtime rendering belongs to `pcb-scene3d-viewer`, not this package.

## Capabilities

Import from the root or `circuitjson-toolkit/capabilities`.

### `ToolkitCapabilities.inventory()`

Returns fresh clone-safe rows in stable id order. Each row has `id`,
`category`, `operation`, `status`, `entrypoint`, `summary`, `reason`, `tested`,
and `documented`. See [capabilities.md](capabilities.md) for the full table.

## Extension API

`circuitjson-toolkit/extensions` exports exactly 37 retained noncanonical
1.0.17 symbols. This includes `CircuitJsonParser`, specialized CircuitJSON renderers,
manufacturing builders, archive utilities, selected-part export, and the SPICE
compatibility service. The exact migration mapping is generated from the
verified feature ledger in [migration.md](migration.md) and its split
[appendix pages](migration/root.md).

These helpers consume source-neutral CircuitJSON. Their ledger availability is
therefore `shared` or `derived` for every toolkit, never falsely
source-unavailable.

`CircuitJsonPcbSvgRenderer.renderSides(model, sides?)` is an extension-only
migration helper that renders several sides after one legacy primitive build.

## Testing API

`circuitjson-toolkit/testing` exports:

- `ToolkitContractFixtures`: small synthetic, source-format-specific fixtures;
- `ToolkitLoopbackWorker`: a real structured-clone/transfer loopback worker
  constructor for cross-toolkit worker parity tests;
- `runToolkitContract(adapter)`: the packed downstream conformance harness.

A source toolkit adapter supplies its package name, parser, project loader,
canonical services, capability inventory, and any native source fixture. The
harness verifies observable parser/project shapes, direct/worker equivalence,
context reuse, renderers, interaction, query, manufacturing, simulation, 3D
scene data, errors, and capability identifiers. Optional operations are invoked
according to their capability row: available statuses must return the
canonical shape, while `unavailable` must throw
`ERR_CAPABILITY_UNAVAILABLE`.

## Worker module

`circuitjson-toolkit/workers/parser.worker.mjs` implements
`ecad-toolkit.worker.v1` for both parser and project operations. Hosts normally
select it through `worker: true` or `worker: 'auto'`; importing the module
directly is reserved for custom worker construction.

## Package export map

The complete supported subpath list is:

```text
circuitjson-toolkit
circuitjson-toolkit/parser
circuitjson-toolkit/project
circuitjson-toolkit/renderers
circuitjson-toolkit/interaction
circuitjson-toolkit/query
circuitjson-toolkit/manufacturing
circuitjson-toolkit/simulation
circuitjson-toolkit/scene3d
circuitjson-toolkit/capabilities
circuitjson-toolkit/extensions
circuitjson-toolkit/testing
circuitjson-toolkit/workers/parser.worker.mjs
circuitjson-toolkit/styles/renderers.css
```
