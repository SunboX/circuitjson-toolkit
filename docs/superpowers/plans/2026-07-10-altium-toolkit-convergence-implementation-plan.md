# Altium Toolkit Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release `altium-toolkit@1.2.0` with the canonical API, pure CircuitJSON results, fully retained native Altium extension capabilities, lazy expensive work, and substantially faster parsing/rendering/worker transfer.

**Architecture:** OLE/binary/ascii/native document decoding remains Altium-owned and is split into option-aware phases. A pure projector emits immutable CircuitJSON while `extensions.altium` holds only selected source-native facts and references, never a renamed renderer graph. Canonical facades combine shared core context/query/manufacturing/worker/error behavior with native schematic/PCB/3D fidelity engines; existing writers, batch exports, source clients, reports, rules/layers/rigid-flex, assets, and placement policies remain extension APIs.

**Tech Stack:** Node.js 20+, ESM, `node:test`, `fflate`, Three.js-compatible data models, exact `circuitjson-toolkit@1.1.0`, Prettier 3.

## Global Constraints

- Baseline is clean `altium-toolkit@1.1.41` at `9fa22e1028d96e583275093279bf6e03e8619588`; release is exactly `1.2.0`.
- Before Task 1, use `superpowers:using-git-worktrees` to create `/Users/afiedler/Documents/privat/Andrés_Werkstatt/altium-toolkit-api-convergence` from that clean baseline; leave the original worktree untouched. From that sibling worktree, `../release-candidates` resolves to the shared candidate directory.
- Install/test the packed core 1.1.0 candidate before production edits; do not copy its validation, context, query, worker, error, or conformance infrastructure.
- Re-export the exact core `CircuitJsonDocumentContext` and `ToolkitError`; Altium resolvers may only prepare contexts or require native extension/asset data.
- Preserve every meaningful Altium capability: SchDoc/PcbDoc/SchLib/PcbLib/IntLib/PrjPcb/PrjScr/PCBDwf, OLE, writers, batch/source export, rules/layers/rigid-flex, reports, assets, and exact 3D placement policies.
- Pure frozen CircuitJSON `0.0.446` is the shared model; remove `altium_toolkit_*` rows, enumerable compatibility fields, and hidden `rendererModel`.
- Defaults do not build raw/base64 records, optional reports, full payloads, STEP bounds, or duplicate native graphs.
- Native rendering/placement fidelity remains exact when requested; canonical rendering uses shared CircuitJSON; missing extension/asset prerequisites throw typed errors.
- Public common sides are `top`/`bottom`; all common options/results/methods/errors/subpaths match core exactly.
- Split every touched file already above 1000 lines instead of adding more logic to it.
- Primary large-PcbDoc parse/projection/worker-clone and multi-layer-render medians improve at least 20 percent; duplicate graph bytes shrink at least 25 percent.
- Tests use only synthetic/obfuscated repo-owned data; no native customer/vendor files or source-derived names.
- Task 1 adds repo-owned `test:focused`; every focused command uses `npm run test:focused -- <paths>`, then immediately before commit runs unfiltered `npm test && npm run check:format` and stops on either failure.
- Do not publish from this phase; produce a packed candidate for coordinated release.

## File Structure

- `src/core/altium/*Phase*.mjs`: bounded detection, stream directory, decode session, schematic/PCB feature assembly.
- `src/core/circuit-json/AltiumCircuitJsonProjector.mjs`: standards-only projection and source references.
- `src/core/altium/AltiumExtensionBuilder.mjs`: native feature/report/asset selection.
- `src/core/Parser.mjs`, `ProjectLoader.mjs`: canonical facades.
- `src/ui/Altium*Renderer.mjs`: native engines; unprefixed files are canonical facades.
- `src/scene3d/Altium*`: native builder/matcher/policy modules; unprefixed files are canonical scene facades.
- `src/extensions/`: focused native parser/OLE/library/report/renderer/scene barrels.
- `benchmarks/`, `scripts/`, `spec/`: baseline, ledger, package and performance gates.

---

### Task 1: Freeze feature/performance baselines and add core/license evidence

**Files:**
- Create: `spec/api-baseline-v1.1.41.json`
- Create: `spec/feature-preservation.json`
- Create: `benchmarks/AltiumBenchmarkFixtures.mjs`
- Create: `benchmarks/AltiumConvergenceBenchmark.mjs`
- Create: `benchmarks/baseline-v1.1.41.json`
- Create: `scripts/CapturePublicApi.mjs`
- Create: `scripts/CheckFeaturePreservation.mjs`
- Create: `scripts/PrepareCandidateCoreLock.mjs`
- Create: `tests/contracts/convergence-baselines.test.mjs`
- Create: `tests/contracts/core-contract-imports.test.mjs`
- Create: `tests/contracts/feature-preservation-check.test.mjs`
- Create: `docs/license-compliance.md`
- Create: `docs/provenance.md`
- Create: `LICENSES/AGPL-3.0-or-later.txt`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `NOTICE.md`
- Modify: `COMMERCIAL-LICENSE.md`

**Interfaces:**
- Consumes: 161 current root exports, five public subpaths, all methods/options/results/worker messages, 809 tests, and packed core candidate.
- Produces: exhaustive ledger, immutable primary cases `parse-project-worker.large-pcbdoc` and `render.multi-layer`, exact core import proof, provenance/license records, and benchmark/check scripts.

- [ ] **Step 1: Write failing baseline/import tests**

```js
test('Altium baselines and core contract are fixed before implementation', async () => {
    const api = JSON.parse(await readFile('spec/api-baseline-v1.1.41.json', 'utf8'))
    const benchmark = JSON.parse(await readFile('benchmarks/baseline-v1.1.41.json', 'utf8'))
    assert.equal(api.packageVersion, '1.1.41')
    assert.deepEqual(benchmark.cases.filter((row) => row.primary).map((row) => row.id), ['parse-project-worker.large-pcbdoc', 'render.multi-layer'])
    assert.equal(typeof (await import('circuitjson-toolkit/testing')).runToolkitContract, 'function')
})
```

- [ ] **Step 2: Install packed core and run the failing tests**

Run: `npm install --no-save --package-lock=false ../release-candidates/circuitjson-toolkit-1.1.0.tgz && npm run test:focused -- tests/contracts/convergence-baselines.test.mjs tests/contracts/core-contract-imports.test.mjs`

Expected: baseline test FAILS on missing files; core import test passes only if the candidate publishes all required subpaths/utilities.

- [ ] **Step 3: Implement deterministic capture/benchmark/ledger and license records**

Add `test:focused: "node --test"`, `capture:api`, `check:features`, and `benchmark` scripts. Benchmark parse/projection/clone, streams, reports, model registry, interaction, layer render, and small inputs. Each ledger row includes shared fields and test/doc mapping. The final `--strict` checker imports packed entrypoints, resolves each capability id against the inventory, verifies referenced test/doc paths, and is tested against stale/fictitious mappings. Record source path/commit/copyright/license before adapting duplicated code; document that Altium's commercial license does not automatically cover the AGPL core dependency. Run `npm install --save-exact ../release-candidates/circuitjson-toolkit-1.1.0.tgz && npm pkg set dependencies.circuitjson-toolkit=1.1.0 && node scripts/PrepareCandidateCoreLock.mjs && npm ci`; the script asserts tarball version/integrity, restores the lock root spec to exact `1.1.0`, and retains only the prepublication tarball resolution. The coordinated release plan replaces that resolution with registry metadata and proves packed contents again before publication.

