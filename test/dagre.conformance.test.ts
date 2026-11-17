import dagre from "@dagrejs/dagre";
import { describe, expect, it } from "vitest";
import {
  countCrossings,
  type InputEdge,
  type InputGraph,
  type InputNode,
  layout,
} from "../src/index.js";

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function generateProperLayeredGraph(seed: number): InputGraph {
  const rng = mulberry32(seed);
  const numLayers = randInt(rng, 4, 8);
  const nodes: InputNode[] = [];
  const edges: InputEdge[] = [];
  const layers: string[][] = [];

  let nodeCounter = 0;
  for (let l = 0; l < numLayers; l++) {
    const count = randInt(rng, 4, 12);
    const layerIds: string[] = [];
    for (let k = 0; k < count; k++) {
      const id = `n${nodeCounter++}`;
      nodes.push({ id, width: 40, height: 20 });
      layerIds.push(id);
    }
    layers.push(layerIds);

    if (l > 0) {
      const prevLayer = layers[l - 1]!;
      for (const id of layerIds) {
        const deg = Math.min(prevLayer.length, randInt(rng, 1, 3));
        const pool = [...prevLayer];
        for (let p = 0; p < deg; p++) {
          const pickIdx = Math.floor(rng() * pool.length);
          const pred = pool.splice(pickIdx, 1)[0]!;
          edges.push({ from: pred, to: id });
        }
      }
    }
  }

  return { nodes, edges };
}

function countDagreCrossings(graph: InputGraph): number {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: 50, nodesep: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of graph.nodes) {
    g.setNode(n.id, { width: n.width, height: n.height });
  }
  for (const e of graph.edges) {
    g.setEdge(e.from, e.to);
  }

  dagre.layout(g);

  // Group nodes by their assigned y coordinate (rank) and order by x
  const ys = Array.from(new Set(graph.nodes.map((n) => Math.round(g.node(n.id).y)))).sort(
    (a, b) => a - b,
  );
  const layerById = new Map<string, number>();
  const orderById = new Map<string, number>();

  for (let l = 0; l < ys.length; l++) {
    const targetY = ys[l]!;
    const inLayer = graph.nodes
      .filter((n) => Math.round(g.node(n.id).y) === targetY)
      .sort((a, b) => g.node(a.id).x - g.node(b.id).x);
    for (let ord = 0; ord < inLayer.length; ord++) {
      const id = inLayer[ord]!.id;
      layerById.set(id, l);
      orderById.set(id, ord);
    }
  }

  let crossings = 0;
  for (let l = 0; l < ys.length - 1; l++) {
    const segs = graph.edges.filter(
      (e) => layerById.get(e.from) === l && layerById.get(e.to) === l + 1,
    );
    for (let i = 0; i < segs.length; i++) {
      const s1 = segs[i]!;
      const u1 = orderById.get(s1.from)!;
      const v1 = orderById.get(s1.to)!;
      for (let j = i + 1; j < segs.length; j++) {
        const s2 = segs[j]!;
        const u2 = orderById.get(s2.from)!;
        const v2 = orderById.get(s2.to)!;
        if ((u1 < u2 && v1 > v2) || (u1 > u2 && v1 < v2)) {
          crossings++;
        }
      }
    }
  }
  return crossings;
}

describe("CI conformance benchmark against @dagrejs/dagre (seeds 1..50)", () => {
  it("produces zero node overlaps and total crossings <= dagre across 50 seeded proper-layered graphs", () => {
    let totalOurs = 0;
    let totalDagre = 0;

    for (let seed = 1; seed <= 50; seed++) {
      const graph = generateProperLayeredGraph(seed);
      const res = layout(graph);
      const ourCrossings = countCrossings(res);
      const dagreCrossings = countDagreCrossings(graph);

      totalOurs += ourCrossings;
      totalDagre += dagreCrossings;

      // Verify zero node overlaps
      for (let i = 0; i < res.nodes.length; i++) {
        const a = res.nodes[i]!;
        for (let j = i + 1; j < res.nodes.length; j++) {
          const b = res.nodes[j]!;
          const xOverlap =
            a.x - a.width / 2 < b.x + b.width / 2 - 1e-9 &&
            b.x - b.width / 2 < a.x + a.width / 2 - 1e-9;
          const yOverlap =
            a.y - a.height / 2 < b.y + b.height / 2 - 1e-9 &&
            b.y - b.height / 2 < a.y + a.height / 2 - 1e-9;
          expect(xOverlap && yOverlap).toBe(false);
        }
      }

      console.info(
        `[seed ${seed}] @trysac/dag-layout-engine=${ourCrossings}, dagre=${dagreCrossings}`,
      );
    }

    console.info(`[total 1..50] @trysac/dag-layout-engine=${totalOurs}, dagre=${totalDagre}`);
    expect(totalOurs).toBeLessThanOrEqual(totalDagre);
  });
});
