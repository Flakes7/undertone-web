"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const bridge = window.UndertoneBridge;
  const send = (action, data = {}) => bridge?.postMessage({ action, ...data });
  const currentCommand = (action, data = {}) => send(action, { id: trackId, ...data });
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const viewport = $("viewport"), lines = $("lines"), seek = $("seek"), cover = $("cover");
  const previewLyrics = [
    "[00:00.00]Let the evening settle softly",
    "[00:05.00]A little closer to the music",
    "[00:10.00]Leave a little room to feel",
    "[00:15.00]Every note can find its way home"
  ].join("\n");
  const previewBreaks = [];
  const fontPicker = $("lyricFont");
  let prefs = { font: "Inter", size: "standard", timing: 0, pin: false };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem("appearance") || "{}")); } catch {}
  if (!["small","standard","large"].includes(prefs.size)) prefs.size = "standard";
  prefs.timing = clamp(Number(prefs.timing) || 0, -3, 3);
  fontPicker.value = prefs.font;
  if (fontPicker.selectedIndex < 0) fontPicker.value = "Inter";
  let trackId = null, preview = true, playback = {}, rows = [], nodes = [], active = -1, kind = "synced";
  let sample = 0, sampledAt = 0, playing = false, rate = 1, duration = 20;
  let target = 0, scrollPosition = 0, velocity = 0, scrolling = false, browsingUntil = 0, dragging = false;
  let lastFrame = 0, lastSecond = -1, lastProgress = -1, toastTimer, visibleWords = [];
  const backdrops = document.querySelectorAll(".backdrop");
  let backdropIndex = 0, artRequest = 0;
  let mini = false, miniPinned = true;
  const timeText = n => Math.floor(n / 60) + ":" + String(Math.floor(n % 60)).padStart(2,"0");
  const position = () => clamp(sample + (playing ? (performance.now() - sampledAt) * rate / 1000 : 0), 0, duration || 86400);
  function anchor(n) { sample = n; sampledAt = performance.now(); }

  function notify(text) {
    clearTimeout(toastTimer); $("toast").textContent = text; $("toast").hidden = false;
    toastTimer = setTimeout(() => $("toast").hidden = true, 3600);
  }
  function preferences(save = false) {
    document.documentElement.style.setProperty("--scale", { small: .82, standard: 1, large: 1.16 }[prefs.size]);
    document.querySelectorAll("[data-size]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.size === prefs.size)));
    $("offset").textContent = (prefs.timing > 0 ? "+" : "") + prefs.timing.toFixed(1) + " s";
    $("earlier").disabled = prefs.timing <= -3; $("later").disabled = prefs.timing >= 3;
    $("pin").setAttribute("aria-pressed", String(!!prefs.pin));
    if (save) try { localStorage.setItem("appearance", JSON.stringify(prefs)); } catch {}
    requestAnimationFrame(() => recenter(true));
  }
  function applyLyricFont() {
    const family = fontPicker.value;
    prefs.font = family;
    lines.style.setProperty("--lyric-font", JSON.stringify(family));
    lines.classList.toggle("artistic", fontPicker.selectedOptions[0].parentElement.id === "artisticFonts");
    lines.style.setProperty("--lyric-tracking", family === "Inter" ? "-.033em" : "normal");
    $("miniLyrics").style.setProperty("--lyric-font", JSON.stringify(family));
    $("miniLyrics").style.setProperty("--lyric-tracking", family === "Inter" ? "-.025em" : "normal");
    $("miniLyrics").classList.toggle("artistic", lines.classList.contains("artistic"));
    document.fonts.load('745 42px "' + family + '"').then(() => {
      if (fontPicker.value === family) recenter(true);
    }).catch(() => {});
  }
  async function showArt(src) {
    const request = ++artRequest;
    cover.hidden = true;
    if (!src) {
      cover.removeAttribute("src");
      backdrops[backdropIndex].classList.remove("on");
      return;
    }
    cover.src = src;
    try { await cover.decode(); }
    catch {
      if (request === artRequest) backdrops[backdropIndex].classList.remove("on");
      return;
    }
    if (request !== artRequest) return;
    cover.hidden = false;
    const next = 1 - backdropIndex;
    backdrops[next].src = src;
    backdrops[next].classList.add("on");
    backdrops[backdropIndex].classList.remove("on");
    backdropIndex = next;
  }

  function controls() {
    $("playIcon").setAttribute("href", playing ? "#i-pause" : "#i-play");
    const label = (playing ? "Pause" : "Play") + (preview ? " silent lyric preview" : " Spotify");
    $("play").title = label; $("play").setAttribute("aria-label", label);
    $("play").disabled = !preview && !playback.toggle;
    $("previous").hidden = $("next").hidden = preview;
    $("previous").disabled = !playback.previous; $("next").disabled = !playback.next;
    $("import").hidden = preview;
    $("sourceText").textContent = preview ? "Open Spotify" : "Spotify";
    $("mode").textContent = preview ? "Preview" : kind === "plain" ? "Plain lyrics" : !playback.timing && kind === "synced" ? "Sync paused" : "";
    seek.disabled = !preview && !playback.seek;
    $("timeline").hidden = !preview && !duration;
    viewport.classList.toggle("can-seek", !seek.disabled && kind === "synced");
    $("volumeControl").hidden = preview;
    paintMini();
  }
  function paintMini() {
    let text = "", hint = "", quiet = false;
    if (kind === "synced" && (preview || playback.timing) && rows[active]) {
      const row = rows[active];
      text = rows.filter(r => r.at === row.at).map(r => r.rest ? "♪" : r.text).join("\n");
      if (row.rest) { hint = "Waiting for the vocals"; quiet = true; }
      else if (preview) hint = "Silent lyric preview";
    } else {
      quiet = true;
      const messages = { loading:"Finding lyrics…", missing:"Lyrics unavailable", instrumental:"Instrumental",
        busy:"Lyrics service is busy", offline:"Lyrics are offline", plain:"Plain lyrics available", synced:"Live timing unavailable" };
      text = messages[kind] || "Waiting for lyrics…";
      hint = kind === "plain" || kind === "synced" ? "Expand the player to read along" : ["missing","offline","busy"].includes(kind) ? "Expand for lyric options" : "";
    }
    if ($("miniCurrent").textContent !== text) {
      $("miniCurrent").textContent = $("miniCurrent").title = text;
      $("miniLyrics").scrollTop = 0;
      $("miniCurrent").classList.remove("changed");
      if (mini && !reducedMotion.matches) requestAnimationFrame(() => $("miniCurrent").classList.add("changed"));
    }
    $("miniHint").textContent = hint;
    $("miniLyrics").classList.toggle("quiet", quiet);
  }
  function windowMode(p) {
    const changed = mini !== !!p.mini;
    mini = !!p.mini; miniPinned = p.miniPinned !== false;
    document.body.classList.toggle("mini", mini);
    $("miniToggle").setAttribute("aria-pressed", String(mini));
    $("miniToggle").setAttribute("aria-label", mini ? "Return to full player" : "Open compact view");
    $("miniToggle").title = (mini ? "Full player" : "Compact view") + " (Ctrl+Shift+M)";
    $("miniIcon").setAttribute("href", mini ? "#i-expand" : "#i-mini");
    $("miniPin").setAttribute("aria-pressed", String(miniPinned));
    $("miniPin").title = miniPinned ? "Unpin mini-player" : "Keep mini-player on top";
    $("miniPin").setAttribute("aria-label", $("miniPin").title);
    if (changed) {
      if (!menu.hidden) options(false);
      if (mini) document.dispatchEvent(new Event("enter-mini"));
      browsingUntil = 0; scrolling = false; velocity = 0;
      $("follow").hidden = true; viewport.classList.remove("browsing");
      if (!document.body.classList.contains("library-open")) $("miniToggle").focus({preventScroll:true});
      requestAnimationFrame(() => recenter(true));
    }
    paintMini();
  }
  function setTrack(title, artist) {
    $("title").textContent = $("title").title = title;
    $("artist").textContent = $("artist").title = artist;
    browsingUntil = 0; dragging = false; active = -1; lastSecond = -1; lastProgress = -1;
    $("follow").hidden = true;
    viewport.classList.remove("browsing","manual");
  }
  function renderRows(newRows) {
    rows = newRows; active = -1; visibleWords = [];
    $("empty").hidden = true; viewport.hidden = false;
    viewport.classList.toggle("manual", kind === "plain" || (!preview && !playback.timing && kind === "synced"));
    const fragment = document.createDocumentFragment();
    nodes = rows.map((r,i) => {
      const node = document.createElement("div");
      node.className = "line" + (r.backing ? " back" : "") + (r.rest ? " intro" : "");
      node.dataset.index = i;
      if (preview && previewBreaks[i]) {
        previewBreaks[i].forEach((part,j) => {
          if (j > 0) { const br = document.createElement("br"); br.className = "preview-break"; node.append(" ",br); }
          node.append(part);
        });
      } else if (r.words?.length) {
        r.words.forEach(w => { const span = document.createElement("span"); span.textContent = w.text; node.append(span); });
      } else node.textContent = r.text;
      fragment.append(node);
      return node;
    });
    lines.replaceChildren(fragment);
    viewport.scrollTop = 0;
    if (kind === "synced") updateActive(position(),true);
    controls();
  }
  function showLyrics(data) {
    kind = data.kind;
    if (kind === "synced") {
      const parsed = LyricTiming.parse(data.text || "");
      if (parsed.some(r => !r.rest)) { renderRows(parsed); return; }
      kind = "missing";
    }
    if (kind === "plain") {
      renderRows((data.text || "").split(/\r?\n/).filter(s => s.trim()).map(s => LyricTiming.voice(s.trim())));
      return;
    }
    rows = []; nodes = []; visibleWords = []; active = -1;
    lines.replaceChildren(); $("follow").hidden = true; viewport.hidden = true; $("empty").hidden = false;
    const messages = {
      loading: ["Finding lyrics…",""],
      missing: ["Lyrics unavailable","You can open a timed lyrics file for this song."],
      instrumental: ["Instrumental","This recording has no sung lyrics."],
      busy: ["Lyrics service is busy","Try again in a little while, or open a lyrics file."],
      offline: ["Couldn’t reach LRCLIB","Check your connection or open a lyrics file."]
    };
    [$("emptyTitle").textContent, $("emptyText").textContent] = messages[kind] || messages.missing;
    const actions = $("emptyActions"); actions.replaceChildren();
    if (["offline","busy","missing"].includes(kind)) {
      for (const [title, action] of [["Try again","retry"],["Open .lrc","import"]]) {
        const b = document.createElement("button"); b.textContent = title; b.onclick = () => currentCommand(action); actions.append(b);
      }
    }
    controls();
  }
  function showPreview() {
    preview = true; trackId = null; playback = {}; playing = false; rate = 1; duration = 20; anchor(0);
    setTrack("Evening light","UNDERTONE · SILENT PREVIEW"); showArt("demo-cover.svg"); showLyrics({kind:"synced",text:previewLyrics});
  }
  function recenter(snap = false) {
    if (mini) return;
    if (!nodes[active] || browsingUntil || viewport.classList.contains("manual")) return;
    const space = clamp(viewport.clientHeight * .069, 12, 48);
    lines.style.setProperty("--anchor", space + "px");
    target = clamp(nodes[active].offsetTop - space, 0, viewport.scrollHeight - viewport.clientHeight);
    if (snap || reducedMotion.matches) { viewport.scrollTop = target; velocity = 0; scrolling = false; }
    else { scrollPosition = viewport.scrollTop; scrolling = true; }
  }
  function updateActive(t, snap = false) {
    if (!rows.length || kind !== "synced") return;
    const lyricTime = Math.max(0, t - (preview ? 0 : prefs.timing));
    const index = LyricTiming.active(rows, lyricTime);
    if (index !== active) {
      active = index; visibleWords = [];
      nodes.forEach((node,i) => {
        const d = Math.abs(i - index);
        const paired = (i === index + 1 && rows[i].backing && !rows[index].backing) || rows[i].at === rows[index].at;
        const level = i === index ? "0" : paired ? "pair" : String(Math.min(3,d));
        node.dataset.level = level;
        if (rows[i].words?.length) {
          [...node.children].forEach(s => { s.className = i === index ? "word" : ""; });
          if (rows[i].at === rows[index].at) visibleWords.push(i);
        }
      });
      recenter(snap);
      paintMini();
    }
    for (const i of visibleWords) {
      rows[i].words.forEach((w, j) => nodes[i].children[j].classList.toggle("sung", w.at <= lyricTime));
    }
  }
  function follow() {
    browsingUntil = 0; $("follow").hidden = true; viewport.classList.remove("browsing"); recenter();
  }
  function browse() {
    if (!rows.length || kind !== "synced" || viewport.classList.contains("manual")) return;
    scrolling = false; velocity = 0; browsingUntil = performance.now() + 5500;
    viewport.classList.add("browsing"); $("follow").hidden = false;
  }
  viewport.addEventListener("wheel", browse, {passive:true});
  viewport.addEventListener("touchmove", browse, {passive:true});
  viewport.addEventListener("keydown", e => { if (["ArrowDown","ArrowUp","PageDown","PageUp","Home","End"].includes(e.key)) browse(); });
  $("follow").onclick = follow;
  function seekTo(value) {
    if (seek.disabled) return;
    if (preview) { anchor(value); updateActive(value); }
    else currentCommand("seek", {position: value});
    follow();
  }
  lines.onclick = e => {
    const node = e.target.closest(".line");
    if (node && kind === "synced" && !seek.disabled) seekTo(rows[Number(node.dataset.index)].at + (preview ? 0 : prefs.timing));
  };
  seek.addEventListener("input", () => { dragging = true; paintTime(Number(seek.value)); });
  seek.addEventListener("change", () => { dragging = false; seekTo(Number(seek.value)); });
  seek.addEventListener("pointercancel", () => dragging = false);
  seek.addEventListener("blur", () => dragging = false);
  function paintTime(t) {
    const progress = duration ? Math.round(t / duration * 1000) / 10 : 0;
    if (progress !== lastProgress) {
      seek.max = duration || 1; if (!dragging) seek.value = t;
      seek.style.setProperty("--progress", progress + "%"); lastProgress = progress;
    }
    const sec = Math.floor(t);
    if (sec !== lastSecond) {
      $("elapsed").textContent = timeText(sec); $("remaining").textContent = "−" + timeText(Math.max(0, Math.ceil(duration) - sec));
      seek.setAttribute("aria-valuetext",timeText(sec)); lastSecond = sec;
    }
  }
  function animate(now) {
    const dt = Math.min(.055, Math.max(0,(now - lastFrame) / 1000)); lastFrame = now;
    let t = position();
    if (preview && playing && t >= duration) { playing = false; anchor(0); t = 0; controls(); }
    if (browsingUntil && now >= browsingUntil) follow();
    if (!dragging) paintTime(t);
    updateActive(t);
    if (scrolling) {
      const d = scrollPosition - target, response = 10.8, decay = Math.exp(-response * dt);
      const step = (velocity + response * d) * dt;
      velocity = (velocity - response * step) * decay;
      scrollPosition = target + (d + step) * decay;
      viewport.scrollTop = scrollPosition;
      if (Math.abs(d) < 1.2 && Math.abs(velocity) < 6) { viewport.scrollTop = target; scrolling = false; velocity = 0; }
    }
    if (playing || scrolling) requestAnimationFrame(animate);
    else setTimeout(() => requestAnimationFrame(animate),80);
  }
  function togglePlay() {
    if ($("play").disabled) return;
    if (preview) { anchor(position() >= duration ? 0 : position()); playing = !playing; controls(); }
    else currentCommand("playPause");
  }
  $("play").onclick = togglePlay;
  $("previous").onclick = () => currentCommand("previous"); $("next").onclick = () => currentCommand("next");
  $("source").onclick = () => send("spotify");

  const menu = $("options");
  function placeMenu() {
    if (menu.hidden) return;
    const r = $("more").getBoundingClientRect();
    menu.style.left = clamp(r.right - menu.offsetWidth,8,innerWidth - menu.offsetWidth - 8) + "px";
    menu.style.top = Math.min(r.bottom + 9,innerHeight - menu.offsetHeight - 8) + "px";
  }
  function options(open) {
    menu.hidden = $("scrim").hidden = !open;
    $("more").setAttribute("aria-expanded",String(open));
    if (open) { placeMenu(); $("dismiss").focus({preventScroll:true}); } else $("more").focus({preventScroll:true});
  }
  $("more").onclick = () => options(menu.hidden); $("dismiss").onclick = $("scrim").onclick = () => options(false);
  $("miniToggle").onclick = () => send("mini", {value:!mini});
  $("miniMenu").onclick = () => { options(false); send("mini", {value:true}); };
  $("miniPin").onclick = () => send("miniPin", {value:!miniPinned});
  document.addEventListener("open-library", () => { if (!menu.hidden) { menu.hidden = $("scrim").hidden = true; $("more").setAttribute("aria-expanded","false"); } });
  $("openSpotify").onclick = () => { options(false); send("spotify"); };
  $("import").onclick = () => { options(false); currentCommand("import"); };
  $("pin").onclick = () => { prefs.pin = !prefs.pin; send("pin",{value:prefs.pin}); preferences(true); };
  fontPicker.onchange = () => { applyLyricFont(); preferences(true); };
  $("earlier").onclick = () => { prefs.timing = Math.max(-3,Math.round((prefs.timing - .1)*10)/10); preferences(true); };
  $("later").onclick = () => { prefs.timing = Math.min(3,Math.round((prefs.timing + .1)*10)/10); preferences(true); };
  document.querySelectorAll("[data-size]").forEach(b => b.onclick = () => { prefs.size = b.dataset.size; preferences(true); });
  document.querySelectorAll("[data-action]").forEach(b => b.onclick = () => send(b.dataset.action));
  document.addEventListener("keydown", e => {
    if (e.ctrlKey && e.shiftKey && e.code === "KeyM" && !e.repeat) { e.preventDefault(); send("mini",{value:!mini}); return; }
    if (e.key === "Escape" && !menu.hidden) { options(false); return; }
    if (!menu.hidden && e.key === "Tab") {
      const enabled = [...menu.querySelectorAll("button:not(:disabled):not([hidden]), select:not(:disabled)")];
      if (e.shiftKey && document.activeElement === enabled[0]) { e.preventDefault(); enabled.at(-1).focus(); }
      if (!e.shiftKey && document.activeElement === enabled.at(-1)) { e.preventDefault(); enabled[0].focus(); }
    }
    if (menu.hidden && !document.body.classList.contains("library-open") && e.code === "Space" && !e.repeat && !e.target.closest("button,input,select,summary")) { e.preventDefault(); togglePlay(); }
  });
  new ResizeObserver(() => { recenter(true); placeMenu(); }).observe(viewport);
  for (const [side, css] of [
    [10,"left:0;top:6px;bottom:6px;width:4px;cursor:w-resize"],[11,"right:0;top:6px;bottom:6px;width:4px;cursor:e-resize"],
    [12,"top:0;left:6px;right:6px;height:4px;cursor:n-resize"],[15,"bottom:0;left:6px;right:6px;height:4px;cursor:s-resize"],
    [13,"top:0;left:0;cursor:nw-resize"],[14,"top:0;right:0;cursor:ne-resize"],[16,"bottom:0;left:0;cursor:sw-resize"],[17,"bottom:0;right:0;cursor:se-resize"]
  ]) {
    const edge = document.createElement("div"); edge.style.cssText = css;
    if ([13,14,16,17].includes(side)) { edge.style.width = "7px"; edge.style.height = "7px"; }
    edge.onpointerdown = e => { if (e.button === 0) send("resize",{side}); };
    $("edges").append(edge);
  }
  bridge?.addEventListener("message", event => {
    const {type, payload: p} = event.data;
    if (type === "idle") {
      if (!preview) showPreview();
      if (p.reason === "unavailable") notify("Windows media access is unavailable. Reopen Spotify and try again.");
    } else if (type === "track") {
      preview = false; trackId = p.id; playing = false; duration = 0; playback = {}; anchor(0);
      setTrack(p.title,p.artist); showArt(""); showLyrics({kind:"loading"});
    } else if (type === "window") {
      windowMode(p);
      $("maximize").title = p.maximized ? "Exit full screen" : "Full screen";
      $("maximize").setAttribute("aria-label",$("maximize").title); $("edges").hidden = p.maximized;
    } else if (type === "notice") notify(p.text);
    else if (p.id === trackId) {
      if (type === "art") showArt(p.image);
      if (type === "lyrics") showLyrics(p);
      if (type === "playback") {
        const changed = playback.timing !== p.timing;
        if (duration !== p.duration) { lastSecond = -1; lastProgress = -1; }
        playback = p; duration = p.duration; rate = p.rate; playing = p.playing; anchor(p.position);
        if (kind === "synced") viewport.classList.toggle("manual", !p.timing);
        if (changed) recenter(true);
        controls();
      }
    }
  });
  applyLyricFont(); preferences(); showPreview(); document.fonts.ready.then(() => recenter(true));
  send("ready"); send("pin",{value:!!prefs.pin}); requestAnimationFrame(animate);
})();
