/** Resolves rectangular toolkit clipping without guessing at arbitrary path geometry. */
export class PrintSvgClip {
    /** @param {object} document SVG DOM. @param {string} reference Local clip reference. @param {number[]} matrix Page matrix. @param {object} geometry Matrix/bounds operations. @returns {object} */
    static resolve(document, reference, matrix, geometry) {
        const match = /^url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)$/u.exec(reference)
        const clip =
            match &&
            Array.from(document.getElementsByTagName('clipPath')).find(
                (node) => node.getAttribute('id') === match[1]
            )
        const children =
            clip &&
            Array.from(clip.childNodes).filter((node) => node.nodeType === 1)
        if (
            !clip ||
            clip.getAttribute('clipPathUnits') === 'objectBoundingBox' ||
            children.length !== 1 ||
            (children[0].localName || children[0].nodeName) !== 'rect'
        )
            throw new Error(
                'Print text clipping requires a rectangular owner-resolved visibility layout'
            )
        const rect = children[0]
        const m = geometry.multiply(
            matrix,
            geometry.multiply(
                geometry.transform(clip.getAttribute('transform') || ''),
                geometry.transform(rect.getAttribute('transform') || '')
            )
        )
        if (
            Math.abs(m[1]) > 1e-8 ||
            Math.abs(m[2]) > 1e-8 ||
            Number(rect.getAttribute('rx') || 0) ||
            Number(rect.getAttribute('ry') || 0)
        )
            throw new Error(
                'Rotated or rounded print text clipping requires an owner-resolved visibility layout'
            )
        const box = {
            x: Number(rect.getAttribute('x') || 0),
            y: Number(rect.getAttribute('y') || 0),
            width: Number(rect.getAttribute('width') || 0),
            height: Number(rect.getAttribute('height') || 0)
        }
        if (!Object.values(box).every(Number.isFinite))
            throw new Error('Invalid text clipping bounds')
        return geometry.bounds(box, m)
    }

    /** @param {object} a Rectangle. @param {object} b Rectangle. @returns {object} */
    static intersect(a, b) {
        const x = Math.max(a.x, b.x),
            y = Math.max(a.y, b.y)
        return {
            x,
            y,
            width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
            height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y)
        }
    }

    /** @param {object} a Rectangle. @param {object} b Rectangle. @returns {boolean} */
    static overlaps(a, b) {
        return (
            b.width > 0 &&
            b.height > 0 &&
            a.x + a.width >= b.x &&
            a.x <= b.x + b.width &&
            a.y + a.height >= b.y &&
            a.y <= b.y + b.height
        )
    }
}
