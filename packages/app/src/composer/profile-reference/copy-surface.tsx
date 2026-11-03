import type { ReactNode } from "react";

/** Native text selection copies what it shows; only web can rewrite the copied text. */
export function ReferenceCopySurface({ children }: { children: ReactNode }) {
  return children;
}
