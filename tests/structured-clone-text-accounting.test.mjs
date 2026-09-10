import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { StructuredCloneTextAccounting } from '../src/core/context/StructuredCloneTextAccounting.mjs'

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url))

/**
 * Accounts text using the same bounded-byte operation as the adoption traversal.
 * @param {string} value Text to account.
 * @param {number} [maxBytes] Maximum accounted bytes.
 * @returns {{ bytes: number, checkpoints: number }} Accounting results.
 */
function account(value, maxBytes = 10_000_000) {
    const state = { bytes: 0, label: 'Fake metadata', maxBytes }
    let checkpoints = 0
    const operations = {
        *checkpoint() {
            checkpoints += 1
            yield
        },
        reserve(count) {
            if (state.bytes + count > state.maxBytes) {
                throw new TypeError(`${state.label} is too large.`)
            }
            state.bytes += count
        }
    }
    for (const _step of StructuredCloneTextAccounting.reserve(
        value,
        state,
        operations
    )) {
        // Exhaust the synchronous accounting generator.
    }
    return { bytes: state.bytes, checkpoints }
}

test('short structured-clone text accounting does not allocate encoded buffers', () => {
    const probe = `
        let allocations = 0
        const encode = TextEncoder.prototype.encode
        TextEncoder.prototype.encode = function (...args) {
            allocations += 1
            return Reflect.apply(encode, this, args)
        }
        const { StructuredCloneTextAccounting } = await import('./src/core/context/StructuredCloneTextAccounting.mjs')
        const state = { bytes: 0, label: 'Fake metadata', maxBytes: 10000 }
        const operations = { *checkpoint() {}, reserve(count) { state.bytes += count } }
        for (const value of ['top', 'fake-record', '1234', 'é', '😀']) {
            for (const step of StructuredCloneTextAccounting.reserve(value, state, operations)) {}
        }
        process.stdout.write(JSON.stringify({ allocations, bytes: state.bytes }))
    `
    const result = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', probe],
        {
            cwd: PROJECT_ROOT,
            encoding: 'utf8',
            timeout: 10_000
        }
    )
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), { allocations: 0, bytes: 24 })
})

test('structured-clone text accounts UTF-8 bytes and malformed surrogate replacements exactly', () => {
    for (const value of [
        '',
        'ascii',
        '\u007f\u0080\u07ff\u0800\uffff',
        '😀',
        '\ud800',
        '\udc00',
        '\ud800x\udc00',
        '\ud800\ud800\udc00',
        `${'x'.repeat(64 * 1024 - 1)}😀`,
        'é😀'.repeat(30_000)
    ]) {
        const expected = new TextEncoder().encode(value).byteLength
        assert.equal(account(value, expected).bytes, expected)
        if (expected > 0) {
            assert.throws(() => account(value, expected - 1), /too large/u)
        }
    }
})

test('structured-clone text retains checkpoints for long values', () => {
    const result = account('x'.repeat(4 * 1024 * 1024))
    assert.equal(result.bytes, 4 * 1024 * 1024)
    assert.ok(result.checkpoints > 2)
})

test(
    'structured-clone repeated short text benchmark retains all byte charges',
    {
        skip: process.env.WORKER_DATA_BENCHMARK !== '1'
    },
    (context) => {
        const values = ['top', 'fake-record', '1234', 'é', '😀']
        const expected = values.reduce(
            (total, value) =>
                total + new TextEncoder().encode(value).byteLength,
            0
        )
        const durations = []
        for (let run = 0; run < 6; run += 1) {
            const state = {
                bytes: 0,
                label: 'Fake metadata',
                maxBytes: 100_000_000
            }
            const operations = {
                *checkpoint() {},
                reserve(count) {
                    state.bytes += count
                }
            }
            const start = performance.now()
            for (let index = 0; index < 400_000; index += 1) {
                for (const _step of StructuredCloneTextAccounting.reserve(
                    values[index % values.length],
                    state,
                    operations
                )) {
                }
            }
            const duration = performance.now() - start
            assert.equal(state.bytes, expected * 80_000)
            if (run > 0) durations.push(duration)
        }
        durations.sort((a, b) => a - b)
        context.diagnostic(
            JSON.stringify({ shortTextMedianMs: durations[2], durations })
        )
    }
)
