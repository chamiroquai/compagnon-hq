/* sorts.js — Sorts élémentaires des héros : groupes, noms, cibles et résumé de l'effet.
   Les résumés sont rédigés pour cette application (pas de texte officiel des cartes).
   La mise en œuvre des effets est dans vue-plateau.js (section « Sorts »).

   cible : 'heros' (un héros, lanceur compris), 'monstre', 'tous' (héros ou monstre)
   partout : true si la cible n'a pas besoin d'être visible. */
'use strict';

const Sorts = (() => {
  const GROUPES = [
    { id: 'air', nom: 'Air', symbole: '🌪' },
    { id: 'eau', nom: 'Eau', symbole: '💧' },
    { id: 'feu', nom: 'Feu', symbole: '🔥' },
    { id: 'terre', nom: 'Terre', symbole: '⛰' },
  ];

  const LISTE = [
    { id: 'djinn', groupe: 'air', nom: 'Djinn', cible: 'special', partout: true,
      resume: 'Un génie attaque n’importe quelle figurine avec 5 dés de combat, ou ouvre n’importe quelle porte.' },
    { id: 'tempete', groupe: 'air', nom: 'Tempête', cible: 'tous',
      resume: 'La cible passe son prochain tour.' },
    { id: 'ventVif', groupe: 'air', nom: 'Vent vif', cible: 'heros',
      resume: 'Au prochain déplacement, le héros lance deux fois plus de dés rouges.' },
    { id: 'eauGuerison', groupe: 'eau', nom: 'Eau de guérison', cible: 'heros',
      resume: 'Rend jusqu’à 4 points de Vie.' },
    { id: 'sommeil', groupe: 'eau', nom: 'Sommeil', cible: 'tous',
      resume: 'La cible s’endort (elle résiste avec 1 dé par point d’Esprit : un bouclier annule). Endormie, elle ne bouge pas et ne se défend pas ; elle se réveille sur un 6, à son tour ou quand on l’attaque.' },
    { id: 'brume', groupe: 'eau', nom: 'Voile de brume', cible: 'heros',
      resume: 'Au prochain déplacement, le héros passe par les cases occupées (sans s’y arrêter).' },
    { id: 'bouleFeu', groupe: 'feu', nom: 'Boule de feu', cible: 'tous',
      resume: '2 points de Vie perdus ; la victime lance 2 dés, chaque crâne réduit la perte de 1.' },
    { id: 'courage', groupe: 'feu', nom: 'Courage', cible: 'heros',
      resume: '+2 dés d’attaque tant qu’un monstre est en vue.' },
    { id: 'feuCourroux', groupe: 'feu', nom: 'Le feu du courroux', cible: 'tous', partout: true,
      resume: 'N’importe où : 1 point de Vie perdu, sauf si la victime obtient un bouclier sur 1 dé.' },
    { id: 'traversPierre', groupe: 'terre', nom: 'Au travers de la pierre', cible: 'heros',
      resume: 'Au prochain déplacement, le héros traverse les murs.' },
    { id: 'guerisonCorps', groupe: 'terre', nom: 'Guérison corporelle', cible: 'heros',
      resume: 'Rend jusqu’à 4 points de Vie.' },
    { id: 'peauRoc', groupe: 'terre', nom: 'Une peau de roc', cible: 'heros',
      resume: '+2 dés de défense jusqu’à la première blessure.' },
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
