/* Listening reader.
 *
 * Plays the audio made by the GitHub Action in the TTS_Service repo. Files
 * live in a private Google Cloud Storage bucket; you sign in with Google and
 * the page downloads them with your own permission. Nothing here is secret:
 * the client ID and bucket name in config.js only work for your account.
 *
 * Downloaded audio is kept on the phone, so documents play offline later.
 */
(() => {
  "use strict";

  const CFG = window.LISTEN_CONFIG || {};
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) &&
    new URLSearchParams(location.search).has("local");
  const SCOPE = "https://www.googleapis.com/auth/devstorage.read_only";
  const CACHE = "listen-data-v1";
  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
  const SKIP = 15;

  const $ = (s) => document.querySelector(s);
  const el = {
    back: $("#back"), heading: $("#heading"), theme: $("#theme"), refresh: $("#refresh"),
    library: $("#library"), welcome: $("#welcome"), welcomeText: $("#welcome-text"),
    signin: $("#signin"), docs: $("#docs"), updated: $("#updated"),
    reader: $("#reader"), note: $("#mode-note"), text: $("#text"),
    player: $("#player"), cur: $("#cur"), left: $("#left"), slider: $("#slider"),
    speed: $("#speed"), rew: $("#rew"), play: $("#play"), fwd: $("#fwd"), now: $("#now"),
    toast: $("#toast"),
  };

  // ---------------------------------------------------------------- storage
  const prefs = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  let toastTimer;
  function toast(msg, ms = 3500) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), ms);
  }

  const fmt = (s) => {
    s = Math.max(0, Math.round(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
  };
  const niceTitle = (t) => (t || "").replace(/\s*\(listen\)\s*$/i, "").trim();

  // ---------------------------------------------------------------- theme
  function applyTheme(t) {
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  el.theme.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    const next = dark ? "light" : "dark";
    prefs.set("theme", next);
    applyTheme(next);
  });

  // ---------------------------------------------------------------- sign-in
  // Google only lets the sign-in window open straight after a tap, so every
  // tap that may need the network calls getToken() before doing anything else.
  let token = null, tokenExp = 0, tokenClient = null, inflight = null;

  window.onGsiLoad = () => {
    if (LOCAL || !CFG.clientId || !window.google?.accounts?.oauth2) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.clientId,
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

  const tokenValid = () => LOCAL || (token && Date.now() < tokenExp);

  function getToken() {
    if (LOCAL) return Promise.resolve(null);
    if (tokenValid()) return Promise.resolve(token);
    if (inflight) return inflight.promise;
    if (!CFG.clientId || !CFG.bucket) return Promise.reject(new Error("The reader is not set up yet (config.js)."));
    if (!tokenClient) return Promise.reject(new Error("Google sign-in has not loaded. Check your connection."));
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    inflight = { promise, resolve, reject };
    tokenClient.requestAccessToken({ prompt: prefs.get("signedIn", false) ? "" : "consent" });
    return promise;
  }

  // ---------------------------------------------------------------- data
  const urlFor = (name) => LOCAL
    ? new URL(`local-data/${name}`, location.href).href
    : `https://storage.googleapis.com/${CFG.bucket}/${name.split("/").map(encodeURIComponent).join("/")}`;

  const cached = new Set(); // URLs already saved on this phone
  const cacheReady = (async () => {
    try {
      const c = await caches.open(CACHE);
      (await c.keys()).forEach((r) => cached.add(r.url));
    } catch { /* no Cache Storage */ }
  })();
  const isCached = (name) => cached.has(urlFor(name));

  async function fromCache(url) {
    try { return await (await caches.open(CACHE)).match(url); } catch { return undefined; }
  }

  async function download(name, { fresh = false, onProgress } = {}) {
    const url = urlFor(name);
    if (!fresh) {
      const hit = await fromCache(url);
      if (hit) return hit;
    }
    const tok = await getToken();
    const res = await fetch(url, { headers: tok ? { Authorization: `Bearer ${tok}` } : {}, cache: "no-store" });
    if (res.status === 401 || res.status === 403) { token = null; throw new Error("Please sign in again."); }
    if (!res.ok) throw new Error(`Download failed (${res.status}).`);
    let blob;
    const total = Number(res.headers.get("Content-Length")) || 0;
    if (onProgress && res.body && total) {
      const reader = res.body.getReader(); const parts = []; let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length; onProgress(got / total);
      }
      blob = new Blob(parts, { type: res.headers.get("Content-Type") || "" });
    } else {
      blob = await res.blob();
    }
    const copy = new Response(blob, { headers: { "Content-Type": blob.type } });
    try { await (await caches.open(CACHE)).put(url, copy.clone()); cached.add(url); } catch { /* storage full */ }
    return copy;
  }

  async function pruneCache(lib) {
    const keep = new Set([urlFor("library.json")]);
    lib.docs.forEach((d) => { if (d.audio) keep.add(urlFor(d.audio)); if (d.text) keep.add(urlFor(d.text)); });
    try {
      const c = await caches.open(CACHE);
      for (const r of await c.keys()) if (!keep.has(r.url)) {
        await c.delete(r); cached.delete(r.url);
      }
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------- library
  let library = null;
  const progress = {}; // doc id -> download fraction while downloading

  function savedPos(id) { return prefs.get("pos:" + id, null); }

  function renderLibrary() {
    el.docs.textContent = "";
    const ready = !!library;
    el.welcome.hidden = ready;
    if (!ready) {
      el.welcomeText.textContent = !LOCAL && (!CFG.clientId || !CFG.bucket)
        ? "Almost ready: the reader still needs its Google sign-in ID and bucket name in config.js."
        : "Sign in with your Google account to load your listening documents. Only your account can open them.";
      el.signin.hidden = !LOCAL && (!CFG.clientId || !CFG.bucket);
      el.updated.textContent = "";
      return;
    }
    if (!library.docs.length) {
      el.updated.textContent = "No documents yet. Put a Google Doc in your Listening folder; audio is made overnight.";
      return;
    }
    for (const d of library.docs) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      const pos = savedPos(d.id);
      const t = document.createElement("span"); t.className = "t"; t.textContent = niceTitle(d.title);
      const m = document.createElement("span"); m.className = "m";
      const bits = [];
      if (d.audio && d.duration) bits.push(`${Math.max(1, Math.round(d.duration / 60))} min`);
      else bits.push("Phone voice (no audio yet)");
      if (d.audio) {
        if (progress[d.id] != null) bits.push(`Downloading ${Math.round(progress[d.id] * 100)}%`);
        else if (isCached(d.audio)) bits.push("On this phone");
      }
      if (pos?.done) bits.push("Finished");
      else if (pos && d.duration && pos.t > 5) bits.push(`${fmt(d.duration - pos.t)} left`);
      m.textContent = bits.join(" · ");
      b.append(t, m);
      if (pos && d.duration && pos.t > 5) {
        const bar = document.createElement("span"); bar.className = "bar-mini";
        const fill = document.createElement("i"); fill.style.width = `${Math.min(100, (pos.done ? 1 : pos.t / d.duration) * 100)}%`;
        bar.append(fill); b.append(bar);
      }
      b.addEventListener("click", () => {
        if ((!isCached(d.text) || (d.audio && !isCached(d.audio))) && !tokenValid()) getToken().catch(() => {});
        location.hash = "doc=" + encodeURIComponent(d.id);
      });
      li.append(b);
      el.docs.append(li);
    }
    const when = new Date(library.updated);
    el.updated.textContent = `Audio last checked ${when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. Voice: ${library.voice}.`;
  }

  async function loadCachedLibrary() {
    await cacheReady;
    const hit = await fromCache(urlFor("library.json"));
    if (hit) { library = await hit.json(); }
  }

  let refreshing = false;
  async function refreshLibrary() {
    if (refreshing) return;
    refreshing = true;
    el.refresh.classList.add("spin");
    try {
      const res = await download("library.json", { fresh: true });
      library = await res.json();
      renderLibrary();
      if (!el.reader.hidden) route();
      await pruneCache(library);
      // Save new audio on the phone while sign-in is still fresh.
      for (const d of library.docs) {
        if (d.text && !isCached(d.text)) await download(d.text).catch(() => {});
        if (d.audio && !isCached(d.audio)) {
          progress[d.id] = 0; renderLibrary();
          try {
            await download(d.audio, { onProgress: (f) => { progress[d.id] = f; if (el.reader.hidden) throttleRender(); } });
          } catch (e) { toast(e.message); }
          delete progress[d.id]; renderLibrary();
        }
      }
    } catch (e) {
      toast(e.message || "Could not check for new documents.");
    } finally {
      refreshing = false;
      el.refresh.classList.remove("spin");
    }
  }
  let rt = 0;
  function throttleRender() { if (Date.now() - rt > 400) { rt = Date.now(); renderLibrary(); } }

  el.refresh.addEventListener("click", () => { getToken().catch(() => {}); refreshLibrary(); });
  el.signin.addEventListener("click", () => { getToken().catch(() => {}); refreshLibrary(); });

  // ---------------------------------------------------------------- reader
  const audio = new Audio();
  audio.preload = "auto";
  let doc = null;          // library entry
  let marks = [];          // [{s, el, kind, text}] in reading order
  let mode = "audio";      // "audio" or "speech"
  let current = -1;        // index into marks being highlighted
  let lastUserScroll = 0;
  let objectUrl = null;
  let openToken = 0;

  function speed() { return prefs.get("speed", 1); }
  function showSpeed() { el.speed.textContent = `${speed()}×`; }

  function renderText(data) {
    el.text.textContent = "";
    marks = [];
    for (const sec of data.sections) {
      if (sec.title) {
        const h = document.createElement("h2");
        h.textContent = sec.title;
        el.text.append(h);
        marks.push({ s: sec.start, el: h, kind: "h", text: sec.title + "." });
      }
      for (const p of sec.paras) {
        const e = document.createElement("p");
        e.textContent = p.t;
        el.text.append(e);
        marks.push({ s: p.s, el: e, kind: "p", text: p.t });
      }
    }
    marks.forEach((m, i) => m.el.addEventListener("click", () => jumpTo(i)));
  }

  async function openDoc(id) {
    const mine = ++openToken;
    stopAll();
    doc = library?.docs.find((d) => d.id === id);
    if (!doc) { location.hash = ""; return; }
    document.body.classList.add("reading");
    el.library.hidden = true; el.reader.hidden = false; el.player.hidden = false;
    el.back.hidden = false; el.refresh.hidden = true;
    el.heading.textContent = niceTitle(doc.title);
    el.text.textContent = "Loading…";
    el.note.hidden = true;
    setPlayState(false);
    window.scrollTo(0, 0);

    try {
      const data = await (await download(doc.text)).json();
      if (mine !== openToken) return;
      renderText(data);
    } catch (e) {
      if (mine !== openToken) return;
      el.text.textContent = "";
      showRetry(e.message);
      return;
    }

    mode = doc.audio ? "audio" : "speech";
    const pos = savedPos(doc.id) || {};
    if (mode === "audio") {
      el.note.hidden = true;
      enableControls(false);
      try {
        const res = await download(doc.audio, {
          onProgress: (f) => { if (mine === openToken) { el.note.hidden = false; el.note.textContent = `Downloading audio… ${Math.round(f * 100)}%`; } },
        });
        if (mine !== openToken) return;
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        audio.src = objectUrl;
        el.note.hidden = true;
        await new Promise((ok) => audio.addEventListener("loadedmetadata", ok, { once: true }));
        if (mine !== openToken) return;
        const start = pos.done ? 0 : Math.min(pos.t || 0, (audio.duration || doc.duration || 0) - 1);
        audio.currentTime = Math.max(0, start);
        audio.playbackRate = speed();
        enableControls(true);
        updateTime();
        setMediaSession();
        scrollToCurrent(true);
      } catch (e) {
        if (mine !== openToken) return;
        // Could not get the audio: fall back to the phone's own voice.
        mode = "speech";
        toast(e.message);
      }
    }
    if (mode === "speech") startSpeechMode(pos);
  }

  function showRetry(msg) {
    el.note.hidden = false;
    el.note.textContent = msg + " ";
    const b = document.createElement("button");
    b.className = "button"; b.textContent = "Try again";
    b.addEventListener("click", () => { getToken().catch(() => {}); openDoc(doc.id); });
    el.note.append(b);
  }

  function enableControls(on) { [el.play, el.rew, el.fwd, el.slider].forEach((b) => (b.disabled = !on)); }

  function closeDoc() {
    stopAll();
    doc = null;
    document.body.classList.remove("reading");
    el.library.hidden = false; el.reader.hidden = true; el.player.hidden = true;
    el.back.hidden = true; el.refresh.hidden = false;
    el.heading.textContent = "Listening";
    renderLibrary();
  }

  function stopAll() {
    savePos();
    audio.pause();
    if (objectUrl) { audio.removeAttribute("src"); audio.load(); URL.revokeObjectURL(objectUrl); objectUrl = null; }
    speechStop();
    current = -1;
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
  }

  // ------------------------------------------------ position + highlight
  function savePos() {
    if (!doc) return;
    if (mode === "audio" && audio.src && audio.duration) {
      const done = audio.ended || audio.currentTime >= audio.duration - 2;
      prefs.set("pos:" + doc.id, { t: done ? doc.duration : audio.currentTime, done, at: Date.now() });
    } else if (mode === "speech" && marks.length) {
      const i = Math.max(0, sp.i);
      prefs.set("pos:" + doc.id, { p: i, t: marks[i]?.s || 0, done: sp.done, at: Date.now() });
    }
  }

  function indexAt(t) {
    let lo = 0, hi = marks.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((marks[mid].s ?? Infinity) <= t + 0.05) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  function highlight(i) {
    if (i === current) return;
    marks[current]?.el.classList.remove("now");
    current = i;
    const m = marks[i];
    if (!m) return;
    m.el.classList.add("now");
    if (Date.now() - lastUserScroll > 6000) scrollToCurrent(false);
  }

  function scrollToCurrent(instant) {
    const m = marks[current] || marks[mode === "audio" ? indexAt(audio.currentTime) : Math.max(0, sp.i)];
    if (!m) return;
    const r = m.el.getBoundingClientRect();
    const top = 70, bottom = innerHeight - el.player.offsetHeight - 20;
    if (instant || r.top < top || r.bottom > bottom) {
      m.el.scrollIntoView({ block: "center", behavior: instant ? "auto" : "smooth" });
    }
  }
  ["wheel", "touchmove"].forEach((ev) => addEventListener(ev, () => { lastUserScroll = Date.now(); }, { passive: true }));
  el.now.addEventListener("click", () => { lastUserScroll = 0; scrollToCurrent(false); });

  function jumpTo(i) {
    const m = marks[i];
    if (!m) return;
    if (mode === "audio") {
      if (m.s == null) return;
      audio.currentTime = m.s;
      lastUserScroll = 0;
    } else {
      speechGo(i);
    }
  }

  function sectionStarts() { return marks.filter((m) => m.kind === "h" && m.s != null).map((m) => m.s); }

  // ------------------------------------------------ audio mode
  let lastSave = 0;
  function updateTime() {
    if (mode !== "audio") return;
    const d = audio.duration || doc?.duration || 0, t = audio.currentTime || 0;
    el.slider.max = Math.max(1, Math.floor(d));
    if (!sliding) el.slider.value = Math.floor(t);
    el.cur.textContent = fmt(t);
    el.left.textContent = "-" + fmt(d - t);
    if (marks.length) highlight(indexAt(t));
    if (Date.now() - lastSave > 5000) { lastSave = Date.now(); savePos(); }
  }
  audio.addEventListener("timeupdate", updateTime);
  audio.addEventListener("play", () => { setPlayState(true); setPosState(); });
  audio.addEventListener("pause", () => { setPlayState(false); savePos(); setPosState(); });
  audio.addEventListener("ended", () => { savePos(); setPlayState(false); });
  audio.addEventListener("seeked", () => { updateTime(); setPosState(); });
  audio.addEventListener("ratechange", setPosState);
  audio.addEventListener("loadedmetadata", setPosState);

  let sliding = false;
  el.slider.addEventListener("input", () => {
    sliding = true;
    if (mode === "audio") { el.cur.textContent = fmt(+el.slider.value); }
    else { el.cur.textContent = `¶ ${+el.slider.value + 1}`; }
  });
  el.slider.addEventListener("change", () => {
    sliding = false;
    if (mode === "audio") { audio.currentTime = +el.slider.value; lastUserScroll = 0; }
    else speechGo(+el.slider.value);
  });

  function setPlayState(on) {
    el.play.classList.toggle("playing", on);
    el.play.setAttribute("aria-label", on ? "Pause" : "Play");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = on ? "playing" : "paused";
  }

  function togglePlay() {
    if (mode === "audio") {
      if (audio.paused) audio.play().catch((e) => toast(e.message));
      else audio.pause();
    } else {
      sp.playing ? speechPause() : speechPlay();
    }
  }
  function skip(sec) {
    if (mode === "audio") {
      audio.currentTime = Math.min(Math.max(0, audio.currentTime + sec), (audio.duration || 0) - 0.5);
      lastUserScroll = 0;
    } else {
      speechGo(Math.max(0, sp.i + (sec > 0 ? 1 : -1)));
    }
  }
  el.play.addEventListener("click", togglePlay);
  el.rew.addEventListener("click", () => skip(-SKIP));
  el.fwd.addEventListener("click", () => skip(SKIP));
  el.speed.addEventListener("click", () => {
    const i = SPEEDS.indexOf(speed());
    const next = SPEEDS[(i + 1) % SPEEDS.length];
    prefs.set("speed", next);
    showSpeed();
    audio.playbackRate = next;
    if (mode === "speech" && sp.playing) speechGo(sp.i);
  });

  // Lock-screen / notification controls (Media Session API)
  function setMediaSession() {
    if (!("mediaSession" in navigator) || !doc) return;
    const base = new URL(".", location.href).href;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: niceTitle(doc.title),
      artist: "Listening",
      artwork: [
        { src: base + "icon-192.png", sizes: "192x192", type: "image/png" },
        { src: base + "icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    });
    const ms = navigator.mediaSession;
    const set = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* unsupported */ } };
    set("play", () => togglePlay());
    set("pause", () => togglePlay());
    set("seekbackward", (d) => skip(-(d.seekOffset || SKIP)));
    set("seekforward", (d) => skip(d.seekOffset || SKIP));
    set("seekto", (d) => { audio.currentTime = d.seekTime; });
    set("previoustrack", () => {
      const t = audio.currentTime, starts = sectionStarts().filter((s) => s < t - 3);
      audio.currentTime = starts.length ? starts[starts.length - 1] : 0;
    });
    set("nexttrack", () => {
      const s = sectionStarts().find((x) => x > audio.currentTime + 0.5);
      if (s != null) audio.currentTime = s;
    });
  }
  function setPosState() {
    if (!("mediaSession" in navigator) || mode !== "audio" || !audio.duration) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration, playbackRate: audio.playbackRate,
        position: Math.min(audio.currentTime, audio.duration),
      });
    } catch { /* ignore */ }
  }

  // ------------------------------------------------ speech fallback mode
  // Uses the phone's built-in voice. Free, but Android stops it when the
  // screen turns off, so we ask the screen to stay on while it speaks.
  const sp = { i: 0, playing: false, done: false, gen: 0, wake: null };

  function startSpeechMode(pos) {
    mode = "speech";
    el.note.hidden = false;
    el.note.textContent = doc.status
      ? `${doc.status}. Reading with your phone's voice instead; keep the screen on.`
      : "No recorded audio yet, so your phone's voice reads this one. Keep the screen on. Recorded audio is usually ready by the next morning.";
    if (!("speechSynthesis" in window)) {
      el.note.textContent = "No recorded audio yet, and this browser has no built-in voice.";
      enableControls(false);
      return;
    }
    enableControls(true);
    sp.i = Math.min(pos.p || 0, marks.length - 1);
    sp.done = false;
    el.slider.max = Math.max(1, marks.length - 1);
    updateSpeechUI();
    highlight(sp.i);
    scrollToCurrent(true);
  }

  function updateSpeechUI() {
    el.slider.value = sp.i;
    el.cur.textContent = `¶ ${sp.i + 1}`;
    el.left.textContent = `of ${marks.length}`;
  }

  function pickVoice() {
    const vs = speechSynthesis.getVoices().filter((v) => /^en[-_]US/i.test(v.lang));
    return vs.find((v) => /google/i.test(v.name)) || vs[0] || null;
  }

  function speakFrom(i) {
    const gen = ++sp.gen;
    speechSynthesis.cancel();
    sp.i = i;
    if (i >= marks.length) { sp.done = true; speechPause(); savePos(); return; }
    highlight(i);
    updateSpeechUI();
    savePos();
    // Speak sentence by sentence: long utterances get cut off on some phones.
    const sentences = marks[i].text.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) || [marks[i].text];
    let k = 0;
    const next = () => {
      if (gen !== sp.gen || !sp.playing) return;
      if (k >= sentences.length) { speakFrom(i + 1); return; }
      const u = new SpeechSynthesisUtterance(sentences[k++].trim());
      u.rate = speed(); u.lang = "en-US";
      const v = pickVoice(); if (v) u.voice = v;
      u.onend = next;
      u.onerror = (e) => { if (e.error !== "interrupted" && e.error !== "canceled") next(); };
      speechSynthesis.speak(u);
    };
    next();
  }

  async function speechPlay() {
    sp.playing = true; sp.done = false;
    setPlayState(true);
    try { sp.wake = await navigator.wakeLock?.request("screen"); } catch { /* not allowed */ }
    speakFrom(sp.i);
  }
  function speechPause() {
    sp.playing = false; sp.gen++;
    try { speechSynthesis.cancel(); } catch { /* none */ }
    setPlayState(false);
    sp.wake?.release?.().catch(() => {}); sp.wake = null;
    savePos();
  }
  function speechStop() { if (sp.playing) speechPause(); }
  function speechGo(i) {
    i = Math.max(0, Math.min(marks.length - 1, i));
    lastUserScroll = 0;
    if (sp.playing) speakFrom(i);
    else { sp.i = i; highlight(i); updateSpeechUI(); savePos(); }
  }

  // ---------------------------------------------------------------- routing
  function route() {
    const m = location.hash.match(/^#doc=(.+)$/);
    if (m && library) {
      const id = decodeURIComponent(m[1]);
      if (doc?.id !== id) openDoc(id);
    } else if (doc || el.reader.hidden === false) {
      closeDoc();
    } else {
      renderLibrary();
    }
  }
  addEventListener("hashchange", route);
  el.back.addEventListener("click", () => {
    if (history.length > 1 && location.hash) history.back(); else location.hash = "";
  });
  addEventListener("pagehide", savePos);
  document.addEventListener("visibilitychange", () => { if (document.hidden) savePos(); });

  // ---------------------------------------------------------------- start
  showSpeed();
  (async () => {
    await loadCachedLibrary();
    route();
    if (LOCAL) refreshLibrary();
  })();

  if ("serviceWorker" in navigator && !LOCAL && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
