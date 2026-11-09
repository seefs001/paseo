import type { Artifact } from "@getpaseo/protocol/messages";
import { Buffer } from "buffer";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { saveAndShareBytes } from "@/stores/download-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { toErrorMessage } from "@/utils/error-messages";
import { artifactMimeType } from "./content";
import { readArtifact, removeArtifact } from "./store";

type BulkAction = "remove" | "download" | "copyPaths";

/** Actions over several artifacts at once. Each item runs on its own; failures are summed up. */
export function useArtifactBulkActions(serverId: string) {
  const { t } = useTranslation();
  const toast = useToast();
  const [pending, setPending] = useState<BulkAction | null>(null);

  const reportFailures = useCallback(
    (results: PromiseSettledResult<unknown>[]) => {
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length === 0) return;
      const first = failed[0] as PromiseRejectedResult;
      toast.error(
        t("artifacts.selection.failed", {
          count: failed.length,
          message: toErrorMessage(first.reason),
        }),
      );
    },
    [t, toast],
  );

  const remove = useCallback(
    async (artifacts: readonly Artifact[], scope: "selected" | "all"): Promise<boolean> => {
      if (artifacts.length === 0) return false;
      const confirmed = await confirmDialog({
        title:
          scope === "all"
            ? t("artifacts.selection.clearAllTitle")
            : t("artifacts.selection.removeTitle", { count: artifacts.length }),
        message: t("artifacts.viewer.removeMessage"),
        confirmLabel:
          scope === "all" ? t("artifacts.selection.clearAll") : t("artifacts.viewer.remove"),
        destructive: true,
      });
      if (!confirmed) return false;
      setPending("remove");
      try {
        const results = await Promise.allSettled(
          artifacts.map((artifact) => removeArtifact(serverId, artifact.id)),
        );
        reportFailures(results);
        return true;
      } finally {
        setPending(null);
      }
    },
    [reportFailures, serverId, t],
  );

  const download = useCallback(
    async (artifacts: readonly Artifact[]) => {
      if (artifacts.length === 0) return;
      setPending("download");
      const results: PromiseSettledResult<unknown>[] = [];
      try {
        // One at a time: browsers and share sheets drop concurrent downloads.
        for (const artifact of artifacts) {
          try {
            const payload = await readArtifact(serverId, artifact.id);
            await saveAndShareBytes({
              bytes: Buffer.from(payload.content, payload.encoding),
              fileName: payload.artifact.fileName,
              mimeType: artifactMimeType(payload),
            });
            results.push({ status: "fulfilled", value: null });
          } catch (error) {
            results.push({ status: "rejected", reason: error });
          }
        }
        reportFailures(results);
        if (results.some((result) => result.status === "fulfilled")) {
          toast.show(t("common.states.downloadComplete"));
        }
      } finally {
        setPending(null);
      }
    },
    [reportFailures, serverId, t, toast],
  );

  const copyPaths = useCallback(
    async (artifacts: readonly Artifact[]) => {
      const paths = artifacts.flatMap((artifact) =>
        artifact.sourcePath ? [artifact.sourcePath] : [],
      );
      if (paths.length === 0) return;
      setPending("copyPaths");
      try {
        await copyToClipboard(paths.join("\n"));
        toast.show(t("common.states.copied"));
      } catch (error) {
        toast.error(toErrorMessage(error));
      } finally {
        setPending(null);
      }
    },
    [t, toast],
  );

  return { pending, remove, download, copyPaths };
}
