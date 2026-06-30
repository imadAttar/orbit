---
name: release
description: Build locally, tag, and create GitHub Release with signed artifacts
triggers:
  - release
  - tag version
  - create release
  - nouvelle release
---

# Release

Build local + GitHub Release. Pas de CI — tout se fait sur cette machine.

## Steps

1. **Version** — Lire la version actuelle dans `src-tauri/tauri.conf.json`. Demander la nouvelle version au user (ou bump patch par défaut).

2. **Bump version** — Mettre à jour la version dans les 3 fichiers :
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`

3. **Checks** — Lancer typecheck et tests :
   ```bash
   npx tsc --noEmit
   npm test
   ```
   Si l'un échoue, arrêter et corriger.

4. **Build Tauri** — Builder l'app signée pour macOS ARM64 :
   ```bash
   source "$HOME/.cargo/env" 2>/dev/null
   npm run tauri build -- --target aarch64-apple-darwin
   ```
   Les variables `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` doivent être dans l'environnement (configurées dans `~/.zshrc`).

5. **Collect artifacts** — Copier les fichiers depuis `src-tauri/target/aarch64-apple-darwin/release/bundle/` :
   ```bash
   rm -rf artifacts && mkdir -p artifacts
   find src-tauri/target/aarch64-apple-darwin/release/bundle -type f \( -name "*.dmg" -o -name "*.tar.gz" -o -name "*.sig" \) -exec cp {} artifacts/ \;
   ```

6. **Generate latest.json** — Créer le manifeste auto-updater dans `artifacts/latest.json` :
   ```json
   {
     "version": "<VERSION>",
     "notes": "See release notes at https://github.com/imadAttar/orbit/releases/tag/<VERSION>",
     "pub_date": "<ISO8601>",
     "platforms": {
       "darwin-aarch64": {
         "signature": "<contenu du .sig>",
         "url": "https://github.com/imadAttar/orbit/releases/download/<VERSION>/<filename>.tar.gz"
       }
     }
   }
   ```
   Lire la signature depuis le fichier `.sig` dans artifacts.

7. **Git commit + tag** :
   ```bash
   git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
   git commit -m "chore: bump version to <VERSION>"
   git tag -a "<VERSION>" -m "v<VERSION>"
   ```

8. **Push** :
   ```bash
   git push origin main
   git push origin "<VERSION>"
   ```

9. **Create GitHub Release** — Upload tous les artifacts :
   ```bash
   gh release create "<VERSION>" \
     --repo imadAttar/orbit \
     --title "Orbit v<VERSION>" \
     --generate-notes \
     artifacts/*
   ```

10. **Report** — Afficher le lien de la release et la liste des artifacts uploadés.

## Notes
- Seul macOS ARM64 est buildé localement. Pour les autres plateformes, il faudrait réactiver le CI ou cross-compiler.
- Le `latest.json` permet à l'auto-updater Tauri de détecter les nouvelles versions.
- Ne pas oublier de nettoyer `artifacts/` après la release (`rm -rf artifacts`).
