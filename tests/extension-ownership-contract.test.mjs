import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'

import { DocumentResult } from '../src/core/contracts/DocumentResult.mjs'
import { ProjectResult } from '../src/core/contracts/ProjectResult.mjs'
import { WorkerRequestData } from '../src/core/worker/WorkerRequestData.mjs'
import { WorkerResponseData } from '../src/core/worker/WorkerResponseData.mjs'

const LARGE_NATIVE_PAD_COUNT = 15_001
const MAX_DIRECT_CAPTURE_MS = 2_000
const LARGE_BINARY_BYTES = 3 * 1024 * 1024
const MAX_BINARY_CAPTURE_MS = 2_000
const MAX_BINARY_HEAP_GROWTH = 24 * 1024 * 1024
const OVERSIZED_EXTENSION_BYTES = 128 * 1024 * 1024 + 1
const MULTI_DOCUMENT_COUNT = 12
const MULTI_DOCUMENT_VALUE_COUNT = 180_000
const LARGE_PROJECT_DOCUMENT_VALUE_COUNT = 2_100_000
const LARGE_EXTENSION_VALUE_COUNT = 3_300_000
const OVERSIZED_EXTENSION_VALUE_COUNT = 4_000_000
const OVERSIZED_PROJECT_DOCUMENT_VALUE_COUNT = 5_000_000
const FORGED_RESULT_VALUE_COUNT = 2_100_000
const SHARED_DOCUMENT_VALUE_COUNT = 1_670_000
const NEAR_PROJECT_METADATA_VALUE_COUNT = 1_999_945
const PROJECT_TEXT_DOCUMENT_COUNT = 13
const PROJECT_SHARED_TEXT_LENGTH = 10_000_000

/**
 * Builds a realistic large source-owned native extension graph.
 * @param {number} padCount Native pad count.
 * @returns {Record<string, any>} Native renderer model.
 */
function createNativeModel(padCount) {
    return {
        sourceFormat: 'altium',
        kind: 'pcb',
        fileType: 'pcbdoc',
        summary: { title: 'Large neutral board' },
        diagnostics: [],
        pcb: {
            pads: Array.from({ length: padCount }, (_, index) => ({
                x: index,
                y: index + 1,
                sizeTopX: 20,
                sizeTopY: 10,
                rotation: index % 360,
                layer: 'Top Layer',
                ownerIndex: index,
                designator: String(index + 1)
            }))
        }
    }
}

/**
 * Builds one validated document with an explicit source-native extension.
 * @param {Record<string, any>} native Native renderer model.
 * @returns {Record<string, any>} Canonical document.
 */
function createDocument(native) {
    return DocumentResult.createValidated({
        source: {
            format: 'altium',
            fileName: 'large-neutral.PcbDoc',
            fileType: 'pcbdoc'
        },
        model: [],
        extensions: {
            altium: {
                $meta: {
                    schema: 'ecad-toolkit.extension.v1',
                    completeness: 'canonical',
                    included: ['altium.native-model'],
                    omitted: []
                },
                native
            }
        }
    })
}

/**
 * Builds two dense value buckets while keeping descriptor snapshots compact.
 * @param {number} valueCount Total scalar value count.
 * @param {number} value Repeated scalar value.
 * @returns {number[][]} Dense value buckets.
 */
function createValueBuckets(valueCount, value) {
    const firstCount = Math.floor(valueCount / 2)
    return [
        new Array(firstCount).fill(value),
        new Array(valueCount - firstCount).fill(value)
    ]
}

/**
 * Counts values across dense test buckets.
 * @param {unknown} value Bucket candidate.
 * @returns {number} Total scalar value count.
 */
function bucketValueCount(value) {
    return Array.isArray(value)
        ? value.reduce(
              (total, bucket) =>
                  total + (Array.isArray(bucket) ? bucket.length : 0),
              0
          )
        : 0
}

