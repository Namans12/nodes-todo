import { Hono } from "hono";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/connection.js";
import { graphEdges, graphNodePositions, graphNodes, groups, todos } from "../db/schema.js";

type DbOverride = ReturnType<typeof getDb>;
type EdgeType = "sequential" | "dependency" | "parallel_group" | "hierarchy" | "soft_association";

const EDGE_TYPES: EdgeType[] = ["sequential", "dependency", "parallel_group", "hierarchy", "soft_association"];
const CYCLE_TYPES = new Set<EdgeType>(["sequential", "dependency", "hierarchy"]);

function sortKey(priority: number, createdAt: string) {
  return `${priority === 1 ? "0" : "1"}-${createdAt}`;
}

function hasCycle(
  edges: Array<{ from_node_id: string; to_node_id: string; edge_type: string; deleted_at: string | null }>,
  fromId: string,
  toId: string
) {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.deleted_at) continue;
    if (!CYCLE_TYPES.has(edge.edge_type as EdgeType)) continue;
    const next = adj.get(edge.from_node_id) ?? [];
    next.push(edge.to_node_id);
    adj.set(edge.from_node_id, next);
  }
  const add = adj.get(fromId) ?? [];
  add.push(toId);
  adj.set(fromId, add);

  const stack = [toId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === fromId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const n of adj.get(cur) ?? []) stack.push(n);
  }
  return false;
}

function depthOf(nodeId: string, byId: Map<string, { parent_node_id: string | null }>) {
  let depth = 1;
  let cur = byId.get(nodeId);
  const seen = new Set<string>();
  while (cur?.parent_node_id) {
    if (seen.has(cur.parent_node_id)) return Number.MAX_SAFE_INTEGER;
    seen.add(cur.parent_node_id);
    cur = byId.get(cur.parent_node_id);
    depth += 1;
  }
  return depth;
}

function syncAtomicNodes(db: ReturnType<typeof getDb>["db"], groupId: string) {
  const now = new Date().toISOString();
  const groupTodos = db
    .select()
    .from(todos)
    .where(eq(todos.group_id, groupId))
    .orderBy(asc(todos.created_at))
    .all();
  const existing = db.select().from(graphNodes).where(eq(graphNodes.group_id, groupId)).all();
  const byTodo = new Map(existing.filter((n) => n.todo_id).map((n) => [n.todo_id!, n]));

  for (const todo of groupTodos) {
    const node = byTodo.get(todo.id);
    if (!node) {
      const nodeId = uuidv4();
      db.insert(graphNodes).values({
        id: nodeId,
        group_id: groupId,
        todo_id: todo.id,
        kind: "atomic",
        parent_node_id: null,
        title: null,
        condition_type: null,
        condition_payload: null,
        created_at: todo.created_at,
        updated_at: now,
        deleted_at: todo.deleted_at,
      }).run();
      db.insert(graphNodePositions).values({
        node_id: nodeId,
        view: "library",
        x: null,
        y: null,
        library_sort_key: sortKey(todo.high_priority, todo.created_at),
        updated_at: now,
      }).run();
      continue;
    }
    db.update(graphNodes).set({ deleted_at: todo.deleted_at, updated_at: now }).where(eq(graphNodes.id, node.id)).run();
    const pos = db.select().from(graphNodePositions).where(eq(graphNodePositions.node_id, node.id)).get();
    if (!pos) {
      db.insert(graphNodePositions).values({
        node_id: node.id,
        view: "library",
        x: null,
        y: null,
        library_sort_key: sortKey(todo.high_priority, todo.created_at),
        updated_at: now,
      }).run();
    } else {
      db.update(graphNodePositions).set({ library_sort_key: sortKey(todo.high_priority, todo.created_at), updated_at: now }).where(eq(graphNodePositions.node_id, node.id)).run();
    }
  }
}

