const STYLE_ID = "paseo-markdown-containment";

// The markdown root is a column flex item. Its min-content width is the longest
// unbreakable run. A row of inline code, or nowrap inherited from a parent,
// paints past the message column. Lock the root to the column and restore wrapping.
const CSS = `
.enrm-text {
  min-width: 0;
  width: 100%;
  max-width: 100%;
}
.enrm-text > * {
  min-width: 0;
  max-width: 100%;
}
.enrm-text :is(p, li, blockquote, h1, h2, h3, h4, h5, h6) {
  white-space: normal;
  overflow-wrap: break-word;
}
.enrm-text :not(pre) > code {
  white-space: break-spaces;
  overflow-wrap: anywhere;
}
`;

export function ensureMarkdownContainment(): void {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(STYLE_ID);
  if (existing) {
    if (existing.textContent !== CSS) existing.textContent = CSS;
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
