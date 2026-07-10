# KiCad Toolkit Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release `kicad-toolkit@1.1.0` with the canonical API, pure CircuitJSON results, selective native fidelity, preserved reverse exporters, and substantially lower parse/render/worker costs.

**Architecture:** KiCad syntax/AST/project/library/export logic stays native. `KicadCircuitJsonProjector` emits the only shared model, `extensions.kicad` retains option-selected native facts, and every common service consumes a shared `CircuitJsonDocumentContext`. Canonical facades compose shared core behavior with KiCad fidelity hooks; native exporters, PCM/CLI, stroke fonts, model paths, WRL, pad stacks, worksheets, rules, jobsets, and legacy formats remain focused extensions.

**Tech Stack:** Node.js 20+, ESM, `node:test`, `fflate`, exact `circuitjson-toolkit@1.1.0`, Prettier 3.

## Global Constraints

- Baseline is clean `kicad-toolkit@1.0.29` at `c71c88d69d236accce123656dfa66914c0d5489c`; release is exactly `1.1.0`.
- Before Task 1, use `superpowers:using-git-worktrees` to create `/Users/afiedler/Documents/privat/Andrés_Werkstatt/kicad-toolkit-api-convergence` from that clean baseline; leave the original worktree untouched. From that sibling worktree, `../release-candidates` resolves to the shared candidate directory.
- Install/test the packed core 1.1.0 candidate before production edits; never recreate core validation, context, error, query, worker, or conformance infrastructure locally.
- Re-export the exact core `CircuitJsonDocumentContext` and `ToolkitError`; KiCad resolvers may only add native extension/asset requirements and derived-cache keys.
- Pure frozen CircuitJSON `0.0.446` is the only shared model; no `rendererModel`, board, schematic, AST, source text, or report expando fields.
- Default parsing omits raw AST/source, full board/schematic graphs, and eleven PCB report families unless options request them.
- Preserve all current native formats and reverse exporters: PCB/schematic/module/symbol/library/project, PCM, CLI, jobset, DRU, worksheet, netlist/association, legacy, WRL/model resolution, stroke font, and pad stacks.
- Common entrypoints/classes/methods/options/results/errors/sides match core exactly; native utilities live under `/extensions` or documented focused subpaths.
- Primary large-board parse/projection, worker-clone, and multi-layer-render medians improve at least 20 percent; duplicate-graph bytes shrink at least 25 percent.
- Files/CSS stay below 1000 lines, use repository formatting, and include JSDoc on every function/method.
- Tests use only synthetic repo-owned KiCad samples and repo-owned commands.
- Every focused command in a task uses `npm test -- <paths>`; immediately before that task's commit, also run unfiltered `npm test && npm run check:format` and stop on either failure.
- Do not publish from this phase; produce a packed candidate for coordinated release.

## File Structure

- `src/core/kicad/Parser.mjs`, `ProjectLoader.mjs`: canonical facades around native decoders/loaders.
- `src/core/kicad/KicadCircuitJsonProjector.mjs`: source-semantic projection only.
- `src/core/kicad/KicadExtensionBuilder.mjs`: selective native extension/report/asset retention.
- `src/core/kicad/KicadDocumentContextResolver.mjs`: thin shared-context/native-requirement boundary.
- `src/extensions/`: native parsers/exporters/renderers/reports/scene barrels.
- `src/ui/Kicad*Renderer.mjs`: native fidelity implementations; unprefixed files are canonical facades.
- `benchmarks/`, `scripts/`, `spec/`: immutable baselines, preservation ledger, performance and package gates.

---

### Task 1: Freeze the 1.0.29 feature and benchmark baselines

**Files:**
- Create: `spec/api-baseline-v1.0.29.json`
- Create: `spec/feature-preservation.json`
- Create: `benchmarks/KicadBenchmarkFixtureFactory.mjs`
- Create: `benchmarks/KicadConvergenceBenchmark.mjs`
- Create: `benchmarks/baseline-v1.0.29.json`
- Create: `scripts/capture-api-baseline.mjs`
- Create: `scripts/check-feature-preservation.mjs`
- Create: `scripts/run-benchmarks.mjs`
- Create: `tests/conformance/convergence-baselines.test.mjs`
- Create: `tests/conformance/feature-preservation-check.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: all 126 current root exports, eight current subpaths, public methods/options/results/worker messages, current capability inventory, and 382 passing tests.
- Produces: exhaustive ledger, structural fixture checksums, `npm run check:features`, and immutable primary cases `parse.large-board`, `render.multi-layer`, and `worker.clone`.

- [ ] **Step 1: Write the failing baseline test**

```js
test('KiCad baselines identify every public feature and fixed primary cases', async () => {
    const api = JSON.parse(await readFile('spec/api-baseline-v1.0.29.json', 'utf8'))
    const ledger = JSON.parse(await readFile('spec/feature-preservation.json', 'utf8'))
    const benchmark = JSON.parse(await readFile('benchmarks/baseline-v1.0.29.json', 'utf8'))
    assert.equal(api.gitRef, 'c71c88d69d236accce123656dfa66914c0d5489c')
    assert.equal(ledger.length >= api.features.length, true)
    assert.deepEqual(benchmark.cases.filter((row) => row.primary).map((row) => row.id), ['parse.large-board', 'render.multi-layer', 'worker.clone'])
})
```

- [ ] **Step 2: Run and verify missing baseline artifacts**

Run: `npm test -- tests/conformance/convergence-baselines.test.mjs`

Expected: FAIL with `ENOENT` for `spec/api-baseline-v1.0.29.json`.

- [ ] **Step 3: Implement deterministic capture and benchmark scripts**

Add package scripts `capture:api`, `check:features`, and `benchmark`. Cases cover parse, project, all-report selection, multi-layer render, repeated query/interaction, and worker clone. Each row records Git ref, fixture checksum, environment, warmups/samples, median, clone/result bytes, and heap observations. The final `--strict` feature checker imports packed entrypoints, resolves every capability id against the inventory, verifies referenced tests/docs exist, and is tested against stale and fictitious ledger rows.

- [ ] **Step 4: Generate and verify baselines**

Run: `npm run capture:api && npm run benchmark -- --record benchmarks/baseline-v1.0.29.json && npm run check:features && npm test -- tests/conformance/convergence-baselines.test.mjs && npm test && npm run check:format`

Expected: PASS with primary flags fixed before implementation.

- [ ] **Step 5: Commit baselines**

```bash
git add spec benchmarks scripts package.json tests/conformance/convergence-baselines.test.mjs tests/conformance/feature-preservation-check.test.mjs
git commit -m "chore: record KiCad convergence baselines"
```

### Task 2: Replace local schema/hybrid ownership with a pure projector

**Files:**
- Create: `src/core/kicad/KicadCircuitJsonProjector.mjs`
- Create: `src/core/kicad/KicadCircuitJsonProjectionRules.mjs`
- Create: `tests/core/kicad-circuit-json-projector.test.mjs`
- Create: `scripts/prepare-candidate-core-lock.mjs`
- Modify: `src/core/circuit-json/CircuitJsonModelAdapter.mjs`
- Modify: `src/core/circuit-json/CircuitJsonModelAdapterElements.mjs`
- Modify: `src/core/circuit-json/CircuitJsonModelAdapterPrimitives.mjs`
- Modify: `src/core/circuit-json/CircuitJsonProjectMetadataBuilder.mjs`
- Modify: `src/core/circuit-json/CircuitJsonRouteEndpointResolver.mjs`
- Modify: `src/core/circuit-json/CircuitJsonSchematicTraceBuilder.mjs`
- Modify: `src/parser.mjs`
- Modify: `tests/api-entrypoints.test.mjs`
- Modify: `tests/package-layout.test.mjs`
- Modify: `tests/**/*.test.mjs`
- Modify: `tests/core/circuit-json-conformance.test.mjs`
- Modify: `tests/core/circuit-json-text-connectivity.test.mjs`
- Modify: `tests/core/circuit-json-footprint-artwork.test.mjs`
- Modify: `tests/core/circuit-json-geometry-topology-regressions.test.mjs`
- Modify: `spec/feature-preservation.json`
- Remove after parity: `src/core/circuit-json/CircuitJsonConformanceChecker.mjs`
- Remove after parity: `src/core/circuit-json/CircuitJsonModelSchema.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: native KiCad document and shared strict validator/proof builder from exact core candidate.
- Produces: `KicadCircuitJsonProjector.project(nativeDocument, options) -> CircuitJsonElement[]` with no array properties.

