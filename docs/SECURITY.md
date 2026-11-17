# Security & Threat Model

`@trysac/dag-layout-engine` processes untrusted graph structures and generates SVG markup.

## Defended Threats

- **Resource Exhaustion**: The engine strictly enforces `maxNodes` (default 2,000), `maxEdges` (default 10,000), and a maximum of 100,000 dummy nodes to prevent DoS. The algorithms are iterative, avoiding stack overflows on deep graphs.
- **Injection**: `toSvg` escapes `&`, `<`, `>`, `"`, and `'` characters in node labels and IDs.
- **Reporting**: All runtime errors use `LayoutError` with truncated messages (max 200 chars) to prevent resource amplification.

## Not Defended

- No mitigation against malicious user input that is computationally expensive but within the defined `maxNodes`/`maxEdges` limits.
- The engine assumes the input graph structure is well-formed regarding node definitions (IDs must be non-empty strings).
