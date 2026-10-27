"use strict";
/* The RE console: REA's tools in a cockpit. A target (a program, an app, a page) opens on the left as functions,
   strings and memory; a function opens in the middle as pseudocode, assembly, a control-flow graph and its callers
   and callees; every one of REA's tools has a form, and every call is in the terminal below.
   Everything REA returns describes someone else's program: untrusted text, only ever shown through esc(). */

const RC = {
  ready: false, status: null, tools: [], toolMap: new Map(), target: null, overview: null,
  procs: [], byAddr: new Map(), byName: new Map(), strings: null, segments: null,
  side: "functions", fn: null, ftab: "code", trail: [], results: new Map(), seq: 0, busy: 0,
  history: [], hpos: -1, view: null, cfgSel: null,
};
const RC_HIST = "decomp-wtf-rea-history";
const rcNorm = (a) => { const m = /^0x0*([0-9a-f]+)$/i.exec(String(a ?? "").trim()); return m ? `0x${m[1].toLowerCase()}` : String(a ?? ""); };
const rcNum = (a) => { try { return Number(BigInt(rcNorm(a))); } catch { return NaN; } };
const rcShort = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : String(n));

/* ------------------------------------------------------------------ calls */

/* Any REA tool, through the app: a job, so a minutes-long Ghidra import never holds a request open. Tools that aren't
   read-only come back 409 first; the user confirms, and the call goes again with confirm. */
async function reaCall(tool, args = {}, { quiet = false, confirm = false } = {}) {
  const id = ++RC.seq;
  const line = quiet ? null : rcLog(`<span class="p">›</span> ${esc(tool)} <span class="tm">${esc(rcArgs(args))}</span>`, "run");
  rcBusy(1);
  const t0 = performance.now();
  try {
    let start;
    try {
      start = await rcPost("/api/rea/call", { tool, arguments: args, confirm });
    } catch (e) {
      if (e.confirm && !confirm) {
        if (!window.confirm(`${tool} ${e.confirm.join(" and ")}.\n\nRun it?`)) throw new Error(`${tool}: not run`);
        if (line) line.remove();
        return reaCall(tool, args, { quiet, confirm: true });
      }
      throw e;
    }
    const res = await followJob(start.job);
    RC.results.set(id, res);
    if (RC.results.size > 40) RC.results.delete(RC.results.keys().next().value);
    if (line) {
      line.className = "l ok";
      line.innerHTML = `<span class="p">✓</span> ${esc(tool)} <span class="tm">${esc(rcArgs(args))} · ${((performance.now() - t0) / 1000).toFixed(1)} s · ${bytes(res.size || 0)}</span> <span class="lk" data-res="${id}">view</span>`;
    }
    return res;
  } catch (e) {
    if (line) { line.className = "l err"; line.innerHTML = `<span class="p">✗</span> ${esc(tool)}: ${esc(e.message)}`; }
    throw e;
  } finally {
    rcBusy(-1);
  }
}
async function rcPost(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "X-Decomp": "1", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) { const err = new Error((data && data.error) || `request failed (${res.status})`); err.confirm = data && data.confirm; throw err; }
  return data;
}
const rcArgs = (a) => Object.entries(a || {}).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ").slice(0, 160);
function rcBusy(d) {
  RC.busy = Math.max(0, RC.busy + d);
  const led = $("rcLed");
  led.className = "rc-led " + (RC.busy ? "busy" : RC.status?.configured ? "ready" : "off");
  $("rcState").textContent = RC.busy ? "working…" : !RC.status?.configured ? "REA not set up"
    : RC.target ? `${RC.target.format || "target"} · ${RC.target.architecture || ""}`.replace(/ · $/, "") : "ready";
}

/* ------------------------------------------------------------------ terminal */

function rcLog(html, kind = "") {
  const el = document.createElement("div");
  el.className = `l ${kind}`;
  el.innerHTML = `<span class="tm">${clock(Date.now() / 1000)}</span>${html}`;
  const log = $("rcLog");
  log.append(el);
  while (log.children.length > 400) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
  return el;
}
const rcSay = (text, kind = "sys") => rcLog(esc(text), kind);
$("rcLog").addEventListener("click", (e) => {
  const id = e.target.dataset?.res;
  if (id && RC.results.has(+id)) rcShowResult(RC.results.get(+id));
});
$("rcClear").onclick = () => { $("rcLog").innerHTML = ""; };
$("rcMin").onclick = () => { const t = $("rcTerm"); t.classList.toggle("min"); $("rcMin").textContent = t.classList.contains("min") ? "show" : "hide"; };

const RC_HELP = [
  "help                       this list",
  "open PATH                  open a program, library or app (Ghidra, Hopper or IDA for native code)",
  "fn ADDRESS|NAME            open a function: pseudocode, assembly, flow graph, callers",
  "tools [WORD]               REA's tools, optionally only those matching WORD",
  "TOOL key=value ...         run any tool (values are JSON when they parse: n=16, flag=true)",
  "TOOL {json}                run any tool with a JSON object of arguments",
  "form TOOL                  the tool's form",
  "settings · stop · clear    REA settings · stop REA · clear the terminal",
];
async function rcCommand(text) {
  const line = text.trim();
  if (!line) return;
  RC.history = [line, ...RC.history.filter((h) => h !== line)].slice(0, 100);
  RC.hpos = -1;
  try { localStorage.setItem(RC_HIST, JSON.stringify(RC.history)); } catch { /* storage off */ }
  rcLog(`<span class="p">rea›</span> ${esc(line)}`);
  const [cmd, ...rest] = line.split(/\s+/);
  const tail = line.slice(cmd.length).trim();
  try {
    if (cmd === "help" || cmd === "?") { RC_HELP.forEach((h) => rcSay(h)); return; }
    if (cmd === "clear") { $("rcLog").innerHTML = ""; return; }
    if (cmd === "settings") { rcSettings(true); return; }
    if (cmd === "stop") { await rcPost("/api/rea/stop", {}); RC.target = null; rcSay("REA stopped"); await rcStatus(); return; }
    if (cmd === "open") { await rcOpen(tail); return; }
    if (cmd === "fn") { await rcFunction(tail); return; }
    if (cmd === "form") { rcToolForm(tail); return; }
    if (cmd === "tools") {
      const w = tail.toLowerCase();
      const found = RC.tools.filter((t) => !w || t.name.includes(w) || t.description.toLowerCase().includes(w));
      found.slice(0, 60).forEach((t) => rcSay(`${t.name.padEnd(40)} ${t.title}`));
      if (found.length > 60) rcSay(`… ${found.length - 60} more`);
      return;
    }
    if (!RC.toolMap.has(cmd)) { rcSay(`no command or REA tool called ${cmd}: try help, or tools ${cmd}`, "err"); return; }
    let args = {};
    if (tail.startsWith("{")) args = JSON.parse(tail);
    else for (const pair of rest) {
      const at = pair.indexOf("=");
      if (at < 1) throw new Error(`write arguments as key=value (got ${pair})`);
      const k = pair.slice(0, at), v = pair.slice(at + 1);
      try { args[k] = JSON.parse(v); } catch { args[k] = v; }
      if (typeof args[k] === "number" && /^0x/i.test(v)) args[k] = v;
    }
    const res = await reaCall(cmd, args);
    if (cmd === "open_binary") await rcAfterOpen(res); else rcShowResult(res);
  } catch (e) {
    if (!/^\w+: /.test(e.message)) rcSay(e.message, "err");
  }
}
$("rcCmd").onsubmit = (e) => { e.preventDefault(); const v = $("rcCmdIn").value; $("rcCmdIn").value = ""; rcCommand(v); };
$("rcCmdIn").addEventListener("keydown", (e) => {
  const input = $("rcCmdIn");
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    if (!RC.history.length) return;
    e.preventDefault();
    RC.hpos = Math.max(-1, Math.min(RC.history.length - 1, RC.hpos + (e.key === "ArrowUp" ? 1 : -1)));
    input.value = RC.hpos < 0 ? "" : RC.history[RC.hpos];
  } else if (e.key === "Tab") {
    e.preventDefault();
    const word = input.value.split(/\s+/)[0];
    if (input.value.includes(" ")) return;
    const names = ["help", "open", "fn", "tools", "form", "settings", "stop", "clear", ...RC.tools.map((t) => t.name)];
    const hits = names.filter((n) => n.startsWith(word));
    if (hits.length === 1) input.value = hits[0] + " ";
    else if (hits.length) {
      let p = word;
      while (hits.every((h) => h.startsWith(hits[0].slice(0, p.length + 1))) && p.length < hits[0].length) p = hits[0].slice(0, p.length + 1);
      input.value = p;
      rcSay(hits.slice(0, 30).join("  ") + (hits.length > 30 ? ` … ${hits.length - 30} more` : ""));
    }
  }
});

