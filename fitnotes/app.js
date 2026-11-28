/* Latest Workout
 *
 * One tap: find the newest FitNotes_Export_*.csv in the Drive folder
 * "FitNotes Daily", keep only the rows of its latest workout day, and save
 * them back to that folder as FitNotes_Latest.csv plus a dated copy
 * (FitNotes_YYYY-MM-DD.csv). Older full exports go to Drive's trash, keeping
 * the newest KEEP_EXPORTS. Everything runs in the browser with your own
 * Google sign-in; the client ID below only works on this website.
 */
(() => {
  "use strict";

  const CLIENT_ID = "488710691850-f3b4ma6isrgomdb80eskh89eqr0g59ja.apps.googleusercontent.com";
  // Full Drive access is needed to read exports the Drive app uploaded and to
  // trash old ones. Only this page, signed in as you, uses it.
  const SCOPE = "https://www.googleapis.com/auth/drive";
  const FOLDER_NAME = "FitNotes Daily";
  const LATEST_NAME = "FitNotes_Latest.csv";
  const KEEP_EXPORTS = 3;
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
  const EXPORT_RE = /^FitNotes_Export_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})/i;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  const $ = (s) => document.querySelector(s);
  const prefs = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };

  // ------------------------------------------------------------ log
  const logEl = $("#log");
  function log(msg, cls = "") {
    const li = document.createElement("li");
    li.textContent = msg;
    if (cls) li.className = cls;
    logEl.appendChild(li);
    return li;
  }

  // ------------------------------------------------------------ sign-in
  // Google only opens its sign-in window straight after a tap, so the button
  // asks for a token first, before any other awaits.
  let token = null, tokenExp = 0, tokenClient = null, inflight = null;

  window.onGsiLoad = () => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        const p = inflight; inflight = null;
        if (r.error) return p?.reject(new Error("Sign-in was cancelled."));
        token = r.access_token;
        tokenExp = Date.now() + (Number(r.expires_in || 3600) - 120) * 1000;
        prefs.set("signedIn", true);
        p?.resolve(token);
      },
      error_callback: (e) => {
        const p = inflight; inflight = null;
        p?.reject(new Error(e?.type === "popup_failed_to_open"
          ? "The sign-in window was blocked. Tap again." : "Sign-in was cancelled."));
      },
    });
  };

  function getToken() {
    if (token && Date.now() < tokenExp) return Promise.resolve(token);
    if (inflight) return inflight.promise;
    if (!tokenClient) return Promise.reject(new Error("Google sign-in hasn't loaded yet. Check your connection and tap again."));
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    inflight = { promise, resolve, reject };
    tokenClient.requestAccessToken({ prompt: prefs.get("signedIn", false) ? "" : "consent" });
    return promise;
  }

  // ------------------------------------------------------------ Drive
  async function drive(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
    });
    if (res.status === 401) { token = null; throw new Error("Your Google sign-in expired. Tap again."); }
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).error?.message || ""; } catch { /* not JSON */ }
      throw new Error(`Google Drive error ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return res;
  }

  const q = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  async function list(query, fields = "files(id,name,modifiedTime,webViewLink)") {
    const u = new URL(`${API}/files`);
    u.search = new URLSearchParams({ q: query, fields, pageSize: "200", spaces: "drive" });
    return (await (await drive(u)).json()).files || [];
  }

  async function findFolder() {
    const cachedId = prefs.get("folderId", null);
    if (cachedId) {
      try {
        const f = await (await drive(`${API}/files/${cachedId}?fields=id,trashed`)).json();
        if (!f.trashed) return cachedId;
      } catch { /* folder gone; search again */ }
    }
    const found = await list(`name = '${q(FOLDER_NAME)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    if (!found.length) throw new Error(`No Drive folder named "${FOLDER_NAME}". Create it and put your FitNotes export in it.`);
    prefs.set("folderId", found[0].id);
    return found[0].id;
  }

  async function upsert(folderId, name, csv) {
    const existing = await list(`name = '${q(name)}' and '${folderId}' in parents and trashed = false`);
    if (existing.length) {
      const res = await drive(`${UPLOAD}/files/${existing[0].id}?uploadType=media&fields=id,webViewLink`, {
        method: "PATCH", headers: { "Content-Type": "text/csv" }, body: csv,
      });
      return res.json();
    }
    const boundary = "fitnotes" + Math.random().toString(36).slice(2);
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name, parents: [folderId], mimeType: "text/csv" }) +
      `\r\n--${boundary}\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n${csv}\r\n--${boundary}--`;
    const res = await drive(`${UPLOAD}/files?uploadType=multipart&fields=id,webViewLink`, {
      method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
    });
    return res.json();
  }

  // ------------------------------------------------------------ CSV
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const rows = [];
    let row = [], cur = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); cur = "";
        if (row.some((x) => x.trim())) rows.push(row);
        row = [];
      } else cur += c;
    }
    row.push(cur);
    if (row.some((x) => x.trim())) rows.push(row);
    return rows;
  }

  const cell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const toCSV = (rows) => rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";

  const exportStamp = (f) => {
    const m = EXPORT_RE.exec(f.name);
    return m ? m.slice(1).join("") : f.modifiedTime.replace(/\D/g, "").slice(0, 14);
  };

  function localToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // ------------------------------------------------------------ result card
  let lastCSV = "";
  function showResult(day, header, rows, link, folderId) {
    const col = (n) => header.indexOf(n);
    const iEx = col("Exercise"), iW = col("Weight"), iWU = col("Weight Unit"), iR = col("Reps"),
      iD = col("Distance"), iDU = col("Distance Unit"), iT = col("Time"), iC = col("Comment");
    const groups = [];
    for (const r of rows) {
      const name = r[iEx] || "?";
      let g = groups[groups.length - 1];
      if (!g || g.name !== name) groups.push(g = { name, sets: [], notes: [] });
      const parts = [];
      if (r[iW]) parts.push(`${r[iW].replace(/\.0$/, "")}${r[iWU] || ""}`);
      if (r[iR]) parts.push(`×${r[iR]}`);
      if (r[iD]) parts.push(`${r[iD]}${r[iDU] || ""}`);
      if (r[iT]) parts.push(r[iT]);
      g.sets.push(parts.join(" ") || "—");
      if (r[iC]) g.notes.push(r[iC]);
    }
    $("#r-date").textContent = day;
    $("#r-sets").textContent = rows.length;
    $("#r-ex").textContent = new Set(rows.map((r) => r[iEx])).size;
    const listEl = $("#r-list");
    listEl.replaceChildren(...groups.map((g) => {
      const d = document.createElement("div"); d.className = "ex";
      const n = document.createElement("div"); n.className = "name"; n.textContent = g.name;
      const s = document.createElement("div"); s.className = "sets"; s.textContent = g.sets.join(" · ");
      d.append(n, s);
      for (const note of g.notes) {
        const c = document.createElement("div"); c.className = "note"; c.textContent = `“${note}”`;
        d.append(c);
      }
      return d;
    }));
    $("#open").href = link || "https://drive.google.com/";
    $("#folder").href = `https://drive.google.com/drive/folders/${folderId}`;
    $("#result").hidden = false;
  }

  // ------------------------------------------------------------ main
  const goBtn = $("#go");
  goBtn.addEventListener("click", async () => {
    goBtn.disabled = true;
    logEl.replaceChildren();
    $("#result").hidden = true;
    try {
      await getToken();
      const folderId = await findFolder();
      log(`Found folder "${FOLDER_NAME}"`, "ok");

      const exports = (await list(`'${folderId}' in parents and name contains 'FitNotes_Export' and trashed = false`))
        .filter((f) => /\.csv$/i.test(f.name))
        .sort((a, b) => exportStamp(b).localeCompare(exportStamp(a)));
      if (!exports.length) throw new Error(`No FitNotes_Export_….csv in "${FOLDER_NAME}". Export from FitNotes and share it to that folder.`);
      const newest = exports[0];
      const step = log(`Reading ${newest.name}…`);
      const text = await (await drive(`${API}/files/${newest.id}?alt=media`)).text();
      const [header, ...rows] = parseCSV(text);
      if (!header || header[0].trim() !== "Date") throw new Error(`${newest.name} doesn't look like a FitNotes export.`);
      step.textContent = `Read ${newest.name} (${rows.length.toLocaleString()} sets in total)`;
      step.className = "ok";

      const day = rows.map((r) => r[0].trim()).filter((d) => DATE_RE.test(d)).sort().pop();
      if (!day) throw new Error("The export has no workout rows.");
      const dayRows = rows.filter((r) => r[0].trim() === day);
      lastCSV = toCSV([header, ...dayRows]);
      log(`Latest workout: ${day}, ${dayRows.length} sets`, "ok");
      if (day !== localToday()) log(`That's not today (${localToday()}). Did you export after logging?`, "warn");

      const latest = await upsert(folderId, LATEST_NAME, lastCSV);
      await upsert(folderId, `FitNotes_${day}.csv`, lastCSV);
      log(`Saved ${LATEST_NAME} and FitNotes_${day}.csv to Drive`, "ok");

      const old = exports.slice(KEEP_EXPORTS);
      for (const f of old) {
        await drive(`${API}/files/${f.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }),
        });
      }
      if (old.length) log(`Moved ${old.length} older export(s) to Drive's trash (kept newest ${KEEP_EXPORTS})`, "ok");

      showResult(day, header, dayRows, latest.webViewLink, folderId);
      goBtn.textContent = "Run again";
    } catch (e) {
      log(e.message || String(e), "err");
    } finally {
      goBtn.disabled = false;
    }
  });


  $("#theme").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    const next = dark ? "light" : "dark";
    prefs.set("theme", next);
    document.documentElement.dataset.theme = next;
  });

  $("#signout").addEventListener("click", () => {
    if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
    token = null; prefs.del("signedIn"); prefs.del("folderId");
    logEl.replaceChildren(); log("Signed out.");
    $("#result").hidden = true;
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
