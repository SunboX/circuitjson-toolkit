import assert from 'node:assert/strict'
import test from 'node:test'

import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { ToolkitError } from '../src/core/contracts/ToolkitError.mjs'
import { SimulationService } from '../src/core/SimulationService.mjs'

/**
 * Creates one externally controlled promise.
 * @returns {{ promise: Promise<unknown>, resolve: (value?: unknown) => void, reject: (error?: unknown) => void }} Deferred promise.
 */
function createDeferred() {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

/**
 * Observes whether a promise settles before a bounded timeout.
 * @param {Promise<unknown>} promise Promise under test.
 * @param {number} [timeoutMs] Timeout duration.
 * @returns {Promise<{ kind: string, value?: unknown, error?: unknown }>} Settlement record.
 */
function settleWithin(promise, timeoutMs = 100) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs)
        promise.then(
            (value) => {
                clearTimeout(timer)
                resolve({ kind: 'resolved', value })
            },
            (error) => {
                clearTimeout(timer)
                resolve({ kind: 'rejected', error })
            }
        )
    })
}

/**
 * Waits through one host turn so late promise rejections are observable.
 * @returns {Promise<void>} Completion promise.
 */
function waitForHostTurn() {
    return new Promise((resolve) => setImmediate(resolve))
}

/**
 * Builds one standard transient simulation definition.
 * @returns {object[]} CircuitJSON simulation document.
 */
function createSimulationDocument() {
    return [
        {
            type: 'simulation_experiment',
            simulation_experiment_id: 'analysis_tran',
            name: 'Transient',
            experiment_type: 'spice_transient_analysis',
            start_time_ms: 0,
            end_time_ms: 3,
            time_per_step: 1
        },
        {
            type: 'simulation_spice_subcircuit',
            simulation_spice_subcircuit_id: 'circuit_fake',
            source_component_id: 'source_fake',
            spice_pin_to_source_port_map: { 1: 'source_port_fake' },
            subcircuit_source: '.SUBCKT FAKE 1\n.ENDS FAKE'
        }
    ]
}

test('SimulationService builds and exports canonical simulation definitions', () => {
    const context = CircuitJsonDocumentContext.prepare(
        createSimulationDocument()
    )
    const simulation = SimulationService.build(context)
    const file = SimulationService.export(context, {
        id: 'simulation-circuitjson-json',
        options: {}
    })

    assert.equal(simulation.schema, 'ecad-toolkit.simulation.v1')
    assert.deepEqual(Object.keys(simulation), [
        'schema',
        'circuits',
        'analyses',
        'models',
        'diagnostics',
        'statistics'
    ])
    assert.equal(simulation.circuits.length, 1)
    assert.equal(simulation.analyses.length, 1)
    assert.deepEqual(simulation.models, [])
    assert.deepEqual(simulation.diagnostics, [])
    assert.equal(file.fileName, 'simulation-circuitjson.json')
    assert.equal(file.mediaType, 'application/json;charset=utf-8')
    assert.equal(typeof file.data, 'string')
    assert.deepEqual(file.diagnostics, [])
    assert.equal(JSON.parse(file.data).schema, 'ecad-toolkit.simulation.v1')
    assert.equal(context.statistics.derivedBuilds['simulation:build-v1'], 1)
    assert.doesNotThrow(() => structuredClone(simulation))
})

test('SimulationService requires an injected compatible engine', async () => {
    await assert.rejects(
        () =>
            SimulationService.run([], {
                analysisId: 'analysis_tran',
                parameters: {}
            }),
        { code: 'ERR_CAPABILITY_UNAVAILABLE', category: 'unsupported' }
    )

    await assert.rejects(
        () =>
            SimulationService.run(
                createSimulationDocument(),
                { analysisId: 'analysis_tran', parameters: {} },
                {
                    engine: {
                        supportsAnalysis() {
                            return false
                        },
                        run() {
                            throw new Error('must not run')
                        }
                    }
                }
            ),
        { code: 'ERR_CAPABILITY_UNAVAILABLE' }
    )
})

