import { useCallback, useEffect, useState } from "react";

const navigationGroupsStorageKey =
  "ai-system-builder.ui.collapsed-navigation-groups";

function readCollapsedGroups(): ReadonlySet<string> {
  try {
    const storedValue = window.localStorage.getItem(navigationGroupsStorageKey);
    const parsedValue: unknown = storedValue ? JSON.parse(storedValue) : [];

    return new Set(
      Array.isArray(parsedValue)
        ? parsedValue.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    );
  } catch {
    return new Set();
  }
}

export function useNavigationGroupCollapseState() {
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  useEffect(() => {
    setCollapsedGroups(readCollapsedGroups());
  }, []);

  const isNavigationGroupExpanded = useCallback(
    (groupId: string) => !collapsedGroups.has(groupId),
    [collapsedGroups],
  );

  const toggleNavigationGroup = useCallback((groupId: string) => {
    setCollapsedGroups((currentGroups) => {
      const nextGroups = new Set(currentGroups);

      if (nextGroups.has(groupId)) {
        nextGroups.delete(groupId);
      } else {
        nextGroups.add(groupId);
      }

      try {
        window.localStorage.setItem(
          navigationGroupsStorageKey,
          JSON.stringify([...nextGroups]),
        );
      } catch {
        // The disclosure control remains usable when persistence is unavailable.
      }

      return nextGroups;
    });
  }, []);

  return { isNavigationGroupExpanded, toggleNavigationGroup } as const;
}
