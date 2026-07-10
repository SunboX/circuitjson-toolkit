# CircuitJSON Core Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release `circuitjson-toolkit@1.1.0` as the strict, fast, source-neutral runtime that defines and tests the common ECAD toolkit contract.

**Architecture:** The canonical serializable value is an immutable CircuitJSON element array inside a `DocumentResult`; request-scoped `CircuitJsonDocumentContext` objects own validation proofs and reusable indexes. Thin canonical services consume a document or context, while source-specific packages retain native decoding and fidelity extensions. The package exports the shared contracts, conformance harness, worker protocol, benchmark runner, and temporary viewer compatibility symbols.

**Tech Stack:** Node.js 20+, ESM, `node:test`, browser module workers, Prettier 3, exact development reference `circuit-json@0.0.446`.

## Global Constraints

- Baseline is `circuitjson-toolkit@1.0.17` at peeled tag commit `8c9d7deb0229d7d7d8d2f7bdcd621933e88753f9`; release is exactly `1.1.0`.
- Before Task 1, use `superpowers:using-git-worktrees` to create `/Users/afiedler/Documents/privat/Andrés_Werkstatt/circuitjson-toolkit-api-convergence` from the current `main` containing the approved design/plan commits; preserve the original worktree and baseline tag. From that sibling worktree, `../release-candidates` resolves to the shared candidate directory.
- Standard models target `circuit-json@0.0.446`; private toolkit element types are rejected.
- Public options are camelCase; PCB sides are `top` and `bottom`; options are the final optional argument.
- Parser defaults are `preserveRaw: false`, `decodeAssets: 'metadata'`, `extensions: 'canonical'`, `reports: []`, `retainSource: 'none'`, `worker: 'auto'`, and `transferInput: false`.
- `model` is pure immutable CircuitJSON; no expando renderer model, AST, board graph, raw payload, or report graph may be attached.
- Files stay below 1000 lines, use 4-space indentation, single quotes, no semicolons, no trailing commas, and JSDoc on every function and method.
- Every behavior change starts with a failing synthetic test and ends with the focused test, `npm test`, and `npm run check:format` passing.
- Every focused command in a task uses `npm test -- <paths>`; immediately before that task's commit, also run unfiltered `npm test && npm run check:format` and stop on either failure.
- `circuit-json@0.0.446` is development-only and must not enter runtime or browser dependency graphs.
- Required primary benchmark cases improve median time by at least 20 percent; other large cases regress at most 5 percent; small cases regress at most 10 percent; duplicate-graph clone bytes shrink at least 25 percent.
- Preserve `CircuitJsonDocument`, `CircuitJsonIndexer`, and `CircuitJsonUnits` as documented deprecated root exports throughout 1.1.x for `pcb-scene3d-viewer@1.1.50`.
- Do not publish from this phase; produce a packed candidate for the coordinated release plan.

## File Structure

- `src/core/contracts/`: clone-safe document, project, asset, diagnostic, progress, and error builders.
- `src/core/context/`: validation proof, immutable model handling, prepared indexes, and lazy derived models.
- `src/core/query/`: standards-native component, net, connectivity, traversal, and netlist queries.
- `src/core/rendering/`: prepared PCB render plans and reusable layer projections.
- `src/core/scene3d/`: data-only board and placement scene descriptions.
- `src/core/worker/`: versioned message validation and direct/worker result normalization.
- `src/testing/`: the published cross-toolkit conformance harness and synthetic fixtures.
- `src/workers/`: browser worker entrypoints only.
- `benchmarks/`: deterministic factories, runner, immutable baseline report, and result reports.
- `scripts/`: schema sync, baseline capture, feature-ledger validation, benchmark, and packed-entrypoint checks.
- `spec/`: synchronized schema metadata, API baseline, preservation ledger, and library scope.

---

### Task 1: Freeze the schema, API, and benchmark baselines

**Files:**
- Create: `scripts/sync-circuit-json-schema.mjs`
- Create: `scripts/capture-api-baseline.mjs`
- Create: `scripts/check-feature-preservation.mjs`
- Create: `scripts/run-benchmarks.mjs`
- Create: `benchmarks/SyntheticCircuitJsonFactory.mjs`
- Create: `benchmarks/CircuitJsonBenchmarkSuite.mjs`
- Create: `benchmarks/baseline-v1.0.17.json`
- Create: `spec/circuitjson-schema-source.json`
- Create: `spec/circuitjson-schema-snapshot.json`
- Create: `spec/api-baseline-v1.0.17.json`
- Create: `spec/feature-preservation.json`
- Create: `tests/convergence-baselines.test.mjs`
- Create: `tests/feature-preservation-check.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: current `src/index.mjs`, package exports, and `CircuitJsonElementValidator.schemaSnapshot()`.
- Produces: `npm run sync:schema`, `npm run check:features`, `npm run benchmark`, immutable JSON baselines, and a ledger row for every baseline export/method/option/field/behavior.

- [ ] **Step 1: Write the failing baseline-artifact test**

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('convergence baselines identify immutable source versions and primary cases', async () => {
    const source = JSON.parse(await readFile('spec/circuitjson-schema-source.json', 'utf8'))
    const api = JSON.parse(await readFile('spec/api-baseline-v1.0.17.json', 'utf8'))
    const benchmark = JSON.parse(await readFile('benchmarks/baseline-v1.0.17.json', 'utf8'))
    assert.equal(source.package, 'circuit-json')
    assert.equal(source.version, '0.0.446')
    assert.equal(api.packageVersion, '1.0.17')
    assert.equal(benchmark.cases.filter((entry) => entry.primary).length >= 2, true)
})
```

- [ ] **Step 2: Run the test and verify the missing-artifact failure**

Run: `npm test -- tests/convergence-baselines.test.mjs`

Expected: FAIL with `ENOENT` for `spec/circuitjson-schema-source.json`.

- [ ] **Step 3: Install the exact reference package and implement deterministic generators**

Run: `npm install --save-dev --save-exact circuit-json@0.0.446`

Add these exact scripts to `package.json`:

```json
{
    "sync:schema": "node scripts/sync-circuit-json-schema.mjs",
    "capture:api": "node scripts/capture-api-baseline.mjs",
    "check:features": "node scripts/check-feature-preservation.mjs",
    "benchmark": "node scripts/run-benchmarks.mjs"
}
```

