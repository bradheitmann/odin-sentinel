# Distribution

ODIN Sentinel is a local stdio MCP server. The simplest public distribution is
an npm package that ships prebuilt JavaScript and protocol files.

## Recommended Install Path

```bash
npm i -g @bradheitmann/odin-sentinel
```

MCP client configuration can then use the installed binary directly:

```json
{
  "mcpServers": {
    "odin-sentinel": {
      "command": "odin-sentinel-mcp"
    }
  }
}
```

For zero-install via `npx`:

```json
{
  "mcpServers": {
    "odin-sentinel": {
      "command": "npx",
      "args": ["-y", "-p", "@bradheitmann/odin-sentinel", "odin-sentinel-mcp"]
    }
  }
}
```

## Local Clone Path

For source builds:

```bash
pnpm install
pnpm run build
node dist/src/bin/index.js
```

Then point the client at the built file:

```json
{
  "mcpServers": {
    "odin-sentinel": {
      "command": "node",
      "args": ["/absolute/path/to/odin-sentinel/dist/src/bin/index.js"]
    }
  }
}
```

## Advanced Root Override

The server normally finds its bundled `protocol/` directory automatically.

Advanced deployments can set `ODIN_SENTINEL_ROOT` to point at another checked-out
ODIN Sentinel root that contains the full `protocol/` tree. Most users do not
need this.

## Binary Strategy

A native binary is possible, but it should not be the first distribution path.
The server is small, stdio-only, and already fits the package manager workflow
most MCP clients expect.

Good future binary routes:

- Rust or Go implementation over the same `protocol/` files.
- Generated single-file protocol bundle for embedded clients.
- Homebrew formula once the public package name and release cadence are stable.

Avoid a bundled Node executable unless users ask for it. Those bundles tend to
make asset paths, source maps, and platform support more awkward than the code
deserves.
