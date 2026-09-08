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
  meetings: {
    title: "BIM meetings and follow-ups",
    intro: "Agendas, recent discussions, and action items in one place.",
    github: "https://github.com/tritao/bim-meeting-notes",
    filters: [["all", "All"], ["upcoming", "Upcoming agendas"], ["actions", "Open actions"], ["minutes", "Minutes"]],
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
  if (state.filter === "upcoming") return item.kind === "Agendas" && item.date >= new Date().toISOString().slice(0, 10);
  if (state.filter === "actions") return item.actions?.some((action) => !action.completed);
  if (state.filter === "minutes") return item.kind === "Minutes";
  return true;
}

function labelsHtml(labels) {
  const visible = (labels || []).slice(0, 4).map((label) => `<span>${escapeHtml(label)}</span>`).join("");
  return visible + (labels?.length > 4 ? `<span>+${labels.length - 4}</span>` : "");
}

function avatarHtml(url, className = "avatar") {
  if (!url) return "";
  return `<img class="${className}" src="${escapeHtml(url)}" alt="" loading="lazy" width="24" height="24">`;
}

function renderPr(item) {
  const size = `+${item.additions} / −${item.deletions} · ${item.changed_files} files`;
  return `<article class="pr-card"><div class="card-main">
    <div class="badges"><span class="priority priority-${priorityClass(item.priority)}">${escapeHtml(item.priority)}</span><span class="status">${item.draft ? "Draft" : "Ready"}</span></div>
    <h2><a href="${escapeHtml(item.url)}">#${item.number} ${escapeHtml(item.title)}</a></h2>
    <p class="byline">${avatarHtml(item.author_avatar)}<span>by <strong>@${escapeHtml(item.author)}</strong> · updated ${item.age_days}d ago</span></p>
    <div class="labels">${labelsHtml(item.labels)}</div>
  </div><dl><div><dt>Change</dt><dd>${size}</dd></div><div><dt>Merge state</dt><dd>${escapeHtml(item.merge_state)}</dd></div></dl></article>`;
}

function renderIssue(item) {
  const assigned = item.assignees.length ? item.assignees.map((name) => `@${escapeHtml(name)}`).join(", ") : "Unassigned";
  const assigneeAvatars = (item.assignee_avatars || []).map((person) => avatarHtml(person.avatar_url, "avatar avatar-small")).join("");
  const signals = [item.has_reproducer_hint ? "Repro details" : null, item.has_attachment ? "Attachment" : null, item.milestone ? `Milestone: ${escapeHtml(item.milestone)}` : null].filter(Boolean);
  return `<article class="pr-card issue-card"><div class="card-main">
    <div class="badges"><span class="priority priority-${priorityClass(item.priority)}">${escapeHtml(item.priority)}</span><span class="status">${escapeHtml(item.next_action)}</span>${signals.map((signal) => `<span class="signal">${signal}</span>`).join("")}</div>
    <h2><a href="${escapeHtml(item.url)}">#${item.number} ${escapeHtml(item.title)}</a></h2>
    <p class="byline">${avatarHtml(item.author_avatar)}<span>by <strong>@${escapeHtml(item.author)}</strong> · updated ${item.age_days}d ago</span></p>
    <div class="labels">${labelsHtml(item.labels)}</div>
  </div><dl><div><dt>Assignee</dt><dd class="assignees">${assigneeAvatars}<span>${assigned}</span></dd></div><div><dt>Discussion</dt><dd>${item.comments} comments</dd></div></dl></article>`;
}

function renderMeeting(item) {
  const openActions = item.actions.filter((action) => !action.completed);
  const topics = item.topics.slice(0, 5);
  return `<article class="pr-card meeting-card"><div class="card-main">
    <div class="badges"><span class="priority priority-normal">${item.kind === "Agendas" ? "Agenda" : "Minutes"}</span>${openActions.length ? `<span class="status">${openActions.length} open action${openActions.length === 1 ? "" : "s"}</span>` : ""}</div>
    <h2><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></h2>
    <p>${item.date ? new Date(`${item.date}T12:00:00Z`).toLocaleDateString(undefined, { dateStyle: "long", timeZone: "UTC" }) : escapeHtml(item.path)}</p>
    ${topics.length ? `<ul class="topics">${topics.map((topic) => `<li>${escapeHtml(topic)}</li>`).join("")}</ul>` : ""}
    ${openActions.length ? `<div class="meeting-actions"><strong>Open actions</strong>${openActions.map((action) => `<p>○ ${escapeHtml(action.text)}</p>`).join("")}</div>` : ""}
  </div><dl><div><dt>Topics</dt><dd>${item.topics.length}</dd></div><div><dt>Actions</dt><dd>${openActions.length} open · ${item.actions.length} total</dd></div></dl></article>`;
}

