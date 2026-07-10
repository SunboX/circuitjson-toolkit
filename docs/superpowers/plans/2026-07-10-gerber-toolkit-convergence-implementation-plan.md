# Gerber Toolkit Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release `gerber-toolkit@0.2.0` with the canonical toolkit API, pure CircuitJSON projection, lossless native CAM extensions, and at least 20-percent faster primary large-package cases.

**Architecture:** Existing Gerber/Excellon decoders remain the lossless native engine. A focused adapter projects representable board/fabrication geometry to immutable CircuitJSON, while `extensions.gerber` retains ordered polarity, aperture, attribute, drill, route, and provenance data. Canonical facades delegate shared query/manufacturing/error/context/worker behavior to exact `circuitjson-toolkit@1.1.0` and keep source-faithful rendering/scene logic local.

**Tech Stack:** Node.js 20+, ESM, `node:test`, `fflate`, exact `circuitjson-toolkit@1.1.0`, Prettier 3.

## Global Constraints

- Baseline is `gerber-toolkit@0.1.21` at `11ba9df32ce966d6626f99f444909ff6c50d2281`; release is exactly `0.2.0`.
- Before Task 1, use `superpowers:using-git-worktrees` to create `/Users/afiedler/Documents/privat/Andrés_Werkstatt/gerber-toolkit-api-convergence` from that clean baseline; leave the original worktree untouched. From that sibling worktree, `../release-candidates` resolves to the shared candidate directory.
- Depend on exact `circuitjson-toolkit@1.1.0`; do not duplicate its contexts, query algorithms, error types, worker protocol, or conformance harness.
- Re-export the exact core `CircuitJsonDocumentContext` and `ToolkitError`; Gerber resolvers may only add native extension/fidelity requirements and derived-cache keys.
- Parser input is `{ fileName, data }`; parser/project results match `ecad-toolkit.document.v1` and `ecad-toolkit.project.v1` exactly.
- Standard model rows validate against CircuitJSON `0.0.446`; never invent components, nets, BOM rows, or assembly models.
- `extensions.gerber` is the only home for ordered CAM polarity, apertures/macros/blocks, file/object attributes, drill tooling/routes/slots, and source provenance.
- Native composite/separated CAM rendering remains exact; canonical CircuitJSON rendering may not replace polarity-sensitive native output.
- All common entrypoints/classes resolve; inapplicable schematic/BOM/component/net/simulation operations report `unavailable` and throw `ERR_CAPABILITY_UNAVAILABLE`.
- Primary archive parse/projection and mask/drill hit-test benchmarks improve at least 20 percent; non-primary large cases regress at most 5 percent, small cases regress at most 10 percent, and default result/structured-clone bytes do not grow.
- Files stay below 1000 lines, use repository formatting, and add JSDoc to every function/method.
- Tests use only synthetic repo-owned Gerber/Excellon data and repo-owned commands.
- Every focused command in a task uses `npm test -- <paths>`; immediately before that task's commit, also run unfiltered `npm test && npm run check:format` and stop on either failure.
- Do not publish from this phase; produce a packed candidate for coordinated release.

## File Structure

- `src/core/circuit-json/`: native-to-CircuitJSON projection and provenance.
- `src/core/contracts/`: Gerber envelope/extension builders and document resolution.
- `src/core/performance/`: incremental command reading, structural cloning, and archive classification.
- `src/core/Parser.mjs`, `ProjectLoader.mjs`, `ToolkitCapabilities.mjs`: canonical facades.
- `src/ui/PcbSvgRenderer.mjs` and `GerberPcbRenderPlan.mjs`: canonical rendering with native fidelity.
- `src/scene3d/`: split data-only builder/preparator modules.
- `benchmarks/`, `scripts/`, `spec/`: baselines, feature ledger, benchmark gate, and package checks.

---

### Task 1: Freeze Gerber API and performance baselines

