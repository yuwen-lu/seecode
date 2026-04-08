"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
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
import type { ArchGraph, ArchModule, NodeCategory } from "@/types/graph";
import { ArchNode } from "./ArchNode";
import { GroupNode, type GroupNodeData } from "./GroupNode";
import { DetailSlider } from "./DetailSlider";
import {
  getZoomLevel,
  buildHybridGraph,
  type ZoomLevel,
} from "@/lib/semantic-zoom";

interface GraphCanvasProps {
  graph: ArchGraph;
  activeTrace: string | null;
  onNodeSelect: (module: ArchModule | null) => void;
  selectedNodeId: string | null;
}

const nodeTypes = {
  archNode: ArchNode,
  groupNode: GroupNode,
};

function GraphCanvasInner({
  graph,
  activeTrace,
  onNodeSelect,
  selectedNodeId,
}: GraphCanvasProps) {
  const { fitView } = useReactFlow();
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

  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [animating, setAnimating] = useState(false);
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
    setAnimating(true);
    if (animTimer.current) clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setAnimating(false), 500);
  }, []);

  // Debounced fitView — cancels any pending call so rapid actions don't stack up
  const scheduleFitView = useCallback(() => {
    if (fitViewTimer.current) clearTimeout(fitViewTimer.current);
    fitViewTimer.current = setTimeout(() => fitView({ padding: 0.12, duration: 400 }), 50);
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

  // Track whether this is the first render (skip animation on mount)
  const isInitialRender = useRef(true);

  // Update nodes/edges when layout changes
  useEffect(() => {
    setNodes(layout.nodes);
    setEdges(layout.edges);

    if (isInitialRender.current) {
      // First render: quick fit, no node animation
      isInitialRender.current = false;
      setTimeout(() => fitView({ padding: 0.12, duration: 300 }), 100);
    }
  }, [layout, setNodes, setEdges, fitView]);

  // Trace highlighting
  useEffect(() => {
    if (!activeTrace) {
      setEdges(layout.edges);
      return;
    }

    const trace = graph.traces.find((t) => t.name === activeTrace);
    if (!trace) return;

    const traceEdgeSet = new Set<string>();
    for (let i = 0; i < trace.path.length - 1; i++) {
      traceEdgeSet.add(`${trace.path[i]}->${trace.path[i + 1]}`);
      traceEdgeSet.add(`${trace.path[i + 1]}->${trace.path[i]}`);
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
            stroke: isOnTrace ? "#7aa2f7" : (edge.style?.stroke ?? "#5a6080"),
            strokeWidth: isOnTrace ? 3 : (Number(edge.style?.strokeWidth) || 1.5),
            opacity: isOnTrace ? 1 : 0.3,
          },
        };
      })
    );
  }, [activeTrace, graph.traces, layout.edges, setEdges]);

  // Single click: select node (delayed to avoid firing during double-click)
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        if (node.type === "groupNode") {
          const members = (node.data as { members?: ArchModule[] })?.members;
          if (members && members.length > 0) {
            onNodeSelect(members[0]);
          }
          return;
        }
        const mod = graph.modules.find((m) => m.id === node.id);
        onNodeSelect(mod ?? null);
      }, 250);
    },
    [graph.modules, onNodeSelect]
  );

  // Double-click: expand/collapse a group (cancels pending single-click)
  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (clickTimer.current) {
        clearTimeout(clickTimer.current);
        clickTimer.current = null;
      }

      let next: Set<NodeCategory> | null = null;
      if (node.type === "groupNode") {
        const category = (node.data as GroupNodeData).category as NodeCategory;
        next = new Set(expandedCategories);
        next.add(category);
      } else {
        const mod = graph.modules.find((m) => m.id === node.id);
        if (mod && expandedCategories.has(mod.category)) {
          next = new Set(expandedCategories);
          next.delete(mod.category);
        }
      }
      if (!next) return;
      triggerAnimation();
      pushExpansion(next);
      onNodeSelect(null);
      scheduleFitView();
    },
    [graph.modules, expandedCategories, onNodeSelect, triggerAnimation, pushExpansion, scheduleFitView]
  );

  const onPaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

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

  return (
    <>
      <ReactFlow
        className={animating ? "react-flow--animating" : undefined}
        nodes={nodes.map((n) => {
          const isSelected = n.id === selectedNodeId ||
            (n.type === "groupNode" && selectedNodeId
              ? ((n.data as { members?: ArchModule[] })?.members ?? []).some((m) => m.id === selectedNodeId)
              : false);
          return {
            ...n,
            selected: isSelected,
            data: { ...n.data, dimmed: !!selectedNodeId && !isSelected },
          };
        })}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.1}
        maxZoom={3}
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1a1a2a" gap={20} size={1} />
        <Controls position="bottom-left" showInteractive={false} />
      </ReactFlow>

      <DetailSlider
        level={displayLevel}
        locked={locked}
        onLevelChange={handleLevelChange}
        onLockedChange={setLocked}
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
