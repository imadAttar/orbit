# E2E Testing

Lance l'app et teste des scenarios utilisateur end-to-end.

## Usage
`/e2e` — lance les tests e2e
`/e2e <scenario>` — teste un scenario specifique

## Steps
1. Ensure the app is built: `npm run build`
2. Launch the app with `npm run tauri dev` in background
3. Wait for the app to be ready (check localhost:1420)
4. Run test scenarios using the Bash tool:
   - New session creation
   - Tab switching
   - Theme switching
   - Keyboard shortcuts
   - Git panel interactions
5. Report results with pass/fail for each scenario
6. Kill the dev server

## Default Scenarios
- **Session lifecycle**: create tab -> verify terminal renders -> close tab
- **Navigation**: Cmd+1/2/3 tab switching, Cmd+K command palette
- **Theme**: switch theme -> verify CSS vars applied
- **Git panel**: open panel -> verify changed files listed
