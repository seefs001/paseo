export interface FileReferenceRange {
  lineStart: number;
  lineEnd: number;
}

export function formatFileReference(filePath: string, range: FileReferenceRange): string {
  const lines =
    range.lineStart === range.lineEnd
      ? String(range.lineStart)
      : `${range.lineStart}-${range.lineEnd}`;
  return `${filePath}:${lines}`;
}