- [ ] **Step 4: Generate and verify immutable baselines**

Run: `npm run capture:api && npm run benchmark -- --record benchmarks/baseline-v1.1.41.json && npm run check:features && npm run test:focused -- tests/contracts/convergence-baselines.test.mjs tests/contracts/core-contract-imports.test.mjs && npm test && npm run check:format`

Expected: PASS with primary cases fixed before production edits.

- [ ] **Step 5: Commit baseline/dependency evidence**

```bash
git add spec benchmarks scripts tests/contracts package.json package-lock.json NOTICE.md COMMERCIAL-LICENSE.md LICENSES/AGPL-3.0-or-later.txt docs/license-compliance.md docs/provenance.md
git commit -m "chore: record Altium convergence baselines"
```

### Task 2: Split the oversized parser into option-aware detection and decode phases

**Files:**
- Create: `src/core/altium/AltiumFileDetector.mjs`
- Create: `src/core/altium/AltiumParseOptions.mjs`
- Create: `src/core/altium/AltiumParseSession.mjs`
- Create: `src/core/altium/AltiumStreamDirectory.mjs`
- Create: `src/core/altium/SchematicDocumentModelParser.mjs`
- Create: `src/core/altium/SchematicDocumentFeatureAssembler.mjs`
- Create: `src/core/altium/PcbModelFeatureAssembler.mjs`
- Create: `tests/core/altium-file-detector.test.mjs`
- Create: `tests/core/altium-parse-phases.test.mjs`
- Modify: `src/core/altium/AltiumParser.mjs`
- Modify: `src/core/altium/PcbModelParser.mjs`
- Modify: `src/core/altium/PcbStreamExtractor.mjs`
- Modify: `src/core/altium/SchematicStreamExtractor.mjs`

**Interfaces:**
- Consumes: `{ fileName, data }`, normalized canonical/full-native profiles, current OLE/ASCII/native parsers.
- Produces: bounded file detection, lazy stream directory, cooperative phase checkpoints, and smaller orchestrators with byte-identical full-native output.

- [ ] **Step 1: Write failing detection/stream/phase tests**

```js
test('Altium detection routes by reliable evidence before printable scanning', () => {
    const session = AltiumParseSession.create(pcbDocInput(), AltiumParseOptions.canonical())
    assert.equal(AltiumFileDetector.detect(session).fileType, 'PcbDoc')
    assert.equal(session.statistics.printableScanBytes, 0)
})

test('canonical stream directory reads only requested streams', () => {
    const directory = AltiumStreamDirectory.open(fakeOleDocument())
    directory.read('Board6/Data')
    assert.deepEqual(directory.statistics.readStreams, ['Board6/Data'])
})
```

- [ ] **Step 2: Run and verify broad scan/all-stream failures**

Run: `npm run test:focused -- tests/core/altium-file-detector.test.mjs tests/core/altium-parse-phases.test.mjs`

Expected: FAIL because `AltiumParser` scans printable content before routing and extractors materialize full stream maps.

- [ ] **Step 3: Extract phases without changing native parse output**

```js
static decode(input, options = {}) {
    const session = AltiumParseSession.create(input, AltiumParseOptions.normalize(options))
    const detected = AltiumFileDetector.detect(session)
    return session.run(detected, AltiumStreamDirectory.open(session.oleDocument))
}
```

Route by extension/OLE magic/bounded evidence first; read streams on demand; retain `parseArrayBufferToRendererModel()` as explicit full-native extension path. Split `AltiumParser.mjs` and `PcbModelParser.mjs` orchestration below 1000 lines.

- [ ] **Step 4: Run phase plus full native parser suites**

Run: `npm run test:focused -- tests/core/altium-file-detector.test.mjs tests/core/altium-parse-phases.test.mjs && npm test`

Expected: 808 pass, 1 skip, with unchanged full-native models.

- [ ] **Step 5: Commit decode phases**

```bash
git add src/core/altium/AltiumFileDetector.mjs src/core/altium/AltiumParseOptions.mjs src/core/altium/AltiumParseSession.mjs src/core/altium/AltiumStreamDirectory.mjs src/core/altium/SchematicDocumentModelParser.mjs src/core/altium/SchematicDocumentFeatureAssembler.mjs src/core/altium/PcbModelFeatureAssembler.mjs src/core/altium/AltiumParser.mjs src/core/altium/PcbModelParser.mjs src/core/altium/PcbStreamExtractor.mjs src/core/altium/SchematicStreamExtractor.mjs tests/core/altium-file-detector.test.mjs tests/core/altium-parse-phases.test.mjs
git commit -m "refactor: split Altium decode phases"
```

### Task 3: Separate pure CircuitJSON from native Altium facts

**Files:**
- Create: `src/core/circuit-json/AltiumCircuitJsonProjector.mjs`
- Create: `src/core/circuit-json/CircuitJsonModelAdapterSchematic.mjs`
- Create: `src/core/circuit-json/CircuitJsonModelAdapterPcb.mjs`
- Create: `src/core/circuit-json/CircuitJsonModelAdapterMetadata.mjs`
- Create: `tests/contracts/circuit-json-projection.test.mjs`
- Modify: `src/core/circuit-json/CircuitJsonModelAdapter.mjs`
- Modify: `src/parser.mjs`
- Modify: `tests/package-metadata.test.mjs`
- Remove after parity: `src/core/circuit-json/CircuitJsonModelSchema.mjs`

**Interfaces:**
- Consumes: native document and shared strict validator/proof builder.
- Produces: `AltiumCircuitJsonProjector.project(nativeDocument, options) -> { model, nativeFacts, diagnostics, statistics }` with a standards-only model that the parser validates/freezes exactly once.

- [ ] **Step 1: Write failing purity/version/freeze tests**

```js
test('Altium projection contains only standard CircuitJSON', () => {
    const result = AltiumCircuitJsonProjector.project(createNativePcbDocument())
    assert.doesNotThrow(() => CircuitJsonDocument.assertModel(result.model))
    assert.equal(result.model.some((row) => row.type.startsWith('altium_toolkit_')), false)
    assert.equal(Object.hasOwn(result.model, 'rendererModel'), false)
    assert.equal(Object.hasOwn(result.model, 'pcb'), false)
})
```

- [ ] **Step 2: Run and verify local 0.0.433/hybrid failure**

Run: `npm run test:focused -- tests/contracts/circuit-json-projection.test.mjs`

Expected: FAIL because current adapter emits private rows, expando fields, hidden renderer model, and shallow local validation.

- [ ] **Step 3: Split projection domains and remove compatibility attachment**

```js
static project(nativeDocument, options = {}) {
    const model = [...CircuitJsonModelAdapterSchematic.project(nativeDocument, options), ...CircuitJsonModelAdapterPcb.project(nativeDocument, options)]
    return CircuitJsonModelAdapterMetadata.finalize(model, nativeDocument, options)
}
```

