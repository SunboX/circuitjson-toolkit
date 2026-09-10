import assert from 'node:assert/strict'
import test from 'node:test'
import { SelfAdjustingComputation } from '../src/core/SelfAdjustingComputation.mjs'

test('keeps aliased containers distinct by their observed input paths', () => {
    const runtime = new SelfAdjustingComputation()
    const shared = { value: 2 }
    const compute = (state) => {
        assert.equal(state.left, state.left)
        assert.notEqual(state.left, state.right)
        return state.left.value + state.right.value
    }

    assert.deepEqual(
        runtime.evaluate('sum', { left: shared, right: shared }, compute),
        { value: 4, recomputed: true }
    )
    assert.deepEqual(
        runtime.evaluate('sum', { left: shared, right: { value: 5 } }, compute),
        { value: 7, recomputed: true }
    )
    assert.deepEqual(runtime.getStatistics(), {
        computations: 1,
        dependencies: 4,
        readerEdges: 2
    })
})

test('distinguishes symbols with the same description and delimiter-like keys', () => {
    const runtime = new SelfAdjustingComputation()
    const first = Symbol('field')
    const second = Symbol('field')
    const input = {
        [first]: { value: 1 },
        [second]: { value: 2 },
        'a|s1:b': 3,
        a: { b: 4 }
    }
    const compute = (state) =>
        state[first].value + state[second].value + state['a|s1:b'] + state.a.b

    assert.equal(runtime.evaluate('sum', input, compute).value, 10)
    input[first].value = 9
    assert.deepEqual(runtime.evaluate('sum', input, compute), {
        value: 18,
        recomputed: true
    })
    input[second].value = 7
    assert.deepEqual(runtime.evaluate('sum', input, compute), {
        value: 23,
        recomputed: true
    })
})

test('preserves independent value, presence, key and descriptor observations', () => {
    const runtime = new SelfAdjustingComputation()
    const input = { record: { value: 2 } }
    const compute = (state) => [
        state.record.value,
        'value' in state.record,
        Reflect.ownKeys(state.record),
        Object.getOwnPropertyDescriptor(state.record, 'value')?.enumerable
    ]

    assert.deepEqual(runtime.evaluate('record', input, compute).value, [
        2,
        true,
        ['value'],
        true
    ])
    assert.equal(runtime.evaluate('record', input, compute).recomputed, false)
    Object.defineProperty(input.record, 'value', { enumerable: false })
    assert.deepEqual(runtime.evaluate('record', input, compute), {
        value: [2, true, ['value'], false],
        recomputed: true
    })
    delete input.record.value
    assert.deepEqual(runtime.evaluate('record', input, compute), {
        value: [undefined, false, [], undefined],
        recomputed: true
    })
    input.record.extra = 8
    assert.deepEqual(runtime.evaluate('record', input, compute), {
        value: [undefined, false, ['extra'], undefined],
        recomputed: true
    })
})

test('reads current objects at a repeated path without caching getter values', () => {
    const runtime = new SelfAdjustingComputation()
    const records = [{ value: 2 }, { value: 7 }]
    let reads = 0
    const input = {
        get record() {
            return records[Math.min(reads++, 1)]
        }
    }

    assert.deepEqual(
        runtime.evaluate('sum', input, (state) => {
            const first = state.record
            const second = state.record
            assert.notEqual(first, second)
            assert.equal(second, state.record)
            return first.value + second.value
        }),
        { value: 9, recomputed: true }
    )
    assert.equal(reads, 3)
    assert.deepEqual(runtime.getStatistics(), {
        computations: 1,
        dependencies: 2,
        readerEdges: 1
    })
})

test('rebuilds tracking against the current mutable input on every recomputation', () => {
    const runtime = new SelfAdjustingComputation()
    const input = { record: { value: 2 } }
    const compute = (state) => state.record.value

    runtime.evaluate('value', input, compute)
    input.record.value = 7
    assert.deepEqual(runtime.evaluate('value', input, compute), {
        value: 7,
        recomputed: true
    })
    input.record = { value: 9 }
    assert.deepEqual(runtime.evaluate('value', input, compute), {
        value: 9,
        recomputed: true
    })
    assert.deepEqual(
        runtime.evaluate('value', { record: { value: 12 } }, compute),
        { value: 12, recomputed: true }
    )
})

