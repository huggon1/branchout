let token;
let currentBrowsePath;
let selectedRunId;
let localSelection;

const byId = (id) => document.getElementById(id);
const text = (tag, value, className) => {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  return element;
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "x-branchout-evaluation-token": token,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "request_failed");
  return value;
}

function displayError(element, message) {
  element.textContent = message;
  element.classList.add("fail");
}

async function browse(path) {
  const data = await api(`/api/browse?path=${encodeURIComponent(path || "")}`);
  currentBrowsePath = data.current;
  byId("repositoryPath").value = data.current;
  byId("directoryBrowser").hidden = false;
  byId("browserLocation").textContent = data.current;
  byId("parentButton").disabled = !data.parent;
  byId("parentButton").dataset.path = data.parent || "";
  const entries = byId("directoryEntries");
  entries.replaceChildren();
  for (const entry of data.entries) {
    const button = text("button", entry.name);
    button.type = "button";
    button.addEventListener("click", () => { void browse(entry.path).catch(() => displayError(byId("targetState"), "This directory could not be opened.")); });
    entries.append(button);
  }
  if (data.entries.length === 0) entries.append(text("p", "No subdirectories in this location.", "help"));
}

function renderTarget(value) {
  const state = byId("targetState");
  state.classList.remove("fail");
  if (!value) {
    state.textContent = "Choose a Git repository for packaged preflight.";
    return;
  }
  byId("repositoryPath").value = value.directory;
  state.replaceChildren(
    text("strong", value.directory),
    text("div", value.head ? `${value.branch} · ${value.head.slice(0, 10)} · ${value.hasUncommittedChanges ? "uncommitted changes" : "clean worktree"}` : value.reason),
    text("div", "Ready for packaged preflight and conversation selection."),
  );
}

async function loadTarget() {
  const value = await api("/api/target");
  renderTarget(value.selected);
}

async function selectTarget() {
  const state = byId("targetState");
  state.textContent = "Checking Git repository…";
  try {
    const value = await api("/api/target", { method: "POST", body: JSON.stringify({ directory: byId("repositoryPath").value }) });
    renderTarget(value.selected);
    localSelection = null;
    byId("sessionList").replaceChildren();
    byId("localRunButton").disabled = true;
  } catch {
    displayError(state, "Select a readable Git repository directory.");
  }
}

async function openProfile() {
  const state = byId("modelState");
  state.textContent = "Opening the isolated evaluation profile…";
  try {
    await api("/api/profile/open", { method: "POST", body: JSON.stringify({ app: byId("appPath").value }) });
    state.textContent = "Evaluation profile opened. Configure the model in Branchout, then close its window.";
  } catch { displayError(state, "Could not open the packaged app. Check its path."); }
}

async function inspectConversations() {
  const state = byId("localState");
  state.textContent = "Opening packaged app and inspecting selected repository…";
  byId("preflightButton").disabled = true;
  try {
    localSelection = await api("/api/target/preflight", { method: "POST", body: JSON.stringify({ app: byId("appPath").value }) });
    byId("modelState").textContent = localSelection.model.configured
      ? `Model ready: ${localSelection.model.identifier}`
      : "Model connection missing in the evaluation profile. Open the profile and configure it before running.";
    const list = byId("sessionList");
    list.replaceChildren();
    for (const session of localSelection.codexSessions) {
      const label = document.createElement("label");
      label.className = "session-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = session.sessionId;
      checkbox.addEventListener("change", updateLocalButton);
      label.append(checkbox, text("span", `${session.title} · ${session.attribution} · ${session.preview?.usableUserMessageCount ?? 0} user messages · ${new Date(session.date).toLocaleString()}`));
      list.append(label);
    }
    state.textContent = `${localSelection.codexSessions.length} conversations found. Select the ones to analyze; review attribution in the packaged app if uncertain.`;
    updateLocalButton();
  } catch { displayError(state, "Packaged preflight failed. Close the evaluation profile window, check the app path, and retry."); }
  finally { byId("preflightButton").disabled = false; }
}

function updateLocalButton() {
  const selected = [...byId("sessionList").querySelectorAll('input[type="checkbox"]:checked')];
  byId("localRunButton").disabled = !localSelection?.model.configured || selected.length === 0 || !byId("appPath").value.trim();
}

async function startLocal() {
  const state = byId("localState");
  const sessionIds = [...byId("sessionList").querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
  try {
    await api("/api/runs", { method: "POST", body: JSON.stringify({ mode: "local", scenarioId: "EV-04", app: byId("appPath").value, sessionIds, rangeId: byId("localRange").value }) });
    state.textContent = "Local analysis started. Progress and saved results appear below.";
    await loadActive();
  } catch { displayError(state, "Local analysis could not start. Refresh packaged preflight and check the profile window."); }
}

async function loadScenarios() {
  const scenarios = await api("/api/scenarios");
  const list = byId("scenarioList");
  list.replaceChildren();
  for (const scenario of scenarios) {
    const row = document.createElement("div");
    row.className = "scenario-row";
    row.append(
      text("span", scenario.id, "scenario-id"),
      text("span", scenario.title, "scenario-name"),
      text("span", `Fixture: ${scenario.fixture} · Local: ${scenario.local}`, "scenario-state"),
    );
    list.append(row);
  }
}

async function loadRuns() {
  const runs = await api("/api/runs");
  const list = byId("runList");
  list.replaceChildren();
  if (runs.length === 0) {
    list.append(text("p", "No saved runs yet.", "help"));
    return;
  }
  for (const run of runs) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "run-row";
    row.append(
      text("span", run.scenarioId, "scenario-id"),
      text("span", `${run.outcome} · ${run.mode}`, run.outcome === "passed" ? "pass" : run.outcome === "failed" ? "fail" : ""),
      text("span", new Date(run.startedAt).toLocaleString(), "run-meta"),
    );
    row.addEventListener("click", () => { void loadRun(run.runId); });
    list.append(row);
  }
  if (selectedRunId && runs.some((run) => run.runId === selectedRunId)) await loadRun(selectedRunId);
}