Keep native-only report/placement/layer/rule/raw/asset facts in keyed `nativeFacts`; use stable references into `model`; delete compatibility `Object.assign`, hidden properties, and private element emission only after differential standard-row tests pass. Projector tests invoke the shared validator, but production validation/freeze is deferred to Task 5's `DocumentResult.createValidated()` so the proof reaches context preparation without a second scan. In the same change, remove `CircuitJsonModelSchema` from `src/parser.mjs`, add its migration ledger row, and make `tests/package-metadata.test.mjs` import every remaining parser export so no barrel can point at a deleted module.

- [ ] **Step 4: Run projection and parser differential suites**

Run: `npm run test:focused -- tests/contracts/circuit-json-projection.test.mjs tests/core/circuit-json-*.test.mjs && npm test`

Expected: PASS with standards output preserved and pure.

- [ ] **Step 5: Commit projection separation**

```bash
git add src/core/circuit-json/AltiumCircuitJsonProjector.mjs src/core/circuit-json/CircuitJsonModelAdapterSchematic.mjs src/core/circuit-json/CircuitJsonModelAdapterPcb.mjs src/core/circuit-json/CircuitJsonModelAdapterMetadata.mjs src/core/circuit-json/CircuitJsonModelAdapter.mjs src/parser.mjs tests/contracts/circuit-json-projection.test.mjs tests/package-metadata.test.mjs spec/feature-preservation.json
git rm src/core/circuit-json/CircuitJsonModelSchema.mjs
git commit -m "refactor: separate Altium native facts from CircuitJSON"
```

### Task 4: Make extensions, assets, raw records, and reports lazy

**Files:**
- Create: `src/core/altium/AltiumExtensionFeatureCatalog.mjs`
- Create: `src/core/altium/AltiumExtensionBuilder.mjs`
- Create: `src/core/altium/AltiumAssetCatalog.mjs`
- Create: `src/core/altium/AltiumReportRegistry.mjs`
- Create: `tests/contracts/altium-extension-envelope.test.mjs`
- Create: `tests/core/altium-asset-catalog.test.mjs`
- Create: `tests/core/altium-report-registry.test.mjs`
- Create: `tests/core/altium-parser-lazy-options.test.mjs`
- Modify: `src/core/altium/AltiumParseOptions.mjs`
- Modify: `src/core/altium/AltiumParseSession.mjs`
- Modify: `src/core/altium/AltiumParser.mjs`
- Modify: `src/core/altium/PcbModelParser.mjs`
- Modify: `src/core/altium/PcbStreamExtractor.mjs`
- Modify: `src/core/altium/SchematicStreamExtractor.mjs`
- Modify: `src/core/altium/PcbRawRecordRegistry.mjs`
- Modify: `src/core/altium/SchematicImageParser.mjs`
- Modify: `src/core/altium/SchematicThumbnailParser.mjs`
- Modify: `src/core/altium/PcbEmbeddedFontExtractor.mjs`
- Modify: `src/core/altium/PcbEmbeddedModelExtractor.mjs`
- Modify: `src/core/altium/DraftsmanImagePayloadManifestBuilder.mjs`
- Modify: `src/core/altium/EmbeddedAssetReportBuilder.mjs`
- Modify: `src/core/altium/EmbeddedFileInventoryBuilder.mjs`

**Interfaces:**
- Consumes: parser options/session, projected nativeFacts, current report/raw/asset builders.
- Produces: exact `$meta`, selected extension features/reports, common assets, and content-identical requested raw/full behavior.

- [ ] **Step 1: Write failing omitted-work and requested-content tests**

```js
test('default Altium parse does not build raw/report/full asset payloads', () => {
    const session = parseWithStatistics(pcbDocInput())
    assert.equal(session.result.extensions.altium.rawRecords, undefined)
    assert.equal(session.result.assets.every((asset) => asset.data === null), true)
    assert.deepEqual(session.statistics.builtReports, [])
    assert.equal(session.statistics.base64Encodes, 0)
})
```

- [ ] **Step 2: Run and verify eager work failures**

Run: `npm run test:focused -- tests/contracts/altium-extension-envelope.test.mjs tests/core/altium-asset-catalog.test.mjs tests/core/altium-report-registry.test.mjs tests/core/altium-parser-lazy-options.test.mjs`

Expected: FAIL because defaults build raw/base64, route/review/statistics/QA, decoded payload, and STEP-bound work.

- [ ] **Step 3: Register and gate every native feature builder**

```js
static build(nativeDocument, nativeFacts, options = {}) {
    const selection = AltiumExtensionFeatureCatalog.select(options)
    return {
        $meta: selection.metadata,
        ...selection.features(nativeDocument, nativeFacts)
    }
}
```

Thread the normalized selection through `AltiumParseSession`, `AltiumParser`, `PcbModelParser`, `PcbStreamExtractor`, and `SchematicStreamExtractor` so the eager callers themselves skip raw collection, QA/report construction, base64 conversion, and payload extraction. Metadata assets use `data:null`; full mode decodes once; none omits records. Do not duplicate payload bytes in extensions. Full extensions exclude raw bytes unless `preserveRaw:true`; malformed omitted optional streams prove builders were not executed.

The retention tests cover `extensions: 'none' | 'metadata' | 'canonical' | 'full' | string[]`, `$meta.completeness: 'selected'`, exact included/omitted ids, every `decodeAssets` mode, multiple and unknown report ids, `preserveRaw`, and runtime-only `retainSource: 'reference'` with worker-auto direct fallback.

- [ ] **Step 4: Run lazy plus all requested-feature differential suites**

Run: `npm run test:focused -- tests/contracts/altium-extension-envelope.test.mjs tests/core/altium-asset-catalog.test.mjs tests/core/altium-report-registry.test.mjs tests/core/altium-parser-lazy-options.test.mjs && npm test`

Expected: PASS with requested native contents unchanged.

- [ ] **Step 5: Commit lazy native features**

```bash
git add src/core/altium/AltiumExtensionFeatureCatalog.mjs src/core/altium/AltiumExtensionBuilder.mjs src/core/altium/AltiumAssetCatalog.mjs src/core/altium/AltiumReportRegistry.mjs src/core/altium/AltiumParseOptions.mjs src/core/altium/AltiumParseSession.mjs src/core/altium/AltiumParser.mjs src/core/altium/PcbModelParser.mjs src/core/altium/PcbStreamExtractor.mjs src/core/altium/SchematicStreamExtractor.mjs src/core/altium/PcbRawRecordRegistry.mjs src/core/altium/SchematicImageParser.mjs src/core/altium/SchematicThumbnailParser.mjs src/core/altium/PcbEmbeddedFontExtractor.mjs src/core/altium/PcbEmbeddedModelExtractor.mjs src/core/altium/DraftsmanImagePayloadManifestBuilder.mjs src/core/altium/EmbeddedAssetReportBuilder.mjs src/core/altium/EmbeddedFileInventoryBuilder.mjs tests/contracts/altium-extension-envelope.test.mjs tests/core/altium-asset-catalog.test.mjs tests/core/altium-report-registry.test.mjs tests/core/altium-parser-lazy-options.test.mjs
git commit -m "feature: make Altium native features lazy"
```

