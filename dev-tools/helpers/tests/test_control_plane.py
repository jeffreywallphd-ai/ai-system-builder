from pathlib import Path
import sys
import unittest

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))

from control_plane import catalog
from control_plane.contracts import ControlError


class ManagedSavedStateMigrationChecks(unittest.TestCase):
    def test_workspace_index_has_an_exact_owned_migration_parity_command(self):
        root = HELPERS.parents[1]
        migration = "migrations/postgres/0003-index-workspace-saved-state.sql"
        plan = catalog.plan(root, [migration], ["documentation"], "a" * 64)
        self.assertEqual(plan["coverage"][migration], ["managed-saved-state-postgres-migration"])
        check = next(item for item in plan["selected"] if item["id"] == "managed-saved-state-postgres-migration")
        self.assertEqual(check["argv"], ["node", "--import", "tsx", "--test", "--",
                                        "modules/adapters/persistence/postgres/tests/postgres-database.unit.test.ts"])
        with self.assertRaises(ControlError):
            catalog.plan(root, [migration + ".similar"], ["documentation"], "a" * 64)

    def test_saved_state_scope_uses_only_the_registered_tests(self):
        root = HELPERS.parents[1]
        path = "modules/adapters/transport/api-express/headless/registerManagedSavedStateRoutes.ts"
        owned = {item["id"] for item in catalog.plan(root, [path], ["documentation"], "a" * 64)["selected"]}
        self.assertIn("managed-saved-state-replay", owned)
        self.assertNotIn("focused-tests", owned)
        mixed = catalog.plan(root, [path, "apps/server/src/unrelated.ts"], ["documentation"], "a" * 64)
        self.assertIn("focused-tests", {item["id"] for item in mixed["selected"]})