**Files:**
- Create: `spec/api-baseline-v0.1.21.json`
- Create: `spec/feature-preservation.json`
- Create: `benchmarks/GerberBenchmarkData.mjs`
- Create: `benchmarks/GerberBenchmarkSuite.mjs`
- Create: `benchmarks/GerberLegacyProjectionBenchmarkAdapter.mjs`
- Create: `benchmarks/baseline-v0.1.21.json`
- Create: `scripts/capture-api-baseline.mjs`
- Create: `scripts/check-feature-preservation.mjs`
- Create: `scripts/run-benchmarks.mjs`
- Create: `tests/convergence-baselines.test.mjs`
- Create: `tests/feature-preservation-check.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: ten current root exports, four package subpaths, 58 passing tests, and synthetic parser/render fixtures.
- Produces: complete ledger, `npm run check:features`, `npm run benchmark`, immutable primary benchmark selections, and structural checksums.

- [ ] **Step 1: Write the failing baseline test**

```js
test('Gerber convergence baselines cover every public export and primary case', async () => {
    const api = JSON.parse(await readFile('spec/api-baseline-v0.1.21.json', 'utf8'))
    const ledger = JSON.parse(await readFile('spec/feature-preservation.json', 'utf8'))
    const benchmark = JSON.parse(await readFile('benchmarks/baseline-v0.1.21.json', 'utf8'))
    assert.equal(api.packageVersion, '0.1.21')
    assert.equal(ledger.length >= api.exports.length, true)
    assert.deepEqual(benchmark.cases.filter((row) => row.primary).map((row) => row.id), ['archive-parse-projection', 'mask-drill-hit-test'])
})
```

- [ ] **Step 2: Run and verify missing artifacts**

Run: `npm test -- tests/convergence-baselines.test.mjs`

Expected: FAIL with `ENOENT` for `spec/api-baseline-v0.1.21.json`.

- [ ] **Step 3: Implement deterministic capture/check/benchmark scripts**

Add scripts:

```json
{
    "capture:api": "node scripts/capture-api-baseline.mjs",
    "check:features": "node scripts/check-feature-preservation.mjs",
    "benchmark": "node scripts/run-benchmarks.mjs"
}
```

Each ledger row must include `package`, `feature`, `kind`, `capabilityId`, `disposition`, `replacement`, four-package `availability`, `reason`, `tests`, and `documentation`. The final `--strict` checker imports packed entrypoints, resolves each capability id against the inventory, verifies every referenced test/doc path, and is covered against stale/fictitious mappings. Benchmark rows record environment, fixture checksum, warmups, samples, median milliseconds, result/clone bytes, and heap observations. For pre-adapter `archive-parse-projection`, use a benchmark-only generic legacy-output projection adapter, freeze its structural checksum, and require Task 2's production projection to match that workload before comparing timings. Also record non-primary `step-repeat-large`, `separated-render-large`, `worker-clone-default`, and small-input cases before implementation.

- [ ] **Step 4: Generate and verify baselines**

Run: `npm run capture:api && npm run benchmark -- --record benchmarks/baseline-v0.1.21.json && npm run check:features && npm test -- tests/convergence-baselines.test.mjs`

Expected: PASS with both immutable primary cases marked before implementation.

- [ ] **Step 5: Commit baseline artifacts**

```bash
git add spec benchmarks scripts package.json tests/convergence-baselines.test.mjs tests/feature-preservation-check.test.mjs
git commit -m "chore: record Gerber convergence baselines"
```

### Task 2: Add exact core dependency and project Gerber boards to CircuitJSON

**Files:**
- Create: `src/core/circuit-json/GerberCircuitJsonAdapter.mjs`
- Create: `src/core/circuit-json/GerberCircuitJsonBoardBuilder.mjs`
- Create: `src/core/circuit-json/GerberCircuitJsonFeatureBuilder.mjs`
- Create: `tests/gerber-circuitjson-adapter.test.mjs`
- Create: `scripts/prepare-candidate-core-lock.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: normalized output from `src/core/gerber/GerberParser.mjs` and validator/context contracts from `circuitjson-toolkit@1.1.0`.
- Produces: `GerberCircuitJsonAdapter.project(nativeDocument, options)` returning `{ model, elementProvenance, diagnostics, statistics }`.

- [ ] **Step 1: Write failing projection tests for every representable feature**

Run: `npm install --no-save --package-lock=false ../release-candidates/circuitjson-toolkit-1.1.0.tgz`

```js
test('Gerber adapter projects valid geometry without fabricated semantics', () => {
    const result = GerberCircuitJsonAdapter.project(createSyntheticFabricationDocument())
    assert.doesNotThrow(() => CircuitJsonDocument.assertModel(result.model))
    assert.equal(result.model.some((row) => row.type === 'pcb_board'), true)
    assert.equal(result.model.some((row) => row.type === 'pcb_trace'), true)
    assert.equal(result.model.some((row) => row.type === 'pcb_hole'), true)
    assert.equal(result.model.some((row) => row.type === 'source_component'), false)
    assert.equal(result.model.some((row) => row.type.startsWith('gerber_toolkit_')), false)
    assert.equal(structuralChecksum(result.model), baselineLegacyProjectionChecksum)
})
```

- [ ] **Step 2: Run and verify missing adapter**

Run: `npm test -- tests/gerber-circuitjson-adapter.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `GerberCircuitJsonAdapter.mjs`.

- [ ] **Step 3: Install the packed core candidate and implement structural projection**

First implement `prepare-candidate-core-lock.mjs`, then run `npm install --save-exact ../release-candidates/circuitjson-toolkit-1.1.0.tgz && npm pkg set dependencies.circuitjson-toolkit=1.1.0 && node scripts/prepare-candidate-core-lock.mjs && npm ci`.

`prepare-candidate-core-lock.mjs` asserts the installed tarball is exactly `1.1.0`, changes only the lock root dependency spec back to exact `1.1.0`, and deliberately retains the tarball resolution/integrity so clean prepublication `npm ci` works. The coordinated release plan replaces only that candidate resolution with registry metadata after core publication, then proves the packed source contents again before publishing Gerber.

```js
static project(nativeDocument, options = {}) {
    const board = GerberCircuitJsonBoardBuilder.build(nativeDocument)
    const features = GerberCircuitJsonFeatureBuilder.build(nativeDocument, options)
    const model = [board, ...features.elements].filter(Boolean)
    return { model, elementProvenance: features.provenance, diagnostics: features.diagnostics, statistics: features.statistics }
}
```

Map board outlines/cutouts, traces/arcs, structurally justified flashes, holes/plated holes/vias/slots, dark regions, and supported artwork. Keep clear-polarity order and unsupported aperture facts only in provenance/native extension. Adapter unit tests validate the returned array, but production validation/freeze occurs exactly once in Task 3 through `DocumentResult.createValidated()` so its proof reaches the context.

- [ ] **Step 4: Run adapter and legacy parser tests**

Run: `npm test -- tests/gerber-circuitjson-adapter.test.mjs tests/gerber-parser.test.mjs tests/gerber-parity.test.mjs`

Expected: PASS without native parser output changes.

- [ ] **Step 5: Commit the projection**

```bash
git add package.json package-lock.json scripts/prepare-candidate-core-lock.mjs src/core/circuit-json tests/gerber-circuitjson-adapter.test.mjs
git commit -m "feature: project Gerber fabrication to CircuitJSON"
```

### Task 3: Build canonical envelopes, parser methods, and extension completeness

**Files:**
- Create: `src/core/contracts/GerberDocumentResultBuilder.mjs`
- Create: `src/core/contracts/GerberDocumentResolver.mjs`
- Create: `src/core/contracts/GerberParserInput.mjs`
- Create: `src/core/contracts/GerberParserOptions.mjs`
- Create: `src/core/gerber/GerberParseSession.mjs`
- Create: `src/core/gerber/GerberReportRegistry.mjs`
- Create: `src/core/performance/GerberCommandReader.mjs`
- Create: `src/core/Parser.mjs`
- Create: `tests/gerber-parser-contract.test.mjs`
- Create: `tests/gerber-parser-options.test.mjs`
- Modify: `src/parser.mjs`
- Modify: `src/core/gerber/GerberParser.mjs`

**Interfaces:**
- Consumes: native parser, CircuitJSON adapter, shared `DocumentResult`, `ToolkitError`, and parser option semantics.
- Produces: `Parser.supports/parse/tryParse/parseAsync`, pure model envelope, `$meta` completeness, explicit omissions, and opt-in raw/report data.

- [ ] **Step 1: Write failing canonical parser tests**

```js
test('Gerber Parser returns the canonical envelope and lossless native extension', () => {
    const result = Parser.parse({ fileName: 'top.gtl', data: syntheticGerberText() })
    assert.equal(result.schema, 'ecad-toolkit.document.v1')
    assert.equal(result.source.format, 'gerber')
    assert.equal(Object.hasOwn(result.model, 'pcb'), false)
    assert.equal(result.extensions.gerber.$meta.completeness, 'canonical')
    assert.equal(Array.isArray(result.extensions.gerber.layers), true)
})

