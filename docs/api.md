# API

The package exports public APIs from `circuitjson-toolkit` and
`circuitjson-toolkit/parser`.

## Parser

### `CircuitJsonParser.parseText(text, options?)`

Parses standalone CircuitJSON JSON text and returns a serialized element array.

Options:

- `fileName`: optional source file name stored as non-structural metadata.

Returned arrays receive metadata fields compatible with the parser packages:

- `fileName`
- `fileType: 'circuitjson'`
- `kind`
- `sourceFormat: 'circuitjson'`

Malformed JSON throws a `SyntaxError`. Valid JSON that is not a CircuitJSON
element array throws a `TypeError`.

### `CircuitJsonParser.parseBytes(bytes, options?)`

Parses UTF-8 CircuitJSON bytes from an `ArrayBuffer` or `Uint8Array`.

## Document Validation

### `CircuitJsonDocument.isElement(value)`

Returns true when `value` is an object with a known non-empty string `type`
field and passes element-specific validation.

### `CircuitJsonDocument.isModel(value)`

Returns true when `value` is an array and every item is a valid CircuitJSON
element.

### `CircuitJsonDocument.validateModel(value)`

Returns validation error messages for a candidate CircuitJSON element array.

### `CircuitJsonDocument.assertModel(value)`

Throws unless `value` is a valid CircuitJSON element array.

### `CircuitJsonDocument.attachMetadata(circuitJson, metadata?)`

Attaches parser-style metadata to a CircuitJSON array and returns the same
array.

## Indexing

### `CircuitJsonIndexer.index(circuitJson)`

Builds lookup maps for one CircuitJSON element array.

Returns:

- `elements`: the original element array.
- `elementsByType`: `Map<string, object[]>` keyed by `type`.
- `elementsById`: `Map<string, object>` keyed by `<type>:<id>`.
- `sourceComponentById`: source component lookup.
- `pcbComponentById`: PCB component lookup.

Known ID fields include board, component, hole, pad, trace, via, source
component, source net, and source port identifiers.

## Units

### `CircuitJsonUnits.mmToMil(value, fallback?)`

Converts a millimeter value to mils with stable rounding. Non-finite values use
the fallback, defaulting to `0`.

### `CircuitJsonUnits.pointMmToMil(point)`

Converts `{ x, y }` millimeter points to `{ x, y }` mil points.

## PCB Interaction

### `PcbInteractionIndex.create(document, options?)`

Prepares one reusable exact PCB interaction service from a CircuitJSON element
array, `DocumentResult`, or `CircuitJsonDocumentContext`. Preparation validates
once, builds immutable interaction-only primitives once, and builds one packed
spatial index. Clearance diagnostics, airwires, trace-length reports, and other
render overlays remain lazy.

Common `options` are:

- `side`: `top`, `bottom`, or `null`;
- `tolerance`: a finite number from `0` through `1000000` millimeters;
- `hiddenLayers`: a bounded plain array of layer ids;
- `hiddenObjects`: a bounded plain array of object-category ids.

### `index.hitTest(point, options?)`

Returns exact, ordered, clone-safe hit rows after conservative spatial
broad-phase filtering. `point` is `{ x, y }` in millimeters. Each hit contains
`elementId`, `primitiveId`, `kind`, `side`, `layerId`, `bounds`, `distance`,
`componentId`, `componentKey`, `netName`, `groupIds`, and a clone-safe `source`
summary. Primitive ids do not need to be globally unique; every envelope stays
bound to its stable source-record ordinal.

### `index.pick(point, options?)`

Returns the first exact hit from `hitTest` or `null`.

### `index.selectBounds(bounds, options?)`

Performs area selection for `{ minX, minY, maxX, maxY }`. It returns the
normalized `bounds`, center `point`, legacy-compatible `candidates`,
`selectedCandidate`, unique `componentKeys`, and unique `netNames`.

### `index.selectArea(bounds, options?)`

Alias of `selectBounds` for source toolkits that call rectangle selection area
selection.

### `index.selectionAt(point, options?)`

