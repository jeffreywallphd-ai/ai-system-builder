import {
  PageDashboard,
  type PageDashboardKind,
} from "../../../../../modules/ui/shared";
import { thinClientPageDashboardSource } from "./thinClientPageDashboardSource";

export function ThinClientPageDashboard(props: {
  readonly kind: PageDashboardKind;
  readonly workspaceId?: string;
  readonly size?: "default" | "large";
}) {
  return <PageDashboard {...props} source={thinClientPageDashboardSource} />;
}
