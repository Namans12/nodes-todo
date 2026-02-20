import { useState, useRef, useEffect, useMemo } from "react";
import { useApp } from "../context/AppContext";
import { todosApi } from "../api/client";
import TodoItem from "./TodoItem";
import ConnectionInline from "./ConnectionInline";
import { Plus, ListChecks } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";

export default function TodoList() {
  const { todos, selectedGroupId, groups, connections, refreshTodos } = useApp();
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [showDescField, setShowDescField] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);
  const activeTodos = todos.filter((t) => !t.deleted_at);
  const completedCount = activeTodos.filter((t) => t.is_completed).length;

  // Build a set of todo IDs that belong to a connection
  // and find connections that include todos from this group
  const { connectedTodoIds, groupConnections } = useMemo(() => {
    const ids = new Set<string>();
    const groupConns: typeof connections = [];

    for (const conn of connections) {
      const hasGroupTodo = conn.items.some((item) =>
        activeTodos.some((t) => t.id === item.todo_id)
      );
      if (hasGroupTodo) {
        groupConns.push(conn);
        for (const item of conn.items) {
          ids.add(item.todo_id);
        }
      }
    }
    return { connectedTodoIds: ids, groupConnections: groupConns };
  }, [connections, activeTodos]);

  // Solo todos = not part of any connection
  const soloTodos = activeTodos.filter((t) => !connectedTodoIds.has(t.id));

  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAdding]);

  useEffect(() => {
    if (showDescField && descRef.current) {
      descRef.current.focus();
    }
  }, [showDescField]);

  const handleCreate = async () => {
    const title = newTitle.trim();
    if (!title || !selectedGroupId) return;
    try {
      await todosApi.create(selectedGroupId, title, newDescription.trim() || undefined);
      setNewTitle("");
      setNewDescription("");
      setShowDescField(false);
      await refreshTodos();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to create todo");
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && e.shiftKey) {
      // Shift+Enter → show description field
      e.preventDefault();
      setShowDescField(true);
    } else if (e.key === "Enter") {
      // Enter → create todo immediately
      e.preventDefault();
      handleCreate();
    } else if (e.key === "Escape") {
      setNewTitle("");
      setNewDescription("");
      setShowDescField(false);
      setIsAdding(false);
    }
  };

  const handleDescKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // Enter in desc → create todo
      e.preventDefault();
      handleCreate();
    } else if (e.key === "Escape") {
      setShowDescField(false);
    }
  };

  if (!selectedGroupId || !selectedGroup) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center mb-4">
          <ListChecks size={32} className="text-indigo-500/50" />
        </div>
        <h2 className="text-lg font-semibold text-slate-400 dark:text-slate-500 mb-2">
          No group selected
        </h2>
        <p className="text-sm text-slate-400 dark:text-slate-600">
          Select a group from the sidebar or create a new one.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold tracking-tight mb-1">
          {selectedGroup.name}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {activeTodos.length === 0
            ? "No to-dos yet"
            : `${completedCount} of ${activeTodos.length} completed`}
        </p>
        {activeTodos.length > 0 && (
          <div className="mt-3 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full"
              initial={{ width: 0 }}
              animate={{
                width: `${activeTodos.length ? (completedCount / activeTodos.length) * 100 : 0}%`,
              }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
        )}
      </div>

      {/* Connections in this group */}
      {groupConnections.length > 0 && (
        <div className="space-y-2 mb-4">
          <AnimatePresence mode="popLayout">
            {groupConnections.map((conn) => (
              <ConnectionInline key={conn.id} connection={conn} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Solo todos (not part of any connection) */}
      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {soloTodos
            .sort((a, b) => a.position - b.position)
            .map((todo) => (
              <TodoItem key={todo.id} todo={todo} />
            ))}
        </AnimatePresence>
      </div>

      {/* Add todo */}
      <div className="mt-4">
        <AnimatePresence mode="wait">
          {isAdding ? (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
            >
              <input
                ref={inputRef}
                className="input-base"
                placeholder="What needs to be done?"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                onBlur={() => {
                  if (!newTitle.trim() && !showDescField) setIsAdding(false);
                }}
              />
              {showDescField && (
                <textarea
                  ref={descRef}
                  className="input-base !py-2 text-sm resize-none mt-2"
                  placeholder="Add a description..."
                  rows={2}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  onKeyDown={handleDescKeyDown}
                />
              )}
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 ml-1">
                <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-xs font-mono">Enter</kbd> to add
                · <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-xs font-mono">Shift+Enter</kbd> for description
                · <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-xs font-mono">Esc</kbd> to cancel
              </p>
            </motion.div>
          ) : (
            <motion.button
              key="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdding(true)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl
                border-2 border-dashed border-slate-200 dark:border-slate-800
                text-slate-400 dark:text-slate-500
                hover:border-indigo-300 dark:hover:border-indigo-500/30
                hover:text-indigo-500 dark:hover:text-indigo-400
                transition-all duration-200 group"
            >
              <Plus
                size={18}
                className="group-hover:rotate-90 transition-transform duration-300"
              />
              <span className="text-sm font-medium">Add a to-do</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}
