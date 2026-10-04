import { createSqliteConnection } from "./connection.js";

/**
 * Creates all tables in the SQLite database.
 * This is a simple migration that creates the schema from scratch.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */
export function runMigrations(dbPath?: string): void {
  const sqlite = createSqliteConnection(dbPath);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      position INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groups(id),
      title TEXT NOT NULL,
      description TEXT,
      high_priority INTEGER NOT NULL DEFAULT 0,
      reminder_at TEXT,
      is_completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connection_items (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES connections(id),
      todo_id TEXT NOT NULL REFERENCES todos(id),
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groups(id),
      todo_id TEXT REFERENCES todos(id),
      kind TEXT NOT NULL,
      parent_node_id TEXT,
      title TEXT,
      condition_type TEXT,
      condition_payload TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      from_node_id TEXT NOT NULL REFERENCES graph_nodes(id),
      to_node_id TEXT NOT NULL REFERENCES graph_nodes(id),
      edge_type TEXT NOT NULL,
      order_index INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS graph_node_positions (
      node_id TEXT PRIMARY KEY REFERENCES graph_nodes(id),
      view TEXT NOT NULL DEFAULT 'library',
      x INTEGER,
      y INTEGER,
      library_sort_key TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  // Backward-compatible migration for existing databases.
  const groupColumns = sqlite.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
  if (!groupColumns.some((col) => col.name === "deleted_at")) {
    sqlite.exec("ALTER TABLE groups ADD COLUMN deleted_at TEXT");
  }

  const todoColumns = sqlite.prepare("PRAGMA table_info(todos)").all() as { name: string }[];
  if (!todoColumns.some((col) => col.name === "high_priority")) {
    sqlite.exec("ALTER TABLE todos ADD COLUMN high_priority INTEGER NOT NULL DEFAULT 0");
  }
  if (!todoColumns.some((col) => col.name === "reminder_at")) {
    sqlite.exec("ALTER TABLE todos ADD COLUMN reminder_at TEXT");
  }
  if (!todoColumns.some((col) => col.name === "completed_at")) {
    sqlite.exec("ALTER TABLE todos ADD COLUMN completed_at TEXT");
  }

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_group ON graph_nodes(group_id);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_todo ON graph_nodes(todo_id);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_parent ON graph_nodes(parent_node_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges(from_node_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON graph_edges(to_node_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON graph_edges(edge_type);
  `);

  const atomicCount = sqlite
    .prepare("SELECT COUNT(*) AS count FROM graph_nodes WHERE kind = 'atomic'")
    .get() as { count: number };

  if (atomicCount.count === 0) {
    const now = new Date().toISOString();
    sqlite.exec(`
      INSERT INTO graph_nodes (id, group_id, todo_id, kind, parent_node_id, title, condition_type, condition_payload, created_at, updated_at, deleted_at)
      SELECT
        lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' ||
        substr('89ab',abs(random()) % 4 + 1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
        t.group_id,
        t.id,
        'atomic',
        NULL,
        NULL,
        NULL,
        NULL,
        COALESCE(t.created_at, '${now}'),
        COALESCE(t.updated_at, '${now}'),
        t.deleted_at
      FROM todos t
      WHERE NOT EXISTS (
        SELECT 1 FROM graph_nodes gn WHERE gn.todo_id = t.id
      );
    `);

    sqlite.exec(`
      INSERT INTO graph_node_positions (node_id, view, x, y, library_sort_key, updated_at)
      SELECT
        gn.id,
        'library',
        NULL,
        NULL,
        CASE
          WHEN t.high_priority = 1 THEN '0-' || COALESCE(t.created_at, '${now}')
          ELSE '1-' || COALESCE(t.created_at, '${now}')
        END,
        '${now}'
      FROM graph_nodes gn
      LEFT JOIN todos t ON t.id = gn.todo_id
      WHERE NOT EXISTS (
        SELECT 1 FROM graph_node_positions p WHERE p.node_id = gn.id
      );
    `);
  }

  sqlite.close();
}

// Run migrations if called directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("migrate.ts")) {
  console.log("Running migrations...");
  runMigrations();
  console.log("Migrations complete.");
}
