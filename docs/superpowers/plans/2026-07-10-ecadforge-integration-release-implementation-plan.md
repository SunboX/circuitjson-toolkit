# ECAD Forge Integration and Coordinated Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate ECAD Forge to the converged toolkit contract, verify every available capability across all four formats, publish the five requested releases in dependency order, and confirm the production deployment succeeds.

**Architecture:** `EcadFormatRegistry` continues source detection while a new `EcadToolkitRegistry` maps each format to identical canonical classes. App state stores `DocumentResult` envelopes, one request/session context store provides reusable indexes, and parser/renderer/query/manufacturing/scene services delegate without source-specific API branches. Candidate tarballs are tested as one stack before any registry publish; releases then proceed core, source libraries, app, deployment.

**Tech Stack:** Node.js 20+, browser ESM/workers, `node:test`, Express 5, exact toolkit versions, `pcb-scene3d-viewer@1.1.50`, Prettier 3, GitHub CLI, npm registry.

## Global Constraints

- Preserve the existing ECAD Forge `main` commits that are ahead of `origin/main`; use `superpowers:using-git-worktrees` to create `/Users/afiedler/Documents/privat/Andrés_Werkstatt/ecadforge-app-api-convergence` from that local `main`. From this sibling worktree, `../release-candidates` resolves to the shared candidate directory.
- Baseline app version is `1.9.28`; release is exactly `1.10.0`.
- Final exact dependencies are `circuitjson-toolkit@1.1.0`, `gerber-toolkit@0.2.0`, `altium-toolkit@1.2.0`, and `kicad-toolkit@1.1.0`.
- Keep `pcb-scene3d-viewer@1.1.50`; core 1.1.x compatibility exports must make its complete suite pass.
- App state stores canonical envelopes; shared views use `document.model`, native panels use `document.extensions[document.source.format]`.
- Remove format-specific side/return/error normalization only after the owning library has contract/differential tests.
- Capability-gate optional operations; Gerber component/net/BOM/schematic calls must assert `ERR_CAPABILITY_UNAVAILABLE`, not empty success.
- No toolkit parsing/rendering/native-extension logic moves into the app.
- Every visible change receives browser sanity checks and screenshots using repo-owned samples.
- Every focused command in a task uses `npm test -- <paths>`; immediately before that task's commit, also run unfiltered `npm test && npm run check:format` and stop on either failure.
- Keep files/CSS below 1000 lines and follow app JSDoc/format rules.
- After the version/dependency change, run `npm run sync:structured-data`, commit generated `src/*.html`, then run all release gates.
- A tag or GitHub release is partial state; completion requires npm/Git/tag/release parity and `Deploy to FTP (main)` conclusion `success`.
- During execution, use `npm-library-release-deploy` for library publishes and `release-ecadforge-app` for the app release/deployment workflow.

## File Structure

- `src/core/ecad/EcadToolkitRegistry.mjs`: format-to-canonical-class registry.
- `src/core/ecad/EcadDocumentAccess.mjs`: read-only canonical envelope/model/extension access; no compatibility projection.
- `src/core/ecad/EcadDocumentContextStore.mjs`: request/session context ownership and disposal.
- `src/core/ecad/EcadProjectParseService.mjs`: multi-format batch/project orchestration separated from the parser facade.
- `src/core/ecad/EcadLocalizedBomRenderer.mjs`: app-only translation/presentation split from the near-limit renderer service.
- `src/core/ecad/EcadParserWorkerClient.mjs`: app binding for `ecad-toolkit.worker.v1` mixed-entry requests.
- `spec/document-envelope-migration.json`: exact source-file/property migration inventory and completion state.

## Execution Order

1. Complete the CircuitJSON core plan through its retained `1.1.0` tarball.
2. Execute the Gerber, Altium, and KiCad plans in parallel against that exact tarball, each ending in a clean source candidate commit.
3. Execute Tasks 1-10 below against all four candidate tarballs.
4. Execute Task 11 in strict order: publish core, normalize/retest source locks and tarballs, then publish the three source toolkits.
5. Execute Task 12 only after all four registry packages have Git/tag/release/npm parity.
- Existing UI/core modules continue owning host state, rendering chrome, analytics, downloads, and WebMCP presentation.

---

### Task 1: Install the candidate stack and add the canonical toolkit registry

**Files:**
- Create: `src/core/ecad/EcadToolkitRegistry.mjs`
- Create: `src/core/ecad/EcadDocumentAccess.mjs`
- Create: `spec/document-envelope-migration.json`
- Create: `tests/core/ecad-toolkit-registry.test.mjs`
- Create: `tests/core/document-envelope-migration.test.mjs`
- Modify: `src/core/ecad/EcadFormatRegistry.mjs`
- Modify: `tests/core/ecad-services.test.mjs`

**Interfaces:**
- Consumes: the four packed toolkit candidates and exact canonical root exports.
- Produces: `EcadToolkitRegistry.forFormat(format)`, `forDocument(document)`, `inventory()`, and `EcadDocumentAccess.model/extension/sourceFormat`.
- Registry records contain the 13 operational service classes below; `ToolkitError` is imported once from core as `CoreToolkitError`, and the registry contract test separately proves all 14 canonical root exports exist in every package.

Each registry record selects exactly:

```js
{
    Parser,
    ProjectLoader,
    CircuitJsonDocumentContext,
    PcbSvgRenderer,
    SchematicSvgRenderer,
    BomTableRenderer,
    PcbInteractionIndex,
    QueryService,
    ManufacturingService,
    SimulationService,
    PcbScene3dBuilder,
    PcbScene3dPreparator,
    ToolkitCapabilities
}
```

- [ ] **Step 1: Install candidate tarballs without changing final dependency metadata**

Run:

```bash
npm install --no-save --package-lock=false ../release-candidates/circuitjson-toolkit-1.1.0.tgz ../release-candidates/gerber-toolkit-0.2.0.tgz ../release-candidates/altium-toolkit-1.2.0.tgz ../release-candidates/kicad-toolkit-1.1.0.tgz
```

Expected: `npm ls` shows the four candidate versions and one deduplicated `circuitjson-toolkit@1.1.0`.

- [ ] **Step 2: Write failing registry/envelope tests**

```js
test('registry exposes identical canonical classes for every format', () => {
    for (const format of ['circuitjson', 'gerber', 'altium', 'kicad']) {
        const toolkit = EcadToolkitRegistry.forFormat(format)
        assert.deepEqual(Object.keys(toolkit), EcadToolkitRegistry.canonicalKeys())
        assert.equal(typeof toolkit.Parser.parse, 'function')
        assert.equal(typeof toolkit.ToolkitCapabilities.inventory, 'function')
    }
    assertCanonicalRootExports(candidatePackageRoots(), { ToolkitError: CoreToolkitError })
})

test('document access reads only the canonical envelope', () => {
    const document = createDocumentResult('kicad')
    assert.equal(EcadDocumentAccess.model(document), document.model)
    assert.equal(EcadDocumentAccess.extension(document), document.extensions.kicad)
})
```

