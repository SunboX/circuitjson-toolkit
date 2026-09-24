# circuitjson-toolkit 1.4.4

Native parser worker errors now reach the client when the browser dispatches a
plain `Event` instead of an `ErrorEvent`. The transport no longer lets the
`ErrorEvent.error` getter throw while forwarding the original failure.

A regression test covers this browser event boundary. Worker protocol and
parser result contracts remain unchanged.
