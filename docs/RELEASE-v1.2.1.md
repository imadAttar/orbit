# Orbit 1.2.1 — macOS Apple Silicon

Le tag v1.2.0 a été conservé après un échec de vérification Windows ; aucun paquet v1.2.0 n’a été publié. Cette release inclut la correction des séparateurs de chemins, sans désactiver les contrôles de sécurité.

## Nouveautés

- Supervision des sessions de tous les projets et visibilité des sous-agents observés.
- Aperçu web, Markdown, texte et images à côté du terminal, en lecture seule.
- Interface Mac plus compacte ; application cohérente des neuf thèmes, y compris pendant l’aperçu des préférences et son annulation.
- Fiabilité des sauvegardes en développement, signalement des résultats différés et validation des chemins de fichiers renforcés.
- Détection des mises à jour au lancement, puis toutes les six heures et au retour dans l’app si le délai est écoulé. Les choix de mise à jour automatique sont conservés ; aucun redémarrage forcé.

## Installation et mises à jour

Télécharger `Orbit_1.2.1_aarch64.dmg`. Cette version concerne les Mac Apple Silicon, pas les Mac Intel.

Le manifeste `latest.json` et le paquet d’update sont signés avec la clé déjà approuvée par les anciennes versions Mac. Une ancienne version détectera cette release lors de ses propres vérifications, généralement au prochain lancement. Les vérifications périodiques améliorées sont actives après installation de la 1.2.1.

Finir les tâches en cours avant de redémarrer ou remplacer l’application. Conserver une sauvegarde de `~/.orbit` et des conversations Claude.

## Signature et limites

- Signature d’application macOS **ad-hoc** : pas de Developer ID Apple ni de notarisation. Un avertissement Gatekeeper peut apparaître.
- La signature cryptographique du paquet de mise à jour est distincte de la notarisation Apple et vérifiée avant publication.
- Aucun nouvel installateur Windows/Linux n’est livré dans cette release. Leurs anciens téléchargements restent sur les releases précédentes.
- Les pages web externes et images conservent leurs couleurs ; les éléments natifs du système suivent macOS.
- Les contrôles automatisés et les essais natifs isolés ne remplacent pas un essai prolongé de tous les scénarios Claude avec permissions/reprise. La limitation de course locale de fichiers de l’aperçu reste documentée.
