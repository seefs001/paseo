import type { Nodes, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTable } from "micromark-extension-gfm-table";
import {
  MARKDOWN_COPY_IGNORE_ATTRIBUTE,
  MARKDOWN_COPY_TAG_ATTRIBUTE,
} from "@/assistant-selection-copy/markup";
import { prepareMarkdownSource } from "@/components/markdown/source";
import type { FileReferenceSelection } from "../reference/toolbar.web";

interface MarkdownSourceInput {
  source: string;
  body: string;
  workspaceRoot?: string;
}

interface MarkdownSourceBlock {
  node: RootContent;
  lineStart: number;
  lineEnd: number;
}

interface MarkdownSelectionInput {
  root: HTMLElement;
  blocks: MarkdownSourceBlock[];
}

export function createMarkdownSourceMap({
  source,
  body,
  workspaceRoot,
}: MarkdownSourceInput): MarkdownSourceBlock[] | null {
  const prepared = prepareMarkdownSource(body, workspaceRoot, { supportsSvg: true });
  // Source adaptation can split or remove blocks. Without a source map, even an
  // equal number of rendered blocks cannot prove which original block they came from.
  if (prepared.images.length > 0 || prepared.render() !== body) return null;

  const tree = fromMarkdown(body, {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  });
  if (!tree.children.every(canMapNode)) return null;

  const prefix = source.slice(0, source.length - body.length);
  const lineOffset = prefix.split(/\r\n|\r|\n/).length - 1;
  const blocks: MarkdownSourceBlock[] = [];
  for (const node of tree.children) {
    if (node.type === "definition") continue;
    if (!node.position) return null;
    blocks.push({
      node,
      lineStart: node.position.start.line + lineOffset,
      lineEnd: node.position.end.line + lineOffset,
    });
  }
  return blocks;
}

function canMapNode(node: Nodes): boolean {
  if (node.type === "html" || node.type === "image" || node.type === "imageReference") return false;
  if (node.type === "code" && node.lang?.toLowerCase() === "mermaid") return false;
  return !("children" in node) || node.children.every(canMapNode);
}

function matchesBlock(element: Element, { node }: MarkdownSourceBlock): boolean {
  switch (node.type) {
    case "paragraph":
      return element.tagName === "P";
    case "heading":
      return element.tagName === `H${node.depth}`;
    case "blockquote":
      return element.tagName === "BLOCKQUOTE";
    case "list":
      return element.tagName === (node.ordered ? "OL" : "UL");
    case "code":
      return (
        element.tagName === "DIV" &&
        element.querySelector(`[${MARKDOWN_COPY_TAG_ATTRIBUTE}="pre"]`) !== null
      );
    case "table":
      return (
        element.tagName === "DIV" &&
        element.children.length === 1 &&
        element.firstElementChild?.tagName === "TABLE"
      );
    case "thematicBreak":
      return element.tagName === "HR";
    default:
      return false;
  }
}

export function readMarkdownReferenceSelection({
  root,
  blocks,
}: MarkdownSelectionInput): FileReferenceSelection | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const markdownRoots = root.querySelectorAll(".enrm-text");
  if (markdownRoots.length !== 1) return null;
  const markdown = markdownRoots[0];
  if (markdown.getAttribute("aria-busy") !== "false") return null;

  const range = selection.getRangeAt(0);
  const isInside = markdown.contains(range.startContainer) && markdown.contains(range.endContainer);
  if (!isInside) return null;

  const elements = Array.from(markdown.children);
  if (elements.length !== blocks.length) return null;
  const mapped = new Map<Element, MarkdownSourceBlock>();
  for (const [index, element] of elements.entries()) {
    const block = blocks[index];
    if (!matchesBlock(element, block)) return null;
    mapped.set(element, block);
  }

  const selectedBlocks = selectedTextBlocks({ markdown, range, mapped });
  if (!selectedBlocks) return null;
  const rect = range.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    lineStart: selectedBlocks.first.lineStart,
    lineEnd: selectedBlocks.last.lineEnd,
  };
}

interface SelectedTextBlocksInput {
  markdown: Element;
  range: Range;
  mapped: Map<Element, MarkdownSourceBlock>;
}

interface SelectedBlocks {
  first: MarkdownSourceBlock;
  last: MarkdownSourceBlock;
}

function selectedTextBlocks({
  markdown,
  range,
  mapped,
}: SelectedTextBlocksInput): SelectedBlocks | null {
  const walker = markdown.ownerDocument.createTreeWalker(markdown, NodeFilter.SHOW_TEXT);
  let first: MarkdownSourceBlock | null = null;
  let last: MarkdownSourceBlock | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text) || !range.intersectsNode(node)) continue;
    // An end boundary at the next text node's offset zero selects none of that block.
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (end <= start) continue;
    if (node.parentElement?.closest(`[${MARKDOWN_COPY_IGNORE_ATTRIBUTE}]`)) continue;

    let element = node.parentElement;
    while (element && element.parentElement !== markdown) element = element.parentElement;
    const block = element ? mapped.get(element) : undefined;
    if (!block) return null;
    if (!first) first = block;
    last = block;
  }
  if (!first || !last) return null;
  return { first, last };
}
