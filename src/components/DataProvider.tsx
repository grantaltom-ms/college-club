"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { DashboardData } from "@/lib/types";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: DashboardData };

const Context = createContext<{ state: State; reload: () => void } | null>(null);

async function fetchDashboard(signal?: AbortSignal): Promise<State> {
  try {
    const res = await fetch("/api/dashboard", { signal, cache: "no-store" });
    const body = await res.json();
    if (!res.ok) return { status: "error", message: body?.error ?? "The data could not be loaded." };
    return { status: "ready", data: body as DashboardData };
  } catch (error) {
    if ((error as Error).name === "AbortError") return { status: "loading" };
    return { status: "error", message: "The data could not be loaded. Check your connection and try again." };
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchDashboard(controller.signal).then((next) => {
      if (!controller.signal.aborted) setState(next);
    });
    return () => controller.abort();
  }, []);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    fetchDashboard().then(setState);
  }, []);

  return <Context.Provider value={{ state, reload }}>{children}</Context.Provider>;
}

/** Renders children only once data has loaded; shows plain loading and error states otherwise. */
export function WithData({ children }: { children: (data: DashboardData) => ReactNode }) {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("WithData must be used inside DataProvider");
  const { state, reload } = ctx;
  if (state.status === "loading") {
    return (
      <p className="status" role="status">
        Loading member data
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div className="status-error" role="alert">
        <p>{state.message}</p>
        <button type="button" className="link-button" onClick={reload}>
          Try again
        </button>
      </div>
    );
  }
  return <>{children(state.data)}</>;
}