test('keeps a completed trace unchanged when returned containers are read later', () => {
    const runtime = new SelfAdjustingComputation()
    const input = { record: { value: 2 }, observed: 1 }
    const compute = (state) => ({
        record: state.record,
        observed: state.observed
    })
    const first = runtime.evaluate('record', input, compute)
    const originalStatistics = runtime.getStatistics()
    assert.equal(first.value.record.value, 2)
    assert.deepEqual(runtime.getStatistics(), originalStatistics)
    assert.equal(
        runtime.evaluate(
            'record',
            { record: { value: 9 }, observed: 1 },
            compute
        ).recomputed,
        false
    )
})

test('late reads cannot replace the stored observation of a previously read value', () => {
    const runtime = new SelfAdjustingComputation()
    const input = { record: { value: 2 } }
    const compute = (state) => ({
        record: state.record,
        observed: state.record.value
    })
    const first = runtime.evaluate('record', input, compute)
    input.record.value = 9
    assert.equal(first.value.record.value, 9)
    assert.equal(first.value.observed, 2)

    const next = runtime.evaluate('record', input, compute)
    assert.equal(next.recomputed, true)
    assert.equal(next.value.observed, 9)
})

test('isolates atomic predicate path edits and preserves its per-read decisions', () => {
    const seen = []
    const runtime = new SelfAdjustingComputation({
        isAtomic: (_value, path) => {
            seen.push([...path])
            const atomic = path.at(-1) === 'asset'
            path.splice(0, path.length, 'mutated')
            return atomic
        }
    })
    const asset = { payload: 7 }
    const input = { record: { asset } }
    const compute = (state) => {
        assert.equal(state.record, state.record)
        return state.record.asset
    }

    assert.equal(runtime.evaluate('asset', input, compute).value, asset)
    assert.deepEqual(seen, [
        ['record'],
        ['record'],
        ['record'],
        ['record', 'asset']
    ])
    assert.equal(runtime.evaluate('asset', input, compute).recomputed, false)
    const replacement = { payload: 9 }
    input.record.asset = replacement
    assert.equal(runtime.evaluate('asset', input, compute).value, replacement)
})

test('rejects every tracked container mutation operation', () => {
    const mutations = [
        (record) => Reflect.set(record, 'value', 4),
        (record) => Reflect.defineProperty(record, 'value', { value: 4 }),
        (record) => Reflect.deleteProperty(record, 'value'),
        (record) => Reflect.setPrototypeOf(record, null),
        (record) => Reflect.preventExtensions(record)
    ]
    for (const mutate of mutations) {
        const runtime = new SelfAdjustingComputation()
        const input = { record: { value: 2 } }
        assert.throws(
            () =>
                runtime.evaluate('write', input, (state) =>
                    mutate(state.record)
                ),
            /read-only/u
        )
        assert.deepEqual(input, { record: { value: 2 } })
        assert.equal(runtime.getStatistics().computations, 0)
    }
})

/**
 * Measures repeated leaf observations after entering synthetic nested metadata.
 * @param {number} depth Metadata nesting depth.
 * @returns {number} Elapsed milliseconds with the correct accumulated result.
 */
function measureRepeatedLeafReads(depth) {
    let input = { value: 7 }
    for (let index = 0; index < depth; index += 1) input = { child: input }
    const start = performance.now()
    const result = new SelfAdjustingComputation().evaluate(
        'sum',
        input,
        (state) => {
            for (let index = 0; index < depth; index += 1) state = state.child
            let sum = 0
            for (let index = 0; index < 100000; index += 1) sum += state.value
            return sum
        }
    )
    const elapsed = performance.now() - start
    assert.equal(result.value, 700000)
    return elapsed
}

test('repeated leaf tracking does not scale with the full ancestor path', (context) => {
    measureRepeatedLeafReads(4)
    measureRepeatedLeafReads(128)
    const shallow = []
    const deep = []
    for (let run = 0; run < 3; run += 1) {
        shallow.push(measureRepeatedLeafReads(4))
        deep.push(measureRepeatedLeafReads(128))
    }
    const shallowMilliseconds = Math.min(...shallow)
    const deepMilliseconds = Math.min(...deep)
    context.diagnostic(
        JSON.stringify({ shallowMilliseconds, deepMilliseconds })
    )
    // Compare the same observable work with generous room for scheduling noise.
    assert.ok(
        deepMilliseconds < shallowMilliseconds * 4 + 50,
        `Repeated reads grew with ancestor depth: shallow ${shallowMilliseconds} ms, deep ${deepMilliseconds} ms`
    )
})