/**
 * Builds a source-neutral project whose documents are each individually bounded.
 * @returns {Record<string, any>} Canonical multi-document project.
 */
function createMultiDocumentProject() {
    const documents = Array.from({ length: MULTI_DOCUMENT_COUNT }, (_, index) =>
        DocumentResult.createValidated({
            source: {
                format: 'neutral',
                fileName: `document-${index}.data`,
                fileType: 'data'
            },
            model: [],
            extensions: {
                neutral: {
                    values: createValueBuckets(
                        index === 0
                            ? LARGE_PROJECT_DOCUMENT_VALUE_COUNT
                            : MULTI_DOCUMENT_VALUE_COUNT,
                        index
                    )
                }
            }
        })
    )
    return ProjectResult.create({ documents })
}

/**
 * Builds an otherwise canonical project with one over-budget document graph.
 * @returns {Record<string, any>} Untrusted project candidate.
 */
function createOversizedDocumentProject() {
    return ProjectResult.create({
        documents: [
            {
                schema: 'ecad-toolkit.document.v1',
                id: 'document-oversized',
                modelSchema: {
                    name: 'circuit-json',
                    version: '0.0.446'
                },
                model: [],
                source: {
                    format: 'neutral',
                    fileName: 'document-oversized.data',
                    fileType: 'data'
                },
                extensions: {
                    neutral: {
                        values: createValueBuckets(
                            OVERSIZED_PROJECT_DOCUMENT_VALUE_COUNT,
                            0
                        )
                    }
                },
                assets: [],
                diagnostics: [],
                statistics: {}
            }
        ]
    })
}

/**
 * Builds one validated source-neutral document with a large extension array.
 * @param {number} valueCount Extension array length.
 * @returns {Record<string, any>} Canonical document.
 */
function createNeutralExtensionDocument(valueCount) {
    return DocumentResult.createValidated({
        source: {
            format: 'neutral',
            fileName: 'large-extension.data',
            fileType: 'data'
        },
        model: [],
        extensions: {
            neutral: { values: createValueBuckets(valueCount, 0) }
        }
    })
}

/**
 * Builds one plain document-shaped worker result candidate.
 * @param {string} id Document id.
 * @param {Record<string, any>} extension Extension namespace.
 * @returns {Record<string, any>} Document result candidate.
 */
function createWorkerDocument(id, extension) {
    return {
        schema: 'ecad-toolkit.document.v1',
        id,
        modelSchema: {
            name: 'circuit-json',
            version: '0.0.446'
        },
        model: [],
        source: {
            format: 'neutral',
            fileName: `${id}.data`,
            fileType: 'data'
        },
        extensions: { neutral: extension },
        assets: [],
        diagnostics: [],
        statistics: {}
    }
}

/**
 * Builds an exact project envelope with configurable field insertion order.
 * @param {Record<string, any>} document Project document.
 * @param {unknown} shared Shared project metadata value.
 * @param {boolean} extensionsFirst Whether extensions precede documents.
 * @param {Record<string, any>[]} [documents] Exact documents collection.
 * @returns {Record<string, any>} Canonical project candidate.
 */
function createOrderedWorkerProject(
    document,
    shared,
    extensionsFirst,
    documents = [document]
) {
    const identity = {
        schema: 'ecad-toolkit.project.v1',
        id: 'project-order-boundary',
        source: {
            format: 'neutral',
            entryNames: [document.source.fileName]
        }
    }
    const collections = extensionsFirst
        ? {
              extensions: { neutral: { shared } },
              documents
          }
        : {
              documents,
              extensions: { neutral: { shared } }
          }
    return {
        ...identity,
        ...collections,
        project: null,
        assets: [],
        diagnostics: [],
        statistics: {}
    }
}

/**
 * Builds an exact project whose metadata aliases its documents array.
 * @param {Record<string, any>} document Project document.
 * @param {boolean} extensionsFirst Whether extensions precede documents.
 * @returns {Record<string, any>} Canonical project candidate.
 */