/* ------------------------------------------------------------------ page */

function rcReturnProject() {
  const a = $("rcBackProject");
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem("decomp-return") || "null"); } catch { saved = null; }
  if (!saved?.slug) { a.hidden = true; return; }
  a.href = `#/p/${saved.slug}`;
  a.textContent = `◀ ${saved.title || saved.slug}`;
  a.title = `Back to ${saved.title || saved.slug}`;
  a.hidden = false;
}

async function showConsole() {
  show("consolePage");
  rcReturnProject();
  if (!RC.ready) {
    RC.ready = true;
    try { RC.history = JSON.parse(localStorage.getItem(RC_HIST) || "[]"); } catch { RC.history = []; }
    rcSay("RE console: REA's tools for any program, app or page. Type help.");
    rcSideTab("functions");
    rcWelcome();
  }
  await rcStatus();
  const q = new URLSearchParams((location.hash.split("?")[1]) || "");
  const path = q.get("path"), fn = q.get("fn");
  if (path && RC.status?.configured) {
    if (!RC.target || RC.target.path !== path) await rcOpen(path).catch(() => {});
    if (fn && RC.target) await rcFunction(fn).catch(() => {});
    history.replaceState(null, "", "#/console");
  }
}

async function rcStatus() {
  try { RC.status = await api("/api/rea"); } catch (e) { RC.status = null; rcSay(e.message, "err"); }
  const st = RC.status;
  $("rcProvider").innerHTML = ["auto", ...(st?.providers || [])].map((p) =>
    `<option value="${esc(p)}" ${p === (st?.settings?.provider || "auto") ? "selected" : ""}>${p === "auto" ? "engine: auto" : esc(p)}</option>`).join("");
  if (st?.target && !RC.target) RC.target = st.target;
  rcBusy(0);
  if (!st?.configured) { rcSettings(true); return; }
  if (!RC.tools.length) {
    try {
      RC.tools = await api("/api/rea/tools");
      RC.toolMap = new Map(RC.tools.map((t) => [t.name, t]));
      $("rcNT").textContent = RC.tools.length;
      rcSay(`REA is ready: ${RC.tools.length} tools (${st.settings.source || "configured"})`);
      if (RC.side === "tools") rcRenderSide();
      if (!RC.target && RC.view === "welcome") rcWelcome();
    } catch (e) {
      rcSay(`REA didn't start: ${e.message}`, "err");
      rcSettings(true);
    }
  }
}

/* ------------------------------------------------------------------ settings */

