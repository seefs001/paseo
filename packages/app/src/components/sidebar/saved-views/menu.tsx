import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Trash2 } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useShallow } from "zustand/react/shallow";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubTrigger,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import { MenuHint, MenuTextField, useMenuContext } from "@/components/ui/menu";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { selectSidebarViewSnapshot, useSidebarViewStore } from "@/stores/sidebar-view-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { Theme } from "@/styles/theme";
import {
  matchesSidebarView,
  sidebarSavedViewKey,
  useSidebarSavedViewsStore,
  type SavedSidebarView,
} from "./state";

const SAVE_PAGE_ID = "sidebarViewSave";
const MANAGE_PAGE_ID = "sidebarViewManage";
const ThemedBookmark = withUnistyles(Bookmark);
const ThemedTrash = withUnistyles(Trash2);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const DELETE_LEADING = <ThemedTrash size={14} uniProps={mutedIconMapping} />;

export function SidebarSavedViewsMenu(): ReactElement {
  const { t } = useTranslation();
  const views = useSidebarSavedViewsStore((state) => state.views);
  const apply = useSidebarSavedViewsStore((state) => state.apply);
  const current = useSidebarViewStore(useShallow(selectSidebarViewSnapshot));
  const active = views.find((view) => matchesSidebarView(view, current));
  const choices = useMemo(
    () => views.map((view) => ({ view, select: () => apply(view.id) })),
    [apply, views],
  );
  const pages = useMemo<MenuPageDefinition[]>(
    () => [
      {
        id: SAVE_PAGE_ID,
        title: t("sidebar.views.save"),
        hoverIntent: false,
        content: <SaveSidebarViewPage />,
      },
      {
        id: MANAGE_PAGE_ID,
        title: t("sidebar.views.manage"),
        content: <ManageSidebarViewsPage />,
      },
    ],
    [t],
  );

  return (
    <DropdownMenu compactMode="sheet">
      <ToolbarButton
        kind="menu"
        label={t("sidebar.views.title")}
        selected={Boolean(active)}
        testID="sidebar-saved-views-menu"
      >
        <ThemedBookmark size={14} uniProps={mutedIconMapping} />
      </ToolbarButton>
      <DropdownMenuContent
        align="end"
        width={232}
        pages={pages}
        sheetTitle={t("sidebar.views.title")}
        testID="sidebar-saved-views-content"
      >
        {choices.map(({ view, select }) => (
          <DropdownMenuItem
            key={view.id}
            selected={active?.id === view.id}
            onSelect={select}
            testID={`sidebar-saved-view-${view.id}`}
          >
            {view.name}
          </DropdownMenuItem>
        ))}
        {views.length === 0 ? <MenuHint>{t("sidebar.views.empty")}</MenuHint> : null}
        <DropdownMenuSeparator />
        <DropdownMenuSubTrigger id={SAVE_PAGE_ID} testID="sidebar-saved-view-save">
          {t("sidebar.views.save")}
        </DropdownMenuSubTrigger>
        {views.length > 0 ? (
          <DropdownMenuSubTrigger id={MANAGE_PAGE_ID} testID="sidebar-saved-view-manage">
            {t("sidebar.views.manage")}
          </DropdownMenuSubTrigger>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SaveSidebarViewPage(): ReactElement {
  const { t } = useTranslation();
  const menu = useMenuContext("SaveSidebarViewPage");
  const views = useSidebarSavedViewsStore((state) => state.views);
  const save = useSidebarSavedViewsStore((state) => state.save);
  const [name, setName] = useState("");
  const key = sidebarSavedViewKey(name);
  const duplicate = views.some((view) => view.id === key);
  const canSave = key.length > 0 && !duplicate;

  const submit = useCallback(() => {
    if (save(name)) menu.setOpen(false);
  }, [menu, name, save]);

  return (
    <>
      <MenuTextField
        onChangeText={setName}
        placeholder={t("sidebar.views.name")}
        autoFocus
        onSubmitEditing={submit}
        testID="sidebar-saved-view-name"
      />
      <DropdownMenuItem
        disabled={!canSave}
        closeOnSelect={false}
        onSelect={submit}
        testID="sidebar-saved-view-save-submit"
      >
        {t("common.actions.save")}
      </DropdownMenuItem>
      {duplicate ? (
        <MenuHint testID="sidebar-saved-view-error">{t("sidebar.views.duplicate")}</MenuHint>
      ) : null}
    </>
  );
}

function ManageSidebarViewsPage(): ReactElement {
  const { t } = useTranslation();
  const views = useSidebarSavedViewsStore((state) => state.views);
  const remove = useSidebarSavedViewsStore((state) => state.remove);

  const deleteView = useCallback(
    async (view: SavedSidebarView): Promise<void> => {
      const confirmed = await confirmDialog({
        title: t("sidebar.views.removeTitle", { name: view.name }),
        message: t("sidebar.views.removeMessage"),
        confirmLabel: t("workspaceLabels.manage.delete"),
        destructive: true,
      });
      if (confirmed) remove(view.id);
    },
    [remove, t],
  );
  const choices = useMemo(
    () => views.map((view) => ({ view, select: () => deleteView(view) })),
    [deleteView, views],
  );

  return (
    <>
      {choices.map(({ view, select }) => (
        <DropdownMenuItem
          key={view.id}
          leading={DELETE_LEADING}
          onSelect={select}
          testID={`sidebar-saved-view-delete-${view.id}`}
        >
          {t("sidebar.views.remove", { name: view.name })}
        </DropdownMenuItem>
      ))}
    </>
  );
}