function createDocumentsAliasProject(document, extensionsFirst) {
    const documents = [document]
    return createOrderedWorkerProject(
        document,
        documents,
        extensionsFirst,
        documents
    )
}

test('validated owned documents seal toolkit-built native graphs without copying them', () => {
    const native = createNativeModel(4)

    const document = DocumentResult.createValidatedOwned({
        source: {
            format: 'altium',
            fileName: 'owned-neutral.PcbDoc',
            fileType: 'pcbdoc'
        },
        model: [],
        extensions: {
            altium: {
                $meta: {
                    schema: 'ecad-toolkit.extension.v1',
                    completeness: 'canonical',
                    included: ['altium.native-model'],
                    omitted: []
                },
                native
            }
        }
    })

    assert.strictEqual(document.extensions.altium.native, native)
    assert.equal(Object.isFrozen(native.pcb.pads[0]), true)
})

test('validated documents own realistic large native extensions in one bounded pass', () => {
    const native = createNativeModel(LARGE_NATIVE_PAD_COUNT)
    const started = performance.now()
    const document = createDocument(native)
    const elapsed = performance.now() - started

    assert.equal(
        document.extensions.altium.native.pcb.pads.length,
        LARGE_NATIVE_PAD_COUNT
    )
    assert.notEqual(document.extensions.altium.native, native)
    assert.equal(Object.isFrozen(document.extensions), true)
    assert.equal(Object.isFrozen(document.extensions.altium.native), true)
    assert.equal(elapsed < MAX_DIRECT_CAPTURE_MS, true, `${elapsed}ms`)

    native.pcb.pads[0].x = -1
    assert.equal(document.extensions.altium.native.pcb.pads[0].x, 0)
})

test('large native extensions survive the exact worker result round trip', () => {
    const document = createDocument(createNativeModel(LARGE_NATIVE_PAD_COUNT))
    const prepared = WorkerRequestData.prepareResult(document)
    const posted = structuredClone(prepared.value, {
        transfer: prepared.transfer
    })
    const received = WorkerResponseData.result('parse', posted)

    assert.equal(
        received.extensions.altium.native.pcb.pads.length,
        LARGE_NATIVE_PAD_COUNT
    )
    assert.equal(Object.isFrozen(received), true)
    assert.equal(Object.isFrozen(received.extensions.altium.native), true)
})

test('bounded source extensions survive a standalone document worker round trip', () => {
    const document = createNeutralExtensionDocument(LARGE_EXTENSION_VALUE_COUNT)
    const prepared = WorkerRequestData.prepareResult(document)
    const posted = structuredClone(prepared.value, {
        transfer: prepared.transfer
    })
    const received = WorkerResponseData.result('parse', posted)

    assert.equal(
        bucketValueCount(received.extensions.neutral.values),
        LARGE_EXTENSION_VALUE_COUNT
    )
})

test('individually bounded documents survive a multi-document worker result round trip', () => {
    const project = createMultiDocumentProject()
    const prepared = WorkerRequestData.prepareResult(project)
    const posted = structuredClone(prepared.value, {
        transfer: prepared.transfer
    })
    const received = WorkerResponseData.result('loadProject', posted)

    assert.equal(received.documents.length, MULTI_DOCUMENT_COUNT)
    assert.equal(
        bucketValueCount(received.documents.at(-1).extensions.neutral.values),
        MULTI_DOCUMENT_VALUE_COUNT
    )
})

test('project worker results retain the per-document value ceiling', () => {
    const project = createOversizedDocumentProject()

    assert.throws(() => WorkerRequestData.prepareResult(project), {
        name: 'TypeError',
        message: 'Worker request data is too large.'
    })
    assert.throws(() => WorkerRequestData.prepareResponse(project), {
        name: 'TypeError',
        message: 'Worker request data is too large.'
    })
})