The schema source generator must write this clone-safe metadata shape with the installed integrity from `package-lock.json`:

```js
const source = {
    package: 'circuit-json',
    version: '0.0.446',
    integrity: lock.packages['node_modules/circuit-json'].integrity,
    sourceUrl: 'https://www.npmjs.com/package/circuit-json/v/0.0.446',
    license: referencePackage.license
}
```

Mark `parse-context-50000` and `repeated-query-hit-test` as `primary: true` before recording timings; also freeze required non-primary `repeated-netlist-query`, `multi-layer-render`, and `context-reuse` cases. `check-feature-preservation.mjs` must fail unless every baseline row has `shared`, `native-extension`, or `unavailable`, plus non-empty replacement, tests, and documentation arrays. Its final `--strict` mode additionally imports packed entrypoints, checks each `capabilityId` against `ToolkitCapabilities.inventory()`, and verifies every referenced test/documentation path exists; cover stale, fictitious, and missing mappings in `tests/feature-preservation-check.test.mjs`.

- [ ] **Step 4: Generate and verify the baselines**

Run: `npm run sync:schema && npm run capture:api && npm run benchmark -- --record benchmarks/baseline-v1.0.17.json && npm run check:features && npm test -- tests/convergence-baselines.test.mjs`

Expected: all commands exit 0; the benchmark report contains environment, fixture checksum, warmups, samples, median milliseconds, clone bytes, and retained-heap observations.

- [ ] **Step 5: Commit the immutable baselines**

```bash
git add package.json package-lock.json scripts benchmarks spec tests/convergence-baselines.test.mjs tests/feature-preservation-check.test.mjs
git commit -m "chore: record convergence baselines"
```

### Task 2: Add clone-safe shared contracts and typed failures

**Files:**
- Create: `src/core/contracts/ToolkitError.mjs`
- Create: `src/core/contracts/ToolkitDiagnostic.mjs`
- Create: `src/core/contracts/ToolkitAsset.mjs`
- Create: `src/core/contracts/DocumentResult.mjs`
- Create: `src/core/contracts/ProjectResult.mjs`
- Create: `src/core/contracts/ToolkitProgress.mjs`
- Create: `src/core/ToolkitCapabilities.mjs`
- Create: `tests/shared-contracts.test.mjs`

**Interfaces:**
- Consumes: schema version `0.0.446` and canonical result definitions from the umbrella design.
- Produces: `ToolkitError`, `DocumentResult.create()`, `ProjectResult.create()`, normalized diagnostics/assets/progress, and `ToolkitCapabilities.inventory()`.
- Progress uses ordered top-level stages `detect`, `decode`, `project`, `validate`, and `complete`; optional `detail` carries source-specific phase names without changing worker-client control flow.

- [ ] **Step 1: Write failing contract-shape tests**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { DocumentResult } from '../src/core/contracts/DocumentResult.mjs'
import { ToolkitError } from '../src/core/contracts/ToolkitError.mjs'
import { ToolkitProgress } from '../src/core/contracts/ToolkitProgress.mjs'

test('DocumentResult creates the canonical clone-safe envelope', () => {
    const result = DocumentResult.create({ fileName: 'board.json', model: [] })
    assert.deepEqual(Object.keys(result), [
        'schema', 'id', 'modelSchema', 'model', 'source', 'extensions',
        'assets', 'diagnostics', 'statistics'
    ])
    assert.equal(result.schema, 'ecad-toolkit.document.v1')
    assert.equal(result.modelSchema.version, '0.0.446')
})

test('ToolkitError serializes a normalized cause', () => {
    const error = ToolkitError.from(new Error('bad input'), {
        code: 'ERR_PARSE', category: 'parse', format: 'circuitjson', source: 'board.json'
    })
    assert.equal(error.toJSON().cause.message, 'bad input')
    assert.doesNotThrow(() => structuredClone(error.toJSON()))
})

test('ToolkitProgress keeps source detail behind common ordered stages', () => {
    const progress = ToolkitProgress.create({ stage: 'decode', detail: 'commands' })
    assert.equal(progress.stage, 'decode')
    assert.equal(progress.detail, 'commands')
    assert.throws(() => ToolkitProgress.create({ stage: 'inflate' }), { code: 'ERR_PROGRESS_STAGE' })
})
```

- [ ] **Step 2: Run the focused test and verify missing modules**

Run: `npm test -- tests/shared-contracts.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `DocumentResult.mjs`.

- [ ] **Step 3: Implement exact builders and capability rows**

```js
export class ToolkitError extends Error {
    constructor(message, fields = {}) {
        super(String(message || 'Toolkit operation failed.'))
        this.name = 'ToolkitError'
        this.code = String(fields.code || 'ERR_TOOLKIT_RUNTIME')
        this.category = String(fields.category || 'runtime')
        this.format = String(fields.format || 'circuitjson')
        this.source = String(fields.source || '')
        this.location = fields.location || null
        this.details = fields.details || {}
        this.cause = ToolkitError.cloneSafeCause(fields.cause)
    }

    static from(error, fields = {}) {
        return error instanceof ToolkitError
            ? error
            : new ToolkitError(error?.message, { ...fields, cause: error })
    }

    static cloneSafeCause(error) {
        if (!error) return null
        return { name: String(error.name || 'Error'), message: String(error.message || error), code: error.code == null ? null : String(error.code) }
    }

    toJSON() {
        return { name: this.name, message: this.message, code: this.code, category: this.category, format: this.format, source: this.source, location: this.location, details: this.details, cause: this.cause }
    }
}
```

`DocumentResult.create()` must normalize one source extension namespace with `$meta`, create deterministic source-derived ids without hashing the complete input, and leave CircuitJSON documents with `{}` extensions. `ToolkitCapabilities.inventory()` must return stable `${category}.${operation}` ids and all required fields. `ToolkitProgress` validates the common stage vocabulary and clone-safe optional detail/count fields; emitters may omit stages but may not move backward, and `complete` is terminal.

- [ ] **Step 4: Run contract tests**

