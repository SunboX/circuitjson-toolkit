# circuitjson-toolkit 1.1.0

## Breaking API convergence

This minor release intentionally changes public names, parameters, return
shapes, and package layout so CircuitJSON, Gerber, Altium, and KiCad toolkits
can expose the same API.

The root is an exact 17-class contract: the 14 canonical classes plus temporary
`CircuitJsonDocument`, `CircuitJsonIndexer`, and `CircuitJsonUnits` viewer
compatibility exports. Exactly 37 previous CircuitJSON-specific classes remain
available from `circuitjson-toolkit/extensions`; they were not removed and are
classified as shared or derived for all four toolkits.

Key changes:

- `Parser.parse({ fileName, data }, options)` replaces filename/text-specific
  parser calls and returns `ecad-toolkit.document.v1`.
- `ProjectLoader` returns `ecad-toolkit.project.v1` with canonical document
  envelopes. It now captures one bounded stable entry snapshot, enforces
  `maxEntries` before inspecting entries, and gives direct and worker paths the
  same known-field behavior.
- Parser failures use `ToolkitError`; `tryParse` and `tryLoad` return exact
  success/failure discriminants.
- `retainSource` is now the explicit `'none' | 'reference'` contract.
  Reference mode preserves exact caller identity only on direct parser calls,
  exposes it non-enumerably, and never serializes or freezes the caller input.
- PCB, schematic, BOM, interaction, query, manufacturing, simulation, and 3D
  services consume either a document result, a CircuitJSON model, or a reused
  `CircuitJsonDocumentContext`.
- Canonical schematic graphics now include asset-backed `schematic_image`
  rows and hierarchical `schematic_sheet_symbol` rows. Images keep payloads
  in ToolkitAsset records, and child sheet symbols no longer masquerade as
  selectable pages or hide unowned root graphics.
- `PcbScene3dBuilder` and `PcbScene3dPreparator` return data-only,
  millimeter-based, right-handed Z-up scenes. The package does not depend on
  Three.js and never fetches assets implicitly.
- `ecad-toolkit.worker.v1` provides equivalent parse/project results, ordered
  progress, cancellation, strict clone-safe errors, opt-in input transfer, and
  worker-owned output transfer.
- `ParserWorkerClient.parseAttempt()` and `loadProjectAttempt()` give source
  toolkits request-scoped automatic-worker fallback: only local construction
  failure sets `unavailable: true`; parser, protocol, and runtime failures stay
  visible.
- Canonical subpaths now include `/parser`, `/project`, `/renderers`,
  `/interaction`, `/query`, `/manufacturing`, `/simulation`, `/scene3d`,
  `/capabilities`, `/extensions`, and `/testing`.
- Shared validation proofs, indexes, render preparation, queries, and scene
  preparation are request-scoped and reused to avoid repeated parsing,
  validation, cloning, and spatial work.
- Validated source extensions are captured once as immutable owned data under
  a separate 128 MiB payload and 2,000,000-item ceiling. Realistic large native
  graphs now survive direct and worker results; over-limit graphs fail visibly
  and the worker keeps its 250 MB whole-result ceiling. Binary extension values
  stay byte-backed behind defensive-copy access rather than expanding into
  plain number arrays.
- `CircuitJsonDocumentContext` can now only be created through `prepare()`;
  direct construction fails before reading input so viewers and applications
  can consume the same validation-bound context without adapter workarounds.
- `CircuitJsonDocument.normalizeModel(model, { owned })` is the shared
  copy-on-write compatibility boundary for legacy table geometry, PCB artwork
  paths, pad diagnostics, courtyards, layer aliases, and stroke dash fields.
  Toolkits normalize owned projections before one validation pass; viewers no
  longer need application-side repair code.
- The complete serialized-input validator is compiled from the pinned
  development dependency `circuit-json@0.0.446`. It preserves upstream
  refinement, pipeline, and SI-unit transform rejection behavior while keeping
  the published browser runtime dependency-free.
- Compiler provenance now also verifies and records the exact lock integrity
  and distribution entry SHA-256 for `format-si-unit@0.0.7` and `zod@3.25.76`.
