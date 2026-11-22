# Compagnon de quête

Application web personnelle pour iPad (iPadOS 17, Safari), à usage familial et non commercial :
un maître du jeu virtuel pour un jeu de plateau de donjon.

## Ce que contient ce dépôt — et ce qu'il ne contiendra jamais

Ce dépôt est public uniquement parce que c'est la condition pour l'héberger gratuitement avec GitHub Pages.

- **Contient** : le code de l'application, et du contenu de démonstration entièrement inventé.
- **Ne contient jamais** : parties, sauvegardes, réglages personnels ; quêtes, textes de cartes, règles,
  illustrations ou logos officiels ; quêtes de la communauté. Tout cela est importé et reste sur l'iPad.

L'application ne fait aucun appel réseau (bloqués par sa politique de sécurité) : pas de compte,
pas de statistiques, pas de serveur. Les données sont dans le stockage local de l'appareil,
avec sauvegarde et restauration par fichier JSON via l'app Fichiers.

Par précaution, le fichier `.gitignore` refuse le dossier `prive/` et les fichiers `*.prive.json`
et `compagnon-sauvegarde-*.json`.

## Installation sur l'iPad

1. Ouvrir l'adresse GitHub Pages du dépôt dans Safari.
2. Bouton Partager → « Sur l'écran d'accueil ».
3. Lancer l'application depuis l'icône : elle fonctionne ensuite hors ligne.

## Publier une nouvelle version

Changer `VERSION_APP` dans `app.js` et `CACHE` dans `sw.js`, puis publier.
L'application affiche un bandeau « Nouvelle version disponible ».

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Page de l'application |
| `styles.css` | Apparence |
| `stockage.js` | Enregistrement local (IndexedDB) |
| `app.js` | Interface : parties, sauvegardes, à propos |
| `sw.js` | Fonctionnement hors ligne et mises à jour |
| `manifest.webmanifest`, `icons/` | Installation sur l'écran d'accueil |
| `inventaire.js` | Inventaire des héros en trois blocs : arme active, armure, autres objets |
| `theme-plateau.js` | Thème « Pierre et couleurs » du plateau (motifs SVG originaux) |
| `icones.js` | Pictogrammes du plateau (game-icons.net, CC BY 3.0 — voir `CREDITS.md`) |
