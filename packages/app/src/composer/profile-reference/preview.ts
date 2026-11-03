import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import {
  buildAgentMentionStatusDetail,
  getAgentMentionDetail,
  type AgentMentionDetail,
} from "@/attachments/agent-mention-detail";
import type { ResourceLinkReference } from "./model";
import { getSessionResourceClient, resolveResourceLink } from "./resolve";

const DETAIL_KIND = {
  profile: "agent_profile",
  role: "agent_role",
  session: "agent_session",
} as const;

/**
 * The detail sheet for a reference. A card opens at once; a short resource link reads its
 * current resource from the owning host, showing loading and then the resource or the error.
 */
export function useReferencePreview() {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<AgentMentionDetail | null>(null);
  const requestRef = useRef(0);

  const openCard = useCallback(
    (attachment: AgentAttachment) => {
      requestRef.current += 1;
      setDetail(getAgentMentionDetail(attachment, t));
    },
    [t],
  );

  const openLink = useCallback(
    (link: ResourceLinkReference) => {
      const request = ++requestRef.current;
      const kind = DETAIL_KIND[link.resource];
      setDetail(
        buildAgentMentionStatusDetail({ kind, title: link.label, status: t("common.loading") }),
      );
      void (async () => {
        let next: AgentMentionDetail | null;
        try {
          next = getAgentMentionDetail(
            await resolveResourceLink(link, getSessionResourceClient),
            t,
          );
        } catch (error) {
          const status = error instanceof Error ? error.message : String(error);
          next = buildAgentMentionStatusDetail({ kind, title: link.label, status });
        }
        // A later open or close owns the sheet now.
        if (requestRef.current === request) setDetail(next);
      })();
    },
    [t],
  );

  const close = useCallback(() => {
    requestRef.current += 1;
    setDetail(null);
  }, []);

  return { detail, openCard, openLink, close };
}