function rcSettings(open) {
  const box = $("rcSetup");
  if (!open) { box.hidden = true; return; }
  const st = RC.status || { settings: { command: null, env: {}, provider: "ghidra" }, providers: ["ghidra"] };
  const s = st.settings;
  const quote = (a) => (/[\s"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  box.hidden = false;
  box.innerHTML = `<h3>REA settings</h3>
    <p>REA (<code>${esc(st.package || "rea-agents")}</code>) is the analysis server behind this console and behind the agents' <code>inspect_binary</code>.
    ${s.source ? `Found: <b>${esc(s.source)}</b>.` : "It isn't set up yet: give the command that starts its MCP server."}
    Native code needs Ghidra (with Java), Hopper or IDA; JavaScript, web pages and many archives need nothing more.</p>
    <div class="row">
      <label class="grow">Command<input class="rc-input" id="rcSetCmd" value="${esc((s.command || []).map(quote).join(" "))}" placeholder="npx -y ${esc(st.package || "rea-agents")} mcp"></label>
      <label>Native engine<select id="rcSetProv">${(st.providers || []).map((p) => `<option ${p === s.provider ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
    </div>
    <label>Environment (one NAME=value per line: GHIDRA_INSTALL_DIR, JAVA_HOME, HOPPER_LAUNCHER_PATH…)
      <textarea id="rcSetEnv" spellcheck="false">${esc(Object.entries(s.env || {}).map(([k, v]) => `${k}=${v}`).join("\n"))}</textarea></label>
    <div class="row"><button class="rc-btn go" id="rcSetSave" type="button">Save and start REA</button>
      <button class="rc-btn" id="rcSetStop" type="button">Stop REA</button><button class="rc-btn" id="rcSetClose" type="button">Close</button></div>`;
  $("rcSetClose").onclick = () => rcSettings(false);
  $("rcSetStop").onclick = async () => { await rcPost("/api/rea/stop", {}); RC.target = null; RC.tools = []; rcSay("REA stopped"); rcStatus(); };
  $("rcSetSave").onclick = async () => {
    const env = {};
    for (const raw of $("rcSetEnv").value.split("\n")) {
      const at = raw.indexOf("=");
      if (at > 0) env[raw.slice(0, at).trim()] = raw.slice(at + 1).trim();
    }
    try {
      RC.status = await rcPost("/api/rea/settings", { command: $("rcSetCmd").value, env, provider: $("rcSetProv").value });
      RC.tools = []; RC.target = null;
      rcSettings(false);
      rcSay("REA settings saved");
      await rcStatus();
    } catch (e) { toast(esc(e.message), "err"); }
  };
}
$("rcSetBtn").onclick = () => rcSettings($("rcSetup").hidden);

/* ------------------------------------------------------------------ open a target */

$("rcOpen").onsubmit = (e) => { e.preventDefault(); rcOpen($("rcPath").value.trim()).catch(() => {}); };

async function rcOpen(path) {
  if (!path) { $("rcPath").focus(); return; }
  $("rcPath").value = path;
  const args = { path };
  const prov = $("rcProvider").value;
  if (prov && prov !== "auto") args.provider_id = prov;
  rcLoading(`Opening ${path}… (a first look in Ghidra takes a while for a big program)`);
  try {
    const res = await reaCall("open_binary", args);
    await rcAfterOpen(res);
  } catch (e) {
    rcStageError(e.message, "REA couldn't open that as a native program. For apps, pages and archives, pick the matching tool:");
    throw e;
  }
}

async function rcAfterOpen(res) {
  const r = res.result || {};
  RC.target = r.result || r;
  RC.fn = null; RC.trail = []; RC.strings = null; RC.segments = null; RC.procs = [];
  rcBusy(0);
  $("rcDecomp").hidden = !["elf", "pe"].includes(String(RC.target.format || "").toLowerCase());
  rcLoading("Reading the program: functions, memory, strings…");
  const [ov, procs, segs] = await Promise.allSettled([
    reaCall("binary_overview", {}), reaCall("list_procedures", {}), reaCall("list_segments", {})]);
  RC.overview = ov.status === "fulfilled" ? ov.value.result : null;
  if (procs.status === "fulfilled" && Array.isArray(procs.value.result)) rcSetProcs(procs.value.result);
  if (segs.status === "fulfilled" && Array.isArray(segs.value.result)) RC.segments = segs.value.result;
  rcRenderSide();
  rcOverview();
}

function rcSetProcs(list) {
  RC.procs = list.map((p) => ({ address: rcNorm(p.address), name: String(p.value ?? p.name ?? p.address),
    ext: String(p.address).startsWith("EXTERNAL") || !!p.procedure?.external, thunk: !!p.procedure?.thunk }));
  RC.byAddr = new Map(RC.procs.map((p) => [p.address, p]));
  RC.byName = new Map(RC.procs.map((p) => [p.name, p]));
  $("rcNF").textContent = rcShort(RC.procs.length);
}

$("rcDecomp").onclick = async () => {
  if (!RC.target?.path) return;
  if (!window.confirm("Start a byte-matching decomp project from this program?\n\nOnly for your own, legally obtained copy.")) return;
  try {
    const start = await api(`/api/import?path=${encodeURIComponent(RC.target.path)}&confirmed=1`, { method: "POST" });
    rcSay("importing into decomp.anything…");
    const res = await followJob(start.job);
    loadNav();
    location.hash = `#/p/${res.slug}`;
  } catch (e) { toast(esc(e.message), "err"); }
};

/* ------------------------------------------------------------------ sidebar */

document.querySelectorAll("#rcSideTabs [data-side]").forEach((b) => { b.onclick = () => rcSideTab(b.dataset.side); });
$("rcFilter").addEventListener("input", () => rcRenderSide());

async function rcSideTab(side) {
  (RC.filters ||= {})[RC.side] = $("rcFilter").value;  // each list keeps its own filter
  $("rcFilter").value = RC.filters[side] || "";
  RC.side = side;
  document.querySelectorAll("#rcSideTabs [data-side]").forEach((b) => b.classList.toggle("on", b.dataset.side === side));
  $("rcFilter").placeholder = side === "tools" ? "Find a tool" : side === "strings" ? "Find a string" : side === "segments" ? "Find a segment" : "Find a function or address";
  rcRenderSide();
  if (side === "strings" && RC.target && RC.strings === null) {
    RC.strings = [];
    try {
      const res = await reaCall("list_strings", {});
      RC.strings = Array.isArray(res.result) ? res.result : [];
      $("rcNS").textContent = rcShort(RC.strings.length);
    } catch { RC.strings = null; }
    rcRenderSide();
  }
}

function rcRenderSide() {
  const box = $("rcList"), q = $("rcFilter").value.trim().toLowerCase(), cap = 400;
  const more = (n) => (n > cap ? `<div class="rc-more">${(n - cap).toLocaleString()} more: type to narrow</div>` : "");
  if (RC.side === "tools") {
    const groups = new Map();
    for (const t of RC.tools) {
      if (q && !t.name.includes(q) && !t.title.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) continue;
      const g = rcCategory(t.name);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(t);
    }
    box.innerHTML = [...groups].map(([g, ts]) => `<div class="rc-group"><span>${esc(g)}</span><span>${ts.length}</span></div>` + ts.map((t) =>
      `<div class="rc-tool" data-tool="${esc(t.name)}"><div class="nm">${esc(t.name)}${t.risky.length ? '<span class="rc-tag risk">asks</span>' : '<span class="rc-tag ro">read</span>'}</div>
       <div class="ds">${esc(t.description)}</div></div>`).join("")).join("")
      || `<div class="rc-empty">${RC.status?.configured ? "No tool matches." : "Set up REA to see its tools."}</div>`;
    return;
  }
  if (RC.side === "strings") {
    if (!RC.target) { box.innerHTML = `<div class="rc-empty">Open a target first.</div>`; return; }
    if (RC.strings === null || (!RC.strings.length && RC.busy)) { box.innerHTML = `<div class="rc-loading"></div>`; return; }
    const hits = RC.strings.filter((s) => !q || String(s.value).toLowerCase().includes(q) || rcNorm(s.address).includes(q));
    box.innerHTML = hits.slice(0, cap).map((s) => `<div class="rc-item" data-str="${esc(rcNorm(s.address))}"><span class="a">${esc(rcNorm(s.address))}</span><span class="t str">${esc(String(s.value).slice(0, 200))}</span></div>`).join("") + more(hits.length);
    return;
  }
  if (RC.side === "segments") {
    const segs = (RC.segments || []).filter((s) => !q || String(s.name).toLowerCase().includes(q));
    box.innerHTML = segs.length ? segs.map((s) => `<div class="rc-item" title="${esc(rcPerm(s))}"><span class="a">${esc(rcNorm(s.start))}</span><span class="t">${esc(s.name)} <span class="a">${esc(rcPerm(s))} · ${bytes(rcNum(s.end) - rcNum(s.start))}</span></span></div>`).join("")
      : `<div class="rc-empty">${RC.target ? "No memory map." : "Open a target first."}</div>`;
    return;
  }
  if (!RC.procs.length) { box.innerHTML = `<div class="rc-empty">${RC.target ? "No functions listed." : "Open a target to list its functions."}</div>`; return; }
  const hits = RC.procs.filter((p) => !q || p.name.toLowerCase().includes(q) || p.address.includes(q));
  hits.sort((a, b) => (a.ext - b.ext));
  box.innerHTML = hits.slice(0, cap).map((p) => `<div class="rc-item ${RC.fn?.address === p.address ? "on" : ""}" data-fn="${esc(p.address)}"><span class="a">${esc(p.ext ? "ext" : p.address)}</span><span class="t ${p.ext || p.thunk ? "ext" : ""}">${esc(p.name)}</span></div>`).join("") + more(hits.length);
}
$("rcList").addEventListener("click", (e) => {
  const item = e.target.closest("[data-fn],[data-tool],[data-str]");
  if (!item) return;
  if (item.dataset.fn) rcFunction(item.dataset.fn).catch(() => {});
  else if (item.dataset.tool) rcToolForm(item.dataset.tool);
  else if (item.dataset.str) rcStringRefs(item.dataset.str);
});
const rcPerm = (s) => `${s.readable ? "r" : "-"}${s.writable ? "w" : "-"}${s.executable ? "x" : "-"}`;

const RC_CATS = [
  ["Android", /android|adb|apk|jeb/],
  ["Apple", /macho|objc|swift|plist|asset_catalog|interface_builder|keyed_archive|apple|dylib/],
  [".NET & managed", /managed/],
  ["JavaScript & Electron", /javascript|electron|bundle/],
  ["Web", /web|browser/],
  ["Runtime capture", /capture|observe|process|crash|scenario|runtime/],
  ["Firmware & files", /firmware|artifact|pe_resources|extract/],
  ["Evidence & reports", /evidence|reconstruction|coverage|obligation|correlate|changed_behavior|versions|feature|unknown/],
  ["Native code", /./],
];
const rcCategory = (name) => RC_CATS.find(([, re]) => re.test(name))[0];

/* ------------------------------------------------------------------ stage: welcome, overview */

function rcStage(html) { RC.view = "custom"; const s = $("rcStage"); s.innerHTML = html; s.scrollTop = 0; return s; }
function rcLoading(text) { rcStage(`<p class="rc-empty">${esc(text)}</p><div class="rc-loading"></div>`); }
function rcStageError(msg, extra = "") {
  rcStage(`<div class="rc-err">${esc(msg)}</div>${extra ? `<p class="rc-h">${esc(extra)}</p>${rcCardsHtml()}` : ""}`);
}

const RC_STARTS = [
  ["Native program", "Ghidra, Hopper or IDA: functions, pseudocode, flow graphs", "open_binary", "#38e1d6", "EXE"],
  ["Android app", "Classes, methods, manifest and resources of an .apk", "inspect_android_package", "#a6f05a", "APK"],
  ["JavaScript or Electron app", "Recover sources and follow a feature through a bundle", "analyze_javascript_application", "#ffb547", "JS"],
  ["Web page", "Scripts, network, event listeners of a live page", "inspect_web_page", "#5aa8ff", "WEB"],
  [".NET assembly", "Types, members and native boundaries of managed code", "inspect_managed_artifact", "#9d8cff", ".NET"],
  ["Firmware image", "Regions, file systems and extracted parts", "inspect_firmware_regions", "#ff4fa3", "FW"],
  ["Any file", "What it is, what's inside, what it was built with", "inspect_artifact", "#d7e2ee", "?"],
];
function rcCardsHtml() {
  return `<div class="rc-cards">${RC_STARTS.filter(([, , tool]) => !RC.tools.length || RC.toolMap.has(tool)).map(([title, text, tool, color, ic]) =>
    `<div class="rc-card" data-start="${esc(tool)}"><h4><span class="ic" data-bg="${esc(color)}">${esc(ic)}</span>${esc(title)}</h4><p>${esc(text)}</p><code>${esc(tool)}</code></div>`).join("")}</div>`;
}
function rcPaint(root) { root.querySelectorAll("[data-bg]").forEach((el) => { el.style.background = el.dataset.bg; }); }

function rcWelcome() {
  RC.view = "welcome";
  const s = $("rcStage");
  s.innerHTML = `<div class="rc-hero"><h1>Reverse engineer anything.</h1>
    <p>Open a program, library or app above, or start from what you have. Every one of REA's ${RC.tools.length || ""} tools is in <b>Tools</b>, and the terminal below runs them by name.</p></div>
    ${rcCardsHtml()}
    <p class="rc-h">Keys</p>
    <div class="rc-chips"><span class="rc-chip"><b>/</b> filter</span><span class="rc-chip"><b>\`</b> terminal</span><span class="rc-chip"><b>Tab</b> complete a tool</span><span class="rc-chip"><b>↑ ↓</b> history</span><span class="rc-chip"><b>Alt ←</b> back</span></div>`;
  rcPaint(s);
}
$("rcStage").addEventListener("click", (e) => {
  const start = e.target.closest("[data-start]");
  if (start) {
    if (start.dataset.start === "open_binary") { $("rcPath").focus(); return; }
    rcToolForm(start.dataset.start);
    return;
  }
  const go = e.target.closest("[data-go]");
  if (go) { e.preventDefault(); rcFunction(go.dataset.go).catch(() => {}); return; }
  const line = e.target.closest("[data-jump]");
  if (line) { e.preventDefault(); rcMarkAsm(rcNum(line.dataset.jump), rcNum(line.dataset.jump) + 1, true); }
});

function rcOverview() {
  RC.view = "overview";
  const t = RC.target || {}, ov = RC.overview || {};
  const procs = RC.procs.length, ext = RC.procs.filter((p) => p.ext).length;
  const stat = (k, v, c = "") => `<div class="rc-stat"><div class="k">${esc(k)}</div><div class="v ${c}" title="${esc(v)}">${esc(v)}</div></div>`;
  const segs = (RC.segments || ov.segments || []).filter((s) => rcNum(s.end) > rcNum(s.start));
  const total = segs.reduce((n, s) => n + Math.log2(2 + rcNum(s.end) - rcNum(s.start)), 0) || 1;
  const s = rcStage(`<div class="rc-fhead"><div><div class="addr">${esc(t.path || "")}</div><h2>${esc((t.path || "target").split(/[\\/]/).pop())}</h2>
      <div class="sig">${esc([t.kind, t.format, t.architecture].filter(Boolean).join(" · "))}${t.sha256 ? ` · sha256 ${esc(String(t.sha256).slice(0, 16))}…` : ""}</div></div></div>
    <div class="rc-stats">${stat("Functions", (ov.procedure_count ?? procs).toLocaleString(), "c")}${stat("Imports", ext.toLocaleString(), "p")}
      ${stat("Strings", (ov.string_count ?? "—").toLocaleString(), "l")}${stat("Segments", String(ov.segment_count ?? segs.length))}
      ${stat("Format", String(t.format || "—"))}${stat("Architecture", String(t.architecture || "—"))}</div>
    ${segs.length ? `<p class="rc-h">Memory map</p><div class="rc-strip" id="rcStrip">${segs.map((g) => `<div class="rc-seg ${g.executable ? "x" : g.writable ? "w" : g.initialized === false ? "u" : "r"}" data-grow="${(Math.log2(2 + rcNum(g.end) - rcNum(g.start)) / total).toFixed(4)}" title="${esc(`${g.name} ${rcNorm(g.start)}–${rcNorm(g.end)} ${rcPerm(g)} ${bytes(rcNum(g.end) - rcNum(g.start))}`)}"></div>`).join("")}</div>
      <div class="rc-legend"><span><i class="rc-seg x"></i>code</span><span><i class="rc-seg w"></i>writable data</span><span><i class="rc-seg r"></i>read-only</span><span><i class="rc-seg u"></i>uninitialized</span><span>(widths: log of size)</span></div>` : ""}
    <p class="rc-h">Largest functions</p><div id="rcBig" class="rc-chips"></div>
    <p class="rc-h">Start here</p>
    <div class="rc-chips">${RC.procs.filter((p) => /^(main|entry|_start|start|WinMain|wmain|DllMain)$/i.test(p.name)).map((p) => `<a class="rc-chip" data-go="${esc(p.address)}" href="#"><b>${esc(p.name)}</b> ${esc(p.address)}</a>`).join("") || '<span class="rc-chip">pick a function on the left</span>'}</div>`);
  s.querySelectorAll("[data-grow]").forEach((el) => { el.style.flex = `${el.dataset.grow} 1 0`; });
  const sorted = RC.procs.filter((p) => !p.ext).sort((a, b) => rcNum(a.address) - rcNum(b.address)).map((p, i, all) => ({ p, size: (all[i + 1] ? rcNum(all[i + 1].address) : rcNum(p.address)) - rcNum(p.address) }))
    .filter((x) => x.size > 0 && x.size < 1 << 20).sort((a, b) => b.size - a.size).slice(0, 12);
  $("rcBig").innerHTML = sorted.map((x) => `<a class="rc-chip" data-go="${esc(x.p.address)}" href="#"><b>${esc(x.p.name)}</b> ~${bytes(x.size)}</a>`).join("");
}

/* ------------------------------------------------------------------ a function */

async function rcFunction(what, { back = false } = {}) {
  let key = String(what || "").trim();
  if (!key) return;
  if (!/^0x/i.test(key) && RC.byName.has(key)) key = RC.byName.get(key).address;
  if (/^[0-9a-f]{5,}$/i.test(key)) key = `0x${key}`;
  if (RC.fn && !back && RC.fn.address !== rcNorm(key)) RC.trail.push(RC.fn.address);
  rcLoading(`Analysing ${key}…`);
  const res = await reaCall("analyze_function", { procedure: key });
  const d = res.result || {};
  const p = d.procedure || {};
  RC.fn = { address: rcNorm(p.address || key), data: d, meta: res.meta };
  RC.cfgSel = null;
  rcRenderSide();
  const active = $("rcList").querySelector(".rc-item.on");
  if (active) active.scrollIntoView({ block: "nearest" });
  rcRenderFunction();
}

function rcRenderFunction() {
  RC.view = "function";
  const { data: d, meta } = RC.fn, p = d.procedure || {}, nat = d.native_api || {};
  const size = p.body?.total_bytes, blocks = (d.basic_blocks || []).length, asm = rcAsmLines(d.assembly);
  const chip = (k, v) => (v || v === 0 ? `<span class="rc-chip">${esc(k)} <b>${esc(v)}</b></span>` : "");
  const s = rcStage(`<div class="rc-fhead"><div>${RC.trail.length ? '<button class="rc-btn small" id="rcBack" type="button">◀ back</button> ' : ""}<span class="addr">${esc(RC.fn.address)}</span>
      <h2>${esc(p.name || RC.fn.address)}</h2><div class="sig">${esc(p.signature || "")}</div>
      <div class="rc-chips">${chip("bytes", size)}${chip("instructions", asm.length)}${chip("blocks", blocks)}${chip("callers", (d.callers || []).length)}${chip("callees", (d.callees || []).length)}
        ${chip("convention", nat.calling_convention)}${chip("engine", meta?.provider)}${chip("confidence", meta?.confidence)}</div></div>
      <span class="grow"></span><button class="rc-btn small" id="rcFnTool" type="button">More tools…</button></div>
    <nav class="rc-ftabs" id="rcFtabs">${[["code", "Code"], ["graph", "Flow graph"], ["calls", "Callers & callees"], ["data", "Strings & names"], ["raw", "Everything"]]
      .map(([k, l]) => `<button type="button" data-ftab="${k}" class="${RC.ftab === k ? "on" : ""}">${l}</button>`).join("")}</nav>
    <div id="rcFbody"></div>`);
  s.querySelectorAll("#rcFtabs [data-ftab]").forEach((b) => { b.onclick = () => { RC.ftab = b.dataset.ftab; rcRenderFunction(); }; });
  if ($("rcBack")) $("rcBack").onclick = () => rcBack();
  $("rcFnTool").onclick = () => { rcSideTab("tools"); $("rcFilter").value = "procedure"; rcRenderSide(); };
  const body = $("rcFbody");
  if (RC.ftab === "code") {
    body.innerHTML = `<div class="rc-split"><section class="rc-pane"><header><span>Pseudocode</span><span>${esc(meta?.provider || "")}</span></header><pre class="rc-code" id="rcC">${rcHighlightC(d.pseudocode || "")}</pre></section>
      <section class="rc-pane"><header><span>Assembly</span><span>${asm.length} lines</span></header><pre class="rc-code" id="rcA">${rcHighlightAsm(asm, d)}</pre></section></div>`;
    if (RC.cfgSel) rcMarkAsm(RC.cfgSel[0], RC.cfgSel[1], true);
  } else if (RC.ftab === "graph") rcCfg(body, d, asm);
  else if (RC.ftab === "calls") rcCalls(body, d);
  else if (RC.ftab === "data") {
    const strs = d.referenced_strings || [], names = d.referenced_names || [];
    body.innerHTML = `<p class="rc-h">Strings it uses (${strs.length})</p>${rcTable(strs.map((x) => ({ at: x.source_address, string: x.value, address: x.address })))}
      <p class="rc-h">Names it uses (${names.length})</p>${rcTable(names.map((x) => ({ at: x.source_address, name: x.value, address: x.address })))}
      ${(d.comments || []).length ? `<p class="rc-h">Comments</p>${rcTable(d.comments)}` : ""}`;
  } else {
    body.innerHTML = `<div class="rc-json">${rcTree(d, 0)}</div>`;
  }
}
function rcBack() { const prev = RC.trail.pop(); if (prev) rcFunction(prev, { back: true }).catch(() => {}); else if (RC.target) rcOverview(); }
document.addEventListener("keydown", (e) => {
  if ($("consolePage").hidden) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); rcBack(); }
  else if (!typing && e.key === "/") { e.preventDefault(); $("rcFilter").focus(); }
  else if (!typing && e.key === "`") { e.preventDefault(); $("rcTerm").classList.remove("min"); $("rcCmdIn").focus(); }
});

