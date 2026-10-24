"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/club/web-actions";

/**
 * Runs a staff server action from a form and keeps what it said. The page is not reloaded by the browser: when the action
 * worked, the page's own data is refreshed, so the new charge, entry or closed month shows up where it belongs.
 */
export function useStaffAction(action: (data: FormData) => Promise<ActionResult>) {
  const router = useRouter();
  const [state, setState] = useState<ActionResult>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const run = (form: HTMLFormElement, afterOk?: () => void) => {
    const data = new FormData(form);
    startTransition(async () => {
      const result = await action(data);
      setState(result);
      if (result.kind === "ok") {
        afterOk?.();
        router.refresh();
      }
    });
  };
  return { state, pending, run };
}