- [ ] **Step 1: Install core candidate and write failing purity/schema tests**

Run: `npm install --no-save --package-lock=false ../release-candidates/circuitjson-toolkit-1.1.0.tgz`

```js
test('KiCad projection is pure CircuitJSON 0.0.446', () => {
    const model = KicadCircuitJsonProjector.project(createNativeBoard())
    assert.doesNotThrow(() => CircuitJsonDocument.assertModel(model))
    assert.equal(Object.hasOwn(model, 'rendererModel'), false)
    assert.equal(Object.hasOwn(model, 'pcb'), false)
    assert.equal(Object.hasOwn(model, 'kind'), false)
})
```

- [ ] **Step 2: Run and verify current hybrid failure**

Run: `npm test -- tests/core/kicad-circuit-json-projector.test.mjs tests/core/kicad-parser-circuit-json-api.test.mjs`

Expected: FAIL because `CircuitJsonModelAdapter` attaches compatibility fields and local schema is `0.0.433`.

- [ ] **Step 3: Isolate KiCad-semantic projection and delete compatibility attachment**

First implement `prepare-candidate-core-lock.mjs`, then run `npm install --save-exact ../release-candidates/circuitjson-toolkit-1.1.0.tgz && npm pkg set dependencies.circuitjson-toolkit=1.1.0 && node scripts/prepare-candidate-core-lock.mjs && npm ci`. The script asserts tarball version/integrity, restores only the lock root dependency spec to exact `1.1.0`, and retains its tarball resolution so prepublication `npm ci` is reproducible.

```js
static project(nativeDocument, options = {}) {
    return CircuitJsonModelAdapter.toElements(nativeDocument, options)
}
```

Delegate generic schema/field/relation/geometry validation to core; retain KiCad interpretation for layers, pads, routes, copper, artwork, symbols, text, and libraries. Projector unit tests call the shared validator, but production validation/freeze occurs exactly once in Task 3 through `DocumentResult.createValidated()`. Delete `Object.assign`/`rendererModel` attachment only after differential output tests pass. Atomically remove the deleted checker/schema exports from `src/parser.mjs`, replace `CircuitJsonProjectMetadataBuilder` and conformance tests with shared validator/context diagnostics, update API/layout expectations, and add migration ledger rows so no test or barrel imports a removed file.

- [ ] **Step 4: Run all CircuitJSON projection suites**

Run: `npm test -- tests/core/kicad-circuit-json-projector.test.mjs tests/core/kicad-parser-circuit-json-api.test.mjs tests/core/circuit-json-*.test.mjs`

Expected: PASS with unchanged standard elements and pure array serialization.

- [ ] **Step 5: Commit pure projection ownership**

```bash
git add src/core/kicad/KicadCircuitJsonProjector.mjs src/core/kicad/KicadCircuitJsonProjectionRules.mjs src/core/circuit-json src/parser.mjs scripts/prepare-candidate-core-lock.mjs package.json package-lock.json spec/feature-preservation.json tests/core/kicad-circuit-json-projector.test.mjs tests/core/circuit-json-conformance.test.mjs tests/core/circuit-json-text-connectivity.test.mjs tests/core/circuit-json-footprint-artwork.test.mjs tests/core/circuit-json-geometry-topology-regressions.test.mjs tests/api-entrypoints.test.mjs tests/package-layout.test.mjs
git commit -m "refactor: project pure KiCad CircuitJSON"
```

### Task 3: Add canonical parser and typed document envelopes

**Files:**
- Create: `src/core/kicad/Parser.mjs`
- Create: `src/core/kicad/KicadNativeDecoder.mjs`
- Create: `src/core/kicad/KicadParseSession.mjs`
- Create: `src/core/kicad/KicadAsyncSExpressionReader.mjs`
- Create: `src/core/kicad/KicadInputNormalizer.mjs`
- Create: `src/core/kicad/KicadDocumentResultBuilder.mjs`
- Create: `src/core/kicad/KicadDocumentContextResolver.mjs`
- Create: `tests/conformance/parser-contract.test.mjs`
- Create: `tests/core/kicad-parser-envelope.test.mjs`
- Create: `tests/core/kicad-async-decode.test.mjs`
- Modify: `src/core/kicad/KicadParser.mjs`
- Modify: `src/core/kicad/KicadAuxiliaryParserRouter.mjs`
- Modify: `src/core/kicad/SExpressionParser.mjs`
- Modify: `src/core/kicad/KicadPcbParser.mjs`
- Modify: `src/core/kicad/KicadSchematicParser.mjs`
- Modify: `src/parser.mjs`

**Interfaces:**
- Consumes: every current native format router, pure projector, core `DocumentResult`, `ToolkitError`, and `CircuitJsonDocumentContext`.
- Produces: canonical `Parser.supports/parse/tryParse/parseAsync` for all existing KiCad/legacy/library/project-helper file families.

