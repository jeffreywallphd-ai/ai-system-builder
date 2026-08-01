export type ApplicationIconName =
  | "add"
  | "artifacts"
  | "assets"
  | "arrow-right"
  | "browse"
  | "archive"
  | "chevron"
  | "close"
  | "copy"
  | "collapse"
  | "context"
  | "dataset"
  | "delete"
  | "download"
  | "expand"
  | "home"
  | "info"
  | "image-generation"
  | "library"
  | "link"
  | "menu"
  | "models"
  | "notifications"
  | "play"
  | "refresh"
  | "save"
  | "security"
  | "settings"
  | "switch"
  | "systems"
  | "upload";

export interface ApplicationIconProps {
  readonly name: ApplicationIconName;
  readonly className?: string;
}

export function ApplicationIcon({ name, className }: ApplicationIconProps) {
  const resolvedClassName = ["ui-app-icon", className]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      className={resolvedClassName}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {renderIconPaths(name)}
    </svg>
  );
}

function renderIconPaths(name: ApplicationIconName) {
  switch (name) {
    case "add":
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 8v8M8 12h8" />
        </>
      );
    case "arrow-right":
      return <path d="M4 12h15M14 7l5 5-5 5" />;
    case "browse":
      return (
        <>
          <path d="M3 7.5h7l2-2h9v12.75A1.75 1.75 0 0 1 19.25 20H4.75A1.75 1.75 0 0 1 3 18.25V7.5Z" />
          <circle cx="13" cy="13" r="3.25" />
          <path d="m15.5 15.5 2.5 2.5" />
        </>
      );
    case "archive":
      return (
        <>
          <path d="M4 7h16v13H4V7Z" />
          <path d="M3 4h18v3H3zM9 11h6" />
        </>
      );
    case "copy":
      return (
        <>
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
        </>
      );
    case "link":
      return (
        <>
          <path d="m9 15-1.5 1.5a3.5 3.5 0 0 1-5-5L6 8a3.5 3.5 0 0 1 5 0" />
          <path d="m15 9 1.5-1.5a3.5 3.5 0 0 1 5 5L18 16a3.5 3.5 0 0 1-5 0M8 12h8" />
        </>
      );
    case "chevron":
      return <path d="m7 9 5 5 5-5" />;
    case "close":
      return <path d="m6 6 12 12M18 6 6 18" />;
    case "home":
      return (
        <>
          <path d="m3.5 10 8.5-7 8.5 7" />
          <path d="M5.5 9v11h13V9M9.5 20v-6h5v6" />
        </>
      );
    case "info":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10.5v6M12 7.25h.01" />
        </>
      );
    case "systems":
      return (
        <>
          <rect x="9" y="2.75" width="6" height="5" rx="1" />
          <rect x="2.5" y="16.25" width="6" height="5" rx="1" />
          <rect x="9" y="16.25" width="6" height="5" rx="1" />
          <rect x="15.5" y="16.25" width="6" height="5" rx="1" />
          <path d="M12 7.75v4M5.5 12h13M5.5 12v4.25M12 12v4.25M18.5 12v4.25" />
        </>
      );
    case "artifacts":
      return (
        <>
          <ellipse cx="12" cy="5" rx="7.5" ry="3" />
          <path d="M4.5 5v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V5M4.5 11v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6" />
        </>
      );
    case "context":
      return (
        <>
          <path d="M4 5.5h6.5c1.1 0 1.5.65 1.5 1.5v12c0-.85-.4-1.5-1.5-1.5H4v-12Z" />
          <path d="M20 5.5h-6.5c-1.1 0-1.5.65-1.5 1.5v12c0-.85.4-1.5 1.5-1.5H20v-12Z" />
          <path d="M6.5 9h3M14.5 9h3M6.5 12h3M14.5 12h3" />
        </>
      );
    case "assets":
      return (
        <>
          <path d="m12 2.75 7.5 4.3v9.9L12 21.25l-7.5-4.3v-9.9L12 2.75Z" />
          <path d="m4.75 7.2 7.25 4.2 7.25-4.2M12 11.4v9.55" />
        </>
      );
    case "library":
      return (
        <>
          <path d="M4 4.5h5.5v15H4zM14.5 4.5H20v15h-5.5z" />
          <path d="M9.5 7h5M9.5 17h5" />
        </>
      );
    case "models":
      return (
        <>
          <path d="m12 2.75 7.5 4.5v9.5l-7.5 4.5-7.5-4.5v-9.5l7.5-4.5Z" />
          <circle cx="12" cy="12" r="3" />
          <path d="M12 5.75v3M12 15v3.25M6.7 9l2.7 1.5M14.6 13.5l2.7 1.5M17.3 9l-2.7 1.5M9.4 13.5 6.7 15" />
        </>
      );
    case "notifications":
      return (
        <>
          <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 6 2.5 6 2.5 7.5H4c0-1.5 2.5-1.5 2.5-7.5Z" />
          <path d="M9.5 20h5M10 4.5a2 2 0 0 1 4 0" />
        </>
      );
    case "image-generation":
      return (
        <>
          <rect x="3" y="5" width="18" height="15" rx="2" />
          <circle cx="15.75" cy="9.25" r="1.5" />
          <path d="m5.5 17 4.25-4.5 3.25 3.25 2-2L18.5 17M7 2v4M5 4h4" />
        </>
      );
    case "security":
      return (
        <>
          <path d="M12 2.5 20 6v5.25c0 5.1-3.35 8.15-8 10.25-4.65-2.1-8-5.15-8-10.25V6l8-3.5Z" />
          <path d="m8.5 12 2.2 2.2 4.8-5" />
        </>
      );
    case "settings":
      return (
        <>
          <path d="m9.5 3-.7 2.1c-.48.2-.94.47-1.35.78l-2.16-.46-2.2 3.82 1.47 1.65a7.3 7.3 0 0 0 0 2.22l-1.47 1.65 2.2 3.82 2.16-.46c.41.31.87.58 1.35.78l.7 2.1h5l.7-2.1c.48-.2.94-.47 1.35-.78l2.16.46 2.2-3.82-1.47-1.65a7.3 7.3 0 0 0 0-2.22l1.47-1.65-2.2-3.82-2.16.46a7.3 7.3 0 0 0-1.35-.78L14.5 3h-5Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      );
    case "menu":
      return (
        <>
          <path d="M4 6.5h16M4 12h16M4 17.5h16" />
        </>
      );
    case "collapse":
      return (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M16 8l-4 4 4 4" />
        </>
      );
    case "expand":
      return (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M12 8l4 4-4 4" />
        </>
      );
    case "dataset":
      return (
        <>
          <path d="M6 7.5h12v12H6z" />
          <path d="M9 4v7M5.5 7.5h7M16.5 2.5v3M15 4h3M19.5 8.5v3M18 10h3" />
        </>
      );
    case "delete":
      return (
        <>
          <path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
        </>
      );
    case "download":
      return (
        <>
          <path d="M12 4v12M7.5 11.5 12 16l4.5-4.5" />
          <path d="M5 14v5h14v-5" />
        </>
      );
    case "play":
      return <path d="m8 5 11 7-11 7V5Z" />;
    case "refresh":
      return (
        <>
          <path d="M20 7v5h-5M4 17v-5h5" />
          <path d="M6.1 8.4A7 7 0 0 1 18.7 7L20 12M4 12l1.3 5A7 7 0 0 0 17.9 15.6" />
        </>
      );
    case "save":
      return (
        <>
          <path d="M4 4h13l3 3v13H4V4Z" />
          <path d="M8 4v6h8V4M8 20v-6h8v6" />
        </>
      );
    case "switch":
      return (
        <>
          <path d="M4 8h14M15 5l3 3-3 3M20 16H6M9 13l-3 3 3 3" />
        </>
      );
    case "upload":
      return (
        <>
          <path d="M12 16V4M7.5 8.5 12 4l4.5 4.5" />
          <path d="M5 14v5h14v-5" />
        </>
      );
  }
}
