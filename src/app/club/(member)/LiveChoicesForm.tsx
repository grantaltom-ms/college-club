"use client";

import type { FormEvent, ReactNode } from "react";

/**
 * A GET form that re-checks as soon as a choice changes (length, crew, who it is for). The "Check my choices" button stays
 * for people without JavaScript and for the browser tests that press it on purpose.
 */
export function LiveChoicesForm({ action, children, className }: { action: string; children: ReactNode; className?: string }) {
  const onChange = (event: FormEvent<HTMLFormElement>) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "SELECT" || (target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox")) {
      event.currentTarget.requestSubmit();
    }
  };
  return (
    <form method="get" action={action} className={className} onChange={onChange}>
      {children}
    </form>
  );
}
