# Move Lab

**Labo de mouvement** : importe une vidéo ou un GIF trouvé sur Instagram, Pinterest ou ailleurs (capoeira, acrobatie, danse, parkour…) et décompose le geste pour comprendre comment le reproduire.

👉 **App en ligne : https://clemdelp.github.io/move-lab/**

## Ce que ça fait

- **Import** d'une vidéo (mp4, mov, webm) ou d'un GIF animé : bouton, glisser-déposer, coller, ou lien direct vers un fichier `.mp4` / `.gif`.
- **Ralenti** de 0,1× à 2×.
- **Image par image**, en avant comme en arrière.
- **Lecture arrière** pour revoir le geste à l'envers.
- **Boucle A–B** sur le passage qui t'intéresse.
- **Miroir** : pour travailler le mouvement de l'autre côté, ou se mettre face à la vidéo comme devant un prof.
- **Zoom / déplacement** (molette ou pincement) pour regarder un appui ou une main.
- **Décomposition** : ajoute une étape à chaque position clé, nomme-la (« appui main gauche », « impulsion », « réception »…), et **exporte une planche PNG** de toutes les positions.
- Les étapes sont **sauvegardées dans ton navigateur** pour chaque fichier : en réimportant la même vidéo, tu retrouves ta décomposition.
- **Tout reste sur ton appareil** : aucun fichier n'est envoyé sur un serveur.

### Raccourcis clavier

| Touche | Action |
| --- | --- |
| Espace | lecture / pause |
| ← → | image précédente / suivante |
| ⇧ ← → | ±1 seconde |
| J / L | lecture arrière / avant |
| - / + | vitesse |
| [ / ] | début / fin de boucle |
| Échap | effacer la boucle |
| S | ajouter une étape |
| ↑ ↓ | étape précédente / suivante |
| M | miroir |
| 0 / double-clic | réinitialiser le zoom |

## Récupérer une vidéo Instagram / Pinterest

Les navigateurs ne peuvent pas lire directement la vidéo derrière un lien de post Instagram ou Pinterest. Pour l'importer :

1. **Sur téléphone** : utilise « Enregistrer » / « Télécharger » quand l'app le propose, ou fais un **enregistrement d'écran**, puis importe depuis ta galerie.
2. **Sur ordinateur** : [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) télécharge la vidéo d'un post public :
   ```bash
   yt-dlp "https://www.instagram.com/reel/XXXXXXXX/"
   ```

Garde ces vidéos pour ton usage perso et cite les créateurs si tu partages une décomposition.

## Développement

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # vérifie les types et génère dist/
```

Stack : [Vite](https://vite.dev) + React + TypeScript, [gifuct-js](https://github.com/matt-way/gifuct-js) pour décoder les GIF. Chaque push sur `main` déploie l'app sur GitHub Pages (`.github/workflows/deploy.yml`).

## Idées pour la suite

- Détection du squelette (pose estimation, ex. MediaPipe) pour suivre les angles des genoux, hanches, épaules.
- Dessin par-dessus l'image (lignes d'appui, trajectoires).
- Pelure d'oignon : superposer les images précédentes pour voir la trajectoire.
- Comparaison côte à côte avec ta propre vidéo filmée.
- Bibliothèque de mouvements (vidéos + décompositions) et partage depuis le menu « Partager » du téléphone (PWA).

## Licence

MIT