Run: `npm test -- tests/shared-contracts.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit shared contracts**

```bash
git add src/core/contracts src/core/ToolkitCapabilities.mjs tests/shared-contracts.test.mjs
git commit -m "feature: add canonical toolkit contracts"
```

### Task 3: Make validated models immutable and add request-scoped contexts

**Files:**
- Create: `src/core/context/CircuitJsonValidationProof.mjs`
- Create: `src/core/context/CircuitJsonDocumentContext.mjs`
- Create: `src/core/context/CircuitJsonContextIndexes.mjs`
- Create: `src/core/context/CircuitJsonDerivedCache.mjs`
- Create: `tests/circuit-json-document-context.test.mjs`
- Modify: `src/core/contracts/DocumentResult.mjs`
- Modify: `src/core/CircuitJsonElementValidator.mjs`
- Modify: `src/core/CircuitJsonDocument.mjs`
- Modify: `src/core/CircuitJsonIndexer.mjs`

**Interfaces:**
- Consumes: `DocumentResult` and current indexer behavior.
- Produces: synchronous `CircuitJsonDocumentContext.prepare(document, options)`, one validation proof per immutable in-process result, one construction per requested index, and request-scoped source caches through `getOrCreateDerived(namespace, key, factory)`.

- [ ] **Step 1: Write failing immutability and reuse tests**

```js
test('context reuses parser proof and constructs requested indexes once', () => {
    const document = DocumentResult.createValidated({ fileName: 'board.json', model: [{ type: 'pcb_board', pcb_board_id: 'b1', width: 2, height: 1, center: { x: 0, y: 0 } }] })
    const context = CircuitJsonDocumentContext.prepare(document, { indexes: ['elements', 'connectivity'] })
    const same = CircuitJsonDocumentContext.prepare(context, { indexes: ['spatial'] })
    const firstPlan = context.getOrCreateDerived('test', 'render-plan', () => ({ id: 'plan-1' }))
    const secondPlan = context.getOrCreateDerived('test', 'render-plan', () => ({ id: 'plan-2' }))
    assert.equal(same, context)
    assert.equal(context.statistics.validationPasses, 0)
    assert.equal(context.statistics.indexBuilds.elements, 1)
    assert.equal(context.statistics.derivedBuilds['test:render-plan'], 1)
    assert.equal(firstPlan, secondPlan)
    assert.equal(Object.isFrozen(document.model[0].center), true)
    const callerContext = CircuitJsonDocumentContext.prepare([{ type: 'pcb_board', pcb_board_id: 'caller', width: 1, height: 1, center: { x: 0, y: 0 } }])
    assert.equal(callerContext.statistics.validationPasses, 1)
})
```

- [ ] **Step 2: Run and verify the missing-context failure**

Run: `npm test -- tests/circuit-json-document-context.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `CircuitJsonDocumentContext.mjs`.

- [ ] **Step 3: Implement validation-plus-freeze and lazy index preparation**

```js
static prepare(input, options = {}) {
    const context = input instanceof CircuitJsonDocumentContext
        ? input
        : CircuitJsonDocumentContext.#fromInput(input)
    context.#indexes.ensure(options.indexes || [])
    return context
}

getOrCreateDerived(namespace, key, factory) {
    return this.#derived.getOrCreate(String(namespace), String(key), factory)
}
```

During the validator's existing schema traversal, freeze each visited plain object/array after its children validate. Store the proof on the envelope with a module-private symbol. `CircuitJsonIndexer.index()` must accept `{ validated: true }` only from the context-owned internal call, never from public caller data. Derived caches are runtime-only, namespace/key scoped, never serialized, never process-global, and cache only successful factory results.

Add `DocumentResult.createValidated(fields)` as the only parser-facing builder: it validates/freezes once, attaches the runtime-only proof, then calls the same public shape normalizer as `create(fields)`.

- [ ] **Step 4: Run focused and legacy validation/index tests**

Run: `npm test -- tests/circuit-json-document-context.test.mjs tests/circuit-json-document.test.mjs tests/circuit-json-indexer.test.mjs`

Expected: PASS with parser-proof context `validationPasses === 0`, caller-created/uncloned input `=== 1`, and no legacy assertion changes.

- [ ] **Step 5: Commit context reuse**

```bash
git add src/core/context src/core/contracts/DocumentResult.mjs src/core/CircuitJsonElementValidator.mjs src/core/CircuitJsonDocument.mjs src/core/CircuitJsonIndexer.mjs tests/circuit-json-document-context.test.mjs
git commit -m "feature: add reusable CircuitJSON document contexts"
```

### Task 4: Replace hybrid parser arrays with the canonical parser envelope

**Files:**
- Create: `src/core/Parser.mjs`
- Create: `src/core/ParserOptions.mjs`
- Create: `tests/parser-contract.test.mjs`
- Modify: `src/core/CircuitJsonParser.mjs`
- Modify: `src/parser.mjs`
- Modify: `tests/circuit-json-parser.test.mjs`

**Interfaces:**
- Consumes: `DocumentResult`, `ToolkitError`, and `CircuitJsonDocumentContext` proof creation.
- Produces: `Parser.parse(input, options)` and resolved `parseAsync` values as canonical envelopes, `tryParse` as the exact discriminated result, and bounded boolean `supports`.

- [ ] **Step 1: Write failing parser contract tests**

```js
test('Parser returns a pure model inside DocumentResult', () => {
    const result = Parser.parse({ fileName: 'board.json', data: '[]' })
    assert.equal(result.schema, 'ecad-toolkit.document.v1')
    assert.deepEqual(result.model, [])
    assert.equal(Object.hasOwn(result.model, 'fileName'), false)
    assert.equal(CircuitJsonDocumentContext.prepare(result).statistics.validationPasses, 0)
})

test('Parser.tryParse returns a discriminated ToolkitError', () => {
    const success = Parser.tryParse({ fileName: 'board.json', data: '[]' })
    assert.deepEqual(success, { ok: true, value: success.value })
    assert.equal(success.value.schema, 'ecad-toolkit.document.v1')
    const result = Parser.tryParse({ fileName: 'bad.json', data: '{' })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'ERR_CIRCUITJSON_PARSE')
    assert.equal(Array.isArray(result.diagnostics), true)
})
```

- [ ] **Step 2: Run and verify that `Parser` is not exported**

Run: `npm test -- tests/parser-contract.test.mjs`

Expected: FAIL because `Parser` is not defined by `src/parser.mjs`.

- [ ] **Step 3: Implement one decode, one validation, and lazy derived data**

