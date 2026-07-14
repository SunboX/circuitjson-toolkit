# Model and envelope format

CircuitJSON Toolkit uses a standards-only CircuitJSON element array as its
shared model. Public parsers wrap that array in typed, clone-safe envelopes so
all ECAD toolkits return the same top-level shape.

## CircuitJSON model

`DocumentResult.model` is an immutable array of CircuitJSON `0.0.446`
elements:

```json
[
    {
        "type": "pcb_board",
        "pcb_board_id": "board_1",
        "center": { "x": 0, "y": 0 },
        "width": 50,
        "height": 30,
        "thickness": 1.6
    }
]
```

Every element must have a known non-empty `type` and satisfy its standard
field contract. Source toolkits may not add private element types, hidden
renderer graphs, array expando properties, or native records to this model.

Acceptance is defined over the serialized input contract of the pinned
`circuit-json@0.0.446` union. The browser runtime is generated from that union
at development time and preserves required fields, unions, refinements,
pipelines, and transform rejection boundaries. Upstream random default IDs are
not materialized because doing so would make identical input nondeterministic;
an omitted random identity instead produces the
`CIRCUITJSON_UPSTREAM_DEFAULT_ID_OMITTED` warning and increments
`statistics.upstreamDefaultIdentityOmissions`.

## DocumentResult

`Parser.parse()` and `Parser.parseAsync()` return this exact enumerable shape:

```js
{
    schema: 'ecad-toolkit.document.v1',
    id: 'document-...',
    modelSchema: {
        name: 'circuit-json',
        version: '0.0.446'
    },
    model: [],
    source: {
        format: 'circuitjson',
        fileName: 'board.json',
        fileType: 'circuitjson'
    },
    extensions: {},
    assets: [],
    diagnostics: [],
    statistics: {}
}
```

`id` derives from normalized source identity rather than the complete payload.
The validated model is deeply immutable. A non-enumerable in-process proof lets
`CircuitJsonDocumentContext` reuse validation; structured cloning intentionally
drops that proof and the receiving process validates once.

For direct asynchronous requests, binary parser inputs, project entries, and
selected assets are captured before any progress callback or host yield.
Partial and shared-buffer views preserve only their exact visible range.
Worker-received request graphs are already process-owned by structured clone,
so the worker marks and reuses that boundary instead of making a second input
copy.

The `CircuitJsonParser` legacy array is mutable for migration-only metadata and
slot replacement, while every unchanged element graph is deeply immutable. If
a caller replaces an element slot, optimized consumers discard the proof-bound
shortcut and validate the replacement before use.

## Source extensions

CircuitJSON input has an empty extension map. `extensions: 'none'` also returns
exactly `{}` for every source format. When source-native facts are selected,
the document has one owned namespace:

```js
{
    altium: {
        $meta: {
            schema: 'ecad-toolkit.extension.v1',
            completeness: 'canonical',
            included: ['layers'],
            omitted: ['raw-records']
        },
        layers: []
    }
}
```

Extensions contain only explicitly selected native facts and references. They
must not duplicate the CircuitJSON model or keep a renamed renderer model.
Default parsing excludes raw/base64/full-payload graphs.

When a caller explicitly selects a native extension, the toolkit captures and
freezes that graph once under a distinct ceiling of 2,000,000 structured items
and 128 MiB of string or binary content. The ceiling is shared across the
selected namespace, applies equally after worker transfer, and remains below
the worker's 250 MB whole-result limit. General document metadata keeps its
smaller budget, so a large native projection cannot consume the canonical
metadata allowance. Oversized graphs are rejected; they are never truncated or
partially retained. Binary extension values remain byte-backed with their
common buffer/view type and are exposed as defensive copies, preserving
mutation isolation without expanding bytes into plain numeric arrays.

Supported pre-union CircuitJSON aliases may be projected through
`CircuitJsonDocument.normalizeModel()`. The copy-on-write form preserves exact
canonical identities; the owned form is for source toolkits before their one
validation/proof boundary. Table cell geometry, PCB artwork routes,
pad-clearance relations, courtyards, layer aliases, and stroke dashes are
derived structurally and never from a source filename or fixture identity.

### PCB text source fidelity

`pcb_note_text`, `pcb_fabrication_note_text`, and `pcb_silkscreen_text` retain
canonical upstream fields first. Source formats with independent width and
height, edge-center anchors, native layer names, or hidden-text state may add:

