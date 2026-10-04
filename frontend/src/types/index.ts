export interface Group {
  id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Todo {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  high_priority: number;
  reminder_at: string | null;
  is_completed: number;
  completed_at: string | null;
  position: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrashItem extends Todo {
  group_name: string;
  group_deleted: boolean;
  group_deleted_at: string | null;
  days_until_purge: number;
}

export interface ConnectionItem {
  id: string;
  todo_id: string;
  title: string;
  is_completed: number;
  high_priority: number;
  completed_at: string | null;
  position: number;
}

export interface ConnectionProgress {
  total: number;
  completed: number;
  percentage: number;
}

export interface Connection {
  id: string;
  name: string | null;
  items: ConnectionItem[];
  progress: ConnectionProgress;
  is_fully_complete: boolean;
  created_at: string;
}

export interface GraphNode {
  id: string;
  group_id: string;
  todo_id: string | null;
  kind: "atomic" | "composite" | "milestone" | "conditional";
  parent_node_id: string | null;
  title: string;
  description: string | null;
  condition_type: string | null;
  condition_payload: string | null;
  created_at: string;
  updated_at: string;
  view: "canvas" | "library";
  x: number | null;
  y: number | null;
  library_sort_key: string | null;
  is_completed: number;
  is_blocked: boolean;
  is_connected: boolean;
  priority: number;
  completed_at: string | null;
}

export interface GraphEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: "sequential" | "dependency" | "parallel_group" | "hierarchy" | "soft_association";
  order_index: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface GraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  roots: string[];
}

export type View = "todos" | "trash" | "connections" | "search" | "graph";
