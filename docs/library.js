"use strict";
(() => {
  const $ = id => document.getElementById(id), bridge = window.UndertoneBridge;
  const send = (action, data = {}) => bridge?.postMessage({action,...data});
  const drawer = $("library"), toggle = $("libraryToggle");
  let connected = false, connecting = false, loaded = false, busy = false, request = 0;
  let playlist = null, rows = [], next = null, lastOffset = 0, pendingPlay = null, lastPlayed = null, playSequence = 0;
  let volumeState = {available:false,value:0,muted:false}, volumeTimer, ignoreVolumeUntil = 0;
  function open(show) {
    drawer.hidden = $("libraryScrim").hidden = !show;
    toggle.setAttribute("aria-expanded", String(show));
    toggle.setAttribute("aria-label", show ? "Close Spotify library" : "Open Spotify library");
    document.body.classList.toggle("library-open", show);
    document.querySelector("main").inert = show;
    if (show) {
      if (document.body.classList.contains("mini")) send("mini", {value:false});
      document.dispatchEvent(new Event("open-library"));
      $("libraryClose").focus();
      if (connected && !loaded && !busy) browse(0);
      if (connected) devices();
    } else toggle.focus();
  }
  toggle.onclick = () => open(drawer.hidden);
  document.addEventListener("enter-mini", () => { if (!drawer.hidden) open(false); });
  $("libraryClose").onclick = $("libraryScrim").onclick = () => open(false);
  document.addEventListener("keydown", e => {
    if (drawer.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); open(false); }
    if (e.key === "Tab") {
      const focusable = [...drawer.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,a[href]")].filter(n => n.getClientRects().length);
      if (e.shiftKey && document.activeElement === focusable[0]) { e.preventDefault(); focusable.at(-1)?.focus(); }
      if (!e.shiftKey && document.activeElement === focusable.at(-1)) { e.preventDefault(); focusable[0]?.focus(); }
    }
  });
  function account(p) {
    const wasConnected = connected;
    connected = !!p.connected; connecting = !!p.connecting;
    $("spotifySetup").hidden = connected;
    $("spotifyContent").hidden = $("libraryFooter").hidden = !connected;
    if (document.activeElement !== $("spotifyClientId")) $("spotifyClientId").value = p.clientId || "";
    $("connectionSettings").open = !p.clientId;
    $("connectSpotify").disabled = connecting;
    $("spotifyClientId").disabled = connecting;
    $("connectSpotify").textContent = connecting ? "Waiting for Spotify…" : "Connect Spotify";
    $("cancelConnect").hidden = !connecting;
    if (connecting) $("connectStatus").textContent = "Finish signing in in your browser, then return here.";
    else if (!wasConnected && connected) $("connectStatus").textContent = "";
    if (!connected) {
      loaded = false; busy = false; rows = []; playlist = null; next = null; request++; pendingPlay = null; lastPlayed = null;
      $("libraryRows").replaceChildren(); $("libraryStatus").textContent = "";
    } else if (!wasConnected && !drawer.hidden) { browse(0); devices(); }
  }
  $("connectSpotify").onclick = () => {
    const clientId = $("spotifyClientId").value.trim();
    if (!/^[a-f\d]{32}$/i.test(clientId)) {
      $("connectionSettings").open = true; $("spotifyClientId").focus();
      $("connectStatus").textContent = "Paste your Spotify app’s Client ID to connect."; return;
    }
    $("connectStatus").textContent = "Opening Spotify sign-in…";
    send("spotifyConnect", {clientId});
  };
  $("cancelConnect").onclick = () => send("spotifyCancel");
  $("spotifyDashboard").onclick = () => send("spotifyDashboard");
  $("disconnectSpotify").onclick = () => send("spotifyDisconnect");
  function browse(offset) {
    request++; busy = true; lastOffset = offset;
    if (offset === 0) { rows = []; loaded = false; next = null; $("libraryRows").replaceChildren(); }
    $("libraryStatus").textContent = offset ? "Loading more…" : playlist ? "Loading songs…" : "Loading your playlists…";
    $("libraryMore").hidden = $("libraryRetry").hidden = true;
    $("libraryRefresh").disabled = true;
    $("libraryBack").hidden = !playlist; $("playlistCount").hidden = !!playlist;
    $("playlistHeading").hidden = !playlist;
    $("playlistTitle").textContent = playlist?.name || "";
    $("libraryFilter").placeholder = playlist ? "Find a song" : "Find a playlist";
    send("spotifyBrowse", {request,playlist:playlist?.id || "",offset});
  }
  $("libraryRefresh").onclick = () => browse(0);
  $("libraryMore").onclick = () => { if (!busy && next !== null) browse(next); };
  $("libraryRetry").onclick = () => browse(lastOffset);
  $("libraryBack").onclick = () => { playlist = null; $("libraryFilter").value = ""; browse(0); };
  $("playlistInSpotify").onclick = () => playlist && send("spotifyPlaylistOpen",{playlist:playlist.id});
  $("libraryFilter").oninput = render;
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS(svg.namespaceURI, "use"); use.setAttribute("href", "#i-" + name); svg.append(use); return svg;
  }
  function render() {
    const query = $("libraryFilter").value.trim().toLocaleLowerCase();
    const filtered = rows.filter(row => [row.name,row.artist,row.owner].some(v => v?.toLocaleLowerCase().includes(query)));
    const fragment = document.createDocumentFragment();
    for (const row of filtered) {
      const button = document.createElement("button"); button.className = "library-row";
      const art = document.createElement("span"); art.className = "row-art"; art.append(icon("note"));
      if (row.image) { const img = new Image(); img.alt = ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer"; img.src = row.image; img.onerror = () => img.remove(); art.append(img); }
      const copy = document.createElement("span"); copy.className = "row-copy";
      const name = document.createElement("strong"); name.textContent = row.name;
      const description = document.createElement("small");
      description.textContent = playlist ? (row.reason || row.artist) : [row.owner, row.count + (row.count === 1 ? " song" : " songs")].filter(Boolean).join(" · ");
      copy.append(name,description);
      const end = document.createElement("span"); end.className = "row-end";
      if (playlist) {
        button.disabled = !row.playable || pendingPlay !== null;
        button.setAttribute("aria-label", "Play " + row.name + (row.artist ? " by " + row.artist : ""));
        button.setAttribute("aria-current", String(lastPlayed?.playlist === playlist.id && lastPlayed.index === row.index));
        if (row.duration) end.textContent = Math.floor(row.duration / 60000) + ":" + String(Math.floor(row.duration / 1000) % 60).padStart(2,"0");
        button.onclick = () => {
          if (pendingPlay !== null) return;
          pendingPlay = --playSequence; render(); $("libraryStatus").textContent = "Starting “" + row.name + "”…";
          send("spotifyPlay", {request:pendingPlay,playlist:playlist.id,index:row.index,device:$("playbackDevice").value});
        };
      } else {
        end.append(icon("arrow")); button.setAttribute("aria-label", "Open playlist " + row.name);
        button.onclick = () => { playlist = row; $("libraryFilter").value = ""; browse(0); };
      }
      button.append(art,copy,end); fragment.append(button);
    }
    $("libraryRows").replaceChildren(fragment);
    if (!busy && pendingPlay === null) $("libraryStatus").textContent = !rows.length ? (playlist ? "This playlist is empty." : "No playlists found in this Spotify account.") : !filtered.length ? (next !== null ? "No matches in the loaded songs. Load more to keep looking." : "No matches found.") : "";
    $("playlistCount").textContent = rows.length + " playlists";
  }
  function devices() { $("deviceStatus").textContent = "Looking for Spotify devices…"; send("spotifyDevices"); }
  $("devicesRefresh").onclick = devices;
  $("playbackDevice").onchange = () => $("deviceStatus").textContent = "Lyrics follow your active Spotify device.";
  function paintVolume(p) {
    volumeState = p;
    $("volume").disabled = $("mute").disabled = !p.available;
    $("volumeControl").title = p.available ? "Spotify device volume · " + (p.muted ? "Muted" : p.value + "%") : "Use your device’s volume buttons when Spotify cannot control volume";
    $("volume").value = p.muted ? 0 : p.value;
    $("volume").style.setProperty("--progress", $("volume").value + "%");
    $("volume").setAttribute("aria-valuetext", p.muted ? "Muted" : p.value + " percent");
    $("volumeIcon").setAttribute("href", p.muted || p.value === 0 ? "#i-muted" : "#i-volume");
    $("mute").title = p.muted ? "Unmute Spotify" : "Mute Spotify";
    $("mute").setAttribute("aria-label", $("mute").title);
    $("mute").setAttribute("aria-pressed",String(p.muted));
  }
  $("volume").oninput = () => {
    clearTimeout(volumeTimer); const value = Number($("volume").value);
    ignoreVolumeUntil = performance.now() + 500; paintVolume({...volumeState,value,muted:false});
    volumeTimer = setTimeout(() => send("volume",{value}),250);
  };
  $("mute").onclick = () => { clearTimeout(volumeTimer); const value = !volumeState.muted; ignoreVolumeUntil = performance.now() + 500; paintVolume({...volumeState,muted:value}); send("mute",{value}); };
  bridge?.addEventListener("message", event => {
    const {type,payload:p} = event.data;
    if (type === "volume" && performance.now() >= ignoreVolumeUntil) paintVolume(p);
    if (type === "spotifyAccount") account(p);
    if (type === "spotifyPage" && p.request === request && p.playlist === (playlist?.id || "")) {
      busy = false; loaded = true; next = p.next; rows = p.offset === 0 ? p.items : rows.concat(p.items);
      $("libraryRefresh").disabled = false; $("libraryMore").hidden = next === null; render();
    }
    if (type === "spotifyDevices" && connected) {
      const select = $("playbackDevice"), previous = select.value;
      select.replaceChildren(new Option("Active Spotify device", ""));
      for (const d of p.items) select.add(new Option(d.name + (d.active ? " · active" : ""),d.id));
      if ([...select.options].some(o => o.value === previous)) select.value = previous;
      $("deviceStatus").textContent = p.items.length ? "Lyrics follow your active Spotify device." : "Open Spotify on a device, then refresh this list.";
    }
    if (type === "spotifyPlayed" && p.request === pendingPlay) {
      pendingPlay = null; lastPlayed = p; render(); $("libraryStatus").textContent = "Playing “" + p.title + "”.";
    }
    if (type === "spotifyError") {
      if (p.action === "spotifyConnect" || !connected) $("connectStatus").textContent = p.text;
      else if (p.action === "spotifyDevices") $("deviceStatus").textContent = p.text;
      else if (p.request === request || p.request === pendingPlay) {
        pendingPlay = null; busy = false; render(); $("libraryStatus").textContent = p.text;
        $("libraryRefresh").disabled = false;
        $("libraryRetry").hidden = p.action !== "spotifyBrowse";
      }
    }
  });
  send("spotifyState");
})();