- [ ] **Step 1: Write failing parser method/envelope/error tests**

```js
test('KiCad Parser returns canonical envelopes for PCB and auxiliary files', () => {
    for (const input of createSupportedKiCadInputs()) {
        const result = Parser.parse(input)
        assert.equal(result.schema, 'ecad-toolkit.document.v1')
        assert.equal(result.source.format, 'kicad')
        assert.equal(Object.isFrozen(result.model), true)
        assert.equal(CircuitJsonDocumentContext.prepare(result).statistics.validationPasses, 0)
    }
})

test('KiCad Parser.tryParse returns a shared typed error', () => {
    const result = Parser.tryParse({ fileName: 'broken.kicad_pcb', data: '(' })
    assert.equal(result.ok, false)
    assert.equal(result.error.name, 'ToolkitError')
})
```

- [ ] **Step 2: Run and verify filename-first/hybrid failure**

Run: `npm test -- tests/conformance/parser-contract.test.mjs tests/core/kicad-parser-envelope.test.mjs`

Expected: FAIL because canonical `Parser` is absent and current output is a hybrid array.

- [ ] **Step 3: Route existing decoders through one canonical facade**

```js
static parse(input, options = {}) {
    try {
        const parsed = KicadParseSession.parse(KicadInputNormalizer.normalize(input), options)
        return DocumentResult.createValidated(KicadDocumentResultBuilder.fields(parsed, input, options))
    } catch (error) {
        throw ToolkitError.from(error, { code: 'ERR_KICAD_PARSE', category: 'parse', format: 'kicad', source: String(input?.fileName || '') })
    }
}
```

Keep sync output unchanged, but factor tokenization/tree construction into `KicadAsyncSExpressionReader` batches used by async PCB/schematic routes; check signal/progress and yield between bounded token/node batches. `KicadParseSession.parseAsync()` drives those phases so active direct cancellation works, while `parse()` retains the synchronous parser. Test mid-token abort plus null/primitive input normalization. `KicadDocumentContextResolver` only delegates core context preparation and native extension/asset requirements.

- [ ] **Step 4: Run parser/projection/current format suites**

Run: `npm test -- tests/conformance/parser-contract.test.mjs tests/core/kicad-parser-envelope.test.mjs tests/core/kicad-async-decode.test.mjs tests/core/kicad-parser-circuit-json-api.test.mjs && npm test`

Expected: PASS.

- [ ] **Step 5: Commit canonical parsing**

```bash
git add src/core/kicad/Parser.mjs src/core/kicad/KicadNativeDecoder.mjs src/core/kicad/KicadParseSession.mjs src/core/kicad/KicadAsyncSExpressionReader.mjs src/core/kicad/KicadInputNormalizer.mjs src/core/kicad/KicadDocumentResultBuilder.mjs src/core/kicad/KicadDocumentContextResolver.mjs src/core/kicad/KicadParser.mjs src/core/kicad/KicadAuxiliaryParserRouter.mjs src/core/kicad/SExpressionParser.mjs src/core/kicad/KicadPcbParser.mjs src/core/kicad/KicadSchematicParser.mjs src/parser.mjs tests/conformance/parser-contract.test.mjs tests/core/kicad-parser-envelope.test.mjs tests/core/kicad-async-decode.test.mjs
git commit -m "feature: add canonical KiCad parser envelopes"
```

### Task 4: Make native extensions, reports, raw data, and assets selective

**Files:**
- Create: `src/core/kicad/KicadExtensionBuilder.mjs`
- Create: `src/core/kicad/KicadAssetBuilder.mjs`
- Create: `src/core/kicad/KicadSourceRetention.mjs`
- Create: `src/core/kicad/KicadPcbReportRegistry.mjs`
- Create: `tests/core/kicad-parser-retention.test.mjs`
- Create: `tests/core/kicad-report-selection.test.mjs`
- Create: `tests/core/kicad-assets.test.mjs`
- Modify: `src/core/kicad/KicadPcbDocumentSidecarBuilder.mjs`
- Modify: `src/core/kicad/SchematicSidecarBuilder.mjs`
- Modify: `src/core/kicad/KicadSchematicParser.mjs`
- Modify: `src/core/kicad/KicadFootprintLibraryParser.mjs`
- Modify: `src/core/kicad/KicadSymbolLibraryParser.mjs`
- Modify: `src/core/kicad/KicadLibraryTableParser.mjs`
- Modify: `src/core/kicad/KicadWorksheetParser.mjs`
- Modify: `src/core/kicad/KicadNetlistParser.mjs`
- Modify: `src/core/kicad/KicadJobsetParser.mjs`
- Modify: `src/core/kicad/KicadFootprintAssociationParser.mjs`
- Modify: `src/core/kicad/KicadLegacyLibraryParser.mjs`
- Modify: `src/core/kicad/KicadJobsetDigestBuilder.mjs`
- Modify: `src/core/kicad/KicadDesignRulesParser.mjs`

**Interfaces:**
- Consumes: parser options and current eleven-report/native sidecar builders.
- Produces: exact `$meta` completeness, explicit included/omitted ids, common `ToolkitAsset` shape, and content-identical requested native reports/raw data.

- [ ] **Step 1: Write failing default/selective retention tests**

```js
test('default KiCad parse omits AST and eager report families', () => {
    const result = Parser.parse(kicadPcbInput())
    assert.equal(result.extensions.kicad.ast, undefined)
    assert.equal(result.extensions.kicad.reports, undefined)
    assert.equal(result.extensions.kicad.$meta.omitted.includes('reports.routeAnalysis'), true)
})

test('requested report retains its existing content', () => {
    const result = Parser.parse(kicadPcbInput(), { reports: ['routeAnalysis'] })
    assert.deepEqual(result.extensions.kicad.reports.routeAnalysis, expectedRouteAnalysis())
})
```

- [ ] **Step 2: Run and verify eager retention failures**

Run: `npm test -- tests/core/kicad-parser-retention.test.mjs tests/core/kicad-report-selection.test.mjs tests/core/kicad-assets.test.mjs`

Expected: FAIL because AST/source and all eleven reports are retained/built by default and assets use `{ name, bytes }`.

- [ ] **Step 3: Gate builders by normalized options without changing requested content**

```js
static build(nativeDocument, options = {}) {
    const included = KicadPcbReportRegistry.requested(options.reports)
    return Object.fromEntries(included.map((id) => [id, KicadPcbReportRegistry.build(id, nativeDocument)]))
}
```

