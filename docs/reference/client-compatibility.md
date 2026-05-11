# Client Compatibility

ODIN Sentinel is implemented in TypeScript and runs on Node.js, but MCP clients
do not need to be TypeScript or JavaScript. Clients interact with the server
through MCP over stdio, which is JSON-RPC framed over standard input/output.

## Compatibility Contract

The server keeps the MCP boundary language-neutral:

- tools accept and return JSON-compatible values
- resources return text, JSON, Markdown, or YAML content
- no tool requires a JavaScript object prototype, class instance, or local Node-specific object
- no tool requires filesystem access from the client
- fallback protocol snapshots are returned as plain filename-to-text maps

## Rust, Zig, Go, And Native Clients

Native clients that can spawn stdio subprocesses should launch the server as a
subprocess:

```text
command: node
args: [/path/to/odin-sentinel/dist/src/bin/index.js]
transport: stdio
```

Then call normal MCP methods:

- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`

## WebAssembly Clients

WASM runtimes vary. Some can spawn subprocesses through a host capability; many
cannot. If the WASM client cannot spawn a stdio process, use one of these
patterns:

1. Host bridge: native host process runs `odin-sentinel` and exposes MCP calls
   to the WASM guest.
2. Sidecar bridge: an external local process runs `odin-sentinel` and the WASM
   client talks to the host through its supported bridge channel.
3. Snapshot fallback: call `odin.export_protocol_snapshot` from a capable host and
   provide the generated text files to the WASM agent as static context.

## Portability Limits

The current server runtime requires Node.js 20 or newer. This does not restrict
the client implementation language; it only means the machine hosting the MCP
server needs Node available.

Future options if a pure native server is needed:

- Rust MCP server using the same `protocol/` data files.
- Go MCP server using the same `protocol/` data files.
- Single-file generated JSON protocol bundle for embedded clients.
- WASI-compatible read-only server if the target runtime supports stdio.
