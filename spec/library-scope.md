# Library scope

`circuitjson-toolkit` owns browser- and Node-compatible common operations over
immutable CircuitJSON.

## Included

- Canonical parser and project result envelopes
- CircuitJSON validation proofs and request-scoped prepared contexts
- Element, relation, connectivity, and PCB spatial indexes
- Deterministic PCB, schematic, and BOM rendering
- PCB hit testing, picking, selection, snapping, layers, and diagnostics
- Repeated component/net queries and connectivity traversal
- Manufacturing inspection and explicit data exports
- Simulation definition/export and explicitly injected engine execution
- Data-only PCB 3D scene building and explicit asset preparation
- Typed errors, diagnostics, progress, capabilities, and worker protocol
- Packed downstream conformance fixtures and checks
- Exactly 37 source-neutral compatibility extensions for previous CircuitJSON
  APIs, classified as shared or derived across the toolkit family
- Descriptor-safe asset measurement/preparation and project-wide payload limit
  accounting

## Excluded

- Gerber, Altium, KiCad, or other native ECAD decoders
- Source-format-specific fidelity predicates and native report generation
- Three.js or other runtime scene rendering
- Browser UI state, controls, downloads, or event orchestration
- Implicit filesystem, process, network, or asset-store access
- Customer/vendor fixtures or example-specific parsing behavior

Native parser behavior belongs in its source toolkit. Runtime visualization
belongs in `pcb-scene3d-viewer` or another host. Common behavior meaningful for
CircuitJSON belongs here and is exposed consistently by every source toolkit.