test('SimulationService normalizes injected engine results and reuses context', async () => {
    const context = CircuitJsonDocumentContext.prepare(
        createSimulationDocument()
    )
    const calls = []
    const progress = []
    const engine = {
        supportsAnalysis(analysis) {
            return analysis.experiment_type === 'spice_transient_analysis'
        },
        async run(request) {
            calls.push(request)
            return {
                status: 'success',
                traces: [
                    {
                        type: 'simulation_transient_voltage_graph',
                        simulation_transient_voltage_graph_id: 'trace_vout',
                        simulation_experiment_id: 'analysis_tran',
                        voltage_levels: [0, 1],
                        timestamps_ms: [0, 1],
                        time_per_step: 1,
                        start_time_ms: 0,
                        end_time_ms: 1
                    }
                ],
                measurements: { peakVoltage: 1 },
                diagnostics: []
            }
        }
    }
    const result = await SimulationService.run(
        context,
        { analysisId: 'analysis_tran', parameters: { temperature: 25 } },
        { engine, onProgress: (event) => progress.push(event) }
    )

    assert.equal(result.schema, 'ecad-toolkit.simulation-result.v1')
    assert.equal(result.status, 'success')
    assert.equal(result.traces.length, 1)
    assert.deepEqual(result.measurements, { peakVoltage: 1 })
    assert.deepEqual(result.diagnostics, [])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].analysis.simulation_experiment_id, 'analysis_tran')
    assert.deepEqual(calls[0].parameters, { temperature: 25 })
    assert.deepEqual(progress, [
        {
            stage: 'detect',
            detail: 'simulation-request',
            completed: 0,
            total: 4
        },
        {
            stage: 'decode',
            detail: 'simulation-definition',
            completed: 1,
            total: 4
        },
        {
            stage: 'project',
            detail: 'simulation-execution',
            completed: 2,
            total: 4
        },
        {
            stage: 'validate',
            detail: 'simulation-result',
            completed: 3,
            total: 4
        },
        {
            stage: 'complete',
            detail: 'simulation-result',
            completed: 4,
            total: 4
        }
    ])
    assert.equal(context.statistics.derivedBuilds['simulation:build-v1'], 1)
    assert.doesNotThrow(() => structuredClone(result))
})

test('SimulationService rejects unavailable exports and cancelled runs', async () => {
    assert.throws(
        () =>
            SimulationService.export(createSimulationDocument(), {
                id: 'unknown',
                options: {}
            }),
        { code: 'ERR_CAPABILITY_UNAVAILABLE' }
    )

    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
        () =>
            SimulationService.run(
                createSimulationDocument(),
                { analysisId: 'analysis_tran', parameters: {} },
                { engine: { run() {} }, signal: controller.signal }
            ),
        { code: 'ERR_CANCELLED', category: 'cancelled' }
    )
})

test('SimulationService rejects accessor-backed signal lookalikes without reading them', async () => {
    let getterCalls = 0
    const signal = {}
    Object.defineProperty(signal, 'aborted', {
        enumerable: true,
        get() {
            getterCalls += 1
            return false
        }
    })

    await assert.rejects(
        () =>
            SimulationService.run(
                createSimulationDocument(),
                { analysisId: 'analysis_tran', parameters: {} },
                { engine: { run: () => ({}) }, signal }
            ),
        { code: 'ERR_SIMULATION_REQUEST', category: 'validation' }
    )
    assert.equal(getterCalls, 0)
})

