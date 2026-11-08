import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { BoardScreen } from "@/screens/board-screen";
import { DeskScreen } from "@/screens/desk-screen";

export default function BoardRoute() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  const openTasks = useCallback(() => router.setParams({ view: "tasks" }), []);
  const openDesk = useCallback(() => router.setParams({ view: undefined }), []);

  return (
    <HostRouteBootstrapBoundary>
      {view === "tasks" ? (
        <BoardScreen onOpenDesk={openDesk} />
      ) : (
        <DeskScreen onOpenTasks={openTasks} />
      )}
    </HostRouteBootstrapBoundary>
  );
}
