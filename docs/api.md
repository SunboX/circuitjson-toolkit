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
