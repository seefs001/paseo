import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MoreVertical, PinOff } from "lucide-react-native";
import { SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import { Alert } from "@/components/ui/alert";
import { DensityIcon } from "@/components/ui/density-icon";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import {
  useUnpinSidebarWorkspaces,
  type WorkspacePinTarget,
} from "@/hooks/use-sidebar-workspace-pin";

interface SidebarPinnedSectionHeaderProps {
  workspaces: readonly WorkspacePinTarget[];
  supportsPinningByServerId: ReadonlyMap<string, boolean>;
  collapsed: boolean;
  onToggle: () => void;
}

export function SidebarPinnedSectionHeader({
  workspaces,
  supportsPinningByServerId,
  collapsed,
  onToggle,
}: SidebarPinnedSectionHeaderProps) {
  const { t } = useTranslation();
  const unpin = useUnpinSidebarWorkspaces();
  const targets = useMemo(
    () =>
      workspaces.filter((workspace) => supportsPinningByServerId.get(workspace.serverId) === true),
    [workspaces, supportsPinningByServerId],
  );
  const { mutate } = unpin;
  const handleUnpinAll = useCallback(() => mutate(targets), [mutate, targets]);
  const unpinIcon = useMemo(
    () => <DensityIcon icon={PinOff} size="sm" color="foregroundMuted" />,
    [],
  );

  return (
    <SidebarSectionHeader
      title={t("sidebar.pinned.title")}
      collapsed={collapsed}
      onToggle={onToggle}
      testID="sidebar-pinned-section-header"
    >
      <DropdownMenu>
        <ToolbarButton
          kind="menu"
          compact
          label={t("sidebar.pinned.actions")}
          disabled={targets.length === 0 || unpin.isPending}
          testID="sidebar-pinned-actions"
        >
          <DensityIcon icon={MoreVertical} size="sm" color="foregroundMuted" />
        </ToolbarButton>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            leading={unpinIcon}
            onSelect={handleUnpinAll}
            disabled={targets.length === 0}
            status={unpin.isPending ? "pending" : "idle"}
            pendingLabel={t("sidebar.pinned.unpinningAll")}
            closeOnSelect={false}
            testID="sidebar-unpin-all"
          >
            {t("sidebar.pinned.unpinAll")}
          </DropdownMenuItem>
          {unpin.isError ? (
            <Alert
              variant="error"
              size="xs"
              description={unpin.error.message}
              testID="sidebar-unpin-all-error"
            />
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarSectionHeader>
  );
}