function currentItems() {
  if (state.mode === "prs") return state.data.items;
  if (state.mode === "issues") return state.data.issues;
  return [...state.data.meetings.agendas, ...state.data.meetings.minutes];
}

function render() {
  const query = state.query.toLocaleLowerCase();
  const visible = currentItems().filter((item) => {
    const searchable = [item.number, item.title, item.author, ...(item.labels || []), ...(item.assignees || []), ...(item.topics || []), ...(item.actions || []).map((action) => action.text)].join(" ").toLocaleLowerCase();
    return matchesFilter(item) && searchable.includes(query);
  });
  const renderer = state.mode === "prs" ? renderPr : state.mode === "issues" ? renderIssue : renderMeeting;
  queue.innerHTML = visible.map(renderer).join("");
  empty.hidden = visible.length !== 0;
}

function setSummary() {
  const items = currentItems();
  let values;
  if (state.mode === "prs") {
    values = [[items.filter((item) => !item.draft).length, "Ready"], [items.filter((item) => item.draft).length, "Drafts"], [items.filter((item) => item.priority === "Stale candidate").length, "Stale candidates"]];
  } else if (state.mode === "issues") {
    values = [[items.length, "Open issues"], [items.filter((item) => item.priority === "Confirmed").length, "Confirmed"], [items.filter((item) => item.next_action === "Needs triage").length, "Needs triage"]];
  } else {
    const today = new Date().toISOString().slice(0, 10);
    values = [[state.data.meetings.agendas.filter((item) => item.date >= today).length, "Upcoming agendas"], [state.data.meetings.minutes.length, "Meeting notes"], [state.data.meetings.actions.filter((action) => !action.completed).length, "Open actions"]];
  }
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
  document.querySelector("#search").placeholder = mode === "meetings"
    ? "Search meetings, topics, actions…"
    : "Search titles, authors, labels…";
  document.querySelector("#github-link").href = mode === "meetings"
    ? `https://github.com/${state.data.meetings.repository}`
    : view.github;
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
  if (mode === "prs") {
    document.querySelector("#context").textContent = `No activity from ${reviewers}.${hidden ? ` ${hidden} broad PRs with only incidental BIM changes hidden.` : ""}`;
  } else if (mode === "issues") {
    document.querySelector("#context").textContent = "Reproduction and attachment indicators are conservative hints based on the issue report.";
  } else {
    document.querySelector("#context").innerHTML = `Meeting files remain authoritative. <a href="https://github.com/${escapeHtml(state.data.meetings.repository)}/new/main/Agendas">Add an agenda ↗</a>`;
  }
  setSummary();
  render();
}

document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
  window.location.hash = button.dataset.mode === "prs" ? "" : button.dataset.mode;
  setMode(button.dataset.mode);
}));
document.querySelector("#search").addEventListener("input", (event) => { state.query = event.target.value.trim(); render(); });

fetch("data/dashboard.json")
  .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
  .then((data) => {
    if (data.schema_version !== 3 || !Array.isArray(data.items) || !Array.isArray(data.issues) || !data.meetings) throw new Error("Unsupported data format");
    state.data = data;
    document.querySelector("#updated").textContent = data.generated_at ? `Updated ${new Date(data.generated_at).toLocaleString()}` : "Awaiting the first data refresh";
    const requestedMode = window.location.hash.slice(1);
    setMode(views[requestedMode] ? requestedMode : "prs");
  })
  .catch(() => { document.querySelector("#updated").textContent = "Queue unavailable"; error.hidden = false; });
