/* Listening: listen to your Google Docs, one chapter at a time.
 *
 * The page talks to your own small server on Google Cloud Run (see
 * server/main.py). The server reads the Google Doc, splits it into chapters,
 * voices each chapter when you get to it (Chirp 3 HD) and keeps the audio in
 * your private bucket, so nothing is voiced twice. No key is in this page.
 *
 * Saved on this phone: your sign-in pass, voice choice, where you stopped,
 * and any chapters you play or save, so they work with no signal.
 */
(() => {
  "use strict";

  const CFG = window.LISTEN_CONFIG || {};
  const DEV = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has("dev");
  const API = DEV ? "http://localhost:8080" : (CFG.apiUrl || "").replace(/\/$/, "");
  const SCOPES = "openid email https://www.googleapis.com/auth/drive.readonly";
  const CACHE = "listen-v2";
  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
  const SLEEPS = [0, 15, 30, 45, 60, "end"];
  const DEFAULT_VOICE = "en-US-Chirp3-HD-Charon";
  const CHARS_PER_SECOND = 14.5; // for time estimates before a chapter is voiced

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = {
    home: $("#home"), reader: $("#reader"), signinCard: $("#signin-card"), signin: $("#signin"),
    signout: $("#signout"), link: $("#link"), listen: $("#listen"), meterFill: $("#meter-fill"),
    meterText: $("#meter-text"), recent: $("#recent"), recentEmpty: $("#recent-empty"), theme: $("#theme"),
    back: $("#back"), docTitle: $("#doc-title"), chTitle: $("#ch-title"), voiceName: $("#voice-name"),
    voiceChange: $("#voice-change"), status: $("#status"), text: $("#text"), rows: $("#chapter-rows"),
    saveAll: $("#save-all"), reloadDoc: $("#reload-doc"), exportChapter: $("#export-chapter"),
    exportAll: $("#export-all"), copyText: $("#copy-text"), forget: $("#forget"),
    cur: $("#cur"), left: $("#left"), slider: $("#slider"), speed: $("#speed"), rew: $("#rew"),
    play: $("#play"), fwd: $("#fwd"), sleep: $("#sleep"), sleepLabel: $("#sleep-label"), toast: $("#toast"),
  };

  // ------------------------------------------------------------- small helpers
  const prefs = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage off */ } },
  };
  let toastTimer;
  function toast(msg, ms = 3500) {
    el.toast.textContent = msg; el.toast.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove("show"), ms);
  }
  const fmt = (s) => {
    s = Math.max(0, Math.round(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
  };
  const mins = (s) => `${Math.max(1, Math.round(s / 60))} min`;
  const niceTitle = (t) => (t || "").replace(/\s*\(listen\)\s*$/i, "").trim();
  const voice = () => prefs.get("voice", DEFAULT_VOICE);

  // ------------------------------------------------------------- theme
  el.theme.addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme === "dark" || (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    root.dataset.theme = dark ? "light" : "dark";
    prefs.set("theme", root.dataset.theme);
  });

  // ------------------------------------------------------------- Google sign-in
  // Google only opens its sign-in window straight after a tap, so every tap
  // that may need Google calls googleToken() before doing anything else.
  let gToken = null, gExp = 0, tokenClient = null, inflight = null;
  window.onGsiLoad = () => {
    if (DEV || !CFG.clientId || !window.google?.accounts?.oauth2) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.clientId, scope: SCOPES, include_granted_scopes: true,
      callback: (r) => {
        const p = inflight; inflight = null;
        if (r.error || !google.accounts.oauth2.hasGrantedAllScopes(r, ...SCOPES.split(" ").slice(2))) {
          return p?.reject(new Error("Please allow access to your Google Docs to listen to them."));
        }
        gToken = r.access_token; gExp = Date.now() + (Number(r.expires_in || 3600) - 120) * 1000;
        prefs.set("consented", true);
        p?.resolve(gToken);
      },
      error_callback: (e) => {
        const p = inflight; inflight = null;
        p?.reject(new Error(e?.type === "popup_failed_to_open" ? "The sign-in window was blocked. Tap again." : "Sign-in was cancelled."));
      },
    });
  };
  function googleToken() {
    if (DEV) return Promise.resolve("good");
    if (gToken && Date.now() < gExp) return Promise.resolve(gToken);
    if (inflight) return inflight.promise;
    if (!tokenClient) return Promise.reject(new Error("Google sign-in hasn't loaded yet. Check your connection and try again."));
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    inflight = { promise, resolve, reject };
    tokenClient.requestAccessToken({ prompt: prefs.get("consented", false) ? "" : "consent" });
    return promise;
  }

  // ------------------------------------------------------------- server calls
  const session = () => prefs.get("session", null);

  async function api(path, { method = "GET", body, google, blob } = {}) {
    if (!API) throw new Error("The reader isn't set up yet (config.js has no server address).");
    const headers = {};
    if (session()) headers.Authorization = `Bearer ${session()}`;
    if (google) headers["X-Google-Token"] = google;
    if (body) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw Object.assign(new Error("Can't reach your Listening server. Check your connection."), { offline: true });
    }
    if (!res.ok) {
      let msg = `Server error (${res.status}).`;
      try { msg = (await res.json()).error || msg; } catch { /* not json */ }
      if (res.status === 401 && !google) { prefs.del("session"); renderHome(); }
      throw Object.assign(new Error(msg), { status: res.status });
    }
    return blob ? res.blob() : res.json();
  }

  async function ensureSession(gPromise) {
    if (session()) return;
    const g = await (gPromise || googleToken());
    const r = await api("/api/session", { method: "POST", google: g });
    prefs.set("session", r.session);
  }

  // ------------------------------------------------------------- phone storage
  const ck = (k) => `https://listening.cache/${k}`;
  const saved = new Set();
  const cacheReady = (async () => {
    try { (await (await caches.open(CACHE)).keys()).forEach((r) => saved.add(r.url)); } catch { /* no cache api */ }
  })();
  async function cacheGet(k, asBlob) {
    try {
      const r = await (await caches.open(CACHE)).match(ck(k));
      return r ? (asBlob ? r.blob() : r.json()) : null;
    } catch { return null; }
  }
  async function cachePut(k, data) {
    try {
      const body = data instanceof Blob ? data : JSON.stringify(data);
      await (await caches.open(CACHE)).put(ck(k), new Response(body));
      saved.add(ck(k));
    } catch { /* storage full */ }
  }
  const metaKey = (doc, n, v) => `meta/${doc.id}/${doc.chapters[n].hash}-${v}`;
  const isSaved = (doc, n, v = voice()) => {
    if (!saved.has(ck(metaKey(doc, n, v)))) return false;
    return saved.has(ck(`audio/chapters/${doc.id}/${doc.chapters[n].hash}-${v}.mp3`));
  };

  async function chapterMeta(doc, n, v = voice()) {
    const k = metaKey(doc, n, v);
    const hit = await cacheGet(k);
    if (hit) return hit;
    const meta = await api("/api/chapter", { method: "POST", body: { doc: doc.id, n, hash: doc.chapters[n].hash, voice: v } });
    await cachePut(k, meta);
    return meta;
  }
  async function chapterAudio(meta) {
    const k = `audio/${meta.audio}`;
    const hit = await cacheGet(k, true);
    if (hit) return hit;
    const blob = await api(`/api/file?path=${encodeURIComponent(meta.audio)}`, { blob: true });
    await cachePut(k, blob);
    return blob;
  }
  async function saveChapter(doc, n) {
    const meta = await chapterMeta(doc, n);
    await chapterAudio(meta);
    return meta;
  }

  // ------------------------------------------------------------- voices
  let voiceList = prefs.get("voices", []);
  let accentFilter = null;
  const sampleAudio = new Audio();
  let samplePlaying = null;

  const voiceLabel = (name) => {
    const v = voiceList.find((x) => x.name === name);
    if (v) return `${v.short} – ${v.accent}${v.gender ? ", " + v.gender : ""}`;
    return name.split("-").pop();
  };

  async function loadVoices() {
    try {
      voiceList = (await api("/api/voices")).voices;
      prefs.set("voices", voiceList);
      renderVoices();
    } catch { /* keep the saved list */ }
  }

  function renderVoices() {
    const accents = [...new Set(voiceList.map((v) => v.accent))];
    if (!accentFilter) accentFilter = voiceList.find((v) => v.name === voice())?.accent || accents[0];
    for (const box of $$("[data-voices]")) {
      box.textContent = "";
      if (!voiceList.length) {
        const p = document.createElement("p");
        p.className = "hint"; p.style.padding = "1rem"; p.textContent = "Sign in to see the voices.";
        box.append(p);
        continue;
      }
      const chips = document.createElement("div"); chips.className = "accent-chips";
      for (const a of accents) {
        const c = document.createElement("button"); c.className = "chip"; c.textContent = a;
        c.setAttribute("aria-pressed", String(a === accentFilter));
        c.addEventListener("click", () => { accentFilter = a; renderVoices(); });
        chips.append(c);
      }
      const ul = document.createElement("ul"); ul.className = "voices"; ul.setAttribute("role", "radiogroup");
      const list = voiceList.filter((v) => v.accent === accentFilter);
      for (const v of list) {
        const li = document.createElement("li");
        const pick = document.createElement("button");
        pick.className = "pick"; pick.setAttribute("role", "radio");
        pick.setAttribute("aria-checked", String(v.name === voice()));
        pick.textContent = `${v.short} – ${v.accent}${v.gender ? ", " + v.gender : ""}`;
        pick.addEventListener("click", () => chooseVoice(v.name));
        const s = document.createElement("button");
        s.className = "sample" + (samplePlaying === v.name ? " playing" : "");
        s.setAttribute("aria-label", `Hear ${v.short}`);
        s.textContent = samplePlaying === v.name ? "■" : "▶";
        s.addEventListener("click", () => playSample(v.name));
        li.append(pick, s); ul.append(li);
      }
      box.append(chips, ul);
    }
  }

  async function playSample(name) {
    if (samplePlaying === name) { sampleAudio.pause(); samplePlaying = null; renderVoices(); return; }
    samplePlaying = name; renderVoices();
    try {
      let blob = await cacheGet(`sample/${name}`, true);
      if (!blob) { blob = await api(`/api/sample?voice=${encodeURIComponent(name)}`, { blob: true }); await cachePut(`sample/${name}`, blob); }
      if (samplePlaying !== name) return;
      if (!audio.paused) audio.pause();
      sampleAudio.src = URL.createObjectURL(blob);
      await sampleAudio.play();
    } catch (e) { toast(e.message); samplePlaying = null; renderVoices(); }
  }
  sampleAudio.addEventListener("ended", () => { samplePlaying = null; renderVoices(); });

  function chooseVoice(name) {
    if (name === voice()) return;
    prefs.set("voice", name);
    renderVoices();
    el.voiceName.textContent = voiceLabel(name);
    if (doc && !el.reader.hidden) {
      // Re-voice the current chapter, keeping roughly the same place.
      const frac = audio.duration ? audio.currentTime / audio.duration : 0;
      const wasPlaying = !audio.paused;
      loadChapter(chapter, { autoplay: wasPlaying, startFraction: frac });
      renderChapterRows();
    }
  }

  // ------------------------------------------------------------- home
  function renderHome() {
    const signedIn = !!session();
    el.signinCard.hidden = signedIn;
    el.signout.hidden = !signedIn;
    const home = prefs.get("homeCache", { docs: [], usage: null });
    const u = home.usage;
    if (u) {
      const pct = Math.min(100, (u.chars / u.free) * 100);
      el.meterFill.style.width = `${Math.max(pct, u.chars ? 1 : 0)}%`;
      const monthName = new Date(u.month + "-15").toLocaleString([], { month: "long" });
      el.meterText.textContent = `${u.chars.toLocaleString()} of ${u.free.toLocaleString()} used in ${monthName} ` +
        `(${pct.toFixed(1)}%). Counts only what this reader voiced. Google's free allowance covers Chirp 3 HD voices ` +
        `across your whole billing account.`;
    } else {
      el.meterText.textContent = signedIn ? "Loading…" : "Sign in to see how much you've used.";
    }
    el.recent.textContent = "";
    el.recentEmpty.hidden = home.docs.length > 0;
    for (const d of home.docs) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      const t = document.createElement("span"); t.className = "t"; t.textContent = niceTitle(d.title);
      const c = document.createElement("span"); c.className = "c";
      const pos = prefs.get("pos:" + d.id, null);
      c.textContent = pos?.done ? "Finished" : pos ? `Chapter ${pos.n + 1}` : "";
      b.append(t, c);
      b.addEventListener("click", () => {
        const g = session() ? null : googleToken();
        g?.catch(() => {});
        openSaved(d.id, g);
      });
      li.append(b); el.recent.append(li);
    }
    renderVoices();
  }

  async function refreshHome() {
    if (!session()) return;
    try {
      const h = await api("/api/home");
      prefs.set("homeCache", h);
      renderHome();
    } catch (e) { if (!e.offline) toast(e.message); }
  }

  el.signin.addEventListener("click", async () => {
    const g = googleToken(); g.catch(() => {});
    try { await ensureSession(g); renderHome(); refreshHome(); loadVoices(); }
    catch (e) { toast(e.message); }
  });
  el.signout.addEventListener("click", () => {
    prefs.del("session"); prefs.del("homeCache"); gToken = null; renderHome();
  });

  el.listen.addEventListener("click", () => {
    const url = el.link.value.trim();
    if (!url) { toast("Paste a Google Doc link first."); el.link.focus(); return; }
    const g = googleToken(); g.catch(() => {});
    openLink(url, g);
  });
  el.link.addEventListener("keydown", (e) => { if (e.key === "Enter") el.listen.click(); });

  // ------------------------------------------------------------- opening documents
  let doc = null;      // current document (from the server)
  let chapter = 0;     // current chapter index

  async function openLink(url, gPromise) {
    el.listen.disabled = true; el.listen.textContent = "Opening…";
    try {
      const g = await gPromise;
      await ensureSession(Promise.resolve(g));
      const d = await api("/api/doc", { method: "POST", body: { url }, google: g });
      await cachePut(`doc/${d.id}`, d);
      el.link.value = "";
      showDoc(d);
      refreshHome(); loadVoices();
    } catch (e) {
      toast(e.message, 6000);
    } finally {
      el.listen.disabled = false; el.listen.textContent = "Listen";
    }
  }

  async function openSaved(id, gPromise) {
    let d = null;
    try {
      if (gPromise) await ensureSession(gPromise);
      d = await api(`/api/doc/${encodeURIComponent(id)}`);
      await cachePut(`doc/${id}`, d);
    } catch (e) {
      d = await cacheGet(`doc/${id}`);
      if (!d) { toast(e.message); return; }
    }
    showDoc(d);
  }

  function showDoc(d, { fromRoute = false } = {}) {
    const same = doc && doc.id === d.id;
    doc = d;
    prefs.set("lastDoc", d.id);
    if (!fromRoute && location.hash !== `#doc=${d.id}`) location.hash = `doc=${d.id}`;
    document.body.classList.add("reading");
    el.home.hidden = true; el.reader.hidden = false;
    el.docTitle.textContent = niceTitle(d.title);
    el.voiceName.textContent = voiceLabel(voice());
    window.scrollTo(0, 0);
    if (same && audio.src) { renderChapterRows(); return; }
    const pos = prefs.get("pos:" + d.id, null);
    const n = pos && pos.n < d.chapters.length ? pos.n : 0;
    loadChapter(n, { autoplay: false, startAt: pos?.done ? 0 : pos?.t || 0 });
  }

  function goHome() {
    document.body.classList.remove("reading");
    el.reader.hidden = true; el.home.hidden = false;
    renderHome();
  }

  // ------------------------------------------------------------- tabs
  function showTab(name) {
    for (const b of $$(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
    for (const t of $$(".tab")) t.hidden = t.id !== `tab-${name}`;
    if (name === "chapters") renderChapterRows();
    if (name === "voice") renderVoices();
    if (name === "text") scrollToCurrent(true);
  }
  for (const b of $$(".tabs button")) b.addEventListener("click", () => showTab(b.dataset.tab));
  el.voiceChange.addEventListener("click", () => showTab("voice"));

  // ------------------------------------------------------------- chapter text
  let marks = [];
  let current = -1;
  let lastUserScroll = 0;

  function renderText(n, meta) {
    el.text.textContent = "";
    marks = [];
    const blocks = doc.chapters[n].blocks;
    blocks.forEach((b, i) => {
      const e = document.createElement(b.k === "h" ? "h3" : "p");
      e.textContent = b.t;
      e.addEventListener("click", () => jumpTo(i));
      el.text.append(e);
      marks.push({ el: e, s: meta?.starts?.[i] ?? null, text: b.t });
    });
    current = -1;
  }
  function setStarts(meta) { marks.forEach((m, i) => { m.s = meta.starts[i]; }); }

  function indexAt(t) {
    let ans = 0;
    for (let i = 0; i < marks.length; i++) { if (marks[i].s != null && marks[i].s <= t + 0.05) ans = i; else if (marks[i].s != null) break; }
    return ans;
  }
  function highlight(i) {
    if (i === current) return;
    marks[current]?.el.classList.remove("now");
    current = i;
    marks[i]?.el.classList.add("now");
    if (Date.now() - lastUserScroll > 6000) scrollToCurrent(false);
  }
  function scrollToCurrent(instant) {
    const m = marks[current];
    if (!m || $("#tab-text").hidden) return;
    const r = m.el.getBoundingClientRect();
    if (instant || r.top < 110 || r.bottom > innerHeight - $("#player").offsetHeight - 20) {
      m.el.scrollIntoView({ block: "center", behavior: instant ? "auto" : "smooth" });
    }
  }
  ["wheel", "touchmove"].forEach((ev) => addEventListener(ev, () => { lastUserScroll = Date.now(); }, { passive: true }));

  function jumpTo(i) {
    if (mode === "speech") return speechGo(i);
    const s = marks[i]?.s;
    if (s != null && audio.src) { audio.currentTime = s; lastUserScroll = 0; }
  }

  // ------------------------------------------------------------- chapters tab
  function renderChapterRows() {
    if (!doc) return;
    el.rows.textContent = "";
    doc.chapters.forEach((c, n) => {
      const tr = document.createElement("tr");
      if (n === chapter) tr.className = "current";
      const td1 = document.createElement("td"); td1.textContent = String(n + 1);
      const td2 = document.createElement("td");
      const name = document.createElement("button"); name.className = "name"; name.textContent = c.title;
      name.addEventListener("click", () => { loadChapter(n, { autoplay: true }); showTab("text"); });
      td2.append(name);
      const td3 = document.createElement("td"); td3.textContent = mins(c.chars / CHARS_PER_SECOND);
      const td4 = document.createElement("td");
      const dl = document.createElement("button");
      const ok = isSaved(doc, n);
      dl.className = "round" + (ok ? " saved" : "");
      dl.textContent = ok ? "✓" : "↓";
      dl.setAttribute("aria-label", ok ? `Chapter ${n + 1} is on this phone` : `Save chapter ${n + 1} on this phone`);
      dl.addEventListener("click", async () => {
        if (isSaved(doc, n)) return;
        dl.classList.add("busy"); dl.textContent = "…";
        try { await saveChapter(doc, n); } catch (e) { toast(e.message); }
        renderChapterRows();
      });
      td4.append(dl);
      tr.append(td1, td2, td3, td4);
      el.rows.append(tr);
    });
    const all = doc.chapters.every((_, n) => isSaved(doc, n));
    el.saveAll.className = "round" + (all ? " saved" : "");
    el.saveAll.textContent = all ? "✓" : "↓";
  }
  el.saveAll.addEventListener("click", async () => {
    const d = doc;
    el.saveAll.textContent = "…";
    for (let n = 0; n < d.chapters.length; n++) {
      if (doc !== d) return;
      if (isSaved(d, n)) continue;
      try { await saveChapter(d, n); } catch (e) { toast(e.message); break; }
      renderChapterRows();
    }
    renderChapterRows();
  });
  el.reloadDoc.addEventListener("click", () => {
    const g = googleToken(); g.catch(() => {});
    (async () => {
      try {
        const d = await api("/api/doc", { method: "POST", body: { url: doc.id }, google: await g });
        await cachePut(`doc/${d.id}`, d);
        const changed = JSON.stringify(d.chapters.map((c) => c.hash)) !== JSON.stringify(doc.chapters.map((c) => c.hash));
        doc = d;
        if (changed) { toast("Updated from the Google Doc."); loadChapter(Math.min(chapter, d.chapters.length - 1), { autoplay: !audio.paused }); }
        else toast("No changes.");
        renderChapterRows();
      } catch (e) { toast(e.message); }
    })();
  });

  // ------------------------------------------------------------- export tab
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/[\u2012-\u2015\u2212]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, "")
      .replace(/[^\x20-\x7E]/g, "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  const fileName = (n) => `${niceTitle(doc.title)} - ${String(n + 1).padStart(2, "0")} - ${doc.chapters[n].title}.mp3`;
  el.exportChapter.addEventListener("click", async () => {
    try { const m = await chapterMeta(doc, chapter); download(await chapterAudio(m), fileName(chapter)); }
    catch (e) { toast(e.message); }
  });
  el.exportAll.addEventListener("click", async () => {
    const todo = doc.chapters.filter((_, n) => !isSaved(doc, n));
    const chars = todo.reduce((a, c) => a + c.chars, 0);
    if (todo.length && !confirm(`This voices ${todo.length} more chapter(s), about ${chars.toLocaleString()} free characters. Continue?`)) return;
    for (let n = 0; n < doc.chapters.length; n++) {
      try { const m = await chapterMeta(doc, n); download(await chapterAudio(m), fileName(n)); }
      catch (e) { toast(e.message); break; }
    }
  });
  el.copyText.addEventListener("click", async () => {
    const text = doc.chapters[chapter].blocks.map((b) => b.t).join("\n\n");
    try { await navigator.clipboard.writeText(text); toast("Copied."); } catch { toast("Couldn't copy on this phone."); }
  });
  el.forget.addEventListener("click", async () => {
    if (!confirm("Remove this document from your Recent list?")) return;
    try { await api(`/api/doc/${encodeURIComponent(doc.id)}`, { method: "DELETE" }); } catch (e) { toast(e.message); return; }
    stop(); doc = null; history.replaceState(null, "", location.pathname + location.search); goHome(); refreshHome();
  });

  // ------------------------------------------------------------- player
  const audio = new Audio();
  audio.preload = "auto";
  let objectUrl = null;
  let loadSeq = 0;
  let prefetched = new Set();
  let mode = "audio";

  const speed = () => prefs.get("speed", 1);
  el.speed.textContent = `${speed()}×`;

  function setLoading(on) { el.play.classList.toggle("loading", on); }
  function setPlaying(on) {
    el.play.classList.toggle("playing", on);
    el.play.setAttribute("aria-label", on ? "Pause" : "Play");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = on ? "playing" : "paused";
  }
  function showStatus(msg, actions = []) {
    el.status.hidden = !msg;
    el.status.textContent = msg || "";
    for (const [label, fn] of actions) {
      const b = document.createElement("button"); b.className = "button"; b.textContent = label;
      b.style.marginRight = ".5rem"; b.addEventListener("click", fn); el.status.append(document.createElement("br"), b);
    }
  }

  async function loadChapter(n, { autoplay = false, startAt = 0, startFraction = null } = {}) {
    const seq = ++loadSeq;
    const d = doc;
    stopSpeech();
    savePos();
    audio.pause();
    chapter = n;
    mode = "audio";
    el.chTitle.textContent = d.chapters[n].title;
    renderText(n, null);
    renderChapterRows();
    el.slider.value = 0; el.cur.textContent = "0:00";
    el.left.textContent = "-" + fmt(d.chapters[n].chars / CHARS_PER_SECOND);
    setLoading(true);
    const slow = setTimeout(() => { if (seq === loadSeq) showStatus("Getting this chapter ready… voicing takes a few seconds."); }, 500);
    try {
      const meta = await chapterMeta(d, n);
      const blob = await chapterAudio(meta);
      if (seq !== loadSeq) return;
      clearTimeout(slow); showStatus("");
      setStarts(meta);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      audio.src = objectUrl;
      await new Promise((ok, bad) => {
        audio.addEventListener("loadedmetadata", ok, { once: true });
        audio.addEventListener("error", () => bad(new Error("This phone couldn't play the audio.")), { once: true });
      });
      if (seq !== loadSeq) return;
      const dur = audio.duration || meta.duration;
      audio.currentTime = Math.min(Math.max(0, startFraction != null ? startFraction * dur : startAt), Math.max(0, dur - 1));
      audio.playbackRate = speed();
      setLoading(false);
      updateTime();
      setMediaSession();
      highlight(indexAt(audio.currentTime));
      scrollToCurrent(true);
      renderChapterRows();
      if (autoplay) audio.play().catch(() => setPlaying(false));
    } catch (e) {
      clearTimeout(slow);
      if (seq !== loadSeq) return;
      setLoading(false);
      showStatus(e.offline ? "No signal, and this chapter isn't saved on this phone." : e.message, [
        ["Try again", () => loadChapter(n, { autoplay: true, startAt })],
        ["Read with phone voice", () => startSpeech(0)],
      ]);
    }
  }

  function stop() { audio.pause(); stopSpeech(); }

  let lastSave = 0;
  function savePos() {
    if (!doc || mode !== "audio" || !audio.src || !audio.duration) return;
    const last = chapter === doc.chapters.length - 1;
    const done = last && audio.currentTime >= audio.duration - 2;
    prefs.set("pos:" + doc.id, { n: chapter, t: audio.currentTime, done, at: Date.now() });
  }
  function updateTime() {
    if (mode !== "audio") return;
    const d = audio.duration || 0, t = audio.currentTime || 0;
    el.slider.max = Math.max(1, Math.floor(d));
    if (!sliding) el.slider.value = Math.floor(t);
    el.cur.textContent = fmt(t);
    el.left.textContent = "-" + fmt(d - t);
    if (marks.length) highlight(indexAt(t));
    if (Date.now() - lastSave > 5000) { lastSave = Date.now(); savePos(); }
    // Get the next chapter ready at 80%, or 2 minutes before the end.
    const next = chapter + 1;
    if (d && doc && next < doc.chapters.length && !prefetched.has(`${doc.id}:${next}:${voice()}`) && (t > 0.8 * d || d - t < 120)) {
      prefetched.add(`${doc.id}:${next}:${voice()}`);
      saveChapter(doc, next).catch(() => prefetched.delete(`${doc.id}:${next}:${voice()}`));
    }
  }
  audio.addEventListener("timeupdate", updateTime);
  audio.addEventListener("play", () => { setPlaying(true); setPos(); });
  audio.addEventListener("pause", () => { setPlaying(false); savePos(); setPos(); });
  audio.addEventListener("seeked", () => { updateTime(); setPos(); });
  audio.addEventListener("ratechange", setPos);
  audio.addEventListener("ended", () => {
    savePos();
    if (sleepAt === "end") { setSleep(0); setPlaying(false); toast("Sleep timer: stopped at the end of the chapter."); return; }
    if (doc && chapter + 1 < doc.chapters.length) loadChapter(chapter + 1, { autoplay: true });
    else { setPlaying(false); toast("End of document."); }
  });

  let sliding = false;
  el.slider.addEventListener("input", () => { sliding = true; el.cur.textContent = mode === "audio" ? fmt(+el.slider.value) : `¶ ${+el.slider.value + 1}`; });
  el.slider.addEventListener("change", () => {
    sliding = false;
    if (mode === "audio") { audio.currentTime = +el.slider.value; lastUserScroll = 0; } else speechGo(+el.slider.value);
  });

  function togglePlay() {
    if (mode === "speech") return sp.playing ? speechPause() : speechPlay();
    if (!audio.src) return loadChapter(chapter, { autoplay: true });
    if (audio.paused) audio.play().catch((e) => toast(e.message)); else audio.pause();
  }
  function skip(sec) {
    if (mode === "speech") return speechGo(sp.i + (sec > 0 ? 1 : -1));
    if (!audio.src) return;
    audio.currentTime = Math.min(Math.max(0, audio.currentTime + sec), (audio.duration || 0) - 0.3);
    lastUserScroll = 0;
  }
  el.play.addEventListener("click", togglePlay);
  el.rew.addEventListener("click", () => skip(-15));
  el.fwd.addEventListener("click", () => skip(30));
  el.speed.addEventListener("click", () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed()) + 1) % SPEEDS.length];
    prefs.set("speed", next); el.speed.textContent = `${next}×`; audio.playbackRate = next;
    if (mode === "speech" && sp.playing) speakFrom(sp.i);
  });

  // Sleep timer: off, 15, 30, 45, 60 minutes, or end of chapter.
  let sleepAt = 0, sleepTimer = null, sleepTick = null;
  function setSleep(v) {
    sleepAt = v; clearTimeout(sleepTimer); clearInterval(sleepTick);
    el.sleep.classList.toggle("on", !!v);
    if (!v) { el.sleepLabel.textContent = ""; return; }
    if (v === "end") { el.sleepLabel.textContent = "end"; toast("Sleep timer: end of this chapter."); return; }
    const until = Date.now() + v * 60000;
    const show = () => { el.sleepLabel.textContent = `${Math.ceil((until - Date.now()) / 60000)}m`; };
    show(); sleepTick = setInterval(show, 20000);
    sleepTimer = setTimeout(() => { stop(); setSleep(0); }, v * 60000);
    toast(`Sleep timer: ${v} minutes.`);
  }
  el.sleep.addEventListener("click", () => setSleep(SLEEPS[(SLEEPS.indexOf(sleepAt) + 1) % SLEEPS.length]));

  // Lock-screen controls
  function setMediaSession() {
    if (!("mediaSession" in navigator) || !doc) return;
    const base = new URL(".", location.href).href;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: doc.chapters[chapter].title, artist: niceTitle(doc.title), album: "Listening",
      artwork: [{ src: base + "icon-192.png", sizes: "192x192", type: "image/png" },
                { src: base + "icon-512.png", sizes: "512x512", type: "image/png" }],
    });
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch { /* unsupported */ } };
    set("play", togglePlay); set("pause", togglePlay);
    set("seekbackward", (e) => skip(-(e.seekOffset || 15)));
    set("seekforward", (e) => skip(e.seekOffset || 30));
    set("seekto", (e) => { audio.currentTime = e.seekTime; });
    set("previoustrack", () => { if (audio.currentTime > 5 || chapter === 0) audio.currentTime = 0; else loadChapter(chapter - 1, { autoplay: true }); });
    set("nexttrack", () => { if (chapter + 1 < doc.chapters.length) loadChapter(chapter + 1, { autoplay: true }); });
  }
  function setPos() {
    if (!("mediaSession" in navigator) || !audio.duration) return;
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, audio.duration) }); } catch { /* ignore */ }
  }

  // ------------------------------------------------------------- phone-voice fallback
  // Used only when a chapter can't be voiced or downloaded. Free, but Android
  // stops it when the screen turns off, so the screen is kept on.
  const sp = { i: 0, playing: false, gen: 0, wake: null };
  function startSpeech(i) {
    if (!("speechSynthesis" in window)) { toast("This phone has no built-in voice."); return; }
    audio.pause(); mode = "speech"; sp.i = i;
    showStatus("Reading with your phone's voice. Keep the screen on.");
    el.slider.max = Math.max(1, marks.length - 1);
    speechPlay();
  }
  function speechUI() { el.slider.value = sp.i; el.cur.textContent = `¶ ${sp.i + 1}`; el.left.textContent = `of ${marks.length}`; }
  function speakFrom(i) {
    const gen = ++sp.gen;
    speechSynthesis.cancel();
    sp.i = i;
    if (i >= marks.length) { speechPause(); return; }
    highlight(i); speechUI();
    const parts = marks[i].text.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) || [marks[i].text];
    let k = 0;
    const next = () => {
      if (gen !== sp.gen || !sp.playing) return;
      if (k >= parts.length) return speakFrom(i + 1);
      const u = new SpeechSynthesisUtterance(parts[k++].trim());
      u.rate = speed(); u.lang = "en-US";
      u.onend = next; u.onerror = (e) => { if (!["interrupted", "canceled"].includes(e.error)) next(); };
      speechSynthesis.speak(u);
    };
    next();
  }
  async function speechPlay() {
    sp.playing = true; setPlaying(true);
    try { sp.wake = await navigator.wakeLock?.request("screen"); } catch { /* not allowed */ }
    speakFrom(sp.i);
  }
  function speechPause() {
    sp.playing = false; sp.gen++;
    try { speechSynthesis.cancel(); } catch { /* none */ }
    setPlaying(false); sp.wake?.release?.().catch(() => {}); sp.wake = null;
  }
  function stopSpeech() { if (sp.playing) speechPause(); }
  function speechGo(i) {
    sp.i = Math.max(0, Math.min(marks.length - 1, i)); lastUserScroll = 0;
    if (sp.playing) speakFrom(sp.i); else { highlight(sp.i); speechUI(); }
  }

  // ------------------------------------------------------------- routing
  async function route() {
    const m = location.hash.match(/^#doc=(.+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (doc?.id === id) { if (el.reader.hidden) showDoc(doc, { fromRoute: true }); return; }
      const d = await cacheGet(`doc/${id}`);
      if (d) showDoc(d, { fromRoute: true }); else { history.replaceState(null, "", location.pathname + location.search); goHome(); }
    } else {
      goHome();
    }
  }
  addEventListener("hashchange", route);
  el.back.addEventListener("click", () => { if (history.length > 1 && location.hash) history.back(); else { location.hash = ""; } });
  addEventListener("pagehide", savePos);
  document.addEventListener("visibilitychange", () => { if (document.hidden) savePos(); });

  // ------------------------------------------------------------- start
  (async () => {
    await cacheReady;
    renderHome();
    route();
    if (session()) { refreshHome(); loadVoices(); }
  })();
  if ("serviceWorker" in navigator && !DEV && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
