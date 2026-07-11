import { ToolkitContractFixtures } from './ToolkitContractFixtures.mjs'
import { ToolkitLoopbackWorker } from './ToolkitLoopbackWorker.mjs'

const CAPABILITY_STATUSES = new Set([
    'native',
    'shared',
    'derived',
    'unavailable'
])
const REQUIRED_CAPABILITY_IDS = [
    'bom.build',
    'interaction.pcb',
    'manufacturing.export',
    'parse.document',
    'project.load',
    'query.document',
    'render.pcb',
    'render.schematic',
    'scene3d.build',
    'scene3d.prepare',
    'simulation.spice',
    'validation.document',
    'worker.load-project',
    'worker.parse'
]
const WORKER_OPERATIONS = { parse: 0, loadProject: 0 }

/**
 * Executes the shared high-level toolkit contract without private imports.
 * @param {Record<string, any>} toolkit Package-root namespace.
 * @param {{ fixtures?: Record<string, any> }} [options] Contract options.
 * @returns {Promise<{ schema: string, format: string, checks: object[], failures: object[] }>} Contract report.
 */
export async function runToolkitContract(toolkit, options = {}) {
    const fixtures = options.fixtures || ToolkitContractFixtures.circuitJson()
    const state = {
        checks: [],
        failures: [],
        toolkit,
        fixtures,
        document: null,
        project: null,
        context: null,
        capabilities: new Map(),
        workerOperations: WORKER_OPERATIONS
    }

    for (const name of ToolkitContractFixtures.canonicalClassNames) {
        await check(state, `export.${name}`, () => {
            requireCondition(
                typeof toolkit?.[name] === 'function',
                `Missing canonical class: ${name}.`
            )
        })
    }
    if (
        state.failures.some((failure) => failure.code === 'ERR_CONTRACT_EXPORT')
    ) {
        return report(state)
    }

    await withLoopbackWorker(state, async () => {
        await parserChecks(state)
        await projectChecks(state)
    })
    await capabilityChecks(state)
    await documentServiceChecks(state)
    await errorChecks(state)
    return report(state)
}

/** @param {Record<string, any>} state Contract state. @returns {Promise<void>} */
async function parserChecks(state) {
    const { Parser } = state.toolkit
    const input = state.fixtures.parserInput
    await check(state, 'parser.supports', () => {
        requireCondition(
            Parser.supports(input) === true,
            'Parser did not support the fixture.'
        )
    })
    await check(state, 'parser.parse', () => {
        state.document = Parser.parse(input)
        requireSchema(state.document, 'ecad-toolkit.document.v1')
        requireExactFields(state.document, [
            'schema',
            'id',
            'modelSchema',
            'model',
            'source',
            'extensions',
            'assets',
            'diagnostics',
            'statistics'
        ])
        requireCondition(
            state.document.source?.format === state.fixtures.format,
            'Document source format differs from the fixture.'
        )
    })
    await check(state, 'parser.tryParse', () => {
        const result = Parser.tryParse(input)
        requireCondition(
            result?.ok === true,
            'tryParse did not return success.'
        )
        requireSchema(result.value, 'ecad-toolkit.document.v1')
    })
    await check(state, 'parser.failure', () => {
        const result = Parser.tryParse(state.fixtures.unsupportedInput)
        requireCondition(
            result?.ok === false,
            'Unsupported input did not fail.'
        )
        requireCondition(
            result.error?.name === 'ToolkitError',
            'Parser failure is not a ToolkitError.'
        )
        requireCondition(
            Array.isArray(result.diagnostics) && result.diagnostics.length > 0,
            'Parser failure did not retain a diagnostic.'
        )
    })
    await check(state, 'parser.async-progress', async () => {
        const progress = []
        const result = await Parser.parseAsync(input, {
            worker: false,
            onProgress: (row) => progress.push(row.stage)
        })
        requireSchema(result, 'ecad-toolkit.document.v1')
        requireEquivalentResult(
            result,
            state.document,
            'Direct and async parser results differ.'
        )
        requireCondition(
            progress.at(-1) === 'complete',
            'Async parser progress did not complete.'
        )
    })
    await check(state, 'parser.async-worker', async () => {
        const before = state.workerOperations.parse
        const result = await Parser.parseAsync(input, { worker: true })
        requireSchema(result, 'ecad-toolkit.document.v1')
        requireEquivalentResult(
            result,
            state.document,
            'Worker and direct parser results differ.'
        )
        requireCondition(
            state.workerOperations.parse === before + 1,
            'Parser worker request did not cross the protocol transport.'
        )
    })
}