test('Gerber Parser.tryParse normalizes parser failures', () => {
    const result = Parser.tryParse({ fileName: 'bad.gbr', data: '%FS' })
    assert.equal(result.ok, false)
    assert.equal(result.error.name, 'ToolkitError')
})

test('Gerber parser implements every common selection mode', async () => {
    const metadata = Parser.parse({ fileName: 'top.gtl', data: syntheticGerberText() }, { extensions: 'metadata', decodeAssets: 'none' })
    const selected = Parser.parse({ fileName: 'top.gtl', data: syntheticGerberText() }, { extensions: ['apertures'], reports: ['aperture-usage'], retainSource: 'reference' })
    assert.equal(metadata.extensions.gerber.$meta.completeness, 'metadata')
    assert.equal(selected.extensions.gerber.$meta.completeness, 'selected')
    assert.deepEqual(selected.extensions.gerber.$meta.included, ['apertures'])
    assert.equal(selected.assets.length, 0)
    assert.equal(await Parser.parseAsync({ fileName: 'top.gtl', data: syntheticGerberText() }, { retainSource: 'reference', worker: 'auto' }).then((row) => row.source.format), 'gerber')
    assert.throws(() => Parser.parse({ fileName: 'top.gtl', data: syntheticGerberText() }, { worker: true }), { code: 'ERR_WORKER_SYNC_UNAVAILABLE' })
})

test('direct async Gerber parsing cancels during command batches', async () => {
    const controller = new AbortController()
    const pending = Parser.parseAsync(largeStepRepeatInput(), { worker: false, signal: controller.signal, onProgress: (row) => row.stage === 'decode' && row.detail === 'commands' && controller.abort() })
    await assert.rejects(pending, { code: 'ERR_CANCELLED' })
})
```

- [ ] **Step 2: Run and verify missing canonical parser**

Run: `npm test -- tests/gerber-parser-contract.test.mjs`

Expected: FAIL because `Parser` is absent from `src/parser.mjs`.

- [ ] **Step 3: Implement one native decode, one projection, and one validation**

```js
static parse(input, options = {}) {
    try {
        const parsed = GerberParseSession.parse(GerberParserInput.normalize(input), GerberParserOptions.normalize(options))
        return DocumentResult.createValidated(GerberDocumentResultBuilder.fields(parsed))
    } catch (error) {
        throw ToolkitError.from(error, { code: 'ERR_GERBER_PARSE', category: 'parse', format: 'gerber', source: String(input?.fileName || '') })
    }
}
```

`GerberParseSession.parseAsync()` executes the same detect/decode/project/validate phases with event-loop yields and cancellation checkpoints; Task 3 replaces eager command tokenization with `GerberCommandReader` bounded batches so active direct cancellation already works before the worker task. `Parser.parseAsync(..., { worker: false })` uses it directly. `extensions: 'none'` returns only `$meta`; `metadata` returns bounded file/layer/tool metadata; feature-id arrays produce `selected`; `canonical` retains ordered CAM facts needed for exact rendering; `full` adds all documented native features; `preserveRaw` alone controls raw source retention. `GerberReportRegistry` exposes deterministic documented report ids such as `aperture-usage` and `drill-tool-summary`. Gerber has no embedded payload assets, so every `decodeAssets` mode returns the documented empty asset list. `retainSource: 'reference'` is runtime-only, forces worker auto to direct async, and conflicts with explicit `worker: true` using a typed option error.

- [ ] **Step 4: Run canonical and legacy parser suites**

Run: `npm test -- tests/gerber-parser-contract.test.mjs tests/gerber-parser-options.test.mjs tests/gerber-parser.test.mjs tests/gerber-parity.test.mjs`

Expected: PASS with no private CircuitJSON rows or hybrid fields.

- [ ] **Step 5: Commit canonical parsing**

```bash
git add src/core/contracts src/core/gerber/GerberParseSession.mjs src/core/gerber/GerberReportRegistry.mjs src/core/gerber/GerberParser.mjs src/core/performance/GerberCommandReader.mjs src/core/Parser.mjs src/parser.mjs tests/gerber-parser-contract.test.mjs tests/gerber-parser-options.test.mjs
git commit -m "feature: add canonical Gerber parser envelopes"
```

### Task 4: Converge project loading and archive safety

**Files:**
- Create: `src/core/ProjectLoader.mjs`
- Create: `src/core/performance/GerberArchiveReader.mjs`
- Create: `src/project.mjs`
- Create: `tests/gerber-project-contract.test.mjs`
- Create: `tests/gerber-archive-safety.test.mjs`
- Modify: `src/core/gerber/GerberProjectLoader.mjs`
- Modify: `tests/gerber-project-loader.test.mjs`

**Interfaces:**
- Consumes: shared archive limits/path rules and existing layer grouping.
- Produces: `ProjectLoader.supports/load/tryLoad/loadAsync`, partial successes, one composite Gerber document, typed archive errors, and stable entry ordering.

- [ ] **Step 1: Write failing project envelope and path-safety tests**

```js
test('Gerber ProjectLoader returns one composite canonical project', () => {
    const result = ProjectLoader.load([{ name: 'top.gtl', data: topCopper() }, { name: 'holes.drl', data: drillData() }])
    assert.equal(result.schema, 'ecad-toolkit.project.v1')
    assert.equal(result.documents.length, 1)
    assert.deepEqual(result.source.entryNames, ['holes.drl', 'top.gtl'])
})