Thread selection into every eager producer, including footprint associations, legacy library parsing, and jobset digest construction, so defaults never allocate `rawAssociations`, `rawSource`/`rawLines`/`rawHeader`, or `rawDestination`/`rawJob`. `extensions:'none'` returns only `$meta`; `canonical` keeps native facts required by canonical fidelity; `full` may keep full native models but excludes raw AST/source unless `preserveRaw:true`; `retainSource:'reference'` is non-enumerable and forces direct execution.

The retention tests cover `extensions: 'none' | 'metadata' | 'canonical' | 'full' | string[]`, `$meta.completeness: 'selected'`, exact included/omitted ids, every `decodeAssets` mode, multiple and unknown report ids, `preserveRaw`, and worker-auto fallback for `retainSource: 'reference'`.

- [ ] **Step 4: Run retention plus native parser/report suites**

Run: `npm test -- tests/core/kicad-parser-retention.test.mjs tests/core/kicad-report-selection.test.mjs tests/core/kicad-assets.test.mjs tests/core/kicad-pcb-read-model-helpers.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit selective native detail**

```bash
git add src/core/kicad/KicadExtensionBuilder.mjs src/core/kicad/KicadAssetBuilder.mjs src/core/kicad/KicadSourceRetention.mjs src/core/kicad/KicadPcbReportRegistry.mjs src/core/kicad/KicadPcbDocumentSidecarBuilder.mjs src/core/kicad/SchematicSidecarBuilder.mjs src/core/kicad/KicadSchematicParser.mjs src/core/kicad/KicadFootprintLibraryParser.mjs src/core/kicad/KicadSymbolLibraryParser.mjs src/core/kicad/KicadLibraryTableParser.mjs src/core/kicad/KicadWorksheetParser.mjs src/core/kicad/KicadNetlistParser.mjs src/core/kicad/KicadJobsetParser.mjs src/core/kicad/KicadFootprintAssociationParser.mjs src/core/kicad/KicadLegacyLibraryParser.mjs src/core/kicad/KicadJobsetDigestBuilder.mjs src/core/kicad/KicadDesignRulesParser.mjs tests/core/kicad-parser-retention.test.mjs tests/core/kicad-report-selection.test.mjs tests/core/kicad-assets.test.mjs
git commit -m "feature: make KiCad native detail selective"
```

### Task 5: Add bounded canonical project loading

**Files:**
- Create: `src/core/kicad/ProjectLoader.mjs`
- Create: `src/core/kicad/KicadArchiveReader.mjs`
- Create: `src/core/kicad/KicadProjectEntryClassifier.mjs`
- Create: `src/core/kicad/KicadProjectResultBuilder.mjs`
- Create: `src/project.mjs`
- Create: `tests/conformance/project-loader-contract.test.mjs`
- Create: `tests/core/kicad-archive-limits.test.mjs`
- Modify: `src/core/kicad/KicadProjectLoader.mjs`
- Modify: `src/core/kicad/KicadLibraryIndexBuilder.mjs`
- Modify: `tests/core/kicad-project-loader.test.mjs`
- Modify: `tests/core/kicad-project-loader-full.test.mjs`

**Interfaces:**
- Consumes: shared archive limits/path helpers, canonical parser, current hierarchy/library/companion logic.
- Produces: `ProjectLoader.supports/load/tryLoad/loadAsync`, only `DocumentResult[]`, stable partial successes, and no rendererDocuments/sourceText duplication.

- [ ] **Step 1: Write failing project/archive contract tests**

```js
test('KiCad ProjectLoader returns one canonical document graph', async () => {
    const result = await ProjectLoader.loadAsync(createProjectEntries())
    assert.equal(result.schema, 'ecad-toolkit.project.v1')
    assert.equal(result.documents.every((row) => row.schema === 'ecad-toolkit.document.v1'), true)
    assert.equal(Object.hasOwn(result, 'rendererDocuments'), false)
})

test('archive limits reject unsafe duplicate normalized paths', () => {
    assert.throws(() => KicadArchiveReader.validateNames(['a/../board.kicad_pcb']), { code: 'ERR_ARCHIVE_PATH' })
    assert.throws(() => KicadArchiveReader.validateNames(['dir//board.kicad_pcb', 'dir/board.kicad_pcb']), { code: 'ERR_ARCHIVE_DUPLICATE_ENTRY' })
})
```

- [ ] **Step 2: Run and verify eager/legacy project failures**

Run: `npm test -- tests/conformance/project-loader-contract.test.mjs tests/core/kicad-archive-limits.test.mjs`

Expected: FAIL because current loader is async-only, eagerly uses `unzipSync`, and returns duplicated renderer/source graphs.

- [ ] **Step 3: Implement bounded classification and canonical assembly**

```js
static async loadAsync(entries, options = {}) {
    const classified = await KicadArchiveReader.classify(entries, options)
    return KicadProjectResultBuilder.build(await KicadProjectLoader.loadClassified(classified, options), options)
}
```

Apply exact common archive defaults, safe POSIX paths, stable candidate order, candidate-only inflation, progress/cancel phases, nested depth 1, typed diagnostics, and project/document asset separation.

- [ ] **Step 4: Run project/library/archive suites**

Run: `npm test -- tests/conformance/project-loader-contract.test.mjs tests/core/kicad-archive-limits.test.mjs tests/core/kicad-project-loader.test.mjs tests/core/kicad-project-loader-full.test.mjs`

Expected: PASS with preserved hierarchy/PCM/jobset/rules/worksheet/library behavior.

- [ ] **Step 5: Commit canonical project loading**

```bash
git add src/core/kicad/ProjectLoader.mjs src/core/kicad/KicadArchiveReader.mjs src/core/kicad/KicadProjectEntryClassifier.mjs src/core/kicad/KicadProjectResultBuilder.mjs src/core/kicad/KicadProjectLoader.mjs src/core/kicad/KicadLibraryIndexBuilder.mjs src/project.mjs tests/conformance/project-loader-contract.test.mjs tests/core/kicad-archive-limits.test.mjs tests/core/kicad-project-loader.test.mjs tests/core/kicad-project-loader-full.test.mjs
git commit -m "feature: add bounded KiCad project loading"
```

### Task 6: Bind the shared worker protocol

**Files:**
- Create: `src/workers/parser.worker.mjs`
- Create: `tests/workers/kicad-worker-protocol.test.mjs`
- Create: `tests/workers/kicad-worker-cancellation.test.mjs`
- Create: `tests/workers/kicad-worker-transfer.test.mjs`
- Modify: `src/core/kicad/Parser.mjs`
- Modify: `src/core/kicad/KicadParseSession.mjs`
- Modify: `src/core/kicad/ProjectLoader.mjs`
- Modify: `src/workers/kicad-parser.worker.mjs` (temporary compatibility entrypoint)
- Modify: `tests/workers/kicad-parser-worker.test.mjs`

**Interfaces:**
- Consumes: `ToolkitWorkerProtocol`/`ParserWorkerClient` from `circuitjson-toolkit/parser`.
- Produces: exact versioned parse/loadProject/cancel/progress/result/error messages and direct/worker equivalence.

- [ ] **Step 1: Write failing protocol/cancel/transfer tests**

```js
test('KiCad worker returns the same envelope and preserves caller buffers by default', async () => {
    const input = kicadPcbBinaryInput()
    const direct = Parser.parse(input)
    const worker = await Parser.parseAsync(input, { worker: true, transferInput: false })
    assert.deepEqual(worker, direct)
    assert.equal(input.data.byteLength > 0, true)
    assert.equal(CircuitJsonDocumentContext.prepare(direct).statistics.validationPasses, 0)
    assert.equal(CircuitJsonDocumentContext.prepare(worker).statistics.validationPasses, 1)
})
```

- [ ] **Step 2: Run and verify legacy message failure**

Run: `npm test -- tests/workers/kicad-worker-protocol.test.mjs tests/workers/kicad-worker-cancellation.test.mjs tests/workers/kicad-worker-transfer.test.mjs`

Expected: FAIL because current worker recognizes `parse:file`, returns `parser:success`, and lacks project/cancel/progress behavior.

- [ ] **Step 3: Install the shared handler around canonical methods**

```js
ToolkitWorkerProtocol.install(globalThis, {
    parse: (input, options) => Parser.parseAsync(input, { ...options, worker: false }),
    loadProject: (entries, options) => ProjectLoader.loadAsync(entries, { ...options, worker: false })
})
```

Use the genuinely yielding `KicadParseSession` so active cancellation messages are processed during bounded syntax-node batches, not only before/after a synchronous parse. Use ordered common stages `detect/decode/project/validate/complete`; project-specific `classify`, `inflate`, `parse`, and `assemble` values belong in the optional progress `detail` field. Never post signal/callback objects or unrequested extension graphs. Keep `src/workers/kicad-parser.worker.mjs` as a tested forwarding compatibility entrypoint until Task 11 atomically removes its package export and records the migration.

- [ ] **Step 4: Run worker/parser/project suites**

Run: `npm test -- tests/workers/kicad-worker-protocol.test.mjs tests/workers/kicad-worker-cancellation.test.mjs tests/workers/kicad-worker-transfer.test.mjs tests/conformance/parser-contract.test.mjs tests/conformance/project-loader-contract.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit worker convergence**

