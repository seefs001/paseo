import { afterEach, describe, expect, it } from "vitest";

import { ensureMarkdownContainment } from "./containment";

const COLUMN_WIDTH = 420;
const MARKDOWN = `新会话 <code>01a14f8e-e8c6-7483-b384-3626301e4393</code> 已验证通过。首轮只声明了 7 个工具：<code>read</code>、<code>bash</code>、<code>edit</code>、<code>write</code>、<code>codemode</code>、<code>tool_search</code>、<code>web_enable</code>。<code>web_search</code>、<code>source_check</code>、<code>fetch_content</code>、<code>get_search_content</code> 和全部 ScopeWeaver 工具都不在首轮里。`;

function mountColumn(whiteSpace: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = `
    <div style="width:${COLUMN_WIDTH}px;${whiteSpace}">
      <div class="enrm-text" style="display:flex;flex-direction:column">
        <p style="font:15px/22px system-ui,sans-serif;margin:0">${MARKDOWN}</p>
      </div>
    </div>
  `;
  document.body.append(host);
  return host;
}

function column(host: HTMLElement): HTMLElement {
  const element = host.firstElementChild;
  if (!(element instanceof HTMLElement)) throw new Error("missing column");
  return element;
}

describe("markdown containment", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.getElementById("paseo-markdown-containment")?.remove();
  });

  it("wraps a row of inline code inside the column when a parent forbids wrapping", () => {
    const host = mountColumn("white-space:nowrap");
    const box = column(host);
    const prose = box.querySelector("p");
    if (!prose) throw new Error("missing paragraph");
    expect(prose.scrollWidth).toBeGreaterThan(box.clientWidth);

    ensureMarkdownContainment();

    expect(prose.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
    const tops = [...box.querySelectorAll("code")].map((code) =>
      Math.round(code.getBoundingClientRect().top),
    );
    expect(new Set(tops).size).toBeGreaterThan(1);
  });
});
