import { CircuitJsonDocument } from './CircuitJsonDocument.mjs'

const ID_FIELDS_BY_TYPE = {
    pcb_board: 'pcb_board_id',
    pcb_component: 'pcb_component_id',
    pcb_hole: 'pcb_hole_id',
    pcb_plated_hole: 'pcb_plated_hole_id',
    pcb_port: 'pcb_port_id',
    pcb_smtpad: 'pcb_smtpad_id',
    pcb_trace: 'pcb_trace_id',
    pcb_via: 'pcb_via_id',
    source_component: 'source_component_id',
    source_net: 'source_net_id',
    source_port: 'source_port_id',
    source_trace: 'source_trace_id'
}

/**
 * Builds lookup maps for CircuitJSON element arrays.
 */
export class CircuitJsonIndexer {
    /**
     * Indexes a CircuitJSON model.
     * @param {object[]} circuitJson CircuitJSON model.
     * @returns {{ elements: object[], elementsByType: Map<string, object[]>, elementsById: Map<string, object>, sourceComponentById: Map<string, object>, pcbComponentById: Map<string, object> }}
     */
    static index(circuitJson) {
        CircuitJsonDocument.assertModel(circuitJson)
        const elementsByType = new Map()
        const elementsById = new Map()
        const sourceComponentById = new Map()
        const pcbComponentById = new Map()

        circuitJson.forEach((element) => {
            const type = String(element?.type || '')
            if (!elementsByType.has(type)) {
                elementsByType.set(type, [])
            }
            elementsByType.get(type).push(element)

            const idField = ID_FIELDS_BY_TYPE[type]
            const id = idField ? String(element?.[idField] || '') : ''
            if (id) {
                elementsById.set(`${type}:${id}`, element)
            }
            if (type === 'source_component' && id) {
                sourceComponentById.set(id, element)
            }
            if (type === 'pcb_component' && id) {
                pcbComponentById.set(id, element)
            }
        })

        return {
            elements: circuitJson,
            elementsByType,
            elementsById,
            sourceComponentById,
            pcbComponentById
        }
    }
}
