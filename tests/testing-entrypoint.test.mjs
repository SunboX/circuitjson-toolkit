import assert from 'node:assert/strict'
import test from 'node:test'

import {
    ToolkitContractFixtures,
    ToolkitLoopbackWorker,
    runToolkitContract
} from '../src/testing.mjs'
import { ManufacturingService } from '../src/core/ManufacturingService.mjs'
import { Parser } from '../src/core/Parser.mjs'
import { PcbInteractionIndex } from '../src/core/PcbInteractionIndex.mjs'
import { ProjectLoader } from '../src/core/ProjectLoader.mjs'
import { SimulationService } from '../src/core/SimulationService.mjs'
import { ToolkitCapabilities } from '../src/core/ToolkitCapabilities.mjs'
import { CircuitJsonDocumentContext } from '../src/core/context/CircuitJsonDocumentContext.mjs'
import { ToolkitError } from '../src/core/contracts/ToolkitError.mjs'
import { QueryService } from '../src/core/query/QueryService.mjs'
import { BomTableRenderer } from '../src/ui/BomTableRenderer.mjs'
import { PcbSvgRenderer } from '../src/ui/PcbSvgRenderer.mjs'
import { SchematicSvgRenderer } from '../src/ui/SchematicSvgRenderer.mjs'

const CANONICAL_NAMES = [
    'Parser',
    'ProjectLoader',
    'CircuitJsonDocumentContext',
    'PcbSvgRenderer',
    'SchematicSvgRenderer',
    'BomTableRenderer',
    'PcbInteractionIndex',
    'QueryService',
    'ManufacturingService',
    'SimulationService',
    'PcbScene3dBuilder',
    'PcbScene3dPreparator',
    'ToolkitCapabilities',
    'ToolkitError'
]
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

class ContractScene3dBuilder {
    /** @returns {object} Minimal canonical scene. */
    static build() {
        return { schema: 'ecad-toolkit.scene3d.v1' }
    }
}

class ContractScene3dPreparator {
    /** @returns {Promise<object>} Minimal canonical scene. */
    static async prepare() {
        return { schema: 'ecad-toolkit.scene3d.v1' }
    }
}

/**
 * Builds one complete toolkit namespace for harness tests.
 * @param {Record<string, any>} [overrides] Canonical class overrides.
 * @returns {Record<string, any>} Toolkit namespace.
 */
function contractToolkit(overrides = {}) {
    return {
        Parser,
        ProjectLoader,
        CircuitJsonDocumentContext,
        PcbSvgRenderer,
        SchematicSvgRenderer,
        BomTableRenderer,
        PcbInteractionIndex,
        QueryService,
        ManufacturingService,
        SimulationService,
        PcbScene3dBuilder: ContractScene3dBuilder,
        PcbScene3dPreparator: ContractScene3dPreparator,
        ToolkitCapabilities,
        ToolkitError,
        ...overrides
    }
}

/** @returns {never} Canonical unavailable-operation failure. */
function unavailable() {
    throw new ToolkitError('Operation is unavailable for this format.', {
        code: 'ERR_CAPABILITY_UNAVAILABLE',
        category: 'unsupported',
        format: 'circuitjson'
    })
}

test('ToolkitContractFixtures publishes the exact canonical class list', () => {
    assert.deepEqual(
        ToolkitContractFixtures.canonicalClassNames,
        CANONICAL_NAMES
    )
    const names = ToolkitContractFixtures.canonicalClassNames
    names.push('CallerMutation')
    assert.deepEqual(
        ToolkitContractFixtures.canonicalClassNames,
        CANONICAL_NAMES
    )
})

test('ToolkitLoopbackWorker is public for shared worker parity regressions', () => {
    assert.equal(typeof ToolkitLoopbackWorker.constructorFor, 'function')
})