test('Gerber archive loading rejects traversal', () => {
    assert.throws(() => GerberArchiveReader.validateEntries([{ name: '../top.gtl', data: topCopper() }]), { code: 'ERR_ARCHIVE_PATH' })
})

test('Gerber archive loading normalizes malformed ZIP failures', () => {
    assert.throws(() => ProjectLoader.load([{ name: 'broken.zip', data: malformedZipBytes() }]), { code: 'ERR_ARCHIVE_MALFORMED' })
})
```

- [ ] **Step 2: Run and verify missing canonical loader**

Run: `npm test -- tests/gerber-project-contract.test.mjs`

Expected: FAIL with missing `ProjectLoader.mjs`.

- [ ] **Step 3: Implement bounded classification and result normalization**

```js
static load(entries, options = {}) {
    const safeEntries = GerberArchiveReader.classify(entries, options.archiveLimits)
    const nativeResult = GerberProjectLoader.loadEntriesSync(safeEntries)
    const document = Parser.fromNativeProject(nativeResult, options)
    return ProjectResult.create({ documents: [document], source: { format: 'gerber', entryNames: safeEntries.map((entry) => entry.name) }, diagnostics: nativeResult.diagnostics })
}
```

Classify by normalized name/metadata/magic bytes before inflation, apply exact shared limits, reject duplicate normalized paths, and treat nested archives as assets after depth 1.

- [ ] **Step 4: Run project and parser suites**

Run: `npm test -- tests/gerber-project-contract.test.mjs tests/gerber-archive-safety.test.mjs tests/gerber-project-loader.test.mjs tests/gerber-parser-contract.test.mjs`

Expected: PASS with typed `fflate` normalization.

- [ ] **Step 5: Commit project convergence**

```bash
git add src/core/ProjectLoader.mjs src/core/performance/GerberArchiveReader.mjs src/core/gerber/GerberProjectLoader.mjs src/project.mjs tests/gerber-project-contract.test.mjs tests/gerber-archive-safety.test.mjs tests/gerber-project-loader.test.mjs
git commit -m "feature: converge Gerber project loading"
```

### Task 5: Add canonical native-fidelity rendering and reusable interaction

**Files:**
- Create: `src/ui/PcbSvgRenderer.mjs`
- Create: `src/ui/GerberPcbRenderPlan.mjs`
- Create: `src/interaction.mjs`
- Create: `tests/gerber-render-interaction-contract.test.mjs`
- Create: `tests/gerber-layer-id-collision.test.mjs`
- Create: `tests/gerber-arc-bounds.test.mjs`
- Create: `tests/gerber-separated-mode-consistency.test.mjs`
- Modify: `src/ui/GerberPcbSvgRenderer.mjs`
- Modify: `src/ui/PcbInteractionIndex.mjs`
- Modify: `src/ui/PcbInteractionLayerModel.mjs`
- Modify: `src/renderers.mjs`

**Interfaces:**
- Consumes: `DocumentResult`/context, `extensions.gerber`, shared spatial index, and existing exact CAM render/hit predicates.
- Produces: `PcbSvgRenderer.render/renderLayers`, `PcbInteractionIndex.create/hitTest/pick`, canonical side/record shapes, and one render/interaction plan per context.

- [ ] **Step 1: Write failing fidelity and reuse tests**

```js
test('canonical Gerber rendering retains polarity and reuses one plan', () => {
    const document = Parser.parse({ fileName: 'mask.gts', data: polaritySample() })
    const context = CircuitJsonDocumentContext.prepare(document)
    const options = { fidelity: 'native', side: 'top', layers: ['top_soldermask'] }
    const rendered = PcbSvgRenderer.renderLayers(context, options)
    assert.match(rendered.items[0].svg, /fill-rule="evenodd"/)
    assert.equal(context.statistics.derivedBuilds['gerber:' + GerberPcbRenderPlan.cacheKey(options)], 1)
})

