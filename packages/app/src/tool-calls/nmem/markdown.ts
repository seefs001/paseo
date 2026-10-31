import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

// MD4C reads a single ~ as strikethrough, so two bare ~/ paths strike out the prose
// between them. URLs keep their tildes because an escape would end MD4C's autolink.
const LONE_TILDE = /(?:https?:\/\/|www\.)\S+|(?<![\\~])~(?!~)/g;

interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * nmem bodies are stored data: keep lone tildes and tag-like text such as
 * `<permissions instructions>` literal while the rest still renders as Markdown.
 * Code, `~~strikethrough~~` and autolinks are left untouched.
 */
export function literalNmemMarkdown(source: string): string {
  if (!source.includes("~") && !source.includes("<")) return source;
  const edits: Edit[] = [];
  function visit(node: Nodes) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    if (node.type === "html") {
      edits.push({ start, end: start, text: "\\" });
      return;
    }
    if (node.type === "link" && source[start] === "<") return;
    if (node.type === "text") {
      const raw = source.slice(start, end);
      const text = raw.replace(LONE_TILDE, (match) => (match === "~" ? "\\~" : match));
      if (text !== raw) edits.push({ start, end, text });
      return;
    }
    if ("children" in node) node.children.forEach(visit);
  }
  // Without flow HTML every tag parses as its own inline node, so escaping its `<`
  // keeps that tag as text instead of swallowing the lines after it.
  visit(fromMarkdown(source, { extensions: [{ disable: { null: ["htmlFlow"] } }] }));
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}
