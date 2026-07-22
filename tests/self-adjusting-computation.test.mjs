import assert from 'node:assert/strict'
import test from 'node:test'
import { SelfAdjustingComputation } from '../src/index.mjs'

test('reuses a successful result when observed dependencies are unchanged', () => {
    const runtime = new SelfAdjustingComputation()
    let executions = 0
    const compute = (state) => {
        executions += 1
        return state.preferences.sidebar.visible
    }

    const first = runtime.evaluate(
        'sidebar',
        {
            preferences: { sidebar: { visible: true } },
            statusMessage: 'Ready'
        },
        compute
    )
    const reused = runtime.evaluate(
        'sidebar',
        {
            preferences: { sidebar: { visible: true } },
            statusMessage: 'Changed'
        },
        compute
    )

    assert.deepEqual(first, { value: true, recomputed: true })
    assert.deepEqual(reused, { value: true, recomputed: false })
    assert.equal(executions, 1)
})

test('recomputes when an observed nested leaf changes', () => {
    const runtime = new SelfAdjustingComputation()
    let executions = 0
    const compute = (state) => {
        executions += 1
        return state.preferences.sidebar.visible
    }

    runtime.evaluate(
        'sidebar',
        { preferences: { sidebar: { visible: true } } },
        compute
    )
    const changed = runtime.evaluate(
        'sidebar',
        { preferences: { sidebar: { visible: false } } },
        compute
    )

    assert.deepEqual(changed, { value: false, recomputed: true })
    assert.equal(executions, 2)
})

test('replaces control dependencies when a branch changes', () => {
    const runtime = new SelfAdjustingComputation()
    let executions = 0
    const compute = (state) => {
        executions += 1
        return state.activeView === 'pcb'
            ? state.hiddenPcbLayers.board.join(',')
            : state.statusMessage
    }

    runtime.evaluate(
        'content',
        {
            activeView: 'schematic',
            hiddenPcbLayers: { board: ['top'] },
            statusMessage: 'Ready'
        },
        compute
    )
    const inactiveChange = runtime.evaluate(
        'content',
        {
            activeView: 'schematic',
            hiddenPcbLayers: { board: ['bottom'] },
            statusMessage: 'Ready'
        },
        compute
    )
    const branchChange = runtime.evaluate(
        'content',
        {
            activeView: 'pcb',
            hiddenPcbLayers: { board: ['bottom'] },
            statusMessage: 'Ready'
        },
        compute
    )
    const oldBranchChange = runtime.evaluate(
        'content',
        {
            activeView: 'pcb',
            hiddenPcbLayers: { board: ['bottom'] },
            statusMessage: 'No longer observed'
        },
        compute
    )
    const activeBranchChange = runtime.evaluate(
        'content',
        {
            activeView: 'pcb',
            hiddenPcbLayers: { board: ['inner'] },
            statusMessage: 'No longer observed'
        },
        compute
    )

    assert.equal(inactiveChange.recomputed, false)
    assert.deepEqual(branchChange, { value: 'bottom', recomputed: true })
    assert.equal(oldBranchChange.recomputed, false)
    assert.deepEqual(activeBranchChange, {
        value: 'inner',
        recomputed: true
    })
    assert.equal(executions, 3)
})

test('tracks key enumeration as a structural dependency', () => {
    const runtime = new SelfAdjustingComputation()
    let executions = 0
    const compute = (state) => {
        executions += 1
        return Object.keys(state.flags).sort().join(',')
    }

    runtime.evaluate('flags', { flags: { copper: true } }, compute)
    const valueOnlyChange = runtime.evaluate(
        'flags',
        { flags: { copper: false } },
        compute
    )
    const keyChange = runtime.evaluate(
        'flags',
        { flags: { copper: false, mask: true } },
        compute
    )

    assert.equal(valueOnlyChange.recomputed, false)
    assert.deepEqual(keyChange, {
        value: 'copper,mask',
        recomputed: true
    })
    assert.equal(executions, 2)
})

test('tracks property existence without depending on unrelated values', () => {
    const runtime = new SelfAdjustingComputation()
    let executions = 0
    const compute = (state) => {
        executions += 1
        return 'selection' in state
    }

    runtime.evaluate('selection', { status: 'Ready' }, compute)
    const unrelated = runtime.evaluate(
        'selection',
        { status: 'Changed' },
        compute
    )
    const added = runtime.evaluate(
        'selection',
        { status: 'Changed', selection: null },
        compute
    )

    assert.equal(unrelated.recomputed, false)
    assert.deepEqual(added, { value: true, recomputed: true })
    assert.equal(executions, 2)
})

test('preserves configured atomic document identity', () => {
    const runtime = new SelfAdjustingComputation({
        isAtomic: (_value, path) => path.at(-1) === 'documentModel'
    })
    const firstDocument = { kind: 'pcb' }
    const secondDocument = { kind: 'pcb' }
    let executions = 0
    const compute = (state) => {
        executions += 1
        return state.documentModel
    }

    const first = runtime.evaluate(
        'document',
        { documentModel: firstDocument, status: 'Ready' },
        compute
    )
    const reused = runtime.evaluate(
        'document',
        { documentModel: firstDocument, status: 'Changed' },
        compute
    )
    const changed = runtime.evaluate(
        'document',
        { documentModel: secondDocument, status: 'Changed' },
        compute
    )

    assert.equal(first.value, firstDocument)
    assert.equal(reused.value, firstDocument)
    assert.equal(reused.recomputed, false)
    assert.equal(changed.value, secondDocument)
    assert.equal(changed.recomputed, true)
    assert.equal(executions, 2)
})

