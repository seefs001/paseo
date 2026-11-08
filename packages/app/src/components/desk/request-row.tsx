import type {
  AgentPermissionAction,
  AgentPermissionRequest,
  ToolCallDetail,
} from "@getpaseo/protocol/agent-types";
import type { TFunction } from "i18next";
import { Check, X } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { DeskBriefDecision } from "@/components/board/desk-brief-decision";
import { toPermissionResponse } from "@/components/board/permission-request";
import { ToolCallDetailsContent } from "@/components/tool-call-details";
import { Button } from "@/components/ui/button";
import type { DeskRequest, DeskSession } from "@/desk/model";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";
import { formatTimeAgo } from "@/utils/time";
import { DeskReturnButton, openDeskConversation, useDeskSessionLabels } from "./session";

type PermissionRequest = Extract<DeskRequest, { kind: "permission" }>;
type DecisionRequest = Extract<DeskRequest, { kind: "decision" }>;
type RequestKind = AgentPermissionRequest["kind"];

/**
 * Only plain tool permissions are answered on the Desk: they are a yes/no with the provider's own
 * actions. Questions, plans, mode switches and other requests need the provider's panel in the
 * conversation, so their row takes the user there instead of rebuilding that form.
 */
const ANSWERED_ON_DESK: ReadonlySet<RequestKind> = new Set(["tool"]);
const RESPOND_TIMEOUT_MS = 15_000;
const DETAIL_MAX_HEIGHT = 200;

export function DeskRequestRow({ item }: { item: DeskRequest }): ReactElement {
  if (item.kind === "decision") return <DecisionRow item={item} />;
  return <PermissionRow item={item} />;
}

function PermissionRow({ item }: { item: PermissionRequest }): ReactElement {
  const { t } = useTranslation();
  const labels = useDeskSessionLabels(item.session);
  const { request } = item;
  const title =
    request.kind === "plan"
      ? t("desk.request.planTitle")
      : (request.title ?? request.name ?? t("desk.request.untitled"));
  const answeredHere = ANSWERED_ON_DESK.has(request.kind);
  return (
    <View style={styles.row} testID={`desk-request-${item.key}`}>
      <RowHeader
        kind={t(`desk.request.kind.${request.kind}`)}
        title={title}
        context={joinContext([labels.title, labels.workspace, item.serverName])}
        session={item.session}
      />
      {request.description ? (
        <Text style={styles.detail} numberOfLines={3}>
          {request.description}
        </Text>
      ) : null}
      {answeredHere ? (
        <ToolActions item={item} />
      ) : (
        <AnswerInConversation session={item.session} canRespond={item.canRespond} />
      )}
    </View>
  );
}

/** The original panel's fallback when a provider sends no actions of its own. */
function defaultActions(t: TFunction): AgentPermissionAction[] {
  return [
    {
      id: "reject",
      label: t("agentStream.permission.deny"),
      behavior: "deny",
      variant: "danger",
      intent: "dismiss",
    },
    {
      id: "accept",
      label: t("agentStream.permission.accept"),
      behavior: "allow",
      variant: "primary",
    },
  ];
}

/**
 * The tool's real input and every provider action, as the conversation shows them, so a choice
 * such as "always allow" is not narrowed to a plain yes or no.
 */
