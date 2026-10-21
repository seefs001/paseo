# Fast 模式中间态调查

调查日期：2026-10-20。最小修复：2026-10-21。调查源码基线：`119a7c5bf33a5cbae35ee619772b90d3e51b9f2b`；下方调查源码行号对应该基线。

范围：草稿创建、已有会话配置修改、消息发送、模型切换和会话恢复。用户随后要求检查其他字段并最小修复。本次未重启运行中的 daemon，工作区已有的其他改动保持原样。下面的错误时序记录修复前行为，验证节分别记录原始复现和修复后检查。

## 结论

最小修复集中在三个位置：草稿未解析能力时保留全部显式 featureValues；manager 保存 provider 规范化后的完整 featureValues；Codex 默认配置读取作废后重新解析，不再覆盖后来的 model/thinking 选择。复查还发现 Claude 切模型关闭 Fast 属于同一种持久化问题，已沿用同一接口覆盖，并让失败的 Fast RPC 不提交新值。

草稿 model、mode、thinking 已有选择保护和提交加载屏障，本轮保留原实现。没有引入全局锁、配置协调器或新发送协议。普通已初始化 Pi 的同连接 Fast→send 曾验证请求正确，不能把所有快速操作归为一种竞态；跨客户端并发与完整 UI 发送顺序不在本次修复保证内。

## 1. 草稿在能力查询期间丢失提交参数

**最小修复：** feature resolver 区分未解析的 `undefined` 与已解析的空列表。前者保留合并后的显式配置，后者继续沿用能力过滤。hook 传入原始查询结果，不再先把未解析状态变成空列表。这覆盖所有 featureValues，包括 toggle 的 true/false、plan_mode 和 service_tier，不只 Fast；没有新增等待计时器或改动发送协议。

**证据：确定性复现，真实 hook + QueryClient + 提交校验 + config builder。能力到达由 QueryClient 注入，未接入真实网络查询；测试证明未解析输入下的丢值，不测实际发生频率。没有经过真实浏览器、WebSocket 或上游模型。**

两条路径都已复现：

1. 从模型 A 选择带 `fast_mode: true` 的模型 B Profile，B 的能力列表未返回，立即提交。
2. 同一个模型上开启 Fast，然后把 thinking 从 high 切到 xhigh。新组合的能力列表未返回，立即提交。

时序：

```text
用户明确选择 Fast=true
  → providerFeatures 查询 key 改变，当前 key 没有数据
  → 本地选择仍然存在，但对外 featureValues=undefined
  → 提交校验通过
  → 创建 config 不含 featureValues
  → 能力返回后，草稿又显示 Fast=true，已经捕获的 config 不会补上该值
```

根因和发送链路：

- `packages/app/src/hooks/use-draft-agent-features.ts:67`：查询 key 包含 host、provider、cwd、mode、model、thinking。变化不限于切模型。
- `packages/app/src/hooks/use-draft-agent-features.ts:90`：没有查询结果时转换成空能力列表。
- `packages/app/src/hooks/feature-preferences.ts:59`：只遍历已加载的能力投影显式值。能力未加载时，已有的用户选择也不会进入结果。
- `packages/app/src/hooks/use-draft-agent-features.ts:127`：空投影变成 `undefined`。第 117 行的 prune effect 会跳过未加载状态，因此这里首先是提交投影丢值，不是本地选择被删。
- `packages/app/src/composer/draft/input-draft.ts:276`：没有把 hook 的 loading 状态接入 composer 提交状态。
- `packages/app/src/composer/draft/workspace-tab-core.ts:14`：校验模型加载、连接等条件，不校验 feature resolution。
- `packages/app/src/composer/draft/workspace-tab.tsx:166` 与 `packages/app/src/screens/workspace/workspace-draft-agent-config.ts:17`：投影直接进入创建 config，`undefined` 被省略。
- `packages/app/src/composer/draft/create-flow.ts:208`：发送前等待保存 preferences，但调用的 createRequest 仍然捕获原先的 composerState；这不是等待能力加载的屏障。

