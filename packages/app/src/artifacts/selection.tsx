import type { ReactNode } from "react";

export interface ArtifactSelectionProps {
  children: ReactNode;
  onQuote?: (text: string) => void;
}

export function ArtifactSelection({ children }: ArtifactSelectionProps) {
  return children;
}
