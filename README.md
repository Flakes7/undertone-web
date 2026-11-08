# Undertone Web

[Open Undertone](https://flakes7.github.io/undertone-web/) · [Source on GitHub](https://github.com/Flakes7/undertone-web)

A responsive Spotify lyrics companion for desktop, Android and iPhone. Album-cover backgrounds, smooth timed lyrics, 40 bundled fonts, a playlist drawer and a compact player view.

Music plays in Spotify. Undertone follows your active Spotify Connect device and provides play/pause, next/previous, seek, playlist song selection and volume on supported devices. It does not download or stream Spotify audio itself.

## Run locally

Requires Node.js 22 or later. There are no npm dependencies or build step.

```sh
npm run dev
```

Open `http://127.0.0.1:5173/`. The silent preview works without a Spotify account.

```sh
npm test
npm run check
```

The app source and deployable static files are in `docs/`. Tests cover PKCE, callback state, token refresh, disconnect races, rate limits, playlist positions, lyric matching and timing. Browser QA also checks desktop and phone layouts.

## Connect Spotify

1. Register an app at [Spotify for Developers](https://developer.spotify.com/dashboard) and select Web API. Spotify currently requires Premium for development mode and playback control.
2. Add each exact redirect URI you use, including the trailing slash: `http://127.0.0.1:5173/` for local development and `https://YOUR-USERNAME.github.io/undertone-web/` for GitHub Pages.
3. Enter your public Client ID in the library’s **Connection settings**, or change `docs/config.js` for your deployment. **Never add a client secret**: browser sign-in uses PKCE.
4. Connect Spotify, open the Spotify app on your preferred device, and play a song there. Undertone follows its playback. Use **Play on** in the library to target a device when starting a playlist song.

The included Client ID belongs to the original owner’s personal Undertone registration. Other listeners need to be allowed in that developer app or use their own Client ID. A public website does not remove Spotify’s development-mode restrictions. Playlist songs are readable only for playlists you own or collaborate on; other playlists offer an Open in Spotify link.

## Phones

- iPhone: open the HTTPS site in Safari, then Share → Add to Home Screen.
- Android: open the HTTPS site in Chrome and choose Install app / Add to Home Screen.
- Controls support touch, safe-area insets, portrait and landscape layouts.
- When Spotify cannot change the active device’s volume, use the device’s volume buttons.
- Keep the app visible for live lyrics. Background tabs may be suspended by mobile browsers.
- Compact view is a layout inside the browser, not a native always-on-top window.

## GitHub Pages

Push the repository to GitHub, then choose **Settings → Pages → Deploy from a branch → main → /docs**. The `.nojekyll` file keeps the deploy buildless. Register the resulting HTTPS site URL in your Spotify app’s redirect settings before signing in. All paths are relative, so project subpaths are supported.

## Privacy and storage

Spotify tokens are kept in session storage and are sent only to Spotify. Disconnect clears them. A session may survive a browser’s tab-restoration feature. The app has no analytics and no application server. LRCLIB receives track metadata for lyric searches. Appearance settings and a bounded lyric cache are stored locally; imported LRC files stay local. Service-worker caching is limited to same-origin public assets, with no token-bearing query URLs or Spotify responses cached. See [the privacy page](docs/privacy.html).

## Project structure

- `docs/spotify.js`: PKCE sign-in, refresh and Spotify Web API client.
- `docs/lyrics.js`, `docs/timing.js`: LRCLIB matching, cache and lyric timing.
- `docs/web.js`: playback polling, browser controls and application events.
- `docs/player.js`, `docs/library.js`: player and playlist UI.
- `docs/web.css`: responsive browser and phone layout.
- `docs/sw.js`, `docs/manifest.webmanifest`: installable app shell.

The demo cover and sample lines are original project assets. Bundled fonts retain their licenses in `docs/Licenses/`. Spotify and LRCLIB content remains subject to its respective terms. Undertone is not affiliated with Spotify or Apple.
