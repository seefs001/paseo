import type { ReactNode } from "react";

export interface MarkdownReferenceSelectionProps {
  source: string;
  body: string;
  filePath: string;
  children: ReactNode;
}

export function MarkdownReferenceSelection({ children }: MarkdownReferenceSelectionProps) {
  return children;
}