/** @param {Record<string, any>} state Contract state. @returns {Promise<void>} */
async function projectChecks(state) {
    const { ProjectLoader } = state.toolkit
    const entries = state.fixtures.projectEntries
    await check(state, 'project.supports', () => {
        requireCondition(
            ProjectLoader.supports(entries) === true,
            'ProjectLoader did not support the fixture.'
        )
    })
    await check(state, 'project.load', () => {
        state.project = ProjectLoader.load(entries)
        requireSchema(state.project, 'ecad-toolkit.project.v1')
        requireExactFields(state.project, [
            'schema',
            'id',
            'source',
            'documents',
            'project',
            'extensions',
            'assets',
            'diagnostics',
            'statistics'
        ])
        for (const field of [
            'entryCount',
            'candidateCount',
            'documentCount',
            'failureCount',
            'totalBytes'
        ]) {
            requireCondition(
                Number.isFinite(state.project.statistics?.[field]),
                `Project statistics omit common field: ${field}.`
            )
        }
    })
    await check(state, 'project.tryLoad-failure', () => {
        const result = ProjectLoader.tryLoad([])
        requireCondition(result?.ok === false, 'Empty project did not fail.')
        requireCondition(
            result.error?.name === 'ToolkitError',
            'Project failure is not a ToolkitError.'
        )
        requireCondition(
            Array.isArray(result.diagnostics) && result.diagnostics.length > 0,
            'Project failure did not retain a diagnostic.'
        )
    })
    await check(state, 'project.loadAsync', async () => {
        const project = await ProjectLoader.loadAsync(entries, {
            worker: false
        })
        requireSchema(project, 'ecad-toolkit.project.v1')
        requireEquivalentResult(
            project,
            state.project,
            'Direct and async project results differ.'
        )
    })
    await check(state, 'project.loadAsync-worker', async () => {
        const before = state.workerOperations.loadProject
        const project = await ProjectLoader.loadAsync(entries, {
            worker: true
        })
        requireSchema(project, 'ecad-toolkit.project.v1')
        requireEquivalentResult(
            project,
            state.project,
            'Worker and direct project results differ.'
        )
        requireCondition(
            state.workerOperations.loadProject === before + 1,
            'Project worker request did not cross the protocol transport.'
        )
    })
}

/**
 * Runs parser and project checks with an actual cloned protocol transport.
 * @param {Record<string, any>} state Contract state.
 * @param {() => Promise<void>} operation Contract checks.
 * @returns {Promise<void>}
 */
async function withLoopbackWorker(state, operation) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
    const Worker = ToolkitLoopbackWorker.constructorFor(
        state.toolkit,
        state.workerOperations
    )
    Object.defineProperty(globalThis, 'Worker', {
        configurable: true,
        value: Worker,
        writable: true
    })
    try {
        await operation()
    } finally {
        if (descriptor) {
            Object.defineProperty(globalThis, 'Worker', descriptor)
        } else {
            delete globalThis.Worker
        }
    }
}

