import type { Node, Edge } from "@xyflow/react";
import dagre from "dagre";
import type { ArchGraph, ArchModule, ArchEdge, NodeCategory } from "@/types/graph";
import { CATEGORY_LABELS } from "@/types/graph";
import type { GroupNodeData } from "@/components/GroupNode";

export type ZoomLevel = "collapsed" | "compact" | "detailed";

export function getZoomLevel(zoom: number): ZoomLevel {
  if (zoom < 0.45) return "collapsed";
  if (zoom < 0.75) return "compact";
  return "detailed";
}

const GROUP_NODE_WIDTH = 260;
const GROUP_NODE_HEIGHT = 120;
const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

/** Group descriptions — generated from the modules in each category */
function buildGroupDescription(members: ArchModule[]): string {
  if (members.length === 1) return members[0].responsibility;
  // Combine first 2 responsibilities into a summary-ish string
  return members
    .slice(0, 2)
    .map((m) => m.name)
    .join(", ") + (members.length > 2 ? ` and ${members.length - 2} more` : "");
}

/** Group label — use the category label, or a custom name for common groupings */
const GROUP_LABELS: Partial<Record<NodeCategory, string>> = {
  core: "Core System",
  voice: "Voice Input Pipeline",
  visual: "Visual / UI Layer",
  "api-client": "AI / API Clients",
  proxy: "API Proxy",
  external: "External Services",
  utility: "Utilities",
  data: "Data Layer",
  config: "Configuration",
};

/**
 * Build collapsed-level graph: merge nodes by category into group nodes,
 * rewire edges to point to groups.
 */
export function buildCollapsedGraph(graph: ArchGraph): { nodes: Node[]; edges: Edge[] } {
  // Group modules by category
  const groups = new Map<NodeCategory, ArchModule[]>();
  for (const mod of graph.modules) {
    const list = groups.get(mod.category) ?? [];
    list.push(mod);
    groups.set(mod.category, list);
  }

  // Build a lookup: module ID → group (category) ID
  const moduleToGroup = new Map<string, string>();
  for (const mod of graph.modules) {
    moduleToGroup.set(mod.id, `group-${mod.category}`);
  }

  // Create group nodes
  const groupNodes: Node[] = [];
  for (const [category, members] of groups) {
    const groupId = `group-${category}`;
    const totalLines = members.reduce((sum, m) => sum + (m.lineCount ?? 0), 0);

    const data: GroupNodeData = {
      category,
      label: GROUP_LABELS[category] ?? CATEGORY_LABELS[category],
      description: buildGroupDescription(members),
      memberCount: members.length,
      members,
      totalLines,
    };

    groupNodes.push({
      id: groupId,
      type: "groupNode",
      position: { x: 0, y: 0 }, // will be set by dagre
      data,
    });
  }

  // Rewire edges: remap source/target to group IDs, deduplicate
  const seenEdges = new Set<string>();
  const groupEdges: Edge[] = [];

  for (const edge of graph.edges) {
    const fromGroup = moduleToGroup.get(edge.from) ?? edge.from;
    const toGroup = moduleToGroup.get(edge.to) ?? edge.to;

    // Skip self-loops (both modules in same group)
    if (fromGroup === toGroup) continue;

    const key = `${fromGroup}->${toGroup}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);

    groupEdges.push({
      id: `ge-${groupEdges.length}`,
      source: fromGroup,
      target: toGroup,
      type: "default",
      animated: edge.type === "dataflow",
      style: {
        stroke: edge.type === "dataflow" ? "#7aa2f7" : "#5a6080",
        strokeWidth: edge.type === "dataflow" ? 2.5 : 1.8,
        strokeDasharray: edge.type === "weak" ? "6 3" : undefined,
      },
    });
  }

  // Layout with dagre
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 80, ranksep: 100, marginx: 40, marginy: 40 });

  for (const node of groupNodes) {
    g.setNode(node.id, { width: GROUP_NODE_WIDTH, height: GROUP_NODE_HEIGHT });
  }
  for (const edge of groupEdges) {
    g.setEdge(edge.source, edge.target);
  }
  dagre.layout(g);

  for (const node of groupNodes) {
    const pos = g.node(node.id);
    node.position = { x: pos.x - GROUP_NODE_WIDTH / 2, y: pos.y - GROUP_NODE_HEIGHT / 2 };
  }

  return { nodes: groupNodes, edges: groupEdges };
}

/**
 * Build expanded (compact or detailed) graph — individual nodes.
 * The ArchNode component itself handles compact vs detailed rendering via useViewport().
 */
export function buildExpandedGraph(graph: ArchGraph): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80, marginx: 40, marginy: 40 });

  for (const mod of graph.modules) {
    g.setNode(mod.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of graph.edges) {
    g.setEdge(edge.from, edge.to);
  }
  dagre.layout(g);

  const nodes: Node[] = graph.modules.map((mod) => {
    const pos = g.node(mod.id);
    return {
      id: mod.id,
      type: "archNode",
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: { module: mod },
    };
  });

  const edges: Edge[] = graph.edges.map((edge: ArchEdge, i: number) => ({
    id: `e-${i}`,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    type: "default",
    animated: edge.type === "dataflow",
    style: {
      stroke:
        edge.type === "weak"
          ? "#3a3a55"
          : edge.type === "dataflow"
          ? "#7aa2f7"
          : "#5a6080",
      strokeWidth: edge.type === "dataflow" ? 2.5 : 1.5,
      strokeDasharray: edge.type === "weak" ? "6 3" : undefined,
    },
    labelStyle: { fill: "#888", fontSize: 10 },
  }));

  return { nodes, edges };
}
