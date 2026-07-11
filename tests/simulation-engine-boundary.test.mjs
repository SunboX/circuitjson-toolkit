import assert from 'node:assert/strict'
import test from 'node:test'

import { ToolkitError } from '../src/core/contracts/ToolkitError.mjs'
import { SimulationService } from '../src/core/SimulationService.mjs'

/**
 * Builds one valid transient simulation document.
 * @returns {object[]} CircuitJSON simulation rows.
 */
function createSimulationDocument() {
    return [
        {
            type: 'simulation_experiment',
            simulation_experiment_id: 'analysis_boundary',
            name: 'Boundary analysis',
            experiment_type: 'spice_transient_analysis',
            start_time_ms: 0,
            end_time_ms: 1,
            time_per_step: 1
        }
    ]
}

/**
 * Captures one rejected service promise as a test value.
 * @param {Promise<unknown>} operation Pending service operation.
 * @returns {Promise<unknown>} Rejection value or null for success.
 */
async function captureFailure(operation) {
    return operation.then(
        () => null,
        (error) => error
    )
}

/**
 * Builds one injected engine that can complete successfully.
 * @returns {{ run: () => object }} Successful engine.
 */
function createSuccessfulEngine() {
    return {
        run() {
            return { traces: [], measurements: {}, diagnostics: [] }
        }
    }
}

test('SimulationService always normalizes ToolkitError failures from injected engines', async () => {
    const supportError = new ToolkitError('support boundary failed', {
        code: 'ERR_ENGINE_SUPPORT_TYPED',
        category: 'cancelled'
    })
    const runError = new ToolkitError('run boundary failed', {
        code: 'ERR_ENGINE_RUN_TYPED',
        category: 'unsupported'
    })

    const supportFailure = await SimulationService.run(
        createSimulationDocument(),
        { analysisId: 'analysis_boundary', parameters: {} },
        {
            engine: {
                supportsAnalysis() {
                    throw supportError
                },
                run() {
                    throw new Error('must not run')
                }
            }
        }
    ).then(
        () => null,
        (error) => error
    )
    const runFailure = await SimulationService.run(
        createSimulationDocument(),
        { analysisId: 'analysis_boundary', parameters: {} },
        {
            engine: {
                run() {
                    throw runError
                }
            }
        }
    ).then(
        () => null,
        (error) => error
    )

    for (const [failure, injected, causeCode] of [
        [supportFailure, supportError, 'ERR_ENGINE_SUPPORT_TYPED'],
        [runFailure, runError, 'ERR_ENGINE_RUN_TYPED']
    ]) {
        assert.equal(failure instanceof ToolkitError, true)
        assert.notEqual(failure, injected)
        assert.equal(failure.code, 'ERR_SIMULATION_RUNTIME')
        assert.equal(failure.category, 'runtime')
        assert.equal(failure.cause?.code, causeCode)
    }
})

test('SimulationService contains a hostile Proxy around ToolkitError', async () => {
    const target = new ToolkitError('proxied engine failure', {
        code: 'ERR_PROXIED_ENGINE',
        category: 'runtime'
    })
    const hostile = new Proxy(target, {
        getPrototypeOf() {
            return ToolkitError.prototype
        },
        get() {
            throw new Error('hostile ToolkitError field trap')
        }
    })

    let failure = null
    await SimulationService.run(
        createSimulationDocument(),
        { analysisId: 'analysis_boundary', parameters: {} },
        {
            engine: {
                run() {
                    throw hostile
                }
            }
        }
    ).then(
        () => {},
        (error) => {
            failure = error
        }
    )

    assert.equal(failure instanceof ToolkitError, true)
    assert.equal(failure === hostile, false)
    assert.equal(failure.code, 'ERR_SIMULATION_RUNTIME')
    assert.equal(failure.category, 'runtime')
    assert.equal(typeof failure.message, 'string')
    assert.doesNotThrow(() => structuredClone(failure.toJSON()))
})