这会导致新会话按默认值运行，而非用户明确选择的 Fast。投影同样会遗漏显式 `false`，但本次失败复现具体使用 `true`。不能把“没有指定”和“明确关闭”合并。

已有 `input-draft.live.test.tsx:254` 的三个 Profile 用例全部通过，因为它们在目标能力注入后才断言。将断言移动到能力到达前，结果为 `expected undefined to deeply equal { fast_mode: true }`。进一步接入实际提交校验和 config builder 后，校验通过，但 config 只有 provider、cwd、model。

## 2. 服务端运行时与持久化分离

### 2.1 Pi 明确关闭 Fast，恢复后重新打开

**最小修复：** AgentSession 可选提供只读完整 featureValues 快照，只包含可持久化 feature 状态。manager 在持久化、发布状态和转换为 closed 前同步；Pi/Codex/Claude 实现该 getter，provider wrapper 透传。未实现的 provider 保持原行为，明确返回空对象则清空旧值。没有把 launchConfig 或其中的运行时注入配置写回。

**修复前证据：真实 Pi 1.3.0 子进程、PiCliRuntime、生成扩展、AgentManager、临时磁盘会话和 localhost HTTP 端点。不是上游付费 API。**

```text
初始 fast_mode_by_model[A]=true
  → 运行一轮使会话持久化
  → setAgentFeature(false) 成功，UI/运行时显示 false
  → manager 保存 fast_mode=false，但 map[A] 仍为 true
  → reload 从旧 map 恢复
  → UI 变为 true，下一条实际 HTTP 请求带 service_tier=priority
```

根因跨越 manager 和 provider：

- `packages/server/src/server/agent/agent-manager.ts:5430` 的 prepareSessionConfig 分出 storedConfig 和 launchConfig；第 5458 行对启动配置创建新对象。
- `packages/server/src/server/agent/providers/pi/agent.ts:266` 的 writePiFastMode 替换 adapter 自己的 `config.featureValues`，同时维护标量和按模型 map。
- `packages/server/src/server/agent/agent-manager.ts:2091` 在 setFeature 成功后只把请求的单个键写到 manager config，拿不到 adapter 更新过的 map。
- `packages/server/src/server/agent/agent-manager.ts:5111` 只同步公开 `features`，没有同步完整可恢复配置。
- `packages/server/src/server/agent/providers/pi/agent.ts:226` 在恢复时按模型 map 优先于旧标量。因此磁盘中的 `{fast_mode:false, fast_mode_by_model:{A:true}}` 会重新启用 Fast。

这不是按钮显示延迟，也不需要快速点击。请求已成功、持久化已完成后，仍能恢复出相反值。只打开仍驻留的标签页不等于重载；此缺陷作用于显式 reload、closed session 加载及 daemon 重启后的恢复。

### 2.2 切换模型后，恢复把旧 Fast 带回来

**证据：真实 AgentManager、真实 provider adapter、隔离磁盘存储，可控 provider runtime。以下两项不是上游真实进程端到端。**

- **Pi：** A 开启 Fast，切到 B。B 的运行时显示 false，但 manager 仍保留无 map 的标量 true；reload B 后，legacy 标量绑定到 B，B 变为 true。
- **Codex：** A 支持 priority，切到不支持 tier 的 B，再回到 A。运行时已回到 default，manager 持久化配置仍是 priority；reload 后 priority 复活。

相关代码：Pi 的 `setModel` 在 `providers/pi/agent.ts:1934` 更新 adapter 的按模型状态；Codex 的 `reconcileServiceTier` 在 `providers/codex-app-server-agent.ts:3864` 更新 adapter 的 tier 和 featureValues。manager 的 `setAgentModel`（`agent-manager.ts:2038`）更新 model，不同步这些 provider 派生的可恢复 featureValues。

这一处完整快照同步同时保留 Pi 的按模型 map、Codex 规范化后的 service_tier、plan_mode、auto_accept_mcp 和未改变的其他 feature 值。只复制公开 features 不够，它没有其他模型的隐藏状态。

