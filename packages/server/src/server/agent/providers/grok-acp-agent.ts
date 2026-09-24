import type { AgentMode } from "../agent-sdk-types.js";
import type { ACPAgentClientOptions } from "./acp-agent.js";
import { GenericACPAgentClient, type GenericACPAgentClientOptions } from "./generic-acp-agent.js";

const GROK_PERMISSION_MODES: AgentMode[] = [
  { id: "ask", label: "Ask", description: "Ask for tool permissions." },
  { id: "auto", label: "Auto", description: "Let Grok classify tool permission requests." },
  { id: "always-approve", label: "Always approve", description: "Approve all tool requests." },
];

function permissionModeMeta(modeId: string) {
  if (!GROK_PERMISSION_MODES.some((mode) => mode.id === modeId)) {
    throw new Error(`Invalid Grok permission mode: ${modeId}`);
  }
  return { autoMode: modeId === "auto", yoloMode: modeId === "always-approve" };
}

export const GROK_ACP_OPTIONS = {
  defaultModes: GROK_PERMISSION_MODES,
  waitForInitialCommands: true,
  grokUsage: true,
  sessionRequestMeta(config) {
    return config.modeId === undefined ? undefined : permissionModeMeta(config.modeId);
  },
  // ACP plan/ask/default are a separate prompt-mode axis, unadvertised by this permission chip.
  sessionResponseTransformer(response) {
    return { ...response, modes: null };
  },
  configOptionsTransformer(options) {
    return options.filter((option) => option.category !== "mode");
  },
  modeIdTransformer() {
    return null;
  },
  async providerModeWriter({ connection, sessionId, requestedModeId }) {
    const meta = permissionModeMeta(requestedModeId);
    // Paseo owns one Grok process per session; Grok does not filter this notification by sessionId.
    await connection.extNotification("x.ai/yolo_mode_changed", {
      sessionId,
      yolo_mode: meta.yoloMode,
      auto_mode: meta.autoMode,
      permission_mode: requestedModeId,
    });
    return { handled: true };
  },
} satisfies Partial<ACPAgentClientOptions>;

export class GrokACPAgentClient extends GenericACPAgentClient {
  constructor(options: GenericACPAgentClientOptions) {
    super({ ...options, providerId: "grok", ...GROK_ACP_OPTIONS });
  }
}
