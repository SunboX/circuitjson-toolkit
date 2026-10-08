/** Applies caller-owned UI category rules without needing a live browser stylesheet. */
export class PrintSvgOpacityRules {
    /** @param {object[]} rules Class or exact attribute selector rules. @returns {object[]} */
    static compile(rules = []) {
        return rules.map(({ selector, opacity }) => {
            const classMatch = /^\.([\w-]+)$/u.exec(selector)
            const attributeMatch =
                /^\[([\w-]+)=(?:'([^']*)'|"([^"]*)")\]$/u.exec(selector)
            if (!classMatch && !attributeMatch)
                throw new Error(
                    'Print opacity rules require a class or exact attribute selector'
                )
            if (
                typeof opacity !== 'number' ||
                !Number.isFinite(opacity) ||
                opacity < 0 ||
                opacity > 1
            )
                throw new Error('Print opacity must be between zero and one')
            return {
                opacity,
                className: classMatch?.[1],
                attribute: attributeMatch?.[1],
                value: attributeMatch?.[2] ?? attributeMatch?.[3]
            }
        })
    }

    /** @param {object} node SVG element. @param {object[]} rules Compiled rules, in cascade order. @returns {void} */
    static apply(node, rules) {
        const classes = (node.getAttribute('class') || '').split(/\s+/u)
        let opacity
        for (const rule of rules) {
            if (
                rule.className
                    ? classes.includes(rule.className)
                    : node.getAttribute(rule.attribute) === rule.value
            )
                opacity = rule.opacity
        }
        if (opacity === undefined) return
        const style = (node.getAttribute('style') || '')
            .split(';')
            .filter((part) => part && !/^\s*opacity\s*:/u.test(part))
        style.push(`opacity:${opacity} !important`)
        node.setAttribute('style', style.join(';'))
        node.setAttribute('opacity', String(opacity))
    }
}