/** @param {Record<string, any>} state Contract state. @returns {Promise<void>} */
async function documentServiceChecks(state) {
    if (!state.document) {
        addFailure(
            state,
            'services.document',
            'ERR_CONTRACT_DEPENDENCY',
            'Document services require a successful parser result.'
        )
        return
    }
    const toolkit = state.toolkit
    await check(state, 'context.reuse', () => {
        state.context = toolkit.CircuitJsonDocumentContext.prepare(
            state.document
        )
        requireCondition(
            toolkit.CircuitJsonDocumentContext.prepare(state.context) ===
                state.context,
            'Prepared context was not reused.'
        )
    })
    await check(state, 'renderer.pcb', () => {
        return capabilityOperation(
            state,
            'render.pcb',
            () =>
                toolkit.PcbSvgRenderer.render(
                    state.context || state.document,
                    state.fixtures.renderOptions.pcb
                ),
            requireSvg
        )
    })
    await check(state, 'renderer.pcb-bottom', () => {
        return capabilityOperation(
            state,
            'render.pcb',
            () =>
                toolkit.PcbSvgRenderer.render(
                    state.context || state.document,
                    state.fixtures.renderOptions.pcbBottom
                ),
            requireSvg
        )
    })
    await check(state, 'renderer.schematic', () => {
        return capabilityOperation(
            state,
            'render.schematic',
            () =>
                toolkit.SchematicSvgRenderer.render(
                    state.context || state.document,
                    state.fixtures.renderOptions.schematic
                ),
            requireSvg
        )
    })
    await check(state, 'renderer.bom', () => {
        return capabilityOperation(
            state,
            'bom.build',
            () =>
                toolkit.BomTableRenderer.render(
                    state.context || state.document
                ),
            (html) =>
                requireCondition(
                    typeof html === 'string' &&
                        (html.includes('<table') || html.includes('bom-empty')),
                    'BOM renderer did not return canonical HTML.'
                )
        )
    })
    await check(state, 'interaction.pcb', () => {
        return capabilityOperation(
            state,
            'interaction.pcb',
            () =>
                toolkit.PcbInteractionIndex.create(
                    state.context || state.document
                ).hitTest({ x: 0, y: 0 }),
            (hits) =>
                requireCondition(
                    Array.isArray(hits),
                    'PCB hit testing did not return an array.'
                )
        )
    })
    await check(state, 'query.document', () => {
        return capabilityOperation(
            state,
            'query.document',
            () =>
                toolkit.QueryService.create(
                    state.context || state.document
                ).query({ select: 'components' }),
            (query) => {
                requireSchema(query, 'ecad-toolkit.query.v1')
                requireExactFields(query, [
                    'schema',
                    'items',
                    'diagnostics',
                    'statistics'
                ])
            }
        )
    })
    await check(state, 'manufacturing.inspect', () => {
        const inspection = toolkit.ManufacturingService.inspect(
            state.context || state.document
        )
        requireSchema(inspection, 'ecad-toolkit.manufacturing.v1')
        requireExactFields(inspection, [
            'schema',
            'placements',
            'fabricationNotes',
            'exports',
            'diagnostics',
            'statistics'
        ])
    })
    await check(state, 'manufacturing.unavailable', () => {
        requireUnavailable(() =>
            toolkit.ManufacturingService.export(
                state.context || state.document,
                { id: 'contract-unavailable-export' }
            )
        )
    })
    await check(state, 'simulation.build', () => {
        return capabilityOperation(
            state,
            'simulation.spice',
            () =>
                toolkit.SimulationService.build(
                    state.context || state.document
                ),
            (simulation) => {
                requireSchema(simulation, 'ecad-toolkit.simulation.v1')
                requireExactFields(simulation, [
                    'schema',
                    'circuits',
                    'analyses',
                    'models',
                    'diagnostics',
                    'statistics'
                ])
            }
        )
    })
    await check(state, 'scene3d.build', () => {
        return capabilityOperation(
            state,
            'scene3d.build',
            () =>
                toolkit.PcbScene3dBuilder.build(
                    state.context || state.document,
                    { fidelity: 'canonical' }
                ),
            (scene) => requireSchema(scene, 'ecad-toolkit.scene3d.v1')
        )
    })
    await check(state, 'scene3d.prepare', async () => {
        await capabilityOperation(
            state,
            'scene3d.prepare',
            () =>
                toolkit.PcbScene3dPreparator.prepare(
                    state.context || state.document,
                    { fidelity: 'canonical' }
                ),
            (scene) => requireSchema(scene, 'ecad-toolkit.scene3d.v1')
        )
    })
}