test('interaction pick returns the first exact shared hit record', () => {
    const index = PcbInteractionIndex.create(Parser.parse({ fileName: 'top.gtl', data: flashSample() }))
    assert.equal(index.pick({ x: 1, y: 1 }).side, 'top')
})
```

- [ ] **Step 2: Run and verify absent canonical behavior**

Run: `npm test -- tests/gerber-render-interaction-contract.test.mjs`

Expected: FAIL because canonical renderer/context-aware interaction methods are absent.

- [ ] **Step 3: Extract plans without changing native markup or exact predicates**

```js
static render(document, options = {}) {
    const context = CircuitJsonDocumentContext.prepare(document)
    const resolved = GerberDocumentResolver.resolve(context, options)
    if (options.fidelity === 'native' && !resolved.extension) throw GerberDocumentResolver.extensionRequired()
    const plan = context.getOrCreateDerived('gerber', GerberPcbRenderPlan.cacheKey(options), () => GerberPcbRenderPlan.prepare(resolved, options))
    return GerberPcbSvgRenderer.renderPlan(plan)
}
```

`cacheKey()` includes normalized side, fidelity, sorted layer ids, and every plan-affecting style/metadata option. Move preparation out of the 993-line native renderer so both files remain below 1000 lines. Use the shared context's derived cache and `PcbSpatialIndex` broad phase; retain native `hitTestItems` as exact narrow phase and stable priority authority. Add regressions proving normalized/sanitized colliding layer ids receive stable distinct ids, arc bounds include cardinal extrema, and composite/separated layer rendering resolves the same polarity/order semantics.

- [ ] **Step 4: Run render, interaction, and parity suites**

Run: `npm test -- tests/gerber-render-interaction-contract.test.mjs tests/gerber-layer-id-collision.test.mjs tests/gerber-arc-bounds.test.mjs tests/gerber-separated-mode-consistency.test.mjs tests/gerber-renderer.test.mjs tests/gerber-parity.test.mjs`

Expected: PASS with byte-stable native SVG and hit ordering.

- [ ] **Step 5: Commit renderer/interaction convergence**

```bash
git add src/ui/PcbSvgRenderer.mjs src/ui/GerberPcbRenderPlan.mjs src/ui/GerberPcbSvgRenderer.mjs src/ui/PcbInteractionIndex.mjs src/ui/PcbInteractionLayerModel.mjs src/interaction.mjs src/renderers.mjs tests/gerber-render-interaction-contract.test.mjs tests/gerber-layer-id-collision.test.mjs tests/gerber-arc-bounds.test.mjs tests/gerber-separated-mode-consistency.test.mjs
git commit -m "feature: converge Gerber rendering and interaction"
```

### Task 6: Expose shared services and operation-level capabilities

**Files:**
- Create: `src/core/ToolkitCapabilities.mjs`
- Create: `src/ui/SchematicSvgRenderer.mjs`
- Create: `src/ui/BomTableRenderer.mjs`
- Create: `src/query.mjs`
- Create: `src/manufacturing.mjs`
- Create: `src/simulation.mjs`
- Create: `src/core/GerberQueryService.mjs`
- Create: `src/core/GerberManufacturingService.mjs`
- Create: `src/core/GerberSimulationService.mjs`
- Create: `src/capabilities.mjs`
- Create: `tests/gerber-common-services.test.mjs`

**Interfaces:**
- Consumes: core `QueryService`, `ManufacturingService`, `SimulationService`, `ToolkitCapabilities`, and `ToolkitError`.
- Produces: all common classes in Gerber package subpaths; shared/derived behavior where CircuitJSON supports it and exact unavailable failures elsewhere.

- [ ] **Step 1: Write failing capability/service tests**

```js
test('Gerber common services expose derived and unavailable operations honestly', () => {
    const inventory = ToolkitCapabilities.inventory()
    assert.equal(inventory.find((row) => row.id === 'renderer.pcb.render').status, 'native')
    assert.equal(inventory.find((row) => row.id === 'renderer.schematic.render').status, 'unavailable')
    assert.throws(() => SchematicSvgRenderer.render(createGerberDocument()), { code: 'ERR_CAPABILITY_UNAVAILABLE' })
    assert.throws(() => BomTableRenderer.render(createGerberDocument()), { code: 'ERR_CAPABILITY_UNAVAILABLE' })
    assert.throws(() => QueryService.create(createGerberDocument()).findComponents(), { code: 'ERR_CAPABILITY_UNAVAILABLE' })
    assert.throws(() => QueryService.create(createGerberDocument()).findNets(), { code: 'ERR_CAPABILITY_UNAVAILABLE' })
    assert.throws(() => ManufacturingService.export(createGerberDocument(), { id: 'bom-csv', options: {} }), { code: 'ERR_CAPABILITY_UNAVAILABLE' })
    assert.throws(() => SimulationService.build(createGerberDocument()), { code: 'ERR_CAPABILITY_UNAVAILABLE' })
})
```

- [ ] **Step 2: Run and verify missing common subpaths**

Run: `npm test -- tests/gerber-common-services.test.mjs`

Expected: FAIL with missing capability and service modules.

- [ ] **Step 3: Compose guarded Gerber service facades**

```js
export class SchematicSvgRenderer {
    static render() {
        throw new ToolkitError('Gerber has no schematic semantics.', { code: 'ERR_CAPABILITY_UNAVAILABLE', category: 'unsupported', format: 'gerber' })
    }
}
```

Each Gerber facade checks its operation id before delegating to core-derived behavior; capability rows are descriptive while guards enforce calls. Component/net/connectivity queries and all simulation calls throw unavailable. Manufacturing delegates valid projected fabrication inspection/notes plus native CAM/drill exports, while BOM/pick-and-place throw. Never return empty success for semantics absent from fabrication sources.

- [ ] **Step 4: Run service/capability tests**

Run: `npm test -- tests/gerber-common-services.test.mjs tests/gerber-circuitjson-adapter.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit shared service bindings**