test('SimulationService never trusts a shadowed AbortSignal state property', async () => {
    const controller = new AbortController()
    let shadowReads = 0
    Object.defineProperty(controller.signal, 'aborted', {
        configurable: true,
        get() {
            shadowReads += 1
            throw new Error('shadowed aborted getter executed')
        }
    })

    const result = await SimulationService.run(
        createSimulationDocument(),
        { analysisId: 'analysis_tran', parameters: {} },
        {
            engine: {
                run() {
                    return { traces: [], measurements: {}, diagnostics: [] }
                }
            },
            signal: controller.signal
        }
    )

    assert.equal(result.status, 'success')
    assert.equal(shadowReads, 0)
})

test('SimulationService promptly cancels a pending support probe without leaking its late rejection', async () => {
    const controller = new AbortController()
    const started = createDeferred()
    const support = createDeferred()
    const unhandled = []
    let supportOptions = null
    const onUnhandled = (error) => unhandled.push(error)
    process.on('unhandledRejection', onUnhandled)

    try {
        const pending = SimulationService.run(
            createSimulationDocument(),
            { analysisId: 'analysis_tran', parameters: {} },
            {
                engine: {
                    supportsAnalysis(_analysis, _parameters, options) {
                        supportOptions = options
                        started.resolve()
                        return support.promise
                    },
                    run() {
                        throw new Error('cancelled support must not execute')
                    }
                },
                signal: controller.signal
            }
        )
        await started.promise
        controller.abort()
        const outcome = await settleWithin(pending)
        support.reject(new Error('late support rejection'))
        await waitForHostTurn()

        assert.equal(outcome.kind, 'rejected')
        assert.equal(outcome.error?.code, 'ERR_CANCELLED')
        assert.equal(outcome.error?.category, 'cancelled')
        assert.equal(supportOptions?.signal, controller.signal)
        assert.deepEqual(unhandled, [])
    } finally {
        process.off('unhandledRejection', onUnhandled)
    }
})

test('SimulationService promptly cancels pending engine execution without leaking its late rejection', async () => {
    const controller = new AbortController()
    const started = createDeferred()
    const execution = createDeferred()
    const unhandled = []
    let executionSignal = null
    const onUnhandled = (error) => unhandled.push(error)
    process.on('unhandledRejection', onUnhandled)

    try {
        const pending = SimulationService.run(
            createSimulationDocument(),
            { analysisId: 'analysis_tran', parameters: {} },
            {
                engine: {
                    run(request) {
                        executionSignal = request.signal
                        started.resolve()
                        return execution.promise
                    }
                },
                signal: controller.signal
            }
        )
        await started.promise
        controller.abort()
        const outcome = await settleWithin(pending)
        execution.reject(new Error('late execution rejection'))
        await waitForHostTurn()

        assert.equal(outcome.kind, 'rejected')
        assert.equal(outcome.error?.code, 'ERR_CANCELLED')
        assert.equal(outcome.error?.category, 'cancelled')
        assert.equal(executionSignal, controller.signal)
        assert.deepEqual(unhandled, [])
    } finally {
        process.off('unhandledRejection', onUnhandled)
    }
})

test('SimulationService stops before engine execution when progress requests cancellation', async () => {
    const controller = new AbortController()
    let engineCalls = 0

    await assert.rejects(
        () =>
            SimulationService.run(
                createSimulationDocument(),
                { analysisId: 'analysis_tran', parameters: {} },
                {
                    engine: {
                        run() {
                            engineCalls += 1
                            return {
                                traces: [],
                                measurements: {},
                                diagnostics: []
                            }
                        }
                    },
                    signal: controller.signal,
                    onProgress(event) {
                        if (event.stage === 'project') controller.abort()
                    }
                }
            ),
        { code: 'ERR_CANCELLED', category: 'cancelled' }
    )
    assert.equal(engineCalls, 0)
})