/** @param {Record<string, any>} state Contract state. @returns {Promise<void>} */
async function capabilityChecks(state) {
    await check(state, 'capabilities.inventory', () => {
        const rows = state.toolkit.ToolkitCapabilities.inventory()
        requireCondition(
            Array.isArray(rows) && rows.length > 0,
            'Capability inventory is empty.'
        )
        for (const row of rows) {
            requireExactFields(row, [
                'id',
                'category',
                'operation',
                'status',
                'entrypoint',
                'summary',
                'reason',
                'tested',
                'documented'
            ])
            requireCondition(
                typeof row.id === 'string' &&
                    typeof row.category === 'string' &&
                    typeof row.operation === 'string' &&
                    row.id === `${row.category}.${row.operation}` &&
                    CAPABILITY_STATUSES.has(row.status) &&
                    typeof row.entrypoint === 'string' &&
                    typeof row.summary === 'string' &&
                    typeof row.reason === 'string' &&
                    typeof row.tested === 'boolean' &&
                    typeof row.documented === 'boolean' &&
                    row.tested === true &&
                    row.documented === true &&
                    (row.status !== 'unavailable' ||
                        row.reason.trim().length > 0),
                'Capability rows are malformed.'
            )
        }
        const ids = new Set(rows.map((row) => row.id))
        requireCondition(ids.size === rows.length, 'Capability ids repeat.')
        requireCondition(
            rows
                .map((row) => row.id)
                .every((id, index, all) => index === 0 || all[index - 1] < id),
            'Capability ids are not in stable sorted order.'
        )
        requireCondition(
            REQUIRED_CAPABILITY_IDS.every((id) => ids.has(id)),
            'Capability inventory omits a common behavior family.'
        )
        state.capabilities = new Map(rows.map((row) => [row.id, row]))
        for (const id of ['parse.document', 'project.load']) {
            requireCondition(
                state.capabilities.get(id).status !== 'unavailable',
                `${id} is unavailable for its own conformance fixture.`
            )
        }
    })
}

/**
 * Executes an available operation or verifies its typed unavailable failure.
 * @param {Record<string, any>} state Contract state.
 * @param {string} capabilityId Required capability id.
 * @param {() => any | Promise<any>} operation Operation under test.
 * @param {(value: any) => void | Promise<void>} validate Available-result validator.
 * @returns {Promise<void>}
 */
async function capabilityOperation(state, capabilityId, operation, validate) {
    const capability = state.capabilities.get(capabilityId)
    requireCondition(
        Boolean(capability),
        `Capability inventory omits ${capabilityId}.`
    )
    if (capability.status === 'unavailable') {
        await requireUnavailableAsync(operation)
        return
    }
    await validate(await operation())
}

/** @param {Record<string, any>} state Contract state. @returns {Promise<void>} */
async function errorChecks(state) {
    await check(state, 'error.serialization', () => {
        const error = new state.toolkit.ToolkitError('Contract failure.', {
            code: 'ERR_CONTRACT_PROBE',
            category: 'validation',
            format: state.fixtures.format
        })
        const serialized = error.toJSON()
        requireCondition(
            error.name === 'ToolkitError' &&
                serialized.code === 'ERR_CONTRACT_PROBE' &&
                serialized.category === 'validation',
            'ToolkitError did not preserve canonical fields.'
        )
    })
}

/**
 * Runs one check and appends a clone-safe failure instead of throwing.
 * @param {Record<string, any>} state Contract state.
 * @param {string} id Check id.
 * @param {() => any | Promise<any>} operation Check body.
 * @returns {Promise<void>}
 */
async function check(state, id, operation) {
    try {
        await operation()
        state.checks.push({ id, status: 'passed' })
    } catch (error) {
        const exportFailure = id.startsWith('export.')
        addFailure(
            state,
            id,
            exportFailure ? 'ERR_CONTRACT_EXPORT' : 'ERR_CONTRACT_EXECUTION',
            safeErrorMessage(error)
        )
    }
}

/**
 * Adds one deterministic failure and matching failed check.
 * @param {Record<string, any>} state Contract state.
 * @param {string} id Check id.
 * @param {string} code Failure code.
 * @param {string} message Failure message.
 * @returns {void}
 */
