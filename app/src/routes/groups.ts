import { Hono } from "hono";
import { eq, asc, sql, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/connection.js";
import { groups, todos, connectionItems, connections } from "../db/schema.js";

// Type for the injected DB (allows test override)
type DbOverride = ReturnType<typeof getDb>;

export function createGroupsRouter(dbOverride?: DbOverride) {
  const router = new Hono();

  function db() {
    return dbOverride ?? getDb();
  }

  // POST /api/groups — Create a group
  router.post("/", async (c) => {
    try {
      const body = await c.req.json();
      const { name } = body;

      // Validation
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return c.json({ error: "Name is required and must be a non-empty string" }, 400);
      }

      if (name.trim().length > 100) {
        return c.json({ error: "Name must be at most 100 characters" }, 400);
      }

      const trimmedName = name.trim();
      const { db: drizzleDb, sqlite } = db();

      // Check for duplicate name
      const existing = drizzleDb
        .select()
        .from(groups)
        .where(eq(groups.name, trimmedName))
        .get();

      if (existing) {
        return c.json({ error: "A group with this name already exists" }, 400);
      }

      const now = new Date().toISOString();
      const newGroup = {
        id: uuidv4(),
        name: trimmedName,
        position: 0,
        created_at: now,
        updated_at: now,
      };

      // Wrap position read + insert in a transaction for atomicity
      const transaction = sqlite.transaction(() => {
        const maxPosResult = drizzleDb
          .select({ maxPos: sql<number>`COALESCE(MAX(${groups.position}), -1)` })
          .from(groups)
          .get();
        const nextPosition = (maxPosResult?.maxPos ?? -1) + 1;
        newGroup.position = nextPosition;

        drizzleDb.insert(groups).values(newGroup).run();
      });
      transaction();

      return c.json({ data: newGroup }, 201);
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // GET /api/groups — List all groups sorted by position
  router.get("/", async (c) => {
    try {
      const { db: drizzleDb } = db();
      const allGroups = drizzleDb
        .select()
        .from(groups)
        .orderBy(asc(groups.position))
        .all();

      return c.json({ data: allGroups });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // PATCH /api/groups/reorder — Reorder groups (must be before :id route)
  router.patch("/reorder", async (c) => {
    try {
      const body = await c.req.json();
      const { items } = body;

      if (!Array.isArray(items) || items.length === 0) {
        return c.json({ error: "Items must be a non-empty array of { id, position }" }, 400);
      }

      // Validate each item has id and position
      for (const item of items) {
        if (!item.id || typeof item.position !== "number") {
          return c.json({ error: "Each item must have an id (string) and position (number)" }, 400);
        }
      }

      const { db: drizzleDb, sqlite } = db();

      // Run in a transaction
      const transaction = sqlite.transaction(() => {
        const now = new Date().toISOString();
        for (const item of items) {
          drizzleDb
            .update(groups)
            .set({ position: item.position, updated_at: now })
            .where(eq(groups.id, item.id))
            .run();
        }
      });
      transaction();

      // Return updated groups
      const updatedGroups = drizzleDb
        .select()
        .from(groups)
        .orderBy(asc(groups.position))
        .all();

      return c.json({ data: updatedGroups });
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // GET /api/groups/:id — Get a single group
  router.get("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const { db: drizzleDb } = db();

      const group = drizzleDb
        .select()
        .from(groups)
        .where(eq(groups.id, id))
        .get();

      if (!group) {
        return c.json({ error: "Group not found" }, 404);
      }

      return c.json({ data: group });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // PATCH /api/groups/:id — Update group name
  router.patch("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json();
      const { name } = body;

      // Validation
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return c.json({ error: "Name is required and must be a non-empty string" }, 400);
      }

      if (name.trim().length > 100) {
        return c.json({ error: "Name must be at most 100 characters" }, 400);
      }

      const trimmedName = name.trim();
      const { db: drizzleDb } = db();

      // Check group exists
      const group = drizzleDb
        .select()
        .from(groups)
        .where(eq(groups.id, id))
        .get();

      if (!group) {
        return c.json({ error: "Group not found" }, 404);
      }

      // Check for duplicate name (excluding self)
      const duplicate = drizzleDb
        .select()
        .from(groups)
        .where(eq(groups.name, trimmedName))
        .get();

      if (duplicate && duplicate.id !== id) {
        return c.json({ error: "A group with this name already exists" }, 400);
      }

      const now = new Date().toISOString();
      drizzleDb
        .update(groups)
        .set({ name: trimmedName, updated_at: now })
        .where(eq(groups.id, id))
        .run();

      const updated = drizzleDb
        .select()
        .from(groups)
        .where(eq(groups.id, id))
        .get();

      return c.json({ data: updated });
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // DELETE /api/groups/:id — Delete group + cascade soft-delete its todos
  router.delete("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const { db: drizzleDb, sqlite } = db();

      // Check group exists
      const group = drizzleDb
        .select()
        .from(groups)
        .where(eq(groups.id, id))
        .get();

      if (!group) {
        return c.json({ error: "Group not found" }, 404);
      }

      // Run in a transaction: clean up connection_items, orphaned connections,
      // todos and finally the group itself
      const transaction = sqlite.transaction(() => {
        // Get all todo IDs that belong to this group
        const groupTodos = drizzleDb
          .select({ id: todos.id })
          .from(todos)
          .where(eq(todos.group_id, id))
          .all();
        const todoIds = groupTodos.map((t) => t.id);

        if (todoIds.length > 0) {
          // Delete connection_items that reference these todos
          drizzleDb
            .delete(connectionItems)
            .where(inArray(connectionItems.todo_id, todoIds))
            .run();

          // Delete any connections that are now empty (no remaining items)
          const stillUsedItems = drizzleDb
            .select({ connId: connectionItems.connection_id })
            .from(connectionItems)
            .all();
          const stillUsedIds = [...new Set(stillUsedItems.map((r) => r.connId))];
          const allConns = drizzleDb
            .select({ id: connections.id })
            .from(connections)
            .all();
          const orphanedIds = allConns
            .filter((c) => !stillUsedIds.includes(c.id))
            .map((c) => c.id);
          if (orphanedIds.length > 0) {
            drizzleDb
              .delete(connections)
              .where(inArray(connections.id, orphanedIds))
              .run();
          }

          // Hard-delete the todos that belong to this group
          drizzleDb
            .delete(todos)
            .where(eq(todos.group_id, id))
            .run();
        }

        // Delete the group
        drizzleDb
          .delete(groups)
          .where(eq(groups.id, id))
          .run();
      });
      transaction();

      return c.json({ data: { message: "Group deleted successfully" } });
    } catch (err) {
      console.error("[DELETE /groups/:id] error:", err);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  return router;
}
