import { CircuitJsonDocumentContext } from './context/CircuitJsonDocumentContext.mjs'
import { ToolkitDiagnostic } from './contracts/ToolkitDiagnostic.mjs'
import { ToolkitError } from './contracts/ToolkitError.mjs'
import { ToolkitProgress } from './contracts/ToolkitProgress.mjs'
import { SimulationParameterCloner } from './simulation/SimulationParameterCloner.mjs'
import { SpiceSimulationService } from './spice/SpiceSimulationService.mjs'

const MODEL_TYPES = new Set([
    'simulation_current_probe',
    'simulation_current_source',
    'simulation_op_amp',
    'simulation_oscilloscope_trace',
    'simulation_switch',
    'simulation_voltage_probe',
    'simulation_voltage_source'
])
const EXPORT = {
    id: 'simulation-circuitjson-json',
    format: 'json',
    mediaType: 'application/json;charset=utf-8',
    fileExtension: '.json'
}
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(
    AbortSignal.prototype,
    'aborted'
)?.get
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener
const APPLY = Reflect.apply

/**
 * Exposes data-only simulation discovery, export, and injected execution.
 */
export class SimulationService {
    /**
     * Builds a canonical simulation definition from CircuitJSON rows.
     * @param {unknown} document DocumentInput or prepared context.
     * @param {Record<string, any>} [options] Reserved build options.
     * @returns {{ schema: string, circuits: object[], analyses: object[], models: object[], diagnostics: object[], statistics: object }} Simulation definition.
     */
    static build(document, options = {}) {
        const context = SimulationService.#context(document, options)
        return SimulationService.#definition(context)
    }