### Task 5: Add canonical Parser envelopes and typed errors

**Files:**
- Create: `src/core/Parser.mjs`
- Create: `src/core/altium/AltiumDocumentResultBuilder.mjs`
- Create: `src/core/altium/AltiumErrorNormalizer.mjs`
- Create: `src/core/altium/AltiumDocumentContextResolver.mjs`
- Create: `tests/contracts/parser-contract.test.mjs`
- Create: `tests/contracts/document-envelope.test.mjs`
- Create: `tests/contracts/parser-error-contract.test.mjs`
- Modify: `src/parser.mjs`

**Interfaces:**
- Consumes: option-aware decoder, pure projector, extension/asset builders, core contracts/proof/context.
- Produces: canonical `Parser.supports/parse/tryParse/parseAsync`, one decode/projection/validation, clone-safe errors and stable source-derived ids.

- [ ] **Step 1: Write failing parser contract tests**

```js
test('Altium Parser accepts common input and returns DocumentResult', () => {
    const result = Parser.parse({ fileName: 'board.PcbDoc', data: fakePcbDocBytes() })
    assert.equal(result.schema, 'ecad-toolkit.document.v1')
    assert.equal(result.source.format, 'altium')
    assert.equal(Array.isArray(result.model), true)
    assert.equal(Object.hasOwn(result.model, 'pcb'), false)
    assert.equal(CircuitJsonDocumentContext.prepare(result).statistics.validationPasses, 0)
})

test('tryParse returns normalized failure', () => {
    const result = Parser.tryParse({ fileName: 'broken.PcbDoc', data: new Uint8Array([1]) })
    assert.equal(result.ok, false)
    assert.equal(result.error.name, 'ToolkitError')
})
```

- [ ] **Step 2: Run and verify filename-first/hybrid failure**

Run: `npm run test:focused -- tests/contracts/parser-contract.test.mjs tests/contracts/document-envelope.test.mjs tests/contracts/parser-error-contract.test.mjs`

Expected: FAIL because current methods take `(fileName, ArrayBuffer)` and return hybrid arrays/legacy safe shapes.

- [ ] **Step 3: Implement canonical facade and context resolver**

```js
static parse(input, options = {}) {
    try {
        const nativeDocument = AltiumParseSession.decode(input, options)
        const projection = AltiumCircuitJsonProjector.project(nativeDocument, options)
        return DocumentResult.createValidated(AltiumDocumentResultBuilder.fields(input, nativeDocument, projection, options))
    } catch (error) {
        throw AltiumErrorNormalizer.normalize(error, input)
    }
}
```

`parseAsync({worker:false})` uses direct cooperative phases; `retainSource:'reference'` is runtime-only and never serialized. `AltiumDocumentContextResolver` delegates core context and native requirement errors only.

- [ ] **Step 4: Run contract and complete parser suites**

Run: `npm run test:focused -- tests/contracts/parser-contract.test.mjs tests/contracts/document-envelope.test.mjs tests/contracts/parser-error-contract.test.mjs && npm test`

Expected: PASS.

- [ ] **Step 5: Commit canonical parser**

```bash
git add src/core/Parser.mjs src/core/altium/AltiumDocumentResultBuilder.mjs src/core/altium/AltiumErrorNormalizer.mjs src/core/altium/AltiumDocumentContextResolver.mjs src/parser.mjs tests/contracts/parser-contract.test.mjs tests/contracts/document-envelope.test.mjs tests/contracts/parser-error-contract.test.mjs
git commit -m "feature: add canonical Altium parser envelopes"
```

### Task 6: Add safe Altium project loading

**Files:**
- Create: `src/core/ProjectLoader.mjs`
- Create: `src/core/altium/AltiumProjectArchiveReader.mjs`
- Create: `src/core/altium/AltiumProjectReferenceResolver.mjs`
- Create: `src/core/altium/AltiumProjectResultBuilder.mjs`
- Create: `src/project.mjs`
- Create: `tests/contracts/project-loader-contract.test.mjs`
- Create: `tests/core/altium-project-archive-reader.test.mjs`
- Create: `tests/core/altium-project-reference-resolver.test.mjs`
- Modify: `src/core/altium/ProjectDesignBundleBuilder.mjs`
- Modify: `src/core/altium/ProjectDocumentGraphBuilder.mjs`
- Modify: `src/core/altium/ProjectHierarchyReportBuilder.mjs`
- Modify: `src/core/altium/ProjectVariantViewBuilder.mjs`
- Modify: `src/core/altium/ProjectBomPnpReconciliationBuilder.mjs`
- Modify: `src/core/altium/PrjPcbModelParser.mjs`
- Modify: `src/core/altium/PrjScrModelParser.mjs`
- Modify: `tests/core/prjpcb-model-parser.test.mjs`
- Modify: `tests/core/prjscr-model-parser.test.mjs`
- Modify: `tests/core/project-design-bundle-builder.test.mjs`
- Modify: `tests/core/project-document-graph-builder.test.mjs`
- Modify: `tests/core/project-hierarchy-report-builder.test.mjs`

**Interfaces:**
- Consumes: named entries/ZIP archives, Parser, project parsers, companion assets, shared archive rules.
- Produces: canonical `ProjectLoader.supports/load/tryLoad/loadAsync`, partial successes, deterministic project references/ids, and no project/document data duplication.

- [ ] **Step 1: Write failing project/reference/archive tests**

```js
test('Altium ProjectLoader resolves exact paths before unique basenames', async () => {
    const result = await ProjectLoader.loadAsync(createProjectEntriesWithRepeatedBasenames())
    assert.equal(result.schema, 'ecad-toolkit.project.v1')
    assert.equal(result.diagnostics.some((row) => row.code === 'ERR_PROJECT_REFERENCE_AMBIGUOUS'), true)
})

test('Altium archives reject unsafe duplicate paths', () => {
    assert.throws(() => AltiumProjectArchiveReader.validateNames(['a/../board.PcbDoc', 'board.PcbDoc']), { code: 'ERR_ARCHIVE_DUPLICATE_ENTRY' })
})
```

- [ ] **Step 2: Run and verify missing loader/safety behavior**

Run: `npm run test:focused -- tests/contracts/project-loader-contract.test.mjs tests/core/altium-project-archive-reader.test.mjs tests/core/altium-project-reference-resolver.test.mjs`

Expected: FAIL because canonical loader/archive limits/reference diagnostics are absent.

- [ ] **Step 3: Implement bounded stable project orchestration**

```js
static async loadAsync(entries, options = {}) {
    const expanded = await AltiumProjectArchiveReader.expand(entries, options)
    const parsed = await AltiumProjectResultBuilder.parseEntries(expanded, options)
    return AltiumProjectResultBuilder.build(parsed, AltiumProjectReferenceResolver.resolve(parsed), options)
}
```

Use exact common archive limits, safe POSIX paths, stable entry names, candidate-only ZIP inflation, typed partial diagnostics, and project-only assets/extensions. STEP/WRL/companions become `ToolkitAsset` records.

- [ ] **Step 4: Run project/native parser suites**