```bash
git add src/core/ToolkitCapabilities.mjs src/core/GerberQueryService.mjs src/core/GerberManufacturingService.mjs src/core/GerberSimulationService.mjs src/ui/SchematicSvgRenderer.mjs src/ui/BomTableRenderer.mjs src/query.mjs src/manufacturing.mjs src/simulation.mjs src/capabilities.mjs tests/gerber-common-services.test.mjs
git commit -m "feature: expose canonical Gerber services"
```

### Task 7: Split and converge Gerber scene-data APIs

**Files:**
- Create: `src/scene3d/PcbScene3dBuilder.mjs`
- Create: `src/scene3d/PcbScene3dPreparator.mjs`
- Create: `src/scene3d/GerberScene3dDocumentResolver.mjs`
- Create by moving current barrel implementation: `src/scene3d/GerberPcbScene3dBuilder.mjs`
- Create: `tests/gerber-scene3d-contract.test.mjs`
- Modify: `src/scene3d.mjs`
- Modify: `tests/gerber-scene3d.test.mjs`

**Interfaces:**
- Consumes: document/context resolver and existing Gerber scene geometry helpers.
- Produces: canonical millimeter/right-handed-Z-up `PcbScene3dBuilder.build` and meaningful async `PcbScene3dPreparator.prepare`, with no invented components/models.

- [ ] **Step 1: Write failing canonical scene tests**

```js
test('Gerber scene builder returns a canonical bare-board scene', async () => {
    const document = Parser.parse({ fileName: 'board.gko', data: outlineSample() })
    const scene = PcbScene3dBuilder.build(document)
    assert.equal(scene.schema, 'ecad-toolkit.scene3d.v1')
    assert.equal(scene.units, 'mm')
    assert.deepEqual(scene.components, [])
    assert.deepEqual(await PcbScene3dPreparator.prepare(document), scene)
})
```

- [ ] **Step 2: Run and verify the old scene shape**

Run: `npm test -- tests/gerber-scene3d-contract.test.mjs`

Expected: FAIL because `scene3d.mjs` returns the legacy mil/`gerber-3d-y-up` shape and old preparator name.

- [ ] **Step 3: Move the 930-line barrel implementation into focused classes**

```js
static build(document, options = {}) {
    const nativeDocument = GerberScene3dDocumentResolver.resolve(document, options)
    const legacy = GerberPcbScene3dBuilder.build(nativeDocument, options)
    return GerberScene3dDocumentResolver.toCanonicalScene(legacy)
}
```

Keep native geometry helpers unchanged, convert public shared units once at the facade, preserve stable extension references, and implement preparator progress/cancellation checkpoints around context/geometry preparation.

- [ ] **Step 4: Run canonical and legacy scene suites**

Run: `npm test -- tests/gerber-scene3d-contract.test.mjs tests/gerber-scene3d.test.mjs`

Expected: PASS with unchanged geometric checks after explicit unit conversion.

- [ ] **Step 5: Commit scene convergence**

```bash
git add src/scene3d/PcbScene3dBuilder.mjs src/scene3d/PcbScene3dPreparator.mjs src/scene3d/GerberScene3dDocumentResolver.mjs src/scene3d/GerberPcbScene3dBuilder.mjs src/scene3d.mjs tests/gerber-scene3d-contract.test.mjs tests/gerber-scene3d.test.mjs
git commit -m "feature: converge Gerber scene data APIs"
```

### Task 8: Bind the shared versioned worker protocol

**Files:**
- Create: `src/workers/parser.worker.mjs`
- Create: `tests/gerber-worker-contract.test.mjs`
- Modify: `src/core/Parser.mjs`
- Modify: `src/core/ProjectLoader.mjs`
- Modify: `src/core/gerber/GerberParseSession.mjs`
- Modify: `src/core/performance/GerberArchiveReader.mjs`

**Interfaces:**
- Consumes: `ToolkitWorkerProtocol` and `ParserWorkerClient` from `circuitjson-toolkit/parser`.
- Produces: equivalent direct/worker parse/project results, progress/cancel messages, clone-safe errors, and opt-in input transfer.

- [ ] **Step 1: Write failing worker equivalence tests**

```js
test('Gerber direct and worker parse results are equivalent', async () => {
    const input = { fileName: 'top.gtl', data: new TextEncoder().encode(topCopper()) }
    const direct = Parser.parse(input)
    const worker = await Parser.parseAsync(input, { worker: true, transferInput: false })
    assert.deepEqual(worker, direct)
    assert.equal(input.data.byteLength > 0, true)
    assert.equal(CircuitJsonDocumentContext.prepare(direct).statistics.validationPasses, 0)
    assert.equal(CircuitJsonDocumentContext.prepare(worker).statistics.validationPasses, 1)
})

test('Gerber worker cancels during command decoding and remains reusable', async () => {
    const controller = new AbortController()
    const stages = []
    const pending = Parser.parseAsync(largeStepRepeatInput(), { worker: true, signal: controller.signal, onProgress: (row) => { stages.push(row.stage); if (row.stage === 'decode' && row.detail === 'commands') controller.abort() } })
    await assert.rejects(pending, { code: 'ERR_CANCELLED' })
    assertCanonicalProgressOrder(stages)
    assert.equal((await Parser.parseAsync({ fileName: 'top.gtl', data: new TextEncoder().encode(topCopper()) }, { worker: true })).schema, 'ecad-toolkit.document.v1')
})
```

- [ ] **Step 2: Run and verify missing worker binding**

Run: `npm test -- tests/gerber-worker-contract.test.mjs`

Expected: FAIL because canonical worker subpath/`parseAsync` is absent.