test('SimulationService does not expose host progress callbacks to injected engines', async () => {
    const callbackError = new Error('private engine progress escaped')
    const progress = []
    let engineOwnsProgress = null
    let emitAfterCompletion = null

    const result = await SimulationService.run(
        createSimulationDocument(),
        { analysisId: 'analysis_tran', parameters: {} },
        {
            engine: {
                run(request) {
                    engineOwnsProgress = Object.hasOwn(request, 'onProgress')
                    emitAfterCompletion = () =>
                        request.onProgress?.({
                            stage: 'engine-post-complete'
                        })
                    request.onProgress?.({ stage: 'engine-private' })
                    return { traces: [], measurements: {}, diagnostics: [] }
                }
            },
            onProgress(event) {
                progress.push(event)
                if (event.stage.startsWith('engine-')) throw callbackError
            }
        }
    )
    emitAfterCompletion()
    await waitForHostTurn()

    assert.equal(result.status, 'success')
    assert.equal(engineOwnsProgress, false)
    assert.deepEqual(
        progress.map((event) => [event.stage, event.detail]),
        [
            ['detect', 'simulation-request'],
            ['decode', 'simulation-definition'],
            ['project', 'simulation-execution'],
            ['validate', 'simulation-result'],
            ['complete', 'simulation-result']
        ]
    )
})

test('SimulationService distinguishes canonical callback failures from engine failures', async () => {
    const callbackError = new Error('host progress callback failed')
    const engineError = new Error('injected engine failed')

    await assert.rejects(
        () =>
            SimulationService.run(
                createSimulationDocument(),
                { analysisId: 'analysis_tran', parameters: {} },
                {
                    engine: {
                        run() {
                            return {
                                traces: [],
                                measurements: {},
                                diagnostics: []
                            }
                        }
                    },
                    onProgress(event) {
                        if (event.stage === 'complete') throw callbackError
                    }
                }
            ),
        (error) => error === callbackError
    )

    await assert.rejects(
        () =>
            SimulationService.run(
                createSimulationDocument(),
                { analysisId: 'analysis_tran', parameters: {} },
                {
                    engine: {
                        run() {
                            throw engineError
                        }
                    }
                }
            ),
        (error) =>
            error instanceof ToolkitError &&
            error !== engineError &&
            error.code === 'ERR_SIMULATION_RUNTIME' &&
            error.cause?.message === engineError.message
    )
})

test('SimulationService rejects nested accessor parameters without executing them', async () => {
    let getterCalls = 0
    let engineCalls = 0
    const nested = {}
    Object.defineProperty(nested, 'temperature', {
        enumerable: true,
        get() {
            getterCalls += 1
            return 25
        }
    })

    await assert.rejects(
        () =>
            SimulationService.run(
                createSimulationDocument(),
                { analysisId: 'analysis_tran', parameters: { nested } },
                {
                    engine: {
                        run() {
                            engineCalls += 1
                            return {}
                        }
                    }
                }
            ),
        { code: 'ERR_SIMULATION_REQUEST', category: 'validation' }
    )
    assert.equal(getterCalls, 0)
    assert.equal(engineCalls, 0)
})

test('SimulationService bounds parameter containers without invoking custom iterators', async () => {
    let iteratorCalls = 0
    let sizeGetterCalls = 0
    class ParameterMap extends Map {
        /** @returns {number} Custom size accessor. */
        get size() {
            sizeGetterCalls += 1
            return super.size
        }

        /** @returns {IterableIterator<[unknown, unknown]>} Custom iterator. */
        [Symbol.iterator]() {
            iteratorCalls += 1
            return super[Symbol.iterator]()
        }
    }
    const engine = {
        run(request) {
            return {
                traces: [],
                measurements: {
                    mapIsMap: request.parameters.values instanceof Map
                },
                diagnostics: []
            }
        }
    }
    const result = await SimulationService.run(
        createSimulationDocument(),
        {
            analysisId: 'analysis_tran',
            parameters: { values: new ParameterMap([['temperature', 25]]) }
        },
        { engine }
    )

    assert.equal(iteratorCalls, 0)
    assert.equal(sizeGetterCalls, 0)
    assert.equal(result.measurements.mapIsMap, true)

    await assert.rejects(
        () =>
            SimulationService.run(
                createSimulationDocument(),
                {
                    analysisId: 'analysis_tran',
                    parameters: { sparse: new Array(100001) }
                },
                { engine }
            ),
        { code: 'ERR_SIMULATION_REQUEST', category: 'validation' }
    )
})

