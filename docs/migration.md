# Migration from 1.0.17 to 1.1.0

## Breaking API convergence

Version 1.1.0 intentionally aligns CircuitJSON Toolkit with Gerber Toolkit,
Altium Toolkit, and KiCad Toolkit. Existing names and return shapes may change;
the previous behavior remains available through canonical services or the
explicit `circuitjson-toolkit/extensions` compatibility surface.

No feature in the 1.0.17 public baseline was silently removed. The generated
appendix pages map all 1207 exports, methods, options, fields, and
observable behaviors to their 1.1.0 owner and record availability in all four
toolkits.

## Canonical root

The root exports these common classes:

- `Parser`
- `ProjectLoader`
- `CircuitJsonDocumentContext`
- `PcbSvgRenderer`
- `SchematicSvgRenderer`
- `BomTableRenderer`
- `PcbInteractionIndex`
- `QueryService`
- `ManufacturingService`
- `SimulationService`
- `PcbScene3dBuilder`
- `PcbScene3dPreparator`
- `ToolkitCapabilities`
- `ToolkitError`

`CircuitJsonDocument`, `CircuitJsonIndexer`, and `CircuitJsonUnits` remain
temporary root exports for `pcb-scene3d-viewer` compatibility. Other previous
root and renderer symbols moved to `circuitjson-toolkit/extensions`.

## Parser input and result

Before:

```js
const model = CircuitJsonParser.parseText(text, { fileName: 'board.json' })
```

After:

```js
const document = Parser.parse({ fileName: 'board.json', data: text })
const model = document.model
```

The common parser input is `{ fileName, data, assets? }`. Common options are
`preserveRaw`, `decodeAssets`, `extensions`, `reports`,
`retainSource`, `worker`, `transferInput`, `signal`, and
`onProgress`. Unsupported enum values fail instead of being coerced.

`retainSource` is exactly `'none' | 'reference'`. Reference mode adds the
exact caller input as a non-enumerable `sourceReference` on direct parser
results; it does not freeze that object and serialized results omit it.
Explicit worker execution rejects reference mode because cross-thread identity
cannot be preserved, while automatic execution stays direct.

`Parser.parse` returns `ecad-toolkit.document.v1` with exact top-level
`schema`, `id`, `modelSchema`, `model`, `source`, `extensions`,
`assets`, `diagnostics`, and `statistics` fields. `Parser.tryParse`
returns either `{ ok: true, value }` or
`{ ok: false, error, diagnostics }`.

## Project, rendering, query, manufacturing, simulation, and 3D

- `ProjectLoader` accepts named entry arrays and returns
  `ecad-toolkit.project.v1`. It captures known fields once, rejects an
  excessive entry count before inspecting records, and classifies that stable
  snapshot.
- Renderers accept a document, model, or prepared context and use common
  `top`/`bottom` sides.
- Reuse one `CircuitJsonDocumentContext` for repeated render, interaction,
  query, manufacturing, simulation, and scene work.
- `PcbScene3dBuilder` is synchronous and data-only.
  `PcbScene3dPreparator` performs explicit asynchronous asset resolution.
- Native source facts stay under `document.extensions[format]`; they are not
  duplicated into the CircuitJSON model.
- Missing native prerequisites and unsupported operations throw typed
  `ToolkitError` failures rather than returning invented empty results.

## Workers

`Parser.parseAsync` and `ProjectLoader.loadAsync` use the shared
`ecad-toolkit.worker.v1` protocol. Inputs are not detached unless
`transferInput: true`; worker-owned output buffers are transferred. Progress
uses ordered `detect`, `decode`, `project`, `validate`, and `complete`
stages. Cancellation is request-scoped.

## Package subpaths

- `circuitjson-toolkit/parser`
- `circuitjson-toolkit/project`
- `circuitjson-toolkit/renderers`
- `circuitjson-toolkit/interaction`
- `circuitjson-toolkit/query`
- `circuitjson-toolkit/manufacturing`
- `circuitjson-toolkit/simulation`
- `circuitjson-toolkit/scene3d`
- `circuitjson-toolkit/capabilities`
- `circuitjson-toolkit/extensions`
- `circuitjson-toolkit/testing`
- `circuitjson-toolkit/workers/parser.worker.mjs`
- `circuitjson-toolkit/styles/renderers.css`

## Exhaustive feature mapping

The exhaustive mapping is generated from the immutable captured contracts by
`npm run sync:migration`. The pages remain deterministic and each stays below
the repository's 1,000-line limit.

- [Root entrypoint (673 mappings)](migration/root.md)
- [Parser entrypoint (43 mappings)](migration/parser.md)
- [Legacy renderer entrypoint (483 mappings)](migration/renderers.md)
- [Observable behaviors (8 mappings)](migration/behaviors.md)