    /**
     * Exports one canonical simulation definition file.
     * @param {unknown} document DocumentInput or prepared context.
     * @param {Record<string, any>} request Export request.
     * @param {Record<string, any>} [options] Reserved build options.
     * @returns {{ fileName: string, mediaType: string, data: string, diagnostics: object[] }} File result.
     */
    static export(document, request, options = {}) {
        const normalized = SimulationService.#exportRequest(request)
        const context = SimulationService.#context(document, options)
        const built = SimulationService.#built(context)
        const capability = SimulationService.#exports(built).find(
            (entry) => entry.id === normalized.id
        )
        if (!capability || capability.status !== 'available') {
            throw SimulationService.#unavailable(capability?.reason)
        }
        const simulation = SimulationService.#definition(context)
        return {
            fileName:
                SimulationService.#fileBase(context.source.fileName) +
                '-circuitjson.json',
            mediaType: capability.mediaType,
            data: JSON.stringify(simulation, null, 2) + '\n',
            diagnostics: structuredClone(simulation.diagnostics)
        }
    }

    /**
     * Runs one analysis only through an explicitly injected engine.
     * @param {unknown} document DocumentInput or prepared context.
     * @param {Record<string, any>} request Analysis request.
     * @param {{ engine?: object, signal?: AbortSignal, onProgress?: Function }} [options] Execution dependencies.
     * @returns {Promise<{ schema: string, status: string, traces: object[], measurements: object, diagnostics: object[], statistics: object }>} Simulation result.
     */
    static async run(document, request, options = {}) {
        const normalizedRequest = SimulationService.#runRequest(request)
        const normalizedOptions = SimulationService.#runOptions(options)
        const engine = normalizedOptions.engine
        const run = SimulationService.#method(engine, 'run')
        const simulate = SimulationService.#method(engine, 'simulate')
        if (!run && !simulate) throw SimulationService.#unavailable()
        SimulationService.#throwIfAborted(normalizedOptions.signal)
        let progress = SimulationService.#progress(
            normalizedOptions.onProgress,
            {
                stage: 'detect',
                detail: 'simulation-request',
                completed: 0,
                total: 4
            },
            null
        )
        SimulationService.#throwIfAborted(normalizedOptions.signal)

        const context = SimulationService.#context(document, {})
        const simulation = SimulationService.build(context)
        const analysis = simulation.analyses.find(
            (entry) =>
                String(entry.simulation_experiment_id || '') ===
                normalizedRequest.analysisId
        )
        if (!analysis) {
            throw SimulationService.#unavailable(
                'The requested simulation analysis is unavailable.'
            )
        }
        progress = SimulationService.#progress(
            normalizedOptions.onProgress,
            {
                stage: 'decode',
                detail: 'simulation-definition',
                completed: 1,
                total: 4
            },
            progress
        )
        SimulationService.#throwIfAborted(normalizedOptions.signal)
        const supports = SimulationService.#method(engine, 'supportsAnalysis')
        let supported = true
        if (supports) {
            const supportAnalysis = structuredClone(analysis)
            const supportParameters = structuredClone(
                normalizedRequest.parameters
            )
            const operation = SimulationService.#invokeEngine(() =>
                supports(supportAnalysis, supportParameters, {
                    signal: normalizedOptions.signal
                })
            )
            supported = await SimulationService.#raceWithAbort(
                operation,
                normalizedOptions.signal
            )
        }
        if (!supported) {
            throw SimulationService.#unavailable(
                'The injected engine does not support this analysis.'
            )
        }
        SimulationService.#throwIfAborted(normalizedOptions.signal)
        progress = SimulationService.#progress(
            normalizedOptions.onProgress,
            {
                stage: 'project',
                detail: 'simulation-execution',
                completed: 2,
                total: 4
            },
            progress
        )
        SimulationService.#throwIfAborted(normalizedOptions.signal)

        const engineRequest = run
            ? {
                  schema: 'ecad-toolkit.simulation-run.v1',
                  document: context.model,
                  simulation,
                  analysis: structuredClone(analysis),
                  analysisId: normalizedRequest.analysisId,
                  parameters: structuredClone(normalizedRequest.parameters),
                  signal: normalizedOptions.signal
              }
            : null
        const operation = run
            ? SimulationService.#invokeEngine(() => run(engineRequest))
            : SimulationService.#simulate(engine, normalizedRequest.parameters)
        const raw = await SimulationService.#raceWithAbort(
            operation,
            normalizedOptions.signal
        )
        SimulationService.#throwIfAborted(normalizedOptions.signal)
        progress = SimulationService.#progress(
            normalizedOptions.onProgress,
            {
                stage: 'validate',
                detail: 'simulation-result',
                completed: 3,
                total: 4
            },
            progress
        )
        SimulationService.#throwIfAborted(normalizedOptions.signal)
        const result = SimulationService.#result(raw, context)
        SimulationService.#progress(
            normalizedOptions.onProgress,
            {
                stage: 'complete',
                detail: 'simulation-result',
                completed: 4,
                total: 4
            },
            progress
        )
        return result
    }

    /**
     * Builds a detached canonical simulation definition from cached families.
     * @param {CircuitJsonDocumentContext} context Prepared context.
     * @returns {{ schema: string, circuits: object[], analyses: object[], models: object[], diagnostics: object[], statistics: object }} Simulation definition.
     */
    static #definition(context) {
        const built = SimulationService.#built(context)
        return {
            schema: 'ecad-toolkit.simulation.v1',
            circuits: structuredClone(built.circuits),
            analyses: structuredClone(built.analyses),
            models: structuredClone(built.models),
            diagnostics: structuredClone(built.diagnostics),
            statistics: SimulationService.#statistics(context)
        }
    }

    /**
     * Builds the request-scoped internal simulation families.
     * @param {CircuitJsonDocumentContext} context Prepared context.
     * @returns {Record<string, any>} Internal simulation definition.
     */
    static #built(context) {
        return context.getOrCreateDerived('simulation', 'build-v1', () => {
            const elements = context.getIndex('elements').elements || []
            const simulationRows = elements.filter((element) =>
                String(element.type || '').startsWith('simulation_')
            )
            return {
                circuits: simulationRows.filter(
                    (element) => element.type === 'simulation_spice_subcircuit'
                ),
                analyses: simulationRows.filter(
                    (element) => element.type === 'simulation_experiment'
                ),
                models: simulationRows.filter((element) =>
                    MODEL_TYPES.has(element.type)
                ),
                diagnostics: simulationRows
                    .filter((element) =>
                        /(?:error|warning)/u.test(String(element.type || ''))
                    )
                    .map((element) =>
                        ToolkitDiagnostic.create({
                            severity: String(element.type).includes('warning')
                                ? 'warning'
                                : 'error',
                            code: String(
                                element.error_type ||
                                    element.warning_type ||
                                    element.type ||
                                    'simulation_diagnostic'
                            ),
                            message: String(
                                element.message || 'Simulation diagnostic.'
                            )
                        })
                    )
            }
        })
    }

    /**
     * Prepares one context and element index.
     * @param {unknown} document Document input.
     * @param {unknown} options Reserved options.
     * @returns {CircuitJsonDocumentContext} Prepared context.
     */
    static #context(document, options) {
        SimulationService.#record(options, new Set())
        try {
            return CircuitJsonDocumentContext.prepare(document, {
                indexes: ['elements']
            })
        } catch (error) {
            throw ToolkitError.from(error, {
                code: 'ERR_SIMULATION_DOCUMENT',
                category: 'validation',
                format: 'circuitjson'
            })
        }
    }

    /**
     * Builds simulation export availability rows.
     * @param {Record<string, any>} built Internal simulation definition.
     * @returns {object[]} Export capability rows.
     */
    static #exports(built) {
        const available =
            built.circuits.length ||
            built.analyses.length ||
            built.models.length
        return [
            {
                ...EXPORT,
                status: available ? 'available' : 'unavailable',
                reason: available
                    ? ''
                    : 'No simulation definition is available.'
            }
        ]
    }

    /**
     * Normalizes one simulation export request.
     * @param {unknown} request Request candidate.
     * @returns {{ id: string, options: object }} Request.
     */
    static #exportRequest(request) {
        const normalized = SimulationService.#record(
            request,
            new Set(['id', 'options'])
        )
        if (
            typeof normalized.id !== 'string' ||
            !normalized.id.trim() ||
            normalized.id.length > 256
        ) {
            throw SimulationService.#requestError(
                'Simulation export id must be a bounded string.'
            )
        }
        return {
            id: normalized.id.trim(),
            options: SimulationService.#record(
                normalized.options ?? {},
                new Set()
            )
        }
    }

    /**
     * Normalizes one analysis request.
     * @param {unknown} request Request candidate.
     * @returns {{ analysisId: string, parameters: object }} Request.
     */
    static #runRequest(request) {
        const normalized = SimulationService.#record(
            request,
            new Set(['analysisId', 'parameters'])
        )
        if (
            typeof normalized.analysisId !== 'string' ||
            !normalized.analysisId.trim() ||
            normalized.analysisId.length > 256
        ) {
            throw SimulationService.#requestError(
                'Simulation analysisId must be a bounded string.'
            )
        }
        const parameters = SimulationService.#cloneRecord(
            normalized.parameters ?? {}
        )
        return { analysisId: normalized.analysisId.trim(), parameters }
    }

    /**
     * Normalizes injected execution dependencies without invoking accessors.
     * @param {unknown} options Options candidate.
     * @returns {{ engine: object | null, signal: AbortSignal | null, onProgress: Function | null }} Options.
     */
    static #runOptions(options) {
        const normalized = SimulationService.#record(
            options,
            new Set(['engine', 'signal', 'onProgress'])
        )
        if (
            normalized.onProgress !== undefined &&
            typeof normalized.onProgress !== 'function'
        ) {
            throw SimulationService.#requestError(
                'Simulation onProgress must be a function.'
            )
        }
        if (
            normalized.signal !== undefined &&
            normalized.signal !== null &&
            !SimulationService.#isAbortSignal(normalized.signal)
        ) {
            throw SimulationService.#requestError(
                'Simulation signal must be an AbortSignal.'
            )
        }
        return {
            engine: normalized.engine || null,
            signal: normalized.signal || null,
            onProgress: normalized.onProgress || null
        }
    }

    /**
     * Brand-checks an AbortSignal through its built-in state getter.
     * @param {unknown} value Signal candidate.
     * @returns {boolean} Whether the value owns AbortSignal internal state.
     */
    static #isAbortSignal(value) {
        try {
            return (
                typeof ABORTED_GETTER === 'function' &&
                typeof ABORTED_GETTER.call(value) === 'boolean'
            )
        } catch {
            return false
        }
    }

    /**
     * Reads cancellation state through the built-in AbortSignal getter.
     * @param {AbortSignal | null} signal Validated signal.
     * @returns {boolean} Whether cancellation was requested.
     */
    static #isAborted(signal) {
        if (!signal) return false
        try {
            return ABORTED_GETTER.call(signal)
        } catch {
            throw SimulationService.#requestError(
                'Simulation signal could not be inspected safely.'
            )
        }
    }

    /**
     * Races pending engine work against a genuine AbortSignal.
     * @param {unknown} operation Promise or result to observe.
     * @param {AbortSignal | null} signal Validated signal.
     * @returns {Promise<unknown>} Operation result or typed cancellation.
     */
    static #raceWithAbort(operation, signal) {
        const pending = Promise.resolve(operation)
        if (!signal) return pending
        if (SimulationService.#isAborted(signal)) {
            pending.catch(() => {})
            return Promise.reject(SimulationService.#cancelled())
        }

        return new Promise((resolve, reject) => {
            let settled = false
            let listening = false
            const cleanup = () => {
                if (!listening) return
                REMOVE_EVENT_LISTENER.call(signal, 'abort', onAbort)
                listening = false
            }
            const settle = (callback, value) => {
                if (settled) return
                settled = true
                cleanup()
                callback(value)
            }
            const onAbort = () => settle(reject, SimulationService.#cancelled())

            pending.then(
                (value) => settle(resolve, value),
                (error) => settle(reject, error)
            )
            try {
                ADD_EVENT_LISTENER.call(signal, 'abort', onAbort, {
                    once: true
                })
                listening = true
                if (SimulationService.#isAborted(signal)) onAbort()
            } catch (error) {
                settle(
                    reject,
                    ToolkitError.from(error, {
                        code: 'ERR_SIMULATION_REQUEST',
                        category: 'validation',
                        format: 'circuitjson'
                    })
                )
            }
        })
    }

    /**
     * Copies a bounded plain parameter record into isolated data.
     * @param {unknown} value Parameter candidate.
     * @returns {object} Clone-safe parameters.
     */
    static #cloneRecord(value) {
        return SimulationParameterCloner.cloneRecord(value)
    }

    /**
     * Reads an accessor-free plain record.
     * @param {unknown} value Record candidate.
     * @param {Set<string>} allowed Allowed keys.
     * @returns {Record<string, any>} Safe shallow copy.
     */
    static #record(value, allowed) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw SimulationService.#requestError(
                'Simulation options must be a plain object.'
            )
        }
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            throw SimulationService.#requestError(
                'Simulation options could not be inspected safely.'
            )
        }
        if (prototype !== Object.prototype && prototype !== null) {
            throw SimulationService.#requestError(
                'Simulation options must be a plain object.'
            )
        }
        const result = {}
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = descriptors[key]
            if (
                typeof key !== 'string' ||
                !allowed.has(key) ||
                descriptor.enumerable !== true ||
                descriptor.get ||
                descriptor.set
            ) {
                throw SimulationService.#requestError(
                    'Simulation options contain an unsupported field.'
                )
            }
            result[key] = descriptor.value
        }
        return result
    }

    /**
     * Resolves one data method without executing accessor properties.
     * @param {unknown} target Method owner.
     * @param {string} name Method name.
     * @returns {Function | null} Bound method.
     */
    static #method(target, name) {
        if (!target || !['object', 'function'].includes(typeof target)) {
            return null
        }
        let owner = target
        for (let depth = 0; owner && depth < 16; depth += 1) {
            let descriptor
            try {
                descriptor = Object.getOwnPropertyDescriptor(owner, name)
                owner = Object.getPrototypeOf(owner)
            } catch {
                return null
            }
            if (!descriptor) continue
            if (descriptor.get || descriptor.set) return null
            if (typeof descriptor.value !== 'function') return null
            const method = descriptor.value
            return (...args) => APPLY(method, target, args)
        }
        return null
    }

    /**
     * Normalizes every value rejected across one injected callable boundary.
     * @param {Function} invoke Deferred injected callable invocation.
     * @returns {Promise<unknown>} Injected operation result.
     */
    static async #invokeEngine(invoke) {
        try {
            return await invoke()
        } catch (error) {
            throw SimulationService.#engineFailure(error)
        }
    }

    /**
     * Runs a legacy injected SPICE engine with an explicit netlist parameter.
     * @param {object} engine Injected simulation engine.
     * @param {Record<string, any>} parameters Analysis parameters.
     * @returns {Promise<object>} Legacy simulation result.
     */
    static async #simulate(engine, parameters) {
        const spiceString = parameters.spiceString
        if (
            typeof spiceString !== 'string' ||
            !spiceString.trim() ||
            spiceString.length > 10_000_000
        ) {
            throw SimulationService.#unavailable(
                'The injected SPICE engine requires parameters.spiceString.'
            )
        }
        return new SpiceSimulationService({ engine }).simulate(spiceString)
    }

    /**
     * Normalizes a generic or legacy engine result.
     * @param {unknown} raw Engine result.
     * @param {CircuitJsonDocumentContext} context Prepared context.
     * @returns {Record<string, any>} Canonical simulation result.
     */
    static #result(raw, context) {
        if (!raw || typeof raw !== 'object') {
            throw new ToolkitError('Simulation engine returned no result.', {
                code: 'ERR_SIMULATION_RESULT',
                category: 'runtime',
                format: 'circuitjson'
            })
        }
        let traces
        let measurements
        let diagnostics
        let status
        try {
            traces = structuredClone(
                raw.traces ?? raw.simulationResultCircuitJson ?? []
            )
            measurements = structuredClone(
                raw.measurements ?? raw.graphSummary ?? {}
            )
            const diagnosticRows = raw.diagnostics ?? []
            if (!Array.isArray(diagnosticRows)) {
                throw new TypeError('Simulation diagnostics must be an array.')
            }
            diagnostics = []
            for (let index = 0; index < diagnosticRows.length; index += 1) {
                diagnostics.push(
                    ToolkitDiagnostic.create(diagnosticRows[index])
                )
            }
            const inferredStatus = diagnostics.some(
                (entry) => entry.severity === 'error'
            )
                ? 'failed'
                : 'success'
            status = String(raw.status || inferredStatus)
        } catch {
            throw new ToolkitError(
                'Simulation engine result must be clone-safe data.',
                {
                    code: 'ERR_SIMULATION_RESULT',
                    category: 'runtime',
                    format: 'circuitjson'
                }
            )
        }
        if (
            !Array.isArray(traces) ||
            !Array.isArray(diagnostics) ||
            !measurements ||
            typeof measurements !== 'object' ||
            Array.isArray(measurements)
        ) {
            throw new ToolkitError('Simulation engine result is malformed.', {
                code: 'ERR_SIMULATION_RESULT',
                category: 'runtime',
                format: 'circuitjson'
            })
        }
        if (!['success', 'failed', 'cancelled'].includes(status)) {
            throw new ToolkitError('Simulation status is invalid.', {
                code: 'ERR_SIMULATION_RESULT',
                category: 'runtime',
                format: 'circuitjson'
            })
        }
        return {
            schema: 'ecad-toolkit.simulation-result.v1',
            status,
            traces,
            measurements,
            diagnostics,
            statistics: {
                ...SimulationService.#statistics(context),
                engineRuns: 1
            }
        }
    }

    /**
     * Emits one canonical progress event.
     * @param {Function | null} callback Progress callback.
     * @param {Record<string, any>} fields Progress fields.
     * @param {Record<string, any> | null} previous Previous progress row.
     * @returns {Record<string, any> | null} Current or previous progress row.
     */
    static #progress(callback, fields, previous) {
        if (!callback) return previous
        const progress = ToolkitProgress.create(fields, previous)
        callback(progress)
        return progress
    }

    /**
     * Throws a typed cancellation when the signal is already aborted.
     * @param {AbortSignal | null} signal Abort signal.
     * @returns {void}
     */
    static #throwIfAborted(signal) {
        if (SimulationService.#isAborted(signal)) {
            throw SimulationService.#cancelled()
        }
    }

    /**
     * Builds stable context work counters.
     * @param {CircuitJsonDocumentContext} context Prepared context.
     * @returns {Record<string, number>} Statistics.
     */
    static #statistics(context) {
        const statistics = context.statistics
        return {
            validationPasses: statistics.validationPasses,
            elementIndexBuilds: statistics.indexBuilds.elements || 0,
            simulationBuilds:
                statistics.derivedBuilds['simulation:build-v1'] || 0
        }
    }

    /**
     * Creates a safe output base name.
     * @param {unknown} fileName Source file name.
     * @returns {string} File base.
     */
    static #fileBase(fileName) {
        const base = String(fileName || 'simulation')
            .replaceAll('\\', '/')
            .split('/')
            .at(-1)
            .replace(/\.[^.]+$/u, '')
            .replace(/[^a-z0-9._-]+/giu, '-')
            .replace(/^-|-$/gu, '')
        return base || 'simulation'
    }

    /**
     * Contains any injected-engine failure in a fresh runtime ToolkitError.
     * @param {unknown} error Engine failure candidate.
     * @returns {ToolkitError} Fresh normalized runtime failure.
     */
    static #engineFailure(error) {
        const cause = ToolkitError.cloneSafeCause(error)
        return new ToolkitError(cause?.message || 'Simulation engine failed.', {
            code: 'ERR_SIMULATION_RUNTIME',
            category: 'runtime',
            format: 'circuitjson',
            cause
        })
    }

    /**
     * Creates a typed request error.
     * @param {string} message Failure message.
     * @returns {ToolkitError} Typed error.
     */
    static #requestError(message) {
        return new ToolkitError(message, {
            code: 'ERR_SIMULATION_REQUEST',
            category: 'validation',
            format: 'circuitjson'
        })
    }

    /**
     * Creates an unavailable-capability error.
     * @param {string} [reason] Failure reason.
     * @returns {ToolkitError} Typed error.
     */
    static #unavailable(reason = '') {
        return new ToolkitError(
            reason || 'Simulation capability is unavailable.',
            {
                code: 'ERR_CAPABILITY_UNAVAILABLE',
                category: 'unsupported',
                format: 'circuitjson'
            }
        )
    }

    /**
     * Creates a typed cancellation error.
     * @returns {ToolkitError} Typed error.
     */
    static #cancelled() {
        return new ToolkitError('Simulation was cancelled.', {
            code: 'ERR_CANCELLED',
            category: 'cancelled',
            format: 'circuitjson'
        })
    }
}
