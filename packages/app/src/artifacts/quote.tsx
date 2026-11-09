import type { Artifact } from "@getpaseo/protocol/messages";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { ArtifactQuoteContextAttachment } from "@/attachments/types";
import { generateAttachmentId } from "@/attachments/utils";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useProviderIcon } from "@/components/provider-icons";
import { DensityIcon } from "@/components/ui/density-icon";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useToast } from "@/contexts/toast-context";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { useSessionStore } from "@/stores/session-store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { revealWorkspaceTab } from "@/workspace-tabs/navigation";
import { toErrorMessage } from "@/utils/error-messages";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { getStatusDotColor } from "@/utils/status-dot-color";
import { formatTimeAgo } from "@/utils/time";
import { MessageSquareDashed } from "lucide-react-native";

export interface ArtifactQuoteInput {
  artifact: Artifact;
  text: string;
}

interface QuoteDestination {
  tabId: string;
  draftKey: string;
  title: string;
  /** Null for an unsent draft tab. */
  agent: {
    provider: string;
    bucket: SidebarStateBucket;
    lastActivityAt: Date;
  } | null;
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
            agent: {
              provider: agent.provider,
              bucket: deriveSidebarStateBucket(agent),
              lastActivityAt: agent.lastActivityAt,
            },
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
            agent: null,
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
        await store.attachChatQuote({ draftKey: destination.draftKey, attachment });
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
      desktopMaxWidth={560}
      testID="artifact-quote-destination"
    >
      {quote ? <QuotePreview quote={quote} /> : null}
      {destinations.length === 0 ? (
        <Text style={styles.empty}>{t("artifacts.interaction.noChat")}</Text>
      ) : (
        <View style={styles.list}>
          {destinations.map((destination) => (
            <QuoteDestinationRow
              key={destination.tabId}
              serverId={serverId}
              destination={destination}
              onSelect={choose}
              disabled={pending}
            />
          ))}
        </View>
      )}
    </AdaptiveModalSheet>
  );
}

function QuotePreview({ quote }: { quote: ArtifactQuoteInput }) {
  return (
    <View style={styles.preview} testID="artifact-quote-preview">
      <Text style={styles.previewTitle} numberOfLines={1}>
        {quote.artifact.title}
      </Text>
      <Text style={styles.previewText} numberOfLines={4}>
        {quote.text.trim()}
      </Text>
    </View>
  );
}

function QuoteDestinationRow({
  serverId,
  destination,
  onSelect,
  disabled,
}: {
  serverId: string;
  destination: QuoteDestination;
  onSelect: (destination: QuoteDestination) => Promise<void>;
  disabled: boolean;
}) {
  const ProviderIcon = useProviderIcon(destination.agent?.provider ?? "", serverId);
  const select = useCallback(() => {
    void onSelect(destination);
  }, [destination, onSelect]);
  const { agent } = destination;
  return (
    <PressHighlight
      accessibilityRole="button"
      onPress={select}
      disabled={disabled}
      style={styles.destination}
      testID={`artifact-quote-to-${destination.tabId}`}
    >
      <View style={styles.icon}>
        <DensityIcon
          icon={agent ? ProviderIcon : MessageSquareDashed}
          size="sm"
          color="foregroundMuted"
        />
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {destination.title}
      </Text>
      {agent ? (
        <>
          <Text style={styles.meta} numberOfLines={1}>
            {formatTimeAgo(agent.lastActivityAt)}
          </Text>
          <StatusDot bucket={agent.bucket} />
        </>
      ) : null}
    </PressHighlight>
  );
}

function StatusDot({ bucket }: { bucket: SidebarStateBucket }) {
  styles.useVariants({ bucket });
  return <View style={styles.dot} />;
}

const styles = StyleSheet.create((theme) => ({
  preview: {
    marginHorizontal: theme.spacing[4],
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    gap: theme.spacing[1],
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.md,
  },
  previewTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  previewText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  list: { paddingHorizontal: theme.spacing[2], paddingBottom: theme.spacing[3] },
  destination: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minHeight: 40,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  icon: { width: 20, alignItems: "center" },
  title: { flex: 1, minWidth: 0, color: theme.colors.foreground, fontSize: theme.fontSize.base },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  dot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    variants: {
      bucket: {
        needs_input: {
          backgroundColor: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
        },
        failed: { backgroundColor: getStatusDotColor({ theme, bucket: "failed" }) ?? undefined },
        running: { backgroundColor: getStatusDotColor({ theme, bucket: "running" }) ?? undefined },
        attention: {
          backgroundColor: getStatusDotColor({ theme, bucket: "attention" }) ?? undefined,
        },
        done: { backgroundColor: theme.colors.border },
      },
    },
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    padding: theme.spacing[6],
  },
}));
