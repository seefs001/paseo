import { useState, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type { BoardCard } from "@/board/columns";
import type { BoardAgentItem, BoardItem, BoardTaskItem } from "@/board/items";
import {
  BoardAgentMenuItems,
  useBoardAgentActions,
  useBoardAgentMenuPages,
} from "@/components/board/agent-card-actions";
import { itemName } from "@/components/board/desk-brief-parts";
import { useTaskMenu } from "@/components/board/task-menu";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";

const MENU_WIDTH = 240;

type TriggerProps = Omit<ComponentProps<typeof ContextMenuTrigger>, "children">;

interface DeskItemContextMenuProps {
  item: BoardItem;
  onEditTask: (card: BoardCard) => void;
  /** Listed first, since a right click skips the press that would open it. */
  onOpenDetail: () => void;
  /** The row's own press, style and accessibility; the trigger becomes the row. */
  triggerProps: TriggerProps;
  children: ReactNode;
}

/**
 * Makes a Desk row its item's context menu: a right click, or a long press on phones, offers what
 * the item's menu button would.
 */
export function DeskItemContextMenu(props: DeskItemContextMenuProps): ReactElement {
  const { item } = props;
  if (item.kind === "agent") return <AgentContextMenu {...props} item={item} />;
  return <TaskContextMenu {...props} item={item} />;
}

function AgentContextMenu({
  item,
  onEditTask,
  onOpenDetail,
  triggerProps,
  children,
}: DeskItemContextMenuProps & { item: BoardAgentItem }): ReactElement {
  const [open, setOpen] = useState(false);
  const actions = useBoardAgentActions(item, itemName(item));
  const pages = useBoardAgentMenuPages(item.serverId, item.task);
  return (
    <ContextMenu open={open} onOpenChange={setOpen}>
      <ContextMenuTrigger {...triggerProps}>{children}</ContextMenuTrigger>
      <ContextMenuContent
        align="start"
        width={MENU_WIDTH}
        pages={pages}
        testID={`desk-item-context-${item.key}`}
      >
        <BoardAgentMenuItems
          actions={actions}
          agentId={item.agent.id}
          task={item.task}
          onEditTask={onEditTask}
          onOpenDetail={onOpenDetail}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function TaskContextMenu({
  item,
  onEditTask,
  onOpenDetail,
  triggerProps,
  children,
}: DeskItemContextMenuProps & { item: BoardTaskItem }): ReactElement {
  const [open, setOpen] = useState(false);
  const menu = useTaskMenu(item.card, { onEdit: onEditTask, onOpenDetail });
  return (
    <>
      <ContextMenu open={open} onOpenChange={setOpen}>
        <ContextMenuTrigger {...triggerProps}>{children}</ContextMenuTrigger>
        <ContextMenuContent
          align="start"
          width={MENU_WIDTH}
          pages={menu.pages}
          testID={`desk-item-context-${item.key}`}
        >
          {menu.items}
        </ContextMenuContent>
      </ContextMenu>
      {menu.overlay}
    </>
  );
}
