import { useState, useEffect } from "react";
import { trashApi } from "../api/client";
import { useApp } from "../context/AppContext";
import type { TrashItem } from "../types";
import { Trash2, RotateCcw, AlertTriangle, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";

export default function TrashView() {
  const { refreshTodos, refreshConnections } = useApp();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await trashApi.list();
      setItems(data);
    } catch {
      toast.error("Failed to load trash");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleRestore = async (id: string) => {
    try {
      await trashApi.restore(id);
      setItems((prev) => prev.filter((t) => t.id !== id));
      await refreshTodos();
      toast.success("Restored");
    } catch {
      toast.error("Failed to restore");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await trashApi.deletePermanently(id);
      setItems((prev) => prev.filter((t) => t.id !== id));
      await refreshConnections();
      toast.success("Permanently deleted");
    } catch {
      toast.error("Failed to delete");
    }
  };

  const handleEmptyTrash = async () => {
    if (!confirm("Permanently delete all items in trash?")) return;
    try {
      await trashApi.empty();
      setItems([]);
      await refreshConnections();
      toast.success("Trash emptied");
    } catch {
      toast.error("Failed to empty trash");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="animate-pulse-soft text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Trash2 size={24} className="text-slate-400" />
            Trash
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Items are permanently deleted after 30 days.
          </p>
        </div>
        {items.length > 0 && (
          <button onClick={handleEmptyTrash} className="btn-danger text-xs">
            Empty Trash
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
            <Trash2 size={28} className="text-slate-300 dark:text-slate-600" />
          </div>
          <p className="text-sm text-slate-400 dark:text-slate-500">
            Trash is empty
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {items.map((item) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -24 }}
                className="glass rounded-xl px-4 py-3.5 flex items-center gap-3 group/trash"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-500 dark:text-slate-400 line-through">
                    {item.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Clock size={12} className="text-slate-400 dark:text-slate-500" />
                    <span
                      className={`text-xs ${
                        item.days_until_purge <= 5
                          ? "text-red-500"
                          : "text-slate-400 dark:text-slate-500"
                      }`}
                    >
                      {item.days_until_purge} day{item.days_until_purge !== 1 ? "s" : ""} until
                      permanent deletion
                    </span>
                    {item.days_until_purge <= 5 && (
                      <AlertTriangle size={12} className="text-red-500" />
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover/trash:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleRestore(item.id)}
                    className="p-2 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
                    title="Restore"
                  >
                    <RotateCcw size={14} className="text-indigo-500" />
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                    title="Delete permanently"
                  >
                    <Trash2 size={14} className="text-red-500" />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