/* ------------------------------------------------------------------ highlighting (tokens escaped one by one) */

const RC_C = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(L?"(?:\\.|[^"\\])*"|L?'(?:\\.|[^'\\])*')|\b(0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b|\b(if|else|while|for|do|return|switch|case|default|break|continue|goto|sizeof|struct|union|enum|typedef|const|static|extern|volatile|try|catch|throw|new|delete|this|true|false|NULL)\b|\b(void|char|short|int|long|float|double|bool|unsigned|signed|undefined\d*|u?int\d*_t|uint|ulong|ushort|uchar|byte|word|dword|qword|wchar_t|size_t|code|longlong|ulonglong|float\d*|wint_t)\b|\b([A-Za-z_][\w:]*)(?=\s*\()|\b((?:FUN|DAT|PTR|LAB|s|u)_[0-9a-fA-F]{4,})\b/g;
function rcHighlightC(src) {
  let out = "", last = 0, m;
  const text = String(src).replace(/^\n+/, "");
  RC_C.lastIndex = 0;
  while ((m = RC_C.exec(text))) {
    out += esc(text.slice(last, m.index));
    const [tok, cm, st, nu, kw, ty, fn, sym] = m;
    if (cm) out += `<span class="cm">${esc(tok)}</span>`;
    else if (st) out += `<span class="st">${esc(tok)}</span>`;
    else if (nu) out += `<span class="nu">${esc(tok)}</span>`;
    else if (kw) out += `<span class="kw">${esc(tok)}</span>`;
    else if (ty) out += `<span class="ty">${esc(tok)}</span>`;
    else if (fn || sym) out += rcSymLink(tok, fn ? "fn" : "nu");
    else out += esc(tok);
    last = m.index + tok.length;
  }
  out += esc(text.slice(last));
  return out.split("\n").map((l) => `<span class="ln">${l || " "}</span>`).join("");
}
function rcSymLink(name, cls) {
  let p = RC.byName.get(name);
  const auto = /^(?:FUN|LAB)_([0-9a-fA-F]+)$/.exec(name);
  if (!p && auto) p = RC.byAddr.get(rcNorm(`0x${auto[1]}`));
  return p && !p.ext ? `<a data-go="${esc(p.address)}" href="#">${esc(name)}</a>` : `<span class="${cls}">${esc(name)}</span>`;
}

