import { Hono } from "hono";
import { eq, isNotNull, sql, inArray } from "drizzle-orm";
import { getDb } from "../db/connection.js";
import { todos, connectionItems, connections } from "../db/schema.js";

// Type for the injected DB (allows test override)
type DbOverride = ReturnType<typeof getDb>;

/**
 * Creates the trash router for managing soft-deleted todos.
 * Routes:
 *   GET    /api/trash              — List all soft-deleted todos with remaining days
 *   POST   /api/trash/:id/restore  — Restore a soft-deleted todo
 *   DELETE /api/trash/:id          — Permanently delete a single todo
 *   DELETE /api/trash              — Empty entire trash permanently
 */
export function createTrashRouter(dbOverride?: DbOverride) {
  const router = new Hono();

  function db() {
    return dbOverride ?? getDb();
  }

  // GET /api/trash — List all soft-deleted todos with remaining days until purge
  router.get("/", async (c) => {
    try {
      const { db: drizzleDb } = db();

      const deletedTodos = drizzleDb
        .select()
        .from(todos)
        .where(isNotNull(todos.deleted_at))
        .all();

      const now = new Date();
      const PURGE_DAYS = 30;

      const result = deletedTodos.map((todo) => {
        const deletedAt = new Date(todo.deleted_at!);
        const msElapsed = now.getTime() - deletedAt.getTime();
        const daysElapsed = msElapsed / (1000 * 60 * 60 * 24);
        const daysRemaining = Math.max(0, Math.ceil(PURGE_DAYS - daysElapsed));

        return {
          ...todo,
          days_until_purge: daysRemaining,
        };
      });

      return c.json({ data: result });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // POST /api/trash/:id/restore — Restore a soft-deleted todo
  router.post("/:id/restore", async (c) => {
    try {
      const id = c.req.param("id");
      const { db: drizzleDb } = db();

      // Find the todo
      const todo = drizzleDb
        .select()
        .from(todos)
        .where(eq(todos.id, id))
        .get();

      if (!todo) {
        return c.json({ error: "Todo not found" }, 404);
      }

      if (!todo.deleted_at) {
        return c.json({ error: "Todo is not in trash" }, 400);
      }

      const now = new Date().toISOString();

      drizzleDb
        .update(todos)
        .set({ deleted_at: null, updated_at: now })
        .where(eq(todos.id, id))
        .run();

      const restored = drizzleDb
        .select()
        .from(todos)
        .where(eq(todos.id, id))
        .get();

      return c.json({ data: restored });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // DELETE /api/trash/:id — Permanently delete a single todo from trash
  router.delete("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const { db: drizzleDb, sqlite } = db();

      // Find the todo
      const todo = drizzleDb
        .select()
        .from(todos)
        .where(eq(todos.id, id))
        .get();

      if (!todo) {
        return c.json({ error: "Todo not found" }, 404);
      }

      if (!todo.deleted_at) {
        return c.json({ error: "Todo is not in trash. Use DELETE /api/todos/:id to soft-delete first." }, 400);
      }

      // Run in a transaction: remove connection_items referencing this todo,
      // clean up now-empty connections, then hard-delete the todo
      const transaction = sqlite.transaction(() => {
        // Remove any connection_items referencing this todo
        drizzleDb
          .delete(connectionItems)
          .where(eq(connectionItems.todo_id, id))
          .run();

        // Delete any connections that now have zero items
        const stillUsed = drizzleDb
          .select({ connId: connectionItems.connection_id })
          .from(connectionItems)
          .all();
        const stillUsedIds = [...new Set(stillUsed.map((r) => r.connId))];
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

        // Hard-delete the todo
        drizzleDb
          .delete(todos)
          .where(eq(todos.id, id))
          .run();
      });
      transaction();

      return c.json({ data: { message: "Todo permanently deleted" } });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // DELETE /api/trash — Empty entire trash permanently
  router.delete("/", async (c) => {
    try {
      const { db: drizzleDb, sqlite } = db();

      // Get all soft-deleted todo IDs
      const trashedTodos = drizzleDb
        .select({ id: todos.id })
        .from(todos)
        .where(isNotNull(todos.deleted_at))
        .all();

      if (trashedTodos.length === 0) {
        return c.json({ data: { message: "Trash is already empty", deleted_count: 0 } });
      }

      const transaction = sqlite.transaction(() => {
        // Remove connection_items referencing trashed todos
        for (const todo of trashedTodos) {
          drizzleDb
            .delete(connectionItems)
            .where(eq(connectionItems.todo_id, todo.id))
            .run();
        }

        // Delete any connections that now have zero items
        const stillUsed = drizzleDb
          .select({ connId: connectionItems.connection_id })
          .from(connectionItems)
          .all();
        const stillUsedIds = [...new Set(stillUsed.map((r) => r.connId))];
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

        // Hard-delete all soft-deleted todos
        drizzleDb
          .delete(todos)
          .where(isNotNull(todos.deleted_at))
          .run();
      });
      transaction();

      // Run VACUUM to reclaim space after bulk delete
      sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      sqlite.exec("VACUUM");

      return c.json({
        data: {
          message: "Trash emptied successfully",
          deleted_count: trashedTodos.length,
        },
      });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  return router;
}

/**
 * Auto-purge: permanently deletes todos that have been in trash for more than 30 days.
 * Also cleans up orphaned connection_items and runs VACUUM.
 *
 * @param dbOverride - Optional DB override for testing
 * @returns The number of purged todos
 */
export function runAutoPurge(dbOverride?: DbOverride): number {
  const { db: drizzleDb, sqlite } = dbOverride ?? getDb();

  // Find todos with deleted_at older than 30 days
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);
  const cutoffIso = cutoffDate.toISOString();

  const expiredTodos = drizzleDb
    .select({ id: todos.id })
    .from(todos)
    .where(
      sql`${todos.deleted_at} IS NOT NULL AND ${todos.deleted_at} < ${cutoffIso}`
    )
    .all();

  if (expiredTodos.length === 0) {
    return 0;
  }

  const transaction = sqlite.transaction(() => {
    // Remove connection_items referencing expired todos
    for (const todo of expiredTodos) {
      drizzleDb
        .delete(connectionItems)
        .where(eq(connectionItems.todo_id, todo.id))
        .run();
    }

    // Delete any connections that now have zero items
    const stillUsed = drizzleDb
      .select({ connId: connectionItems.connection_id })
      .from(connectionItems)
      .all();
    const stillUsedIds = [...new Set(stillUsed.map((r) => r.connId))];
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

    // Hard-delete all expired todos
    for (const todo of expiredTodos) {
      drizzleDb
        .delete(todos)
        .where(eq(todos.id, todo.id))
        .run();
    }
  });
  transaction();

  // WAL checkpoint and VACUUM to reclaim space
  sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  sqlite.exec("VACUUM");

  return expiredTodos.length;
}

/**
 * Starts the auto-purge scheduler.
 * Runs once immediately and then every 6 hours.
 *
 * @param dbOverride - Optional DB override for testing
 * @returns The interval ID (for cleanup on shutdown)
 */
export function startAutoPurgeScheduler(dbOverride?: DbOverride): NodeJS.Timeout {
  // Run immediately on startup
  try {
    const purgedCount = runAutoPurge(dbOverride);
    if (purgedCount > 0) {
      console.log(`Auto-purge: permanently deleted ${purgedCount} expired todo(s)`);
    }
  } catch (error) {
    console.error("Auto-purge startup error:", error);
  }

  // Run every 6 hours (21,600,000 ms)
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  const intervalId = setInterval(() => {
    try {
      const purgedCount = runAutoPurge(dbOverride);
      if (purgedCount > 0) {
        console.log(`Auto-purge: permanently deleted ${purgedCount} expired todo(s)`);
      }
    } catch (error) {
      console.error("Auto-purge periodic error:", error);
    }
  }, SIX_HOURS);

  return intervalId;
}
