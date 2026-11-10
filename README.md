# Move Lab

**Labo de mouvement** : importe une vidéo ou un GIF trouvé sur Instagram, Pinterest ou ailleurs (capoeira, acrobatie, danse, parkour…) et décompose le geste pour comprendre comment le reproduire.

👉 **App en ligne : https://clemdelp.github.io/move-lab/**

## Ce que ça fait

- **Import** d'une vidéo (mp4, mov, webm) ou d'un GIF animé : bouton, glisser-déposer, coller, ou lien direct vers un fichier `.mp4` / `.gif`.
- **Ralenti** de 0,1× à 2×.
- **Image par image**, en avant comme en arrière.
- **Lecture arrière** pour revoir le geste à l'envers.
- **Boucle A–B** sur le passage qui t'intéresse : « A Début ici » et « Fin ici B » placent les bornes à l'image affichée, puis les drapeaux A et B se déplacent au doigt sur la barre de temps.
- **Pas de son** : l'app est muette, quelle que soit la vidéo importée.
- **Miroir** : pour travailler le mouvement de l'autre côté, ou se mettre face à la vidéo comme devant un prof.
- **Zoom / déplacement** (molette ou pincement) pour regarder un appui ou une main.
- **Squelette** : détection automatique du corps (MediaPipe Pose) sur chaque image. Gauche du corps en orange, droite en bleu. Les corps à l'envers (ATR, aú, bananeira) sont aussi pris en charge.
- **Décomposition** : ajoute une étape à chaque position clé, nomme-la (« appui main gauche », « impulsion », « réception »…), et **exporte une planche PNG** de toutes les positions (avec le squelette s'il est actif).
- **Mes mouvements** : chaque vidéo importée est gardée sur l'appareil (IndexedDB) avec sa décomposition (étapes, boucle A–B). Tu la retrouves sur l'écran d'accueil, tu peux la renommer ou la supprimer.
- **Curseur en temps réel** : maintiens et glisse sur la barre de temps, la vidéo suit ton doigt image par image, en avant comme en arrière. Tu peux aussi glisser directement sur la vidéo pour un réglage fin (environ une image tous les 6 px). À l'ouverture, l'app prépare les images en mémoire (la bande claire sur la barre de temps) : sur cette zone, le curseur et la lecture arrière sont parfaitement fluides. Avec une boucle A–B, c'est cette boucle qui est préparée.
- **Tes vidéos restent sur ton appareil** : rien n'est envoyé sur un serveur. Seul le modèle de squelette (~10 Mo) est téléchargé, une fois, quand tu l'actives.

- **Démo** : un bouton sur l'accueil ouvre une rondade + flic-flac pour essayer l'app sans rien importer (vidéo de [Wmagro sur Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Backhandspring.ogv), licence [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/deed.fr), convertie en MP4 sans le son).

### Sur téléphone

L'app est pensée d'abord pour le mobile : touche l'image pour lancer ou arrêter la lecture, glisse dessus pour avancer ou reculer, pince pour zoomer, et le bouton « + Étape » reste toujours sous la vidéo. Le bouton de vitesse passe de 0,1× à 2× à chaque appui.

Pour l'avoir comme une app : ouvre le lien dans Safari (iPhone) ou Chrome (Android), puis **Partager → Sur l'écran d'accueil**. Sur iPhone, c'est aussi ce qui protège ta bibliothèque : Safari peut effacer les données d'un site non utilisé pendant 7 jours, mais pas celles d'une app ajoutée à l'écran d'accueil.

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
| P | squelette |
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

Stack : [Vite](https://vite.dev) + React + TypeScript, [gifuct-js](https://github.com/matt-way/gifuct-js) pour décoder les GIF, [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) pour le squelette. Chaque push sur `main` déploie l'app sur GitHub Pages (`.github/workflows/deploy.yml`).

## Idées pour la suite

- Trajectoire d'une articulation sur tout le mouvement (ex. le chemin du pied pendant une meia-lua).
- Choisir la personne suivie quand il y en a plusieurs à l'image.
- Dessin par-dessus l'image (lignes d'appui, trajectoires).
- Pelure d'oignon : superposer les images précédentes pour voir la trajectoire.
- Comparaison côte à côte avec ta propre vidéo filmée.
- Bibliothèque de mouvements (vidéos + décompositions) et partage depuis le menu « Partager » du téléphone (PWA).

## Licence

MIT