const rcAsmLines = (asm) => (Array.isArray(asm) ? asm : String(asm || "").split("\n")).filter((l) => String(l).trim());
const RC_REG = /^(?:[re]?[abcd]x|[abcd][lh]|[re]?(?:si|di|sp|bp|ip)|(?:si|di|sp|bp)l|r\d{1,2}[dwb]?|[xyz]mm\d{1,2}|st\d?|[cdefgs]s|[re]?flags|cr\d|dr\d)$/i;
function rcHighlightAsm(lines, d) {
  const lo = rcNum(RC.fn.address), hi = lo + (d.procedure?.body?.total_bytes || 0);
  return lines.map((raw) => {
    const m = /^\s*(0x[0-9a-f]+|[0-9a-f]+):?\s+(\S+)\s*(.*)$/i.exec(raw);
    if (!m) return `<span class="ln">${esc(raw)}</span>`;
    const [, at, mn, ops] = m;
    const jump = /^(j\w+|call|loop\w*)$/i.test(mn);
    const opsHtml = ops.split(/(0x[0-9a-fA-F]+|\b[A-Za-z][A-Za-z0-9]*\b)/).map((tok) => {
      if (/^0x[0-9a-f]+$/i.test(tok)) {
        const n = rcNorm(tok), v = rcNum(tok), p = RC.byAddr.get(n);
        if (p && !p.ext && n !== RC.fn.address) return `<a data-go="${esc(n)}" href="#" title="${esc(p.name)}">${esc(p.name)}</a>`;
        if (jump && v >= lo && v < hi) return `<a data-jump="${esc(n)}" href="#">${esc(tok)}</a>`;
        if (p) return `<span class="fn" title="${esc(tok)}">${esc(p.name)}</span>`;
        return `<span class="nu">${esc(tok)}</span>`;
      }
      if (RC_REG.test(tok)) return `<span class="rg">${esc(tok)}</span>`;
      return esc(tok);
    }).join("");
    return `<span class="ln" data-at="${esc(rcNorm(at))}"><span class="ad">${esc(rcNorm(at).slice(2).padStart(8, "0"))}</span><span class="${jump ? "jm" : "mn"}">${esc(mn.toLowerCase().padEnd(7))}</span> ${opsHtml}</span>`;
  }).join("");
}
function rcMarkAsm(start, end, scroll) {
  const pane = $("rcA");
  if (!pane) return;
  let first = null;
  pane.querySelectorAll(".ln[data-at]").forEach((el) => {
    const v = rcNum(el.dataset.at), on = v >= start && v < end;
    el.classList.toggle("hi", on);
    if (on && !first) first = el;
  });
  if (first && scroll) first.scrollIntoView({ block: "center" });
}

