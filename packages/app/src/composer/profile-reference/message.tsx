import { Fragment, useCallback } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import { textReferenceToAgentAttachment, type TextReference } from "./model";

interface ProfileReferenceMessageProps {
  text: string;
  references: TextReference[];
  onOpenMention: (attachment: AgentAttachment) => void;
}

export function ProfileReferenceMessage({
  text,
  references,
  onOpenMention,
}: ProfileReferenceMessageProps) {
  let offset = 0;
  const content = references.map((reference) => {
    const precedingText = text.slice(offset, reference.start);
    offset = reference.end;
    return (
      <Fragment key={reference.id}>
        {precedingText}
        <ProfileReferenceText
          reference={reference}
          onOpenMention={onOpenMention}
          label={text.slice(reference.start, reference.end)}
        />
      </Fragment>
    );
  });

  return (
    <>
      {content}
      {text.slice(offset)}
    </>
  );
}

interface ProfileReferenceTextProps {
  reference: TextReference;
  label: string;
  onOpenMention: (attachment: AgentAttachment) => void;
}

function ProfileReferenceText({ reference, label, onOpenMention }: ProfileReferenceTextProps) {
  const handlePress = useCallback(() => {
    onOpenMention(textReferenceToAgentAttachment(reference));
  }, [onOpenMention, reference]);

  return (
    <Text
      style={styles.reference}
      onPress={handlePress}
      accessibilityRole="button"
      testID={
        reference.kind === "profile_reference"
          ? "user-message-profile-reference"
          : "user-message-session-reference"
      }
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  reference: {
    backgroundColor: theme.colors.interactionHighlight,
  },
}));