```js
static parse(input, options = {}) {
    const normalized = ParserOptions.normalize(input, options)
    try {
        const model = JSON.parse(ParserOptions.text(normalized.input.data))
        return DocumentResult.createValidated({
            fileName: normalized.input.fileName,
            fileType: 'circuitjson',
            format: 'circuitjson',
            model
        })
    } catch (error) {
        throw ToolkitError.from(error, {
            code: 'ERR_CIRCUITJSON_PARSE', category: 'parse', format: 'circuitjson', source: normalized.input.fileName
        })
    }
}
```

`parseAsync()` must call the direct path for `worker: false`, use the shared worker client after Task 11 for `worker: true`, and honor an already-aborted signal with `ERR_CANCELLED`. Keep `CircuitJsonParser` only as a documented migration wrapper until the end of this release task, not as a root canonical export.

Normalize and test every common option even when CircuitJSON has no source-native payload: `extensions` modes/feature arrays leave `{}` extensions, all `decodeAssets` modes return the provided or empty canonical asset list, unknown report ids fail with `ERR_CAPABILITY_UNAVAILABLE`, `retainSource: 'reference'` stays runtime-only and forces a compatible direct async path, and synchronous parsing rejects `worker: true`.

- [ ] **Step 4: Run parser and context tests**

Run: `npm test -- tests/parser-contract.test.mjs tests/circuit-json-parser.test.mjs tests/circuit-json-document-context.test.mjs`

Expected: PASS; one parse produces no eager BOM, manufacturing, support, or index scans.

- [ ] **Step 5: Commit the canonical parser**

```bash
git add src/core/Parser.mjs src/core/ParserOptions.mjs src/core/CircuitJsonParser.mjs src/parser.mjs tests/parser-contract.test.mjs tests/circuit-json-parser.test.mjs
git commit -m "feature: return canonical parser envelopes"
```

### Task 5: Add safe multi-entry and archive project loading

**Files:**
- Create: `src/core/ProjectLoader.mjs`
- Create: `src/core/ArchiveLimits.mjs`
- Create: `src/core/ArchiveLimitsValidator.mjs`
- Create: `src/core/ArchiveEntryPath.mjs`
- Create: `src/project.mjs`
- Create: `tests/project-loader-contract.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `Parser`, `ProjectResult`, parser options, and typed errors.
- Produces: `ProjectLoader.load`, `tryLoad`, `loadAsync`, and `supports` with bounded entry classification and stable partial-success ordering.

- [ ] **Step 1: Write failing project and archive limit tests**

```js
test('ProjectLoader returns stable partial successes', () => {
    const result = ProjectLoader.load([
        { name: 'a.json', data: '[]' },
        { name: 'broken.json', data: '{' }
    ])
    assert.equal(result.documents.length, 1)
    assert.equal(result.diagnostics[0].severity, 'error')
    assert.deepEqual(result.source.entryNames, ['a.json', 'broken.json'])
})

test('ProjectLoader rejects traversal and duplicate normalized archive paths', () => {
    assert.throws(() => ArchiveEntryPath.normalize('../board.json'), { code: 'ERR_ARCHIVE_PATH' })
    assert.throws(() => ArchiveEntryPath.unique(['a/../b.json', 'b.json']), { code: 'ERR_ARCHIVE_DUPLICATE_ENTRY' })
})
```

- [ ] **Step 2: Run and verify missing loader modules**

Run: `npm test -- tests/project-loader-contract.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `ProjectLoader.mjs`.

- [ ] **Step 3: Implement the exact limits and deterministic loading**

```js
export class ArchiveLimits {
    static defaults = Object.freeze({
        maxEntries: 4096,
        maxEntryBytes: 536870912,
        maxTotalBytes: 2147483648,
        maxCompressionRatio: 1000,
        maxArchiveDepth: 1
    })

    static normalize(overrides = {}) {
        return ArchiveLimitsValidator.normalize(overrides, ArchiveLimits.defaults)
    }
}
```

Sort ambiguous candidate entries by normalized name, parse only `.json` candidates, retain project-level diagnostics instead of duplicating them onto documents, and throw when no document succeeds. `loadAsync()` must yield/check cancellation between classification and each entry parse rather than wrap `load()` in a promise. The core loader does not add a ZIP runtime dependency; source toolkit loaders plug archive expansion into the same entry contract.

- [ ] **Step 4: Run loader, parser, and package layout tests**

Run: `npm test -- tests/project-loader-contract.test.mjs tests/parser-contract.test.mjs tests/package-layout.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit project loading**

```bash
git add src/core/ProjectLoader.mjs src/core/ArchiveLimits.mjs src/core/ArchiveLimitsValidator.mjs src/core/ArchiveEntryPath.mjs src/project.mjs tests/project-loader-contract.test.mjs package.json
git commit -m "feature: add canonical project loading"
```

### Task 6: Consolidate standards-native query and connectivity behavior

**Files:**
- Create: `docs/provenance.md`
- Create: `tests/query-provenance.test.mjs`
- Create: `src/core/query/RegexPattern.mjs`
- Create: `src/core/query/ComponentGrouping.mjs`
- Create: `src/core/query/CircuitTraversal.mjs`
- Create: `src/core/query/QueryNetlistBuilder.mjs`
- Create: `src/core/query/QueryService.mjs`
- Create: `src/query.mjs`
- Create: `tests/query-service-contract.test.mjs`
- Modify: `NOTICE.md`

**Interfaces:**
- Consumes: prepared element/relation/connectivity indexes from `CircuitJsonDocumentContext`.
- Produces: `QueryService.create(document)`, `query`, `findComponents`, `findNets`, `traceConnectivity`, and `buildNetlist` with stable CircuitJSON ids.

- [ ] **Step 1: Write failing query result and reuse tests**

```js
test('QueryService reuses connectivity and returns stable ids', () => {
    const service = QueryService.create(createConnectedDocument())
    assert.deepEqual(service.findComponents({ pattern: '^U', match: 'regex' }).map((row) => row.id), ['source_u1'])
    assert.deepEqual(service.findNets({ pattern: 'GND', match: 'exact' }).map((row) => row.id), ['source_net_gnd'])
    assert.equal(service.traceConnectivity({ sourceComponentId: 'source_u1' }).length, 1)
    assert.equal(service.statistics.connectivityIndexBuilds, 1)
})
```

- [ ] **Step 2: Run and verify missing query service**

Run: `npm test -- tests/query-service-contract.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `QueryService.mjs`.

