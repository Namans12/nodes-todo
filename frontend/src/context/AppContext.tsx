import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { Group, Todo, Connection, View } from "../types";
import { groupsApi, todosApi, connectionsApi } from "../api/client";
import toast from "react-hot-toast";

interface AppState {
  groups: Group[];
  selectedGroupId: string | null;
  todos: Todo[];
  connections: Connection[];
  currentView: View;
  loading: boolean;
  sidebarOpen: boolean;
}

interface AppContextType extends AppState {
  setCurrentView: (view: View) => void;
  selectGroup: (id: string | null) => void;
  refreshGroups: () => Promise<void>;
  refreshTodos: () => Promise<void>;
  refreshConnections: () => Promise<void>;
  setSidebarOpen: (open: boolean) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>({
    groups: [],
    selectedGroupId: null,
    todos: [],
    connections: [],
    currentView: "todos",
    loading: true,
    sidebarOpen: true,
  });

  const refreshGroups = useCallback(async () => {
    try {
      const groups = await groupsApi.list();
      setState((s) => {
        const groupStillExists = !!(s.selectedGroupId && groups.find((g) => g.id === s.selectedGroupId));
        return {
          ...s,
          groups,
          selectedGroupId: groupStillExists ? s.selectedGroupId : groups[0]?.id ?? null,
          // Clear stale todos immediately when the active group was deleted
          todos: groupStillExists ? s.todos : [],
        };
      });
    } catch (e) {
      toast.error("Failed to load groups");
      console.error(e);
    }
  }, []);

  const refreshTodos = useCallback(async () => {
    if (!state.selectedGroupId) {
      setState((s) => ({ ...s, todos: [] }));
      return;
    }
    try {
      const todos = await todosApi.list(state.selectedGroupId);
      setState((s) => ({ ...s, todos }));
    } catch (e) {
      toast.error("Failed to load todos");
      console.error(e);
    }
  }, [state.selectedGroupId]);

  const refreshConnections = useCallback(async () => {
    try {
      const connections = await connectionsApi.list();
      setState((s) => ({ ...s, connections }));
    } catch (e) {
      toast.error("Failed to load connections");
      console.error(e);
    }
  }, []);

  const selectGroup = useCallback((id: string | null) => {
    setState((s) => ({ ...s, selectedGroupId: id, currentView: "todos" }));
  }, []);

  const setCurrentView = useCallback((view: View) => {
    setState((s) => ({ ...s, currentView: view }));
  }, []);

  const setSidebarOpen = useCallback((open: boolean) => {
    setState((s) => ({ ...s, sidebarOpen: open }));
  }, []);

  // Initial load
  useEffect(() => {
    const init = async () => {
      await refreshGroups();
      await refreshConnections();
      setState((s) => ({ ...s, loading: false }));
    };
    init();
  }, [refreshGroups, refreshConnections]);

  // Refresh todos when group changes
  useEffect(() => {
    if (state.selectedGroupId) {
      refreshTodos();
    }
  }, [state.selectedGroupId, refreshTodos]);

  return (
    <AppContext.Provider
      value={{
        ...state,
        setCurrentView,
        selectGroup,
        refreshGroups,
        refreshTodos,
        refreshConnections,
        setSidebarOpen,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