- [ ] **Step 3: Implement only format dispatch around shared worker utilities**

```js
ToolkitWorkerProtocol.install(globalThis, {
    parse: (input, options) => Parser.parseAsync(input, { ...options, worker: false }),
    loadProject: (entries, options) => ProjectLoader.loadAsync(entries, { ...options, worker: false })
})
```

Both direct async methods must execute genuinely yielding phase runners: parse yields/checks cancellation during detection, command batches, projection, and validation; project loading yields/checks during archive classification, candidate inflation, and each entry. Map these to ordered common stages `detect/decode/project/validate/complete`, with `commands`, `archive`, `inflate`, and entry identity in optional `detail`. Add a test that cancels an active large step-repeat parse and observes `ERR_CANCELLED`, not merely a pre-aborted request, then proves post-cancel worker reuse. Do not post signals/callbacks, do not detach caller input unless `transferInput: true`, and omit unrequested raw/full extension graphs from worker results.

- [ ] **Step 4: Run worker/parser/project tests**

Run: `npm test -- tests/gerber-worker-contract.test.mjs tests/gerber-parser-contract.test.mjs tests/gerber-project-contract.test.mjs`

Expected: PASS for result/error/cancellation equivalence.

- [ ] **Step 5: Commit worker binding**

```bash
git add src/workers/parser.worker.mjs src/core/Parser.mjs src/core/ProjectLoader.mjs src/core/gerber/GerberParseSession.mjs src/core/performance/GerberArchiveReader.mjs tests/gerber-worker-contract.test.mjs
git commit -m "feature: add Gerber parser worker protocol"
```

### Task 9: Remove measured eager command, clone, archive, and spatial work

**Files:**
- Modify: `src/core/performance/GerberCommandReader.mjs`
- Create: `src/core/performance/GerberPrimitiveCloner.mjs`
- Create: `src/core/performance/GerberNativeSpatialIndexes.mjs`
- Create: `tests/gerber-performance-structures.test.mjs`
- Modify: `src/core/gerber/GerberParser.mjs`
- Modify: `src/core/gerber/GerberPrimitiveBuilder.mjs`
- Modify: `src/core/gerber/GerberMaskOpeningClassifier.mjs`
- Modify: `src/core/performance/GerberArchiveReader.mjs`
- Modify: `src/ui/PcbInteractionIndex.mjs`

**Interfaces:**
- Consumes: baseline structural/timing cases and exact existing parser behavior.
- Produces: incremental command iteration, structural cloning without JSON serialization, candidate-only archive inflation, and shared spatial broad phase with exact narrow phase.

- [ ] **Step 1: Write failing structural-allocation tests**

```js
test('incremental reader preserves macros and yields commands without a full token array', () => {
    const reader = GerberCommandReader.read(stepRepeatMacroSample())
    assert.equal(typeof reader[Symbol.iterator], 'function')
    assert.deepEqual([...reader].map((row) => row.kind), ['format', 'macro', 'stepRepeat', 'draw', 'stepRepeatEnd'])
})

test('primitive cloning does not share nested points', () => {
    const source = { points: [{ x: 1, y: 2 }], attributes: { net: 'N1' } }
    const copy = GerberPrimitiveCloner.clone(source)
    copy.points[0].x = 3
    assert.equal(source.points[0].x, 1)
})
```

- [ ] **Step 2: Run and verify missing performance structures**

Run: `npm test -- tests/gerber-performance-structures.test.mjs`

Expected: FAIL on missing primitive cloner/native spatial cache and the command reader's new allocation/checkpoint assertions.

- [ ] **Step 3: Replace one eager structure at a time**

Implement generator-based command scanning that preserves parameter blocks/macros/aperture blocks/step-repeat order and yields cooperative async checkpoints by bounded command batch; replace JSON stringify/parse cloning with typed recursive copies for arrays/plain objects/typed arrays. Build mask/drill `PcbSpatialIndex` instances through `context.getOrCreateDerived('gerber', 'mask-drill-spatial', factory)` so repeated renderer/interaction calls in one request reuse them. Run parity tests after each replacement before proceeding to the next.

- [ ] **Step 4: Run structural and full differential suites**

Run: `npm test -- tests/gerber-performance-structures.test.mjs tests/gerber-parser.test.mjs tests/gerber-project-loader.test.mjs tests/gerber-renderer.test.mjs tests/gerber-scene3d.test.mjs tests/gerber-parity.test.mjs`

Expected: PASS with identical normalized geometry/render output.

- [ ] **Step 5: Commit measured performance changes**

```bash
git add src/core/performance src/core/gerber/GerberParser.mjs src/core/gerber/GerberPrimitiveBuilder.mjs src/core/gerber/GerberMaskOpeningClassifier.mjs src/ui/PcbInteractionIndex.mjs tests/gerber-performance-structures.test.mjs
git commit -m "feature: reduce Gerber parse and query allocations"
```

### Task 10: Publish canonical subpaths and run shared conformance

