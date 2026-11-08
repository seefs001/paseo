import type { ArtifactReadPayload } from "@getpaseo/client/internal/daemon-client";
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

interface ArtifactActionsInput {
  serverId: string;
  artifact: Artifact | null;
  content?: ArtifactReadPayload;
  onRemoved?: () => void;
}

type PendingAction = "copy" | "copyPath" | "download" | "remove" | null;

export function useArtifactActions({
  serverId,
  artifact,
  content,
  onRemoved,
}: ArtifactActionsInput) {
  const { t } = useTranslation();
  const toast = useToast();
  const [pending, setPending] = useState<PendingAction>(null);
  const runContentAction = useCallback(
    async (action: "copy" | "download") => {
      if (!artifact) return;
      setPending(action);
      try {
        const payload = content ?? (await readArtifact(serverId, artifact.id));
        if (action === "copy") {
          await copyToClipboard(payload.content);
          toast.show(t("common.states.copied"));
        } else {
          await saveAndShareBytes({
            bytes: Buffer.from(payload.content, payload.encoding),
            fileName: payload.artifact.fileName,
            mimeType: artifactMimeType(payload),
          });
          toast.show(t("common.states.downloadComplete"));
        }
      } catch (error) {
        toast.error(toErrorMessage(error));
      } finally {
        setPending(null);
      }
    },
    [artifact, content, serverId, t, toast],
  );
  const copy = useCallback(() => {
    void runContentAction("copy");
  }, [runContentAction]);
  const download = useCallback(() => {
    void runContentAction("download");
  }, [runContentAction]);
  const copyPath = useCallback(async () => {
    if (!artifact?.sourcePath) return;
    setPending("copyPath");
    try {
      await copyToClipboard(artifact.sourcePath);
      toast.show(t("common.states.copied"));
    } catch (error) {
      toast.error(toErrorMessage(error));
    } finally {
      setPending(null);
    }
  }, [artifact, t, toast]);
  const remove = useCallback(async () => {
    if (!artifact) return;
    const confirmed = await confirmDialog({
      title: t("artifacts.viewer.removeTitle"),
      message: `${artifact.title}\n\n${t("artifacts.viewer.removeMessage")}`,
      confirmLabel: t("artifacts.viewer.remove"),
      destructive: true,
    });
    if (!confirmed) return;
    setPending("remove");
    try {
      await removeArtifact(serverId, artifact.id);
      onRemoved?.();
    } catch (error) {
      toast.error(toErrorMessage(error));
    } finally {
      setPending(null);
    }
  }, [artifact, onRemoved, serverId, t, toast]);
  return { pending, copy, copyPath, download, remove };
}
