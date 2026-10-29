# Fork 变更记录

本文记录 `seefs001/paseo` 的 `dev` 分支相对上游 `getpaseo/paseo` 仍保留的差异。上游版本更新继续查看 [CHANGELOG.md](CHANGELOG.md)，这里不重复收录。

## 对比范围

截至 **2026-10-17**：

| 项目                  | 提交 / 范围                                                       |
| --------------------- | ----------------------------------------------------------------- |
| 本地 `dev`            | `47ef9e6e0`（本地提交，尚未推送）                                 |
| 已合入的上游 `main`   | [`88a7aec1b`](https://github.com/getpaseo/paseo/commit/88a7aec1b) |
| 核对时上游远端 `main` | [`f472c9d1f`](https://github.com/getpaseo/paseo/commit/f472c9d1f) |
| 相对已合入上游的提交  | 23 个非合并提交，另有 46 个合并提交                               |
| 已提交净差异          | 130 个文件，新增 8,966 行、删除 337 行                            |

下文按当前净差异归纳，不把上游同步、合并提交或已被上游吸收的旧修复当作 fork 新功能。工作区中尚未提交的改动单独列在文末。

## 当前保留的功能与改进

### 输入框引用 Agent 会话与配置

- 在 `@` 自动补全中，除文件外，可以选择当前主机已加载的未归档 Agent 会话和保存的 Agent 配置（Profile）；排除当前会话，不做跨主机搜索。
- 会话引用携带 Agent ID、模型、工作目录等定位信息；配置引用携带创建 Agent 所需的配置资料。引用不会自动附带整段会话历史，也不会直接创建或启动 Agent。
- 引用在输入框和发送后的消息中保留为可点击的标签，可以打开详情，不再把整张资料卡铺进用户消息气泡。
- 改进候选项的名称、Provider 标识和区分方式；从消息创建分支会话时保留引用上下文。

相关提交：[`0376b9b82`](https://github.com/seefs001/paseo/commit/0376b9b82)、[`a1b31df8a`](https://github.com/seefs001/paseo/commit/a1b31df8a)、[`395d4b102`](https://github.com/seefs001/paseo/commit/395d4b102)、[`96c0244d1`](https://github.com/seefs001/paseo/commit/96c0244d1)、[`125e44b70`](https://github.com/seefs001/paseo/commit/125e44b70)。

### 共享 Skill 选择器

- 输入 `$`、`¥` 或 `￥` 搜索宿主机 `~/.agents/skills` 中的共享 Skill，按名称和描述筛选。
- 已有会话和新建工作区草稿共用选择器。选择后插入指向 `SKILL.md` 的 Markdown 链接，供 Agent 读取，不复制整份 Skill 内容，也不安装或自动执行 Skill。
- 支持指向共享技能仓库的符号链接；单个无效文件或损坏链接不会阻止其余 Skill 显示。
- 显示使用次数，按使用频次、最近使用时间排序；统计按提交去重，保存在当前 `PASEO_HOME`。
- 宿主机未连接、目录为空或宿主机不支持该功能时，给出明确提示。

相关提交：[`d7f3f28dd`](https://github.com/seefs001/paseo/commit/d7f3f28dd)。

### 会话切换、批量重命名与侧栏排序

- 增加当前工作区的会话列表，汇总各面板中已打开的普通 Agent 标签，按最近对话活动排序并快速切换；不包含文件、终端、Provider 原生子 Agent 或已归档会话。
- 支持为列表中的会话批量生成标题，每批最多 100 个：填写命名要求，预览建议，逐项编辑和勾选，再确认应用。命名要求会保存供下次使用。
- 标题预览可读取磁盘上的会话记录，不要求目标会话已在内存中加载。空会话或已不可用的会话会跳过，标题已被其他操作修改时不会直接覆盖。
- 侧栏工作区的“最近活动”排序纳入 Agent 更新和流式输出，不再只依赖工作区状态切换时间。

相关提交：[`6336d364d`](https://github.com/seefs001/paseo/commit/6336d364d)、[`518cd0de0`](https://github.com/seefs001/paseo/commit/518cd0de0)。

### 从子 Agent 返回父 Agent

- 子 Agent 页面增加返回父 Agent 的入口，支持跨工作区返回，不关闭或归档子会话。
- 同时支持 Paseo 管理的子 Agent 和 Provider 原生子 Agent；嵌套子 Agent 可以逐级返回上层。

相关提交：[`a01a914fc`](https://github.com/seefs001/paseo/commit/a01a914fc)。

### Cursor 模型参数联动

- 在上游已有的参数化模型选择基础上，补全思考档位、Fast 和上下文参数的联动；新建草稿按所选模型读取选项，不再误用默认模型的参数。
- 优先使用当前模型的 `effort` 或 `reasoning` 作为思考档位，补充上下文选项；具体选项以 Cursor CLI 实际宣告为准，不保证每个模型都有 Fast 或上下文设置。
- 恢复旧会话时，把历史上保存的带参数模型 ID 拆回基础模型和独立参数，避免继续提交不兼容的模型标识。

相关提交：[`3f1cdea1c`](https://github.com/seefs001/paseo/commit/3f1cdea1c)。

### Grok Build 权限、用量与输出速度

- 为 Grok 提供独立的 `Ask`、`Auto`、`Always approve` 权限模式；不再把 ACP 的对话模式误当成工具权限模式。
- 创建会话时传入权限设置，运行中切换时通过 Grok 的 ACP 扩展通知同步，修复界面已切换但 Provider 未收到更新的问题。
- 在上游已有的 Grok 接入和 ACP 用量统计上补全上下文更新、USD 成本及输出速度的映射。Grok 基础接入和初始斜杠命令等待已由上游提供，不计为 fork 独有功能。
- 在上下文详情中显示已完成回合的平均输出速度（token/s）。计算使用 Grok 上报的输出 token 数与模型 API 累计耗时，包含请求延迟；不是实时瞬时速度，也不包含工具执行时间。

相关提交：[`ab4a95858`](https://github.com/seefs001/paseo/commit/ab4a95858)、[`45e31111c`](https://github.com/seefs001/paseo/commit/45e31111c)、[`b6462d44b`](https://github.com/seefs001/paseo/commit/b6462d44b)、[`84c3a5a17`](https://github.com/seefs001/paseo/commit/84c3a5a17)。

### Grok 与 Cursor 的原生系统指令

- Grok 通过会话 `_meta.rules` 接收 Agent 指令和宿主机追加指令，保留 Grok 自带的系统提示词。指令随原生会话保存，修改后需要新建 Grok 会话。
- Cursor 通过工作区内受 Paseo 管理的 `.cursor/rules/paseo.mdc` 应用指令，不把系统指令伪装成用户消息。
- Cursor 规则由同一工作区的 Cursor 会话共享，最近一次受管理的启动或重载会更新它；不会覆盖同路径下不属于 Paseo 的文件或符号链接。

相关提交：[`22754b917`](https://github.com/seefs001/paseo/commit/22754b917)。使用限制见 [Provider 系统指令说明](docs/providers.md#system-prompts)。

### Claude / Codex 的 MCP 自动批准开关

- 在 Agent 控制区增加独立的 MCP 盾牌开关，默认关闭，用于自动批准 MCP 工具调用。
- Claude 自动放行 MCP 工具请求；Codex 对本次启动配置中的 MCP 服务应用自动批准，保留已有工具白名单限制。
- Codex 仅自动接受不含必填字段的 MCP 表单请求；URL 请求和含必填字段的表单仍拒绝。该开关不等同于全局自动批准，不改变原生 Shell、文件等工具的权限或沙箱设置。

相关提交：[`8089d85f4`](https://github.com/seefs001/paseo/commit/8089d85f4)。

### ACP 工具详情与 Pi codemode 展示

- 为未归类的 ACP 工具保留原生名称和标题，补齐参数与调用详情；已识别的 Shell、Read、Search 等工具继续使用统一类别名。
- 清理工具结果中的 ANSI 颜色转义序列，避免详情中出现终端控制字符。
- 缩短搜索类工具的列表摘要，在展开详情时展示命中内容，避免长搜索结果挤占会话列表。
- 将 Pi `codemode` 发起的子工具调用收进父工具卡片，支持展开查看参数和结果；根据明确的父子调用关系归组，避免并行工具误合并或历史记录重复展示。

相关提交：[`4cf5baad7`](https://github.com/seefs001/paseo/commit/4cf5baad7)、[`7289ad357`](https://github.com/seefs001/paseo/commit/7289ad357)、[`6bf85c81d`](https://github.com/seefs001/paseo/commit/6bf85c81d)、[`f58cd77ba`](https://github.com/seefs001/paseo/commit/f58cd77ba)。

### 本地开发

- 开发启动脚本读取仓库根目录的 `.env.local`，可持久设置当前 checkout 的 `PASEO_HOME`。显式指向正式 `~/.paseo` 时，不重写其 daemon 监听配置；不要让开发 daemon 与正式应用同时占用同一数据目录。
- 忽略误生成在 TypeScript 源码目录中的 JavaScript 编译产物，同时保留 JavaScript 专用工具和测试夹具，减少工作区噪声。
- 当前 fork 额外忽略 `package-lock.json`。

相关提交：[`d139e3ae7`](https://github.com/seefs001/paseo/commit/d139e3ae7)、[`384cd1e6f`](https://github.com/seefs001/paseo/commit/384cd1e6f)、[`3f1cdea1c`](https://github.com/seefs001/paseo/commit/3f1cdea1c)。

## 已被上游吸收的历史修复

- [`bac74816f`](https://github.com/seefs001/paseo/commit/bac74816f) 曾为 Codex 的 GPT-6 Astra 开放 Fast 模式。当前代码已随上游改用 Provider 返回的服务档位（`service_tier`），这项旧模型白名单修复不再构成独立净差异。

## 尚未合入的上游更新

核对时，远端 `main` 比本地已合入基准多 3 个提交。这些不属于 fork 新功能：

- [`8555e8abd`](https://github.com/getpaseo/paseo/commit/8555e8abd)：修复正式版 iOS 构建向 TestFlight 测试者分发的问题（[#7189](https://github.com/getpaseo/paseo/pull/7189)）。
- [`ec9817ed2`](https://github.com/getpaseo/paseo/commit/ec9817ed2)：修复较矮屏幕上首页操作入口无法触达的问题（[#7167](https://github.com/getpaseo/paseo/pull/7167)）。
- [`f472c9d1f`](https://github.com/getpaseo/paseo/commit/f472c9d1f)：修正 Paseo Skill 中工作区来源参数的说明（[#7188](https://github.com/getpaseo/paseo/pull/7188)）。

## 工作区未提交改动

以下内容在核对时已存在于工作区，**未计入以上已提交的 `dev` 功能和差异统计**：

- **Skill 中文说明与排序**：从 frontmatter 的 `metadata.paseo` 读取中文短说明，区分“用户提示词”和“模型触发”，并优先排列用户提示词。涉及 Skill 目录、自动补全及对应测试。
- **Metro 源码解析**：本地导入命中同名 TypeScript 源码时优先使用源码，避免残留的 `.js` / `.mjs` 产物遮蔽新实现。
- **macOS 桌面 daemon 启动**：开发态也优先使用 Electron Helper 作为 Node 执行路径，不再只对打包应用启用。
- **协议校验生成**：AOT 生成器直接加载 TypeScript schema 并组装编译输入，避免过期 JavaScript 产物影响校验器生成。

本文件描述的是代码差异，不代表上述功能已在所有平台完成端到端验证。