test('SimulationService copies only typed-array view bytes and isolates shared backing memory', async () => {
    const backing = new ArrayBuffer(16)
    const allBytes = new Uint8Array(backing)
    allBytes.set(Array.from({ length: 16 }, (_entry, index) => index))
    const window = new Uint16Array(backing, 4, 2)
    const dataView = new DataView(backing, 8, 3)
    const sharedBacking = new SharedArrayBuffer(12)
    const sharedWindow = new Uint8Array(sharedBacking, 3, 3)
    sharedWindow.set([7, 8, 9])
    const rawSharedBuffer = new SharedArrayBuffer(4)
    new Uint8Array(rawSharedBuffer).set([11, 12, 13, 14])
    let received = null

    const result = await SimulationService.run(
        createSimulationDocument(),
        {
            analysisId: 'analysis_tran',
            parameters: {
                window,
                dataView,
                sharedWindow,
                rawSharedBuffer
            }
        },
        {
            engine: {
                run(request) {
                    received = request.parameters
                    sharedWindow[0] = 99
                    return { traces: [], measurements: {}, diagnostics: [] }
                }
            }
        }
    )

    assert.equal(result.status, 'success')
    assert.equal(received.window instanceof Uint16Array, true)
    assert.equal(received.window.byteOffset, 0)
    assert.equal(received.window.byteLength, 4)
    assert.equal(received.window.buffer.byteLength, 4)
    assert.deepEqual([...new Uint8Array(received.window.buffer)], [4, 5, 6, 7])
    assert.equal(received.dataView instanceof DataView, true)
    assert.equal(received.dataView.byteOffset, 0)
    assert.equal(received.dataView.byteLength, 3)
    assert.equal(received.dataView.buffer.byteLength, 3)
    assert.deepEqual([...new Uint8Array(received.dataView.buffer)], [8, 9, 10])
    assert.equal(received.sharedWindow instanceof Uint8Array, true)
    assert.equal(received.sharedWindow.byteOffset, 0)
    assert.equal(
        received.sharedWindow.buffer instanceof SharedArrayBuffer,
        false
    )
    assert.equal(received.sharedWindow.buffer.byteLength, 3)
    assert.deepEqual([...received.sharedWindow], [7, 8, 9])
    assert.equal(received.rawSharedBuffer instanceof ArrayBuffer, true)
    assert.equal(received.rawSharedBuffer instanceof SharedArrayBuffer, false)
    assert.deepEqual(
        [...new Uint8Array(received.rawSharedBuffer)],
        [11, 12, 13, 14]
    )
})

test('SimulationService counts nested Map and Set entries in one global parameter budget', async () => {
    const map = new Map()
    const set = new Set()
    for (let index = 0; index < 50100; index += 1) {
        map.set(index, index)
        set.add(index)
    }
    let engineCalls = 0

    await assert.rejects(
        () =>
            SimulationService.run(
                createSimulationDocument(),
                {
                    analysisId: 'analysis_tran',
                    parameters: { nested: { map, set } }
                },
                {
                    engine: {
                        run() {
                            engineCalls += 1
                            return {}
                        }
                    }
                }
            ),
        { code: 'ERR_SIMULATION_REQUEST', category: 'validation' }
    )
    assert.equal(engineCalls, 0)
})

test('SimulationService contains hostile nested parameter proxies in ToolkitError', async () => {
    const hostile = new Proxy(
        {},
        {
            getPrototypeOf() {
                throw new Error('hostile prototype trap')
            }
        }
    )

    await assert.rejects(
        () =>
            SimulationService.run(
                createSimulationDocument(),
                {
                    analysisId: 'analysis_tran',
                    parameters: { hostile }
                },
                { engine: { run: () => ({}) } }
            ),
        (error) =>
            error instanceof ToolkitError &&
            error.code === 'ERR_SIMULATION_REQUEST' &&
            error.category === 'validation'
    )
})

