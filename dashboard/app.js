const state = { data: null, mode: "prs", filter: "all", query: "" };
const queue = document.querySelector("#queue");
const empty = document.querySelector("#empty");
const error = document.querySelector("#error");
const filters = document.querySelector("#filters");

const views = {
  prs: {
    title: "Pull requests needing a look",
    intro: "Open BIM work that has not yet had input from the selected maintainers.",
    github: "https://github.com/FreeCAD/FreeCAD/pulls?q=is%3Apr+is%3Aopen+label%3A%22Mod%3A+BIM%22",
    filters: [["all", "All"], ["ready", "Ready"], ["draft", "Drafts"], ["stale", "Stale"]],
  },
  issues: {
    title: "BIM issues to work through",
    intro: "Open reports grouped by the next useful maintenance action.",
    github: "https://github.com/FreeCAD/FreeCAD/issues?q=is%3Aissue+is%3Aopen+label%3A%22Mod%3A+BIM%22",
    filters: [["all", "All"], ["triage", "Needs triage"], ["confirmed", "Confirmed"], ["repro", "Needs reproduction"], ["unassigned", "Unassigned"], ["stale", "Stale"]],
  },
};

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = String(value);
  return node.innerHTML;
}

function priorityClass(priority) {
  return priority.toLowerCase().replaceAll(" ", "-");
}

function matchesFilter(item) {
  if (state.filter === "ready") return !item.draft;
  if (state.filter === "draft") return item.draft;
  if (state.filter === "confirmed") return item.priority === "Confirmed";
  if (state.filter === "triage") return item.next_action === "Needs triage";
  if (state.filter === "repro") return item.next_action === "Needs reproduction";
  if (state.filter === "unassigned") return item.assignees?.length === 0;
  if (state.filter === "stale") return item.priority === "Stale candidate";
  return true;
}

function labelsHtml(labels) {
  const visible = (labels || []).slice(0, 4).map((label) => `<span>${escapeHtml(label)}</span>`).join("");
  return visible + (labels?.length > 4 ? `<span>+${labels.length - 4}</span>` : "");
}

function renderPr(item) {
  const size = `+${item.additions} / −${item.deletions} · ${item.changed_files} files`;
  return `<article class="pr-card"><div class="card-main">
    <div class="badges"><span class="priority priority-${priorityClass(item.priority)}">${escapeHtml(item.priority)}</span><span class="status">${item.draft ? "Draft" : "Ready"}</span></div>
    <h2><a href="${escapeHtml(item.url)}">#${item.number} ${escapeHtml(item.title)}</a></h2>
    <p>by <strong>@${escapeHtml(item.author)}</strong> · updated ${item.age_days}d ago</p>
    <div class="labels">${labelsHtml(item.labels)}</div>
  </div><dl><div><dt>Change</dt><dd>${size}</dd></div><div><dt>Merge state</dt><dd>${escapeHtml(item.merge_state)}</dd></div></dl></article>`;
}

function renderIssue(item) {
  const assigned = item.assignees.length ? item.assignees.map((name) => `@${escapeHtml(name)}`).join(", ") : "Unassigned";
  const signals = [item.has_reproducer_hint ? "Repro details" : null, item.has_attachment ? "Attachment" : null, item.milestone ? `Milestone: ${escapeHtml(item.milestone)}` : null].filter(Boolean);
  return `<article class="pr-card issue-card"><div class="card-main">
    <div class="badges"><span class="priority priority-${priorityClass(item.priority)}">${escapeHtml(item.priority)}</span><span class="status">${escapeHtml(item.next_action)}</span>${signals.map((signal) => `<span class="signal">${signal}</span>`).join("")}</div>
    <h2><a href="${escapeHtml(item.url)}">#${item.number} ${escapeHtml(item.title)}</a></h2>
    <p>by <strong>@${escapeHtml(item.author)}</strong> · updated ${item.age_days}d ago</p>
    <div class="labels">${labelsHtml(item.labels)}</div>
  </div><dl><div><dt>Assignee</dt><dd>${assigned}</dd></div><div><dt>Discussion</dt><dd>${item.comments} comments</dd></div></dl></article>`;
}

function currentItems() {
  return state.mode === "prs" ? state.data.items : state.data.issues;
}

function render() {
  const query = state.query.toLocaleLowerCase();
  const visible = currentItems().filter((item) => {
    const searchable = [item.number, item.title, item.author, ...(item.labels || []), ...(item.assignees || [])].join(" ").toLocaleLowerCase();
    return matchesFilter(item) && searchable.includes(query);
  });
  queue.innerHTML = visible.map(state.mode === "prs" ? renderPr : renderIssue).join("");
  empty.hidden = visible.length !== 0;
}

function setSummary() {
  const items = currentItems();
  const values = state.mode === "prs"
    ? [[items.filter((item) => !item.draft).length, "Ready"], [items.filter((item) => item.draft).length, "Drafts"], [items.filter((item) => item.priority === "Stale candidate").length, "Stale candidates"]]
    : [[items.length, "Open issues"], [items.filter((item) => item.priority === "Confirmed").length, "Confirmed"], [items.filter((item) => item.next_action === "Needs triage").length, "Needs triage"]];
  values.forEach(([count, label], index) => {
    document.querySelector(`#count-${index + 1}`).textContent = count;
    document.querySelector(`#label-${index + 1}`).textContent = label;
  });
}

function setMode(mode) {
  state.mode = mode;
  state.filter = "all";
  const view = views[mode];
  document.querySelector("#page-title").textContent = view.title;
  document.querySelector("#page-intro").textContent = view.intro;
  document.querySelector("#github-link").href = view.github;
  document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  filters.innerHTML = view.filters.map(([value, label], index) => `<button class="${index === 0 ? "active" : ""}" data-filter="${value}">${label}</button>`).join("");
  filters.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
    filters.querySelector(".active").classList.remove("active");
    button.classList.add("active");
    state.filter = button.dataset.filter;
    render();
  }));
  const reviewers = state.data.excluded_reviewers.map((name) => `@${name}`).join(" or ");
  const hidden = state.data.incidental_prs?.length || 0;
  document.querySelector("#context").textContent = mode === "prs"
    ? `No activity from ${reviewers}.${hidden ? ` ${hidden} broad PRs with only incidental BIM changes hidden.` : ""}`
    : "Reproduction and attachment indicators are conservative hints based on the issue report.";
  setSummary();
  render();
}

document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
  window.location.hash = button.dataset.mode === "issues" ? "issues" : "";
  setMode(button.dataset.mode);
}));
document.querySelector("#search").addEventListener("input", (event) => { state.query = event.target.value.trim(); render(); });

fetch("data/dashboard.json")
  .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
  .then((data) => {
    if (data.schema_version !== 2 || !Array.isArray(data.items) || !Array.isArray(data.issues)) throw new Error("Unsupported data format");
    state.data = data;
    document.querySelector("#updated").textContent = data.generated_at ? `Updated ${new Date(data.generated_at).toLocaleString()}` : "Awaiting the first data refresh";
    setMode(window.location.hash === "#issues" ? "issues" : "prs");
  })
  .catch(() => { document.querySelector("#updated").textContent = "Queue unavailable"; error.hidden = false; });
