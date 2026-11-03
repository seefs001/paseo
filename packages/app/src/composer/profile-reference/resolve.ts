import { resolveAgentRoles } from "@getpaseo/protocol/agent-role";
import type { AgentAttachment, MutableDaemonConfig } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { i18n } from "@/i18n/i18next";
import { useSessionStore } from "@/stores/session-store";
import {
  buildAgentProfileAddressCard,
  buildAgentRoleAddressCard,
  buildAgentSessionAddressCard,
} from "@/utils/session-mention-autocomplete";
import { findResourceLinks, type ResourceLinkReference } from "./model";

type ResourceCard = Extract<AgentAttachment, { type: "text" }>;

/** The reads a resource link needs, on the connection to the host that owns the resource. */
export type ResourceClient = Pick<DaemonClient, "isConnected" | "getDaemonConfig" | "fetchAgent">;

/** Returns the connection to `serverId`, or null when Paseo has none. */
export type ResourceClientLookup = (serverId: string) => ResourceClient | null;

/** The App's live connection to `serverId`; reads go through it with its existing permissions. */
export function getSessionResourceClient(serverId: string): ResourceClient | null {
  return useSessionStore.getState().sessions[serverId]?.client ?? null;
}

export class ResourceReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceReferenceError";
  }
}

function fail(key: string, link: ResourceLinkReference, detail?: string): never {
  throw new ResourceReferenceError(
    i18n.t(key, { label: link.label, serverId: link.serverId, error: detail ?? "" }),
  );
}

/** The URI a card was resolved from, so a sent message can find the card for its link. */
function withResourceLine(card: ResourceCard, link: ResourceLinkReference): ResourceCard {
  const [header, ...rest] = card.text.split("\n");
  return { ...card, text: [header, `- resource: ${resourceLinkUri(link)}`, ...rest].join("\n") };
}

export function resourceLinkUri(link: Pick<ResourceLinkReference, "markdown">): string {
  return link.markdown.slice(link.markdown.lastIndexOf("](") + 2, -1);
}

/** A card read from a short resource link, which records the link it came from. */
export function isResourceCard(attachment: AgentAttachment): boolean {
  return (
    attachment.type === "text" &&
    attachment.text.split("\n").some((line) => line.startsWith("- resource: paseo://"))
  );
}

/** The card recorded for `link` when its message was sent, if any. */
export function findSentResourceCard(
  attachments: readonly AgentAttachment[],
  link: ResourceLinkReference,
): ResourceCard | null {
  const line = `- resource: ${resourceLinkUri(link)}`;
  return (
    attachments.find(
      (attachment): attachment is ResourceCard =>
        attachment.type === "text" && attachment.text.split("\n").includes(line),
    ) ?? null
  );
}

interface ResolveContext {
  getClient: ResourceClientLookup;
  configs: Map<string, Promise<MutableDaemonConfig>>;
}

function connectedClient(context: ResolveContext, link: ResourceLinkReference): ResourceClient {
  const client = context.getClient(link.serverId);
  if (!client?.isConnected) fail("composer.errors.referenceHostUnavailable", link);
  return client;
}

async function readConfig(
  context: ResolveContext,
  link: ResourceLinkReference,
): Promise<MutableDaemonConfig> {
  const client = connectedClient(context, link);
  let pending = context.configs.get(link.serverId);
  if (!pending) {
    pending = client.getDaemonConfig().then((result) => result.config);
    context.configs.set(link.serverId, pending);
  }
  try {
    return await pending;
  } catch (error) {
    return fail(
      "composer.errors.referenceReadFailed",
      link,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function resolveLink(
  context: ResolveContext,
  link: ResourceLinkReference,
): Promise<ResourceCard> {
  if (link.resource === "profile") {
    const config = await readConfig(context, link);
    const profile = config.agentProfiles?.find((entry) => entry.id === link.resourceId);
    if (!profile) fail("composer.errors.referenceNotFound", link);
    return withResourceLine(
      {
        type: "text",
        mimeType: "text/plain",
        contextKind: "agent_profile",
        title: profile.name,
        text: buildAgentProfileAddressCard(profile),
      },
      link,
    );
  }
  if (link.resource === "role") {
    const config = await readConfig(context, link);
    const role = resolveAgentRoles(config.agentRoles).find((entry) => entry.id === link.resourceId);
    if (!role) fail("composer.errors.referenceNotFound", link);
    // Only what addresses the role; its instructions stay on the host.
    const snapshot = {
      id: role.id,
      name: role.name,
      description: role.description,
      defaultProfileId: role.defaultProfileId,
    };
    return withResourceLine(
      {
        type: "text",
        mimeType: "text/plain",
        contextKind: "agent_role",
        title: role.name,
        text: buildAgentRoleAddressCard(snapshot, { serverId: link.serverId }),
      },
      link,
    );
  }
  const client = connectedClient(context, link);
  let result: Awaited<ReturnType<ResourceClient["fetchAgent"]>>;
  try {
    result = await client.fetchAgent(link.resourceId);
  } catch (error) {
    return fail(
      "composer.errors.referenceReadFailed",
      link,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!result) fail("composer.errors.referenceNotFound", link);
  const { agent } = result;
  return withResourceLine(
    {
      type: "text",
      mimeType: "text/plain",
      contextKind: "agent_session",
      title: agent.title?.trim() || agent.id.slice(0, 7),
      text: buildAgentSessionAddressCard({
        agentId: agent.id,
        serverId: link.serverId,
        title: agent.title,
        provider: agent.provider,
        model: agent.model,
        cwd: agent.cwd,
        workspaceId: agent.workspaceId ?? null,
      }),
    },
    link,
  );
}

/** Reads the current resource one link names, for a preview. */
export function resolveResourceLink(
  link: ResourceLinkReference,
  getClient: ResourceClientLookup,
): Promise<ResourceCard> {
  return resolveLink({ getClient, configs: new Map() }, link);
}

/**
 * Reads the current resource for every short link in `text`, in text order, one card per
 * distinct link. `targetServerId` is the host the message is sent to: a role can only be used
 * to create agents on its own host, so a role link from another host fails before sending.
 */
export async function resolveResourceLinks(input: {
  text: string;
  targetServerId: string | undefined;
  getClient: ResourceClientLookup;
}): Promise<ResourceCard[]> {
  const links = findResourceLinks(input.text);
  if (links.length === 0) return [];
  const seen = new Set<string>();
  const unique = links.filter((link) => {
    const key = resourceLinkUri(link);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  for (const link of unique) {
    if (link.resource === "role" && link.serverId !== input.targetServerId) {
      fail("composer.errors.referenceRoleOtherHost", link);
    }
  }
  const context: ResolveContext = { getClient: input.getClient, configs: new Map() };
  return Promise.all(unique.map((link) => resolveLink(context, link)));
}