- [ ] **Step 3: Run and verify missing registry modules**

Run: `npm test -- tests/core/ecad-toolkit-registry.test.mjs tests/core/document-envelope-migration.test.mjs`

Expected: FAIL with missing `EcadToolkitRegistry.mjs`.

- [ ] **Step 4: Implement immutable registry records and migration inventory**

```js
static forDocument(document) {
    return EcadToolkitRegistry.forFormat(EcadDocumentAccess.sourceFormat(document))
}

static forFormat(format) {
    const toolkit = EcadToolkitRegistry.#toolkits[String(format || '')]
    if (!toolkit) throw new CoreToolkitError('Unsupported ECAD format.', { code: 'ERR_CAPABILITY_UNAVAILABLE', category: 'unsupported', format })
    return toolkit
}
```

Capture every current source path/property access matching `documentModel`, `.pcb`, `.schematic`, `.bom`, `.sourceFormat`, `.fileName`, and `.kind` in `spec/document-envelope-migration.json`; each row includes path, old access, replacement service/accessor, test, and `status: 'pending'`.

- [ ] **Step 5: Run focused tests and commit registry scaffolding**

Run: `npm test -- tests/core/ecad-toolkit-registry.test.mjs tests/core/document-envelope-migration.test.mjs tests/core/ecad-services.test.mjs`

Expected: PASS.

```bash
git add src/core/ecad/EcadToolkitRegistry.mjs src/core/ecad/EcadDocumentAccess.mjs src/core/ecad/EcadFormatRegistry.mjs spec/document-envelope-migration.json tests/core/ecad-toolkit-registry.test.mjs tests/core/document-envelope-migration.test.mjs tests/core/ecad-services.test.mjs
git commit -m "feature: add canonical ECAD toolkit registry"
```

### Task 2: Converge parsing, projects, and the app worker protocol

**Files:**
- Create: `src/core/ecad/EcadProjectParseService.mjs`
- Create: `src/core/ecad/EcadParserWorkerClient.mjs`
- Create: `tests/core/ecad-parser-envelope.test.mjs`
- Create: `tests/core/ecad-parser-worker-protocol.test.mjs`
- Modify: `src/core/ecad/EcadParserService.mjs`
- Modify: `src/workers/ecad-parser.worker.mjs`
- Modify: `src/AppController.mjs`
- Modify: `src/AppControllerParserData.mjs`
- Modify: `tests/core/ecad-parser-service-payload.test.mjs`
- Modify: `tests/app-controller-local-load-selection.test.mjs`

**Interfaces:**
- Consumes: registry `Parser`/`ProjectLoader`, canonical project/document results, and shared worker protocol utilities.
- Produces: mixed-entry `EcadParserService.parse/parseEntries`, direct/worker-equivalent project results, progress/cancel handling, and no app mutation/deletion of native parser objects.

- [ ] **Step 1: Write failing direct/worker envelope tests**

```js
test('EcadParserService returns canonical documents for all four formats', async () => {
    const result = await EcadParserService.parseEntries(createFourFormatEntries())
    assert.equal(result.schema, 'ecad-toolkit.project.v1')
    assert.deepEqual(result.documents.map((document) => document.source.format).sort(), ['altium', 'circuitjson', 'gerber', 'kicad'])
    assert.equal(result.documents.every((document) => Array.isArray(document.model)), true)
})

test('worker and direct project results match', async () => {
    const direct = await EcadParserService.parseEntries(createCircuitJsonEntries())
    const worker = await new EcadParserWorkerClient(createFakeWorker()).loadProject(createCircuitJsonEntries())
    assert.deepEqual(worker, direct)
})

test('mixed-format worker cancels actively, reports ordered progress, and remains reusable', async () => {
    const controller = new AbortController()
    const stages = []
    const client = createRealEcadParserWorkerClient()
    const pending = client.loadProject(createLargeMixedEntries(), { signal: controller.signal, onProgress: (row) => { stages.push(row.stage); if (row.stage === 'decode') controller.abort() } })
    await assert.rejects(pending, { code: 'ERR_CANCELLED' })
    assertCanonicalProgressOrder(stages)
    const recovered = await client.loadProject(createCircuitJsonEntries())
    for (const document of recovered.documents) {
        assert.equal(EcadToolkitRegistry.forDocument(document).CircuitJsonDocumentContext.prepare(document).statistics.validationPasses, 1)
    }
    client.dispose()
})
```

- [ ] **Step 2: Run and verify legacy result/protocol failures**

Run: `npm test -- tests/core/ecad-parser-envelope.test.mjs tests/core/ecad-parser-worker-protocol.test.mjs`

Expected: FAIL because results lack project schema and worker messages use `parse:entries`/`parser:success`.

- [ ] **Step 3: Implement format grouping through the registry**

```js
async parseEntries(entries, options = {}) {
    return EcadProjectParseService.load(entries, {
        ...options,
        registry: this.#registry
    })
}
```

`EcadProjectParseService` groups by existing format detection, calls each canonical `ProjectLoader.loadAsync`, merges document/project-level assets/diagnostics without duplication, and returns one canonical project result. Delete app-side `#prepareAppDocument`, raw record deletion, array expando handling, ZIP inflation, Altium project parameter attachment, and diagnostic mutation after equivalent library tests exist.

- [ ] **Step 4: Replace AppController worker code with the versioned client**

Use `ecad-toolkit.worker.v1` `loadProject/progress/result/error/cancel`; because AppController creates copied entry buffers, pass `transferInput: true` only for those owned copies. Forward ordered `detect/decode/project/validate/complete` progress with optional source detail, normalize active cancellation, replace a terminated worker, propagate callback errors, and preserve fallback to direct parsing only for worker-load/runtime failures, not typed source parse errors.

- [ ] **Step 5: Run parser/controller tests and commit**

Run: `npm test -- tests/core/ecad-parser-envelope.test.mjs tests/core/ecad-parser-worker-protocol.test.mjs tests/core/ecad-parser-service-payload.test.mjs tests/app-controller-local-load-selection.test.mjs`

Expected: PASS.

