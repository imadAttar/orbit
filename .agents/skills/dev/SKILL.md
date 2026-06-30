# Dev Server

Lance le serveur de dev Tauri dans un sub-agent pour ne pas bloquer le contexte principal.

## Usage
`/dev` — lance `npm run tauri dev`

## Steps
1. Launch an Agent with `run_in_background: true`:
   - Run `npm run tauri dev` with timeout 600000ms
   - Report any build errors back
2. Confirm to the user that the dev server is running in background
3. User can continue working — they'll be notified if the build fails
