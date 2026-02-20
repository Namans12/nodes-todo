import { Hono } from "hono";
import { eq, and, asc, sql, isNull } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/connection.js";
import { connections, connectionItems, todos } from "../db/schema.js";

// Type for the injected DB (allows test override)
type DbOverride = ReturnType<typeof getDb>;

/**
 * Helper: build the response shape for a connection with its items and progress.
 */
function buildConnectionResponse(
  connection: { id: string; name: string | null; created_at: string },
  items: Array<{
    id: string;
    todo_id: string;
    title: string;
    is_completed: number;
    position: number;
  }>
) {
  const total = items.length;
  const completed = items.filter((i) => i.is_completed === 1).length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    id: connection.id,
    name: connection.name,
    items: items.map((i) => ({
      id: i.id,
      todo_id: i.todo_id,
      title: i.title,
      is_completed: i.is_completed,
      position: i.position,
    })),
    progress: {
      total,
      completed,
      percentage,
    },
    is_fully_complete: total > 0 && completed === total,
  };
}

/**
 * Creates the connections router.
 * Routes:
 *   POST   /api/connections                      — Create a connection with todo IDs
 *   GET    /api/connections                      — List all connections with progress
 *   GET    /api/connections/:id                  — Get connection detail + items
 *   PATCH  /api/connections/:id                  — Update connection name
 *   POST   /api/connections/:id/items            — Add a todo to a connection
 *   DELETE /api/connections/:id/items/:todoId    — Remove a todo from a connection
 *   DELETE /api/connections/:id                  — Delete a connection (not the todos)
 */