```bash
git add src/core/ecad/EcadProjectParseService.mjs src/core/ecad/EcadParserWorkerClient.mjs src/core/ecad/EcadParserService.mjs src/workers/ecad-parser.worker.mjs src/AppController.mjs src/AppControllerParserData.mjs tests/core/ecad-parser-envelope.test.mjs tests/core/ecad-parser-worker-protocol.test.mjs tests/core/ecad-parser-service-payload.test.mjs tests/app-controller-local-load-selection.test.mjs
git commit -m "feature: converge ECAD parsing and workers"
```

### Task 3: Store DocumentResult envelopes in app session state

**Files:**
- Create: `tests/core/app-state-document-envelope.test.mjs`
- Modify: `src/core/AppState.mjs`
- Modify: `src/AppController.mjs`
- Modify: `src/AppControllerDocumentSelection.mjs`
- Modify: `src/AppControllerDeepLinkState.mjs`
- Modify: `src/AppControllerPcbStateHandlers.mjs`
- Modify: `src/DocumentPreferredViewResolver.mjs`
- Modify: `src/DocumentViewCompatibility.mjs`
- Modify: `src/GitHubSourceModelLinker.mjs`
- Modify: `tests/app-state.test.mjs`
- Modify: `tests/app-controller.test.mjs`
- Modify: `tests/app-controller-component-selection.test.mjs`
- Modify: `tests/app-controller-sidebar-deep-link.test.mjs`

**Interfaces:**
- Consumes: canonical document ids/source/model/extensions.
- Produces: `snapshot.documents: DocumentResult[]`, `activeDocumentId`, and `snapshot.document` as the active envelope; no `{ id, documentModel }` wrappers.

- [ ] **Step 1: Write failing canonical state tests**

```js
test('AppState stores canonical documents without compatibility wrappers', () => {
    const document = createDocumentResult('circuitjson')
    const state = new AppState({ documents: [document], activeDocumentId: document.id })
    const snapshot = state.getSnapshot()
    assert.equal(snapshot.documents[0], document)
    assert.equal(snapshot.document, document)
    assert.equal(Object.hasOwn(snapshot, 'documentModel'), false)
})
```

- [ ] **Step 2: Run and verify wrapper-shape failure**

Run: `npm test -- tests/core/app-state-document-envelope.test.mjs tests/app-state.test.mjs`

Expected: FAIL because state expects `{ id, documentModel }`.

- [ ] **Step 3: Migrate state normalization and active-document access**

```js
static #sanitizeDocuments(value) {
    return (Array.isArray(value) ? value : []).filter((document) => document?.schema === 'ecad-toolkit.document.v1' && document.id)
}
```

Update controller/deep-link/view-selection code to use `document.id`, `document.source.fileName`, `document.source.format`, `document.model`, and explicit extensions. Do not add getters that recreate old top-level fields.

- [ ] **Step 4: Run state/controller selection suites**

Run: `npm test -- tests/core/app-state-document-envelope.test.mjs tests/app-state.test.mjs tests/app-controller.test.mjs tests/app-controller-component-selection.test.mjs tests/app-controller-sidebar-deep-link.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit canonical session state**

```bash
git add src/core/AppState.mjs src/AppController.mjs src/AppControllerDocumentSelection.mjs src/AppControllerDeepLinkState.mjs src/AppControllerPcbStateHandlers.mjs src/DocumentPreferredViewResolver.mjs src/DocumentViewCompatibility.mjs src/GitHubSourceModelLinker.mjs tests/core/app-state-document-envelope.test.mjs tests/app-state.test.mjs tests/app-controller.test.mjs tests/app-controller-component-selection.test.mjs tests/app-controller-sidebar-deep-link.test.mjs
git commit -m "feature: store canonical ECAD documents"
```

### Task 4: Replace renderer branching with shared contexts and toolkit facades

**Files:**
- Create: `src/core/ecad/EcadDocumentContextStore.mjs`
- Create: `src/core/ecad/EcadToolkitRuntime.mjs`
- Create: `src/core/ecad/EcadLocalizedBomRenderer.mjs`
- Create: `tests/core/ecad-renderer-registry.test.mjs`
- Create: `tests/core/ecad-document-context-store.test.mjs`
- Create: `tests/core/ecad-toolkit-runtime.test.mjs`
- Modify: `src/main.mjs`
- Modify: `src/AppController.mjs`
- Modify: `src/ui/AppView.mjs`
- Modify: `src/core/ecad/EcadRendererService.mjs`
- Modify: `src/core/PcbAssemblyBoardTextureRenderer.mjs`
- Modify: `tests/core/ecad-renderer-cache.test.mjs`
- Modify: `tests/core/ecad-renderer-hit-test-cache.test.mjs`
- Modify: `tests/core/ecad-renderer-altium-directives.test.mjs`
- Modify: `tests/core/ecad-renderer-kicad-bounds.test.mjs`
- Modify: `tests/core/ecad-gerber-services.test.mjs`

**Interfaces:**
- Consumes: registry renderers/interaction index and root `CircuitJsonDocumentContext`.
- Produces: one explicitly owned runtime/context store per app session, canonical `renderSchematic/renderPcb/renderBom/hitTestPcb/resolvePcbInteractionLayers`, deterministic document release/disposal, and app-only localized BOM markup.

- [ ] **Step 1: Write failing no-branch/context-reuse tests**

```js
test('EcadRendererService delegates every format through the registry', () => {
    const document = createDocumentResult('kicad')
    const toolkit = fakeCanonicalToolkit()
    const service = new EcadRendererService({ registry: fakeRegistry('kicad', toolkit), contexts: new EcadDocumentContextStore() })
    service.renderPcb(document, { side: 'bottom' })
    assert.deepEqual(toolkit.PcbSvgRenderer.calls[0].options, { side: 'bottom' })
})

test('repeated hit tests reuse one interaction index', () => {
    const service = createRendererService()
    service.hitTestPcb(document, { x: 1, y: 1 })
    service.hitTestPcb(document, { x: 2, y: 2 })
    assert.equal(service.contextStatistics(document).derivedBuilds['ecad.interaction:pcb'], 1)
})

test('one runtime shares and releases contexts across services', () => {
    const runtime = new EcadToolkitRuntime({ registry: fakeRegistryForAllFormats() })
    const document = createDocumentResult('kicad')
    runtime.renderer.renderPcb(document)
    runtime.contexts.prepare(document)
    assert.equal(runtime.contexts.statistics(document).contextsCreated, 1)
    runtime.releaseDocument(document.id)
    assert.equal(runtime.contexts.has(document.id), false)
    runtime.dispose()
    assert.equal(runtime.disposed, true)
})