- [ ] **Step 3: Implement query matching without evaluating caller code**

```js
static create(document, options = {}) {
    return new QueryService(CircuitJsonDocumentContext.prepare(document, {
        ...options,
        indexes: ['elements', 'relations', 'connectivity']
    }))
}

findComponents(criteria = {}, options = {}) {
    return this.query({ select: 'components', where: criteria }, options).items
}
```

`RegexPattern` must compile only JavaScript `RegExp` source/flags supplied as data, reject invalid flags with `ERR_QUERY_PATTERN`, and never execute functions from criteria. Before adapting code, record each source repository path, commit, copyright, license, and whether logic or only behavior/tests were reused in `docs/provenance.md` and `NOTICE.md`; `tests/query-provenance.test.mjs` requires a record for every adapted module. Preserve ordered traversal and endpoint fields from the duplicated Altium/KiCad implementation while reading only CircuitJSON indexes.

- [ ] **Step 4: Run query and legacy index tests**

Run: `npm test -- tests/query-service-contract.test.mjs tests/query-provenance.test.mjs tests/circuit-json-indexer.test.mjs`

Expected: PASS and one connectivity build for repeated queries.

- [ ] **Step 5: Commit shared query behavior**

```bash
git add src/core/query src/query.mjs docs/provenance.md NOTICE.md tests/query-service-contract.test.mjs tests/query-provenance.test.mjs
git commit -m "feature: add shared CircuitJSON query service"
```

### Task 7: Add one reusable PCB render plan and canonical renderer facades

**Files:**
- Create: `src/core/rendering/PcbRenderPlan.mjs`
- Create: `src/ui/PcbSvgRenderer.mjs`
- Create: `src/ui/SchematicSvgRenderer.mjs`
- Create: `src/ui/BomTableRenderer.mjs`
- Create: `tests/canonical-renderers.test.mjs`
- Modify: `src/ui/CircuitJsonPcbSvgRenderer.mjs`
- Modify: `src/ui/CircuitJsonSchematicSvgRenderer.mjs`
- Modify: `src/renderers.mjs`

**Interfaces:**
- Consumes: `DocumentInput` and prepared primitives/layers from the context.
- Produces: canonical `render()` methods and `PcbSvgRenderer.renderLayers()` returning `ecad-toolkit.render-set.v1` without rebuilding primitives per layer.

- [ ] **Step 1: Write failing deterministic render-set tests**

```js
test('PcbSvgRenderer renders selected layers from one plan', () => {
    const context = CircuitJsonDocumentContext.prepare(createLayeredBoard())
    const result = PcbSvgRenderer.renderLayers(context, { side: 'top', layers: ['top_copper', 'top_silkscreen'] })
    assert.equal(result.schema, 'ecad-toolkit.render-set.v1')
    assert.deepEqual(result.items.map((item) => item.id), ['top_copper', 'top_silkscreen'])
    assert.equal(context.statistics.indexBuilds.pcbPrimitives, 1)
})
```

- [ ] **Step 2: Run and verify the missing canonical renderer**

Run: `npm test -- tests/canonical-renderers.test.mjs`

Expected: FAIL because `PcbSvgRenderer` is absent.

- [ ] **Step 3: Implement context-aware facades and render plans**

```js
static renderLayers(document, options = {}) {
    const plan = PcbRenderPlan.prepare(document, options)
    return {
        schema: 'ecad-toolkit.render-set.v1',
        items: plan.layers.map((layer) => ({ id: layer.id, side: plan.side, layerIds: [layer.id], svg: CircuitJsonPcbSvgRenderer.renderPlan(plan, { layerIds: [layer.id] }) })),
        diagnostics: plan.diagnostics,
        statistics: plan.statistics
    }
}
```

Keep the existing large PCB renderer below 1000 lines by moving plan preparation, layer filtering, and shared SVG document wrapping into `PcbRenderPlan.mjs`; the legacy class must delegate instead of duplicating logic.

- [ ] **Step 4: Run canonical and legacy renderer tests**

Run: `npm test -- tests/canonical-renderers.test.mjs tests/circuitjson-pcb-brep-zones.test.mjs tests/circuitjson-pcb-trace-segments.test.mjs`

Expected: PASS with byte-stable existing SVG assertions.

- [ ] **Step 5: Commit renderer convergence**

```bash
git add src/core/rendering src/ui/PcbSvgRenderer.mjs src/ui/SchematicSvgRenderer.mjs src/ui/BomTableRenderer.mjs src/ui/CircuitJsonPcbSvgRenderer.mjs src/ui/CircuitJsonSchematicSvgRenderer.mjs src/renderers.mjs tests/canonical-renderers.test.mjs
git commit -m "feature: add canonical prepared renderers"
```

### Task 8: Add reusable exact PCB interaction and spatial indexes

**Files:**
- Create: `src/core/context/PcbSpatialIndex.mjs`
- Create: `src/core/PcbInteractionIndex.mjs`
- Create: `src/interaction.mjs`
- Create: `tests/pcb-interaction-index-contract.test.mjs`
- Create: `tests/pcb-spatial-index-contract.test.mjs`
- Modify: `src/core/PcbInteractionPrimitiveModel.mjs`

**Interfaces:**
- Consumes: context primitive bounds and exact `PcbInteractionPrimitiveModel` predicates.
- Produces: `PcbInteractionIndex.create/hitTest/pick` plus `PcbSpatialIndex.create(records)`, `candidates(point, tolerance)`, and `search(bounds)` using stable record ids/bounds.

- [ ] **Step 1: Write failing index reuse and exactness tests**

```js
test('PcbInteractionIndex uses broad-phase candidates and exact narrow-phase hits', () => {
    const index = PcbInteractionIndex.create(createRichCircuitJsonDocument())
    assert.deepEqual(index.hitTest({ x: 2, y: 2 }).map((hit) => hit.elementId), ['pad_1', 'component_1'])
    assert.equal(index.pick({ x: 2, y: 2 }).elementId, 'pad_1')
    assert.equal(index.statistics.spatialIndexBuilds, 1)
    assert.equal(index.hitTest({ x: 200, y: 200 }).length, 0)
})

test('PcbSpatialIndex exposes source-toolkit broad-phase records', () => {
    const index = PcbSpatialIndex.create([{ id: 'a', bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 } }])
    assert.deepEqual(index.candidates({ x: 1, y: 1 }, 0).map((row) => row.id), ['a'])
})
```

