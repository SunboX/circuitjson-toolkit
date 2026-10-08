# circuitjson-toolkit 1.5.0 release candidate

The renderer subpath now exports `PrintSvgSnapshot.fromSvg` for detached,
immutable print artifacts. It converts toolkit SVG into physical millimetre
bounds, applies the caller's visibility and opacity choices, and retains
semantic text for print/PDF consumers. No network request or document upload is
part of this API.

PCB SVG roots now declare their physical unit scale with `data-ecad-unit-mm`.
The current renderer benchmark checks this changed output against a separate
anchor while preserving the signed v1.0.17 historical benchmark catalog.

The 1.5.0 package is a local release candidate until its integration tests and
publishing gates complete.
