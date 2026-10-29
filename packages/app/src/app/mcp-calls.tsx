import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { McpCallsScreen } from "@/screens/mcp-calls-screen";

export default function McpCallsRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <McpCallsScreen />
    </HostRouteBootstrapBoundary>
  );
}
