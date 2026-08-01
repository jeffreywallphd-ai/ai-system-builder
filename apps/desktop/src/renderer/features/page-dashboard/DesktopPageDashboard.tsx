import {
  PageDashboard,
  type PageDashboardKind,
} from "../../../../../../modules/ui/shared";
import { desktopPageDashboardSource } from "./desktopPageDashboardSource";

export function DesktopPageDashboard(props: {
  readonly kind: PageDashboardKind;
  readonly workspaceId?: string;
  readonly size?: "default" | "large";
}) {
  return <PageDashboard {...props} source={desktopPageDashboardSource} />;
}
