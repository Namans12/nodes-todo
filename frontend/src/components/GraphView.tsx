import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useApp } from "../context/AppContext";
import { todosApi, connectionsApi } from "../api/client";
import type { Todo } from "../types";
import {
  GitBranch,
  FolderOpen,
  Check,
  Zap,
  GripVertical,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
} from "lucide-react";
import toast from "react-hot-toast";

/* ─── Types ────────────────────────────────────────── */

interface NodePosition {
  x: number;
  y: number;
}

interface DragState {
  fromTodoId: string;
  fromPortSide: "left" | "right" | "top" | "bottom";
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

/* ─── Constants ────────────────────────────────────── */

const NODE_W = 180;
const NODE_H = 60;
const GRID = 20;          // matches background dot grid
const BASE_CANVAS_W = 2400;   // virtual canvas width
const BASE_CANVAS_H = 1600;   // virtual canvas height
const NORMAL_VIEW_EXTRA_W = 360;
const NORMAL_VIEW_EXTRA_H = 240;

const snapGrid = (v: number, max: number) =>
  Math.round(Math.max(0, Math.min(v, max)) / GRID) * GRID;

/* ─── Component ────────────────────────────────────── */

export default function GraphView() {
  const { groups, connections, refreshConnections, refreshTodos, selectedGroupId } =
    useApp();
  const [groupId, setGroupId] = useState<string | null>(selectedGroupId);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [positions, setPositions] = useState<Record<string, NodePosition>>({});
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [connectDrag, setConnectDrag] = useState<DragState | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPanel, setShowPanel] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canvasSize, setCanvasSize] = useState({
    w: BASE_CANVAS_W + NORMAL_VIEW_EXTRA_W,
    h: BASE_CANVAS_H + NORMAL_VIEW_EXTRA_H,
  });
  const canvasRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);

  // Keep graph group selection valid as groups are deleted/restored in real time.
  useEffect(() => {
    setGroupId((prev) => {
      if (prev && groups.some((g) => g.id === prev)) return prev;
      if (selectedGroupId && groups.some((g) => g.id === selectedGroupId)) {
        return selectedGroupId;
      }
      return groups[0]?.id ?? null;
    });
  }, [groups, selectedGroupId]);

  // Ensure Graph-aks reflects connection changes when opening this view.
  useEffect(() => {
    refreshConnections().catch(() => undefined);
  }, [refreshConnections]);

  /* ── Load todos ─────────────────────────────────── */

  useEffect(() => {
    if (!groupId) {
      setTodos([]);
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const data = await todosApi.list(groupId);
        setTodos(data.filter((t) => !t.deleted_at));
      } catch {
        setTodos([]);
        toast.error("Failed to load tasks");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [groupId]);

  /* ── Auto-layout ────────────────────────────────── */

  useEffect(() => {
    if (todos.length === 0) return;
    const key = `graph-positions-${groupId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const updated = { ...parsed };
        let dirty = false;
        todos.forEach((t, i) => {
          if (!updated[t.id]) {
            const cols = Math.max(3, Math.ceil(Math.sqrt(todos.length)));
            updated[t.id] = {
              x: snapGrid(60 + (i % cols) * (NODE_W + 40), canvasSize.w - NODE_W),
              y: snapGrid(60 + Math.floor(i / cols) * (NODE_H + 60), canvasSize.h - NODE_H),
            };
            dirty = true;
          }
        });
        setPositions(updated);
        if (dirty) localStorage.setItem(key, JSON.stringify(updated));
        return;
      } catch {
        /* fall through */
      }
    }
    const cols = Math.max(3, Math.ceil(Math.sqrt(todos.length)));
    const fresh: Record<string, NodePosition> = {};
    todos.forEach((t, i) => {
      fresh[t.id] = {
        x: snapGrid(60 + (i % cols) * (NODE_W + 40), canvasSize.w - NODE_W),
        y: snapGrid(60 + Math.floor(i / cols) * (NODE_H + 60), canvasSize.h - NODE_H),
      };
    });
    setPositions(fresh);
    localStorage.setItem(key, JSON.stringify(fresh));
  }, [todos, groupId, canvasSize.w, canvasSize.h]);

  const savePositions = useCallback(
    (pos: Record<string, NodePosition>) => {
      if (groupId) localStorage.setItem(`graph-positions-${groupId}`, JSON.stringify(pos));
    },
    [groupId]
  );

  /* ── Group connections ──────────────────────────── */

  const groupConnections = useMemo(() => {
    const ids = new Set(todos.map((t) => t.id));
    return connections.filter((c) => c.items.some((i) => ids.has(i.todo_id)));
  }, [connections, todos]);

  /* ── Port helpers ───────────────────────────────── */

  const getPort = (
    todoId: string,
    side: "left" | "right" | "top" | "bottom"
  ): { x: number; y: number } | null => {
    const p = positions[todoId];
    if (!p) return null;
    switch (side) {
      case "left":
        return { x: p.x, y: p.y + NODE_H / 2 };
      case "right":
        return { x: p.x + NODE_W, y: p.y + NODE_H / 2 };
      case "top":
        return { x: p.x + NODE_W / 2, y: p.y };
      case "bottom":
        return { x: p.x + NODE_W / 2, y: p.y + NODE_H };
    }
  };

  /** Pick best port pair between two nodes */
  const getBestPorts = (
    aId: string,
    bId: string
  ): { from: { x: number; y: number }; to: { x: number; y: number } } | null => {
    const a = positions[aId];
    const b = positions[bId];
    if (!a || !b) return null;

    const acx = a.x + NODE_W / 2;
    const bcx = b.x + NODE_W / 2;
    const acy = a.y + NODE_H / 2;
    const bcy = b.y + NODE_H / 2;

    const dx = bcx - acx;
    const dy = bcy - acy;

    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0
        ? { from: getPort(aId, "right")!, to: getPort(bId, "left")! }
        : { from: getPort(aId, "left")!, to: getPort(bId, "right")! };
    }
    return dy > 0
      ? { from: getPort(aId, "bottom")!, to: getPort(bId, "top")! }
      : { from: getPort(aId, "top")!, to: getPort(bId, "bottom")! };
  };

  /** Smooth cubic bezier */
  const curvePath = (
    from: { x: number; y: number },
    to: { x: number; y: number }
  ) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const tension = Math.min(Math.abs(dx), Math.abs(dy), 80);
    const cx1 = from.x + (dx > 0 ? tension : -tension);
    const cy1 = from.y;
    const cx2 = to.x - (dx > 0 ? tension : -tension);
    const cy2 = to.y;
    return `M${from.x},${from.y} C${cx1},${cy1} ${cx2},${cy2} ${to.x},${to.y}`;
  };

  /* ── Drag: move node ────────────────────────────── */

  const onNodeDown = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const p = positions[id];
    if (!p) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const scrollLeft = canvasRef.current?.scrollLeft ?? 0;
    const scrollTop = canvasRef.current?.scrollTop ?? 0;
    setDraggingNode(id);
    setDragOffset({
      x: e.clientX - (rect?.left ?? 0) + scrollLeft - p.x,
      y: e.clientY - (rect?.top ?? 0) + scrollTop - p.y,
    });
  };

  /* ── Drag: connect ──────────────────────────────── */

  const onPortDown = (
    e: React.MouseEvent,
    todoId: string,
    side: "left" | "right" | "top" | "bottom"
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setConnectDrag({
      fromTodoId: todoId,
      fromPortSide: side,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
    });
  };

  /* ── Global mouse handlers ──────────────────────── */

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (draggingNode) {
        const rect = canvasRef.current?.getBoundingClientRect();
        const scrollLeft = canvasRef.current?.scrollLeft ?? 0;
        const scrollTop = canvasRef.current?.scrollTop ?? 0;
        const rawX = e.clientX - (rect?.left ?? 0) + scrollLeft - dragOffset.x;
        const rawY = e.clientY - (rect?.top ?? 0) + scrollTop - dragOffset.y;
        const maxX = Math.max(canvasSize.w - NODE_W, rawX + 220);
        const maxY = Math.max(canvasSize.h - NODE_H, rawY + 220);
        setPositions((prev) => ({
          ...prev,
          [draggingNode]: {
            x: snapGrid(rawX, maxX),
            y: snapGrid(rawY, maxY),
          },
        }));
      }
      if (connectDrag) {
        setConnectDrag((prev) =>
          prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null
        );
        const els = document.elementsFromPoint(e.clientX, e.clientY);
        const target = els.find((el) => el.getAttribute("data-todo-id"));
        const tId = target?.getAttribute("data-todo-id") ?? null;
        setHoverTarget(tId && tId !== connectDrag.fromTodoId ? tId : null);
      }
    },
    [draggingNode, dragOffset, connectDrag, canvasSize.w, canvasSize.h]
  );

  const onMouseUp = useCallback(() => {
    if (draggingNode) {
      savePositions(positions);
      setDraggingNode(null);
    }
    if (connectDrag) {
      if (hoverTarget) {
        createConnection(connectDrag.fromTodoId, hoverTarget);
      }
      setConnectDrag(null);
      setHoverTarget(null);
    }
  }, [draggingNode, connectDrag, positions, savePositions, hoverTarget]);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === graphRef.current);
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    const viewW = canvasRef.current?.clientWidth ?? 0;
    const viewH = canvasRef.current?.clientHeight ?? 0;
    const maxX = Math.max(
      0,
      ...Object.values(positions).map((p) => p.x + NODE_W + 220)
    );
    const maxY = Math.max(
      0,
      ...Object.values(positions).map((p) => p.y + NODE_H + 220)
    );

    const minCanvasW = isFullscreen
      ? BASE_CANVAS_W
      : BASE_CANVAS_W + NORMAL_VIEW_EXTRA_W;
    const minCanvasH = isFullscreen
      ? BASE_CANVAS_H
      : BASE_CANVAS_H + NORMAL_VIEW_EXTRA_H;

    const nextW = snapGrid(
      Math.max(minCanvasW, viewW + 220, maxX),
      Number.MAX_SAFE_INTEGER
    );
    const nextH = snapGrid(
      Math.max(minCanvasH, viewH + 220, maxY),
      Number.MAX_SAFE_INTEGER
    );

    setCanvasSize((prev) =>
      prev.w !== nextW || prev.h !== nextH ? { w: nextW, h: nextH } : prev
    );
  }, [positions, isFullscreen]);

  /* ── Create connection ──────────────────────────── */

  const createConnection = async (fromId: string, toId: string) => {
    try {
      await connectionsApi.create([fromId, toId]);
      await refreshConnections();
      toast.success("Connected!");
    } catch (e: unknown) {
      toast.error(
        e instanceof Error ? e.message : "Failed to create connection"
      );
    }
  };

  /* ── Toggle todo ────────────────────────────────── */

  const handleToggle = async (todoId: string) => {
    try {
      await todosApi.toggleComplete(todoId);
      // Refresh local todos
      if (groupId) {
        const data = await todosApi.list(groupId);
        setTodos(data.filter((t) => !t.deleted_at));
      }
      await refreshConnections();
      await refreshTodos();
    } catch {
      toast.error("Failed to toggle");
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await graphRef.current?.requestFullscreen();
      } else if (document.fullscreenElement === graphRef.current) {
        await document.exitFullscreen();
      }
    } catch {
      toast.error("Fullscreen not available");
    }
  };

  /* ── Derived ────────────────────────────────────── */

  const currentGroup = groups.find((g) => g.id === groupId);

  const { connectionCount, connectionOrder, completionOrder } = useMemo(() => {
    const counts: Record<string, number> = {};
    const order: Record<string, number> = {};
    const orderedTodoIds: string[] = [];
    const seen = new Set<string>();

    for (const conn of groupConnections) {
      conn.items.forEach((item) => {
        counts[item.todo_id] = (counts[item.todo_id] ?? 0) + 1;

        // Global order from "New Connections" sequence (first occurrence wins).
        if (!seen.has(item.todo_id)) {
          seen.add(item.todo_id);
          orderedTodoIds.push(item.todo_id);
        }
      });
    }

    orderedTodoIds.forEach((todoId, index) => {
      order[todoId] = index + 1;
    });

    const connectedById = new Map(
      groupConnections.flatMap((conn) => conn.items.map((item) => [item.todo_id, item] as const))
    );

    const completionCandidates = orderedTodoIds
      .map((todoId) => {
        const item = connectedById.get(todoId);
        return {
          todoId,
          completedAt: item?.completed_at ?? null,
          baseOrder: order[todoId] ?? Number.MAX_SAFE_INTEGER,
        };
      })
      .filter((entry) => entry.completedAt);

    completionCandidates.sort((a, b) => {
      const timeDiff = Date.parse(a.completedAt!) - Date.parse(b.completedAt!);
      if (timeDiff !== 0) return timeDiff;
      if (a.baseOrder !== b.baseOrder) return a.baseOrder - b.baseOrder;
      return a.todoId.localeCompare(b.todoId);
    });

    const completeOrder: Record<string, number> = {};
    completionCandidates.forEach((entry, index) => {
      completeOrder[entry.todoId] = index + 1;
    });

    return { connectionCount: counts, connectionOrder: order, completionOrder: completeOrder };
  }, [groupConnections]);

  const canvasOffset = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { left: rect?.left ?? 0, top: rect?.top ?? 0 };
  };

  /* ── Render ─────────────────────────────────────── */

  return (
    <div className="animate-fade-in" >
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <GitBranch size={24} className="text-indigo-500" />
          GraphPlan
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Drag between ports to connect tasks &middot; Max 2 connections per task
        </p>
      </div>

      {/* Group pills */}
      <div className="flex flex-wrap gap-2 mb-5">
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => setGroupId(g.id)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
              groupId === g.id
                ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 scale-[1.02]"
                : "glass text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:scale-[1.02]"
            }`}
          >
            <FolderOpen size={14} />
            {g.name}
          </button>
        ))}
      </div>

      {/* States */}
      {!groupId ? (
        <EmptyState
          icon={<GitBranch size={28} className="text-slate-300 dark:text-slate-600" />}
          text="Select a group to view its task graph"
        />
      ) : loading ? (
        <div className="flex items-center justify-center h-[50vh]">
          <div className="animate-pulse-soft text-slate-400">Loading graph...</div>
        </div>
      ) : todos.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={28} className="text-slate-300 dark:text-slate-600" />}
          text={`No tasks in ${currentGroup?.name ?? "this group"}`}
        />
      ) : (
        /* ── Canvas ────────────────────────────────── */
        <div ref={graphRef} className={`relative ${isFullscreen ? "" : "pb-2"}`}>
          <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
            <button
              onClick={() => setShowPanel((v) => !v)}
              title={showPanel ? "Hide controls" : "Show controls"}
              className="w-8 h-8 rounded-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-slate-200 dark:border-slate-700 flex items-center justify-center shadow-md hover:shadow-lg hover:bg-white dark:hover:bg-slate-800 transition-all duration-150"
            >
              {showPanel ? (
                <EyeOff size={14} className="text-slate-600 dark:text-slate-300" />
              ) : (
                <Eye size={14} className="text-slate-600 dark:text-slate-300" />
              )}
            </button>
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Open fullscreen"}
              className="w-8 h-8 rounded-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-slate-200 dark:border-slate-700 flex items-center justify-center shadow-md hover:shadow-lg hover:bg-white dark:hover:bg-slate-800 transition-all duration-150"
            >
              {isFullscreen ? (
                <Minimize2 size={14} className="text-slate-600 dark:text-slate-300" />
              ) : (
                <Maximize2 size={14} className="text-slate-600 dark:text-slate-300" />
              )}
            </button>
          </div>

          {/* Scrollable canvas */}
          <div
            ref={canvasRef}
            className="relative rounded-2xl overflow-auto no-scrollbar border border-slate-200 dark:border-slate-800"
            style={{
              width: "100%",
              minHeight: isFullscreen ? 0 : 600,
              height: isFullscreen ? "calc(100vh - 40px)" : "calc(100vh - 250px)",
              background:
                "radial-gradient(circle at 1px 1px, rgba(148,163,184,0.12) 1px, transparent 0)",
              backgroundSize: `${GRID}px ${GRID}px`,
            }}
          >
          {/* Inner virtual canvas — keeps nodes from escaping */}
          <div style={{ width: canvasSize.w, height: canvasSize.h, position: "relative" }}>
          {/* ── SVG layer ──────────────────────────── */}
          <svg
            className="absolute inset-0 pointer-events-none"
            width={canvasSize.w}
            height={canvasSize.h}
            style={{ zIndex: 1 }}
          >
            <defs>
              <linearGradient id="line-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgb(99,102,241)" stopOpacity="0.7" />
                <stop offset="100%" stopColor="rgb(139,92,246)" stopOpacity="0.7" />
              </linearGradient>
              <linearGradient id="line-done" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgb(16,185,129)" stopOpacity="0.6" />
                <stop offset="100%" stopColor="rgb(20,184,166)" stopOpacity="0.6" />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <marker id="arr" markerWidth="6" markerHeight="4.5" refX="5.5" refY="2.25" orient="auto">
                <polygon points="0 0, 6 2.25, 0 4.5" fill="rgb(99,102,241)" fillOpacity="0.7" />
              </marker>
              <marker id="arr-done" markerWidth="6" markerHeight="4.5" refX="5.5" refY="2.25" orient="auto">
                <polygon points="0 0, 6 2.25, 0 4.5" fill="rgb(16,185,129)" fillOpacity="0.7" />
              </marker>
            </defs>

            {/* Connection paths */}
            {groupConnections.map((conn) =>
              conn.items.map((item, idx) => {
                if (idx >= conn.items.length - 1) return null;
                const next = conn.items[idx + 1]!;
                const ports = getBestPorts(item.todo_id, next.todo_id);
                if (!ports) return null;

                const bothDone =
                  item.is_completed === 1 && next.is_completed === 1;
                const path = curvePath(ports.from, ports.to);

                return (
                  <g key={`${conn.id}-${item.id}`}>
                    {/* Shadow */}
                    <path
                      d={path}
                      fill="none"
                      strokeWidth={6}
                      strokeOpacity={0.08}
                      className={bothDone ? "stroke-emerald-500" : "stroke-indigo-500"}
                    />
                    {/* Main line */}
                    <path
                      d={path}
                      fill="none"
                      stroke={bothDone ? "url(#line-done)" : "url(#line-grad)"}
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      markerEnd={bothDone ? "url(#arr-done)" : "url(#arr)"}
                    />
                    {/* Animated particle */}
                    {!conn.is_fully_complete && (
                      <circle r="3.5" fill="rgb(99,102,241)" filter="url(#glow)">
                        <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
                        <animateMotion dur="2.5s" repeatCount="indefinite" path={path} />
                        <animate attributeName="r" values="3;4.5;3" dur="2.5s" repeatCount="indefinite" />
                      </circle>
                    )}
                  </g>
                );
              })
            )}

            {/* Active drag line */}
            {connectDrag &&
              (() => {
                const off = canvasOffset();
                const scrollLeft = canvasRef.current?.scrollLeft ?? 0;
                const scrollTop = canvasRef.current?.scrollTop ?? 0;
                const fromPort = getPort(
                  connectDrag.fromTodoId,
                  connectDrag.fromPortSide
                );
                if (!fromPort) return null;
                const toX = connectDrag.currentX - off.left + scrollLeft;
                const toY = connectDrag.currentY - off.top + scrollTop;
                const path = curvePath(fromPort, { x: toX, y: toY });
                return (
                  <g>
                    <path
                      d={path}
                      fill="none"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeDasharray="8 5"
                      className="stroke-indigo-400"
                    >
                      <animate
                        attributeName="stroke-dashoffset"
                        from="0"
                        to="-26"
                        dur="0.8s"
                        repeatCount="indefinite"
                      />
                    </path>
                    {/* Endpoint pulse */}
                    <circle cx={toX} cy={toY} r="6" className="fill-indigo-400/40">
                      <animate attributeName="r" values="4;8;4" dur="1s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.6;0.2;0.6" dur="1s" repeatCount="indefinite" />
                    </circle>
                    <circle cx={toX} cy={toY} r="3" className="fill-indigo-500" />
                  </g>
                );
              })()}
          </svg>

          {/* ── Node layer ─────────────────────────── */}
          <div className="absolute inset-0" style={{ zIndex: 2 }}>
            {todos.map((todo) => {
              const pos = positions[todo.id];
              if (!pos) return null;
              const isCompleted = todo.is_completed === 1;
              const isDragging = draggingNode === todo.id;
              const isTarget = hoverTarget === todo.id;
              const conns = connectionCount[todo.id] ?? 0;
              const canConnect = conns < 2;

              const isNext = groupConnections.some((c) => {
                const ni = c.items.findIndex((i) => !i.is_completed);
                return ni >= 0 && c.items[ni]!.todo_id === todo.id;
              });

              const isConnected = conns > 0;
              const badgeNumber = isCompleted
                ? completionOrder[todo.id] ?? connectionOrder[todo.id] ?? 1
                : connectionOrder[todo.id] ?? 1;

              return (
                <div
                  key={todo.id}
                  data-todo-id={todo.id}
                  className={`absolute select-none ${isDragging ? "z-50" : "z-10"}`}
                  style={{
                    left: pos.x,
                    top: pos.y,
                    width: NODE_W,
                    height: NODE_H,
                    transition: isDragging ? "none" : "box-shadow 0.2s, transform 0.15s",
                  }}
                >
                  {/* Glow ring when targeted */}
                  {isTarget && (
                    <div
                      className="absolute -inset-3 rounded-2xl pointer-events-none"
                      style={{
                        background: "radial-gradient(ellipse, rgba(99,102,241,0.15) 0%, transparent 70%)",
                        border: "2px solid rgba(99,102,241,0.4)",
                        borderRadius: "16px",
                        animation: "pulse 1.5s ease-in-out infinite",
                        zIndex: -1,
                      }}
                    />
                  )}

                  {/* Card */}
                  <div
                    className={`relative h-full rounded-xl border-2 transition-all duration-200 ${
                      todo.high_priority === 1 ? "priority-warning" : ""
                    } ${
                      isDragging
                        ? "shadow-2xl shadow-indigo-500/20 scale-[1.04]"
                        : isTarget
                        ? "shadow-xl shadow-indigo-400/30 scale-[1.02]"
                        : "shadow-md hover:shadow-lg"
                    } ${
                      isCompleted
                        ? isConnected
                          ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-500/70"
                          : "bg-slate-50 dark:bg-slate-900/80 border-emerald-400/50 opacity-70"
                        : isNext
                        ? "bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/50 dark:to-slate-800 border-indigo-500 ring-2 ring-indigo-400/20"
                        : isConnected
                        ? "bg-white dark:bg-slate-800 border-indigo-400/50"
                        : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    {/* Drag handle + toggle */}
                    <div
                      onMouseDown={(e) => onNodeDown(e, todo.id)}
                      className="flex items-center gap-2 px-3 py-2.5 cursor-grab active:cursor-grabbing rounded-t-[10px] transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/40"
                    >
                      <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggle(todo.id);
                        }}
                        className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all duration-300 ${
                          isCompleted
                            ? "bg-emerald-500 border-emerald-500 text-white"
                            : "border-slate-300 dark:border-slate-600 hover:border-indigo-400"
                        }`}
                        title="Toggle completion"
                      >
                        {isCompleted && <Check size={9} strokeWidth={3} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-[13px] font-medium truncate leading-tight ${
                            isCompleted
                              ? "line-through text-slate-400 dark:text-slate-500"
                              : "text-slate-800 dark:text-slate-100"
                          }`}
                        >
                          {todo.title}
                        </p>
                        {todo.description && (
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5 leading-tight">
                            {todo.description}
                          </p>
                        )}
                      </div>
                      {isCompleted && (
                        <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0 shadow-sm shadow-emerald-500/30">
                          <Check size={9} strokeWidth={3} className="text-white" />
                        </div>
                      )}
                      {isNext && !isCompleted && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-indigo-500/10 text-[9px] font-bold text-indigo-600 dark:text-indigo-400 flex-shrink-0 animate-pulse">
                          <Zap size={8} /> NEXT
                        </span>
                      )}
                    </div>

                    {/* Connection order badge */}
                    {conns > 0 && (
                      <div
                        className={`absolute -top-2 -right-2 w-5 h-5 rounded-full text-white text-[9px] font-bold flex items-center justify-center shadow-sm ${
                          isCompleted
                            ? "bg-emerald-500 shadow-emerald-500/30"
                            : "bg-indigo-500 shadow-indigo-500/30"
                        }`}
                      >
                        {badgeNumber}
                      </div>
                    )}

                    {/* ── Ports ─────────────────────── */}
                    <Port
                      side="top"
                      canConnect={canConnect}
                      isActive={connectDrag?.fromTodoId === todo.id && connectDrag.fromPortSide === "top"}
                      onMouseDown={(e) => onPortDown(e, todo.id, "top")}
                    />
                    <Port
                      side="left"
                      canConnect={canConnect}
                      isActive={connectDrag?.fromTodoId === todo.id && connectDrag.fromPortSide === "left"}
                      onMouseDown={(e) => onPortDown(e, todo.id, "left")}
                    />
                    <Port
                      side="right"
                      canConnect={canConnect}
                      isActive={connectDrag?.fromTodoId === todo.id && connectDrag.fromPortSide === "right"}
                      onMouseDown={(e) => onPortDown(e, todo.id, "right")}
                    />
                    <Port
                      side="bottom"
                      canConnect={canConnect}
                      isActive={connectDrag?.fromTodoId === todo.id && connectDrag.fromPortSide === "bottom"}
                      onMouseDown={(e) => onPortDown(e, todo.id, "bottom")}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          </div>{/* end inner virtual canvas */}
          </div>{/* end scrollable canvas */}

          {/* ── Legend panel (overlay, doesn't scroll) ── */}
          {showPanel && (
            <div className="absolute bottom-6 right-4 rounded-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-slate-200 dark:border-slate-700 px-4 py-3 text-[10px] space-y-1.5 z-30 shadow-lg">
              <div className="font-semibold text-[11px] text-slate-600 dark:text-slate-300 mb-1.5">
                Controls
              </div>
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <GripVertical size={10} /> Drag card to reposition
              </div>
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <div className="w-3 h-3 rounded-full border-2 border-indigo-400 bg-indigo-400/20" />
                Drag port to connect (max 2)
              </div>
              <div className="flex items-center gap-2 text-indigo-500">
                <svg width="20" height="8">
                  <path d="M0 4 Q5 0 10 4 T20 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                Connection path
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Port sub-component ───────────────────────────── */

function Port({
  side,
  canConnect,
  isActive,
  onMouseDown,
}: {
  side: "left" | "right" | "top" | "bottom";
  canConnect: boolean;
  isActive: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const posClass =
    side === "left"
      ? "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2"
      : side === "right"
      ? "right-0 top-1/2 translate-x-1/2 -translate-y-1/2"
      : side === "top"
      ? "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2"
      : "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2";

  if (!canConnect && !isActive) {
    return (
      <div
        className={`absolute ${posClass} w-2.5 h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 opacity-40 pointer-events-none`}
      />
    );
  }

  return (
    <div
      onMouseDown={onMouseDown}
      className={`absolute ${posClass} group/port cursor-crosshair`}
      style={{ zIndex: 30 }}
    >
      <div
        className={`rounded-full flex items-center justify-center transition-all duration-200 ${
          isActive
            ? "w-5 h-5 bg-indigo-500/30 ring-2 ring-indigo-400/60 scale-125"
            : "w-3.5 h-3.5 bg-white dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 group-hover/port:border-indigo-400 group-hover/port:bg-indigo-500/10 group-hover/port:scale-125"
        }`}
      >
        <div
          className={`rounded-full transition-all duration-200 ${
            isActive
              ? "w-2.5 h-2.5 bg-indigo-500"
              : "w-1.5 h-1.5 bg-slate-300 dark:bg-slate-600 group-hover/port:bg-indigo-500"
          }`}
        />
      </div>
    </div>
  );
}

/* ─── Empty state helper ───────────────────────────── */

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
        {icon}
      </div>
      <p className="text-sm text-slate-400 dark:text-slate-500">{text}</p>
    </div>
  );
}
