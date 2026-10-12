import assert from 'node:assert/strict'
import test from 'node:test'

/** Worker double that dispatches native Event instances. */
class NativeEventWorker extends EventTarget {
    static latest = null

    /** Captures the instance and consumes module options like the native host. */
    constructor(url, options) {
        super()
        this.type = options.type
        NativeEventWorker.latest = this
    }

    /** @returns {void} */
    postMessage() {}

    /** @returns {void} */
    terminate() {}
}

/** ErrorEvent double whose native-style getter rejects ordinary Events. */
class NativeErrorEvent extends Event {
    #error = null

    /** @returns {unknown} Error associated with this event. */
    get error() {
        return this.#error
    }
}

test('native transport forwards ordinary worker error events without throwing', async () => {
    const originalWorker = globalThis.Worker
    const originalErrorEvent = globalThis.ErrorEvent
    globalThis.Worker = NativeEventWorker
    globalThis.ErrorEvent = NativeErrorEvent
    try {
        const { NativeParserWorkerTransport } = await import(
            `../src/core/worker/NativeParserWorkerTransport.mjs?error-event=${Date.now()}`
        )
        const transport = NativeParserWorkerTransport.create('worker.mjs')
        const errors = []
        transport.addEventListener('error', (event) => errors.push(event))

        assert.doesNotThrow(() =>
            NativeEventWorker.latest.dispatchEvent(new Event('error'))
        )
        assert.deepEqual(errors, [{ error: null }])
        transport.terminate()
    } finally {
        globalThis.Worker = originalWorker
        globalThis.ErrorEvent = originalErrorEvent
    }
})
