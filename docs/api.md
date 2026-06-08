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

Returns true when `value` is an object with a non-empty string `type` field.

### `CircuitJsonDocument.isModel(value)`

Returns true when `value` is an array and every item is a CircuitJSON element.

### `CircuitJsonDocument.assertModel(value)`

Throws unless `value` is a CircuitJSON element array.

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

## Entrypoints

The root entrypoint exports all utilities:

```js
import {
    CircuitJsonDocument,
    CircuitJsonIndexer,
    CircuitJsonParser,
    CircuitJsonUnits
} from 'circuitjson-toolkit'
```

The parser subpath is available for parser-focused hosts:

```js
import {
    CircuitJsonDocument,
    CircuitJsonParser
} from 'circuitjson-toolkit/parser'
```