- Full compatibility parsing canonicalizes legacy Gerber/KiCad outer-layer
  aliases (`1`/`32`, `F.*`/`B.*`, and descriptor `layer.name`), fills via layer
  defaults, converts legacy trace vias, and retains silkscreen circle/oval and
  courtyard geometry for viewers without app-side adapters.
- `CircuitJsonPcbHolePrimitiveModel` now measures polygon `pad_outline` in the
  pad's rotation-local coordinate system and retains pill drill width, height,
  diameter, and independent board-space rotation. Legal `outer_width`,
  `outer_height`, `rect_ccw_rotation`, and `hole_ccw_rotation` variants are
  preserved. Downstream viewers no longer need format-specific plated-slot
  sizing logic.
- Legal square `pcb_hole` rows normalize to equal-width rectangular apertures
  rather than circular fallbacks.
- `extensions: 'none'` now has the exact common return shape `{}` for native
  documents and projects instead of a source-namespaced placeholder.
- `ZipArchiveInspector` now validates exact local/central filenames, CRC32, and
  size metadata and exposes `verifyExtractedBytes()` so stored and deflated
  corruption is rejected after bounded inflation. Compression ratios use
  compressed and uncompressed member payload totals, so ZIP comments or other
  container padding cannot bypass expansion limits.
- `/testing` now exports `ToolkitLoopbackWorker` alongside the contract fixtures
  and runner so all toolkits share one real structured-clone worker regression
  boundary.
- Direct async parser/project paths now snapshot exact binary windows and
  selected assets before progress callbacks. Worker-received inputs reuse their
  structured-clone ownership boundary, and direct companion assets are prepared
  once, closing callback mutation races without redundant receiver/result copies.
- `npm run sync:schema -- --check` is a read-only drift gate that recompiles the
  live pinned union and checks exact contract, provenance, snapshot, and
  generated-module equality.
- Validation now freezes each proven model once, the legacy parser hands its
  already-built index to the next consumer, multi-side legacy rendering shares
  one primitive preparation, and compact identifier indexes avoid cloning
  duplicate element graphs.
- `ToolkitAsset.measure()`, `prepare()`, and `prepareAll()` provide one
  descriptor-safe asset boundary. Metadata mode copies no payload; full mode
  copies once; project limits include attached assets in direct and worker
  execution. Missing media types are inferred consistently for common ECAD
  model and image suffixes, including `model/vrml` for WRL/VRML and
  `model/step` for STEP/STP, while explicit values remain authoritative.
- Canonical schematic rendering preserves explicit multi-value dash patterns,
  accepts only safe SVG line-cap values, and honors `show_label: false` in both
  component markup and bounds. Source toolkits can retain native styles and
  hidden designators without renderer or application workarounds.
- The release benchmark runner enforces the frozen 1.0.17 workloads: both
  primary cases must be at least 20% faster, non-primary regressions are
  bounded, and the duplicate index graph must be at least 25% smaller. Timing
  uses three independent processes. Every process imports toolkit modules from
  the freshly extracted npm tarball candidate and records an execution marker
  that reconciles its package version and source digest with candidate
  provenance.
- The retained Node 20 / Apple M3 Max result passes every timing and clone
  gate, including at least 20% faster for both primary workloads and 85.32%
  fewer duplicate-index clone bytes. See
  `benchmarks/results-v1.1.0.json` for samples and checksums.
- Gerber, Altium, and KiCad packages now consume CircuitJSON Toolkit as their
  shared runtime; their license terms do not replace this package's AGPL or
  separately granted commercial terms.

Before:

```js
import { CircuitJsonParser } from 'circuitjson-toolkit'

const model = CircuitJsonParser.parseText(text, {
    fileName: 'board.json'
})
```

After:

```js
import { Parser } from 'circuitjson-toolkit'

const document = Parser.parse({
    fileName: 'board.json',
    data: text
})

console.log(document.model)
```

See [migration.md](migration.md) and its generated
[appendix pages](migration/root.md) for the exhaustive 1.0.17 feature mapping,
and [capabilities.md](capabilities.md) for host-side capability gating.