复查 Claude 的 `setModel` 会关闭新模型不支持的 Fast，同样只更新私有配置，因此一并接入完整快照。Claude 的 `applyFastModeFeature` 改为先等待 applyFlagSettings 成功再更新值，防止失败的 RPC 被后续快照保存。模型切换后的正常档位和失败后保持旧值均有针对性回归。

### 2.3 Codex 迟到的默认配置读取覆盖后来的模型选择

**证据：真实 Codex adapter + 可控 app-server transport。直接 adapter 入口可复现；正常 manager 已完成初始化的路径是否可达，尚未证明。**

```text
旧模型 A 未明确指定 thinking
  → 首次 startTurn 等待读取默认配置
  → setModel(B) 和 priority 均完成
  → 旧默认配置读取返回
  → config 被写回 A/medium，tier 被清为 default
  → getRuntimeInfo 返回 A/medium
  → 第二轮 turn/start 仍是 A/default
```

第二轮结果排除了“首轮按发送时旧配置运行”的解释，确实是后来的会话选择被覆盖。

`packages/server/src/server/agent/providers/codex-app-server-agent.ts:5233` 的 resolveModelAndThinking 在 await 前捕获 model/thinking；第 5291 行 applyDefaultModelAndThinking 在 await 后无条件写回并 reconcileServiceTier。

**最小修复：** model/thinking setter 更新一枚 revision。默认解析完成后只在 revision 未变时提交，否则重新读取当前配置再解析。回归覆盖 model 与 thinking 同改、仅 thinking 改变、显式 null reset、值变出去又变回来的 ABA，以及没有用户更改时保留原默认行为；全部检查运行时和第二轮请求。

## 3. 其他字段、已有保护与未证实的推测

其他字段检查范围：草稿 model、mode、thinking 的 reducer、有效配置构造和提交校验；服务端 model/thinking 默认解析、mode/thinking 事件同步及 feature setter。草稿选择的五个针对性用例与模型加载提交屏障用例通过，未复现这些已保护字段被迟到草稿默认值覆盖，因此保留原实现。Codex model/thinking 的 adapter 问题见 2.3。

- 会话加载已有屏障：`packages/server/src/server/agent/agent-loading.ts:72` 共享同一 agent 的初始化 promise，等待恢复和历史加载。不能声称所有“打开就发送”都会跳过恢复；已证实的是恢复输入里保存着错误配置。
- 偏好存储并非完全无序：`packages/app/src/create-agent-preferences/service.ts:42` 串行更新，并先等待初次 load。不能把所有现象都归因于 AsyncStorage 晚返回。
- 模型选择有用户修改跟踪和 optimistic preferences；这没有覆盖独立的 draft feature 投影。
- `packages/app/src/hooks/use-draft-agent-features.ts:185` 已保护显式 Profile 应用，避免被 provider/model 清理 effect 当作旧值。此次缺陷发生在之后的提交投影，不能用旧 Profile 修复已经存在来排除。
- `packages/app/src/utils/agent-directory-update-policy.ts:13` 对较旧 updatedAt 的目录更新保留现有元数据。本次没有证明普通旧目录快照会覆盖新的 Fast。
- 已有会话的 Fast 控件没有配置 pending 状态。`packages/app/src/composer/agent-controls/index.tsx:1703` 启动 RPC 后直接返回，`packages/app/src/composer/index.tsx:1620` 独立发送消息。这证明前端没有等待关系，不单独证明 Pi 的实际下一条上游请求必然使用旧 Fast。
- 对已初始化 Pi 1.3.0 的直接 provider 路径，用真实 Pi 子进程、生成扩展、真实 PiCliRuntime 和 localhost 假端点测试：`setFeature(true)` 不等 ACK 就 `startTurn`，捕获到的实际 HTTP body 仍为 `service_tier: priority`。该路径的 Fast handler 同步生效，不能据异步外观把它判为失败。此验证不包含真实 UI、生产 daemon 或上游计费。
- 桌面 toggle 从服务器当前 `feature.value` 取反（`packages/app/src/composer/agent-controls/index.tsx:1310`）。确认到达前连续点击可能重复发送同一个目标值，不能表示用户两次切换的意图。此项为静态推断，未做浏览器复现。

