import { useState, useRef, useEffect } from "react";
import { searchApi } from "../api/client";
import type { SearchResult } from "../api/client";
import { Search, X, FolderOpen } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function SearchView() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchApi.search(query.trim());
        setResults(data);
        setSearched(true);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3 mb-4">
          <Search size={24} className="text-slate-400" />
          Search
        </h2>

        {/* Search input */}
        <div className="relative">
          <Search
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            ref={inputRef}
            className="input-base !pl-11 !pr-10"
            placeholder="Search to-dos..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              <X size={14} className="text-slate-400" />
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {loading && (
        <div className="text-sm text-slate-400 animate-pulse-soft py-8 text-center">
          Searching...
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="flex flex-col items-center py-16 text-center">
          <Search size={32} className="text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm text-slate-400 dark:text-slate-500">
            No results for "{query}"
          </p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </p>
          <AnimatePresence>
            {results.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="glass rounded-xl px-4 py-3.5"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center ${
                      item.is_completed
                        ? "bg-indigo-500 border-indigo-500"
                        : "border-slate-300 dark:border-slate-600"
                    }`}
                  >
                    {item.is_completed === 1 && (
                      <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white">
                        <path
                          d="M2 6l3 3 5-6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm ${
                        item.is_completed
                          ? "line-through text-slate-400 dark:text-slate-500"
                          : ""
                      }`}
                    >
                      {item.title}
                    </p>
                    {item.description && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 line-clamp-1">
                        {item.description}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <FolderOpen size={11} className="text-slate-400 dark:text-slate-500" />
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        {item.group.name}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
