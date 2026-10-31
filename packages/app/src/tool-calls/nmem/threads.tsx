import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  EmptyResult,
  ExpandableText,
  IdentifierText,
  MetaLine,
  ResultCard,
  ResultRow,
  ResultSummary,
  RowTitle,
  formatInstant,
} from "./parts";
import type { NmemThread, NmemThreadMessage, NmemThreads } from "./result";

type ThreadSummary = NmemThreads["threads"][number];

function countText(value: number | null | undefined): string | null {
  return typeof value === "number" ? String(value) : null;
}

export function ThreadsView({ threads }: { threads: NmemThreads }) {
  const { t } = useTranslation();
  return (
    <View style={styles.view} testID="nmem-result-threads">
      <ResultSummary
        label={t("nmem.kinds.threadSearch")}
        query={threads.query}
        returned={threads.threads.length}
        total={threads.total}
      />
      {threads.threads.length === 0 ? (
        <EmptyResult label={t("nmem.emptyThreads")} />
      ) : (
        <ResultCard>
          {threads.threads.map((thread, index) => (
            <ThreadRow key={thread.id} thread={thread} first={index === 0} />
          ))}
        </ResultCard>
      )}
    </View>
  );
}

function ThreadRow({ thread, first }: { thread: ThreadSummary; first: boolean }) {
  const { t } = useTranslation();
  return (
    <ResultRow first={first} testID="nmem-thread-item">
      <RowTitle>{thread.title || thread.id}</RowTitle>
      <MetaLine
        items={[
          { key: "source", value: thread.source },
          {
            key: "messages",
            label: t("nmem.fields.messages"),
            value: countText(thread.message_count),
          },
          { key: "matches", label: t("nmem.fields.matches"), value: countText(thread.matches) },
        ]}
      />
      <IdentifierText>{thread.id}</IdentifierText>
    </ResultRow>
  );
}

export function ThreadView({ thread }: { thread: NmemThread }) {
  const { t } = useTranslation();
  const shown = thread.messages.length;
  const total = thread.total_messages;
  const badges =
    typeof total === "number"
      ? [{ key: "messages", label: t("nmem.counts.messages", { shown, total }) }]
      : undefined;
  return (
    <View style={styles.view} testID="nmem-result-thread">
      <ResultSummary
        label={t("nmem.kinds.thread")}
        title={thread.title || thread.id}
        returned={badges ? undefined : shown}
        badges={badges}
      >
        <MetaLine
          items={[
            { key: "source", value: thread.source },
            { key: "date", value: thread.created_at ? formatInstant(thread.created_at) : null },
          ]}
        />
        <IdentifierText>{thread.id}</IdentifierText>
      </ResultSummary>
      {shown === 0 ? (
        <EmptyResult label={t("nmem.emptyMessages")} />
      ) : (
        <ResultCard>
          {thread.messages.map((message, index) => (
            <MessageRow key={message.id} message={message} first={index === 0} />
          ))}
        </ResultCard>
      )}
    </View>
  );
}

function MessageRow({ message, first }: { message: NmemThreadMessage; first: boolean }) {
  const timestamp = message.timestamp ? formatInstant(message.timestamp) : null;
  const position = typeof message.index === "number" ? `#${message.index}` : null;
  return (
    <ResultRow first={first} testID="nmem-message-item">
      <View style={styles.messageHeader}>
        <StatusBadge size="xs" label={message.role} />
        <MetaLine
          items={[
            { key: "time", value: timestamp },
            { key: "position", value: position },
          ]}
        />
      </View>
      {message.content ? <ExpandableText text={message.content} /> : null}
    </ResultRow>
  );
}

const styles = StyleSheet.create((theme) => ({
  view: {
    gap: theme.spacing[4],
  },
  messageHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