```bash
git add src/workers/parser.worker.mjs src/workers/kicad-parser.worker.mjs src/core/kicad/Parser.mjs src/core/kicad/KicadParseSession.mjs src/core/kicad/ProjectLoader.mjs tests/workers/kicad-parser-worker.test.mjs tests/workers/kicad-worker-protocol.test.mjs tests/workers/kicad-worker-cancellation.test.mjs tests/workers/kicad-worker-transfer.test.mjs
git commit -m "feature: implement versioned KiCad parser worker"
```

### Task 7: Delegate query and interaction to shared context services

**Files:**
- Create: `src/query.mjs`
- Create: `src/interaction.mjs`
- Create: `src/extensions/KicadLoadedDesignNetlistAdapter.mjs`
- Create: `tests/conformance/query-interaction-contract.test.mjs`
- Modify: `src/netlist-query.mjs`
- Modify: `src/renderers.mjs`
- Modify: `src/ui/PcbInteractionLayerModel.mjs`
- Modify: `tests/core/netlist-query.test.mjs`
- Modify: `tests/ui/pcb-interaction-index.test.mjs`
- Remove after parity: `src/core/netlist-query/CircuitTraversal.mjs`
- Remove after parity: `src/core/netlist-query/ComponentGrouping.mjs`
- Remove after parity: `src/core/netlist-query/LoadedDesignNetlistService.mjs`
- Remove after parity: `src/core/netlist-query/QueryNetlistBuilder.mjs`
- Remove after parity: `src/core/netlist-query/RegexPattern.mjs`
- Remove after parity: `src/ui/PcbInteractionIndex.mjs`
- Remove after parity: `src/ui/PcbInteractionItemRegistry.mjs`

**Interfaces:**
- Consumes: core `QueryService`, `PcbInteractionIndex`, context, and current projected connectivity/geometry.
- Produces: identical bound shared APIs, differential legacy answer/hit tests, and a thin extension adapter for legacy loaded-design wrapper inputs.

- [ ] **Step 1: Write failing bound-service tests**

```js
test('KiCad query and interaction use one prepared context', () => {
    const document = Parser.parse(kicadPcbInput())
    const context = CircuitJsonDocumentContext.prepare(document)
    const query = QueryService.create(context)
    const interaction = PcbInteractionIndex.create(context)
    assert.deepEqual(query.findNets({ pattern: 'GND', match: 'exact' }).map((row) => row.name), ['GND'])
    assert.equal(interaction.pick({ x: 1, y: 1 }).side, 'top')
    assert.equal(interaction.statistics.spatialIndexBuilds, 1)
})
```

- [ ] **Step 2: Run and verify legacy static/raw-model failures**

Run: `npm test -- tests/conformance/query-interaction-contract.test.mjs tests/core/netlist-query.test.mjs tests/ui/pcb-interaction-index.test.mjs`

Expected: FAIL because query algorithms are local/static and interaction uses raw board plus `front`/`back`.

- [ ] **Step 3: Bind core services and retain only native conversion hooks**

```js
export { QueryService } from 'circuitjson-toolkit/query'
export { PcbInteractionIndex } from 'circuitjson-toolkit/interaction'
```

Use differential tests to prove every old query result/hit winner before deleting duplicate algorithms. Atomically change `src/netlist-query.mjs` and the interaction exports in `src/renderers.mjs` to shared services, and adapt `PcbInteractionLayerModel` to the bound index before deleting its local imports. Native layer metadata remains in an extension helper; shared hit records contain only stable ids, millimeter bounds, `top`/`bottom`, and serializable source references.

- [ ] **Step 4: Run all query/interaction suites**

Run: `npm test -- tests/conformance/query-interaction-contract.test.mjs tests/core/netlist-query.test.mjs tests/ui/pcb-interaction-index.test.mjs`

Expected: PASS with one prepared index across repeated operations.

- [ ] **Step 5: Commit shared service delegation**

