import { useState, useRef, useEffect } from "react";
import { todosApi } from "../api/client";
import { useApp } from "../context/AppContext";
import type { Todo } from "../types";
import {
  Trash2,
  ChevronDown,
  Pencil,
  Check,
} from "lucide-react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";

interface TodoItemProps {
  todo: Todo;
}

export default function TodoItem({ todo }: TodoItemProps) {
  const { refreshTodos, refreshConnections } = useApp();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(todo.title);
  const [editDesc, setEditDesc] = useState(todo.description ?? "");
  const [isChecking, setIsChecking] = useState(false);
  const [descriptionMode, setDescriptionMode] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && titleRef.current) titleRef.current.focus();
  }, [isEditing]);

  useEffect(() => {
    if (descriptionMode && descRef.current) descRef.current.focus();
  }, [descriptionMode]);

  const handleToggle = async () => {
    setIsChecking(true);
    try {
      await todosApi.toggleComplete(todo.id);
      // Delay refresh after animation
      setTimeout(async () => {
        await refreshTodos();
        await refreshConnections();
        setIsChecking(false);
      }, 400);
    } catch {
      toast.error("Failed to update");
      setIsChecking(false);
    }
  };

  const handleDelete = async () => {
    try {
      await todosApi.delete(todo.id);
      await refreshTodos();
      await refreshConnections();
      toast.success("Moved to trash");
    } catch {
      toast.error("Failed to delete");
    }
  };

  const handleSaveEdit = async () => {
    const title = editTitle.trim();
    if (!title) return;
    try {
      await todosApi.update(todo.id, {
        title,
        description: editDesc.trim() || undefined,
      });
      await refreshTodos();
      setIsEditing(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  };

  const handleSaveDescription = async () => {
    try {
      await todosApi.update(todo.id, {
        description: editDesc.trim() || undefined,
      });
      await refreshTodos();
      setDescriptionMode(false);
    } catch {
      toast.error("Failed to save description");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (e.shiftKey) {
        // Shift+Enter → add/edit description
        e.preventDefault();
        handleSaveEdit();
        setDescriptionMode(true);
      } else {
        handleSaveEdit();
      }
    }
    if (e.key === "Escape") {
      setIsEditing(false);
      setEditTitle(todo.title);
      setEditDesc(todo.description ?? "");
    }
  };

  const isCompleted = todo.is_completed === 1;
  const showStrike = isCompleted || isChecking;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -24, transition: { duration: 0.2 } }}
      transition={{ duration: 0.25 }}
      className="group/todo glass rounded-xl overflow-hidden"
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        {/* Checkbox */}
        <button
          onClick={handleToggle}
          className={`
            mt-0.5 flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center
            transition-all duration-300
            ${
              isCompleted
                ? "bg-indigo-500 border-indigo-500 text-white"
                : "border-slate-300 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500"
            }
            ${isChecking ? "animate-check-bounce" : ""}
          `}
        >
          {isCompleted && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 25 }}
            >
              <Check size={12} strokeWidth={3} />
            </motion.div>
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="space-y-2">
              <input
                ref={titleRef}
                className="input-base !py-2 text-sm"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <textarea
                className="input-base !py-2 text-sm resize-none"
                placeholder="Add a description (optional)..."
                rows={2}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setIsEditing(false);
                  }
                }}
              />
              <div className="flex items-center gap-2">
                <button onClick={handleSaveEdit} className="btn-primary !py-1.5 !px-3 text-xs">
                  Save
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditTitle(todo.title);
                    setEditDesc(todo.description ?? "");
                  }}
                  className="btn-ghost !py-1.5 !px-3 text-xs"
                >
                  Cancel
                </button>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto">
                  Shift+Enter for description
                </span>
              </div>
            </div>
          ) : descriptionMode ? (
            <div className="space-y-2">
              <p className={`text-sm ${showStrike ? "text-slate-400 dark:text-slate-500" : ""}`}>
                {todo.title}
              </p>
              <textarea
                ref={descRef}
                className="input-base !py-2 text-sm resize-none !ring-emerald-500/50 !border-emerald-500 focus:!ring-emerald-500/50 focus:!border-emerald-500"
                placeholder="Add a description..."
                rows={2}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSaveDescription();
                  }
                  if (e.key === "Escape") setDescriptionMode(false);
                }}
              />
              <div className="flex gap-2">
                <button onClick={handleSaveDescription} className="btn-primary !py-1.5 !px-3 text-xs">
                  Save
                </button>
                <button
                  onClick={() => setDescriptionMode(false)}
                  className="btn-ghost !py-1.5 !px-3 text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              {/* Title with strikethrough */}
              <div className="flex items-center gap-2">
                <span
                  className={`
                    text-sm todo-strike ${showStrike ? "struck" : ""}
                    ${isCompleted ? "text-slate-400 dark:text-slate-500" : ""}
                    transition-colors duration-300
                  `}
                >
                  {todo.title}
                </span>
              </div>

              {/* Description subtext */}
              {todo.description && (
                <p
                  className={`mt-0.5 text-xs leading-relaxed pl-0.5 line-clamp-2 ${
                    isCompleted
                      ? "text-slate-300 dark:text-slate-600"
                      : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {todo.description}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {!isEditing && !descriptionMode && (
          <div className="flex items-center gap-1 opacity-0 group-hover/todo:opacity-100 transition-opacity duration-200">
            <button
              onClick={() => {
                setEditTitle(todo.title);
                setEditDesc(todo.description ?? "");
                setIsEditing(true);
              }}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title="Edit"
            >
              <Pencil size={14} className="text-slate-400" />
            </button>
            <button
              onClick={() => {
                setEditDesc(todo.description ?? "");
                setDescriptionMode(true);
              }}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title="Add description (Shift+Enter)"
            >
              <ChevronDown size={14} className="text-slate-400" />
            </button>
            <button
              onClick={handleDelete}
              className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
              title="Delete"
            >
              <Trash2 size={14} className="text-slate-400 hover:text-red-500" />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
