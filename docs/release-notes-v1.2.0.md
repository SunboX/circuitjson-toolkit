# circuitjson-toolkit 1.2.0

## Canonical PCB fidelity

This minor release expands the shared CircuitJSON contract used by the Gerber,
Altium, KiCad, and 3D viewer packages. Existing canonical fields remain
authoritative, while source formats can retain exact rendering information in
validated, source-neutral extension fields.

### API additions

- `pcb_note_text`, `pcb_fabrication_note_text`, and `pcb_silkscreen_text` may
  retain independent `font_width` and `font_height`, `stroke_width`, the exact
  nine-position `source_anchor_alignment`, `is_hidden`, `source_layer`,
  `source_type`, and `source_text_kind`.
- Board-note `ccw_rotation` and fabrication-note `is_mirrored` are validated
  when present, so downstream renderers can consume the original orientation
  without source-format adapters.
- `CircuitJsonPcbHolePrimitiveModel.build()` now returns `cornerRadius` and
  computes board-space bounds for rotated rectangles and pills instead of
  treating their local width and height as axis-aligned.

### Behavior and performance

- Structured metadata snapshots and worker request graphs accept valid nesting
  up to 256 levels, matching the deeper native data graphs emitted by ECAD
  parsers while retaining the existing item and byte limits.
- The new fields pass through the existing immutable document ownership and
  validation boundaries; no viewer or host-app workaround is required.

No existing public class, method, package subpath, parameter, or document
envelope is removed in this release. Consumers that exhaustively validate PCB
text or primitive return objects should accept the additive fields above.
