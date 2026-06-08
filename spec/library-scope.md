# Library Scope

`circuitjson-toolkit` owns reusable browser and Node utilities for serialized
CircuitJSON element arrays.

## Included

- CircuitJSON element-array validation
- Standalone JSON text and byte parsing
- Parser-style metadata attachment
- Lookup indexes by element type and stable IDs
- Source and PCB component lookup maps
- Millimeter-to-mil conversion helpers
- Small documentation and tests for toolkit behavior

## Excluded

- Three.js or browser DOM rendering
- PCB 3D runtime behavior
- ECAD source parser logic
- Altium, KiCad, or other source-format compatibility adapters
- Network fetching or remote asset loading

Renderer fixes belong in renderer packages. Source-format fixes belong in the
source toolkit that parses that format.
