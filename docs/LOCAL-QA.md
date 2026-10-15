# Vérification locale de la version workspace

## Politique de coût

Le développement se fait localement. Aucun push, tag, dispatch GitHub Actions ou build d'installateur n'est nécessaire pour ces vérifications. Les binaires et la matrice distante sont la dernière étape, après gel du périmètre et validation locale. `npm run build` produit uniquement les assets web locaux ; `cargo test` produit les exécutables de test locaux, pas les installateurs.

## Gates locales

Depuis la racine :

```sh
npm run lint
npm test
npm run build
npm audit --audit-level=high
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
python3 -m unittest discover -s scripts -p 'test_release.py' -v
git diff --check
```

## Parcours navigateur reproductible

Le test utilise de **vraies interactions navigateur sur l'interface**, mais une frontière IPC Tauri simulée et des projets fictifs sous `/tmp`. Il ne lance ni Claude, ni shell, ni lecture de données professionnelles. Ce n'est pas un test natif de PTY, de reprise Claude ou d'installateur.

Installer Playwright hors du projet pour ne pas modifier le lockfile :

```sh
npm install --prefix /tmp/orbit-release-qa --no-package-lock --ignore-scripts playwright@1.64.1
/tmp/orbit-release-qa/node_modules/.bin/playwright install chromium
npm run dev -- --port 1437 --host 127.0.0.1
```

Dans un second terminal :

```sh
ORBIT_PLAYWRIGHT_MODULE=/tmp/orbit-release-qa/node_modules/playwright node tests/browser/workspace-smoke.cjs
```

Le test vérifie : activité interprojets, recherche locale, archivage confirmé, restauration et ouverture, Ctrl+T, résultats non consultés, rechargement et dernier projet/session, affichage à 800 et 1280 px. Il échoue en cas d'erreur JavaScript ou de requête Aptabase. Captures dans `qa-output/` (ignoré par Git). `ORBIT_QA_URL` et `ORBIT_QA_OUTPUT` sont optionnels.

## Limites à respecter

Le test d'intégration `src-tauri/tests/native_pty.rs`, inclus dans `cargo test`, lance uniquement un shell contrôlé affichant un marqueur puis quittant avec le code 7. Il vérifie un vrai PTY et les premiers octets sur l'OS local, sans lancer Claude ni lire les projets de l'utilisateur. La lecture doit précéder l'attente de sortie : attendre un processus avant de drainer son PTY peut bloquer. Ce test ne valide pas l'IPC Tauri, l'interface native ou un installateur.

- Un état `idle` issu d'un hook ne prouve pas la réussite métier de la tâche.
- `session_resume_launched` signifie que le processus a démarré ; `session_resume_succeeded` exige ensuite un hook `working` de la conversation correspondante. Une reprise sans activité reste non confirmée.
- Un terminal classique récupère son affichage sauvegardé, mais démarre un **nouveau shell** : ce n'est pas la restauration du processus précédent.
- Les validations locales macOS ne remplacent pas les validations finales Windows/Linux.
- Les signatures de mise à jour ne sont pas des signatures de confiance Apple/Windows. Ne jamais faire passer un build macOS ad-hoc pour un build notarizé.