test('SimulationService invokes proxied engine callables without reading their properties', async () => {
    let propertyReads = 0
    let engine = null
    const supportsAnalysis = new Proxy(function () {}, {
        get() {
            propertyReads += 1
            throw new Error('support callable property trap')
        },
        apply(_target, receiver) {
            assert.equal(receiver, engine)
            return true
        }
    })
    const run = new Proxy(function () {}, {
        get() {
            propertyReads += 1
            throw new Error('run callable property trap')
        },
        apply(_target, receiver) {
            assert.equal(receiver, engine)
            return { traces: [], measurements: {}, diagnostics: [] }
        }
    })
    engine = { supportsAnalysis, run }

    const result = await SimulationService.run(
        createSimulationDocument(),
        { analysisId: 'analysis_boundary', parameters: {} },
        { engine }
    )

    assert.equal(result.status, 'success')
    assert.equal(propertyReads, 0)
})

test('SimulationService normalizes earlier service errors replayed across every engine boundary', async () => {
    const request = { analysisId: 'analysis_boundary', parameters: {} }
    const unavailable = await captureFailure(
        SimulationService.run(createSimulationDocument(), request, {
            engine: {}
        })
    )
    const controller = new AbortController()
    controller.abort()
    const cancelled = await captureFailure(
        SimulationService.run(createSimulationDocument(), request, {
            engine: createSuccessfulEngine(),
            signal: controller.signal
        })
    )

    assert.equal(unavailable?.code, 'ERR_CAPABILITY_UNAVAILABLE')
    assert.equal(cancelled?.code, 'ERR_CANCELLED')

    for (const [label, replayed] of [
        ['unavailable', unavailable],
        ['cancelled', cancelled]
    ]) {
        for (const boundary of ['supportsAnalysis', 'run']) {
            const engine =
                boundary === 'supportsAnalysis'
                    ? {
                          supportsAnalysis() {
                              throw replayed
                          },
                          ...createSuccessfulEngine()
                      }
                    : {
                          run() {
                              throw replayed
                          }
                      }
            const failure = await captureFailure(
                SimulationService.run(createSimulationDocument(), request, {
                    engine
                })
            )

            assert.equal(failure instanceof ToolkitError, true)
            assert.notEqual(failure, replayed, `${label} via ${boundary}`)
            assert.equal(failure.code, 'ERR_SIMULATION_RUNTIME')
            assert.equal(failure.category, 'runtime')
            assert.equal(failure.cause?.code, replayed.code)
        }
    }
})

test('SimulationService normalizes nested service errors crossing every engine boundary', async () => {
    const request = { analysisId: 'analysis_boundary', parameters: {} }

    for (const kind of ['unavailable', 'cancelled']) {
        for (const boundary of ['supportsAnalysis', 'run']) {
            let nestedFailure = null
            const nestedOperation = () => {
                let options
                if (kind === 'unavailable') {
                    options = { engine: {} }
                } else {
                    const controller = new AbortController()
                    controller.abort()
                    options = {
                        engine: createSuccessfulEngine(),
                        signal: controller.signal
                    }
                }
                return SimulationService.run(
                    createSimulationDocument(),
                    request,
                    options
                ).catch((error) => {
                    nestedFailure = error
                    throw error
                })
            }
            const engine =
                boundary === 'supportsAnalysis'
                    ? {
                          supportsAnalysis: nestedOperation,
                          ...createSuccessfulEngine()
                      }
                    : { run: nestedOperation }
            const failure = await captureFailure(
                SimulationService.run(createSimulationDocument(), request, {
                    engine
                })
            )

            assert.equal(nestedFailure instanceof ToolkitError, true)
            assert.notEqual(failure, nestedFailure, `${kind} via ${boundary}`)
            assert.equal(failure.code, 'ERR_SIMULATION_RUNTIME')
            assert.equal(failure.category, 'runtime')
            assert.equal(failure.cause?.code, nestedFailure.code)
        }
    }
})
