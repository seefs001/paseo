import type { TFunction } from "i18next";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { DeskHostCoverage, DeskSourceState } from "@/desk/model";
import { formatTimeAgo } from "@/utils/time";

type SourceName = "sessions" | "decisions" | "artifacts";
type SourceStatus = DeskSourceState["status"];
const SOURCES: readonly SourceName[] = ["sessions", "decisions", "artifacts"];
const UNAVAILABLE: ReadonlySet<SourceStatus> = new Set(["loading", "offline", "error"]);

function sourcesWith(host: DeskHostCoverage, statuses: ReadonlySet<SourceStatus>): SourceName[] {
  return SOURCES.filter((source) => statuses.has(host[source].status));
}

const UNSUPPORTED: ReadonlySet<SourceStatus> = new Set(["unsupported"]);
const FAILED: ReadonlySet<SourceStatus> = new Set(["error"]);

/** A source that is not ready is named, so a missing list never reads as an empty one. */
export function DeskHostNotices({
  hosts,
}: {
  hosts: readonly DeskHostCoverage[];
}): ReactElement | null {
  const noted = hosts.filter((host) => SOURCES.some((source) => host[source].status !== "ready"));
  if (noted.length === 0) return null;
  return (
    <View style={styles.list} testID="desk-host-notices">
      {noted.map((host) => (
        <HostNotice key={host.serverId} host={host} />
      ))}
    </View>
  );
}

function HostNotice({ host }: { host: DeskHostCoverage }): ReactElement {
  const { t } = useTranslation();
  const unavailable = sourcesWith(host, UNAVAILABLE);
  const unsupported = sourcesWith(host, UNSUPPORTED);
  return (
    <View style={unavailable.length > 0 ? styles.notice : styles.quietNotice}>
      {unavailable.length > 0 ? (
        <>
          <Text style={styles.title}>{headline(host, t)}</Text>
          <Text style={styles.detail}>
            {t("desk.host.unavailable", { sources: sourceNames(unavailable, t) })}
          </Text>
        </>
      ) : null}
      {unsupported.length > 0 ? (
        <Text style={styles.detail}>
          {t("desk.host.unsupported", {
            host: host.serverName,
            sources: sourceNames(unsupported, t),
          })}
        </Text>
      ) : null}
    </View>
  );
}

function headline(host: DeskHostCoverage, t: TFunction): string {
  const disconnected = host.connectionStatus === "offline" || host.connectionStatus === "error";
  if (disconnected && host.lastOnlineAt) {
    return t("desk.host.offlineSince", {
      host: host.serverName,
      time: formatTimeAgo(new Date(host.lastOnlineAt)),
    });
  }
  if (disconnected) return t("desk.host.offline", { host: host.serverName });
  if (sourcesWith(host, FAILED).length > 0) return t("desk.host.failed", { host: host.serverName });
  return t("desk.host.loading", { host: host.serverName });
}

function sourceNames(sources: readonly SourceName[], t: TFunction): string {
  return sources.map((source) => t(`desk.host.source.${source}`)).join(", ");
}

const styles = StyleSheet.create((theme) => ({
  list: {
    gap: theme.spacing[2],
  },
  notice: {
    gap: theme.spacing[0.5],
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  quietNotice: {
    paddingHorizontal: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  detail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