test('schema strings do not elevate structurally invalid result candidates', () => {
    for (const schema of [
        'ecad-toolkit.document.v1',
        'ecad-toolkit.project.v1'
    ]) {
        const candidate = {
            schema,
            junk: createValueBuckets(FORGED_RESULT_VALUE_COUNT, 0)
        }
        assert.throws(() => WorkerRequestData.prepareResult(candidate), {
            name: 'TypeError',
            message: 'Worker request data is too large.'
        })
        assert.throws(() => WorkerRequestData.prepareResponse(candidate), {
            name: 'TypeError',
            message: 'Worker request data is too large.'
        })
    }

    const forgedDocument = {
        schema: 'ecad-toolkit.document.v1',
        junk: createValueBuckets(FORGED_RESULT_VALUE_COUNT, 0)
    }
    const project = ProjectResult.create({ documents: [forgedDocument] })
    assert.throws(() => WorkerRequestData.prepareResult(project), {
        name: 'TypeError',
        message: 'Worker request data is too large.'
    })
    assert.throws(() => WorkerRequestData.prepareResponse(project), {
        name: 'TypeError',
        message: 'Worker request data is too large.'
    })
})

test('project documents account reused graphs within each document boundary', () => {
    const shared = Array.from({ length: 3 }, (_, index) =>
        createValueBuckets(SHARED_DOCUMENT_VALUE_COUNT, index)
    )
    const documents = shared.map((values, index) =>
        createWorkerDocument(`owner-${index}`, { values })
    )
    documents.push(
        createWorkerDocument('alias-owner', {
            first: shared[0],
            second: shared[1],
            third: shared[2]
        })
    )
    const project = ProjectResult.create({ documents })

    assert.throws(() => WorkerRequestData.prepareResult(project), {
        name: 'TypeError',
        message: 'Worker request data is too large.'
    })
    assert.throws(() => WorkerRequestData.prepareResponse(project), {
        name: 'TypeError',
        message: 'Worker request data is too large.'
    })
})

test('project metadata accounts document aliases independently of field order', () => {
    const smallShared = createValueBuckets(100, 1)
    const smallDocument = createWorkerDocument('small-owner', {
        values: smallShared
    })
    for (const extensionsFirst of [false, true]) {
        const project = createOrderedWorkerProject(
            smallDocument,
            smallShared,
            extensionsFirst
        )
        const prepared = WorkerRequestData.prepareResult(project).value
        const received = WorkerRequestData.prepareResponse(project)
        assert.equal(
            prepared.documents[0].extensions.neutral.values,
            prepared.extensions.neutral.shared
        )
        assert.equal(
            received.documents[0].extensions.neutral.values,
            received.extensions.neutral.shared
        )
    }

    const oversizedShared = createValueBuckets(FORGED_RESULT_VALUE_COUNT, 2)
    const oversizedDocument = createWorkerDocument('large-owner', {
        values: oversizedShared
    })
    for (const extensionsFirst of [false, true]) {
        const project = createOrderedWorkerProject(
            oversizedDocument,
            oversizedShared,
            extensionsFirst
        )
        assert.throws(() => WorkerRequestData.prepareResult(project), {
            name: 'TypeError',
            message: 'Worker request data is too large.'
        })
        assert.throws(() => WorkerRequestData.prepareResponse(project), {
            name: 'TypeError',
            message: 'Worker request data is too large.'
        })
    }
})