```bash
git add src/query.mjs src/interaction.mjs src/netlist-query.mjs src/renderers.mjs src/ui/PcbInteractionLayerModel.mjs src/extensions/KicadLoadedDesignNetlistAdapter.mjs tests/conformance/query-interaction-contract.test.mjs tests/core/netlist-query.test.mjs tests/ui/pcb-interaction-index.test.mjs
git rm src/core/netlist-query/CircuitTraversal.mjs src/core/netlist-query/ComponentGrouping.mjs src/core/netlist-query/LoadedDesignNetlistService.mjs src/core/netlist-query/QueryNetlistBuilder.mjs src/core/netlist-query/RegexPattern.mjs src/ui/PcbInteractionIndex.mjs src/ui/PcbInteractionItemRegistry.mjs
git commit -m "refactor: delegate KiCad query and interaction"
```

### Task 8: Add canonical renderers and one PCB render plan

**Files:**
- Move: `src/ui/PcbSvgRenderer.mjs` to `src/ui/KicadPcbSvgRenderer.mjs`
- Move: `src/ui/SchematicSvgRenderer.mjs` to `src/ui/KicadSchematicSvgRenderer.mjs`
- Create: `src/ui/PcbSvgRenderer.mjs`
- Create: `src/ui/SchematicSvgRenderer.mjs`
- Create: `src/ui/KicadPcbRenderPlan.mjs`
- Create: `src/styles/renderers.css`
- Create: `tests/ui/common-renderer-contract.test.mjs`
- Create: `tests/ui/pcb-render-plan.test.mjs`
- Modify: `src/core/kicad/KicadCiArtifactBundleBuilder.mjs`
- Modify: `src/ui/BomTableRenderer.mjs`
- Modify: `src/renderers.mjs`
- Modify: `src/styles/kicad-renderers.css`
- Modify: `tests/ui/pcb-svg-*.test.mjs`
- Modify: `tests/ui/schematic-svg-*.test.mjs`

**Interfaces:**
- Consumes: document/context, core canonical renderers, native extension, and current deterministic KiCad render engines.
- Produces: canonical PCB/schematic/BOM signatures, fidelity modes, `renderLayers` result schema, `sheetId`, and one native render plan per layer set.

- [ ] **Step 1: Write failing renderer/fidelity/plan tests**

```js
test('KiCad PCB renderer uses top/bottom and one multi-layer plan', () => {
    const document = Parser.parse(kicadPcbInput())
    const result = PcbSvgRenderer.renderLayers(document, { side: 'bottom', layers: ['B.Cu', 'B.SilkS'], fidelity: 'native' })
    assert.equal(result.schema, 'ecad-toolkit.render-set.v1')
    assert.deepEqual(result.items.map((row) => row.side), ['bottom', 'bottom'])
    assert.equal(result.statistics.renderPlanBuilds, 1)
})
```

- [ ] **Step 2: Run and verify side/result/repeated-plan failures**

Run: `npm test -- tests/ui/common-renderer-contract.test.mjs tests/ui/pcb-render-plan.test.mjs`

Expected: FAIL because current code accepts `front`/`back`, returns an unversioned layer array, and filters/prepares separately per layer.

- [ ] **Step 3: Preserve native engines behind canonical facades**

```js
static render(document, options = {}) {
    const resolved = KicadDocumentContextResolver.prepare(document, { indexes: ['elements'] })
    return options.fidelity === 'canonical'
        ? CorePcbSvgRenderer.render(resolved, options)
        : KicadPcbSvgRenderer.renderPlan(resolved.getOrCreateDerived('kicad', KicadPcbRenderPlan.cacheKey(options), () => KicadPcbRenderPlan.prepare(resolved, options)))
}
```

