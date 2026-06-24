# Model Format

CircuitJSON Toolkit works with serialized CircuitJSON element arrays.

## Top-Level Shape

The expected top-level value is an array:

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

Every element must be an object with a known non-empty string `type` field and
the required fields for that element. The validator also checks the standard
identifier convention for known element types, plus strict core fields for
boards, source components, source ports, schematic components, PCB components,
and SMT pads.

## Metadata

`CircuitJsonParser` and `CircuitJsonDocument.attachMetadata()` attach
non-structural metadata directly to the returned array:

```js
{
    fileName: 'board.json',
    fileType: 'circuitjson',
    kind: 'pcb',
    sourceFormat: 'circuitjson'
}
```

These fields are enumerable so they survive `structuredClone()` and align with
the parser packages' document-model conventions.

## Identifiers

`CircuitJsonIndexer` recognizes common CircuitJSON ID fields, including:

- `pcb_board_id`
- `pcb_component_id`
- `pcb_hole_id`
- `pcb_plated_hole_id`
- `pcb_port_id`
- `pcb_smtpad_id`
- `pcb_trace_id`
- `pcb_via_id`
- `source_component_id`
- `source_net_id`
- `source_port_id`
- `source_trace_id`

Indexed element IDs are stored with a type prefix, such as
`pcb_board:board_1`, so different element classes can reuse local IDs without
colliding.

## Units

CircuitJSON PCB coordinates and dimensions are millimeter-based. The toolkit
provides unit helpers for consumers such as 3D render adapters that need mils:

```js
const widthMil = CircuitJsonUnits.mmToMil(board.width)
const centerMil = CircuitJsonUnits.pointMmToMil(board.center)
```

## Scope

This package does not render CircuitJSON, parse native ECAD formats, or infer
format-specific semantics. Renderer packages and parser packages should consume
these utilities rather than moving rendering or source-format behavior into this
toolkit.
