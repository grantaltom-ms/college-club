import Link from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className"> & {
  href: string;
  /** "sun" is the one primary action on a screen; "outline" is a quieter second action. */
  variant?: "sun" | "outline";
  /** "large" is the full-width phone size (52px). */
  size?: "default" | "large";
  className?: string;
  children: ReactNode;
};

/** A pill-shaped button that is really a link. A page of this site uses Next's Link; anything else (a #section, another address) is a plain link. */
export function ButtonLink({ href, variant = "sun", size = "default", className, children, ...rest }: Props) {
  const classes = ["ds-button", variant === "outline" ? "ds-button-outline" : "", size === "large" ? "ds-button-large" : "", className ?? ""].filter(Boolean).join(" ");
  const ofThisSite = href.startsWith("/") && !href.startsWith("//");
  return ofThisSite ? (
    <Link href={href} className={classes} {...rest}>
      {children}
    </Link>
  ) : (
    <a href={href} className={classes} {...rest}>
      {children}
    </a>
  );
}