- [ ] **Step 2: Run and verify the missing canonical index**

Run: `npm test -- tests/pcb-interaction-index-contract.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `PcbInteractionIndex.mjs`.

- [ ] **Step 3: Implement grid/R-tree broad phase with existing exact predicates**

```js
hitTest(point, options = {}) {
    return this.#spatial.candidates(point, options.tolerance).filter((item) =>
        PcbInteractionPrimitiveModel.contains(item.primitive, point, options)
    ).map(PcbInteractionIndex.#hitRecord).sort(PcbInteractionIndex.compareHits)
}
```

The spatial index may reduce candidates only; final geometry, visibility, layer, and ordering decisions remain in exact existing predicates. Build hidden-layer/object sets once per call, not once per candidate.

- [ ] **Step 4: Run all interaction suites**

Run: `npm test -- tests/pcb-interaction-index-contract.test.mjs tests/pcb-spatial-index-contract.test.mjs tests/pcb-interaction-primitive-model.test.mjs tests/pcb-interaction-rich-circuitjson.test.mjs`

Expected: PASS with unchanged hit order for legacy fixtures.

- [ ] **Step 5: Commit reusable interaction indexing**

```bash
git add src/core/context/PcbSpatialIndex.mjs src/core/PcbInteractionIndex.mjs src/core/PcbInteractionPrimitiveModel.mjs src/interaction.mjs tests/pcb-interaction-index-contract.test.mjs tests/pcb-spatial-index-contract.test.mjs
git commit -m "feature: add reusable PCB interaction indexes"
```

### Task 9: Converge manufacturing and simulation services

**Files:**
- Create: `src/core/ManufacturingService.mjs`
- Create: `src/core/SimulationService.mjs`
- Create: `src/manufacturing.mjs`
- Create: `src/simulation.mjs`
- Create: `tests/manufacturing-service-contract.test.mjs`
- Create: `tests/simulation-service-contract.test.mjs`
- Modify: `src/core/CircuitJsonManufacturingBuilder.mjs`
- Modify: `src/core/CircuitJsonManufacturingDownloadBuilder.mjs`
- Modify: `src/core/spice/SpiceSimulationService.mjs`

**Interfaces:**
- Consumes: context BOM/connectivity/manufacturing indexes and injected simulation engines.
- Produces: `ManufacturingService.inspect/listExports/export` and `SimulationService.build/export/run` with canonical result/error envelopes.

- [ ] **Step 1: Write failing service result tests**

```js
test('ManufacturingService advertises and exports available formats', () => {
    const exports = ManufacturingService.listExports(createAssemblyDocument())
    assert.deepEqual(exports.map((entry) => entry.id), ['fabrication-notes-json', 'pick-place-csv', 'routing-dsn'])
    const file = ManufacturingService.export(createAssemblyDocument(), { id: 'pick-place-csv', options: {} })
    assert.equal(file.mediaType, 'text/csv;charset=utf-8')
})

test('SimulationService requires an injected compatible engine', async () => {
    await assert.rejects(() => SimulationService.run([], { analysisId: 'tran', parameters: {} }), { code: 'ERR_CAPABILITY_UNAVAILABLE' })
})
```

- [ ] **Step 2: Run and verify missing canonical services**

Run: `npm test -- tests/manufacturing-service-contract.test.mjs tests/simulation-service-contract.test.mjs`

Expected: FAIL with missing service modules.

- [ ] **Step 3: Implement lazy context-backed service adapters**

```js
static export(document, request, options = {}) {
    const capability = ManufacturingService.listExports(document, options).find((entry) => entry.id === request.id)
    if (!capability || capability.status === 'unavailable') {
        throw new ToolkitError('Manufacturing export is unavailable.', { code: 'ERR_CAPABILITY_UNAVAILABLE', category: 'unsupported' })
    }
    const built = CircuitJsonManufacturingDownloadBuilder.build(ManufacturingService.inspect(document, options), request.id, request.options || {})
    return { fileName: built.fileName, mediaType: built.contentType, data: built.bytes, diagnostics: [] }
}
```

Remove the fallback simulation engine from canonical `run()` defaults; it remains available only when explicitly injected. Reuse the same prepared context for BOM, DSN, notes, and simulation model building.

- [ ] **Step 4: Run focused and legacy manufacturing/simulation tests**

Run: `npm test -- tests/manufacturing-service-contract.test.mjs tests/simulation-service-contract.test.mjs tests/circuit-json-manufacturing.test.mjs tests/circuitjson-manufacturing-download-builder.test.mjs tests/spice-simulation-service.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit manufacturing and simulation services**

```bash
git add src/core/ManufacturingService.mjs src/core/SimulationService.mjs src/core/CircuitJsonManufacturingBuilder.mjs src/core/CircuitJsonManufacturingDownloadBuilder.mjs src/core/spice/SpiceSimulationService.mjs src/manufacturing.mjs src/simulation.mjs tests/manufacturing-service-contract.test.mjs tests/simulation-service-contract.test.mjs
git commit -m "feature: converge manufacturing and simulation services"
```

### Task 10: Add data-only CircuitJSON 3D scene contracts

**Files:**
- Create: `src/core/scene3d/PcbScene3dBuilder.mjs`
- Create: `src/core/scene3d/PcbScene3dPreparator.mjs`
- Create: `src/core/scene3d/SceneAssetResolver.mjs`
- Create: `src/scene3d.mjs`
- Create: `tests/scene3d-contract.test.mjs`

**Interfaces:**
- Consumes: prepared board/components/pads/tracks/vias/zones/texts and `resolveAsset(request, { signal })`.
- Produces: `ecad-toolkit.scene3d.v1`, right-handed Z-up millimeter scenes with synchronous build and meaningful async preparation.

- [ ] **Step 1: Write failing scene shape and asset error tests**

