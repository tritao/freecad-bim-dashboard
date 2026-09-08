#!/usr/bin/env python3
"""Report open FreeCAD BIM pull requests that still need selected reviewers."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


def run_gh(arguments: list[str]) -> Any:
    """Run an authenticated GitHub CLI request and decode its JSON output."""
    for attempt in range(3):
        process = subprocess.run(
            ["gh", *arguments],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if process.returncode == 0:
            return json.loads(process.stdout)
        if attempt < 2:
            time.sleep(1 << attempt)
    raise subprocess.CalledProcessError(
        process.returncode,
        process.args,
        output=process.stdout,
        stderr=process.stderr,
    )


def fetch_pages(endpoint: str) -> list[dict[str, Any]]:
    """Fetch and flatten every REST page for an endpoint."""
    pages = run_gh(["api", "--paginate", "--slurp", endpoint])
    return [item for page in pages for item in page]


def fetch_pull_requests(
    repository: str, label: str, reviewers: list[str]
) -> list[dict[str, Any]]:
    """Fetch open labeled PRs and adapt REST responses to the report schema."""
    search = f'repo:{repository} is:pr is:open label:"{label}"'
    for reviewer in reviewers:
        search += f" -author:{reviewer} -commenter:{reviewer} -reviewed-by:{reviewer}"
    results = run_gh(
        ["api", "--method", "GET", "search/issues", "-f", f"q={search}", "-f", "per_page=100"]
    )["items"]
    pull_requests = []
    for result in results:
        number = result["number"]
        detail = run_gh(["api", f"repos/{repository}/pulls/{number}"])
        reviews = fetch_pages(f"repos/{repository}/pulls/{number}/reviews?per_page=100")
        comments = fetch_pages(f"repos/{repository}/issues/{number}/comments?per_page=100")
        pull_requests.append(
            {
                "number": number,
                "title": detail["title"],
                "url": detail["html_url"],
                "createdAt": detail["created_at"],
                "updatedAt": detail["updated_at"],
                "isDraft": detail["draft"],
                "additions": detail["additions"],
                "deletions": detail["deletions"],
                "changedFiles": detail["changed_files"],
                "mergeStateStatus": detail["mergeable_state"].upper(),
                "author": {"login": detail["user"]["login"]} if detail.get("user") else None,
                "labels": {"nodes": [{"name": item["name"]} for item in detail["labels"]]},
                "reviews": {
                    "nodes": [
                        {"author": {"login": item["user"]["login"]}}
                        for item in reviews
                        if item.get("user")
                    ]
                },
                "comments": {
                    "nodes": [
                        {"author": {"login": item["user"]["login"]}}
                        for item in comments
                        if item.get("user")
                    ]
                },
            }
        )
    return pull_requests


def fetch_changed_files(repository: str, number: int) -> list[dict[str, str]]:
    """Fetch file paths separately because only large PRs need them."""
    files = fetch_pages(f"repos/{repository}/pulls/{number}/files?per_page=100")
    return [{"path": item["filename"]} for item in files]


def participant_logins(connection: dict[str, Any]) -> set[str]:
    """Return normalized author names from a GraphQL connection."""
    return {
        node["author"]["login"].casefold()
        for node in connection["nodes"]
        if node.get("author") and node["author"].get("login")
    }


def needs_review(pr: dict[str, Any], reviewers: set[str]) -> bool:
    """Check whether neither the author nor prior participants match reviewers."""
    author = (pr.get("author") or {}).get("login", "").casefold()
    participants = participant_logins(pr["reviews"]) | participant_logins(pr["comments"])
    return author not in reviewers and participants.isdisjoint(reviewers)


BIM_PATH_PREFIXES = ("src/Mod/BIM/", "src/Mod/Draft/", "src/Mod/Arch/", "src/Mod/IFC/")


def bim_file_count(pr: dict[str, Any]) -> int:
    """Count files belonging to BIM and its closely related workbenches."""
    return sum(
        node["path"].startswith(BIM_PATH_PREFIXES)
        for node in pr.get("files", {}).get("nodes", [])
    )


def is_incidental_bim(pr: dict[str, Any], min_percent: float, large_pr_files: int) -> bool:
    """Identify broad PRs where BIM-related files are only a small side effect."""
    changed_files = pr["changedFiles"]
    if changed_files < large_pr_files:
        return False
    return 100 * bim_file_count(pr) / changed_files < min_percent


def age_in_days(timestamp: str, now: dt.datetime) -> int:
    updated = dt.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    return max(0, (now - updated).days)


def priority(pr: dict[str, Any], now: dt.datetime) -> str:
    """Assign a small, transparent review-queue priority classification."""
    age = age_in_days(pr["updatedAt"], now)
    labels = {node["name"] for node in pr["labels"]["nodes"]}
    if not pr["isDraft"] and ("Type: Bug" in labels or age <= 14):
        return "High"
    if not pr["isDraft"]:
        return "Normal"
    if age <= 14:
        return "Watch"
    return "Stale candidate"


def normalize(pr: dict[str, Any], now: dt.datetime) -> dict[str, Any]:
    """Convert GraphQL data into the stable report schema."""
    return {
        "number": pr["number"],
        "title": pr["title"],
        "url": pr["url"],
        "author": (pr.get("author") or {}).get("login", "ghost"),
        "draft": pr["isDraft"],
        "priority": priority(pr, now),
        "updated": pr["updatedAt"][:10],
        "age_days": age_in_days(pr["updatedAt"], now),
        "additions": pr["additions"],
        "deletions": pr["deletions"],
        "changed_files": pr["changedFiles"],
        "merge_state": pr["mergeStateStatus"],
        "labels": [node["name"] for node in pr["labels"]["nodes"]],
    }


def markdown_table(items: list[dict[str, Any]]) -> list[str]:
    if not items:
        return ["None."]
    lines = [
        "| Priority | PR | Author | Updated | Size | Merge state |",
        "| --- | --- | --- | --- | ---: | --- |",
    ]
    for item in items:
        size = f'+{item["additions"]}/-{item["deletions"]}, {item["changed_files"]} files'
        lines.append(
            f'| {item["priority"]} | #{item["number"]} {item["title"]}<br>{item["url"]} '
            f'| @{item["author"]} | {item["updated"]} '
            f'({item["age_days"]}d) | {size} | {item["merge_state"]} |'
        )
    return lines


def render_markdown(
    items: list[dict[str, Any]], repository: str, label: str, reviewers: list[str], now: dt.datetime
) -> str:
    ready = [item for item in items if not item["draft"]]
    drafts = [item for item in items if item["draft"]]
    lines = [
        "# FreeCAD BIM PR review dashboard",
        "",
        f"Updated: {now.isoformat(timespec='seconds')}",
        "",
        f"Repository: `{repository}`  ",
        f"Label: `{label}`  ",
        f"Excluded reviewers/authors: {', '.join('@' + name for name in reviewers)}",
        "",
        f"Open and ready for review: **{len(ready)}**  ",
        f"Drafts to watch: **{len(drafts)}**",
        "",
        "## Ready for review",
        "",
        *markdown_table(ready),
        "",
        "## Drafts",
        "",
        *markdown_table(drafts),
        "",
        "Priority is a queue hint: recent ready PRs and bug fixes are High; old drafts are stale candidates.",
        "",
    ]
    return "\n".join(lines)


def render_json(
    items: list[dict[str, Any]],
    repository: str,
    label: str,
    reviewers: list[str],
    now: dt.datetime,
    incidental: list[dict[str, Any]] | None = None,
) -> str:
    """Render the versioned payload consumed by the static web dashboard."""
    payload = {
        "schema_version": 1,
        "generated_at": now.isoformat(timespec="seconds"),
        "repository": repository,
        "label": label,
        "excluded_reviewers": reviewers,
        "incidental_prs": incidental or [],
        "items": items,
    }
    return json.dumps(payload, indent=2) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default="FreeCAD/FreeCAD")
    parser.add_argument("--label", default="Mod: BIM")
    parser.add_argument("--reviewers", default="tritao,Roy-043")
    parser.add_argument(
        "--min-bim-percent",
        type=float,
        default=10,
        help="Hide large PRs with less than this percentage of BIM-related files",
    )
    parser.add_argument(
        "--large-pr-files",
        type=int,
        default=25,
        help="Only apply the BIM relevance cutoff to PRs changing at least this many files",
    )
    parser.add_argument("--format", choices=("markdown", "json"), default="markdown")
    parser.add_argument("--output", type=Path, help="Write the report to this file instead of stdout")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    reviewers_list = [name.strip() for name in args.reviewers.split(",") if name.strip()]
    reviewers = {name.casefold() for name in reviewers_list}
    now = dt.datetime.now(dt.timezone.utc)
    try:
        pull_requests = fetch_pull_requests(args.repo, args.label, reviewers_list)
        unreviewed = [pr for pr in pull_requests if needs_review(pr, reviewers)]
        for pr in unreviewed:
            if pr["changedFiles"] >= args.large_pr_files:
                pr["files"] = {"nodes": fetch_changed_files(args.repo, pr["number"])}
    except (FileNotFoundError, subprocess.CalledProcessError, KeyError, json.JSONDecodeError) as error:
        detail = error.stderr.strip() if isinstance(error, subprocess.CalledProcessError) else str(error)
        print(f"error: unable to query GitHub: {detail}", file=sys.stderr)
        return 1

    incidental_prs = [
        pr
        for pr in unreviewed
        if is_incidental_bim(pr, args.min_bim_percent, args.large_pr_files)
    ]
    items = [
        normalize(pr, now)
        for pr in unreviewed
        if not is_incidental_bim(pr, args.min_bim_percent, args.large_pr_files)
    ]
    priority_order = {"High": 0, "Normal": 1, "Watch": 2, "Stale candidate": 3}
    items.sort(key=lambda item: (item["draft"], priority_order[item["priority"]], item["age_days"]))
    if args.format == "json":
        incidental = [
            {
                "number": pr["number"],
                "title": pr["title"],
                "url": pr["url"],
                "bim_files": bim_file_count(pr),
                "changed_files": pr["changedFiles"],
            }
            for pr in incidental_prs
        ]
        report = render_json(items, args.repo, args.label, reviewers_list, now, incidental)
    else:
        report = render_markdown(items, args.repo, args.label, reviewers_list, now)

    if args.output:
        args.output.write_text(report, encoding="utf-8")
    else:
        print(report, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