async function loadRun(runId) {
  const run = await api(`/api/runs/${runId}`);
  selectedRunId = runId;
  byId("detailStatus").textContent = run.outcome;
  const detail = byId("runDetail");
  detail.replaceChildren();
  detail.append(
    text("p", `${run.scenarioId} · ${run.mode} · ${new Date(run.startedAt).toLocaleString()}`),
    text("p", `Code ${run.code.revision.slice(0, 10)}${run.code.dirty ? " (working tree changed)" : ""}; app ${run.app.version}; model ${run.model.identifier}`),
    text("p", `Inputs: ${run.inputScope.repository.selected} repository files, ${run.inputScope.commits.selected} commits, ${run.inputScope.conversations.selected} conversations.`),
  );
  const checkHeading = text("h3", "Checks");
  detail.append(checkHeading);
  const checks = document.createElement("ul");
  for (const check of run.checks) checks.append(text("li", `${check.id}: ${check.outcome}${check.observed === undefined ? "" : ` (${check.observed}/${check.expected})`}`));
  detail.append(checks);
  detail.append(text("h3", "Stages"));
  const stages = document.createElement("ul");
  for (const stage of run.stages) stages.append(text("li", `${stage.name}: ${stage.outcome}${stage.code ? ` (${stage.code})` : ""}`));
  detail.append(stages);
  detail.append(text("p", `Human review: ${run.review.status}`));
  for (const artifact of run.artifacts.filter((item) => item.kind === "report" || item.kind === "trace_html")) {
    const link = text("a", `Download ${artifact.kind === "report" ? "report" : "trace"}: ${artifact.relativePath}`);
    link.href = `/api/runs/${runId}/artifacts/${encodeURIComponent(artifact.relativePath)}`;
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      const response = await fetch(link.href, { headers: { "x-branchout-evaluation-token": token } });
      if (!response.ok) return displayError(detail, "Artifact could not be opened.");
      const objectUrl = URL.createObjectURL(await response.blob());
      const temporary = document.createElement("a");
      temporary.href = objectUrl;
      temporary.download = artifact.relativePath.split("/").at(-1);
      temporary.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    });
    detail.append(link, document.createElement("br"));
  }
  const screenshot = run.artifacts.find((artifact) => artifact.kind === "screenshot");
  if (screenshot) {
    const button = text("button", "View desktop screenshot");
    button.type = "button";
    button.addEventListener("click", async () => {
      const response = await fetch(`/api/runs/${runId}/artifacts/${encodeURIComponent(screenshot.relativePath)}`, {
        headers: { "x-branchout-evaluation-token": token },
      });
      if (!response.ok) return displayError(detail, "Screenshot could not be opened.");
      const image = document.createElement("img");
      image.alt = "Desktop screenshot from this evaluation run";
      image.src = URL.createObjectURL(await response.blob());
      detail.append(image);
      button.disabled = true;
    });
    detail.append(button);
  }
}

async function loadActive() {
  const active = await api("/api/active");
  const state = byId("runState");
  const running = active?.state === "starting" || active?.state === "running";
  byId("runButton").disabled = running || !byId("appPath").value.trim();
  state.classList.toggle("fail", active?.state === "failed");
  state.textContent = active ? `${active.scenarioId}: ${active.state}${active.stage ? ` · ${active.stage}` : ""}${active.error ? ` · ${active.error}` : ""}` : "Ready";
  if (active?.runId && !running && selectedRunId !== active.runId) {
    await loadRuns();
    await loadRun(active.runId);
  }
}

async function startFixture() {
  try {
    await api("/api/runs", { method: "POST", body: JSON.stringify({
      mode: "fixture",
      scenarioId: byId("fixtureScenario").value,
      app: byId("appPath").value,
    }) });
    await loadActive();
  } catch {
    displayError(byId("runState"), "Could not start. Check the packaged app path.");
  }
}

async function init() {
  const session = await (await fetch("/api/session")).json();
  token = session.token;
  byId("appPath").value = session.defaultAppPath;
  byId("appPath").addEventListener("input", () => { void loadActive(); updateLocalButton(); });
  byId("browseButton").addEventListener("click", () => { void browse(byId("repositoryPath").value).catch(() => displayError(byId("targetState"), "This directory could not be opened.")); });
  byId("parentButton").addEventListener("click", () => { void browse(byId("parentButton").dataset.path); });
  byId("selectButton").addEventListener("click", () => { void selectTarget(); });
  byId("profileButton").addEventListener("click", () => { void openProfile(); });
  byId("preflightButton").addEventListener("click", () => { void inspectConversations(); });
  byId("localRunButton").addEventListener("click", () => { void startLocal(); });
  byId("runButton").addEventListener("click", () => { void startFixture(); });
  byId("refreshButton").addEventListener("click", () => { void loadRuns(); });
  await Promise.all([loadTarget(), loadScenarios(), loadRuns(), loadActive()]);
  setInterval(() => { void loadActive(); }, 2_000);
}

void init().catch(() => displayError(byId("runState"), "Console could not load local evaluation data."));