Returns `{ point, candidates, componentCandidate, netCandidate,
selectedCandidate }`. Candidate ordering is identical to `hitTest`; selected
state preserves the legacy component-first, then net-first, then first-hit
policy.

### `index.snap(point, options?)`

Returns `{ snapped, point }` using the nearest prepared primitive anchor within
`options.tolerance`. Like the legacy snapping helper, omitted per-call
tolerance defaults to `0` (exact anchors only).

### `index.resolveLayers()`

Returns clone-safe `{ physicalLayers, virtualLayers }`. Complete overlay data
is prepared lazily on the first layer or diagnostic request and then reused.

### `index.resolveDiagnosticFocus(diagnosticId)`

Returns the clone-safe legacy diagnostic focus shape `{ id, point, bounds,
relatedPrimitiveIds }`, or `null` when the id is unknown.

### `PcbSpatialIndex.create(records)`

Accepts at most 100000 records in a dense plain array. Each record needs a
trimmed, unique id of at most 1024 UTF-16 code units and ordered finite
`bounds`. Records are inspected without invoking accessors, snapshotted, and
deep-frozen. Each hostile source record is inspected exactly once, and the
resulting snapshot is the sole source for both index bounds and returned data.
Nested arrays are dense and limited to 100000 values; one construction is
limited to 1000000 aggregate container/property slots. Shared source metadata
is snapshotted once and may be reused only as the same deeply frozen value
across otherwise independent record snapshots. `search(bounds)` and
`candidates(point, tolerance?)` return those immutable clone-safe snapshots.
Structural container failures throw `TypeError`. Invalid ids, limits, numeric
bounds, or tolerances throw `ToolkitError` with
`ERR_SPATIAL_INDEX_RECORD` or `ERR_SPATIAL_INDEX_QUERY`.

## SPICE Simulation

### `SpiceCompatibilityPreprocessor.rewrite(spiceString)`

Rewrites narrow, supported SPICE compatibility syntax before simulation. The
current preprocessor handles resistor `TC=` pairs and boolean caret operators
inside compatible `VALUE` expression blocks.

### `SpiceSimulationService.simulate(spiceString)`

Runs a local deterministic transient example and returns:

- `simulationResultCircuitJson`: CircuitJSON transient voltage/current graph
  elements.
- `simulationCircuitJson`: a complete CircuitJSON element set containing the
  `simulation_experiment` element with `experiment_type:
'spice_transient_analysis'` followed by its graph elements.
- `graphSummary`: a deterministic summary of graph ids, names, point counts,
  time bounds, and min/max values for renderer tests and UI previews.
- `diagnostics`: non-fatal simulation diagnostics.

The service also accepts an injected engine through `new
SpiceSimulationService({ engine })`. The engine must provide a `simulate`
method that accepts a preprocessed SPICE netlist string and returns real-valued
rows with `time`, `voltage`, and `current` data. Returned rows are resampled to
the `.tran` time grid when transient step and stop parameters are available.
Probe metadata comments may use `circuitjson_voltage_probe`,
`simulation_voltage_probe`, `circuitjson_current_probe`, or
`simulation_current_probe` markers to preserve graph ids, names, source nodes,
and source trace/component references.
External `.lib` and `.include` directives, PWL REPEAT source syntax, selected
PSPICE compatibility patterns, and requested `.PRINT TRAN` vectors that cannot
be matched to simulator output are reported as warnings for callers that need a
full simulator path.
Malformed probe metadata comments are also reported as warnings. Invalid JSON
uses `spice_probe_metadata_invalid_json`; parsed comments missing required
string fields use `spice_probe_metadata_invalid_shape`.

## Entrypoints

The root entrypoint exports all utilities:

```js
import {
    CircuitJsonDocument,
    CircuitJsonIndexer,
    CircuitJsonParser,
    CircuitJsonUnits,
    SpiceCompatibilityPreprocessor,
    SpiceSimulationService
} from 'circuitjson-toolkit'
```

The parser subpath is available for parser-focused hosts:

```js
import {
    CircuitJsonDocument,
    CircuitJsonParser
} from 'circuitjson-toolkit/parser'
```
