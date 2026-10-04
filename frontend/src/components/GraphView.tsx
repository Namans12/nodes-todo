import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, FolderOpen, Check } from "lucide-react";
import { useApp } from "../context/AppContext";
import { graphApi, todosApi } from "../api/client";
import type { GraphNode, GraphState } from "../types";
import toast from "react-hot-toast";

const NODE_W = 190;
const NODE_H = 88;
const GRID = 20;
const CANVAS_W = 2600;
const CANVAS_H = 1700;

type PortSide = "left" | "right" | "top" | "bottom";

interface DragLink {
  fromNodeId: string;
  side: PortSide;
  x: number;
  y: number;
}

interface Pos {
  x: number;
  y: number;
}

interface PortPoint {
  x: number;
  y: number;
  side: PortSide;
}

const snap = (v: number, max: number) => Math.round(Math.max(0, Math.min(v, max)) / GRID) * GRID;

function bezier(from: { x: number; y: number }, to: { x: number; y: number }, bendOffset = 0) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len;
  const ny = dx / len;
  const c1x = from.x + Math.max(36, Math.min(110, Math.abs(dx) * 0.35)) * (dx > 0 ? 1 : -1) + nx * bendOffset;
  const c1y = from.y + ny * bendOffset;
  const c2x = to.x - Math.max(36, Math.min(110, Math.abs(dx) * 0.35)) * (dx > 0 ? 1 : -1) + nx * bendOffset;
  const c2y = to.y + ny * bendOffset;
  return `M${from.x},${from.y} C${c1x},${c1y} ${c2x},${c2y} ${to.x},${to.y}`;
}

function pathForEdge(from: { x: number; y: number }, to: { x: number; y: number }, bendOffset: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dy) <= 14 || Math.abs(dx) <= 14) {
    return `M${from.x},${from.y} L${to.x},${to.y}`;
  }
  return bezier(from, to, bendOffset);
}