test('SimulationService normalizes injected engine support failures', async () => {
    await assert.rejects(
        () =>
            SimulationService.run(
                createSimulationDocument(),
                { analysisId: 'analysis_tran', parameters: {} },
                {
                    engine: {
                        supportsAnalysis() {
                            throw new Error('support probe failed')
                        },
                        run() {
                            return {}
                        }
                    }
                }
            ),
        { code: 'ERR_SIMULATION_RUNTIME', category: 'runtime' }
    )
})

test('SimulationService contains hostile engine failures in ToolkitError', async () => {
    const hostile = new Proxy(
        {},
        {
            get() {
                throw new Error('hostile failure property trap')
            }
        }
    )

    await assert.rejects(
        () =>
            SimulationService.run(
                createSimulationDocument(),
                { analysisId: 'analysis_tran', parameters: {} },
                {
                    engine: {
                        run() {
                            return Promise.reject(hostile)
                        }
                    }
                }
            ),
        (error) =>
            error instanceof ToolkitError &&
            error.code === 'ERR_SIMULATION_RUNTIME' &&
            error.category === 'runtime'
    )
})

test('SimulationService emits exact ToolkitDiagnostic rows for build and engine diagnostics', async () => {
    const build = SimulationService.build([
        ...createSimulationDocument(),
        {
            type: 'simulation_unknown_experiment_error',
            simulation_unknown_experiment_error_id: 'simulation_error_1',
            error_type: 'simulation_unknown_experiment_error',
            simulation_experiment_id: 'analysis_tran',
            message: 'Experiment is unsupported.'
        }
    ])
    const engineDiagnostic = {
        code: 'ENGINE_WARNING',
        severity: 'warning',
        message: 'Engine warning.',
        source: 'injected-engine',
        location: { sample: 3 },
        details: { analysisId: 'analysis_tran' },
        engineOnly: 'must be removed'
    }
    const result = await SimulationService.run(
        createSimulationDocument(),
        { analysisId: 'analysis_tran', parameters: {} },
        {
            engine: {
                run() {
                    return {
                        traces: [],
                        measurements: {},
                        diagnostics: [engineDiagnostic]
                    }
                }
            }
        }
    )

    assert.deepEqual(build.diagnostics, [
        {
            code: 'simulation_unknown_experiment_error',
            severity: 'error',
            message: 'Experiment is unsupported.',
            source: '',
            location: null,
            details: {}
        }
    ])
    assert.deepEqual(result.diagnostics, [
        {
            code: 'ENGINE_WARNING',
            severity: 'warning',
            message: 'Engine warning.',
            source: 'injected-engine',
            location: { sample: 3 },
            details: { analysisId: 'analysis_tran' }
        }
    ])
    assert.deepEqual(Object.keys(result.diagnostics[0]), [
        'code',
        'severity',
        'message',
        'source',
        'location',
        'details'
    ])
    assert.notEqual(result.diagnostics[0], engineDiagnostic)
})

test('SimulationService reports legacy injected simulation failures as failed', async () => {
    const result = await SimulationService.run(
        createSimulationDocument(),
        {
            analysisId: 'analysis_tran',
            parameters: { spiceString: 'broken' }
        },
        {
            engine: {
                simulate() {
                    throw new Error('engine failed')
                }
            }
        }
    )

    assert.equal(result.status, 'failed')
    assert.equal(result.traces.length, 0)
    assert.equal(
        result.diagnostics.some((entry) => entry.severity === 'error'),
        true
    )
    assert.deepEqual(Object.keys(result.diagnostics[0]), [
        'code',
        'severity',
        'message',
        'source',
        'location',
        'details'
    ])
})
