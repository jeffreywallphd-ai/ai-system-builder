> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`useNavigationMenu` owns keyboard and dismissal behavior for the desktop and thin
shells' existing flat navigation menus. Keep the host's page list, current-page
selection and navigation callback authoritative. The shared hook opens on
Enter/Space or arrows, moves between enabled items, supports Home/End and a label
key, and returns focus on Escape or selection. Tab closes the menu and retains
normal browser traversal. Outside mouse/touch closes without taking focus.
Unmount removes the exact owned listeners. Native button activation remains a
single host callback; menu selection adds no authorization.
DOM checks use the menu's owner window, including isolated browser/test contexts.

The behavior follows the keyboard and state principles in the W3C
[menu button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) and
[menu](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/) patterns. Rendered fixture
tests and actual host UI checks have distinct evidence scopes.
