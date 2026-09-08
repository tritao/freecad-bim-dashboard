# FreeCAD BIM dashboard

A small, read-only dashboard for open FreeCAD BIM pull requests and issues
that need maintainer attention. It keeps triage focused without replacing
GitHub's discussion and review interfaces.

The queue currently excludes PRs authored, reviewed, or commented on by
`tritao` or `Roy-043`. Large cross-module changes are hidden when fewer than
10% of their files belong to BIM, Draft, Arch, or IFC. Both rules are
configurable from the collector command line.

The Issues view groups reports into confirmed bugs, reports needing
reproduction, unassigned work, and stale candidates. Attachment and
reproduction indicators are conservative hints derived from the issue form;
the dashboard does not claim to have reproduced an issue.

The Meetings view reads agendas and minutes from `tritao/bim-meeting-notes`.
It lists discussion topics and collects Markdown task-list items as follow-up
actions. Use `--meetings-repo` to point the collector at
`FreeCAD/BIM-meetings` after the repository moves to the organization.

## Run locally

The collector requires an authenticated [GitHub CLI](https://cli.github.com/).

```bash
python3 scripts/collect.py --format json --output dashboard/data/dashboard.json
python3 -m http.server --directory dashboard 8000
```

Open `http://localhost:8000`.

For a Markdown report instead:

```bash
python3 scripts/collect.py
```

Run the tests with:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
node --check dashboard/app.js
```

## Publishing

GitHub Actions validates every change. Pushes to `main`, manual runs, and the
hourly schedule regenerate the queue and deploy the static files to GitHub
Pages. The repository's Pages source must be set to GitHub Actions.
