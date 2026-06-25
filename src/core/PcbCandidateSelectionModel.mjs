/**
 * Normalizes PCB hit candidates for shared click, hover, and bounds workflows.
 */
export class PcbCandidateSelectionModel {
    /**
     * Returns the first component-backed candidate.
     * @param {object[]} candidates Hit-test candidates.
     * @returns {object | null}
     */
    static componentCandidate(candidates) {
        return (
            (Array.isArray(candidates) ? candidates : []).find((candidate) =>
                String(candidate?.componentKey || '').trim()
            ) || null
        )
    }

    /**
     * Returns the first net-backed candidate.
     * @param {object[]} candidates Hit-test candidates.
     * @returns {object | null}
     */
    static netCandidate(candidates) {
        return (
            (Array.isArray(candidates) ? candidates : []).find((candidate) =>
                PcbCandidateSelectionModel.netName(candidate)
            ) || null
        )
    }

    /**
     * Returns the candidate chosen for user-facing selection.
     * @param {object[]} candidates Hit-test candidates.
     * @returns {object | null}
     */
    static selectedCandidate(candidates) {
        const rows = Array.isArray(candidates) ? candidates : []
        return (
            PcbCandidateSelectionModel.componentCandidate(rows) ||
            PcbCandidateSelectionModel.netCandidate(rows) ||
            rows[0] ||
            null
        )
    }

    /**
     * Returns one candidate's net name.
     * @param {object | null} candidate Hit-test candidate.
     * @returns {string}
     */
    static netName(candidate) {
        return String(
            candidate?.netName ?? candidate?.net ?? candidate?.net_name ?? ''
        ).trim()
    }

    /**
     * Builds a normalized candidate from a primitive row.
     * @param {object} primitive Primitive row.
     * @returns {object}
     */
    static fromPrimitive(primitive) {
        return {
            role: String(primitive?.kind || ''),
            kind: String(primitive?.kind || ''),
            componentKey: String(primitive?.componentKey || ''),
            componentId: String(
                primitive?.componentId || primitive?.componentKey || ''
            ),
            netName: String(primitive?.netName || ''),
            net: String(primitive?.netName || ''),
            layer: String(primitive?.layer || ''),
            layerKey: String(primitive?.layer || ''),
            source: primitive?.source || primitive || null
        }
    }
}