export function createGraphRouter(dbOverride?: DbOverride) {
  const router = new Hono();
  const ctx = () => dbOverride ?? getDb();

  router.get("/state", async (c) => {
    try {
      const groupId = c.req.query("group_id");
      if (!groupId) return c.json({ error: "group_id is required" }, 400);
      const { db } = ctx();
      const group = db.select().from(groups).where(eq(groups.id, groupId)).get();
      if (!group) return c.json({ error: "Group not found" }, 404);

      syncAtomicNodes(db, groupId);
      const nodes = db
        .select({
          id: graphNodes.id,
          group_id: graphNodes.group_id,
          todo_id: graphNodes.todo_id,
          kind: graphNodes.kind,
          parent_node_id: graphNodes.parent_node_id,
          title: graphNodes.title,
          condition_type: graphNodes.condition_type,
          condition_payload: graphNodes.condition_payload,
          created_at: graphNodes.created_at,
          updated_at: graphNodes.updated_at,
          deleted_at: graphNodes.deleted_at,
          view: graphNodePositions.view,
          x: graphNodePositions.x,
          y: graphNodePositions.y,
          library_sort_key: graphNodePositions.library_sort_key,
        })
        .from(graphNodes)
        .leftJoin(graphNodePositions, eq(graphNodePositions.node_id, graphNodes.id))
        .where(eq(graphNodes.group_id, groupId))
        .all();
      const ids = nodes.map((n) => n.id);
      const edges = ids.length === 0 ? [] : db.select().from(graphEdges).where(and(inArray(graphEdges.from_node_id, ids), inArray(graphEdges.to_node_id, ids))).all();
      const groupTodos = db.select().from(todos).where(eq(todos.group_id, groupId)).all();
      const todoById = new Map(groupTodos.map((t) => [t.id, t]));

      const complete = new Map<string, boolean>();
      for (const node of nodes) {
        if (node.deleted_at) continue;
        if (node.kind === "composite") {
          const children = nodes.filter((n) => n.parent_node_id === node.id && !n.deleted_at);
          complete.set(node.id, children.length > 0 && children.every((n) => n.todo_id && (todoById.get(n.todo_id)?.is_completed ?? 0) === 1));
        } else {
          complete.set(node.id, !!(node.todo_id && (todoById.get(node.todo_id)?.is_completed ?? 0) === 1));
        }
      }

      const activeEdges = edges.filter((e) => !e.deleted_at);
      const derived = nodes
        .filter((n) => !n.deleted_at)
        .map((node) => {
          const incoming = activeEdges.filter((e) => e.to_node_id === node.id);
          const blocked = incoming.some((edge) => {
            if (edge.edge_type === "sequential" || edge.edge_type === "dependency") {
              return !complete.get(edge.from_node_id);
            }
            return false;
          }) || (!!node.parent_node_id && !complete.get(node.parent_node_id));
          const connected = activeEdges.some((e) => e.from_node_id === node.id || e.to_node_id === node.id);
          const todo = node.todo_id ? todoById.get(node.todo_id) : null;
          return {
            ...node,
            title: todo?.title ?? node.title ?? `${node.kind} node`,
            description: todo?.description ?? null,
            is_completed: complete.get(node.id) ? 1 : 0,
            is_blocked: blocked,
            is_connected: connected,
            priority: todo?.high_priority ?? 0,
            completed_at: todo?.completed_at ?? null,
          };
        });

      return c.json({ data: { nodes: derived, edges: activeEdges, roots: derived.filter((n) => !n.parent_node_id).map((n) => n.id) } });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  router.post("/merge", async (c) => {
    try {
      const body = await c.req.json();
      const sourceNodeId = typeof body.sourceNodeId === "string" ? body.sourceNodeId : "";
      const targetNodeId = typeof body.targetNodeId === "string" ? body.targetNodeId : "";
      if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return c.json({ error: "Invalid node ids" }, 400);
      const { db, sqlite } = ctx();
      const now = new Date().toISOString();
      let compositeNodeId = "";

      const tx = sqlite.transaction(() => {
        const source = db.select().from(graphNodes).where(and(eq(graphNodes.id, sourceNodeId), isNull(graphNodes.deleted_at))).get();
        const target = db.select().from(graphNodes).where(and(eq(graphNodes.id, targetNodeId), isNull(graphNodes.deleted_at))).get();
        if (!source || !target) throw new Error("NODE_NOT_FOUND");
        if (source.group_id !== target.group_id) throw new Error("GROUP_MISMATCH");
        if (source.parent_node_id || target.parent_node_id) throw new Error("HAS_PARENT");

        const maxPos = db.select({ maxPos: sql<number>`COALESCE(MAX(${todos.position}), -1)` }).from(todos).where(and(eq(todos.group_id, source.group_id), isNull(todos.deleted_at))).get();
        const todoId = uuidv4();
        db.insert(todos).values({
          id: todoId,
          group_id: source.group_id,
          title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Composite Task",
          description: "Auto-generated composite task",
          high_priority: 0,
          reminder_at: null,
          is_completed: 0,
          completed_at: null,
          position: (maxPos?.maxPos ?? -1) + 1,
          deleted_at: null,
          created_at: now,
          updated_at: now,
        }).run();

        compositeNodeId = uuidv4();
        db.insert(graphNodes).values({
          id: compositeNodeId,
          group_id: source.group_id,
          todo_id: todoId,
          kind: "composite",
          parent_node_id: null,
          title: null,
          condition_type: null,
          condition_payload: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        }).run();
        db.insert(graphNodePositions).values({ node_id: compositeNodeId, view: "canvas", x: null, y: null, library_sort_key: `1-${now}`, updated_at: now }).run();
        db.update(graphNodes).set({ parent_node_id: compositeNodeId, updated_at: now }).where(inArray(graphNodes.id, [sourceNodeId, targetNodeId])).run();
        db.insert(graphEdges).values([
          { id: uuidv4(), from_node_id: compositeNodeId, to_node_id: sourceNodeId, edge_type: "hierarchy", order_index: 0, created_at: now, updated_at: now, deleted_at: null },
          { id: uuidv4(), from_node_id: compositeNodeId, to_node_id: targetNodeId, edge_type: "hierarchy", order_index: 1, created_at: now, updated_at: now, deleted_at: null },
        ]).run();
      });

      try { tx(); } catch (e) {
        if (e instanceof Error && e.message === "NODE_NOT_FOUND") return c.json({ error: "Node not found" }, 404);
        if (e instanceof Error && e.message === "GROUP_MISMATCH") return c.json({ error: "Nodes must belong to same group" }, 400);
        if (e instanceof Error && e.message === "HAS_PARENT") return c.json({ error: "A node can have max 1 parent" }, 400);
        throw e;
      }

      return c.json({ data: { composite_node_id: compositeNodeId } }, 201);
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  router.post("/edge", async (c) => {
    try {
      const body = await c.req.json();
      const fromNodeId = typeof body.fromNodeId === "string" ? body.fromNodeId : "";
      const toNodeId = typeof body.toNodeId === "string" ? body.toNodeId : "";
      const edgeType = body.edgeType;
      if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return c.json({ error: "Invalid node ids" }, 400);
      if (typeof edgeType !== "string" || !EDGE_TYPES.includes(edgeType as EdgeType)) return c.json({ error: "Invalid edge type" }, 400);
      const { db } = ctx();
      const now = new Date().toISOString();
      const fromNode = db.select().from(graphNodes).where(and(eq(graphNodes.id, fromNodeId), isNull(graphNodes.deleted_at))).get();
      const toNode = db.select().from(graphNodes).where(and(eq(graphNodes.id, toNodeId), isNull(graphNodes.deleted_at))).get();
      if (!fromNode || !toNode) return c.json({ error: "Node not found" }, 404);
      if (fromNode.group_id !== toNode.group_id) return c.json({ error: "Cross-group edge is not allowed" }, 400);

      const nodes = db.select().from(graphNodes).where(and(eq(graphNodes.group_id, fromNode.group_id), isNull(graphNodes.deleted_at))).all();
      const nodeIds = nodes.map((n) => n.id);
      const edges = nodeIds.length === 0 ? [] : db.select().from(graphEdges).where(and(isNull(graphEdges.deleted_at), inArray(graphEdges.from_node_id, nodeIds), inArray(graphEdges.to_node_id, nodeIds))).all();

      if (edges.some((e) => e.from_node_id === fromNodeId && e.to_node_id === toNodeId && e.edge_type === edgeType)) {
        return c.json({ error: "Duplicate edge" }, 400);
      }
      if (CYCLE_TYPES.has(edgeType as EdgeType) && hasCycle(edges, fromNodeId, toNodeId)) {
        return c.json({ error: "No circular dependency allowed" }, 400);
      }
      if (edgeType === "sequential" && fromNode.parent_node_id !== toNode.parent_node_id) {
        return c.json({ error: "Sequential edges allowed only among siblings" }, 400);
      }
      if (edgeType === "hierarchy") {
        if (toNode.parent_node_id && toNode.parent_node_id !== fromNodeId) return c.json({ error: "A node can have 1 parent max" }, 400);
        const childrenCount = db.select({ count: sql<number>`COUNT(*)` }).from(graphNodes).where(and(eq(graphNodes.parent_node_id, fromNodeId), isNull(graphNodes.deleted_at))).get();
        if ((childrenCount?.count ?? 0) >= 7) return c.json({ error: "Max 7 children allowed" }, 400);
        const byId = new Map(nodes.map((n) => [n.id, n]));
        byId.set(toNode.id, { ...toNode, parent_node_id: fromNodeId });
        if (depthOf(toNode.id, byId as Map<string, { parent_node_id: string | null }>) > 5) {
          return c.json({ error: "Max depth: 5 levels" }, 400);
        }
        db.update(graphNodes).set({ parent_node_id: fromNodeId, updated_at: now }).where(eq(graphNodes.id, toNodeId)).run();
      }

      db.insert(graphEdges).values({
        id: uuidv4(),
        from_node_id: fromNodeId,
        to_node_id: toNodeId,
        edge_type: edgeType,
        order_index: typeof body.orderIndex === "number" ? body.orderIndex : null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      }).run();

      return c.json({ data: { message: "Edge created" } }, 201);
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  router.patch("/position", async (c) => {
    try {
      const body = await c.req.json();
      const nodeId = typeof body.nodeId === "string" ? body.nodeId : "";
      const view = body.view;
      if (!nodeId || (view !== "canvas" && view !== "library")) return c.json({ error: "nodeId and view are required" }, 400);
      const { db } = ctx();
      const now = new Date().toISOString();
      const node = db.select().from(graphNodes).where(and(eq(graphNodes.id, nodeId), isNull(graphNodes.deleted_at))).get();
      if (!node) return c.json({ error: "Node not found" }, 404);
      const pos = db.select().from(graphNodePositions).where(eq(graphNodePositions.node_id, nodeId)).get();
      if (!pos) {
        db.insert(graphNodePositions).values({ node_id: nodeId, view, x: body.x ?? null, y: body.y ?? null, library_sort_key: `1-${node.created_at}`, updated_at: now }).run();
      } else {
        db.update(graphNodePositions).set({ view, x: body.x ?? null, y: body.y ?? null, updated_at: now }).where(eq(graphNodePositions.node_id, nodeId)).run();
      }
      return c.json({ data: { message: "Position updated" } });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  return router;
}
