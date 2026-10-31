# Orbit 1.0.1 — macOS Apple Silicon

Cette version succède à la release publique **1.0.0**. Les anciens numéros 1.1.x/1.2.x correspondaient à des candidats non publiés ; leurs tags sans release ont été retirés. Aucun installateur historique n’est remplacé.

## Nouveautés et corrections

- Supervision via l’interface officielle `claude agents --json --all`, sans ajouter de hooks ni de status line à Claude. Une lecture absente ou défaillante laisse l’état inconnu.
- Rail de navigation dans les prompts rendus : aperçu au survol et saut au clic, limité au scrollback conservé, sans reconstruire le chat.
- Titres de session corrigés : les rapports de souris et séquences de contrôle ne deviennent plus des noms. Les titres composés uniquement de ces codes sont réparés sans changer les identifiants de conversation.
- Aperçu web/fichiers/Markdown/images en lecture seule, interface Mac compacte et neuf thèmes cohérents.
- CI native et distribution limitées au Mac ; Windows et Linux ne bloquent plus les nouvelles releases. Durée des jobs et tests Rust bornée.
- Vérifications de mise à jour au lancement, périodiques et au retour dans l’application, sans redémarrage forcé.

## Installation et mise à jour

Télécharger **`Orbit_1.0.1_aarch64.dmg`** depuis la release publiée. Cette version concerne les **Mac Apple Silicon**, pas les Mac Intel.

Finir les tâches en cours puis quitter Orbit avant de remplacer ou redémarrer l’application. Conserver une sauvegarde du workspace et des conversations Claude.

Le manifeste `latest.json` annonce uniquement `darwin-aarch64`. Le paquet d’update est signé avec la clé existante ; le manifeste lui-même n’est pas signé. Le DMG, les sommes SHA256 et la signature de l’update sont vérifiés avant publication.

Si une version de développement 1.1.x/1.2.x a été installée, installer ce DMG manuellement une fois : l’updater ne rétrograde pas automatiquement une version locale supérieure. Les utilisateurs de la release publique 1.0.0 peuvent recevoir la mise à jour 1.0.1.

## Limites

- Signature macOS **ad-hoc** : pas de Developer ID Apple ni de notarisation. Un avertissement Gatekeeper peut apparaître.
- Aucun nouvel installateur Windows/Linux/Intel Mac. Les anciens téléchargements 1.0.0 restent disponibles.
- Pas de détail reconstruit des sous-agents imbriqués : l’interface JSON officielle ne le fournit pas.
- Une erreur d’authentification Claude nécessite sa propre résolution ; le rapport de bug ne lit ni ne modifie ses identifiants.
- Les scénarios navigateur utilisent un transport natif simulé ; ils ne prouvent pas un appel réel au modèle.
- Le nouveau formulaire de signalement GitHub est réservé à une mise à jour ultérieure et n’est pas inclus dans cette release.
