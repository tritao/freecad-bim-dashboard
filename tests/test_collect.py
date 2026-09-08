import datetime as dt
import importlib.util
import json
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "collect.py"
SPEC = importlib.util.spec_from_file_location("freecad_bim_pr_dashboard", SCRIPT)
dashboard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dashboard)


def pull_request(*, author="contributor", draft=False, updated="2026-09-08T00:00:00Z"):
    return {
        "number": 42,
        "title": "BIM improvement",
        "url": "https://github.com/FreeCAD/FreeCAD/pull/42",
        "createdAt": "2026-09-01T00:00:00Z",
        "updatedAt": updated,
        "isDraft": draft,
        "additions": 10,
        "deletions": 2,
        "changedFiles": 1,
        "mergeStateStatus": "CLEAN",
        "author": {"login": author, "avatar_url": f"https://avatars.example/{author}"},
        "labels": {"nodes": [{"name": "Mod: BIM"}]},
        "files": {"nodes": [{"path": "src/Mod/BIM/example.py"}]},
        "reviews": {"totalCount": 0, "nodes": []},
        "comments": {"totalCount": 0, "nodes": []},
    }


class DashboardTest(unittest.TestCase):
    def test_reviewer_authored_pr_is_excluded(self):
        pr = pull_request(author="Roy-043")
        self.assertFalse(dashboard.needs_review(pr, {"tritao", "roy-043"}))

    def test_review_or_comment_is_excluded_case_insensitively(self):
        for connection in ("reviews", "comments"):
            with self.subTest(connection=connection):
                pr = pull_request()
                pr[connection]["nodes"].append({"author": {"login": "TRITAO"}})
                self.assertFalse(dashboard.needs_review(pr, {"tritao", "roy-043"}))

    def test_unreviewed_pr_is_included(self):
        self.assertTrue(dashboard.needs_review(pull_request(), {"tritao", "roy-043"}))

    def test_normalized_pr_includes_author_avatar(self):
        now = dt.datetime(2026, 9, 8, tzinfo=dt.timezone.utc)
        item = dashboard.normalize(pull_request(author="contributor"), now)
        self.assertEqual(item["author_avatar"], "https://avatars.example/contributor")

    def test_priority_distinguishes_ready_and_old_drafts(self):
        now = dt.datetime(2026, 9, 8, tzinfo=dt.timezone.utc)
        self.assertEqual(dashboard.priority(pull_request(), now), "High")
        old_draft = pull_request(draft=True, updated="2026-01-01T00:00:00Z")
        self.assertEqual(dashboard.priority(old_draft, now), "Stale candidate")

    def test_large_pr_with_incidental_bim_change_is_excluded(self):
        pr = pull_request()
        pr["changedFiles"] = 100
        pr["files"]["nodes"].extend(
            {"path": f"src/Mod/TechDraw/file-{number}.cpp"} for number in range(99)
        )
        self.assertTrue(dashboard.is_incidental_bim(pr, min_percent=10, large_pr_files=25))

    def test_small_pr_is_kept_even_with_one_bim_file(self):
        pr = pull_request()
        pr["changedFiles"] = 12
        self.assertFalse(dashboard.is_incidental_bim(pr, min_percent=10, large_pr_files=25))

    def test_markdown_contains_raw_pr_destination(self):
        now = dt.datetime(2026, 9, 8, tzinfo=dt.timezone.utc)
        item = dashboard.normalize(pull_request(), now)
        report = dashboard.render_markdown(
            [item], "FreeCAD/FreeCAD", "Mod: BIM", ["tritao", "Roy-043"], now
        )
        self.assertIn("https://github.com/FreeCAD/FreeCAD/pull/42", report)
        self.assertNotIn("](https://github.com/FreeCAD/FreeCAD/pull/42)", report)
        self.assertIn("Open and ready for review: **1**", report)

    def test_json_has_dashboard_metadata_and_items(self):
        now = dt.datetime(2026, 9, 8, tzinfo=dt.timezone.utc)
        item = dashboard.normalize(pull_request(), now)
        report = json.loads(
            dashboard.render_json(
                [item], "FreeCAD/FreeCAD", "Mod: BIM", ["tritao", "Roy-043"], now
            )
        )
        self.assertEqual(report["schema_version"], 3)
        self.assertEqual(report["repository"], "FreeCAD/FreeCAD")
        self.assertEqual(report["items"][0]["number"], 42)

    def test_issue_reproducer_hint_requires_populated_steps(self):
        self.assertFalse(dashboard.issue_has_reproducer("### Steps to reproduce\n\nn/a\n\n### Expected"))
        self.assertTrue(
            dashboard.issue_has_reproducer(
                "### Steps to reproduce\n\n1. Create a wall\n2. Change its width\n\n### Expected"
            )
        )

    def test_confirmed_issue_is_ready_to_investigate(self):
        labels = {"Mod: BIM", "Status: Confirmed"}
        self.assertEqual(dashboard.issue_priority(labels, "Wall fails", 3), "Confirmed")
        self.assertEqual(
            dashboard.issue_next_action(labels, False, True, 3), "Ready to investigate"
        )

    def test_old_issue_is_a_stale_candidate(self):
        self.assertEqual(dashboard.issue_priority({"Mod: BIM"}, "Old request", 200), "Stale candidate")
        self.assertEqual(
            dashboard.issue_next_action({"Mod: BIM"}, False, True, 200), "Recheck or close"
        )

    def test_meeting_markdown_extracts_topics_and_actions(self):
        document = dashboard.parse_meeting_document(
            "# BIM meeting — 8 September 2026\n\n## Overview\nText\n\n"
            "## IFC direction\n\n- [ ] @tritao Publish draft\n- [x] Review issue\n",
            "Minutes/2026-09-08.md",
            "https://github.com/example/notes",
            "Minutes",
        )
        self.assertEqual(document["date"], "2026-09-08")
        self.assertEqual(document["topics"], ["IFC direction"])
        self.assertEqual(document["actions"][0], {"completed": False, "text": "@tritao Publish draft"})
        self.assertTrue(document["actions"][1]["completed"])


if __name__ == "__main__":
    unittest.main()