export default function GraphView() {
  const { groups, selectedGroupId, refreshTodos } = useApp();
  const [groupId, setGroupId] = useState<string | null>(selectedGroupId);
  const [graph, setGraph] = useState<GraphState | null>(null);
  const [positions, setPositions] = useState<Record<string, Pos>>({});
  const [loading, setLoading] = useState(true);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragLink, setDragLink] = useState<DragLink | null>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const loadGraph = useCallback(async () => {
    if (!groupId) {
      setGraph(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await graphApi.state(groupId);
      setGraph(data);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    setGroupId((prev) => (prev && groups.some((g) => g.id === prev) ? prev : (selectedGroupId ?? groups[0]?.id ?? null)));
  }, [groups, selectedGroupId]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  const todoNodes = useMemo(() => (graph?.nodes ?? []).filter((n) => !!n.todo_id), [graph?.nodes]);
  const edges = graph?.edges ?? [];
  const nodeById = useMemo(() => new Map(todoNodes.map((n) => [n.id, n])), [todoNodes]);

  useEffect(() => {
    if (todoNodes.length === 0) return;
    setPositions((prev) => {
      const next = { ...prev };
      const cols = Math.max(4, Math.ceil(Math.sqrt(todoNodes.length)));
      todoNodes.forEach((n, i) => {
        if (next[n.id]) return;
        const x = n.x != null ? n.x : 80 + (i % cols) * 260;
        const y = n.y != null ? n.y : 80 + Math.floor(i / cols) * 170;
        next[n.id] = {
          x: snap(x, CANVAS_W - NODE_W),
          y: snap(y, CANVAS_H - NODE_H),
        };
      });
      return next;
    });
  }, [todoNodes]);

  const getPort = (nodeId: string, side: PortSide, out = 0): PortPoint | null => {
    const p = positions[nodeId];
    if (!p) return null;
    if (side === "left") return { x: p.x - out, y: p.y + NODE_H / 2, side };
    if (side === "right") return { x: p.x + NODE_W + out, y: p.y + NODE_H / 2, side };
    if (side === "top") return { x: p.x + NODE_W / 2, y: p.y - out, side };
    return { x: p.x + NODE_W / 2, y: p.y + NODE_H + out, side };
  };

  const bestPorts = (aId: string, bId: string): { from: PortPoint; to: PortPoint } | null => {
    const a = positions[aId];
    const b = positions[bId];
    if (!a || !b) return null;
    const ax = a.x + NODE_W / 2;
    const ay = a.y + NODE_H / 2;
    const bx = b.x + NODE_W / 2;
    const by = b.y + NODE_H / 2;
    const dx = bx - ax;
    const dy = by - ay;
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0
        ? { from: getPort(aId, "right", 0)!, to: getPort(bId, "left", 0)! }
        : { from: getPort(aId, "left", 0)!, to: getPort(bId, "right", 0)! };
    }
    return dy > 0
      ? { from: getPort(aId, "bottom", 0)!, to: getPort(bId, "top", 0)! }
      : { from: getPort(aId, "top", 0)!, to: getPort(bId, "bottom", 0)! };
  };

  const renderedEdges = useMemo(() => {
    const active = edges.filter((e) => !e.deleted_at);
    const pairCounts = new Map<string, number>();
    const pairIndex = new Map<string, number>();
    for (const edge of active) {
      const key = `${edge.from_node_id}|${edge.to_node_id}`;
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
    return active
      .map((edge) => {
        const from = nodeById.get(edge.from_node_id);
        const to = nodeById.get(edge.to_node_id);
        if (!from || !to) return null;
        const ports = bestPorts(from.id, to.id);
        if (!ports) return null;
        const key = `${edge.from_node_id}|${edge.to_node_id}`;
        const idx = pairIndex.get(key) ?? 0;
        pairIndex.set(key, idx + 1);
        const total = pairCounts.get(key) ?? 1;
        const laneOffset = (idx - (total - 1) / 2) * 8;

        const fromP = { x: ports.from.x, y: ports.from.y };
        const toP = { x: ports.to.x, y: ports.to.y };
        const done = from.is_completed === 1 && to.is_completed === 1;
        const dist = Math.hypot(toP.x - fromP.x, toP.y - fromP.y);
        const strokeWidth = Math.max(1.8, Math.min(2.8, dist / 260));
        const path = pathForEdge(fromP, toP, laneOffset);
        return {
          id: edge.id,
          from: fromP,
          to: toP,
          path,
          color: done ? "rgb(16,185,129)" : "rgb(99,102,241)",
          strokeWidth,
          markerId: done ? "url(#arr-done-dyn)" : "url(#arr-seq-dyn)",
        };
      })
      .filter((e): e is NonNullable<typeof e> => !!e);
  }, [edges, nodeById, positions]);

  const onNodeDown = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const p = positions[nodeId];
    if (!p) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const sx = canvasRef.current?.scrollLeft ?? 0;
    const sy = canvasRef.current?.scrollTop ?? 0;
    setDraggingNodeId(nodeId);
    setDragOffset({
      x: e.clientX - (rect?.left ?? 0) + sx - p.x,
      y: e.clientY - (rect?.top ?? 0) + sy - p.y,
    });
  };

  const onPortDown = (e: React.MouseEvent, nodeId: string, side: PortSide) => {
    e.preventDefault();
    e.stopPropagation();
    setDragLink({ fromNodeId: nodeId, side, x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draggingNodeId) {
        const rect = canvasRef.current?.getBoundingClientRect();
        const sx = canvasRef.current?.scrollLeft ?? 0;
        const sy = canvasRef.current?.scrollTop ?? 0;
        const rawX = e.clientX - (rect?.left ?? 0) + sx - dragOffset.x;
        const rawY = e.clientY - (rect?.top ?? 0) + sy - dragOffset.y;
        setPositions((prev) => ({
          ...prev,
          [draggingNodeId]: {
            x: snap(rawX, CANVAS_W - NODE_W),
            y: snap(rawY, CANVAS_H - NODE_H),
          },
        }));
      }
      if (dragLink) {
        setDragLink((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
        const els = document.elementsFromPoint(e.clientX, e.clientY);
        const hit = els.find((el) => el.getAttribute("data-node-id"));
        const id = hit?.getAttribute("data-node-id") ?? null;
        setHoverNodeId(id && id !== dragLink.fromNodeId ? id : null);
      }
    };

    const onUp = async () => {
      if (draggingNodeId) {
        const p = positions[draggingNodeId];
        if (p) {
          await graphApi.setPosition(draggingNodeId, "canvas", p.x, p.y).catch(() => undefined);
        }
        setDraggingNodeId(null);
      }
      if (dragLink) {
        if (hoverNodeId) {
          try {
            await graphApi.createEdge(dragLink.fromNodeId, hoverNodeId, "sequential");
            await loadGraph();
          } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to connect");
          }
        }
        setDragLink(null);
        setHoverNodeId(null);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingNodeId, dragOffset, dragLink, hoverNodeId, loadGraph, positions]);

  const toggleTodo = async (node: GraphNode) => {
    if (!node.todo_id) return;
    try {
      await todosApi.toggleComplete(node.todo_id);
      await Promise.all([loadGraph(), refreshTodos()]);
    } catch {
      toast.error("Failed to toggle");
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-5">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <GitBranch size={24} className="text-indigo-500" />
          GraphPlan
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Drag blocks and connect using node ports.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => setGroupId(g.id)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium ${
              groupId === g.id
                ? "bg-indigo-500 text-white"
                : "glass text-slate-600 dark:text-slate-400"
            }`}
          >
            <FolderOpen size={14} />
            {g.name}
          </button>
        ))}
      </div>

      {!groupId ? (
        <div className="text-sm text-slate-500">Select a group.</div>
      ) : loading ? (
        <div className="text-sm text-slate-500">Loading graph...</div>
      ) : (
        <div
          ref={canvasRef}
          className="relative rounded-2xl overflow-auto no-scrollbar border border-slate-200 dark:border-slate-800"
          style={{
            width: "100%",
            height: "calc(100vh - 250px)",
            minHeight: 600,
            background: "radial-gradient(circle at 1px 1px, rgba(148,163,184,0.14) 1px, transparent 0)",
            backgroundSize: `${GRID}px ${GRID}px`,
          }}
        >
          <div style={{ width: CANVAS_W, height: CANVAS_H, position: "relative" }}>
            {todoNodes.map((node) => {
              const p = positions[node.id];
              if (!p) return null;
              const isCompleted = node.is_completed === 1;
              const isHover = hoverNodeId === node.id;
              return (
                <div
                  key={node.id}
                  data-node-id={node.id}
                  className="absolute"
                  style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                >
                  <div className={`relative h-full rounded-xl border-2 transition-all overflow-hidden ${isCompleted ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-500/70" : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"} ${isHover ? "ring-2 ring-indigo-400/50" : ""}`}>
                    <div className={`absolute left-0 top-0 h-full w-1.5 rounded-l-xl ${isCompleted ? "bg-emerald-500" : "bg-violet-500"}`} />
                    <div
                      onMouseDown={(e) => onNodeDown(e, node.id)}
                      className="h-full px-3 pl-4 py-2 flex gap-2 cursor-grab active:cursor-grabbing"
                    >
                      <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTodo(node);
                        }}
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center ${isCompleted ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 dark:border-slate-600"}`}
                      >
                        {isCompleted ? <Check size={10} /> : null}
                      </button>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className={`text-sm leading-tight break-words max-h-9 overflow-hidden ${isCompleted ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-800 dark:text-slate-100"}`}>
                          {node.title}
                        </p>
                        {node.description ? (
                          <>
                            <div className="mt-1 border-t border-dotted border-slate-300 dark:border-slate-600" />
                            <p className="text-[11px] leading-tight text-slate-500 dark:text-slate-400 mt-1 break-words max-h-8 overflow-hidden">
                              {node.description}
                            </p>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <Port side="top" onMouseDown={(e) => onPortDown(e, node.id, "top")} />
                    <Port side="left" onMouseDown={(e) => onPortDown(e, node.id, "left")} />
                    <Port side="right" onMouseDown={(e) => onPortDown(e, node.id, "right")} />
                    <Port side="bottom" onMouseDown={(e) => onPortDown(e, node.id, "bottom")} />
                  </div>
                </div>
              );
            })}

            <svg
              className="absolute inset-0 pointer-events-none"
              width={CANVAS_W}
              height={CANVAS_H}
              style={{ zIndex: 30 }}
            >
              <defs>
                <marker
                  id="arr-seq-dyn"
                  markerUnits="strokeWidth"
                  markerWidth="2.8"
                  markerHeight="2.2"
                  refX="2.5"
                  refY="1.1"
                  orient="auto"
                >
                  <path d="M0,0 L2.8,1.1 L0,2.2 z" fill="rgb(99,102,241)" />
                </marker>
                <marker
                  id="arr-done-dyn"
                  markerUnits="strokeWidth"
                  markerWidth="2.8"
                  markerHeight="2.2"
                  refX="2.5"
                  refY="1.1"
                  orient="auto"
                >
                  <path d="M0,0 L2.8,1.1 L0,2.2 z" fill="rgb(16,185,129)" />
                </marker>
              </defs>
              {renderedEdges.map((edge) => (
                <g key={edge.id}>
                  <path
                    d={edge.path}
                    fill="none"
                    stroke={edge.color}
                    strokeWidth={edge.strokeWidth}
                    strokeLinecap="round"
                    markerEnd={edge.markerId}
                    filter="drop-shadow(0 1px 1px rgba(0,0,0,0.12))"
                  />
                  <circle cx={edge.from.x} cy={edge.from.y} r={5.2} fill={edge.color} />
                  <circle cx={edge.to.x} cy={edge.to.y} r={5.2} fill={edge.color} />
                </g>
              ))}

              {dragLink &&
                (() => {
                  const rect = canvasRef.current?.getBoundingClientRect();
                  const sx = canvasRef.current?.scrollLeft ?? 0;
                  const sy = canvasRef.current?.scrollTop ?? 0;
                  const from = getPort(dragLink.fromNodeId, dragLink.side, 0);
                  if (!from) return null;
                  const to = {
                    x: dragLink.x - (rect?.left ?? 0) + sx,
                    y: dragLink.y - (rect?.top ?? 0) + sy,
                  };
                  return (
                    <path
                      d={bezier(from, to, 8)}
                      fill="none"
                      stroke="rgb(129,140,248)"
                      strokeWidth={2}
                      strokeDasharray="6 5"
                      strokeLinecap="round"
                    />
                  );
                })()}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

function Port({ side, onMouseDown }: { side: PortSide; onMouseDown: (e: React.MouseEvent) => void }) {
  const pos =
    side === "left"
      ? "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2"
      : side === "right"
      ? "right-0 top-1/2 translate-x-1/2 -translate-y-1/2"
      : side === "top"
      ? "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2"
      : "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2";

  return (
    <div onMouseDown={onMouseDown} className={`absolute ${pos} group cursor-crosshair`} style={{ zIndex: 20 }}>
      <div className="w-3.5 h-3.5 rounded-full bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-600 group-hover:border-indigo-400 group-hover:scale-110 transition-all" />
    </div>
  );
}
