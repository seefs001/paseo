import { ArrowRight } from "lucide-react-native";
import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { DeskSession } from "@/desk/model";
import { Button } from "@/components/ui/button";
import { navigateToAgent } from "@/utils/navigate-to-agent";

/** Goes back to the conversation through the app's own agent navigation. Nothing else changes. */
export function openDeskConversation(session: DeskSession): void {
  navigateToAgent({
    serverId: session.agent.serverId,
    agentId: session.agent.id,
    workspaceId: session.agent.workspaceId ?? null,
  });
}

export function useDeskSessionLabels(session: DeskSession): DeskSessionLabels {
  const { t } = useTranslation();
  return {
    title: session.agent.title ?? t("desk.session.untitled"),
    workspace: session.workspace.title ?? session.workspace.name,
  };
}

export interface DeskSessionLabels {
  title: string;
  workspace: string;
}

/** Always visible, so touch screens never need hover to find the way back. */
export function DeskReturnButton({ session }: { session: DeskSession }): ReactElement {
  const { t } = useTranslation();
  const open = useCallback(() => openDeskConversation(session), [session]);
  return (
    <Button
      size="sm"
      variant="ghost"
      leftIcon={ArrowRight}
      onPress={open}
      accessibilityLabel={t("desk.session.returnLabel")}
      testID={`desk-return-${session.agent.id}`}
    >
      {t("desk.session.return")}
    </Button>
  );
}