Run: `npm run test:focused -- tests/contracts/project-loader-contract.test.mjs tests/core/altium-project-archive-reader.test.mjs tests/core/altium-project-reference-resolver.test.mjs && npm test`

Expected: PASS with all PrjPcb/PrjScr/variant/hierarchy semantics preserved.

- [ ] **Step 5: Commit project loading**

```bash
git add src/core/ProjectLoader.mjs src/core/altium/AltiumProjectArchiveReader.mjs src/core/altium/AltiumProjectReferenceResolver.mjs src/core/altium/AltiumProjectResultBuilder.mjs src/core/altium/ProjectDesignBundleBuilder.mjs src/core/altium/ProjectDocumentGraphBuilder.mjs src/core/altium/ProjectHierarchyReportBuilder.mjs src/core/altium/ProjectVariantViewBuilder.mjs src/core/altium/ProjectBomPnpReconciliationBuilder.mjs src/core/altium/PrjPcbModelParser.mjs src/core/altium/PrjScrModelParser.mjs src/project.mjs tests/contracts/project-loader-contract.test.mjs tests/core/altium-project-archive-reader.test.mjs tests/core/altium-project-reference-resolver.test.mjs tests/core/prjpcb-model-parser.test.mjs tests/core/prjscr-model-parser.test.mjs tests/core/project-design-bundle-builder.test.mjs tests/core/project-document-graph-builder.test.mjs tests/core/project-hierarchy-report-builder.test.mjs
git commit -m "feature: add canonical Altium project loading"
```

### Task 7: Bind `ecad-toolkit.worker.v1` with real cancellation/progress

**Files:**
- Create: `src/workers/parser.worker.mjs`
- Create: `tests/workers/parser-worker-protocol.test.mjs`
- Create: `tests/contracts/parser-async-contract.test.mjs`
- Create: `tests/contracts/project-loader-async-contract.test.mjs`
- Create: `tests/contracts/worker-direct-equivalence.test.mjs`
- Modify: `src/core/Parser.mjs`
- Modify: `src/core/ProjectLoader.mjs`
- Modify: `src/core/altium/AltiumParseSession.mjs`
- Modify: `src/workers/altium-parser.worker.mjs` (temporary compatibility entrypoint)
- Modify: `tests/package-metadata.test.mjs`

**Interfaces:**
- Consumes: core `ToolkitWorkerProtocol`/`ParserWorkerClient` and canonical direct methods.
- Produces: exact parse/loadProject/cancel/progress/result/error messages, cooperative phase yields, clone-safe errors/results, and explicit transfer ownership.

- [ ] **Step 1: Write failing protocol/equivalence tests**

```js
test('Altium worker returns direct-equivalent envelope without detaching input', async () => {
    const input = { fileName: 'board.PcbDoc', data: fakePcbDocBytes() }
    const direct = Parser.parse(input)
    const worker = await Parser.parseAsync(input, { worker: true, transferInput: false })
    assert.deepEqual(worker, direct)
    assert.equal(input.data.byteLength > 0, true)
})

test('Altium worker cancels during an active decode phase', async () => {
    const controller = new AbortController()
    const stages = []
    const pending = Parser.parseAsync(largePcbDocInput(), { worker: true, signal: controller.signal, onProgress: (row) => { stages.push(row.stage); if (row.stage === 'decode') controller.abort() } })
    await assert.rejects(pending, { code: 'ERR_CANCELLED' })
    assert.deepEqual(stages, ['detect', 'decode'])
    assert.equal((await Parser.parseAsync(smallPcbDocInput(), { worker: true })).schema, 'ecad-toolkit.document.v1')
})
```

- [ ] **Step 2: Run and verify legacy worker failure**

Run: `npm run test:focused -- tests/workers/parser-worker-protocol.test.mjs tests/contracts/parser-async-contract.test.mjs tests/contracts/project-loader-async-contract.test.mjs tests/contracts/worker-direct-equivalence.test.mjs`

Expected: FAIL because current worker accepts only `parse:file`, posts a native dual graph, and lacks project/cancel/progress.

- [ ] **Step 3: Install shared endpoint around canonical methods**

```js
ToolkitWorkerProtocol.install(globalThis, {
    parse: (input, options) => Parser.parseAsync(input, { ...options, worker: false }),
    loadProject: (entries, options) => ProjectLoader.loadAsync(entries, { ...options, worker: false })
})
```

`Parser.parseAsync(..., { worker: false })` must drive the asynchronous phase runner rather than wrap `Parser.parse()` in an already-resolved promise. Yield to the worker event loop at detect/archive/stream/decode/project/validate/finalize boundaries, mapping them to ordered common stages `detect/decode/project/validate/complete` and optional details such as `archive`, `stream`, and `records`; protocol cancellation must abort the phase runner so `cancel` messages can be observed while work is active. Tests also assert stable full progress ordering, caller callback exceptions propagate unchanged, and the worker remains reusable after cancellation. Never post callbacks/signals or full/raw/unrequested extension graphs; copy partial typed-array views before optional transfer. Keep `src/workers/altium-parser.worker.mjs` as a tested forwarding entrypoint until Task 11 removes its package export atomically.

- [ ] **Step 4: Run worker plus parser/project contract suites**

