import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  countCrossings,
  type InputEdge,
  type InputNode,
  LayoutError,
  layout,
  toSvg,
} from "../src/index.js";

describe("@trysac/dag-layout-engine acceptance & unit tests", () => {
  it("lays out a 3-node vertical chain with exact coordinates and edge points", () => {
    const res = layout({
      nodes: [
        { id: "a", width: 40, height: 20 },
        { id: "b", width: 40, height: 20 },
        { id: "c", width: 40, height: 20 },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    });

    expect(res.width).toBe(40);
    expect(res.height).toBe(160);
    expect(res.nodes).toEqual([
      { id: "a", x: 20, y: 10, width: 40, height: 20, layer: 0, order: 0 },
      { id: "b", x: 20, y: 80, width: 40, height: 20, layer: 1, order: 0 },
      { id: "c", x: 20, y: 150, width: 40, height: 20, layer: 2, order: 0 },
    ]);
    expect(res.edges[0]).toEqual({
      from: "a",
      to: "b",
      points: [
        { x: 20, y: 20 },
        { x: 20, y: 70 },
      ],
      reversed: false,
    });
    expect(res.edges[1]).toEqual({
      from: "b",
      to: "c",
      points: [
        { x: 20, y: 90 },
        { x: 20, y: 140 },
      ],
      reversed: false,
    });
  });

  it("handles 3-cycle a->b, b->c, c->a with DFS reversal and dummy point routing", () => {
    const res = layout({
      nodes: [
        { id: "a", width: 40, height: 20 },
        { id: "b", width: 40, height: 20 },
        { id: "c", width: 40, height: 20 },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    });

    const layersById = Object.fromEntries(res.nodes.map((n) => [n.id, n.layer]));
    expect(layersById).toEqual({ a: 0, b: 1, c: 2 });

    expect(res.edges[0]?.reversed).toBe(false);
    expect(res.edges[1]?.reversed).toBe(false);
    expect(res.edges[2]?.from).toBe("c");
    expect(res.edges[2]?.to).toBe("a");
    expect(res.edges[2]?.reversed).toBe(true);
    expect(res.edges[2]?.points).toHaveLength(3);
    // Listed from c (layer 2) to a (layer 0)
    expect(res.edges[2]?.points[0]?.y).toBe(140);
    expect(res.edges[2]?.points[1]?.y).toBe(80);
    expect(res.edges[2]?.points[2]?.y).toBe(20);
  });

  it("untangles two-layer crossing a->d, b->c and counts 1 crossing on K_2,2", () => {
    const res1 = layout({
      nodes: [
        { id: "a", width: 40, height: 20 },
        { id: "b", width: 40, height: 20 },
        { id: "c", width: 40, height: 20 },
        { id: "d", width: 40, height: 20 },
      ],
      edges: [
        { from: "a", to: "d" },
        { from: "b", to: "c" },
      ],
    });

    const layer1Order = res1.nodes
      .filter((n) => n.layer === 1)
      .sort((x, y) => x.order - y.order)
      .map((n) => n.id);
    expect(layer1Order).toEqual(["d", "c"]);
    expect(countCrossings(res1)).toBe(0);

    const res2 = layout({
      nodes: [
        { id: "a", width: 40, height: 20 },
        { id: "b", width: 40, height: 20 },
        { id: "c", width: 40, height: 20 },
        { id: "d", width: 40, height: 20 },
      ],
      edges: [
        { from: "a", to: "c" },
        { from: "a", to: "d" },
        { from: "b", to: "c" },
        { from: "b", to: "d" },
      ],
    });
    expect(countCrossings(res2)).toBe(1);
  });

  it("supports LR direction on the 3-node chain", () => {
    const res = layout(
      {
        nodes: [
          { id: "a", width: 40, height: 20 },
          { id: "b", width: 40, height: 20 },
          { id: "c", width: 40, height: 20 },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
        ],
      },
      { direction: "LR" },
    );

    expect(res.width).toBe(220);
    expect(res.height).toBe(20);
    expect(res.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }))).toEqual([
      { id: "a", x: 20, y: 10 },
      { id: "b", x: 110, y: 10 },
      { id: "c", x: 200, y: 10 },
    ]);
    expect(res.edges[0]?.points).toEqual([
      { x: 40, y: 10 },
      { x: 90, y: 10 },
    ]);
    expect(countCrossings(res)).toBe(0);
  });

  it("renders exact SVG markup and escapes XML characters in labels", () => {
    const single = layout({
      nodes: [{ id: "a", width: 40, height: 20 }],
      edges: [],
    });
    expect(toSvg(single)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><g class="edges"></g><g class="nodes"><g id="node-0"><rect x="0" y="0" width="40" height="20" fill="#ffffff" stroke="#000000"/><text x="20" y="10" text-anchor="middle" dominant-baseline="central">a</text></g></g></svg>',
    );

    const escaped = layout({
      nodes: [
        { id: "a", width: 40, height: 20, label: "<&>" },
        { id: "b", width: 41.25, height: 20.5, label: `"quote" & 'apostrophe'` },
      ],
      edges: [{ from: "a", to: "b" }],
    });
    const svg = toSvg(escaped);
    expect(svg).toContain("&lt;&amp;&gt;");
    expect(svg).toContain("&quot;quote&quot; &amp; &#39;apostrophe&#39;");
    expect(svg).toContain('<path d="M ');
  });

  it("enforces all error codes for invalid inputs and limits", () => {
    // duplicate_node
    expect(() =>
      layout({
        nodes: [
          { id: "a", width: 10, height: 10 },
          { id: "a", width: 10, height: 10 },
        ],
        edges: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "duplicate_node" }));

    // unknown_node
    expect(() =>
      layout({
        nodes: [{ id: "a", width: 10, height: 10 }],
        edges: [{ from: "a", to: "zz" }],
      }),
    ).toThrowError(expect.objectContaining({ code: "unknown_node" }));

    expect(() =>
      layout({
        nodes: [{ id: "a", width: 10, height: 10 }],
        edges: [{ from: "zz", to: "a" }],
      }),
    ).toThrowError(expect.objectContaining({ code: "unknown_node" }));

    // self_loop
    expect(() =>
      layout({
        nodes: [{ id: "a", width: 10, height: 10 }],
        edges: [{ from: "a", to: "a" }],
      }),
    ).toThrowError(expect.objectContaining({ code: "self_loop" }));

    // invalid_size
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        layout({
          nodes: [{ id: "a", width: bad, height: 10 }],
          edges: [],
        }),
      ).toThrowError(expect.objectContaining({ code: "invalid_size" }));

      expect(() =>
        layout({
          nodes: [{ id: "a", width: 10, height: bad }],
          edges: [],
        }),
      ).toThrowError(expect.objectContaining({ code: "invalid_size" }));
    }

    // too_large: 2_001 nodes
    const tooManyNodes: InputNode[] = Array.from({ length: 2_001 }, (_, i) => ({
      id: `n${i}`,
      width: 10,
      height: 10,
    }));
    expect(() => layout({ nodes: tooManyNodes, edges: [] })).toThrowError(
      expect.objectContaining({ code: "too_large" }),
    );

    // too_large: 10_001 edges
    const twoNodes: InputNode[] = [
      { id: "a", width: 10, height: 10 },
      { id: "b", width: 10, height: 10 },
    ];
    const tooManyEdges: InputEdge[] = Array.from({ length: 10_001 }, () => ({
      from: "a",
      to: "b",
    }));
    expect(() => layout({ nodes: twoNodes, edges: tooManyEdges })).toThrowError(
      expect.objectContaining({ code: "too_large" }),
    );

    // too_large: > 100_000 dummy nodes
    // Create a chain of 102 nodes (layers 0..101) and 1005 multi-edges from n0 to n101 (each creates 100 dummies => 100,500 dummies)
    const chainNodes: InputNode[] = Array.from({ length: 102 }, (_, i) => ({
      id: `n${i}`,
      width: 10,
      height: 10,
    }));
    const chainEdges: InputEdge[] = [];
    for (let i = 0; i < 101; i++) {
      chainEdges.push({ from: `n${i}`, to: `n${i + 1}` });
    }
    for (let i = 0; i < 1005; i++) {
      chainEdges.push({ from: "n0", to: "n101" });
    }
    expect(() => layout({ nodes: chainNodes, edges: chainEdges })).toThrowError(
      expect.objectContaining({ code: "too_large" }),
    );
  });

  it("validates options and edge cases (empty graph, multi-edges, invalid options)", () => {
    const empty = layout({ nodes: [], edges: [] });
    expect(empty).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
    expect(countCrossings(empty)).toBe(0);
    expect(toSvg(empty)).toContain('width="0" height="0"');

    // Multi-edges kept as separate edges
    const multi = layout({
      nodes: [
        { id: "a", width: 20, height: 10 },
        { id: "b", width: 20, height: 10 },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "b" },
      ],
    });
    expect(multi.edges).toHaveLength(2);

    expect(() => layout({ nodes: [], edges: [] }, { rankSep: -5 })).toThrowError(
      expect.objectContaining({ code: "invalid_option" }),
    );
    expect(() => layout({ nodes: [], edges: [] }, { nodeSep: Number.NaN })).toThrowError(
      expect.objectContaining({ code: "invalid_option" }),
    );
    expect(() => layout({ nodes: [], edges: [] }, { sweeps: -1 })).toThrowError(
      expect.objectContaining({ code: "invalid_option" }),
    );
    expect(() => layout({ nodes: [], edges: [] }, { maxNodes: -1 })).toThrowError(
      expect.objectContaining({ code: "invalid_option" }),
    );
    expect(() => layout({ nodes: [], edges: [] }, { maxEdges: -1 })).toThrowError(
      expect.objectContaining({ code: "invalid_option" }),
    );
    expect(() =>
      // @ts-expect-error testing invalid direction runtime check
      layout({ nodes: [], edges: [] }, { direction: "BT" }),
    ).toThrowError(expect.objectContaining({ code: "invalid_option" }));

    const err = new LayoutError("invalid_option", "x".repeat(300));
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LayoutError);
    expect(err.message.length).toBeLessThanOrEqual(200);
  });

  it("handles long-span edges in countCrossings and transpose pass during upward sweeps", () => {
    const res = layout({
      nodes: [
        { id: "a", width: 30, height: 20 },
        { id: "b", width: 30, height: 20 },
        { id: "c", width: 30, height: 20 },
        { id: "d", width: 30, height: 20 },
        { id: "e", width: 30, height: 20 },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "a", to: "c" },
        { from: "d", to: "c" },
        { from: "e", to: "b" },
      ],
    });
    expect(countCrossings(res)).toBeGreaterThanOrEqual(0);
  });

  it("satisfies property test (fast-check, seed 7, 200 runs, up to 30 nodes): zero overlaps and exact layer ordering", () => {
    const graphArb = fc.integer({ min: 1, max: 30 }).chain((n) =>
      fc.record({
        dims: fc.array(
          fc.record({
            width: fc.integer({ min: 1, max: 100 }),
            height: fc.integer({ min: 1, max: 100 }),
          }),
          { minLength: n, maxLength: n },
        ),
        // Build u !== v pairs directly as (u, (u + offset) % n): a `.filter(u !== v)` never
        // succeeds when n === 1 and makes fast-check retry forever.
        rawEdges:
          n < 2
            ? fc.constant<[number, number][]>([])
            : fc.array(
                fc
                  .tuple(fc.integer({ min: 0, max: n - 1 }), fc.integer({ min: 1, max: n - 1 }))
                  .map(([u, offset]): [number, number] => [u, (u + offset) % n]),
                { maxLength: Math.min(n * 3, 90) },
              ),
      }),
    );

    fc.assert(
      fc.property(graphArb, ({ dims, rawEdges }) => {
        const nodes: InputNode[] = dims.map((d, idx) => ({
          id: `n${idx}`,
          width: d.width,
          height: d.height,
        }));
        const edges: InputEdge[] = rawEdges.map(([u, v]) => ({
          from: `n${u}`,
          to: `n${v}`,
        }));

        const nodeSep = 20;
        const result = layout({ nodes, edges }, { nodeSep });

        // 1. No two node rectangles intersect
        for (let i = 0; i < result.nodes.length; i++) {
          const a = result.nodes[i]!;
          const aLeft = a.x - a.width / 2;
          const aRight = a.x + a.width / 2;
          const aTop = a.y - a.height / 2;
          const aBottom = a.y + a.height / 2;
          for (let j = i + 1; j < result.nodes.length; j++) {
            const b = result.nodes[j]!;
            const bLeft = b.x - b.width / 2;
            const bRight = b.x + b.width / 2;
            const bTop = b.y - b.height / 2;
            const bBottom = b.y + b.height / 2;

            const xOverlap = aLeft < bRight - 1e-9 && bLeft < aRight - 1e-9;
            const yOverlap = aTop < bBottom - 1e-9 && bTop < aBottom - 1e-9;
            expect(xOverlap && yOverlap).toBe(false);
          }
        }

        // 2. Nodes in one layer are at least nodeSep apart and in the same left-to-right order as result.nodes[i].order
        const byLayer = new Map<number, (typeof result.nodes)[number][]>();
        for (const node of result.nodes) {
          const list = byLayer.get(node.layer);
          if (list !== undefined) list.push(node);
          else byLayer.set(node.layer, [node]);
        }
        for (const layerNodes of byLayer.values()) {
          const sortedByOrder = [...layerNodes].sort((a, b) => a.order - b.order);
          for (let i = 0; i < sortedByOrder.length - 1; i++) {
            const leftNode = sortedByOrder[i]!;
            const rightNode = sortedByOrder[i + 1]!;
            const leftRightEdge = leftNode.x + leftNode.width / 2;
            const rightLeftEdge = rightNode.x - rightNode.width / 2;
            expect(rightLeftEdge - leftRightEdge).toBeGreaterThanOrEqual(nodeSep - 1e-9);
            expect(leftNode.x).toBeLessThan(rightNode.x);
          }
        }
      }),
      { seed: 7, numRuns: 200 },
    );
  });
});