```js
test('PcbScene3dBuilder returns the canonical data-only scene', () => {
    const scene = PcbScene3dBuilder.build(createAssemblyDocument())
    assert.equal(scene.schema, 'ecad-toolkit.scene3d.v1')
    assert.equal(scene.units, 'mm')
    assert.equal(scene.coordinateSystem, 'right-handed-z-up')
    assert.equal(Array.isArray(scene.components), true)
})

test('native asset preparation reports missing bytes', async () => {
    await assert.rejects(() => PcbScene3dPreparator.prepare(createAssetMetadataDocument(), { fidelity: 'native' }), { code: 'ERR_ASSET_DATA_REQUIRED' })
})
```

- [ ] **Step 2: Run and verify missing scene classes**

Run: `npm test -- tests/scene3d-contract.test.mjs`

Expected: FAIL with missing `PcbScene3dBuilder.mjs`.

- [ ] **Step 3: Implement data-only build and injected async resolution**

```js
static async prepare(document, options = {}) {
    const scene = PcbScene3dBuilder.build(document, options)
    const assets = await SceneAssetResolver.resolveAll(scene.assets, options)
    return { ...scene, assets }
}
```

No Three.js, DOM, implicit filesystem, implicit process, or implicit network import may appear in `src/core/scene3d/`. `auto` uses native data only when every prerequisite exists; explicit `native` throws on the first missing extension/asset id.

- [ ] **Step 4: Run scene and package-scope tests**

Run: `npm test -- tests/scene3d-contract.test.mjs tests/package-layout.test.mjs`

Expected: PASS and no `three` runtime dependency.

- [ ] **Step 5: Commit scene contracts**

```bash
git add src/core/scene3d src/scene3d.mjs tests/scene3d-contract.test.mjs
git commit -m "feature: add data-only CircuitJSON scene contracts"
```

### Task 11: Implement the versioned parser worker protocol

**Files:**
- Create: `src/core/worker/ToolkitWorkerProtocol.mjs`
- Create: `src/core/worker/ParserWorkerClient.mjs`
- Create: `src/workers/parser.worker.mjs`
- Create: `tests/worker-protocol-contract.test.mjs`
- Modify: `src/core/Parser.mjs`
- Modify: `src/core/ProjectLoader.mjs`

**Interfaces:**
- Consumes: direct parser/project methods and clone-safe errors/results.
- Produces: `ecad-toolkit.worker.v1` parse/loadProject/cancel/progress/result/error messages with opt-in caller input transfer.
- Produces: `ToolkitWorkerProtocol.install(scope, handlers)` and `ParserWorkerClient` from `circuitjson-toolkit/parser` for all source-toolkit workers.

- [ ] **Step 1: Write failing direct/worker equivalence tests**

```js
test('worker protocol normalizes result and never detaches input by default', async () => {
    const bytes = new TextEncoder().encode('[]')
    const direct = Parser.parse({ fileName: 'board.json', data: bytes })
    const worker = await Parser.parseAsync({ fileName: 'board.json', data: bytes }, { worker: true, transferInput: false })
    assert.deepEqual(worker, direct)
    assert.equal(bytes.byteLength, 2)
    assert.equal(CircuitJsonDocumentContext.prepare(direct).statistics.validationPasses, 0)
    assert.equal(CircuitJsonDocumentContext.prepare(worker).statistics.validationPasses, 1)
})
```

- [ ] **Step 2: Run and verify absent worker behavior**

Run: `npm test -- tests/worker-protocol-contract.test.mjs`

Expected: FAIL because `parseAsync({ worker: true })` has no worker client.

- [ ] **Step 3: Implement strict messages, cancellation, progress, and transfer ownership**

```js
export const WORKER_PROTOCOL = 'ecad-toolkit.worker.v1'

export function resultMessage(requestId, value) {
    return { protocol: WORKER_PROTOCOL, type: 'result', requestId: String(requestId), value }
}

export class ToolkitWorkerProtocol {
    static install(scope, handlers) {
        scope.addEventListener('message', (event) => ToolkitWorkerProtocol.dispatch(scope, handlers, event.data))
    }
}
```

Install async handlers through `Parser.parseAsync(input, { ...options, worker: false })` and `ProjectLoader.loadAsync(entries, { ...options, worker: false })`; dispatch must await them and pass a protocol-owned cancellation signal into their phase checkpoints. Every progress message carries one ordered common stage (`detect/decode/project/validate/complete`) plus optional source-specific `detail`. Copy typed-array views whose backing buffers include unrelated bytes. Translate caller `AbortSignal` to a `cancel` message, never post callbacks/signals, reject unknown message types with `ERR_WORKER_MESSAGE`, and serialize only `ToolkitError.toJSON()` fields. Because native `JSON.parse` cannot yield mid-call, `ParserWorkerClient` must terminate an owned worker immediately after sending cancel, reject with normalized `ERR_CANCELLED`, and lazily replace the worker for the next request; project/source handlers still observe cooperative cancellation between phases.

The public client contract is `new ParserWorkerClient({ createWorker })`, `parse(input, options)`, `loadProject(entries, options)`, `cancel(requestId)`, and `dispose()`; the worker test exercises each method, post-cancel reuse, progress ordering, and clone-safe errors.

- [ ] **Step 4: Run worker, parser, and project tests**

Run: `npm test -- tests/worker-protocol-contract.test.mjs tests/parser-contract.test.mjs tests/project-loader-contract.test.mjs`

Expected: PASS for direct/worker result and error equivalence.

- [ ] **Step 5: Commit worker protocol**

```bash
git add src/core/worker src/workers/parser.worker.mjs src/core/Parser.mjs src/core/ProjectLoader.mjs tests/worker-protocol-contract.test.mjs
git commit -m "feature: add versioned parser worker protocol"
```

### Task 12: Publish the conformance harness and canonical subpaths

**Files:**
- Create: `src/testing/ToolkitContractFixtures.mjs`
- Create: `src/testing/runToolkitContract.mjs`
- Create: `src/testing.mjs`
- Create: `src/capabilities.mjs`
- Create: `src/extensions.mjs`
- Create: `src/styles/renderers.css`
- Create: `tests/testing-entrypoint.test.mjs`
- Create: `tests/canonical-api-entrypoints.test.mjs`
- Modify: `src/index.mjs`
- Modify: `package.json`
- Modify: `tests/api-entrypoints.test.mjs`
- Modify: `tests/package-layout.test.mjs`

