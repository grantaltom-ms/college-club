"use client";

import { useCallback, useEffect, useState } from "react";

export type JsonState<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

/** Loads one JSON endpoint for a page, with a plain error message and a way to try again. */
export function useJson<T>(url: string, failMessage: string): { state: JsonState<T>; retry: () => void } {
  const [state, setState] = useState<JsonState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        setState(res.ok ? { status: "ready", data: body as T } : { status: "error", message: body?.error ?? failMessage });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: failMessage });
      });
    return () => {
      cancelled = true;
    };
  }, [url, failMessage, attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}