## 4. 状态契约与本次修复边界

下面是调查使用的目标契约。本轮只修已复现的提交丢值、完整 feature 持久化和 Codex 迟到默认读取，没有新增 pending UI、失败重试界面或配置/发送统一队列。仍不能把所有跨客户端或多 RPC 并发声称为已解决。

主体：一个 host/agent，或一个 draft 的配置。观测边界：创建 config、实际 turn 参数、持久化配置、恢复后的有效值。

需要区分三个事实：用户请求的配置、能力解析结果、provider 已应用的配置。当前实现把能力列表、运行时展示、持久化配置分别当作局部真相，缺少贯穿发送与恢复的契约。

| 状态/事件                       | 应有行为                                                   |
| ------------------------------- | ---------------------------------------------------------- |
| 能力未知时选择 Profile          | 保留显式值，进入待解析状态，不把未知解释成不支持           |
| 待解析时提交                    | 明确等待，或携带完整显式配置交给 daemon 验证；不得静默省略 |
| 能力返回                        | 只接收当前 host/provider/model/mode/thinking 对应的结果    |
| 不支持的显式配置                | 显示错误并保留用户意图，不悄悄退回默认值                   |
| 配置应用未确认时发送            | 在同一个 agent 的顺序边界内等待配置应用完成                |
| 配置应用失败                    | 保留可重试错误，不把失败值标记为已应用或写成成功默认值     |
| 应用成功                        | 更新运行时投影和可恢复配置，明确持久化完成的语义           |
| 切模型/恢复                     | 按该会话、该模型的配置恢复，不把另一模型的 Fast 标量迁入   |
| 重复点击/迟到响应               | 明确最新用户意图，旧响应不得覆盖新意图                     |
| 已提交/已关闭的草稿收到迟到结果 | 不改写已冻结的提交，不重建已经结束的草稿                   |

修复建议不是增加一个定时延迟。应在提交和配置所有权边界修复，再用可控 promise 验证乱序与未完成状态。

仓库已有可参照的契约：`packages/app/src/agent-profiles/internal/profile-form-model.test.ts:393` 明确要求 feature list pending 时仍保留提交的显式 featureValues。草稿创建应遵循同一语义，而不是通过等待所有 UI 数据来碰运气。

正式回归应包含：

- 浏览器控制能力请求的完成时机，在返回前点击发送。断言请求仍含显式 true/false，或者被明确等待；不能只检查最终控件。
- 同模型改 thinking/mode 与跨模型 Profile，分别覆盖缓存命中和未命中。
- 配置应用成功、失败、连续切换和发送交错。验证实际 turn 参数，而不只验证按钮或 RPC accepted。
- 设置 Fast 后落盘，再用新的 manager/provider 恢复，核对每个模型的 true/false。不要让测试中的 provider config 和 manager config 恰好共用一个对象而掩盖问题。
- 延迟默认配置读取，期间更改模型和 speed，最后核对后续会话配置和下一 turn，避免旧读取回写新选择。

## 5. 验证与复现资料

临时前端测试和输出已归档到 `/tmp/paseo-fast-research-20261020/`，不放入产品测试发现路径。它们沿用现有 hook 测试环境，只用于诊断；正式回归应遵守 `docs/testing.md`，落在可注入的状态模型或真实浏览器流程，而不是扩展旧 JSDOM 模式。

前端命令，cwd=`/Users/seefs/work/paseo/packages/app`：

```bash
NODE_OPTIONS=--no-experimental-webstorage bun run test src/composer/draft/fast-mode-intermediate.repro.test.tsx --bail=1 -t 'applies saved Pi'
NODE_OPTIONS=--no-experimental-webstorage bun run test src/composer/draft/fast-mode-window.repro.test.tsx --bail=1
NODE_OPTIONS=--no-experimental-webstorage bun run test src/composer/draft/input-draft.live.test.tsx --bail=1 -t 'applies saved Pi'
```