export function createConnectionsRouter(dbOverride?: DbOverride) {
  const router = new Hono();

  function db() {
    return dbOverride ?? getDb();
  }

  /**
   * Helper: fetch items for a connection, joining with todos table.
   * Excludes soft-deleted todos from the result.
   */
  function getConnectionItems(drizzleDb: ReturnType<typeof db>["db"], connectionId: string) {
    const items = drizzleDb
      .select({
        id: connectionItems.id,
        todo_id: connectionItems.todo_id,
        title: todos.title,
        is_completed: todos.is_completed,
        position: connectionItems.position,
      })
      .from(connectionItems)
      .innerJoin(todos, eq(connectionItems.todo_id, todos.id))
      .where(
        and(
          eq(connectionItems.connection_id, connectionId),
          isNull(todos.deleted_at)
        )
      )
      .orderBy(asc(connectionItems.position))
      .all();

    return items;
  }

  // POST /api/connections — Create a connection with todo IDs
  router.post("/", async (c) => {
    try {
      const body = await c.req.json();
      const { name, todoIds } = body;

      // Validate todoIds
      if (!Array.isArray(todoIds) || todoIds.length < 2) {
        return c.json(
          { error: "todoIds must be an array with at least 2 items" },
          400
        );
      }

      // Validate all todoIds are strings
      for (const id of todoIds) {
        if (typeof id !== "string" || id.trim().length === 0) {
          return c.json(
            { error: "Each todoId must be a non-empty string" },
            400
          );
        }
      }

      // Check for duplicates in the input
      const uniqueIds = new Set(todoIds);
      if (uniqueIds.size !== todoIds.length) {
        return c.json({ error: "Duplicate todoIds are not allowed" }, 400);
      }

      const { db: drizzleDb, sqlite } = db();

      // Validate all todos exist and are not soft-deleted
      for (const todoId of todoIds) {
        const todo = drizzleDb
          .select()
          .from(todos)
          .where(and(eq(todos.id, todoId), isNull(todos.deleted_at)))
          .get();

        if (!todo) {
          return c.json(
            { error: `Todo with id '${todoId}' not found or is deleted` },
            404
          );
        }
      }

      // Check that none of the todos already belong to 2 connections (max allowed)
      for (const todoId of todoIds) {
        const existingCount = drizzleDb
          .select()
          .from(connectionItems)
          .where(eq(connectionItems.todo_id, todoId))
          .all().length;

        if (existingCount >= 2) {
          return c.json(
            {
              error: `Todo '${todoId}' already belongs to ${existingCount} connections. A todo can belong to at most 2 connections.`,
            },
            400
          );
        }
      }

      // Validate name if provided
      if (name !== undefined && name !== null) {
        if (typeof name !== "string") {
          return c.json({ error: "Name must be a string" }, 400);
        }
      }

      const now = new Date().toISOString();
      const connectionId = uuidv4();
      const trimmedName =
        name !== undefined && name !== null && typeof name === "string"
          ? name.trim() || null
          : null;

      // Create connection and items in a transaction
      const transaction = sqlite.transaction(() => {
        drizzleDb
          .insert(connections)
          .values({
            id: connectionId,
            name: trimmedName,
            created_at: now,
          })
          .run();

        for (let i = 0; i < todoIds.length; i++) {
          drizzleDb
            .insert(connectionItems)
            .values({
              id: uuidv4(),
              connection_id: connectionId,
              todo_id: todoIds[i],
              position: i,
            })
            .run();
        }
      });
      transaction();

      // Fetch the created connection with items
      const connection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, connectionId))
        .get()!;

      const items = getConnectionItems(drizzleDb, connectionId);
      const response = buildConnectionResponse(connection, items);

      return c.json({ data: response }, 201);
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // GET /api/connections — List all connections with progress
  router.get("/", async (c) => {
    try {
      const { db: drizzleDb } = db();

      const allConnections = drizzleDb
        .select()
        .from(connections)
        .orderBy(asc(connections.created_at))
        .all();

      const result = allConnections.map((conn) => {
        const items = getConnectionItems(drizzleDb, conn.id);
        return buildConnectionResponse(conn, items);
      });

      return c.json({ data: result });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // GET /api/connections/:id — Get connection detail + items
  router.get("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const { db: drizzleDb } = db();

      const connection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, id))
        .get();

      if (!connection) {
        return c.json({ error: "Connection not found" }, 404);
      }

      const items = getConnectionItems(drizzleDb, id);
      const response = buildConnectionResponse(connection, items);

      return c.json({ data: response });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // PATCH /api/connections/:id — Update connection name
  router.patch("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json();
      const { name } = body;

      const { db: drizzleDb } = db();

      // Check connection exists
      const connection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, id))
        .get();

      if (!connection) {
        return c.json({ error: "Connection not found" }, 404);
      }

      // Validate name
      if (name === undefined) {
        return c.json({ error: "Name field is required" }, 400);
      }

      let updatedName: string | null;
      if (name === null) {
        updatedName = null;
      } else if (typeof name === "string") {
        updatedName = name.trim() || null;
      } else {
        return c.json({ error: "Name must be a string or null" }, 400);
      }

      drizzleDb
        .update(connections)
        .set({ name: updatedName })
        .where(eq(connections.id, id))
        .run();

      // Return updated connection with items
      const updated = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, id))
        .get()!;

      const items = getConnectionItems(drizzleDb, id);
      const response = buildConnectionResponse(updated, items);

      return c.json({ data: response });
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // POST /api/connections/:id/items — Add a todo to a connection
  router.post("/:id/items", async (c) => {
    try {
      const connectionId = c.req.param("id");
      const body = await c.req.json();
      const { todoId } = body;

      if (!todoId || typeof todoId !== "string" || todoId.trim().length === 0) {
        return c.json(
          { error: "todoId is required and must be a non-empty string" },
          400
        );
      }

      const { db: drizzleDb } = db();

      // Check connection exists
      const connection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, connectionId))
        .get();

      if (!connection) {
        return c.json({ error: "Connection not found" }, 404);
      }

      // Check todo exists and is not soft-deleted
      const todo = drizzleDb
        .select()
        .from(todos)
        .where(and(eq(todos.id, todoId), isNull(todos.deleted_at)))
        .get();

      if (!todo) {
        return c.json({ error: "Todo not found or is deleted" }, 404);
      }

      // Check if todo already belongs to 2 connections (max allowed)
      const existingCount = drizzleDb
        .select()
        .from(connectionItems)
        .where(eq(connectionItems.todo_id, todoId))
        .all().length;

      // Also check it's not already in THIS specific connection
      const alreadyInThis = drizzleDb
        .select()
        .from(connectionItems)
        .where(
          and(
            eq(connectionItems.connection_id, connectionId),
            eq(connectionItems.todo_id, todoId)
          )
        )
        .get();

      if (alreadyInThis) {
        return c.json(
          {
            error: "Todo already belongs to this connection.",
          },
          400
        );
      }

      if (existingCount >= 2) {
        return c.json(
          {
            error:
              "Todo already belongs to 2 connections. A todo can belong to at most 2 connections.",
          },
          400
        );
      }

      // Get the max position within this connection
      const maxPosResult = drizzleDb
        .select({
          maxPos: sql<number>`COALESCE(MAX(${connectionItems.position}), -1)`,
        })
        .from(connectionItems)
        .where(eq(connectionItems.connection_id, connectionId))
        .get();
      const nextPosition = (maxPosResult?.maxPos ?? -1) + 1;

      // Insert the new connection item
      drizzleDb
        .insert(connectionItems)
        .values({
          id: uuidv4(),
          connection_id: connectionId,
          todo_id: todoId,
          position: nextPosition,
        })
        .run();

      // Return the updated connection
      const items = getConnectionItems(drizzleDb, connectionId);
      const response = buildConnectionResponse(connection, items);

      return c.json({ data: response });
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // DELETE /api/connections/:id/items/:todoId — Remove a todo from a connection
  router.delete("/:id/items/:todoId", async (c) => {
    try {
      const connectionId = c.req.param("id");
      const todoId = c.req.param("todoId");

      const { db: drizzleDb, sqlite } = db();

      // Check connection exists
      const connection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, connectionId))
        .get();

      if (!connection) {
        return c.json({ error: "Connection not found" }, 404);
      }

      // Check the todo is in this connection
      const item = drizzleDb
        .select()
        .from(connectionItems)
        .where(
          and(
            eq(connectionItems.connection_id, connectionId),
            eq(connectionItems.todo_id, todoId)
          )
        )
        .get();

      if (!item) {
        return c.json(
          { error: "Todo is not part of this connection" },
          404
        );
      }

      // Count current items in the connection
      const countResult = drizzleDb
        .select({ count: sql<number>`COUNT(*)` })
        .from(connectionItems)
        .where(eq(connectionItems.connection_id, connectionId))
        .get();
      const currentCount = countResult?.count ?? 0;

      if (currentCount <= 1) {
        // Removing the last item: auto-delete the connection
        const transaction = sqlite.transaction(() => {
          drizzleDb
            .delete(connectionItems)
            .where(eq(connectionItems.connection_id, connectionId))
            .run();

          drizzleDb
            .delete(connections)
            .where(eq(connections.id, connectionId))
            .run();
        });
        transaction();

        return c.json({
          data: { message: "Connection deleted (last item removed)" },
        });
      }

      // Remove the item
      drizzleDb
        .delete(connectionItems)
        .where(
          and(
            eq(connectionItems.connection_id, connectionId),
            eq(connectionItems.todo_id, todoId)
          )
        )
        .run();

      // Return updated connection
      const updatedConnection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, connectionId))
        .get()!;

      const items = getConnectionItems(drizzleDb, connectionId);
      const response = buildConnectionResponse(updatedConnection, items);

      return c.json({ data: response });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // DELETE /api/connections/:id — Delete a connection (not the todos)
  router.delete("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const { db: drizzleDb, sqlite } = db();

      // Check connection exists
      const connection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, id))
        .get();

      if (!connection) {
        return c.json({ error: "Connection not found" }, 404);
      }

      // Delete connection and its items in a transaction
      const transaction = sqlite.transaction(() => {
        drizzleDb
          .delete(connectionItems)
          .where(eq(connectionItems.connection_id, id))
          .run();

        drizzleDb
          .delete(connections)
          .where(eq(connections.id, id))
          .run();
      });
      transaction();

      return c.json({
        data: { message: "Connection deleted successfully" },
      });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  return router;
}