Run: `npm run test:focused -- tests/workers/parser-worker-protocol.test.mjs tests/contracts/parser-async-contract.test.mjs tests/contracts/project-loader-async-contract.test.mjs tests/contracts/worker-direct-equivalence.test.mjs tests/contracts/parser-contract.test.mjs tests/contracts/project-loader-contract.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit worker convergence**

```bash
git add src/workers/parser.worker.mjs src/workers/altium-parser.worker.mjs src/core/Parser.mjs src/core/ProjectLoader.mjs src/core/altium/AltiumParseSession.mjs tests/package-metadata.test.mjs tests/workers/parser-worker-protocol.test.mjs tests/contracts/parser-async-contract.test.mjs tests/contracts/project-loader-async-contract.test.mjs tests/contracts/worker-direct-equivalence.test.mjs
git commit -m "feature: implement versioned Altium parser worker"
```

### Task 8: Delegate query/interaction and converge manufacturing/simulation

**Files:**
- Create: `src/query.mjs`
- Create: `src/interaction.mjs`
- Create: `src/manufacturing.mjs`
- Create: `src/simulation.mjs`
- Create: `src/core/altium/ManufacturingService.mjs`
- Create: `src/core/altium/AltiumManufacturingExportProvider.mjs`
- Create: `tests/contracts/shared-services.test.mjs`
- Modify: `tests/core/netlist-query.test.mjs`
- Modify: `tests/ui/pcb-interaction-index.test.mjs`
- Create: `tests/ui/pcb-interaction-layer-model.test.mjs`
- Modify: `src/netlist-query.mjs`
- Remove: `src/workers/altium-parser.worker.mjs` (after package-path migration)
- Remove: `src/styles/altium-renderers.css` (after content moves to canonical stylesheet)
- Modify: `src/renderers.mjs`
- Modify: `src/ui/PcbInteractionLayerModel.mjs`
- Remove after parity: `src/core/netlist-query/CircuitTraversal.mjs`
- Remove after parity: `src/core/netlist-query/ComponentGrouping.mjs`
- Remove after parity: `src/core/netlist-query/LoadedDesignNetlistService.mjs`
- Remove after parity: `src/core/netlist-query/QueryNetlistBuilder.mjs`
- Remove after parity: `src/core/netlist-query/RegexPattern.mjs`
- Remove after parity: `src/ui/PcbInteractionGeometry.mjs`
- Remove after parity: `src/ui/PcbInteractionIndex.mjs`
- Remove after parity: `src/ui/PcbInteractionItemRegistry.mjs`

**Interfaces:**
- Consumes: core query/interaction/manufacturing/simulation/context services and Altium native BOM/PnP/netlist/source-export builders.
- Produces: bound shared QueryService/PcbInteractionIndex, canonical manufacturing export provider, shared BOM HTML, and simulation only with injected engine.

- [ ] **Step 1: Write failing shared-service/differential tests**

```js
test('Altium common services reuse context and retain native export capability', () => {
    const document = Parser.parse(pcbDocInput())
    const query = QueryService.create(document)
    const interaction = PcbInteractionIndex.create(document)
    assert.equal(query.findComponents({ pattern: '^U', match: 'regex' }).length > 0, true)
    interaction.hitTest({ x: 1, y: 1 })
    interaction.hitTest({ x: 2, y: 2 })
    assert.equal(interaction.statistics.spatialIndexBuilds, 1)
    assert.equal(ManufacturingService.listExports(document).some((row) => row.id === 'pick-place-csv'), true)
})
```

- [ ] **Step 2: Run and verify duplicate/static service failures**

Run: `npm run test:focused -- tests/contracts/shared-services.test.mjs tests/core/netlist-query.test.mjs tests/ui/pcb-interaction-index.test.mjs`

Expected: FAIL because query/interaction algorithms are local/static and common service envelopes are absent.

- [ ] **Step 3: Bind shared services and native provider hooks**

```js
export { QueryService } from 'circuitjson-toolkit/query'
export { PcbInteractionIndex } from 'circuitjson-toolkit/interaction'
export { SimulationService } from 'circuitjson-toolkit/simulation'
```

Implement a concrete facade rather than relying on an undefined global provider hook:

```js
export class ManufacturingService {
    static inspect(document, options = {}) {
        return AltiumManufacturingExportProvider.augmentInspection(CoreManufacturingService.inspect(document, options), document, options)
    }

    static listExports(document, options = {}) {
        return AltiumManufacturingExportProvider.mergeExports(CoreManufacturingService.listExports(document, options), document, options)
    }

