/* sorts.js — Sorts élémentaires des héros : groupes, noms, cibles et résumé de l'effet.
   Les résumés sont rédigés pour cette application (pas de texte officiel des cartes).
   La mise en œuvre des effets est dans vue-plateau.js (section « Sorts »).

   cible : 'heros' (un héros, lanceur compris), 'monstre', 'tous' (héros ou monstre)
   partout : true si la cible n'a pas besoin d'être visible (Djinn : choix propre). */
'use strict';

const Sorts = (() => {
  const GROUPES = [
    { id: 'air', nom: 'Air', symbole: '🌪' },
    { id: 'eau', nom: 'Eau', symbole: '💧' },
    { id: 'feu', nom: 'Feu', symbole: '🔥' },
    { id: 'terre', nom: 'Terre', symbole: '⛰' },
  ];

  // Noms et effets alignés sur les cartes françaises 2021 (vérification du 23/11/2026) ;
  // les identifiants restent ceux des versions précédentes (parties sauvegardées).
  const LISTE = [
    { id: 'djinn', groupe: 'air', nom: 'Djinn', cible: 'special', partout: true,
      resume: 'Un génie ouvre une porte du plateau (on découvre ce qu’il y a derrière), ou attaque un monstre en vue avec 5 dés de combat.' },
    { id: 'tempete', groupe: 'air', nom: 'Tornade', cible: 'monstre',
      resume: 'Le monstre visé passe son prochain tour.' },
    { id: 'ventVif', groupe: 'air', nom: 'Vif comme le vent', cible: 'heros',
      resume: 'Au prochain déplacement, le héros lance deux fois plus de dés rouges.' },
    { id: 'eauGuerison', groupe: 'eau', nom: 'Eau de guérison', cible: 'heros',
      resume: 'Rend jusqu’à 4 points de Vie, sans dépasser le total de départ.' },
    { id: 'sommeil', groupe: 'eau', nom: 'Sommeil', cible: 'monstre',
      resume: 'Le monstre ne bouge plus, n’attaque plus et ne se défend plus. Tout de suite puis à chacun de ses tours, il lance 1 dé rouge par point d’Esprit : un 6 le libère. Sans effet sur les momies, zombies et squelettes.' },
    { id: 'brume', groupe: 'eau', nom: 'Voile de brume', cible: 'heros',
      resume: 'Au prochain déplacement, le héros traverse les cases occupées par des monstres (sans s’y arrêter).' },
    { id: 'bouleFeu', groupe: 'feu', nom: 'Boule de feu', cible: 'monstre',
      resume: 'Le monstre perd 2 points de Vie ; il lance 2 dés rouges, chaque 5 ou 6 réduit la perte de 1.' },
    { id: 'courage', groupe: 'feu', nom: 'Courage', cible: 'heros',
      resume: '+2 dés de combat à la prochaine attaque du héros ; le sort prend fin s’il n’y a plus de monstre en vue.' },
    { id: 'feuCourroux', groupe: 'feu', nom: 'Le feu du courroux', cible: 'monstre',
      resume: 'Le monstre perd 1 point de Vie, sauf s’il fait 5 ou 6 sur 1 dé rouge.' },
    { id: 'traversPierre', groupe: 'terre', nom: 'À travers la pierre', cible: 'heros',
      resume: 'Au prochain déplacement, le héros traverse autant de murs que le total de ses dés. Finir dans le roc massif : emprisonné à jamais.' },
    { id: 'guerisonCorps', groupe: 'terre', nom: 'Guérison', cible: 'heros',
      resume: 'Rend jusqu’à 4 points de Vie, sans dépasser le total de départ.' },
    { id: 'peauRoc', groupe: 'terre', nom: 'Peau de roc', cible: 'heros',
      resume: '+1 dé de défense jusqu’à la première blessure.' },
  ];

  const sort = id => LISTE.find(s => s.id === id);
  const duGroupe = g => LISTE.filter(s => s.groupe === g);
  const groupe = id => GROUPES.find(g => g.id === id);

  // Sorts d'un héros à partir de ses groupes : [{ id, utilise: false }].
  function deGroupes(groupes) {
    return groupes.flatMap(g => duGroupe(g).map(s => ({ id: s.id, utilise: false })));
  }

  return { GROUPES, LISTE, sort, duGroupe, groupe, deGroupes };
})();
