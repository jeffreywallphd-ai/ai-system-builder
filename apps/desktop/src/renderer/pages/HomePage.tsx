import {
  ApplicationIcon,
  WorkspaceContextHint,
} from "../../../../../modules/ui/shared";
import workspaceOrbitSrc from "../../../../../modules/ui/shared/assets/illustrations/workspace-orbit.png";
import { useActiveWorkspace, WorkspaceSwitcher } from "../features/workspace";
import type { DesktopPageKey } from "../routes/desktopPages";

export interface HomePageProps {
  readonly onNavigate: (nextPage: DesktopPageKey) => void;
}

type HomeAreaCard = {
  readonly key: Extract<
    DesktopPageKey,
    "systems" | "artifacts" | "assets" | "models" | "image-generation"
  >;
  readonly title: string;
  readonly eyebrow: string;
  readonly description: string;
  readonly buttonLabel: string;
  readonly illustration: HomeCardIllustrationKind;
};

type HomeCardIllustrationKind =
  "system" | "data" | "assets" | "models" | "image-generation";

const homeAreaCards: readonly HomeAreaCard[] = [
  {
    key: "systems",
    title: "Systems",
    eyebrow: "Compose and build",
    description:
      "Construct workspace systems from reusable assets, workflows, pages, tools, models, data, and subsystems.",
    buttonLabel: "Open Systems",
    illustration: "system",
  },
  {
    key: "artifacts",
    title: "Data",
    eyebrow: "Inputs and artifacts",
    description:
      "Upload files, inspect stored artifacts, and keep workspace source material organized.",
    buttonLabel: "Open Data",
    illustration: "data",
  },
  {
    key: "assets",
    title: "Assets",
    eyebrow: "Workspace library",
    description:
      "Browse system defaults, resource-backed views, and workspace-visible asset definitions.",
    buttonLabel: "Open Assets",
    illustration: "assets",
  },
  {
    key: "models",
    title: "Models",
    eyebrow: "Model inventory",
    description:
      "Manage saved model references and prepare model records for workspace workflows.",
    buttonLabel: "Open Models",
    illustration: "models",
  },
  {
    key: "image-generation",
    title: "Image Generation",
    eyebrow: "Generate visual outputs",
    description:
      "Create image outputs from prompts and route finished work into the asset pipeline.",
    buttonLabel: "Open Image Generation",
    illustration: "image-generation",
  },
];

function HomeCardIllustration({
  kind,
}: {
  readonly kind: HomeCardIllustrationKind;
}) {
  if (kind === "system") {
    return (
      <svg
        className="home-card-illustration"
        viewBox="0 0 96 72"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="35" y="8" width="26" height="16" rx="4" />
        <rect x="8" y="48" width="22" height="16" rx="4" />
        <rect x="37" y="48" width="22" height="16" rx="4" />
        <rect x="66" y="48" width="22" height="16" rx="4" />
        <path d="M48 24v12M19 36h58M19 36v12M48 36v12M77 36v12" />
      </svg>
    );
  }

  if (kind === "data") {
    return (
      <svg
        className="home-card-illustration"
        viewBox="0 0 96 72"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M28 10h28l14 14v36H28V10Z" />
        <path d="M56 10v15h14M38 34h22M38 44h18" />
        <rect x="18" y="22" width="18" height="28" rx="4" />
        <path d="M23 32h8M23 40h8" />
      </svg>
    );
  }

  if (kind === "assets") {
    return (
      <svg
        className="home-card-illustration"
        viewBox="0 0 96 72"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="20" y="14" width="24" height="20" rx="5" />
        <rect x="52" y="14" width="24" height="20" rx="5" />
        <rect x="36" y="40" width="24" height="20" rx="5" />
        <path d="M44 24h8M48 34v6M32 34l8 8M64 34l-8 8" />
      </svg>
    );
  }

  if (kind === "models") {
    return (
      <svg
        className="home-card-illustration"
        viewBox="0 0 96 72"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="26" cy="36" r="9" />
        <circle cx="48" cy="18" r="9" />
        <circle cx="70" cy="36" r="9" />
        <circle cx="48" cy="56" r="9" />
        <path d="m34 30 7-6M56 24l7 6M35 42l6 7M61 43l-6 7M35 36h26" />
      </svg>
    );
  }

  return (
    <svg
      className="home-card-illustration"
      viewBox="0 0 96 72"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="18" y="14" width="60" height="44" rx="8" />
      <circle cx="60" cy="28" r="6" />
      <path d="m26 50 15-16 11 11 7-7 11 12" />
      <path d="M24 10v8M20 14h8M78 42v8M74 46h8" />
    </svg>
  );
}

export function HomePage({ onNavigate }: HomePageProps) {
  const workspace = useActiveWorkspace();
  const workspaceName = workspace.activeWorkspace?.displayName;
  const hasWorkspaces = workspace.workspaces.length > 0;
  const heroTitle = workspace.loading
    ? "Loading workspace"
    : (workspaceName ??
      (hasWorkspaces ? "Choose a Workspace" : "Create a Workspace"));

  return (
    <section
      className="home-page ui-stack ui-stack--lg"
      aria-labelledby="home-title"
    >
      <div className="home-workspace-card ui-stack">
        <div className="home-card__header">
          <div className="ui-stack ui-stack--sm">
            <p className="home-card__eyebrow">Welcome back</p>
            <h1 id="home-title" className="ui-panel__title">
              {heroTitle}
            </h1>
            <p className="ui-text-muted">
              {workspaceName
                ? "This is your current workspace. All resources and activities are scoped to this context."
                : "Create or select a workspace to begin building and managing AI systems."}
            </p>
          </div>
          {workspace.loading ? null : (
            <img
              className="home-workspace-card__art"
              src={workspaceOrbitSrc}
              alt=""
              aria-hidden="true"
            />
          )}
        </div>
        <WorkspaceSwitcher />
      </div>

      <WorkspaceContextHint />

      <section
        className="ui-panel home-areas ui-stack"
        aria-label="Application areas"
      >
        <header className="home-areas__header">
          <h2>Build and manage</h2>
          <p className="ui-text-muted">
            Access the core areas to build, manage, and scale AI systems.
          </p>
        </header>
        <div className="home-areas__grid">
          {homeAreaCards.map((card) => (
            <article
              key={card.key}
              className={`ui-panel home-area-card home-area-card--${card.key} ui-stack ui-stack--sm`}
            >
              <div className="home-area-card__main">
                <HomeCardIllustration kind={card.illustration} />
                <div className="home-area-card__content ui-stack ui-stack--sm">
                  <div>
                    <p className="home-card__eyebrow">{card.eyebrow}</p>
                    <h3>{card.title}</h3>
                  </div>
                  <p className="ui-text-muted">{card.description}</p>
                  <div className="home-area-card__actions">
                    <button
                      className="ui-button"
                      type="button"
                      onClick={() => onNavigate(card.key)}
                    >
                      <span className="ui-button__label">
                        {card.buttonLabel}
                      </span>
                      <ApplicationIcon name="arrow-right" />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