test('same-id replacement never reuses a stale envelope context', () => {
    const store = new EcadDocumentContextStore()
    const first = createDocumentResult('kicad', { id: 'board' })
    const replacement = createDocumentResult('kicad', { id: 'board', model: replacementModel() })
    assert.notEqual(store.prepare(first), store.prepare(replacement))
    assert.equal(store.statistics().contextsCreated, 2)
})
```

- [ ] **Step 2: Run and verify format-specific branching failure**

Run: `npm test -- tests/core/ecad-renderer-registry.test.mjs tests/core/ecad-document-context-store.test.mjs tests/core/ecad-toolkit-runtime.test.mjs`

Expected: FAIL because the service imports and branches across four renderer implementations.

- [ ] **Step 3: Implement registry-only delegation and split localization**

```js
renderPcb(document, options = {}) {
    const context = this.#contexts.prepare(document, { indexes: ['elements'] })
    return this.#registry.forDocument(document).PcbSvgRenderer.render(context, options)
}
```

`hitTestPcb` caches the toolkit `PcbInteractionIndex` with `context.getOrCreateDerived('ecad.interaction', 'pcb', factory)`; no undefined context index name is introduced.

Delete side conversion, pad-axis normalization, KiCad bounds repair, Gerber render selection normalization, and app interaction item repair after their library tests pass. Move localized BOM table presentation to `EcadLocalizedBomRenderer` so `EcadRendererService.mjs` drops well below 1000 lines.

`EcadToolkitRuntime` owns the registry, services, and a store keyed by envelope identity with an id lookup containing `{ document, context }`; a different envelope with the same id replaces/disposes the stale entry. `main.mjs` creates exactly one runtime, passes it to `AppController` and `AppView`, releases contexts when documents leave session state, and disposes the runtime during app teardown. Tasks 5-7 add scene/query/manufacturing/simulation services to this same owner. A temporary static renderer forwarding facade may exist only until Task 8 migrates all call sites; it must delegate to this runtime and may not own another cache.

- [ ] **Step 4: Run all renderer/cache/integration tests**

Run: `npm test -- tests/core/ecad-renderer-registry.test.mjs tests/core/ecad-document-context-store.test.mjs tests/core/ecad-toolkit-runtime.test.mjs tests/core/ecad-renderer-cache.test.mjs tests/core/ecad-renderer-hit-test-cache.test.mjs tests/core/ecad-renderer-altium-directives.test.mjs tests/core/ecad-renderer-kicad-bounds.test.mjs tests/core/ecad-gerber-services.test.mjs`

Expected: PASS with canonical `top`/`bottom` and unchanged visible markup.

- [ ] **Step 5: Commit renderer/context migration**

```bash
git add src/main.mjs src/AppController.mjs src/ui/AppView.mjs src/core/ecad/EcadDocumentContextStore.mjs src/core/ecad/EcadToolkitRuntime.mjs src/core/ecad/EcadLocalizedBomRenderer.mjs src/core/ecad/EcadRendererService.mjs src/core/PcbAssemblyBoardTextureRenderer.mjs tests/core/ecad-renderer-registry.test.mjs tests/core/ecad-document-context-store.test.mjs tests/core/ecad-toolkit-runtime.test.mjs tests/core/ecad-renderer-cache.test.mjs tests/core/ecad-renderer-hit-test-cache.test.mjs tests/core/ecad-renderer-altium-directives.test.mjs tests/core/ecad-renderer-kicad-bounds.test.mjs tests/core/ecad-gerber-services.test.mjs
git commit -m "feature: delegate rendering through toolkit contexts"
```

### Task 5: Converge scene preparation and explicit asset resolution

**Files:**
- Create: `tests/core/ecad-scene3d-registry.test.mjs`
- Modify: `src/core/ecad/EcadScene3dService.mjs`
- Modify: `src/core/ecad/EcadToolkitRuntime.mjs`
- Modify: `src/workers/pcb-scene3d.worker.mjs`
- Modify: `src/Scene3dControllerFactory.mjs`
- Modify: `src/core/PcbAssemblyExportService.mjs`
- Modify: `src/core/PcbAssemblyBoardTextureRenderer.mjs`
- Modify: `tests/core/circuitjson-cad-model-assets.test.mjs`
- Modify: `tests/core/ecad-scene3d-kicad-copper.test.mjs`
- Modify: `tests/core/altium-scene3d-placement-refinement.test.mjs`
- Modify: `tests/core/altium-scene3d-procedural-body.test.mjs`

**Interfaces:**
- Consumes: canonical scene builder/preparator and `resolveAsset(request, { signal })` built from session assets.
- Produces: one canonical scene schema for all formats, no app unit/placement repair, no implicit network/filesystem resolution, and worker/direct equivalence.

- [ ] **Step 1: Write failing canonical scene delegation tests**

```js
test('EcadScene3dService delegates canonical scene preparation', async () => {
    const toolkit = fakeCanonicalToolkit()
    const contexts = new EcadDocumentContextStore()
    const service = new EcadScene3dService({ registry: fakeRegistry('altium', toolkit), contexts })
    const scene = await service.prepare(createDocumentResult('altium'), { resolveAsset: async () => ({ data: new Uint8Array([1]), mediaType: 'model/step' }) })
    assert.equal(scene.schema, 'ecad-toolkit.scene3d.v1')
    assert.equal(toolkit.PcbScene3dPreparator.calls.length, 1)
})
```

- [ ] **Step 2: Run and verify legacy scene branching/shape failure**

Run: `npm test -- tests/core/ecad-scene3d-registry.test.mjs`

Expected: FAIL because `EcadScene3dService` imports three native builders plus viewer adapters and returns mixed mil/app shapes.

- [ ] **Step 3: Implement canonical scene and injected resolver flow**

```js
async prepare(document, options = {}) {
    const toolkit = this.#registry.forDocument(document)
    return toolkit.PcbScene3dPreparator.prepare(this.#contexts.prepare(document), {
        ...options,
        resolveAsset: options.resolveAsset || this.#sessionAssetResolver(options.sessionAssets)
    })
}
```

Remove app-side coordinate/unit conversion, placement repair, silkscreen smoothing, embedded model registry construction, and CircuitJSON viewer adapter branching after library equivalence tests pass. Keep Three.js runtime/controller/export logic in the app/viewer.

Add this scene service to `EcadToolkitRuntime` with the exact same `contexts` instance as its renderer. Worker requests create one request-local runtime, use it for the whole request, and dispose it in `finally`.

- [ ] **Step 4: Run scene/asset/export suites**

Run: `npm test -- tests/core/ecad-scene3d-registry.test.mjs tests/core/circuitjson-cad-model-assets.test.mjs tests/core/ecad-scene3d-kicad-copper.test.mjs tests/core/altium-scene3d-placement-refinement.test.mjs tests/core/altium-scene3d-procedural-body.test.mjs tests/core/pcb-assembly-export-service.test.mjs`

Expected: PASS with canonical millimeter/Z-up scenes.

- [ ] **Step 5: Commit scene migration**

```bash
git add src/core/ecad/EcadScene3dService.mjs src/core/ecad/EcadToolkitRuntime.mjs src/workers/pcb-scene3d.worker.mjs src/Scene3dControllerFactory.mjs src/core/PcbAssemblyExportService.mjs src/core/PcbAssemblyBoardTextureRenderer.mjs tests/core/ecad-scene3d-registry.test.mjs tests/core/circuitjson-cad-model-assets.test.mjs tests/core/ecad-scene3d-kicad-copper.test.mjs tests/core/altium-scene3d-placement-refinement.test.mjs tests/core/altium-scene3d-procedural-body.test.mjs
git commit -m "feature: converge ECAD scene preparation"
```

### Task 6: Replace duplicated netlist dispatch with shared QueryService

**Files:**
- Create: `src/core/ecad/EcadQueryService.mjs`
- Create: `tests/core/ecad-query-service.test.mjs`
- Modify: `src/core/ecad/EcadToolkitRuntime.mjs`
- Modify: `src/core/webmcp/LoadedDesignNetlistService.mjs`
- Modify: `src/core/webmcp/WebMcpDesignAnalyzer.mjs`
- Modify: `src/core/webmcp/WebMcpDesignInspector.mjs`
- Modify: `src/core/webmcp/WebMcpFocusedInspector.mjs`
- Modify: `src/core/webmcp/WebMcpPcbFabricationInspector.mjs`
- Modify: `src/core/webmcp/WebMcpPcbInspector.mjs`
- Modify: `tests/core/webmcp/loaded-design-netlist-service.test.mjs`
- Modify: `tests/core/webmcp/loaded-design-pcb-service.test.mjs`
- Modify: `tests/core/webmcp/webmcp-adapter.test.mjs`

**Interfaces:**
- Consumes: per-document registry `QueryService`, prepared contexts, and capability rows.
- Produces: app-level multi-document selection/aggregation while each actual component/net/connectivity query uses the shared service.

- [ ] **Step 1: Write failing all-format query delegation tests**

```js
test('EcadQueryService delegates one canonical QueryService per document', () => {
    const service = createEcadQueryService([createDocumentResult('altium'), createDocumentResult('kicad')])
    const result = service.findComponents({ query: 'U1' })
    assert.deepEqual(result.items.map((row) => row.sourceFormat), ['altium', 'kicad'])
    assert.equal(service.statistics.queryServicesCreated, 2)
})