test('project re-account visits remain bounded across many shared documents', () => {
    const smallShared = createValueBuckets(100, 3)
    const smallProject = ProjectResult.create({
        documents: Array.from({ length: 6 }, (_, index) =>
            createWorkerDocument(`small-shared-${index}`, {
                values: smallShared
            })
        )
    })
    assert.equal(
        WorkerRequestData.prepareResult(smallProject).value.documents.length,
        6
    )
    assert.equal(
        WorkerRequestData.prepareResponse(smallProject).documents.length,
        6
    )

    const oversizedShared = createValueBuckets(SHARED_DOCUMENT_VALUE_COUNT, 4)
    const oversizedProject = ProjectResult.create({
        documents: Array.from({ length: 6 }, (_, index) =>
            createWorkerDocument(`large-shared-${index}`, {
                values: oversizedShared
            })
        )
    })
    assert.throws(() => WorkerRequestData.prepareResult(oversizedProject), {
        name: 'TypeError',
        message: 'Worker request data is too large.'
    })
    assert.throws(() => WorkerRequestData.prepareResponse(oversizedProject), {
        name: 'TypeError',
        message: 'Worker request data is too large.'
    })
})

test('project metadata charges documents-array aliases in either field order', () => {
    const smallDocument = createWorkerDocument('small-array-owner', {
        values: createValueBuckets(100, 5)
    })
    for (const extensionsFirst of [false, true]) {
        const project = createDocumentsAliasProject(
            smallDocument,
            extensionsFirst
        )
        const prepared = WorkerRequestData.prepareResult(project).value
        const received = WorkerRequestData.prepareResponse(project)
        assert.equal(prepared.documents, prepared.extensions.neutral.shared)
        assert.equal(received.documents, received.extensions.neutral.shared)
    }

    const oversizedDocument = createWorkerDocument('large-array-owner', {
        values: createValueBuckets(FORGED_RESULT_VALUE_COUNT, 6)
    })
    for (const extensionsFirst of [false, true]) {
        const project = createDocumentsAliasProject(
            oversizedDocument,
            extensionsFirst
        )
        assert.throws(() => WorkerRequestData.prepareResult(project), {
            name: 'TypeError',
            message: 'Worker request data is too large.'
        })
        assert.throws(() => WorkerRequestData.prepareResponse(project), {
            name: 'TypeError',
            message: 'Worker request data is too large.'
        })
    }
})

test('documents-array metadata aliases retain order-independent near-limit accounting', () => {
    const document = createWorkerDocument('boundary-array-owner', { value: 1 })
    for (const extensionsFirst of [false, true]) {
        const project = createDocumentsAliasProject(document, extensionsFirst)
        project.extensions.neutral.filler = createValueBuckets(
            NEAR_PROJECT_METADATA_VALUE_COUNT,
            7
        )
        const prepared = WorkerRequestData.prepareResult(project).value
        const received = WorkerRequestData.prepareResponse(project)
        assert.equal(prepared.documents, prepared.extensions.neutral.shared)
        assert.equal(received.documents, received.extensions.neutral.shared)
    }
    for (const extensionsFirst of [false, true]) {
        const project = createDocumentsAliasProject(document, extensionsFirst)
        project.extensions.neutral.filler = createValueBuckets(
            NEAR_PROJECT_METADATA_VALUE_COUNT + 1,
            8
        )
        assert.throws(() => WorkerRequestData.prepareResult(project), {
            name: 'TypeError',
            message: 'Worker request data is too large.'
        })
        assert.throws(() => WorkerRequestData.prepareResponse(project), {
            name: 'TypeError',
            message: 'Worker request data is too large.'
        })
    }
})