/* ------------------------------------------------------------------ graphs */

const SVGNS = "http://www.w3.org/2000/svg";
/* A graph canvas in screen pixels: wheel zooms around the pointer, dragging pans, "fit" shows it all. Starts at
   `focus` (an [x, y] point of the graph, at full size) when the whole graph would be too small to read. */
function rcSvg(box, w, h, hint, focus = null) {
  box.innerHTML = `<div class="rc-graph" id="rcGraph"><svg>
    <defs><linearGradient id="rcGrad" x1="0" x2="1"><stop offset="0" stop-color="#38e1d6"/><stop offset="1" stop-color="#ff4fa3"/></linearGradient>
    <marker id="rcArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 8 4 0 8z" fill="#5d7186"/></marker></defs>
    <g id="rcView"></g></svg><div class="tools"><button class="rc-btn small" type="button" id="rcFit">fit</button><button class="rc-btn small" type="button" id="rcOne">1:1</button></div><div class="hint">${esc(hint)}</div></div>`;
  const svg = box.querySelector("svg"), g = box.querySelector("#rcView"), wrap = box.querySelector(".rc-graph");
  const cw = wrap.clientWidth || 900, ch = wrap.clientHeight || 500;
  svg.setAttribute("viewBox", `0 0 ${cw} ${ch}`);
  let k = 1, x = 0, y = 0, drag = null;
  const apply = () => g.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
  const fit = () => { k = Math.min(1.4, (cw - 30) / w, (ch - 30) / h); x = (cw - w * k) / 2; y = Math.max(10, (ch - h * k) / 2); apply(); };
  const one = () => { k = 1; const [fx, fy] = focus || [w / 2, 0]; x = cw / 2 - fx; y = 30 - fy; apply(); };
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const nk = Math.min(4, Math.max(0.05, k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    x = px - (px - x) * (nk / k); y = py - (py - y) * (nk / k); k = nk; apply();
  }, { passive: false });
  svg.addEventListener("pointerdown", (e) => { if (e.target.closest(".rc-node")) return; drag = [e.clientX, e.clientY, x, y]; wrap.classList.add("drag"); svg.setPointerCapture(e.pointerId); });
  svg.addEventListener("pointermove", (e) => { if (drag) { x = drag[2] + e.clientX - drag[0]; y = drag[3] + e.clientY - drag[1]; apply(); } });
  svg.addEventListener("pointerup", () => { drag = null; wrap.classList.remove("drag"); });
  box.querySelector("#rcFit").onclick = fit;
  box.querySelector("#rcOne").onclick = one;
  if (focus && Math.min((cw - 30) / w, (ch - 30) / h) < 0.55) one(); else fit();
  return g;
}
function rcEl(parent, tag, attrs, text) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  parent.append(el);
  return el;
}

/* Control flow: basic blocks in layers by distance from the entry, ordered by their parents; jumps cyan, fall-throughs
   teal, loops (an edge back up) pink and dashed. Click a block to see its instructions. */
function rcCfg(box, d, asm) {
  const blocks = (d.basic_blocks || []).slice(0, 600);
  if (!blocks.length) { box.innerHTML = `<p class="rc-empty">REA gave no basic blocks for this function.</p>`; return; }
  const byStart = new Map(blocks.map((b) => [rcNorm(b.start), b]));
  const entry = byStart.get(RC.fn.address) || blocks[0];
  const layer = new Map([[rcNorm(entry.start), 0]]), queue = [rcNorm(entry.start)];
  while (queue.length) {
    const at = queue.shift(), b = byStart.get(at);
    for (const s of (b.successors || []).map(rcNorm)) if (byStart.has(s) && !layer.has(s)) { layer.set(s, layer.get(at) + 1); queue.push(s); }
  }
  let maxL = Math.max(...layer.values());
  for (const b of blocks) if (!layer.has(rcNorm(b.start))) layer.set(rcNorm(b.start), ++maxL);
  const rows = [];
  for (const [a, l] of layer) (rows[l] ||= []).push(a);
  const W = 156, H = 42, GX = 30, GY = 58, pos = new Map(), preds = new Map();
  for (const b of blocks) for (const s of (b.successors || []).map(rcNorm)) (preds.get(s) || preds.set(s, []).get(s)).push(rcNorm(b.start));
  let width = 0;
  rows.forEach((row, l) => {
    if (!row) return;
    row.sort((a, b) => {
      const bc = (n) => { const ps = (preds.get(n) || []).filter((p) => pos.has(p)); return ps.length ? ps.reduce((s, p) => s + pos.get(p).x, 0) / ps.length : rcNum(n) / 1e9; };
      return bc(a) - bc(b) || rcNum(a) - rcNum(b);
    });
    row.forEach((a, i) => pos.set(a, { x: i * (W + GX), y: l * (H + GY) }));
    width = Math.max(width, row.length * (W + GX));
  });
  rows.forEach((row) => { if (!row) return; const off = (width - row.length * (W + GX)) / 2; row.forEach((a) => { pos.get(a).x += off; }); });
  const height = rows.length * (H + GY);
  const e0 = pos.get(rcNorm(entry.start));
  const g = rcSvg(box, width + 40, height + 40, `${blocks.length} blocks${(d.basic_blocks || []).length > 600 ? " (first 600)" : ""} · wheel to zoom, drag to pan, click a block`,
    [e0.x + W / 2 + 20, e0.y + 20]);
  const edges = rcEl(g, "g", { transform: "translate(20 20)" }), nodes = rcEl(g, "g", { transform: "translate(20 20)" });
  const insns = (b) => asm.filter((l) => { const v = rcNum((/^\s*(0x[0-9a-f]+)/i.exec(l) || [])[1]); return v >= rcNum(b.start) && v < rcNum(b.end); }).length;
  for (const b of blocks) {
    const a = rcNorm(b.start), p = pos.get(a);
    for (const s of (b.successors || []).map(rcNorm)) {
      const q = pos.get(s);
      if (!q) continue;
      const back = layer.get(s) <= layer.get(a), fall = rcNum(s) === rcNum(b.end) || rcNum(s) === rcNum(b.end) + 1;
      const x1 = p.x + W / 2, y1 = p.y + H, x2 = q.x + W / 2, y2 = q.y;
      const path = back ? `M${p.x + W} ${p.y + H / 2} C ${p.x + W + 70} ${p.y + H / 2}, ${q.x + W + 70} ${q.y + H / 2}, ${q.x + W} ${q.y + H / 2}`
        : `M${x1} ${y1} C ${x1} ${y1 + GY / 2}, ${x2} ${y2 - GY / 2}, ${x2} ${y2}`;
      rcEl(edges, "path", { d: path, class: `rc-edge ${back ? "back" : fall ? "fall" : "jump"}`, "marker-end": "url(#rcArrow)" });
    }
    const exit = !(b.successors || []).length;
    const node = rcEl(nodes, "g", { class: `rc-node ${a === rcNorm(entry.start) ? "entry" : exit ? "exit" : ""}`, transform: `translate(${p.x} ${p.y})` });
    rcEl(node, "rect", { width: W, height: H, rx: 6 });
    rcEl(node, "text", { x: 10, y: 17 }, a);
    rcEl(node, "text", { x: 10, y: 32, class: "sub" }, `${insns(b)} insns · ${rcNum(b.end) - rcNum(b.start)} B${exit ? " · exit" : ""}`);
    node.addEventListener("click", () => { RC.cfgSel = [rcNum(b.start), rcNum(b.end)]; RC.ftab = "code"; rcRenderFunction(); });
  }
}

