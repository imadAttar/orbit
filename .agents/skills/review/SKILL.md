# Review (projet-specifique)

Code review adapte aux conventions Orbit.

## Usage
`/review` — review les changements sur la branche courante

## Steps

1. Get the diff: `git diff main...HEAD` (or staged changes if no branch)
2. For each changed file, review against these project-specific criteria:

### Checklist
- [ ] **Vision guard**: la feature ameliore-t-elle la supervision de l'IA ? (voir `.Codex/rules/vision-guard.md`)
- [ ] **Cross-platform**: tout fonctionne sur macOS, Windows, Linux (voir `.Codex/rules/cross-platform.md`)
- [ ] **Rust conventions**: error handling, Tauri commands, PTY patterns (voir `.Codex/rules/rust-conventions.md`)
- [ ] **Testing**: tests presents pour le nouveau code (voir `.Codex/rules/testing.md`)
- [ ] **BEM naming**: CSS classes suivent la convention BEM
- [ ] **French UI**: tout texte visible par l'utilisateur est en francais
- [ ] **No direct API calls**: pas d'appel Anthropic direct, tout passe par Codex CLI
- [ ] **TypeScript strict**: pas de `any`, pas de `@ts-ignore`

3. Report findings grouped by severity: bloquant / important / mineur
4. Suggest fixes for each finding
