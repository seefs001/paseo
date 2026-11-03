import { i18n } from "@/i18n/i18next";

export type AgentInputSubmitResult = "noop" | "queued" | "submitted" | "failed";

export interface AgentInputSubmissionDraft<TAttachment> {
  capture: () => () => boolean;
  retainFailed: (input: { message: string; attachments: TAttachment[] }) => void;
}

export interface AgentInputSubmitActionInput<TAttachment> {
  draft?: AgentInputSubmissionDraft<TAttachment>;
  message: string;
  attachments: TAttachment[];
  hasExternalContent?: boolean;
  allowEmptySubmit?: boolean;
  submitBehavior?: "clear" | "preserve-and-lock";
  forceSend?: boolean;
  isAgentRunning: boolean;
  canSubmit: boolean;
  queueMessage: (input: { message: string; attachments: TAttachment[] }) => void;
  submitMessage: (input: { message: string; attachments: TAttachment[] }) => Promise<void>;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  setUserInput: (text: string) => void;
  setAttachments: (attachments: TAttachment[]) => void;
  setSendError: (message: string | null) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  onSubmitError?: (error: unknown) => void;
  failedToSendMessage?: string;
}

export async function submitAgentInput<TAttachment>(
  input: AgentInputSubmitActionInput<TAttachment>,
): Promise<AgentInputSubmitResult> {
  const trimmedMessage = input.message.trim();
  const attachments = input.attachments;
  const shouldClearOnSubmit = input.submitBehavior !== "preserve-and-lock";

  if (
    !trimmedMessage &&
    attachments.length === 0 &&
    !input.hasExternalContent &&
    !input.allowEmptySubmit
  ) {
    return "noop";
  }

  if (!input.canSubmit) {
    return "noop";
  }

  if (input.isAgentRunning && !input.forceSend) {
    input.queueMessage({ message: trimmedMessage, attachments });
    if (shouldClearOnSubmit) {
      input.setUserInput("");
      input.setAttachments([]);
    }
    return "queued";
  }

  // Clear immediately so the submitted timeline row and composer state stay in sync.
  if (shouldClearOnSubmit) {
    input.setUserInput("");
    input.setAttachments([]);
  }
  const isDraftCurrent = input.draft?.capture() ?? (() => true);
  input.setSendError(null);
  input.setIsProcessing(true);

  try {
    await input.submitMessage({ message: trimmedMessage, attachments });
    if (isDraftCurrent()) input.clearDraft("sent");
    input.setIsProcessing(false);
    return "submitted";
  } catch (error) {
    input.onSubmitError?.(error);
    if (!isDraftCurrent()) {
      input.draft?.retainFailed({ message: trimmedMessage, attachments });
    } else if (shouldClearOnSubmit) {
      input.setUserInput(trimmedMessage);
      input.setAttachments(attachments);
    }
    input.setSendError(
      error instanceof Error
        ? error.message
        : (input.failedToSendMessage ?? i18n.t("composer.errors.failedToSend")),
    );
    input.setIsProcessing(false);
    return "failed";
  }
}