test('project results use a bounded byte ceiling above standalone results', () => {
    const text = 'x'.repeat(PROJECT_SHARED_TEXT_LENGTH)
    const documents = Array.from(
        { length: PROJECT_TEXT_DOCUMENT_COUNT },
        (_, index) => createWorkerDocument(`text-${index}`, { text })
    )
    const project = ProjectResult.create({ documents })

    const prepared = WorkerRequestData.prepareResult(project)
    const received = WorkerRequestData.prepareResponse(prepared.value)
    assert.equal(received.documents.length, PROJECT_TEXT_DOCUMENT_COUNT)

    const standalone = createWorkerDocument('standalone-text', {
        values: new Array(PROJECT_TEXT_DOCUMENT_COUNT).fill(text)
    })
    assert.throws(() => WorkerRequestData.prepareResult(standalone), {
        name: 'TypeError',
        message: 'Worker request data exceeds its byte limit.'
    })
    assert.throws(() => WorkerRequestData.prepareResponse(standalone), {
        name: 'TypeError',
        message: 'Worker request data exceeds its byte limit.'
    })

    const oversizedProject = ProjectResult.create({
        documents: [standalone]
    })
    assert.throws(() => WorkerRequestData.prepareResult(oversizedProject), {
        name: 'TypeError',
        message: 'Worker request data exceeds its byte limit.'
    })
    assert.throws(() => WorkerRequestData.prepareResponse(oversizedProject), {
        name: 'TypeError',
        message: 'Worker request data exceeds its byte limit.'
    })
})

test('extension ownership retains its bounded item ceiling', () => {
    assert.throws(
        () => createNeutralExtensionDocument(OVERSIZED_EXTENSION_VALUE_COUNT),
        /Canonical extension data is too large/u
    )
})

test('bounded extension binaries use the byte ceiling instead of graph items', () => {
    const payload = new Uint8Array(LARGE_BINARY_BYTES)
    payload[0] = 17
    const heapBefore = process.memoryUsage().heapUsed
    const started = performance.now()
    const document = createDocument({
        sourceFormat: 'altium',
        kind: 'pcb',
        payload
    })
    const elapsed = performance.now() - started
    const heapGrowth = Math.max(0, process.memoryUsage().heapUsed - heapBefore)
    const captured = document.extensions.altium.native.payload

    assert.equal(captured instanceof Uint8Array, true)
    assert.equal(captured.byteLength, payload.byteLength)
    assert.notEqual(captured.buffer, payload.buffer)
    payload[0] = 99
    assert.equal(captured[0], 17)
    captured[0] = 71
    assert.equal(document.extensions.altium.native.payload[0], 17)
    assert.equal(elapsed < MAX_BINARY_CAPTURE_MS, true, `${elapsed}ms`)
    assert.equal(
        heapGrowth < MAX_BINARY_HEAP_GROWTH,
        true,
        `${heapGrowth} heap bytes`
    )
})

test('large byte-backed extensions survive the exact worker result round trip', () => {
    const payload = new Uint8Array(LARGE_BINARY_BYTES)
    payload[0] = 23
    const document = createDocument({
        sourceFormat: 'altium',
        kind: 'pcb',
        payload
    })
    const heapBefore = process.memoryUsage().heapUsed
    const started = performance.now()
    const prepared = WorkerRequestData.prepareResult(document)
    const posted = structuredClone(prepared.value, {
        transfer: prepared.transfer
    })
    const received = WorkerResponseData.result('parse', posted)
    const elapsed = performance.now() - started
    const heapGrowth = Math.max(0, process.memoryUsage().heapUsed - heapBefore)
    const captured = received.extensions.altium.native.payload

    assert.equal(captured instanceof Uint8Array, true)
    assert.equal(captured.byteLength, LARGE_BINARY_BYTES)
    assert.equal(captured[0], 23)
    captured[0] = 91
    assert.equal(received.extensions.altium.native.payload[0], 23)
    assert.equal(elapsed < MAX_BINARY_CAPTURE_MS, true, `${elapsed}ms`)
    assert.equal(
        heapGrowth < MAX_BINARY_HEAP_GROWTH,
        true,
        `${heapGrowth} heap bytes`
    )
})

test('extension ownership rejects payloads beyond its separate byte ceiling', () => {
    const native = {
        sourceFormat: 'altium',
        kind: 'pcb',
        payload: 'x'.repeat(OVERSIZED_EXTENSION_BYTES)
    }

    assert.throws(
        () => createDocument(native),
        /Canonical extension data is too large/u
    )
})
