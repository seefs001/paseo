import { Fragment, useCallback, useMemo } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { MessageReference } from "./model";

interface ProfileReferenceMessageProps {
  text: string;
  references: MessageReference[];
  onOpenReference: (reference: MessageReference) => void;
}

export function ProfileReferenceMessage({
  text,
  references,
  onOpenReference,
}: ProfileReferenceMessageProps) {
  let offset = 0;
  const content = references.map((reference) => {
    const precedingText = text.slice(offset, reference.start);
    offset = reference.end;
    return (
      <Fragment key={`${reference.start}:${reference.markdown}`}>
        {precedingText}
        <ProfileReferenceText
          reference={reference}
          onOpenReference={onOpenReference}
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
  reference: MessageReference;
  label: string;
  onOpenReference: (reference: MessageReference) => void;
}

function referenceTestKind(reference: MessageReference): string {
  const inline = reference.reference;
  return inline.kind === "resource_link" ? inline.resource : inline.kind.replace("_reference", "");
}

function ProfileReferenceText({ reference, label, onOpenReference }: ProfileReferenceTextProps) {
  const handlePress = useCallback(() => {
    onOpenReference(reference);
  }, [onOpenReference, reference]);
  const dataSet = useMemo(
    () => ({ paseoReferenceMarkdown: reference.markdown, paseoReferenceLabel: label }),
    [label, reference],
  );

  return (
    <Text
      style={styles.reference}
      onPress={handlePress}
      accessibilityRole="button"
      dataSet={dataSet}
      testID={`user-message-${referenceTestKind(reference)}-reference`}
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
