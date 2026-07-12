# circuitjson-toolkit 1.1.2

## Deterministic schematic paint

This patch removes browser-dependent SVG fill behavior from the canonical
schematic renderer.

- Open arcs, polylines, and unfilled shapes now emit `fill="none"` explicitly,
  so they cannot become black-filled in a browser or host stylesheet.
- Filled schematic primitives retain a valid authored `fill_color` or
  `fillColor`. When `is_filled: true` has no authored paint, rendering uses
  `var(--schematic-fill-color, #f1d8bd)`.
- Generic `schematic_component` and `schematic_symbol` bodies now emit the
  shared schematic fill and default-ink theme variables explicitly.
- Filled paths render as polygons; open paths remain polylines. This preserves
  geometry while making fill intent unambiguous.
- Unsafe authored paints remain rejected by the existing SVG paint sanitizer.

Public exports, method names, parameters, CircuitJSON document envelopes, and
renderer return shapes are unchanged from 1.1.1.
