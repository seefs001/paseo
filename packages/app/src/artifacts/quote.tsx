import type { Artifact } from "@getpaseo/protocol/messages";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ArtifactQuoteContextAttachment } from "@/attachments/types";
import { generateAttachmentId } from "@/attachments/utils";
import { ChatQuoteLine } from "@/attachments/chat-quote-pill";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useToast } from "@/contexts/toast-context";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { useSessionStore } from "@/stores/session-store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { revealWorkspaceTab } from "@/workspace-tabs/navigation";
import { openArtifactViewer } from "./viewer-state";
import { toErrorMessage } from "@/utils/error-messages";

export interface ArtifactQuoteInput {
  artifact: Artifact;
  text: string;
}

interface QuoteDestination {
  tabId: string;
  draftKey: string;
  title: string;
}

export function ArtifactQuoteSheet({
  serverId,
  workspaceId,
  quote,
  onClose,
}: {
  serverId: string;
  workspaceId: string;
  quote: ArtifactQuoteInput | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents);
  const [pending, setPending] = useState(false);
  const header = useMemo(() => ({ title: t("artifacts.interaction.chooseChat") }), [t]);
  const destinations = useMemo(() => {
    if (!layout) return [];
    return collectAllTabs(layout.root).flatMap<QuoteDestination>((tab) => {
      if (tab.target.kind === "agent") {
        const agent = agents?.get(tab.target.agentId);
        if (!agent || agent.archivedAt) return [];
        return [
          {
            tabId: tab.tabId,
            draftKey: buildDraftStoreKey({ serverId, agentId: tab.target.agentId }),
            title: agent.title || t("workspace.tabs.fallback.agent"),
          },
        ];
      }
      if (tab.target.kind === "draft") {
        return [
          {
            tabId: tab.tabId,
            draftKey: buildDraftStoreKey({
              serverId,
              agentId: tab.tabId,
              draftId: tab.target.draftId,
            }),
            title: t("workspace.tabs.fallback.agent"),
          },
        ];
      }
      return [];
    });
  }, [agents, layout, serverId, t]);
  const choose = useCallback(
    async (destination: QuoteDestination) => {
      if (!quote || !workspaceKey) return;
      setPending(true);
      try {
        const store = useDraftStore.getState();
        await store.hydrateDraftInput({ draftKey: destination.draftKey });
        const draft = store.getDraftInput(destination.draftKey) ?? { text: "", attachments: [] };
        const attachment: ArtifactQuoteContextAttachment = {
          kind: "artifact_quote",
          id: generateAttachmentId(),
          title: quote.artifact.title,
          selectedText: quote.text,
          source: {
            serverId,
            workspaceId: quote.artifact.workspaceId,
            artifactId: quote.artifact.id,
            revision: quote.artifact.revision,
          },
        };
        store.saveDraftInput({
          draftKey: destination.draftKey,
          draft: { ...draft, attachments: [...draft.attachments, attachment] },
        });
        onClose();
        revealWorkspaceTab(workspaceKey, destination.tabId);
        toast.show(t("artifacts.interaction.added"));
      } catch (error) {
        toast.error(toErrorMessage(error));
      } finally {
        setPending(false);
      }
    },
    [onClose, quote, serverId, toast, t, workspaceKey],
  );
  return (
    <AdaptiveModalSheet
      visible={quote !== null}
      onClose={onClose}
      header={header}
      testID="artifact-quote-destination"
    >
      <View style={styles.list}>
        {destinations.length === 0 ? (
          <Text style={styles.muted}>{t("artifacts.interaction.noChat")}</Text>
        ) : null}
        {destinations.map((destination) => (
          <QuoteDestinationRow
            key={destination.tabId}
            destination={destination}
            onSelect={choose}
            disabled={pending}
          />
        ))}
      </View>
    </AdaptiveModalSheet>
  );
}

function QuoteDestinationRow({
  destination,
  onSelect,
  disabled,
}: {
  destination: QuoteDestination;
  onSelect: (destination: QuoteDestination) => Promise<void>;
  disabled: boolean;
}) {
  const select = useCallback(() => {
    void onSelect(destination);
  }, [destination, onSelect]);
  return (
    <PressHighlight
      accessibilityRole="button"
      onPress={select}
      disabled={disabled}
      style={styles.destination}
      testID={`artifact-quote-to-${destination.tabId}`}
    >
      <Text style={styles.title}>{destination.title}</Text>
    </PressHighlight>
  );
}

const ThemedX = withUnistyles(X, (theme) => ({ color: theme.colors.foregroundMuted }));

export function ArtifactQuotePill({
  attachment,
  index,
  disabled,
  onRemove,
}: {
  attachment: ArtifactQuoteContextAttachment;
  index: number;
  disabled: boolean;
  onRemove: (index: number) => void;
}) {
  const { t } = useTranslation();
  const open = useCallback(() => {
    openArtifactViewer(attachment.source.serverId, attachment.source.artifactId);
  }, [attachment.source]);
  const remove = useCallback(() => onRemove(index), [index, onRemove]);
  return (
    <View style={styles.quote} testID="composer-artifact-quote">
      <View style={styles.excerpt}>
        <Text style={styles.muted} numberOfLines={1}>
          {attachment.title} · {attachment.source.revision}
        </Text>
        <ChatQuoteLine
          text={attachment.selectedText}
          onPress={open}
          accessibilityLabel={attachment.title}
        />
      </View>
      <ToolbarButton
        compact
        onPress={remove}
        disabled={disabled}
        label={t("composer.attachments.removeChatQuote")}
      >
        <ThemedX size={14} />
      </ToolbarButton>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: { gap: theme.spacing[2], padding: theme.spacing[4] },
  destination: { padding: theme.spacing[3], borderRadius: theme.borderRadius.md },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  quote: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[2] },
  excerpt: { flex: 1, minWidth: 0, gap: theme.spacing[1] },
}));