/* Who calls it and what it calls, around it. */
function rcCalls(box, d) {
  const cap = 36, callers = (d.callers || []).slice(0, cap), callees = (d.callees || []).slice(0, cap);
  const W = 210, H = 30, G = 10, colH = (n) => n * (H + G);
  const height = Math.max(colH(callers.length), colH(callees.length), 120) + 40, width = 3 * W + 300;
  const g = rcSvg(box, width, height, `${(d.callers || []).length} callers · ${(d.callees || []).length} callees${(d.callers || []).length > cap || (d.callees || []).length > cap ? ` (first ${cap})` : ""} · click to open`);
  const cx = W + 150, cy = height / 2 - H / 2;
  const node = (x, y, label, cls, address) => {
    const n = rcEl(g, "g", { class: `rc-node ${cls}`, transform: `translate(${x} ${y})` });
    rcEl(n, "rect", { width: W, height: H, rx: 6 });
    rcEl(n, "text", { x: 10, y: 19 }, label.length > 30 ? `${label.slice(0, 29)}…` : label);
    if (address) n.addEventListener("click", () => rcFunction(address).catch(() => {}));
    return n;
  };
  const edge = (x1, y1, x2, y2, cls) => rcEl(g, "path", { d: `M${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`, class: `rc-edge ${cls}`, "marker-end": "url(#rcArrow)" });
  const top = (n) => (height - colH(n)) / 2;
  callers.forEach((c, i) => { const y = top(callers.length) + i * (H + G); edge(20 + W, y + H / 2, cx, cy + H / 2, "in"); });
  callees.forEach((c, i) => { const y = top(callees.length) + i * (H + G); edge(cx + W, cy + H / 2, cx + W + 150, y + H / 2, "call"); });
  callers.forEach((c, i) => node(20, top(callers.length) + i * (H + G), c.name || c.address, "caller", rcNorm(c.address)));
  callees.forEach((c, i) => {
    const ext = String(c.name || "").startsWith("<EXTERNAL>") || c.thunk;
    node(cx + W + 150, top(callees.length) + i * (H + G), String(c.name || c.address).replace("<EXTERNAL>::", "⇢ "), ext ? "ext" : "", ext ? null : rcNorm(c.address));
  });
  node(cx, cy, (d.procedure?.name || RC.fn.address), "center", null);
}

/* ------------------------------------------------------------------ strings → who uses them */

async function rcStringRefs(addr) {
  rcLoading(`Who uses ${addr}…`);
  try {
    const res = await reaCall("xrefs", { address: addr });
    rcShowResult(res, `References to the string at ${addr}`);
  } catch (e) { rcStageError(e.message); }
}

/* ------------------------------------------------------------------ any tool: form + result */

function rcSchema(s, root, depth = 0) {
  if (!s || depth > 8) return s || {};
  if (s.$ref) {
    const name = s.$ref.split("/").pop();
    const { $ref, ...rest } = s;
    return { ...rcSchema((root.$defs || root.definitions || {})[name], root, depth + 1), ...rest };
  }
  for (const k of ["anyOf", "oneOf"]) if (Array.isArray(s[k])) {
    const pick = s[k].map((x) => rcSchema(x, root, depth + 1)).find((x) => x.type !== "null") || {};
    const { [k]: _, ...rest } = s;
    return { ...pick, ...rest };
  }
  return s;
}

function rcToolForm(name) {
  const t = RC.toolMap.get(name);
  if (!t) { rcSay(`no REA tool called ${name}`, "err"); return; }
  RC.view = "tool";
  const root = t.inputSchema || {}, props = root.properties || {}, req = new Set(root.required || []);
  const ex = (root.examples || [])[0] || {};
  const field = ([k, raw]) => {
    const s = rcSchema(raw, root);
    let val = ex[k];
    if (val === undefined && /path/i.test(k) && RC.target?.path && req.has(k)) val = RC.target.path;
    if (val === undefined && k === "procedure" && RC.fn) val = RC.fn.address;
    const label = `<span>${esc(k)}${req.has(k) ? " <em>*</em>" : ""} <small class="rc-tag ro">${esc(s.enum ? "choice" : s.type || "json")}</small></span>`;
    const help = s.description ? `<small>${esc(s.description)}</small>` : "";
    let input;
    if (s.enum) input = `<select data-k="${esc(k)}" data-t="enum"><option value=""></option>${s.enum.map((o) => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    else if (s.type === "boolean") return `<label class="rc-check"><input type="checkbox" data-k="${esc(k)}" data-t="boolean" ${val ? "checked" : ""}> ${esc(k)}${req.has(k) ? " *" : ""}</label>${help}`;
    else if (s.type === "integer" || s.type === "number") input = `<input class="rc-input" type="number" data-k="${esc(k)}" data-t="number" value="${esc(val ?? "")}">`;
    else if (s.type === "string") input = `<input class="rc-input" data-k="${esc(k)}" data-t="string" value="${esc(val ?? "")}" spellcheck="false">`;
    else if (s.type === "array" && rcSchema(s.items, root)?.type === "string") input = `<textarea data-k="${esc(k)}" data-t="lines" spellcheck="false" placeholder="one per line">${esc((val || []).join("\n"))}</textarea>`;
    else input = `<textarea data-k="${esc(k)}" data-t="json" spellcheck="false" placeholder="JSON">${esc(val === undefined ? "" : JSON.stringify(val, null, 1))}</textarea>`;
    return `<label class="rc-field">${label}${input}${help}</label>`;
  };
  const s = rcStage(`<div class="rc-fhead"><div><span class="addr">${esc(rcCategory(t.name))}</span><h2>${esc(t.name)}</h2><div class="sig">${esc(t.title)}</div></div></div>
    <form class="rc-form" id="rcTf"><p class="desc">${esc(t.description)}</p>
      ${t.risky.length ? `<div class="rc-warn">This tool ${esc(t.risky.join(" and "))}: you'll be asked before it runs.</div>` : ""}
      ${Object.entries(props).map(field).join("") || '<p class="rc-empty">No arguments.</p>'}
      <div><button class="rc-btn go" type="submit">Run ${esc(t.name)}</button></div></form>
    <div id="rcOut"></div>`);
  s.querySelector("#rcTf").onsubmit = async (e) => {
    e.preventDefault();
    const args = {};
    try {
      s.querySelectorAll("[data-k]").forEach((el) => {
        const k = el.dataset.k, kind = el.dataset.t;
        if (kind === "boolean") { if (el.checked || req.has(k)) args[k] = el.checked; return; }
        const v = el.value.trim();
        if (!v) return;
        if (kind === "number") args[k] = Number(v);
        else if (kind === "lines") args[k] = v.split("\n").map((x) => x.trim()).filter(Boolean);
        else if (kind === "json") { try { args[k] = JSON.parse(v); } catch { throw new Error(`${k} isn't valid JSON`); } }
        else args[k] = v;
      });
    } catch (err) { $("rcOut").innerHTML = `<div class="rc-err">${esc(err.message)}</div>`; return; }
    $("rcOut").innerHTML = `<div class="rc-loading"></div>`;
    try {
      const res = await reaCall(t.name, args);
      if (t.name === "open_binary") { await rcAfterOpen(res); return; }
      $("rcOut").innerHTML = rcResultHtml(res);
      rcWireResult($("rcOut"));
    } catch (err) { $("rcOut").innerHTML = `<div class="rc-err">${esc(err.message)}</div>`; }
  };
}