`native` requires extension/asset prerequisites and throws typed errors; `auto` uses native only when complete. Extract plan preparation without changing native SVG bytes and keep all files below 1000 lines. Migrate native renderer suites and `KicadCiArtifactBundleBuilder` to `KicadPcbSvgRenderer`/`KicadSchematicSvgRenderer`. Until Task 11 performs the public cutover, `src/renderers.mjs` keeps those native engines under the legacy renderer names (while retaining Task 7's shared interaction exports); canonical contract tests import the new facades directly.

- [ ] **Step 4: Run canonical plus all native renderer suites**

Run: `npm test -- tests/ui/common-renderer-contract.test.mjs tests/ui/pcb-render-plan.test.mjs tests/ui/pcb-svg-*.test.mjs tests/ui/schematic-svg-*.test.mjs`

Expected: PASS with native differential output intact.

- [ ] **Step 5: Commit renderer convergence**

```bash
git add src/ui/PcbSvgRenderer.mjs src/ui/SchematicSvgRenderer.mjs src/ui/KicadPcbSvgRenderer.mjs src/ui/KicadSchematicSvgRenderer.mjs src/ui/KicadPcbRenderPlan.mjs src/ui/BomTableRenderer.mjs src/core/kicad/KicadCiArtifactBundleBuilder.mjs src/renderers.mjs src/styles tests/ui/common-renderer-contract.test.mjs tests/ui/pcb-render-plan.test.mjs tests/ui/pcb-svg-*.test.mjs tests/ui/schematic-svg-*.test.mjs
git commit -m "feature: align KiCad renderer facades"
```

### Task 9: Add manufacturing and simulation facades without losing exporters

**Files:**
- Create: `src/core/kicad/ManufacturingService.mjs`
- Create: `src/core/kicad/KicadManufacturingExportRegistry.mjs`
- Create: `src/manufacturing.mjs`
- Create: `src/simulation.mjs`
- Create: `tests/conformance/manufacturing-simulation-contract.test.mjs`
- Create: `tests/core/kicad-manufacturing-service.test.mjs`
- Modify: `src/core/kicad/CircuitJsonKicadProjectExporter.mjs`
- Modify: `src/core/kicad/CircuitJsonKicadLibraryExporter.mjs`
- Modify: `src/core/kicad/CircuitJsonKicadModExporter.mjs`
- Modify: `src/core/kicad/ProjectNetlistExporter.mjs`

**Interfaces:**
- Consumes: core manufacturing/simulation services and current reverse exporters.
- Produces: common inspection/export envelopes plus native `kicad-project`, `kicad-library`, and `kicad-module` ids; no implicit simulation engine/process/network.

- [ ] **Step 1: Write failing common/native export tests**

```js
test('KiCad manufacturing registry exposes common and native exports', () => {
    const document = Parser.parse(kicadPcbInput())
    assert.equal(ManufacturingService.listExports(document).some((row) => row.id === 'kicad-project'), true)
    const file = ManufacturingService.export(document, { id: 'kicad-module', options: { componentId: 'source_u1' } })
    assert.equal(typeof file.data, 'string')
})

test('KiCad simulation run requires an injected engine', async () => {
    await assert.rejects(() => SimulationService.run([], { analysisId: 'tran', parameters: {} }), { code: 'ERR_CAPABILITY_UNAVAILABLE' })
})
```

- [ ] **Step 2: Run and verify missing common services**

Run: `npm test -- tests/conformance/manufacturing-simulation-contract.test.mjs tests/core/kicad-manufacturing-service.test.mjs`

Expected: FAIL because canonical services/export file envelopes are absent.

- [ ] **Step 3: Wrap current exporters without rewriting fidelity**

```js
static export(document, request, options = {}) {
    const provider = KicadManufacturingExportRegistry.provider(request.id)
    if (!provider) return CoreManufacturingService.export(document, request, options)
    return provider.export(KicadDocumentContextResolver.prepare(document), request.options || {})
}
```

Project/library exports return deterministic ZIP `Uint8Array`; module export returns text; existing selected-part/PCM/CLI classes remain native extensions.

- [ ] **Step 4: Run manufacturing/reverse-export suites**

Run: `npm test -- tests/conformance/manufacturing-simulation-contract.test.mjs tests/core/kicad-manufacturing-service.test.mjs tests/core/circuit-json-kicad-*.test.mjs tests/core/kicad-pcm-package-tools.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit service/export facades**

```bash
git add src/core/kicad/ManufacturingService.mjs src/core/kicad/KicadManufacturingExportRegistry.mjs src/manufacturing.mjs src/simulation.mjs src/core/kicad/CircuitJsonKicadProjectExporter.mjs src/core/kicad/CircuitJsonKicadLibraryExporter.mjs src/core/kicad/CircuitJsonKicadModExporter.mjs src/core/kicad/ProjectNetlistExporter.mjs tests/conformance/manufacturing-simulation-contract.test.mjs tests/core/kicad-manufacturing-service.test.mjs
git commit -m "feature: expose KiCad manufacturing services"
```

### Task 10: Split scene3d and publish capability inventory

**Files:**
- Create: `src/scene3d/PcbScene3dBuilder.mjs`
- Create: `src/scene3d/PcbScene3dPreparator.mjs`
- Move: `src/scene3d.mjs` to `src/scene3d/KicadPcbScene3dBuilder.mjs`
- Create: `src/scene3d/KicadPcbScene3dDetailBuilder.mjs`
- Create: `src/scene3d/KicadSceneAssetResolver.mjs`
- Create: `src/core/kicad/ToolkitCapabilities.mjs`
- Create: `src/core/kicad/KicadCapabilityRecords.mjs`
- Create: `src/capabilities.mjs`
- Create: `tests/conformance/scene3d-contract.test.mjs`
- Create: `tests/conformance/toolkit-capabilities.test.mjs`
- Create: `src/scene3d.mjs` (replacement barrel)
- Modify: `src/core/kicad/KicadFeatureParity.mjs`
- Modify: `src/core/kicad/KicadToolkitCapabilities.mjs`
- Modify: `tests/scene3d-*.test.mjs`

**Interfaces:**
- Consumes: current 922-line native scene engine/helpers, shared scene/context contracts, ledger, injected asset resolver.
- Produces: canonical millimeter/right-handed-Z-up scene builder/preparator and per-operation capability rows derived from tested/documented ledger entries.

- [ ] **Step 1: Write failing scene/capability tests**

```js
test('KiCad scene and capabilities match common contracts', async () => {
    const document = Parser.parse(kicadPcbInput())
    const scene = await PcbScene3dPreparator.prepare(document, { fidelity: 'native', resolveAsset: fakeAssetResolver })
    assert.equal(scene.units, 'mm')
    assert.equal(scene.coordinateSystem, 'right-handed-z-up')
    const row = ToolkitCapabilities.inventory().find((entry) => entry.id === 'scene3d.prepare')
    assert.equal(row.status, 'native')
    assert.equal(row.tested && row.documented, true)
})
```

- [ ] **Step 2: Run and verify legacy scene/inventory shapes**

Run: `npm test -- tests/conformance/scene3d-contract.test.mjs tests/conformance/toolkit-capabilities.test.mjs`

Expected: FAIL because current scene is mil/`kicad-3d-y-up`, preparator is a sync wrapper, and capability inventory is an aggregate parity object.

- [ ] **Step 3: Extract native scene engine and concise native capability rows**

```js
static async prepare(document, options = {}) {
    const scene = PcbScene3dBuilder.build(document, options)
    return KicadSceneAssetResolver.resolve(scene, options.resolveAsset, options.signal)
}
```

Preserve WRL scaling, model path, stroke font, pad-stack, copper/silkscreen, placement metadata and exact native predicates. Migrate native scene suites to `KicadPcbScene3dBuilder`. Until Task 11 performs the public cutover, recreate `src/scene3d.mjs` as a temporary barrel that exports the native builder under the old name; canonical contract tests import `src/scene3d/PcbScene3dBuilder.mjs` directly. Derive `tested`/`documented` from the ledger, not a second exhaustive source list.

- [ ] **Step 4: Run scene/capability/native parity suites**

Run: `npm test -- tests/conformance/scene3d-contract.test.mjs tests/conformance/toolkit-capabilities.test.mjs tests/scene3d-*.test.mjs tests/core/kicad-capabilities-readiness.test.mjs tests/core/kicad-feature-parity.test.mjs`

Expected: PASS and split files remain below 1000 lines.

- [ ] **Step 5: Commit scene/capability convergence**

```bash
git add src/scene3d src/scene3d.mjs src/core/kicad/ToolkitCapabilities.mjs src/core/kicad/KicadCapabilityRecords.mjs src/core/kicad/KicadFeatureParity.mjs src/core/kicad/KicadToolkitCapabilities.mjs src/capabilities.mjs tests/conformance/scene3d-contract.test.mjs tests/conformance/toolkit-capabilities.test.mjs tests/scene3d-*.test.mjs
git commit -m "feature: converge KiCad scene and capabilities"
```

### Task 11: Cut over package exports, conformance, docs, and license notices

**Files:**
- Create: `src/extensions.mjs`
- Create: `src/extensions/parser.mjs`
- Create: `src/extensions/exporters.mjs`
- Create: `src/extensions/renderers.mjs`
- Create: `src/extensions/reports.mjs`
- Create: `src/extensions/scene3d.mjs`
- Create: `src/testing.mjs`
- Create: `tests/conformance/kicad-toolkit-contract.test.mjs`
- Create: `tests/package-tarball.test.mjs`
- Create: `docs/migration.md`
- Create: `docs/releases/1.1.0.md`
- Create: `docs/license-compliance.md`
- Create: `docs/provenance.md`
- Create: `LICENSES/AGPL-3.0-or-later.txt`
- Modify: `src/index.mjs`
- Modify: `src/parser.mjs`
- Modify: `src/renderers.mjs`
- Modify: `src/scene3d.mjs`
- Modify: `src/netlist-query.mjs`
- Remove: `src/workers/kicad-parser.worker.mjs` (after package-path migration)
- Remove: `src/styles/kicad-renderers.css` (after content moves to canonical stylesheet)
- Modify: `package.json`
- Modify: `examples/rp2040-minimal-design/example.mjs`
- Modify: `tests/api-entrypoints.test.mjs`
- Modify: `tests/package-layout.test.mjs`
- Modify: `README.md`
- Modify: `docs/api.md`
- Modify: `docs/model-format.md`
- Modify: `docs/testing.md`
- Modify: `docs/capabilities.md`
- Modify: `spec/library-scope.md`
- Modify: `NOTICE.md`
- Modify: `COMMERCIAL-LICENSE.md`

**Interfaces:**
- Consumes: all completed canonical classes, native extension owners, ledger, and `runToolkitContract`.
- Produces: exact common subpaths plus existing `./node`, compact canonical root, packed import proof, exhaustive migration guide, and AGPL dependency/provenance disclosure.

- [ ] **Step 1: Write failing root/subpath/tarball/conformance tests**

```js
test('KiCad root exposes exactly canonical classes', async () => {
    const root = await import('kicad-toolkit')
    assert.deepEqual(Object.keys(root).sort(), ToolkitContractFixtures.canonicalClassNames.toSorted())
    assert.deepEqual((await runToolkitContract(root, { fixtures: ToolkitContractFixtures.kicad() })).failures, [])
})
```

- [ ] **Step 2: Run and verify excess root/missing subpath failures**

Run: `npm test -- tests/conformance/kicad-toolkit-contract.test.mjs tests/api-entrypoints.test.mjs tests/package-layout.test.mjs tests/package-tarball.test.mjs`

Expected: FAIL because root has 126 symbols and common `/project`, `/interaction`, `/manufacturing`, `/simulation`, `/capabilities`, `/extensions`, `/testing` paths are missing.

- [ ] **Step 3: Wire exact public surface and complete every ledger mapping**

Root exports only the 14 canonical classes. Common paths include parser/project/renderers/interaction/query/manufacturing/simulation/scene3d/capabilities/extensions/testing, exact `./workers/parser.worker.mjs`, and exact `./styles/renderers.css`; existing `./node` remains additional. Cut the parser/renderer/scene barrels to canonical classes and move all native parser/library/export/report/render/scene/PCM/CLI utilities to focused extension barrels. Migrate the shipped RP2040 example and every test importing native symbols through the root or old barrels to canonical `Parser`/DocumentResult APIs or explicit extension/native implementation imports. Remove old `./netlist-query`, `./workers/kicad-parser.worker.mjs`, and `./styles/kicad-renderers.css` paths/files only with migration rows/tests. Record the exact core package/version/commit/license, adapted source paths, combined-work conclusion, and reviewer/date in the compliance/provenance docs.

- [ ] **Step 4: Run full package/docs/license verification**

Run: `npm test && npm run check:format && npm run check:features -- --strict && npm pack --dry-run && uvx --from 'reuse[charset-normalizer]==6.2.0' reuse lint && git diff --check`

Expected: PASS; migration includes every old export/method/option/field/hybrid property/side/worker path; notices distinguish GPL KiCad package and exact AGPL core runtime dependency.

- [ ] **Step 5: Commit public/docs cutover**

```bash
git add src package.json tests README.md docs spec NOTICE.md COMMERCIAL-LICENSE.md LICENSES/AGPL-3.0-or-later.txt
git commit -m "feature: publish converged KiCad package API"
```

### Task 12: Pass performance gates and prepare the 1.1.0 candidate

**Files:**
- Create: `benchmarks/results-v1.1.0.json`
- Create: `scripts/verify-packed-subpaths.mjs`
- Create: `tests/release-readiness.test.mjs`
- Create outside repositories: `../release-candidates/kicad-toolkit-1.1.0.tgz`
- Modify only when a benchmark identifies the owning path: `src/core/kicad/*.mjs`
- Modify only when a benchmark identifies the owning path: `src/ui/*.mjs`
- Modify only when a benchmark identifies the owning path: `src/scene3d/*.mjs`
- Modify only with the owning hot path: `tests/**/*.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/releases/1.1.0.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/publish.yml`
- Modify: `.github/workflows/publish-github-packages.yml`

**Interfaces:**
- Consumes: complete implementation, baselines, exact core candidate, and the coordinated matrix requirements that this candidate must later satisfy.
- Produces: version `1.1.0`, exact core dependency, numeric benchmark proof, packed subpath/workflow gates, and a clean candidate commit for the matrix.

- [ ] **Step 1: Write failing release/version/performance checks**

```js
test('KiCad release metadata is exact', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    assert.equal(pkg.version, '1.1.0')
    assert.equal(pkg.dependencies['circuitjson-toolkit'], '1.1.0')
    assert.equal((await readBenchmarkResult()).gates.every((gate) => gate.passed), true)
})
```

- [ ] **Step 2: Run readiness and immutable benchmark comparison**

Run: `npm test -- tests/release-readiness.test.mjs && npm run benchmark -- --compare benchmarks/baseline-v1.0.29.json`

Expected: readiness FAILS on `1.0.29`; benchmark identifies any remaining gate failures without changing primary selections.

- [ ] **Step 3: Fix only measured owning hot paths and set release metadata**

Remove remaining duplicate conversions, report scans, per-layer plan builds, linear registry lookups, and cloned extension graphs identified by benchmark evidence. Set package/lock version `1.1.0`, exact core dependency, and make publish workflows run packed-subpath verification.

- [ ] **Step 4: Run full candidate verification**

Run: `mkdir -p ../release-candidates && npm ci && npm ls circuitjson-toolkit && npm test && npm run check:format && npm run check:features -- --strict && npm run benchmark -- --compare benchmarks/baseline-v1.0.29.json --output benchmarks/results-v1.1.0.json && node scripts/verify-packed-subpaths.mjs && npm pack --dry-run && npm pack --pack-destination ../release-candidates && uvx --from 'reuse[charset-normalizer]==6.2.0' reuse lint && git diff --check`

Expected: primary medians improve at least 20 percent, clone bytes shrink at least 25 percent, other regressions stay within limits, and all 382 baseline behaviors remain preserved/mapped.

- [ ] **Step 5: Commit the KiCad candidate**

```bash
git add src tests benchmarks/results-v1.1.0.json scripts/verify-packed-subpaths.mjs package.json package-lock.json docs/releases/1.1.0.md .github/workflows
git commit -m "release: prepare kicad-toolkit 1.1.0"
```