```js
{
    type: 'pcb_note_text',
    pcb_note_text_id: 'board_text_1',
    text: 'BOARD MARK',
    anchor_position: { x: 12.5, y: 4.25 },
    layer: 'bottom',
    ccw_rotation: 28,
    font_size: 1.2,
    font_width: 0.8,
    font_height: 1.2,
    stroke_width: 0.12,
    anchor_alignment: 'center',
    source_anchor_alignment: 'center_left',
    is_mirrored_from_top_view: true,
    is_hidden: false,
    source_layer: 'B.SilkS',
    source_type: 'gr_text'
}
```

The extension fields are validated and preserved through immutable document
preparation. Lengths accept the same numeric millimeter or unit-suffixed style
as canonical dimensions. `source_anchor_alignment` accepts all nine standard
anchor positions. The narrower upstream anchor on board and fabrication notes
must remain `center` or a corner; renderers use the source anchor when they
need the exact edge-center placement.

## Assets and diagnostics

Assets have exact `id`, `kind`, `name`, `mediaType`, `byteLength`, `data`, and
`source` fields. `data` is `null`, a string, or a supported binary view.
`decodeAssets` controls whether no assets, metadata, or full payloads are
returned.

Schematic images are canonical model rows, not inline payload containers:

```js
{
    type: 'schematic_image',
    schematic_image_id: 'schematic_image_logo',
    asset_id: 'asset_logo',
    center: { x: 20, y: 10 },
    size: { width: 8, height: 4 },
    rotation: 0,
    opacity: 1,
    preserve_aspect_ratio: true,
    render_order: 0,
    source_name: 'logo.png'
}
```

The referenced ToolkitAsset uses `kind: 'schematic-image'`. Payload bytes live
only in `assets[].data` when `decodeAssets: 'full'`; metadata mode retains
`byteLength` and sets `data: null`.

Hierarchical child boxes use `schematic_sheet_symbol` with
`schematic_sheet_symbol_id`, `name`, optional `source_file_name`,
`center`, `width`, `height`, and standard stroke/fill fields. Child
`schematic_port` rows reference `schematic_sheet_symbol_id`.
`schematic_sheet` remains reserved for actual selectable document pages.

Diagnostics have exact `code`, `severity`, `message`, `source`, `location`, and
`details` fields. Severity is `info`, `warning`, or `error`.

## ProjectResult

`ProjectLoader` returns:

```js
{
    schema: 'ecad-toolkit.project.v1',
    id: 'project-...',
    source: { format: 'circuitjson', entryNames: [] },
    documents: [],
    project: null,
    extensions: {},
    assets: [],
    diagnostics: [],
    statistics: {}
}
```

`documents` contains canonical `DocumentResult` objects. `project` is `null`
for a collection without project metadata or an exact descriptor with `id`,
`name`, `format`, `documentIds`, and `relationships`.

## Prepared contexts

`CircuitJsonDocumentContext.prepare(document, options)` accepts a document
envelope, bare CircuitJSON array, or an existing context. It validates a bare
or cloned input once and owns request-scoped element, relation, connectivity,
spatial, render, query, manufacturing, simulation, and scene-derived caches.
The `identifiers` index is a compact set-only view for membership checks and
clone boundaries that do not need duplicate element values.

Contexts can only be constructed by `prepare()`. Calling the exported class
constructor directly throws before reading caller input, so an arbitrary model
cannot be branded as validated and handed to a renderer, viewer, or app.

Serialized results never contain context caches, validation tokens, callbacks,
signals, workers, or caller source references.

## Shared drilled geometry

`CircuitJsonPcbHolePrimitiveModel` converts `pcb_hole` and `pcb_plated_hole`
rows into one source-neutral primitive. For `hole_with_polygon_pad`, the model
inverse-rotates `pad_outline` around the authored center before measuring the
outer width and height. Its global `bounds` remain global, and pill drill
`outer_width`/`outer_height`, rectangular-pad dimensions, and independent
`rect_ccw_rotation`/`hole_ccw_rotation` variants remain distinct. `holeWidth`,
`holeHeight`, `holeDiameter`, `rotation`, and board-space `holeRotation` remain
available
separately. This lets every viewer consume the same canonical geometry without
format-specific repairs.

## Units and scene coordinates

CircuitJSON PCB positions and dimensions use millimeters. Canonical 3D scenes
use millimeters and `right-handed-z-up`. Scene assets are data records; loading
and runtime rendering remain explicit host responsibilities.