test('does not cache failed executions', () => {
    const runtime = new SelfAdjustingComputation()
    let executions = 0
    const compute = (state) => {
        executions += 1
        if (executions === 1) throw new Error('transient failure')
        return state.value
    }

    assert.throws(
        () => runtime.evaluate('retry', { value: 7 }, compute),
        /transient failure/u
    )
    const retried = runtime.evaluate('retry', { value: 7 }, compute)

    assert.deepEqual(retried, { value: 7, recomputed: true })
    assert.equal(executions, 2)
})

test('rejects writes through the tracked snapshot', () => {
    const runtime = new SelfAdjustingComputation()

    assert.throws(
        () =>
            runtime.evaluate('write', { value: 1 }, (state) => {
                state.value = 2
            }),
        /read-only/u
    )
})

test('starts propagation from readers of explicitly changed roots', () => {
    const runtime = new SelfAdjustingComputation()
    let statusExecutions = 0
    let contentExecutions = 0
    const status = (state) => {
        statusExecutions += 1
        return state.statusMessage
    }
    const content = (state) => {
        contentExecutions += 1
        return state.documentModel
    }
    const documentModel = { kind: 'schematic' }
    const initial = { statusMessage: 'Ready', documentModel }

    runtime.propagate(initial, null, [
        { name: 'status', computation: status },
        { name: 'content', computation: content }
    ])
    const changed = { statusMessage: 'Loading', documentModel }
    const results = runtime.propagate(
        changed,
        [['statusMessage']],
        [
            { name: 'status', computation: status },
            { name: 'content', computation: content }
        ]
    )

    assert.deepEqual(results.get('status'), {
        value: 'Loading',
        recomputed: true
    })
    assert.deepEqual(results.get('content'), {
        value: documentModel,
        recomputed: false
    })
    assert.equal(statusExecutions, 2)
    assert.equal(contentExecutions, 1)
})

test('removes stale reader edges when control flow changes', () => {
    const runtime = new SelfAdjustingComputation()
    let executions = 0
    const compute = (state) => {
        executions += 1
        return state.mode === 'left' ? state.left : state.right
    }
    let input = { mode: 'left', left: 1, right: 2 }

    runtime.propagate(input, null, [{ name: 'branch', computation: compute }])
    input = { mode: 'right', left: 1, right: 2 }
    runtime.propagate(
        input,
        [['mode']],
        [{ name: 'branch', computation: compute }]
    )
    input = { mode: 'right', left: 9, right: 2 }
    const staleChange = runtime.propagate(
        input,
        [['left']],
        [{ name: 'branch', computation: compute }]
    )
    input = { mode: 'right', left: 9, right: 8 }
    const activeChange = runtime.propagate(
        input,
        [['right']],
        [{ name: 'branch', computation: compute }]
    )

    assert.equal(staleChange.get('branch').recomputed, false)
    assert.deepEqual(activeChange.get('branch'), {
        value: 8,
        recomputed: true
    })
    assert.equal(executions, 3)
})

test('change propagation stays consistent with a from-scratch run', () => {
    const incremental = new SelfAdjustingComputation()
    const compute = (state) => ({
        keys: Object.keys(state.values).sort(),
        selected:
            state.mode === 'primary'
                ? state.values.primary
                : state.values.secondary
    })
    const updates = [
        {
            input: {
                mode: 'primary',
                values: { primary: 1, secondary: 2 }
            },
            changes: null
        },
        {
            input: {
                mode: 'primary',
                values: { primary: 3, secondary: 2 }
            },
            changes: [['values']]
        },
        {
            input: {
                mode: 'secondary',
                values: { primary: 3, secondary: 2, alternate: 4 }
            },
            changes: [['mode'], ['values']]
        },
        {
            input: {
                mode: 'secondary',
                values: { primary: 9, secondary: 2 }
            },
            changes: [['values']]
        }
    ]

    for (const update of updates) {
        const propagated = incremental.propagate(update.input, update.changes, [
            { name: 'summary', computation: compute }
        ])
        const fresh = new SelfAdjustingComputation().evaluate(
            'summary',
            update.input,
            compute
        )

        assert.deepEqual(propagated.get('summary').value, fresh.value)
    }
})

test('reclaims replaced and explicitly forgotten traces', () => {
    const runtime = new SelfAdjustingComputation()
    const compute = (state) =>
        state.mode === 'left' ? state.left : state.right

    runtime.propagate({ mode: 'left', left: 1, right: 2 }, null, [
        { name: 'branch', computation: compute }
    ])
    runtime.propagate(
        { mode: 'right', left: 1, right: 2 },
        [['mode']],
        [{ name: 'branch', computation: compute }]
    )

    assert.deepEqual(runtime.getStatistics(), {
        computations: 1,
        dependencies: 2,
        readerEdges: 2
    })
    assert.equal(runtime.forget('branch'), true)
    assert.deepEqual(runtime.getStatistics(), {
        computations: 0,
        dependencies: 0,
        readerEdges: 0
    })
    assert.equal(runtime.forget('branch'), false)
})

test('rejects asynchronous computations because their trace would escape', () => {
    const runtime = new SelfAdjustingComputation()

    assert.throws(
        () =>
            runtime.evaluate(
                'async',
                { value: 1 },
                async (state) => state.value
            ),
        /synchronous/u
    )
})