test('Gerber semantic queries report unavailable', () => {
    assert.throws(() => createEcadQueryService([createDocumentResult('gerber')]).findComponents({ query: 'U1' }), { code: 'ERR_CAPABILITY_UNAVAILABLE' })
})
```

- [ ] **Step 2: Run and verify duplicated service dispatch failure**

Run: `npm test -- tests/core/ecad-query-service.test.mjs tests/core/webmcp/loaded-design-netlist-service.test.mjs`

Expected: FAIL because the app imports `altium-toolkit/netlist-query` and `kicad-toolkit/netlist-query` separately.

- [ ] **Step 3: Implement shared query binding and preserve host-level shaping**

```js
query(document, request, options = {}) {
    const toolkit = this.#registry.forDocument(document)
    this.#assertAvailable(toolkit, 'query.query')
    return toolkit.QueryService.create(this.#contexts.prepare(document)).query(request, options)
}
```

Keep only session design selection, multi-document aggregation, result limits, and WebMCP response shaping in app modules. Replace snake_case only at the WebMCP boundary; canonical toolkit calls use camelCase.

Construct `EcadQueryService` inside `EcadToolkitRuntime` with the runtime-owned context store; never create a service-local store.

- [ ] **Step 4: Run query/WebMCP suites**

Run: `npm test -- tests/core/ecad-query-service.test.mjs tests/core/webmcp/loaded-design-netlist-service.test.mjs tests/core/webmcp/loaded-design-pcb-service.test.mjs tests/core/webmcp/webmcp-adapter.test.mjs tests/core/webmcp/webmcp-runtime-loader.test.mjs`

Expected: PASS with no toolkit-specific query imports.

- [ ] **Step 5: Commit query migration**

```bash
git add src/core/ecad/EcadQueryService.mjs src/core/ecad/EcadToolkitRuntime.mjs src/core/webmcp tests/core/ecad-query-service.test.mjs tests/core/webmcp
git commit -m "feature: use shared ECAD query services"
```

### Task 7: Converge manufacturing, simulation, BOM, and selected-part actions

**Files:**
- Create: `src/core/ecad/EcadManufacturingService.mjs`
- Create: `src/core/ecad/EcadSimulationService.mjs`
- Create: `src/core/simulation/EcadSpiceEngineAdapter.mjs`
- Create: `tests/core/ecad-manufacturing-service.test.mjs`
- Create: `tests/core/ecad-simulation-service.test.mjs`
- Create: `tests/core/ecad-spice-engine-adapter.test.mjs`
- Modify: `src/core/ecad/EcadToolkitRuntime.mjs`
- Modify: `src/core/simulation/SpiceSimulationWorkerHandler.mjs`
- Modify: `src/core/simulation/SpiceSimulationWorkerClient.mjs`
- Modify: `src/workers/spice-simulation.worker.mjs`
- Modify: `src/ui/SimulationResultPanelRenderer.mjs`
- Modify: `src/ui/ViewerSidebarOverviewRenderer.mjs`
- Modify: `src/AppControllerPcbAssemblyExport.mjs`
- Modify: `src/AppControllerSelectedPartExport.mjs`
- Modify: `src/core/SelectedPartExportService.mjs`
- Modify: `src/core/SelectedPartResolver.mjs`
- Modify: `src/core/PcbAssemblyExportService.mjs`
- Modify: `src/ui/ViewerSidebarManufacturingActions.mjs`
- Modify: `src/ui/AppViewBomPanelRenderer.mjs`
- Modify: `tests/app-controller-manufacturing-export.test.mjs`
- Modify: `tests/core/selected-part-export-service.test.mjs`
- Modify: `tests/core/pcb-assembly-export-service.test.mjs`
- Modify: `tests/core/spice-simulation-worker-handler.test.mjs`
- Modify: `tests/core/spice-simulation-worker-client.test.mjs`
- Modify: `tests/ui/simulation-result-panel-renderer.test.mjs`
- Modify: `tests/ui/app-view-bom-panel.test.mjs`
- Modify: `tests/core/ecad-toolkit-runtime.test.mjs`

**Interfaces:**
- Consumes: registry `ManufacturingService`, `SimulationService`, `QueryService`, capability inventory, canonical assets/extensions, and app download/assembly/SPICE runtime.
- Produces: capability-driven export lists/files, canonical simulation build/export/run, and selected-part lookup by stable CircuitJSON ids.

- [ ] **Step 1: Write failing manufacturing capability tests**

```js
test('manufacturing actions come from the active toolkit', () => {
    const service = createEcadManufacturingService(createDocumentResult('kicad'))
    assert.equal(service.listExports().some((row) => row.id === 'pick-place-csv'), true)
    assert.equal(service.export({ id: 'pick-place-csv', options: {} }).mediaType, 'text/csv;charset=utf-8')
})

test('Gerber BOM export is unavailable without fabricated rows', () => {
    assert.throws(() => createEcadManufacturingService(createDocumentResult('gerber')).export({ id: 'bom-csv', options: {} }), { code: 'ERR_CAPABILITY_UNAVAILABLE' })
})

test('simulation delegates through the toolkit with an explicit local engine', async () => {
    const service = createEcadSimulationService(createDocumentResult('circuitjson'), { engine: fakeSpiceEngine() })
    const result = await service.run({ analysisId: 'tran', parameters: {} })
    assert.equal(result.schema, 'ecad-toolkit.simulation-result.v1')
    assert.equal(result.status, 'complete')
})

test('SPICE engine adapter maps progress, active cancellation, and reuse', async () => {
    const adapter = createSpiceAdapterWithFakeWorker()
    const controller = new AbortController()
    const stages = []
    const pending = adapter.run(spiceEngineRequest(), { signal: controller.signal, onProgress: (row) => { stages.push(row.stage); controller.abort() } })
    await assert.rejects(pending, { code: 'ERR_CANCELLED' })
    assert.equal(stages.length > 0, true)
    assert.equal((await adapter.run(spiceEngineRequest(), {})).status, 'complete')
    adapter.dispose()
})
```

- [ ] **Step 2: Run and verify legacy top-level BOM/manufacturing failure**

Run: `npm test -- tests/core/ecad-manufacturing-service.test.mjs tests/core/ecad-simulation-service.test.mjs tests/app-controller-manufacturing-export.test.mjs`

Expected: FAIL because actions read `documentModel.manufacturing`/`.bom` and toolkit-specific exporters.

- [ ] **Step 3: Implement canonical service delegation**

```js
export(request, options = {}) {
    const toolkit = this.#registry.forDocument(this.#document)
    return toolkit.ManufacturingService.export(this.#contexts.prepare(this.#document), request, options)
}
```

Use `QueryService.findComponents` plus stable model ids for selected parts. Keep app-only archive/download/Three.js assembly serialization; remove source-format export selection and hybrid-property reads.

Implement `EcadSimulationService` through the registry capability rows and `toolkit.SimulationService.build/export/run(this.#contexts.prepare(document), ...)`. `EcadSpiceEngineAdapter` is the only bridge to `SpiceSimulationWorkerClient`; map canonical request/result/errors/progress, translate AbortSignal to worker cancel, replace/reuse the worker after active cancellation, and dispose it with the runtime. No toolkit starts a process or network request implicitly. Update the worker handler/client and `SimulationResultPanelRenderer` to canonical envelopes. Add manufacturing and simulation to `EcadToolkitRuntime` with the same context store, then extend the runtime test to call all services for one document and assert exactly one context before release/disposal.

- [ ] **Step 4: Run manufacturing/BOM/export suites**

Run: `npm test -- tests/core/ecad-manufacturing-service.test.mjs tests/core/ecad-simulation-service.test.mjs tests/core/ecad-spice-engine-adapter.test.mjs tests/app-controller-manufacturing-export.test.mjs tests/core/selected-part-export-service.test.mjs tests/core/pcb-assembly-export-service.test.mjs tests/core/spice-simulation-worker-handler.test.mjs tests/core/spice-simulation-worker-client.test.mjs tests/ui/simulation-result-panel-renderer.test.mjs tests/ui/app-view-bom-panel.test.mjs tests/core/ecad-toolkit-runtime.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit manufacturing migration**

```bash
git add src/core/ecad/EcadManufacturingService.mjs src/core/ecad/EcadSimulationService.mjs src/core/ecad/EcadToolkitRuntime.mjs src/core/simulation/EcadSpiceEngineAdapter.mjs src/core/simulation/SpiceSimulationWorkerHandler.mjs src/core/simulation/SpiceSimulationWorkerClient.mjs src/workers/spice-simulation.worker.mjs src/AppControllerPcbAssemblyExport.mjs src/AppControllerSelectedPartExport.mjs src/core/SelectedPartExportService.mjs src/core/SelectedPartResolver.mjs src/core/PcbAssemblyExportService.mjs src/ui/ViewerSidebarManufacturingActions.mjs src/ui/AppViewBomPanelRenderer.mjs src/ui/SimulationResultPanelRenderer.mjs src/ui/ViewerSidebarOverviewRenderer.mjs tests/core/ecad-manufacturing-service.test.mjs tests/core/ecad-simulation-service.test.mjs tests/core/ecad-spice-engine-adapter.test.mjs tests/app-controller-manufacturing-export.test.mjs tests/core/selected-part-export-service.test.mjs tests/core/pcb-assembly-export-service.test.mjs tests/core/spice-simulation-worker-handler.test.mjs tests/core/spice-simulation-worker-client.test.mjs tests/ui/simulation-result-panel-renderer.test.mjs tests/ui/app-view-bom-panel.test.mjs tests/core/ecad-toolkit-runtime.test.mjs
git commit -m "feature: converge ECAD manufacturing actions"
```

### Task 8: Migrate remaining core/UI consumers and close the inventory

**Files:**
- Modify: `spec/document-envelope-migration.json`
- Create: `tests/no-legacy-document-shape.test.mjs`
- Modify: `src/core/ecad/EcadToolkitRuntime.mjs`
- Modify: `src/AppControllerModelSearchPreferenceHandler.mjs`
- Modify: `src/AppControllerSessionAssetHandler.mjs`
- Modify: `src/GitHubParsePlan.mjs`
- Modify: `src/HeroPreviewDemoLoader.mjs`
- Modify: `src/core/NetSelectionModel.mjs`
- Modify: `src/core/PcbComponentSelectionModel.mjs`
- Modify: `src/core/SelectedPartStitchedModelExporter.mjs`
- Modify: `src/core/PcbLayerVisibilityModel.mjs`
- Modify: `src/core/ecad/EcadMissingModelSearchService.mjs`
- Modify: `src/ui/AppView.mjs`
- Modify: `src/ui/AppViewPcbContentReuseModel.mjs`
- Modify: `src/ui/AppViewSchematicContentReuseModel.mjs`
- Modify: `src/ui/DocumentRailRenderer.mjs`
- Modify: `src/ui/PcbViewController.mjs`
- Modify: `src/ui/PcbViewRenderer.mjs`
- Modify: `src/ui/SchematicViewRenderer.mjs`
- Modify: `src/ui/ViewerSidebarComponentRenderer.mjs`
- Modify: `src/ui/ViewerSidebarGerberRenderer.mjs`
- Modify: `src/ui/ViewerSidebarLayerRenderer.mjs`
- Modify: `src/ui/ViewerSidebarNetRenderer.mjs`
- Modify: `src/ui/ViewerSidebarOverviewRenderer.mjs`
- Modify: `src/ui/ViewerSidebarRenderer.mjs`
- Modify: `tests/ui/viewer-sidebar-renderer.test.mjs`

**Interfaces:**
- Consumes: `EcadDocumentAccess`, renderer/query/manufacturing/scene services, and migration inventory rows.
- Produces: zero legacy document-shape reads outside explicitly source-native extension access and all inventory rows `status: 'migrated'`.

- [ ] **Step 1: Write the failing source/inventory scan**

```js
test('source contains no legacy hybrid document access', async () => {
    const inventory = JSON.parse(await readFile('spec/document-envelope-migration.json', 'utf8'))
    assert.equal(inventory.every((row) => row.status === 'migrated'), true)
    const violations = await scanSource(/documentModel|(?:document|activeDocument)\??\.(?:pcb|schematic|bom|sourceFormat|kind)\b/u, allowedCanonicalAccessFiles)
    assert.deepEqual(violations, [])
})
```

- [ ] **Step 2: Run and capture exact remaining violations**

Run: `npm test -- tests/no-legacy-document-shape.test.mjs`

Expected: FAIL listing the remaining paths and line numbers represented by pending inventory rows.

- [ ] **Step 3: Migrate each row to model, extension, or canonical service access**

Use `document.model` only for shared element data, `EcadDocumentAccess.extension(document, format)` only for native panels, and the injected `EcadToolkitRuntime` for rendering/query/manufacturing/simulation/scene behavior. Remove every temporary static service forwarding facade from Tasks 4-7 and add a source assertion that UI/core consumers neither instantiate their own `EcadDocumentContextStore` nor call static toolkit services. Do not suppress a scan row without a focused test path in the inventory.

- [ ] **Step 4: Run source scan plus affected UI/core suites**

Run: `npm test -- tests/no-legacy-document-shape.test.mjs tests/core/ecad-services.test.mjs tests/ui/pcb-view-renderer.test.mjs tests/ui/schematic-view-renderer.test.mjs tests/ui/viewer-sidebar-renderer.test.mjs tests/app-controller.test.mjs`

Expected: PASS with every inventory row migrated/tested.

- [ ] **Step 5: Commit remaining consumer migration**

```bash
git add spec/document-envelope-migration.json tests/no-legacy-document-shape.test.mjs tests/ui/viewer-sidebar-renderer.test.mjs src/AppControllerModelSearchPreferenceHandler.mjs src/AppControllerSessionAssetHandler.mjs src/GitHubParsePlan.mjs src/HeroPreviewDemoLoader.mjs src/core/NetSelectionModel.mjs src/core/PcbComponentSelectionModel.mjs src/core/SelectedPartStitchedModelExporter.mjs src/core/PcbLayerVisibilityModel.mjs src/core/ecad/EcadMissingModelSearchService.mjs src/core/ecad/EcadToolkitRuntime.mjs src/ui
git commit -m "feature: complete ECAD document envelope migration"
```

### Task 9: Prepare and visually verify the app code candidate

**Files:**
- Create: `docs/toolkit-api-migration.md`
- Create: `docs/release-evidence/1.10.0/README.md`
- Create: `tests/core/toolkit-candidate-stack.test.mjs`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/testing.md`
- Modify: `docs/troubleshooting.md`
- Modify: `spec/ecadforge_adjustment_spec.md`
- Modify: `spec/web-app-specification.md`

**Interfaces:**
- Consumes: fully migrated app code with candidate tarballs installed.
- Produces: documented architecture/migration, passing app gates, and browser screenshot evidence for CircuitJSON/Gerber/Altium/KiCad.

- [ ] **Step 1: Write failing candidate-stack integration checks**

```js
test('installed candidate stack exposes exact compatible versions', async () => {
    assert.deepEqual(await installedToolkitVersions(), {
        altium: '1.2.0', circuitjson: '1.1.0', gerber: '0.2.0', kicad: '1.1.0', viewer: '1.1.50'
    })
    assert.equal((await npmLsCircuitJson()).versions.length, 1)
})
```

- [ ] **Step 2: Run complete local app gates**

Run: `npm test && npm run check:circuitjson-schema && npm run check:format && npm run build:static`

Expected: PASS; candidate-stack test fails only if a tarball/version/core dedupe is wrong.

- [ ] **Step 3: Run browser sanity checks and capture evidence**

Run `npm start`, open `http://localhost:3000/`, load one repo-owned sample per format, and verify available schematic/PCB/BOM/layers/queries/manufacturing/simulation/diagnostics/measurements/selected-part/workers/3D flows. Exercise local SPICE through the canonical injected-engine path and verify unavailable source/analysis combinations are capability-gated. For unavailable Gerber semantics, verify the disabled UI and typed error path. Save screenshots under `docs/release-evidence/1.10.0/` and list each view/sample/test in its README.

- [ ] **Step 4: Update architecture/testing/troubleshooting/migration docs**

Document registry ownership, envelope/context lifecycle, extension access, worker protocol, capability gating, removed app workarounds, and exact old/new app service calls.

- [ ] **Step 5: Commit the verified app code candidate**

```bash
git add README.md docs spec tests/core/toolkit-candidate-stack.test.mjs
git commit -m "docs: verify converged toolkit integration"
```

### Task 10: Run the all-tarball candidate matrix before any publish

**Files:**
- Create outside repositories: `../release-candidates/*.tgz`
- Create outside repositories: `../release-candidates/ecadforge-candidate/package.json`
- Modify: `docs/release-evidence/1.10.0/README.md`
- Do not commit temporary file-dependency lockfiles.

**Interfaces:**
- Consumes: clean candidate commits from all four libraries and app code candidate.
- Produces: tarball hashes, downstream full-suite evidence, viewer compatibility proof, and authorization to begin stable publication.

- [ ] **Step 1: Pack all library candidates from clean worktrees**

Run `npm pack` in core, Gerber, Altium, and KiCad worktrees; move tarballs to `../release-candidates/`; record SHA-256 hashes and candidate commit SHAs in `docs/release-evidence/1.10.0/README.md`.

- [ ] **Step 2: Test the core tarball in every direct consumer**

Install the core tarball with `--no-save --package-lock=false` into isolated temporary copies of Gerber, Altium, KiCad, and `pcb-scene3d-viewer`; run each repository's `npm test` and `npm run check:format`, then delete the copies. Expected: all pass without dirtying any source worktree; viewer imports `CircuitJsonDocument`, `CircuitJsonIndexer`, and `CircuitJsonUnits` successfully.

- [ ] **Step 3: Test all four tarballs in a temporary ECAD Forge copy**

Create `../release-candidates/ecadforge-candidate`, copy the app excluding `.git`/`node_modules`, set its four toolkit dependencies to absolute `file:` tarballs, run `npm install`, then `npm ci`, `npm test`, `npm run check:circuitjson-schema`, `npm run check:structured-data`, `npm run build:static`, and `npm run check:format`.

- [ ] **Step 4: Verify candidate dependency and package contents**

Run `npm ls circuitjson-toolkit`; expected exactly one `1.1.0`. Import-smoke every documented subpath from each tarball. Confirm packed notices/docs/migrations are present and `circuit-json@0.0.446` is absent from runtime graphs.

- [ ] **Step 5: Record the passing candidate matrix**

Append commands, exit codes, hashes, versions, and one-core dependency tree to `docs/release-evidence/1.10.0/README.md`; commit only that evidence in the app worktree.

```bash
git add docs/release-evidence/1.10.0/README.md
git commit -m "test: verify toolkit candidate matrix"
```

### Task 11: Publish and verify the four npm libraries

**Files:**
- Modify in Gerber, Altium, and KiCad after core publication: `package-lock.json` registry resolution for exact `circuitjson-toolkit@1.1.0`.
- Modify only if parity repair is required: other package/release metadata in the affected library.
- Create GitHub releases for the verified core candidate and the content-equivalent lock-normalized source commits.

**Interfaces:**
- Consumes: passing candidate matrix, exact core candidate, and source code candidates whose only post-core change may be lockfile registry normalization.
- Produces: verified npm/Git/tag/GitHub release parity for core first, then three source toolkits whose final tarballs have been retested.

- [ ] **Step 1: Publish and verify `circuitjson-toolkit@1.1.0`**

Use `npm-library-release-deploy`. Publish the exact candidate commit, push/tag it, create release notes with `Breaking API convergence`, and verify npm version and `gitHead` match the tag/release target.

- [ ] **Step 2: Normalize source locks to the published registry core and prove content equivalence**

In Gerber, Altium, and KiCad run `npm install --package-lock-only --save-exact circuitjson-toolkit@1.1.0`, assert that `package-lock.json` contains no `file:` candidate resolution, and commit only the resulting lockfile with `chore: lock circuitjson-toolkit 1.1.0`. Then run `npm ci`, `npm ls circuitjson-toolkit`, full tests, formatting, benchmarks, packed-subpath smoke tests, and `npm pack --json`. Extract and compare each final source tarball with its Task 10 candidate; if the lockfile is not packed, all shipped files must be byte-identical. If it is packed, only that lockfile may differ. Replace the source tarballs in `../release-candidates`, rerun the temporary ECAD Forge tarball matrix, and record final hashes/commit SHAs before any source publish.

- [ ] **Step 3: Publish Gerber, Altium, and KiCad independently**

Use `npm-library-release-deploy` for `gerber-toolkit@0.2.0`, `altium-toolkit@1.2.0`, and `kicad-toolkit@1.1.0` from the final lock-normalized commits. For each, publish the retested final tarball and verify local/lock version, commit, tag, GitHub target, npm version, npm `gitHead`, and registry integrity before starting the next dependent action.

- [ ] **Step 4: Stop on any partial release**

If parity fails, do not release ECAD Forge. Record exact partial state, create a new patch version for repair, and never reuse a published version.

- [ ] **Step 5: Record immutable registry evidence**

Add npm metadata, tags, release URLs, commit SHAs, and `gitHead` values to the app release-evidence README.

### Task 12: Pin registry dependencies, release ECAD Forge 1.10.0, and verify deployment

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/index.html`
- Modify: `src/altium-kicad-browser-viewer.html`
- Modify: `src/altium-pcbdoc-viewer.html`
- Modify: `src/altium-schdoc-viewer.html`
- Modify: `src/bom-viewer-kicad-altium.html`
- Modify: `src/ecad-viewer-no-upload.html`
- Modify: `src/kicad-project-viewer.html`
- Modify: `src/kicad-viewer-online.html`
- Modify: `src/pcb-3d-viewer-browser.html`
- Modify: `docs/release-evidence/1.10.0/README.md`

**Interfaces:**
- Consumes: verified registry library versions.
- Produces: exact app dependency lock, app `1.10.0`, synchronized structured data, successful GitHub release, and successful FTP deployment workflow.

- [ ] **Step 1: Pin exact registry versions and app version**

Run:

```bash
npm install --save-exact circuitjson-toolkit@1.1.0 gerber-toolkit@0.2.0 altium-toolkit@1.2.0 kicad-toolkit@1.1.0 pcb-scene3d-viewer@1.1.50
npm version 1.10.0 --no-git-tag-version
npm ls circuitjson-toolkit
```

Expected: one core `1.1.0`; package and lockfile app versions `1.10.0`.

- [ ] **Step 2: Synchronize generated HTML and run clean-install release gates**

Run: `npm run sync:structured-data && npm run check:structured-data && npm run check:circuitjson-schema && npm test && npm run build:static && npm run check:format && git diff --check`, then repeat from a clean `npm ci`.

Expected: all commands exit 0 and generated `src/*.html` contains version `1.10.0`.

- [ ] **Step 3: Commit, push, tag, and create the app release**

Use `release-ecadforge-app`. Commit with `release: prepare ECAD Forge 1.10.0`, push the release commit to `main`, tag `v1.10.0`, and create concise release notes with prominent breaking API mappings, retained features, performance evidence, and verification results.

- [ ] **Step 4: Watch the exact deployment workflow**

Run `gh run list --branch main --commit <release-sha>` to identify `Deploy to FTP (main)`, then `gh run watch <run-id> --exit-status`.

Expected: workflow conclusion `success` for the pushed release SHA.

- [ ] **Step 5: Perform post-release parity and deployed sanity checks**

Verify tag/release target, npm dependency tree, app version metadata, deployed page/runtime version, and one smoke view per format. Report any tag/release without successful deployment as partial state; report completion only after all checks pass.