function rcShowResult(res, title = "") {
  RC.view = "result";
  const s = rcStage(`<div class="rc-fhead"><div><span class="addr">${esc(rcArgs(res.arguments))}</span><h2>${esc(title || res.tool)}</h2></div><span class="grow"></span>
    ${RC.toolMap.has(res.tool) ? `<button class="rc-btn small" type="button" data-form="${esc(res.tool)}">Form</button>` : ""}</div>${rcResultHtml(res)}`);
  const f = s.querySelector("[data-form]");
  if (f) f.onclick = () => rcToolForm(f.dataset.form);
  rcWireResult(s);
}
function rcWireResult(root) { root.querySelectorAll("td.addr[data-addr]").forEach((td) => { td.onclick = () => rcFunction(td.dataset.addr).catch(() => {}); }); }

function rcResultHtml(res) {
  const m = res.meta || {}, v = res.result;
  const chips = [["tool", res.tool], ["time", `${(res.ms / 1000).toFixed(1)} s`], ["size", bytes(res.size || 0)], ["engine", m.provider], ["confidence", m.confidence], ["authority", m.authority]]
    .filter(([, x]) => x).map(([k, x]) => `<span class="rc-chip">${esc(k)} <b>${esc(x)}</b></span>`).join("");
  const lim = (m.limitations || []).length ? `<details class="rc-json"><summary>${m.limitations.length} limitation${m.limitations.length === 1 ? "" : "s"} REA states</summary>${m.limitations.map((l) => `<div class="row">• ${esc(l)}</div>`).join("")}</details>` : "";
  return `<div class="rc-meta">${chips}${res.truncated ? '<span class="rc-chip"><b>first 20,000 rows</b></span>' : ""}</div>${lim}${rcValue(v)}`;
}

function rcValue(v) {
  if (v == null) return `<p class="rc-empty">No result.</p>`;
  if (typeof v === "string") return /[{;]\s*$|^\s*0x[0-9a-f]+:/im.test(v) ? `<pre class="rc-code rc-pre">${rcHighlightC(v)}</pre>` : `<pre class="rc-pre">${esc(v)}</pre>`;
  if (Array.isArray(v)) return v.length && v.every((x) => x && typeof x === "object" && !Array.isArray(x)) ? rcTable(v) : `<div class="rc-json">${rcTree(v, 0)}</div>`;
  if (typeof v === "object") {
    const parts = [], rest = {};
    for (const [k, x] of Object.entries(v)) {
      if (Array.isArray(x) && x.length && x.every((r) => r && typeof r === "object" && !Array.isArray(r))) parts.push(`<p class="rc-h">${esc(k)} (${x.length})</p>${rcTable(x)}`);
      else if (typeof x === "string" && x.includes("\n")) parts.push(`<p class="rc-h">${esc(k)}</p>${rcValue(x)}`);
      else rest[k] = x;
    }
    return (Object.keys(rest).length ? `<div class="rc-json">${rcTree(rest, 0)}</div>` : "") + parts.join("");
  }
  return `<pre class="rc-pre">${esc(String(v))}</pre>`;
}

function rcTable(rows, cap = 1500) {
  if (!rows.length) return `<p class="rc-empty">Nothing.</p>`;
  const cols = [];
  for (const r of rows.slice(0, 60)) for (const k of Object.keys(r)) if (!cols.includes(k) && cols.length < 9) cols.push(k);
  const cell = (k, x) => {
    if (x == null) return "<td></td>";
    if (typeof x === "object") return `<td title="${esc(JSON.stringify(x).slice(0, 600))}">${esc(JSON.stringify(x).slice(0, 120))}</td>`;
    const s = String(x), n = rcNorm(s), p = RC.byAddr.get(n);
    if (/address|start|entry|^at$|target/i.test(k) && p && !p.ext) return `<td class="addr" data-addr="${esc(n)}" title="${esc(p.name)}">${esc(s)}</td>`;
    return `<td title="${esc(s.slice(0, 600))}">${esc(s.slice(0, 300))}</td>`;
  };
  return `<div class="rc-table-wrap"><table class="rc-table"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
    <tbody>${rows.slice(0, cap).map((r) => `<tr>${cols.map((c) => cell(c, r[c])).join("")}</tr>`).join("")}</tbody></table></div>
    ${rows.length > cap ? `<p class="rc-more">${(rows.length - cap).toLocaleString()} more rows (the terminal's view link has them all as JSON under Everything)</p>` : ""}`;
}

function rcTree(v, depth) {
  if (v === null) return `<span class="b">null</span>`;
  if (typeof v === "string") return `<span class="s">"${esc(v.length > 2000 ? v.slice(0, 2000) + "…" : v)}"</span>`;
  if (typeof v === "number") return `<span class="n">${esc(v)}</span>`;
  if (typeof v === "boolean") return `<span class="b">${v}</span>`;
  const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
  if (!entries.length) return Array.isArray(v) ? "[]" : "{}";
  const shown = entries.slice(0, 200).map(([k, x]) => {
    const key = Array.isArray(v) ? "" : `<span class="k">${esc(k)}</span>: `;
    return x && typeof x === "object" && Object.keys(x).length
      ? `<details ${depth < 1 ? "open" : ""}><summary>${key}${Array.isArray(x) ? `[${x.length}]` : `{${Object.keys(x).length}}`}</summary>${rcTree(x, depth + 1)}</details>`
      : `<div class="row">${key}${rcTree(x, depth + 1)}</div>`;
  }).join("");
  return shown + (entries.length > 200 ? `<div class="row">… ${entries.length - 200} more</div>` : "");
}