test('ToolkitContractFixtures supplies clone-safe source fixtures', () => {
    for (const name of ['circuitJson', 'gerber', 'altium', 'kicad']) {
        const fixture = ToolkitContractFixtures[name]()
        assert.equal(fixture.schema, 'ecad-toolkit.contract-fixture.v1')
        assert.equal(typeof fixture.parserInput.fileName, 'string')
        assert.equal(typeof fixture.parserInput.data, 'string')
        assert.deepEqual(structuredClone(fixture), fixture)
    }
    assert.equal(
        Array.isArray(ToolkitContractFixtures.circuitJsonDocument()),
        true
    )
})

test('core capability inventory covers every common behavior family', () => {
    const ids = new Set(
        ToolkitCapabilities.inventory().map((capability) => capability.id)
    )
    assert.deepEqual(
        REQUIRED_CAPABILITY_IDS.filter((id) => !ids.has(id)),
        []
    )
})

test('runToolkitContract reports every missing canonical export', async () => {
    const report = await runToolkitContract(
        {},
        {
            fixtures: ToolkitContractFixtures.circuitJson()
        }
    )
    assert.equal(report.schema, 'ecad-toolkit.contract-report.v1')
    assert.equal(report.format, 'circuitjson')
    assert.deepEqual(
        report.failures.map((failure) => failure.code),
        CANONICAL_NAMES.map(() => 'ERR_CONTRACT_EXPORT')
    )
    assert.deepEqual(
        report.failures.map((failure) => failure.check),
        CANONICAL_NAMES.map((name) => `export.${name}`)
    )
})

test('runToolkitContract executes every canonical behavior family', async () => {
    const report = await runToolkitContract(contractToolkit())
    assert.deepEqual(report.failures, [])
    assert.equal(
        report.checks.every((check) => check.status === 'passed'),
        true
    )
    assert.equal(
        report.checks.some((check) => check.id === 'renderer.pcb-bottom'),
        true
    )
    assert.equal(
        report.checks.some((check) => check.id === 'parser.async-worker'),
        true
    )
    assert.equal(
        report.checks.some((check) => check.id === 'project.loadAsync-worker'),
        true
    )
})

test('runToolkitContract validates explicit unavailable capabilities', async () => {
    const unavailableIds = new Set([
        'bom.build',
        'query.document',
        'render.schematic',
        'scene3d.prepare'
    ])
    class FormatCapabilities {
        /** @returns {object[]} Capability rows with explicit unavailable operations. */
        static inventory() {
            return ToolkitCapabilities.inventory().map((row) =>
                unavailableIds.has(row.id)
                    ? {
                          ...row,
                          status: 'unavailable',
                          reason: 'The source format has no matching data.'
                      }
                    : row
            )
        }
    }
    class UnavailableSchematicSvgRenderer {
        /** @returns {never} Typed unavailable failure. */
        static render() {
            return unavailable()
        }
    }
    class UnavailableBomTableRenderer {
        /** @returns {never} Typed unavailable failure. */
        static render() {
            return unavailable()
        }
    }
    class UnavailableQueryService {
        /** @returns {never} Typed unavailable failure. */
        static create() {
            return unavailable()
        }
    }
    class UnavailableScene3dPreparator {
        /** @returns {Promise<never>} Typed asynchronous unavailable failure. */
        static async prepare() {
            return unavailable()
        }
    }
    const report = await runToolkitContract(
        contractToolkit({
            SchematicSvgRenderer: UnavailableSchematicSvgRenderer,
            BomTableRenderer: UnavailableBomTableRenderer,
            QueryService: UnavailableQueryService,
            PcbScene3dPreparator: UnavailableScene3dPreparator,
            ToolkitCapabilities: FormatCapabilities
        })
    )

    assert.deepEqual(report.failures, [])
    for (const id of [
        'renderer.schematic',
        'renderer.bom',
        'query.document',
        'scene3d.prepare'
    ]) {
        assert.deepEqual(
            report.checks.find((check) => check.id === id),
            { id, status: 'passed' }
        )
    }
})
