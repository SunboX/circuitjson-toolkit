/**
 * Resolves standard schematic text anchors for SVG and bounds geometry.
 */
export class SchematicTextAnchor {
    /**
     * Resolves one named anchor into horizontal and vertical alignment.
     * @param {unknown} value Anchor candidate.
     * @returns {{ horizontal: 'left' | 'center' | 'right', vertical: 'top' | 'center' | 'bottom' | 'baseline', textAnchor: 'start' | 'middle' | 'end', baseline: 'hanging' | 'central' | 'text-after-edge' | '' }} Alignment.
     */
    static resolve(value) {
        const text = String(value || '').toLowerCase()
        const horizontal =
            text === 'right' || text.endsWith('_right')
                ? 'right'
                : text === 'center' ||
                    text === 'middle' ||
                    text === 'top' ||
                    text === 'bottom' ||
                    text.endsWith('_center') ||
                    text.endsWith('_middle')
                  ? 'center'
                  : 'left'
        const vertical =
            text === 'top' || text.startsWith('top_')
                ? 'top'
                : text === 'bottom' || text.startsWith('bottom_')
                  ? 'bottom'
                  : text === 'center' ||
                      text === 'middle' ||
                      text === 'left' ||
                      text === 'right' ||
                      text.startsWith('center_') ||
                      text.startsWith('middle_')
                    ? 'center'
                    : 'baseline'
        return {
            horizontal,
            vertical,
            textAnchor:
                horizontal === 'right'
                    ? 'end'
                    : horizontal === 'center'
                      ? 'middle'
                      : 'start',
            baseline:
                vertical === 'top'
                    ? 'hanging'
                    : vertical === 'bottom'
                      ? 'text-after-edge'
                      : vertical === 'center'
                        ? 'central'
                        : ''
        }
    }
}
