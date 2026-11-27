# @trysac/dag-layout-engine

Deterministic Sugiyama layered graph layout written by hand: cycle removal, longest-path layering, barycenter plus adjacent-swap crossing reduction, overlap-free coordinate assignment and standalone SVG output.

## The Problem

Diagrams of pipelines, dependencies and state machines need a layered layout, and the usual JavaScript options are large, unmaintained or hide which heuristic produced a crossing. A small, deterministic implementation of the classic Sugiyama phases, with crossing counts exposed and no node overlaps guaranteed, lets tools render readable graphs to SVG and test the result exactly.

## Installation

Not published to npm yet. Build it from a clone, then install it from the local path:

```sh
git clone https://github.com/Trysac/u911-dag-layout-engine.git
cd u911-dag-layout-engine && npm ci && npm run build
cd ../your-project && npm install ../u911-dag-layout-engine
```

Imports keep the package name: `import { ... } from "@trysac/dag-layout-engine"`.

## Usage

```ts
import { countCrossings, layout, toSvg } from "@trysac/dag-layout-engine";

const res = layout({
  nodes: [{ id: "a", width: 40, height: 20 }, { id: "b", width: 40, height: 20 }],
  edges: [{ from: "a", to: "b" }],
});
console.log(countCrossings(res), toSvg(res));
```

## Public API

### `layout(graph, opts?)`

Computes a layout. 
- `graph`: `{ nodes: { id: string; width: number; height: number; label?: string }[]; edges: { from: string; to: string }[] }`.
- `opts`: `{ direction?: 'TB' | 'LR'; rankSep?: number; nodeSep?: number; sweeps?: number; maxNodes?: number; maxEdges?: number }`.

### `countCrossings(layout)`

Counts edge segment crossings between adjacent layers.

### `toSvg(layout)`

Generates SVG markup for the computed layout.

### Errors & Limits

- `LayoutError`: Thrown for `duplicate_node`, `unknown_node`, `self_loop`, `invalid_size`, `invalid_option`, `too_large`.
- Limits: `maxNodes` (default 2,000), `maxEdges` (default 10,000), `dummyNodes` (hard cap 100,000).

## Why not @dagrejs/dagre?

This utility is smaller, maintained, deterministic, exposes crossing counts explicitly, and guarantees no overlaps by construction, whereas legacy engines often hide the heuristic steps.

## Security

See [docs/SECURITY.md](docs/SECURITY.md).