调查基线上前两项失败，分别揭示 Profile 窗口和 thinking 切换窗口；第三项 3 个用例通过，作为“只验证 settled 状态会漏检”的对照。前端修复后，前两项已分别通过 3 个 Profile 用例和 1 个 thinking 窗口用例。诊断文件已再次移出源码目录，保留在 `/tmp/paseo-fast-fix-evidence/`。重跑需要先复制回原目录，跑完再移出。

服务端详细笔记：`/tmp/paseo-fast-server-research.md`。复现测试：`/tmp/paseo-fast-server-research-4b654411/fast-server-research-4b654411.test.ts`。这些服务端诊断断言的是当前错误行为，通过意味着复现成功，不代表修复。

已核对的服务端原始输出：

- `/tmp/paseo-fast-server-research-tests.log`：Pi 关闭后恢复、Pi 跨模型恢复、Codex tier 恢复三个用例通过。一个人工延迟用例只证明没有统一配置/发送屏障，不作为真实 Pi 发送失败证据。
- `/tmp/paseo-fast-server-defaults-test.log`：Codex 迟到 defaults 覆盖运行时和第二轮请求的用例通过。初版 harness 读错 fake 返回形状，修正后才采用此结果。
- `/tmp/paseo-fast-server-real-pi.log`：真实 Pi 同连接发送反证和真实 Pi 关闭后恢复缺陷的两个实验，合在一个用例中通过。临时端点、进程和 session 目录已清理，没有调用外部付费模型。

服务端修复后验证，cwd=`packages/server`，只跑修改文件的针对性用例：

- `agent-manager.test.ts`：完整 feature 快照 6 例与既有配置变更/漂移 2 例通过。包含 Pi 新会话、legacy 标量、已有 map、provider wrapper 透传、Codex Plan/MCP/tier、空快照与未实现该接口的 provider。
- `codex-app-server-agent.features.test.ts`：迟到默认读取 6 例通过，全部检查后续会话与第二轮请求。
- `providers/claude/agent.test.ts`：完整快照恢复、失败 flag 不提交和既有 Fast toggle 三例通过。
- `bun run typecheck`：通过。根目录 lint 脚本检查 9 个服务端修改文件：0 warnings / 0 errors。格式化与 `git diff --check` 通过。
- 真实 Pi 1.3.0、manager、临时磁盘和 HTTP 端点复测：`Off ACKed → reload Off → next actual HTTP request omits service_tier`。同连接 Fast→prompt 仍带 priority，原正常路径未回退。日志 `/tmp/paseo-fast-server-real-pi-fixed.log`；诊断脚本 `/tmp/paseo-fast-server-research-4b654411/fast-server-fixed-4b654411.test.ts` 已移出源码目录。
- 服务端检查输出：`/tmp/paseo-fast-server-typecheck.log`、`/tmp/paseo-fast-server-lint.log`、`/tmp/paseo-fast-server-format.log`。

前端修复后验证，cwd=`packages/app`：

- `bun run test src/hooks/feature-preferences.test.ts --bail=1`：5 个用例通过。新增的两个纯函数回归覆盖未解析时 toggle/select/false 保留，以及已解析空列表继续过滤。
- `resolve-agent-form.test.ts` 中五个针对性选择保护用例通过；`workspace-tab.test.ts` 的模型加载期间禁止提交用例通过。没有跑全部 app 测试。
- 原始 hook + 实际 config builder 诊断：Profile 的 true、跨 provider、false 三个用例和 thinking 切换用例全部转绿。
- `bun run typecheck`：通过。
- 根目录 lint 脚本检查三个修改文件：通过，0 warnings / 0 errors。
- 输出：`/tmp/paseo-feature-pending-green.log`、`/tmp/paseo-feature-payload-green.log`、`/tmp/paseo-feature-window-green.log`、`/tmp/paseo-other-fields-audit.log`、`/tmp/paseo-model-submit-audit.log`、`/tmp/paseo-feature-fix-typecheck.log`、`/tmp/paseo-feature-fix-lint.log`。
- 没跑全量测试，没有连接用户真实会话发送测试消息，没有验证上游实际计费 tier。