**Files:**
- Create: `src/testing.mjs`
- Create: `src/extensions.mjs`
- Create: `src/styles/renderers.css`
- Create: `tests/gerber-api-conformance.test.mjs`
- Modify: `src/index.mjs`
- Modify: `src/parser.mjs`
- Modify: `src/renderers.mjs`
- Modify: `src/scene3d.mjs`
- Modify: `tests/package-layout.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: all completed canonical classes and `runToolkitContract` from `circuitjson-toolkit/testing`.
- Produces: exact common subpath layout, compact root, native `/extensions`, published testing facade, worker/CSS exports, and zero conformance failures.

- [ ] **Step 1: Write failing package/conformance tests**

```js
test('Gerber toolkit satisfies the packed shared contract', async () => {
    const toolkit = await import('gerber-toolkit')
    const report = await runToolkitContract(toolkit, { fixtures: ToolkitContractFixtures.gerber() })
    assert.deepEqual(report.failures, [])
    assert.deepEqual(Object.keys(toolkit).sort(), ToolkitContractFixtures.canonicalClassNames.toSorted())
    assert.equal(toolkit.Parser.name, 'Parser')
    assert.equal(typeof toolkit.GerberParser, 'undefined')
})
```

- [ ] **Step 2: Run and verify missing subpaths/root drift**

Run: `npm test -- tests/gerber-api-conformance.test.mjs tests/package-layout.test.mjs`

Expected: FAIL because the root exports native names and common subpaths are missing.

- [ ] **Step 3: Wire the exact common export map**

`package.json.exports` must include `.`, `./parser`, `./project`, `./renderers`, `./interaction`, `./query`, `./manufacturing`, `./simulation`, `./scene3d`, `./capabilities`, `./extensions`, `./testing`, `./workers/parser.worker.mjs`, and `./styles/renderers.css`. `/extensions` re-exports existing `GerberParser`, `GerberProjectLoader`, coordinate/layer helpers, native renderer, and native scene helpers.

- [ ] **Step 4: Run shared conformance, package, and full tests**

Run: `npm test -- tests/gerber-api-conformance.test.mjs tests/package-layout.test.mjs && npm test && npm run check:format && npm run check:features`

Expected: PASS with no logic in barrels.

- [ ] **Step 5: Commit canonical package layout**

```bash
git add src/index.mjs src/parser.mjs src/project.mjs src/renderers.mjs src/interaction.mjs src/query.mjs src/manufacturing.mjs src/simulation.mjs src/scene3d.mjs src/capabilities.mjs src/extensions.mjs src/testing.mjs src/styles package.json tests/gerber-api-conformance.test.mjs tests/package-layout.test.mjs
git commit -m "feature: expose converged Gerber package API"
```

### Task 11: Pass benchmark gates, document migration, and prepare 0.2.0

**Files:**
- Create: `benchmarks/results-v0.2.0.json`
- Create: `docs/capabilities.md`
- Create: `docs/migration.md`
- Create: `docs/license-compliance.md`
- Create: `docs/provenance.md`
- Create: `LICENSES/AGPL-3.0-or-later.txt`
- Create: `scripts/check-packed-entrypoints.mjs`
- Create: `tests/release-readiness.test.mjs`
- Create outside repositories: `../release-candidates/gerber-toolkit-0.2.0.tgz`
- Modify only when a benchmark identifies the owning path: `src/**/*.mjs`
- Modify only with the owning hot path: `tests/**/*.test.mjs`
- Modify: `README.md`
- Modify: `docs/api.md`
- Modify: `docs/model-format.md`
- Modify: `docs/testing.md`
- Modify: `spec/library-scope.md`
- Modify: `spec/feature-preservation.json`
- Modify: `NOTICE.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: completed implementation, baseline/ledger, and exact core candidate.
- Produces: version `0.2.0`, exhaustive old/new migration, capability docs, license disclosure, passing numeric performance report, and verified tarball.

- [ ] **Step 1: Write failing release-readiness checks**

```js
test('Gerber 0.2.0 release metadata covers every baseline feature', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    const ledger = JSON.parse(await readFile('spec/feature-preservation.json', 'utf8'))
    const migration = await readFile('docs/migration.md', 'utf8')
    assert.equal(pkg.version, '0.2.0')
    assert.equal(pkg.dependencies['circuitjson-toolkit'], '1.1.0')
    assert.equal(ledger.every((row) => migration.includes(row.feature)), true)
})
```

- [ ] **Step 2: Run readiness and benchmark comparison**

Run: `npm test -- tests/release-readiness.test.mjs && npm run benchmark -- --compare benchmarks/baseline-v0.1.21.json`

Expected: readiness FAILS on `0.1.21`; comparison reports any remaining threshold failures by immutable case id.

- [ ] **Step 3: Complete version/docs/ledger and evidence-based optimization**

Set package and lockfile versions to `0.2.0`. Document exact common examples, native extension ownership, unavailable operations, worker behavior, all retained CAM features, AGPL runtime dependency/commercial-license distinction, and prominent `Breaking API convergence` mappings. Record the exact core package/version/commit/license, copied/adapted source paths, combined-work conclusion, and reviewer/date in `docs/license-compliance.md` and `docs/provenance.md`; ship the AGPL license artifact and align `NOTICE.md`. Change only benchmark-identified hot paths; keep exact predicates/order authoritative.

- [ ] **Step 4: Run the complete candidate gate**

Run: `mkdir -p ../release-candidates && npm ci && npm test && npm run check:format && npm run check:features -- --strict && npm run benchmark -- --compare benchmarks/baseline-v0.1.21.json --output benchmarks/results-v0.2.0.json && npm pack --dry-run && npm pack --pack-destination ../release-candidates && node scripts/check-packed-entrypoints.mjs && uvx --from 'reuse[charset-normalizer]==6.2.0' reuse lint && git diff --check`

Expected: all commands exit 0; both primary medians improve at least 20 percent, every non-primary large/small/result-byte gate passes, all canonical/native files/licenses/notices ship, and package/lock versions agree.

- [ ] **Step 5: Commit the Gerber candidate**

```bash
git add src tests README.md docs spec NOTICE.md LICENSES/AGPL-3.0-or-later.txt benchmarks/results-v0.2.0.json scripts/check-packed-entrypoints.mjs package.json package-lock.json
git commit -m "release: prepare gerber-toolkit 0.2.0"
```
