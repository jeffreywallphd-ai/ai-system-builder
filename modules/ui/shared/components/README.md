> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Shared application components

Code-native presentation primitives used by both React surfaces belong here. `ApplicationIcon` provides the shared accessible line-icon vocabulary for shell navigation and common actions without external font or image dependencies. `PanelHeading` combines that vocabulary with a consistent feature-header treatment. App-local shells and features select icons for their own page definitions and actions; the shared components do not decide route availability, navigation behavior, or command semantics.

`SidebarNavigationGroup` provides the accessible disclosure control for wide-screen navigation sections. `TypeBadge` derives a short, colored visual designator from an artifact media type or extension. It supplements the visible file name and media type; it never replaces either as the source of truth.

`WorkflowSequence` and `WorkflowStep` provide the shared numbered-card and connecting-rail treatment for guided, multi-step tasks. The sequence is exposed as a named list and each step as a list item. Features own their fields, validation, state transitions, and commands; the workflow components supply only accessible grouping and consistent presentation.

`ModalDialog` owns the shared modal interaction contract as well as the existing modal surface classes: visible accessible naming, initial focus, contained Tab and Shift+Tab movement, topmost-only Escape handling for stacked dialogs, a visible close control, and focus restoration. Callers own open state and task-specific confirmation rules; backdrop close stays opt-in.

`TabbedPanel` owns the shared attached tab-and-card presentation, tab/tabpanel relationships, roving focus, and horizontal arrow/Home/End activation. Desktop and thin-client compatibility modules may re-export it, but must not fork its behavior.

Shared visual-state hooks may coordinate presentation that must remain consistent across hosts. `useSidebarCollapseState` and `useNavigationGroupCollapseState` own only user interface preferences and their local persistence; they do not alter route availability, permissions, page data, or feature behavior.
