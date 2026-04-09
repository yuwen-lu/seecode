"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useOnViewportChange,
  ReactFlowProvider,
  type Node,
  type Edge,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ArchGraph, ArchModule, NodeCategory, PanelSelection } from "@/types/graph";
import { ArchNode } from "./ArchNode";
import { GroupNode, type GroupNodeData } from "./GroupNode";
import { DetailSlider } from "./DetailSlider";
import {
  getZoomLevel,
  buildHybridGraph,
  type ZoomLevel,
} from "@/lib/semantic-zoom";
import { useTheme } from "next-themes";

interface GraphCanvasProps {
  graph: ArchGraph;
  activeTrace: string | null;
  onSelect: (selection: PanelSelection | null) => void;
  selectedNodeId: string | null;
  panelExpandedCategory?: NodeCategory | null;
  panelOpen?: boolean;
  chatHighlights?: Set<string>;
}

const nodeTypes = {
  archNode: ArchNode,
  groupNode: GroupNode,
};

function GraphCanvasInner({
  graph,
  activeTrace,
  onSelect,
  selectedNodeId,
  panelExpandedCategory,
  panelOpen,
  chatHighlights,
}: GraphCanvasProps) {
  const { fitView } = useReactFlow();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("collapsed");
  const [locked, setLocked] = useState(true); // Default locked since we use double-click now
  const prevZoomLevel = useRef<ZoomLevel>("collapsed");

  // Track which categories are expanded (double-click to toggle)
  const [expandedCategories, setExpandedCategories] = useState<Set<NodeCategory>>(new Set());

  // Undo/redo history for expandedCategories
  const undoStack = useRef<Set<NodeCategory>[]>([]);
  const redoStack = useRef<Set<NodeCategory>[]>([]);

  // Push current state to undo stack, clear redo, then apply new state
  const pushExpansion = useCallback((next: Set<NodeCategory>) => {
    setExpandedCategories((prev) => {
      undoStack.current.push(prev);
      redoStack.current = [];
      return next;
    });
  }, []);

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [animClass, setAnimClass] = useState<"" | "react-flow--seeding" | "react-flow--morphing" | "react-flow--animating">("");
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fitViewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up pending timers on unmount
  useEffect(() => {
    return () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
      if (animTimer.current) clearTimeout(animTimer.current);
      if (fitViewTimer.current) clearTimeout(fitViewTimer.current);
    };
  }, []);

  const triggerAnimation = useCallback(() => {
    setAnimClass("react-flow--animating");
    if (animTimer.current) clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setAnimClass(""), 600);
  }, []);

  // Debounced fitView — delayed so morph animation plays first
  // Pass nodeIds to scope the fit to specific nodes, or omit to fit all
  const scheduleFitView = useCallback((nodeIds?: string[]) => {
    if (fitViewTimer.current) clearTimeout(fitViewTimer.current);
    fitViewTimer.current = setTimeout(() => {
      if (nodeIds && nodeIds.length > 0) {
        fitView({ padding: 0.15, duration: 350, nodes: nodeIds.map((id) => ({ id })) });
      } else {
        fitView({ padding: 0.12, duration: 350 });
      }
    }, 300);
  }, [fitView]);

  // All unique categories in the graph
  const allCategories = useMemo(
    () => new Set(graph.modules.map((m) => m.category)),
    [graph]
  );

  // Compute the effective expanded set based on zoom level
  const effectiveExpanded = useMemo(() => {
    if (zoomLevel === "collapsed") {
      // In collapsed mode, only show manually expanded groups
      return expandedCategories;
    }
    // In compact/detailed mode, expand everything
    return allCategories;
  }, [zoomLevel, expandedCategories, allCategories]);

  // Build the hybrid layout
  const layout = useMemo(
    () => buildHybridGraph(graph, effectiveExpanded),
    [graph, effectiveExpanded]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);

  // Watch viewport — only change zoom level if NOT locked
  useOnViewportChange({
    onChange: useCallback((viewport: Viewport) => {
      if (locked) return;
      const newLevel = getZoomLevel(viewport.zoom);
      if (newLevel !== prevZoomLevel.current) {
        prevZoomLevel.current = newLevel;
        setZoomLevel(newLevel);
      }
    }, [locked]),
  });

  // Cmd+Z / Cmd+Shift+Z to undo/redo expand/collapse
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!locked) return;
      if (!e.metaKey || e.key.toLowerCase() !== "z") return;

      const [popFrom, pushTo] = e.shiftKey
        ? [redoStack.current, undoStack.current]
        : [undoStack.current, redoStack.current];
      const next = popFrom.pop();
      if (next === undefined) return;
      e.preventDefault();
      triggerAnimation();
      setExpandedCategories((cur) => { pushTo.push(cur); return next; });
      scheduleFitView();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [triggerAnimation, scheduleFitView, locked]);

  // Panel drill-down requests category expansion (one-way: expand only, never collapse)
  const panelPrevCategory = useRef<NodeCategory | null>(null);
  useEffect(() => {
    const prev = panelPrevCategory.current;
    const next = panelExpandedCategory ?? null;
    panelPrevCategory.current = next;

    if (next && next !== prev && !expandedCategories.has(next)) {
      const updated = new Set(expandedCategories);
      updated.add(next);
      triggerAnimation();
      pushExpansion(updated);
      const memberIds = graph.modules.filter((m) => m.category === next).map((m) => m.id);
      scheduleFitView(memberIds);
    }
  }, [panelExpandedCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track whether this is the first render (skip animation on mount)
  const isInitialRender = useRef(true);
  // Remember previous node positions for morph animation
  const prevNodePositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Remember which modules belonged to which group (for expand/collapse morphs)
  const prevGroupMembership = useRef<Map<string, string>>(new Map());

  // Update nodes/edges when layout changes — with morph animation
  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      setNodes(layout.nodes);
      setEdges(layout.edges);
      setTimeout(() => fitView({ padding: 0.12, duration: 300 }), 100);
      // Store initial positions
      for (const n of layout.nodes) {
        prevNodePositions.current.set(n.id, { ...n.position });
      }
      // Store group membership from nodeIdMap
      for (const [modId, nodeId] of layout.nodeIdMap) {
        if (nodeId !== modId) prevGroupMembership.current.set(modId, nodeId);
      }
      return;
    }

    const oldPositions = prevNodePositions.current;
    const oldGroupMembership = prevGroupMembership.current;
    const newNodeIds = new Set(layout.nodes.map((n) => n.id));

    // Phase 1: Seed new nodes at their origin position (where they're "coming from")
    const seededNodes = layout.nodes.map((n) => {
      const oldPos = oldPositions.get(n.id);
      if (oldPos) {
        // Node existed before — start at its old position, will animate to new
        return { ...n, position: { ...oldPos } };
      }

      // New node — find where it should emerge from
      if (n.type === "groupNode") {
        // Group node appearing (collapse): start at centroid of its members' old positions
        const members = (n.data as GroupNodeData).members as ArchModule[];
        let cx = 0, cy = 0, count = 0;
        for (const m of members) {
          const mPos = oldPositions.get(m.id);
          if (mPos) { cx += mPos.x; cy += mPos.y; count++; }
        }
        if (count > 0) {
          return { ...n, position: { x: cx / count, y: cy / count } };
        }
      } else {
        // Individual node appearing (expand): start at its old group node's position
        const groupId = oldGroupMembership.get(n.id);
        if (groupId) {
          const groupPos = oldPositions.get(groupId);
          if (groupPos) {
            return { ...n, position: { ...groupPos } };
          }
        }
      }

      return n;
    });

    // Phase 1: Apply seeded positions instantly (no transition)
    setAnimClass("react-flow--seeding");
    setNodes(seededNodes);
    setEdges(layout.edges);

    // Phase 2: After browser paints seeded positions, enable transitions and apply final positions
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setAnimClass("react-flow--morphing");
        setNodes(layout.nodes);
        // Clear morphing class after transition completes
        if (animTimer.current) clearTimeout(animTimer.current);
        animTimer.current = setTimeout(() => setAnimClass(""), 600);
      });
    });

    // Store new positions and membership for next transition
    const nextPositions = new Map<string, { x: number; y: number }>();
    for (const n of layout.nodes) {
      nextPositions.set(n.id, { ...n.position });
    }
    prevNodePositions.current = nextPositions;

    const nextMembership = new Map<string, string>();
    for (const [modId, nodeId] of layout.nodeIdMap) {
      if (nodeId !== modId) nextMembership.set(modId, nodeId);
    }
    prevGroupMembership.current = nextMembership;
  }, [layout, setNodes, setEdges, fitView]);

  // Trace highlighting
  useEffect(() => {
    if (!activeTrace) {
      setEdges(layout.edges);
      return;
    }

    const trace = graph.traces.find((t) => t.name === activeTrace);
    if (!trace) return;

    // Map trace module IDs through nodeIdMap (handles collapsed groups)
    const traceEdgeSet = new Set<string>();
    for (let i = 0; i < trace.path.length - 1; i++) {
      const fromId = layout.nodeIdMap.get(trace.path[i]) ?? trace.path[i];
      const toId = layout.nodeIdMap.get(trace.path[i + 1]) ?? trace.path[i + 1];
      if (fromId !== toId) {
        traceEdgeSet.add(`${fromId}->${toId}`);
        traceEdgeSet.add(`${toId}->${fromId}`);
      }
    }

    setEdges(
      layout.edges.map((edge) => {
        const key = `${edge.source}->${edge.target}`;
        const isOnTrace = traceEdgeSet.has(key);
        return {
          ...edge,
          animated: isOnTrace,
          style: {
            ...edge.style,
            stroke: isOnTrace ? "var(--accent)" : (edge.style?.stroke ?? "var(--edge-default)"),
            strokeWidth: isOnTrace ? 3 : (Number(edge.style?.strokeWidth) || 1.5),
            opacity: isOnTrace ? 1 : 0.3,
          },
        };
      })
    );
  }, [activeTrace, graph.traces, layout.edges, layout.nodeIdMap, setEdges]);

  // Single click: select node (delayed to avoid firing during double-click)
  // At system level, clicking a group shows the component panel (no expansion).
  // At module level, clicking an individual node shows the module panel.
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        if (node.type === "groupNode") {
          const data = node.data as GroupNodeData;
          onSelect({
            kind: "component",
            category: data.category as NodeCategory,
            label: data.label as string,
            members: data.members as ArchModule[],
          });
          return;
        }
        const mod = graph.modules.find((m) => m.id === node.id);
        if (mod) {
          onSelect({ kind: "module", module: mod });
        }
      }, 250);
    },
    [graph.modules, onSelect]
  );

  // Double-click: only drill down (never collapse, never close panel)
  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (clickTimer.current) {
        clearTimeout(clickTimer.current);
        clickTimer.current = null;
      }

      if (node.type === "groupNode") {
        // Expand this group (drill down)
        const category = (node.data as GroupNodeData).category as NodeCategory;
        if (!expandedCategories.has(category)) {
          const next = new Set(expandedCategories);
          next.add(category);
          triggerAnimation();
          pushExpansion(next);
          scheduleFitView();
        }
      } else {
        // Double-click module → open module panel
        const mod = graph.modules.find((m) => m.id === node.id);
        if (mod) {
          onSelect({ kind: "module", module: mod });
        }
      }
    },
    [graph.modules, expandedCategories, onSelect, triggerAnimation, pushExpansion, scheduleFitView]
  );

  const onPaneClick = useCallback(() => {
    onSelect(null);
  }, [onSelect]);

  const onNodeMouseEnter = useCallback((_: React.MouseEvent, node: Node) => {
    setHoveredNodeId(node.id);
  }, []);

  const onNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  // Slider level change
  function handleLevelChange(level: ZoomLevel) {
    prevZoomLevel.current = level;
    setZoomLevel(level);
    // When switching to system view, clear all expansions
    if (level === "collapsed") {
      setExpandedCategories(new Set());
    }
    // When switching to module/detail, expand all
    if (level === "compact" || level === "detailed") {
      setExpandedCategories(new Set(allCategories));
    }
  }

  // Slider shows "collapsed" unless all groups are expanded
  const isFullyExpanded = effectiveExpanded.size === allCategories.size;
  const displayLevel: ZoomLevel = isFullyExpanded
    ? (zoomLevel === "detailed" ? "detailed" : "compact")
    : "collapsed";

  // Compute which nodes are on the active trace (mapped through nodeIdMap)
  const traceNodeIds = useMemo(() => {
    if (!activeTrace) return null;
    const trace = graph.traces.find((t) => t.name === activeTrace);
    if (!trace) return null;
    const ids = new Set<string>();
    for (const moduleId of trace.path) {
      ids.add(layout.nodeIdMap.get(moduleId) ?? moduleId);
    }
    return ids;
  }, [activeTrace, graph.traces, layout.nodeIdMap]);

  return (
    <>
      <ReactFlow
        className={animClass || undefined}
        nodes={nodes.map((n) => {
          // Match by exact ID, group membership, or category when a group was expanded
          const selectedCategory = selectedNodeId?.startsWith("group-")
            ? selectedNodeId.slice(6) as NodeCategory
            : null;
          const isSelected = n.id === selectedNodeId ||
            // Group node containing the selected module
            (n.type === "groupNode" && selectedNodeId
              ? ((n.data as { members?: ArchModule[] })?.members ?? []).some((m) => m.id === selectedNodeId)
              : false) ||
            // Individual node belonging to the selected group's category
            (selectedCategory && n.type !== "groupNode"
              ? graph.modules.find((m) => m.id === n.id)?.category === selectedCategory
              : false);
          const dimmedBySelection = !!selectedNodeId && !isSelected;
          const dimmedByTrace = !!traceNodeIds && !traceNodeIds.has(n.id);
          return {
            ...n,
            selected: isSelected,
            data: {
              ...n.data,
              dimmed: dimmedBySelection || dimmedByTrace,
              // Individual nodes always show at least compact; group nodes stay collapsed
              zoomLevel: n.type === "groupNode" ? zoomLevel : (zoomLevel === "collapsed" ? "compact" : zoomLevel),
              isDark,
              highlighted: chatHighlights?.has(n.id) ||
                (n.type === "groupNode" && chatHighlights
                  ? ((n.data as { members?: ArchModule[] })?.members ?? []).some((m) => chatHighlights.has(m.id))
                  : false),
            },
          };
        })}
        edges={edges.map((e) => {
          if (!selectedNodeId && !traceNodeIds) return e;
          if (selectedNodeId) {
            const connectedToSelected = e.source === selectedNodeId || e.target === selectedNodeId ||
              nodes.some((n) =>
                n.type === "groupNode" &&
                (n.id === e.source || n.id === e.target) &&
                ((n.data as { members?: ArchModule[] })?.members ?? []).some((m) => m.id === selectedNodeId)
              );
            const connectedToHovered = hoveredNodeId && !connectedToSelected && (
              e.source === hoveredNodeId || e.target === hoveredNodeId ||
              nodes.some((n) =>
                n.type === "groupNode" &&
                (n.id === e.source || n.id === e.target) &&
                ((n.data as { members?: ArchModule[] })?.members ?? []).some((m) => m.id === hoveredNodeId)
              )
            );
            return {
              ...e,
              style: { ...e.style, opacity: connectedToSelected ? 1 : connectedToHovered ? 1 : 0.5 },
              labelStyle: { ...e.labelStyle, opacity: connectedToSelected ? 1 : connectedToHovered ? 1 : 0.5 },
            };
          }
          return e;
        })}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.1}
        maxZoom={3}
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--grid-dot)" gap={20} size={1} />
      </ReactFlow>

      <DetailSlider
        level={displayLevel}
        locked={locked}
        onLevelChange={handleLevelChange}
        onLockedChange={setLocked}
        position="bottom-left"
      />
    </>
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  if (!props.graph.modules || props.graph.modules.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="text-center max-w-sm">
          <p className="text-text-secondary text-sm">
            No modules to display. The graph is empty.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
