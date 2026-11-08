import type { ArtifactReadPayload } from "@getpaseo/client/internal/daemon-client";
import { useCallback } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { ZoomableImage } from "@/components/zoomable-viewport/image";
import { FileHtmlPreview } from "@/file-panels/html-preview";
import { ArtifactSelection } from "./selection";
import type { ArtifactQuoteInput } from "./quote";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export function artifactMimeType(payload: ArtifactReadPayload): string {
  const extension = payload.artifact.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (payload.artifact.media === "image")
    return IMAGE_MIME[extension] ?? "application/octet-stream";
  if (payload.artifact.media === "html") return "text/html";
  if (payload.artifact.media === "markdown") return "text/markdown";
  return "text/plain";
}

export function ArtifactContent({
  payload,
  view,
  onQuote,
}: {
  payload: ArtifactReadPayload;
  view: "preview" | "source";
  onQuote?: (quote: ArtifactQuoteInput) => void;
}) {
  const { artifact, content } = payload;
  const quoteSelection = useCallback(
    (text: string) => onQuote?.({ artifact, text }),
    [artifact, onQuote],
  );
  if (artifact.media === "image") {
    return (
      <ZoomableImage
        uri={`data:${artifactMimeType(payload)};base64,${content}`}
        accessibilityLabel={artifact.title}
        testID="artifact-image"
      />
    );
  }
  if (artifact.media === "html" && view === "preview") {
    return (
      <View style={styles.container}>
        <FileHtmlPreview html={content} testID="artifact-html" />
      </View>
    );
  }
  const showMarkdown = artifact.media === "markdown" && view === "preview";
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ArtifactSelection onQuote={onQuote ? quoteSelection : undefined}>
        {showMarkdown ? (
          <View style={styles.readingFrame}>
            <MarkdownRenderer text={content} selectable />
          </View>
        ) : (
          <ScrollView horizontal>
            <Text selectable style={styles.code} testID="artifact-text">
              {content}
            </Text>
          </ScrollView>
        )}
      </ArtifactSelection>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  content: { padding: theme.spacing[4], flexGrow: 1 },
  readingFrame: { width: "100%", maxWidth: theme.contentMaxWidth, alignSelf: "center" },
  code: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
}));
