import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useCallback } from "react";
import { DemoScreen } from "./client/screen";

function DemoSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const openDemo = useCallback(() => openScreen({ screenId: "main" }), [openScreen]);

  return (
    <SidebarRow icon="Blocks" active={currentScreen?.screenId === "main"} onPress={openDemo} />
  );
}

export default function contribute(client: PluginClientContext) {
  const removeScreen = client.addScreen({
    id: "main",
    title: "界面 Demo",
    Component: DemoScreen,
  });
  const removeSidebarItem = client.addSidebarHeaderItem({
    id: "main",
    title: "界面 Demo",
    Component: DemoSidebarItem,
  });

  return () => {
    removeSidebarItem();
    removeScreen();
  };
}