    static export(document, request, options = {}) {
        return AltiumManufacturingExportProvider.supports(request.id)
            ? AltiumManufacturingExportProvider.export(document, request, options)
            : CoreManufacturingService.export(document, request, options)
    }
}
```

Wrap existing deterministic native exports behind that provider. Change `src/netlist-query.mjs` to the shared `QueryService`, change `src/renderers.mjs` to the shared interaction export, and adapt `PcbInteractionLayerModel` before deleting its old index/geometry dependencies. Use differential tests for every old query/hit answer; preserve only serializable native source references.

- [ ] **Step 4: Run shared and legacy behavior suites**

Run: `npm run test:focused -- tests/contracts/shared-services.test.mjs tests/core/netlist-query.test.mjs tests/ui/pcb-interaction-index.test.mjs`

Expected: PASS with one context/index and no copied generic algorithms.

- [ ] **Step 5: Commit shared service convergence**

```bash
git add src/query.mjs src/interaction.mjs src/manufacturing.mjs src/simulation.mjs src/core/altium/ManufacturingService.mjs src/core/altium/AltiumManufacturingExportProvider.mjs src/netlist-query.mjs src/renderers.mjs src/ui/PcbInteractionLayerModel.mjs tests/contracts/shared-services.test.mjs tests/core/netlist-query.test.mjs tests/ui/pcb-interaction-index.test.mjs tests/ui/pcb-interaction-layer-model.test.mjs
git rm src/core/netlist-query/CircuitTraversal.mjs src/core/netlist-query/ComponentGrouping.mjs src/core/netlist-query/LoadedDesignNetlistService.mjs src/core/netlist-query/QueryNetlistBuilder.mjs src/core/netlist-query/RegexPattern.mjs src/ui/PcbInteractionGeometry.mjs src/ui/PcbInteractionIndex.mjs src/ui/PcbInteractionItemRegistry.mjs
git commit -m "refactor: delegate shared Altium services"
```

### Task 9: Split native schematic/PCB renderers behind canonical facades

**Files:**
- Move: `src/ui/SchematicSvgRenderer.mjs` to `src/ui/AltiumSchematicSvgRenderer.mjs`
- Move: `src/ui/PcbSvgRenderer.mjs` to `src/ui/AltiumPcbSvgRenderer.mjs`
- Create: `src/ui/SchematicSvgRenderer.mjs`
- Create: `src/ui/PcbSvgRenderer.mjs`
- Create: `src/ui/SchematicSvgRenderPlan.mjs`
- Create: `src/ui/SchematicSvgSemanticMetadataBuilder.mjs`
- Create: `src/ui/SchematicSvgOwnerGeometryRenderer.mjs`
- Create: `src/ui/SchematicSvgTextPlacement.mjs`
- Create: `src/ui/PcbSvgRenderPlan.mjs`
- Create: `src/ui/PcbSvgDetailPrimitiveRenderer.mjs`
- Create: `src/ui/PcbSvgSemanticMetadataBuilder.mjs`
- Create: `src/ui/PcbSvgGeometryRenderer.mjs`
- Create: `tests/contracts/renderer-contract.test.mjs`
- Create: `tests/ui/pcb-svg-render-layers.test.mjs`
- Modify: `src/core/altium/CiArtifactBundleBuilder.mjs`
- Modify: `src/ui/BomTableRenderer.mjs`
- Modify: `src/renderers.mjs`
- Modify: `tests/core/altium-parser/*.mjs`
- Modify: `tests/ui/renderers/*.mjs`
- Modify: `tests/ui/pcb-svg-*.test.mjs`

**Interfaces:**
- Consumes: document/context, core canonical renderer foundations, native extension/assets, current deterministic 3644/2904-line engines.
- Produces: canonical schematic/PCB/BOM signatures, fidelity behavior, sheet selection, and one PCB plan for all requested layers.

- [ ] **Step 1: Write failing facade/fidelity/plan tests**

```js
test('Altium native PCB layers reuse one plan and canonical side', () => {
    const result = PcbSvgRenderer.renderLayers(Parser.parse(pcbDocInput()), { side: 'bottom', layers: ['Bottom Layer', 'Bottom Overlay'], fidelity: 'native' })
    assert.equal(result.schema, 'ecad-toolkit.render-set.v1')
    assert.equal(result.items.every((row) => row.side === 'bottom'), true)
    assert.equal(result.statistics.renderPlanBuilds, 1)
})

test('native schematic rendering requires decoded image data', () => {
    assert.throws(() => SchematicSvgRenderer.render(metadataOnlyImageDocument(), { fidelity: 'native' }), { code: 'ERR_ASSET_DATA_REQUIRED' })
})
```

- [ ] **Step 2: Run and verify native-shape/repeated-render failures**

Run: `npm run test:focused -- tests/contracts/renderer-contract.test.mjs tests/ui/pcb-svg-render-layers.test.mjs`

Expected: FAIL because engines expect legacy native models and PCB layer rendering repeats the full path.

- [ ] **Step 3: Extract focused native modules and canonical facades**

```js
static render(document, options = {}) {
    const context = AltiumDocumentContextResolver.prepare(document, { indexes: ['elements'] })
    return options.fidelity === 'canonical'
        ? CorePcbSvgRenderer.render(context, options)
        : AltiumPcbSvgRenderer.renderPlan(context.getOrCreateDerived('altium', PcbSvgRenderPlan.cacheKey(options), () => PcbSvgRenderPlan.prepare(context, options)))
}
```

Keep native output byte-stable, move cohesive logic until every touched file is below 1000 lines, use `top`/`bottom`, and enforce explicit extension/asset requirements. Migrate native differential tests and `CiArtifactBundleBuilder` to `AltiumSchematicSvgRenderer`/`AltiumPcbSvgRenderer`. Until Task 11 performs the public cutover, `src/renderers.mjs` must temporarily re-export those native classes under the old names so the shipped examples and legacy root remain runnable; contract tests import the new canonical facades directly.

- [ ] **Step 4: Run all schematic/PCB/BOM renderer suites**

Run: `npm run test:focused -- tests/contracts/renderer-contract.test.mjs tests/ui/pcb-svg-render-layers.test.mjs tests/ui/schematic-svg-*.test.mjs tests/ui/pcb-svg-*.test.mjs && npm test`

Expected: PASS with native differentials unchanged.

- [ ] **Step 5: Commit renderer split/convergence**

```bash
git add src/ui src/core/altium/CiArtifactBundleBuilder.mjs src/renderers.mjs tests/contracts/renderer-contract.test.mjs tests/core/altium-parser tests/ui/renderers tests/ui/pcb-svg-render-layers.test.mjs tests/ui/pcb-svg-dimensions.test.mjs tests/ui/pcb-svg-semantic-metadata.test.mjs
git commit -m "feature: converge Altium renderer facades"
```

### Task 10: Split and accelerate native 3D behind canonical scenes

**Files:**
- Move: `src/ui/PcbScene3dBuilder.mjs` to `src/scene3d/AltiumPcbScene3dBuilder.mjs`
- Create: `src/scene3d/PcbScene3dBuilder.mjs`
- Create: `src/scene3d/PcbScene3dPreparator.mjs`
- Create: `src/scene3d/PcbScene3dBodyCandidateIndex.mjs`
- Create: `src/scene3d/PcbScene3dBodyMatcher.mjs`
- Create: `src/scene3d/PcbScene3dSilkscreenBuilder.mjs`
- Create: `src/scene3d/PcbScene3dFootprintResolver.mjs`
- Create: `src/scene3d/PcbScene3dSceneAdapter.mjs`
- Create: `tests/contracts/scene3d-contract.test.mjs`
- Create: `tests/ui/pcb-scene3d-body-candidate-index.test.mjs`
- Modify: `src/ui/PcbScene3dModelRegistry.mjs`
- Modify: `src/ui/PcbScene3dScenePreparator.mjs`
- Modify: `src/scene3d.mjs`
- Modify: `tests/ui/pcb-scene*.test.mjs`
- Modify: `tests/ui/altium-scene3d-*.test.mjs`

**Interfaces:**
- Consumes: context/native placement facts/assets/injected resolver and exact current placement/yaw/owner policies.
- Produces: canonical millimeter/right-handed-Z-up scene build/prepare, lookup maps, deferred STEP bounds, and broad-phase matching with exact predicates.

- [ ] **Step 1: Write failing scene/registry/candidate tests**

```js
test('Altium canonical scene preserves exact placement through indexed candidates', async () => {
    const document = Parser.parse(pcbDocInput(), { decodeAssets: 'full' })
    const scene = await PcbScene3dPreparator.prepare(document, { fidelity: 'native', resolveAsset: fakeAssetResolver })
    assert.equal(scene.units, 'mm')
    assert.equal(scene.coordinateSystem, 'right-handed-z-up')
    assert.equal(scene.externalPlacements[0].sourceRef.extension, 'altium')
    assert.deepEqual(scene.externalPlacements[0].rotationDeg, expectedCanonicalRotation)
    assert.equal(document.extensions.altium.placements[0].sourceYawDeg, expectedSourceYaw)
    assert.equal(scene.statistics.bodyCandidateIndexBuilds, 1)
})
```

- [ ] **Step 2: Run and verify legacy scene/linear lookup failures**

Run: `npm run test:focused -- tests/contracts/scene3d-contract.test.mjs tests/ui/pcb-scene3d-body-candidate-index.test.mjs`

Expected: FAIL because scene expects native renderer model/mils, registry scans repeatedly, STEP bounds are eager, and preparator uses old assumptions.

- [ ] **Step 3: Extract native builder and introduce maps/broad phase**

```js
static async prepare(document, options = {}) {
    const context = AltiumDocumentContextResolver.prepare(document, { indexes: ['spatial'] })
    const scene = context.getOrCreateDerived('altium', PcbScene3dBuilder.cacheKey(options), () => PcbScene3dBuilder.build(context, options))
    return PcbScene3dSceneAdapter.resolveAssets(scene, options.resolveAsset, options.signal)
}
```

Build normalized-path/basename/embedded-id/checksum maps once; defer bounds; candidate index may only reduce comparisons. Existing authored-anchor/source-yaw/bottom-half-turn/shape-stack/ownership predicates remain exact authority. Migrate `PcbScene3dScenePreparator` and every native differential test to `AltiumPcbScene3dBuilder`. Until Task 11 performs the public cutover, `src/scene3d.mjs` temporarily exports that native class under the old `PcbScene3dBuilder` name so existing examples remain runnable; canonical contract tests import `src/scene3d/PcbScene3dBuilder.mjs` directly.

- [ ] **Step 4: Run complete 3D placement/model suites**

Run: `npm run test:focused -- tests/contracts/scene3d-contract.test.mjs tests/ui/pcb-scene3d-body-candidate-index.test.mjs tests/ui/pcb-scene3d-*.test.mjs && npm test`

Expected: PASS with exact existing placements and split files below 1000 lines.

- [ ] **Step 5: Commit scene convergence**

```bash
git add src/ui/PcbScene3dBuilder.mjs src/scene3d src/ui/PcbScene3dModelRegistry.mjs src/ui/PcbScene3dScenePreparator.mjs src/scene3d.mjs tests/contracts/scene3d-contract.test.mjs tests/ui/pcb-scene*.test.mjs tests/ui/altium-scene3d-*.test.mjs
git commit -m "feature: converge Altium 3D scenes"
```

### Task 11: Publish capabilities, canonical subpaths, conformance, and migration docs

**Files:**
- Create: `src/core/ToolkitCapabilities.mjs`
- Create: `src/core/altium/AltiumCapabilityCatalog.mjs`
- Create: `src/capabilities.mjs`
- Create: `src/extensions.mjs`
- Create: `src/extensions/parser.mjs`
- Create: `src/extensions/ole.mjs`
- Create: `src/extensions/library.mjs`
- Create: `src/extensions/reports.mjs`
- Create: `src/extensions/renderers.mjs`
- Create: `src/extensions/scene3d.mjs`
- Create: `src/testing.mjs`
- Create: `src/styles/renderers.css`
- Create: `tests/contracts/toolkit-conformance.test.mjs`
- Create: `tests/package-exports.test.mjs`
- Create: `docs/capabilities.md`
- Create: `docs/migration.md`
- Create: `docs/releases/1.2.0.md`
- Modify: `src/index.mjs`
- Modify: `src/parser.mjs`
- Modify: `src/renderers.mjs`
- Modify: `src/scene3d.mjs`
- Modify: `src/netlist-query.mjs`
- Modify: `package.json`
- Modify: `examples/*.mjs`
- Modify: `examples/arduino-uno/*.mjs`
- Modify: `examples/arduino-uno/styles.css`
- Modify: `tests/examples/*.test.mjs`
- Modify: `tests/package-metadata.test.mjs`
- Modify: `tests/**/*.test.mjs`
- Modify: `README.md`
- Modify: `docs/api.md`
- Modify: `docs/model-format.md`
- Modify: `docs/testing.md`
- Modify: `spec/library-scope.md`
- Modify: `spec/library-compatibility.md`

**Interfaces:**
- Consumes: all canonical/native features, ledger, and `runToolkitContract`.
- Produces: exact common subpaths/root 14 classes, focused native extensions, operation inventory, packed import proof, exhaustive migration/docs/release notes.

- [ ] **Step 1: Write failing package/capability/conformance tests**

```js
test('Altium root is canonical and every capability is tested/documented', async () => {
    const root = await import('altium-toolkit')
    assert.deepEqual(Object.keys(root).sort(), ToolkitContractFixtures.canonicalClassNames.toSorted())
    assert.deepEqual((await runToolkitContract(root, { fixtures: ToolkitContractFixtures.altium() })).failures, [])
    assert.equal(ToolkitCapabilities.inventory().every((row) => row.tested && row.documented), true)
})
```

- [ ] **Step 2: Run and verify excess root/missing subpaths/docs**

Run: `npm run test:focused -- tests/contracts/toolkit-conformance.test.mjs tests/package-exports.test.mjs`

Expected: FAIL because root has 161 symbols and common project/interaction/manufacturing/simulation/capability/extension/testing paths are missing.

- [ ] **Step 3: Wire canonical root and focused native extension barrels**

Common exports include parser/project/renderers/interaction/query/manufacturing/simulation/scene3d/capabilities/extensions/testing, exact `./workers/parser.worker.mjs`, and exact `./styles/renderers.css`. Cut `src/parser.mjs`, `src/renderers.mjs`, `src/scene3d.mjs`, and the root down to their canonical classes while moving every native symbol to a focused extension barrel. Remove old `./netlist-query`, `./workers/altium-parser.worker.mjs`, and `./styles/altium-renderers.css` paths/files only after migration rows/tests. Migrate every shipped CLI/Arduino example and every test that imports native symbols through `src/index.mjs` or old package barrels to canonical envelopes/services or an explicit extension/native implementation import; run `tests/examples` plus self-package imports so no example/test relies on a removed root symbol. Capability ids are `${category}.${operation}` and derive tested/documented from ledger. Document every old export/method/option/field/hybrid property/side/worker path and retained native feature.

- [ ] **Step 4: Run complete conformance/package/docs/license gate**

Run: `npm test && npm run check:format && npm run check:features && npm pack --dry-run && uvx --from 'reuse[charset-normalizer]==6.2.0' reuse lint && git diff --check`

Expected: PASS; packed files include all subpaths/docs/notices and no unclassified feature.

- [ ] **Step 5: Commit package/docs cutover**

```bash
git add src package.json examples tests/examples tests/package-metadata.test.mjs tests/contracts/toolkit-conformance.test.mjs tests/package-exports.test.mjs README.md docs spec
git commit -m "feature: publish converged Altium package API"
```

### Task 12: Pass numeric gates and prepare the 1.2.0 candidate

**Files:**
- Create: `benchmarks/results-v1.2.0.json`
- Create: `scripts/VerifyPackedEntrypoints.mjs`
- Create: `tests/release-readiness.test.mjs`
- Create outside repositories: `../release-candidates/altium-toolkit-1.2.0.tgz`
- Modify only when a benchmark identifies the owning path: `src/core/altium/*.mjs`
- Modify only when a benchmark identifies the owning path: `src/ui/*.mjs`
- Modify only when a benchmark identifies the owning path: `src/scene3d/*.mjs`
- Modify only with the owning hot path: `tests/**/*.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/releases/1.2.0.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/publish.yml`
- Modify: `.github/workflows/publish-github-packages.yml`

**Interfaces:**
- Consumes: complete implementation, fixed baselines, exact core candidate, and the coordinated matrix requirements that this candidate must later satisfy.
- Produces: exact `1.2.0`/core dependency, passing performance/clone gates, workflow package checks, and a clean tarball candidate for the matrix.

- [ ] **Step 1: Write failing version/performance readiness test**

```js
test('Altium release metadata and benchmark gates are exact', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    assert.equal(pkg.version, '1.2.0')
    assert.equal(pkg.dependencies['circuitjson-toolkit'], '1.1.0')
    assert.equal((await readBenchmarkResult()).gates.every((row) => row.passed), true)
})
```

- [ ] **Step 2: Run readiness and baseline comparison**

Run: `npm run test:focused -- tests/release-readiness.test.mjs && npm run benchmark -- --compare benchmarks/baseline-v1.1.41.json`

Expected: readiness FAILS on `1.1.41`; benchmark lists any remaining immutable-case failures.

- [ ] **Step 3: Fix only measured owning hot paths and set release metadata**

Remove remaining repeated streams, report scans, base64/payload copies, validation/index passes, per-layer plans, linear registry lookups, and cloned extension graphs identified by evidence. Set exact core/runtime and `1.2.0` package/lock versions; make workflows verify packed subpaths.

- [ ] **Step 4: Run complete candidate verification**

Run: `mkdir -p ../release-candidates && npm ci && npm ls circuitjson-toolkit && npm test && npm run check:format && npm run check:features -- --strict && npm run benchmark -- --compare benchmarks/baseline-v1.1.41.json --output benchmarks/results-v1.2.0.json && node scripts/VerifyPackedEntrypoints.mjs && npm pack --dry-run && npm pack --pack-destination ../release-candidates && uvx --from 'reuse[charset-normalizer]==6.2.0' reuse lint && git diff --check`

Expected: both primary medians improve at least 20 percent, clone bytes shrink at least 25 percent, all other regressions stay within limits, and baseline 808-pass/1-skip behavior remains mapped/preserved.

- [ ] **Step 5: Commit the Altium candidate**

```bash
git add src tests benchmarks/results-v1.2.0.json scripts/VerifyPackedEntrypoints.mjs package.json package-lock.json docs/releases/1.2.0.md .github/workflows
git commit -m "release: prepare altium-toolkit 1.2.0"
```
