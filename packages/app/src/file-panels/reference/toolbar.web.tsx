import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import { Link } from "lucide-react-native";
import {
  SelectionToolbar,
  type AnchoredSelection,
  type SelectionToolbarAction,
} from "@/components/selection-toolbar.web";
import { useToast } from "@/contexts/toast-context";
import { formatFileReference, type FileReferenceRange } from "./model";

export interface FileReferenceSelection extends AnchoredSelection, FileReferenceRange {}

interface FileReferenceSelectionToolbarProps {
  filePath: string;
  readSelection: () => FileReferenceSelection | null;
}

export function FileReferenceSelectionToolbar({
  filePath,
  readSelection,
}: FileReferenceSelectionToolbarProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const actions = useMemo<SelectionToolbarAction<FileReferenceSelection>[]>(
    () => [
      {
        id: "file-selection-copy-reference",
        label: t("panels.file.selection.copyReference"),
        icon: Link,
        onSelect: async (selection) => {
          const reference = formatFileReference(filePath, selection);
          try {
            const copied = await Clipboard.setStringAsync(reference);
            if (copied)
              toast.show(t("panels.file.selection.referenceCopied"), { variant: "success" });
            else toast.error(t("panels.file.selection.copyFailed"));
          } catch {
            // Browser clipboard permissions and insecure origins can reject a user-initiated write.
            toast.error(t("panels.file.selection.copyFailed"));
          }
        },
      },
    ],
    [filePath, t, toast],
  );
  return (
    <SelectionToolbar
      readSelection={readSelection}
      actions={actions}
      label={t("panels.file.selection.actions")}
      testID="file-selection-toolbar"
      clearSelectionOnInvoke={false}
    />
  );
}