function addFailure(state, id, code, message) {
    state.checks.push({ id, status: 'failed' })
    state.failures.push({ code, check: id, message })
}

/** @param {unknown} value Value. @param {string} message Message. @returns {void} */
function requireCondition(value, message) {
    if (!value) throw new Error(message)
}

/** @param {unknown} value Value. @param {string} schema Schema. @returns {void} */
function requireSchema(value, schema) {
    requireCondition(value?.schema === schema, `Expected schema ${schema}.`)
}

/**
 * Requires the exact enumerable top-level result shape.
 * @param {unknown} value Result candidate.
 * @param {string[]} fields Expected own enumerable fields.
 * @returns {void}
 */
function requireExactFields(value, fields) {
    requireCondition(
        value !== null && typeof value === 'object',
        'Expected a result object.'
    )
    const actual = Object.keys(value).sort()
    const expected = [...fields].sort()
    requireCondition(
        actual.length === expected.length &&
            actual.every((field, index) => field === expected[index]),
        `Expected result fields: ${expected.join(', ')}.`
    )
}

/**
 * Compares canonical clone-safe results by their serialized value.
 * @param {unknown} actual Actual result.
 * @param {unknown} expected Expected result.
 * @param {string} message Failure message.
 * @returns {void}
 */
function requireEquivalentResult(actual, expected, message) {
    requireCondition(
        JSON.stringify(actual) === JSON.stringify(expected),
        message
    )
}

/** @param {unknown} value SVG candidate. @returns {void} */
function requireSvg(value) {
    requireCondition(
        typeof value === 'string' && value.includes('<svg'),
        'Renderer did not return SVG text.'
    )
}

/** @param {() => unknown} operation Unavailable operation. @returns {void} */
function requireUnavailable(operation) {
    try {
        operation()
    } catch (error) {
        requireCondition(
            safeErrorCode(error) === 'ERR_CAPABILITY_UNAVAILABLE',
            'Unavailable operation used the wrong error code.'
        )
        return
    }
    throw new Error('Unavailable operation returned successfully.')
}

/**
 * Requires one synchronous or asynchronous unavailable operation failure.
 * @param {() => unknown | Promise<unknown>} operation Unavailable operation.
 * @returns {Promise<void>}
 */
async function requireUnavailableAsync(operation) {
    try {
        await operation()
    } catch (error) {
        requireCondition(
            safeErrorCode(error) === 'ERR_CAPABILITY_UNAVAILABLE',
            'Unavailable operation used the wrong error code.'
        )
        return
    }
    throw new Error('Unavailable operation returned successfully.')
}

/** @param {unknown} error Error candidate. @returns {string} Safe code. */
function safeErrorCode(error) {
    return safeDataField(error, 'code', '')
}

/** @param {unknown} error Error candidate. @returns {string} Safe message. */
function safeErrorMessage(error) {
    return safeDataField(error, 'message', 'Toolkit contract check failed.')
}

/**
 * Reads one bounded primitive error field without invoking accessors.
 * @param {unknown} value Owner candidate.
 * @param {string} key Field name.
 * @param {string} fallback Fallback text.
 * @returns {string} Safe field text.
 */
function safeDataField(value, key, fallback) {
    if (!value || !['object', 'function'].includes(typeof value)) {
        return typeof value === 'string' ? value.slice(0, 1000) : fallback
    }
    let owner = value
    for (let depth = 0; owner && depth < 16; depth += 1) {
        let descriptor
        try {
            descriptor = Object.getOwnPropertyDescriptor(owner, key)
            owner = Object.getPrototypeOf(owner)
        } catch {
            return fallback
        }
        if (!descriptor) continue
        const field = Object.hasOwn(descriptor, 'value')
            ? descriptor.value
            : undefined
        return typeof field === 'string' ? field.slice(0, 1000) : fallback
    }
    return fallback
}

/** @param {Record<string, any>} state Contract state. @returns {Record<string, any>} Report. */
function report(state) {
    return {
        schema: 'ecad-toolkit.contract-report.v1',
        format: String(state.fixtures?.format || ''),
        checks: state.checks,
        failures: state.failures
    }
}