**Interfaces:**
- Consumes: every canonical class and contract from Tasks 2-11.
- Produces: all canonical package subpaths, `ToolkitContractFixtures.canonicalClassNames`, and `runToolkitContract(toolkit, options)` for packed downstream tests.

- [ ] **Step 1: Write failing subpath and harness tests**

```js
test('canonical subpaths expose identical class names', async () => {
    const testing = await import('../src/testing.mjs')
    const report = await testing.runToolkitContract(await import('../src/index.mjs'))
    assert.equal(report.failures.length, 0)
    assert.equal(typeof testing.ToolkitContractFixtures.circuitJsonDocument, 'function')
})
```

- [ ] **Step 2: Run and verify missing testing entrypoint**

Run: `npm test -- tests/testing-entrypoint.test.mjs tests/canonical-api-entrypoints.test.mjs`

Expected: FAIL with missing `src/testing.mjs` and package exports.

- [ ] **Step 3: Implement the harness and exact export map**

`package.json.exports` must contain `.`, `./parser`, `./project`, `./renderers`, `./interaction`, `./query`, `./manufacturing`, `./simulation`, `./scene3d`, `./capabilities`, `./extensions`, `./testing`, `./workers/parser.worker.mjs`, and `./styles/renderers.css`. Root exports must include every canonical class plus the three temporary viewer symbols, and must stop re-exporting other internals.

The owning common subpaths also publish the composition helpers required by source toolkits: `parser` exports `DocumentResult`, `ToolkitDiagnostic`, `ToolkitAsset`, `ToolkitProgress`, `ToolkitWorkerProtocol`, and `ParserWorkerClient`; `project` exports `ProjectResult`, `ArchiveLimits`, and `ArchiveEntryPath`; `interaction` exports `PcbSpatialIndex`; the context class exposes `getOrCreateDerived`. Add packed self-import assertions for every helper so source plans never depend on private paths.

`circuitjson-toolkit/parser` must additionally export `ToolkitWorkerProtocol` and `ParserWorkerClient` so source toolkits bind the same worker protocol instead of copying it.

```js
export async function runToolkitContract(toolkit) {
    const required = ToolkitContractFixtures.canonicalClassNames
    const failures = required.filter((name) => typeof toolkit[name] !== 'function').map((name) => ({ code: 'ERR_CONTRACT_EXPORT', name }))
    return { schema: 'ecad-toolkit.contract-report.v1', failures }
}
```

After export checks, the harness must execute the synthetic parser/project success and failure paths, side/fidelity renderer calls, unavailable-operation errors, context reuse, worker message normalization, and required result schemas so class-name parity alone cannot pass.

- [ ] **Step 4: Run API, package, and harness tests**

Run: `npm test -- tests/testing-entrypoint.test.mjs tests/canonical-api-entrypoints.test.mjs tests/api-entrypoints.test.mjs tests/package-layout.test.mjs`

Expected: PASS with the exact canonical export list.

- [ ] **Step 5: Commit the public package layout**

```bash
git add src/testing src/testing.mjs src/capabilities.mjs src/extensions.mjs src/styles src/index.mjs package.json tests/testing-entrypoint.test.mjs tests/canonical-api-entrypoints.test.mjs tests/api-entrypoints.test.mjs tests/package-layout.test.mjs
git commit -m "feature: publish canonical toolkit entrypoints"
```

### Task 13: Meet performance gates, document migration, and prepare 1.1.0

**Files:**
- Create: `docs/capabilities.md`
- Create: `docs/migration.md`
- Create: `benchmarks/results-v1.1.0.json`
- Create: `scripts/check-packed-entrypoints.mjs`
- Create: `scripts/check-browser-dependency-graph.mjs`
- Create: `tests/release-readiness.test.mjs`
- Create outside repositories: `../release-candidates/circuitjson-toolkit-1.1.0.tgz`
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
- Consumes: the complete core implementation and immutable baseline reports.
- Produces: checked migration/capability documentation, version `1.1.0`, passing performance report, and a verified npm tarball candidate.

- [ ] **Step 1: Add failing release-readiness checks**

```js
test('release metadata and migration ledger agree', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    const ledger = JSON.parse(await readFile('spec/feature-preservation.json', 'utf8'))
    const migration = await readFile('docs/migration.md', 'utf8')
    assert.equal(pkg.version, '1.1.0')
    assert.equal(ledger.every((row) => migration.includes(row.feature)), true)
})
```

Add this test to `tests/release-readiness.test.mjs`.

- [ ] **Step 2: Run readiness and benchmark comparison before optimization**

Run: `npm test -- tests/release-readiness.test.mjs && npm run benchmark -- --compare benchmarks/baseline-v1.0.17.json`

Expected: readiness FAILS on version `1.0.17`; benchmark comparison identifies any remaining gate failures by case id.

- [ ] **Step 3: Remove measured repeated work and complete documentation/version metadata**

Use benchmark evidence to remove only measured duplicate validation, index creation, render-plan construction, and clone payload fields. Set both package files to `1.1.0`. Generate `docs/migration.md` from the complete ledger, including every old export/method/option/result field/hybrid property/side alias. Add a prominent `Breaking API convergence` section and exact old/new examples to README and release notes source text.

`check-browser-dependency-graph.mjs` walks production dependencies from every browser export/worker in a packed-install fixture and fails if `circuit-json` or any development-only edge is reachable.

- [ ] **Step 4: Run the full candidate gate**

Run: `mkdir -p ../release-candidates && npm ci && npm test && npm run check:format && npm run check:features -- --strict && npm run benchmark -- --compare benchmarks/baseline-v1.0.17.json --output benchmarks/results-v1.1.0.json && npm pack --dry-run && npm pack --pack-destination ../release-candidates && node scripts/check-packed-entrypoints.mjs && node scripts/check-browser-dependency-graph.mjs && git diff --check`

Expected: all commands exit 0; primary medians improve at least 20 percent, regression/clone gates pass, and the retained core tarball includes all documented subpaths/notices while excluding `circuit-json` runtime code.

- [ ] **Step 5: Commit the verified core candidate**

```bash
git add src tests README.md docs spec NOTICE.md benchmarks/results-v1.1.0.json scripts/check-packed-entrypoints.mjs scripts/check-browser-dependency-graph.mjs package.json package-lock.json
git commit -m "release: prepare circuitjson-toolkit 1.1.0"
```
