const state = { items: [], filter: "all", query: "" };

const queue = document.querySelector("#queue");
const empty = document.querySelector("#empty");
const error = document.querySelector("#error");

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = String(value);
  return node.innerHTML;
}

function matchesFilter(item) {
  if (state.filter === "ready") return !item.draft;
  if (state.filter === "draft") return item.draft;
  if (state.filter === "stale") return item.priority === "Stale candidate";
  return true;
}

function render() {
  const query = state.query.toLocaleLowerCase();
  const visible = state.items.filter((item) => {
    const searchable = [item.number, item.title, item.author, ...(item.labels || [])]
      .join(" ")
      .toLocaleLowerCase();
    return matchesFilter(item) && searchable.includes(query);
  });

  queue.innerHTML = visible.map((item) => {
    const size = `+${item.additions} / −${item.deletions} · ${item.changed_files} files`;
    const status = item.draft ? "Draft" : "Ready";
    return `<article class="pr-card">
      <div class="card-main">
        <div class="badges">
          <span class="priority priority-${item.priority.toLowerCase().replaceAll(" ", "-")}">${escapeHtml(item.priority)}</span>
          <span class="status">${status}</span>
        </div>
        <h2><a href="${escapeHtml(item.url)}">#${item.number} ${escapeHtml(item.title)}</a></h2>
        <p>by <strong>@${escapeHtml(item.author)}</strong> · updated ${item.age_days}d ago</p>
        <div class="labels">${(item.labels || []).map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>
      </div>
      <dl>
        <div><dt>Change</dt><dd>${size}</dd></div>
        <div><dt>Merge state</dt><dd>${escapeHtml(item.merge_state)}</dd></div>
      </dl>
    </article>`;
  }).join("");

  empty.hidden = visible.length !== 0;
}

function setCounts(items) {
  document.querySelector("#ready-count").textContent = items.filter((item) => !item.draft).length;
  document.querySelector("#draft-count").textContent = items.filter((item) => item.draft).length;
  document.querySelector("#stale-count").textContent = items.filter((item) => item.priority === "Stale candidate").length;
}

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("[data-filter].active").classList.remove("active");
    button.classList.add("active");
    state.filter = button.dataset.filter;
    render();
  });
});

document.querySelector("#search").addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  render();
});

fetch("data/prs.json")
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then((data) => {
    if (data.schema_version !== 1 || !Array.isArray(data.items)) throw new Error("Unsupported data format");
    state.items = data.items;
    setCounts(data.items);
    const reviewers = data.excluded_reviewers.map((name) => `@${name}`).join(" or ");
    const incidental = data.incidental_prs?.length || 0;
    const hidden = incidental ? ` ${incidental} broad PR${incidental === 1 ? "" : "s"} with only incidental BIM changes hidden.` : "";
    document.querySelector("#context").textContent = `Showing open ${data.label} PRs without activity from ${reviewers}.${hidden}`;
    document.querySelector("#updated").textContent = data.generated_at
      ? `Updated ${new Date(data.generated_at).toLocaleString()}`
      : "Awaiting the first data refresh";
    render();
  })
  .catch(() => {
    document.querySelector("#updated").textContent = "Queue unavailable";
    error.hidden = false;
  });
