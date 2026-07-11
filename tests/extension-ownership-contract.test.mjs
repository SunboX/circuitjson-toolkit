import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'

import { DocumentResult } from '../src/core/contracts/DocumentResult.mjs'
import { WorkerRequestData } from '../src/core/worker/WorkerRequestData.mjs'
import { WorkerResponseData } from '../src/core/worker/WorkerResponseData.mjs'

const LARGE_NATIVE_PAD_COUNT = 15_001
const MAX_DIRECT_CAPTURE_MS = 2_000
const LARGE_BINARY_BYTES = 3 * 1024 * 1024
const MAX_BINARY_CAPTURE_MS = 2_000
const MAX_BINARY_HEAP_GROWTH = 24 * 1024 * 1024
const OVERSIZED_EXTENSION_BYTES = 128 * 1024 * 1024 + 1

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
