import { CornerLeftUp } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { PaneContentToolbar } from "@/components/ui/pane-content-toolbar";
import { useStableEvent } from "@/hooks/use-stable-event";
import { usePaneContext } from "@/panels/pane-context";
import { useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { resolveParentAgentTarget } from "./parent-target";
import { providerSubagentKey, useProviderSubagentStore } from "./provider-store";

export function ParentAgentNavigation() {
  const { t } = useTranslation();
  const { serverId, target, openTab } = usePaneContext();
  const parentAgentId = useSessionStore((state) => {
    if (target.kind !== "agent") return null;
    const session = state.sessions[serverId];
    const agent = session?.agents.get(target.agentId) ?? session?.agentDetails.get(target.agentId);
    return agent?.parentAgentId ?? null;
  });
  const parentSubagentId = useProviderSubagentStore((state) => {
    if (target.kind !== "provider_subagent") return undefined;
    const descriptor = state.descriptors.get(
      providerSubagentKey(serverId, target.parentAgentId, target.subagentId),
    );
    return descriptor ? (descriptor.parentSubagentId ?? null) : undefined;
  });
  const parentTarget = resolveParentAgentTarget({ target, parentAgentId, parentSubagentId });
  const openParent = useStableEvent(() => {
    if (!parentTarget) return;
    if (parentTarget.kind === "agent") {
      navigateToAgent({ serverId, agentId: parentTarget.agentId });
    } else {
      openTab(parentTarget);
    }
  });
  if (!parentTarget) return null;

  return (
    <PaneContentToolbar style={styles.toolbar}>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={CornerLeftUp}
        onPress={openParent}
        testID="parent-agent-navigation"
      >
        {t("subagents.openParent")}
      </Button>
    </PaneContentToolbar>
  );
}

const styles = StyleSheet.create((theme) => ({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[2],
  },
}));
