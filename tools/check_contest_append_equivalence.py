"""Run existing disposable family fixtures with append/full-rebuild assertions.

No application data root is accepted. Existing unittest factories own every host.
This reuses their exchange/location/mode/correction/delete cases instead of
maintaining a second catalogue of synthetic contest configurations.
"""
from collections import Counter
from copy import deepcopy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "python"), str(ROOT / "python/tests")]
from contest_host.host import APPEND_RECALCULATION_PLUGINS, FULL_REBUILD_APPEND_PLUGINS, Host


def main():
    counts = Counter()
    original = Host.recalculate_append

    def compare(desk, contact):
        original(desk, contact)
        before = desk.database.fetch_all_contacts_asc()
        score = desk.score()
        saved_contact, saved_duplicate = deepcopy(desk.contact), desk.contact_is_dupe
        desk.database.conn.execute("SAVEPOINT equivalence")
        try:
            Host.rebuild(desk)
            after = desk.database.fetch_all_contacts_asc()
            rebuilt_score = desk.score()
        finally:
            desk.database.conn.execute("ROLLBACK TO equivalence")
            desk.database.conn.execute("RELEASE equivalence")
            desk.contact, desk.contact_is_dupe = saved_contact, saved_duplicate
        if before != after or score != rebuilt_score:
            differences = [(left["ID"], {key: (left[key], right[key]) for key in left if left[key] != right[key]})
                           for left, right in zip(before, after) if left != right]
            raise AssertionError(f"{desk.state['pluginID']} append/rebuild differs: {differences}; scores {score} / {rebuilt_score}")
        counts[desk.state["pluginID"]] += 1

    loader = unittest.TestLoader()
    # The append workload tests deliberately prohibit any rebuild; keep them in
    # their existing focused suite. Here the comparison must invoke rebuild.
    suite = unittest.TestSuite(loader.discover(str(ROOT / "python/tests"), pattern=name)
                              for name in ("test_*plugins_host.py", "test_oceania_host.py", "test_trans_tasman_host.py"))
    with patch.object(Host, "recalculate_append", staticmethod(compare)):
        result = unittest.TextTestRunner(verbosity=1).run(suite)
    print("APPEND_EQUIVALENCE " + ", ".join(f"{plugin}={counts[plugin]}" for plugin in sorted(counts)))
    missing = APPEND_RECALCULATION_PLUGINS - FULL_REBUILD_APPEND_PLUGINS - counts.keys()
    print("FULL_REBUILD_FALLBACK " + ", ".join(sorted(FULL_REBUILD_APPEND_PLUGINS)))
    print("UNCOVERED_APPEND_PLUGINS " + ", ".join(sorted(missing)))
    return 0 if result.wasSuccessful() and not missing else 1


if __name__ == "__main__":
    sys.exit(main())
