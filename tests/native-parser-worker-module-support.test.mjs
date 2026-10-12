import assert from 'node:assert/strict'
import test from 'node:test'

/** Models a browser worker host that ignores the module type option. */
class ClassicOnlyWorker extends EventTarget {
    static latest = null
    terminated = false

    /** Records the worker without interpreting unsupported constructor options. */
    constructor() {
        super()
        ClassicOnlyWorker.latest = this
    }

    /** Accepts requests as the browser host would. */
    postMessage() {}

    /** Stops the classic script before its module imports can execute. */
    terminate() {
        this.terminated = true
    }
}

/** Models WebIDL option access in a host supporting module workers. */
class ModuleWorker extends ClassicOnlyWorker {
    type = null

    /** @param {string} url Script URL. @param {object} options Worker options. */
    constructor(url, options) {
        super(url, options)
        this.type = options.type
    }
}

test('native transport stops hosts that ignore module worker options', async () => {
    const original = globalThis.Worker
    globalThis.Worker = ClassicOnlyWorker
    try {
        const { NativeParserWorkerTransport } =
            await import('../src/core/worker/NativeParserWorkerTransport.mjs?classic-only')
        assert.throws(
            () => NativeParserWorkerTransport.create('parser.worker.mjs'),
            /module workers/i
        )
        assert.equal(ClassicOnlyWorker.latest.terminated, true)
    } finally {
        globalThis.Worker = original
    }
})

test('native transport preserves module options and forwards messages on supported hosts', async () => {
    const original = globalThis.Worker
    globalThis.Worker = ModuleWorker
    try {
        const { NativeParserWorkerTransport } =
            await import('../src/core/worker/NativeParserWorkerTransport.mjs?module-host')
        const transport =
            NativeParserWorkerTransport.create('parser.worker.mjs')
        const messages = []
        transport.addEventListener('message', (event) =>
            messages.push(event.data)
        )
        ClassicOnlyWorker.latest.dispatchEvent(
            new MessageEvent('message', { data: { type: 'progress' } })
        )
        assert.equal(ClassicOnlyWorker.latest.type, 'module')
        assert.deepEqual(messages, [{ type: 'progress' }])
        transport.terminate()
        assert.equal(ClassicOnlyWorker.latest.terminated, true)
    } finally {
        globalThis.Worker = original
    }
})