function ToolActions({ item }: { item: PermissionRequest }): ReactElement {
  const { t } = useTranslation();
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const { request } = item;
  const detail = useMemo<ToolCallDetail>(
    () => request.detail ?? { type: "unknown", input: request.input ?? null, output: null },
    [request.detail, request.input],
  );
  const actions = useMemo(
    () => (request.actions && request.actions.length > 0 ? request.actions : defaultActions(t)),
    [request.actions, t],
  );

  const respond = useCallback(
    async (action: AgentPermissionAction) => {
      const client = getHostRuntimeStore().getClient(item.serverId);
      if (!client) {
        setFailure(t("desk.request.hostUnavailable"));
        return;
      }
      setFailure(null);
      setSendingId(action.id);
      try {
        await client.respondToPermissionAndWait(
          item.session.agent.id,
          request.id,
          toPermissionResponse(action),
          RESPOND_TIMEOUT_MS,
        );
      } catch (error) {
        setFailure(t("desk.request.respondFailed", { message: toErrorMessage(error) }));
      }
      setSendingId(null);
    },
    [item.serverId, item.session.agent.id, request.id, t],
  );
  const disabled = sendingId !== null || !item.canRespond;

  return (
    <View style={styles.actionsBlock}>
      <ToolCallDetailsContent detail={detail} maxHeight={DETAIL_MAX_HEIGHT} />
      <View style={styles.actions}>
        {actions.map((action) => (
          <ToolActionButton
            key={action.id}
            action={action}
            sending={sendingId === action.id}
            disabled={disabled}
            onRespond={respond}
          />
        ))}
      </View>
      {item.canRespond ? null : <Text style={styles.hint}>{t("desk.request.offline")}</Text>}
      {failure ? <Text style={styles.failure}>{failure}</Text> : null}
    </View>
  );
}

function ToolActionButton({
  action,
  sending,
  disabled,
  onRespond,
}: {
  action: AgentPermissionAction;
  sending: boolean;
  disabled: boolean;
  onRespond: (action: AgentPermissionAction) => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();
  const press = useCallback(() => void onRespond(action), [action, onRespond]);
  const isAllow = action.behavior === "allow";
  const fallbackLabel = isAllow ? t("desk.request.allow") : t("desk.request.deny");
  return (
    <Button
      size="sm"
      variant={action.variant === "primary" ? "secondary" : "outline"}
      leftIcon={isAllow ? Check : X}
      onPress={press}
      loading={sending}
      disabled={disabled}
      testID={`desk-request-action-${action.id}`}
    >
      {action.label || fallbackLabel}
    </Button>
  );
}

function AnswerInConversation({
  session,
  canRespond,
}: {
  session: DeskSession;
  canRespond: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const open = useCallback(() => openDeskConversation(session), [session]);
  return (
    <View style={styles.actions}>
      <Button size="sm" variant="secondary" onPress={open} testID="desk-request-open">
        {t("desk.request.answerInConversation")}
      </Button>
      {canRespond ? null : <Text style={styles.hint}>{t("desk.request.offline")}</Text>}
    </View>
  );
}

function DecisionRow({ item }: { item: DecisionRequest }): ReactElement {
  const { t } = useTranslation();
  const since = formatTimeAgo(new Date(item.decision.createdAt));
  return (
    <View style={styles.row} testID={`desk-request-${item.key}`}>
      {item.session ? (
        <DecisionSessionHeader item={item} session={item.session} since={since} />
      ) : (
        <RowHeader
          kind={t("desk.request.kind.decision")}
          title={item.decision.title}
          context={joinContext([item.serverName, since])}
          session={null}
        />
      )}
      {item.canRespond ? (
        <DeskBriefDecision serverId={item.serverId} decision={item.decision} goal={null} />
      ) : (
        <Text style={styles.hint}>{t("desk.request.offline")}</Text>
      )}
    </View>
  );
}

function DecisionSessionHeader({
  item,
  session,
  since,
}: {
  item: DecisionRequest;
  session: DeskSession;
  since: string;
}): ReactElement {
  const { t } = useTranslation();
  const labels = useDeskSessionLabels(session);
  return (
    <RowHeader
      kind={t("desk.request.kind.decision")}
      title={item.decision.title}
      context={joinContext([labels.title, labels.workspace, item.serverName, since])}
      session={session}
    />
  );
}

interface RowHeaderProps {
  kind: string;
  title: string;
  context: string;
  session: DeskSession | null;
}

function RowHeader({ kind, title, context, session }: RowHeaderProps): ReactElement {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.kind}>{kind}</Text>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.context} numberOfLines={1}>
          {context}
        </Text>
      </View>
      {session ? <DeskReturnButton session={session} /> : null}
    </View>
  );
}

function joinContext(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null && part !== "").join(" · ");
}

const styles = StyleSheet.create((theme) => ({
  row: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[0.5],
  },
  kind: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  context: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  detail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actionsBlock: {
    gap: theme.spacing[1],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  failure: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));
