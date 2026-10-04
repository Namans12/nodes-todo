import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  position: integer("position").notNull().default(0),
  deleted_at: text("deleted_at"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const todos = sqliteTable("todos", {
  id: text("id").primaryKey(),
  group_id: text("group_id")
    .notNull()
    .references(() => groups.id),
  title: text("title").notNull(),
  description: text("description"),
  high_priority: integer("high_priority").notNull().default(0),
  reminder_at: text("reminder_at"),
  is_completed: integer("is_completed").notNull().default(0),
  completed_at: text("completed_at"),
  position: integer("position").notNull().default(0),
  deleted_at: text("deleted_at"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  name: text("name"),
  created_at: text("created_at").notNull(),
});

export const connectionItems = sqliteTable("connection_items", {
  id: text("id").primaryKey(),
  connection_id: text("connection_id")
    .notNull()
    .references(() => connections.id),
  todo_id: text("todo_id")
    .notNull()
    .references(() => todos.id),
  position: integer("position").notNull().default(0),
});

export const graphNodes = sqliteTable("graph_nodes", {
  id: text("id").primaryKey(),
  group_id: text("group_id")
    .notNull()
    .references(() => groups.id),
  todo_id: text("todo_id").references(() => todos.id),
  kind: text("kind").notNull(), // atomic | composite | milestone | conditional
  parent_node_id: text("parent_node_id"),
  title: text("title"),
  condition_type: text("condition_type"),
  condition_payload: text("condition_payload"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
  deleted_at: text("deleted_at"),
});

export const graphEdges = sqliteTable("graph_edges", {
  id: text("id").primaryKey(),
  from_node_id: text("from_node_id")
    .notNull()
    .references(() => graphNodes.id),
  to_node_id: text("to_node_id")
    .notNull()
    .references(() => graphNodes.id),
  edge_type: text("edge_type").notNull(), // sequential | dependency | parallel_group | hierarchy | soft_association
  order_index: integer("order_index"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
  deleted_at: text("deleted_at"),
});

export const graphNodePositions = sqliteTable("graph_node_positions", {
  node_id: text("node_id")
    .primaryKey()
    .references(() => graphNodes.id),
  view: text("view").notNull().default("library"), // canvas | library
  x: integer("x"),
  y: integer("y"),
  library_sort_key: text("library_sort_key"),
  updated_at: text("updated_at").notNull(),
});
