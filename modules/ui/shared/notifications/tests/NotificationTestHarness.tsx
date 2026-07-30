import type { ReactNode } from "react";

import { NotificationProvider, useNotificationCenter } from "../NotificationProvider";

export function NotificationTestHarness({ children }: { readonly children: ReactNode }) {
  return (
    <NotificationProvider>
      {children}
      <NotificationRecordProbe />
    </NotificationProvider>
  );
}

export function readNotificationMessages(scope: ParentNode): readonly string[] {
  const encoded = scope.querySelector<HTMLElement>("[data-notification-records]")
    ?.dataset.notificationRecords;
  return encoded ? JSON.parse(encoded) as string[] : [];
}

function NotificationRecordProbe() {
  const notifications = useNotificationCenter();
  return (
    <output
      hidden
      data-notification-records={JSON.stringify(notifications.state.records.map((record) => record.message))}
    />
  );
}
