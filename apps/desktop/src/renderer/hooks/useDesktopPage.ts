import { useState } from "react";

import type { DesktopPageKey } from "../routes/desktopPages";

export function useDesktopPage(initialPage: DesktopPageKey = "home") {
  const [activePage, setActivePage] = useState<DesktopPageKey>(initialPage);

  return {
    activePage,
    setActivePage,
  };
}
