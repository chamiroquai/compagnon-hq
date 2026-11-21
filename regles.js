/* regles.js — Données de règles qui ne dépendent pas du plateau :
   types de figurines, dés de combat, caractéristiques.

   IMPORTANT (confidentialité et propriété) : AUCUNE valeur officielle n'est écrite
   ici. Les caractéristiques des héros et des monstres sont saisies par le joueur
   d'après ses propres cartes, et enregistrées uniquement sur son appareil. */
'use strict';

const Regles = (() => {

  const TYPES_HEROS = [
    { id: 'barbare', nom: 'Barbare' },
    { id: 'nain', nom: 'Nain' },
    { id: 'elfe', nom: 'Elfe' },
    { id: 'enchanteur', nom: 'Enchanteur' },
  ];

  const TYPES_MONSTRES = [
    { id: 'gobelin', nom: 'Gobelin', court: 'Go' },
    { id: 'orque', nom: 'Orque', court: 'Or' },
    { id: 'abomination', nom: 'Abomination', court: 'Ab' },
    { id: 'guerrierEffroi', nom: 'Guerrier de la Terreur', court: 'GT' },
    { id: 'gargouille', nom: 'Gargouille', court: 'Ga' },
    { id: 'squelette', nom: 'Squelette', court: 'Sq' },
    { id: 'zombie', nom: 'Zombie', court: 'Zo' },
    { id: 'momie', nom: 'Momie', court: 'Mo' },
    // Le sorcier est une figurine qui représente différents personnages selon les quêtes :
    // pas de caractéristiques communes dans les Réglages ; la quête les donne pour chaque figurine.
    { id: 'sorcierEffroi', nom: 'Sorcier de la Terreur', court: 'ST', variable: true },
  ];
  const infoMonstre = type => TYPES_MONSTRES.find(t => t.id === type) || { id: type, nom: type, court: String(type).slice(0, 2) };

  // Champs saisis pour chaque type (dans l'ordre d'affichage).
  const CHAMPS_HEROS = [
    { id: 'attaque', nom: 'Dés d’attaque' },
    { id: 'defense', nom: 'Dés de défense' },
    { id: 'corps', nom: 'Points de Vie' },
    { id: 'esprit', nom: 'Points d’Esprit' },
  ];
  const CHAMPS_MONSTRES = [
    { id: 'deplacement', nom: 'Déplacement (cases)' },
    { id: 'attaque', nom: 'Dés d’attaque' },
    { id: 'defense', nom: 'Dés de défense' },
    { id: 'corps', nom: 'Points de Vie' },
    { id: 'esprit', nom: 'Points d’Esprit' },
  ];

  /* ---------- Dés de combat ----------
     Un dé de combat a 6 faces : 3 crânes, 2 boucliers blancs, 1 bouclier noir.
     (Répartition à vérifier sur vos dés.)
     Seuls les dés des MONSTRES sont lancés par l'application ;
     les joueurs lancent eux-mêmes les dés des héros. */
  const FACES = ['crane', 'crane', 'crane', 'blanc', 'blanc', 'noir'];
  const SYMBOLE = { crane: '💀', blanc: '🛡️', noir: '⚫' };

  // Lance n dés de combat ; renvoie la liste des faces obtenues.
  function lancer(n) {
    const tirage = [];
    for (let k = 0; k < n; k++) {
      // crypto.getRandomValues : hasard de bonne qualité, disponible sur Safari.
      const r = new Uint32Array(1);
      crypto.getRandomValues(r);
      tirage.push(FACES[r[0] % 6]);
    }
    return tirage;
  }
  const compter = (tirage, face) => tirage.filter(f => f === face).length;
  const afficher = tirage => tirage.map(f => SYMBOLE[f]).join(' ');

  /* ---------- Caractéristiques saisies ---------- */

  // Types de monstres dont les caractéristiques se règlent une fois pour toutes (Réglages).
  const TYPES_MONSTRES_REGLES = TYPES_MONSTRES.filter(t => !t.variable);

  function caracsVides() {
    return {
      heros: Object.fromEntries(TYPES_HEROS.map(t => [t.id, {}])),
      monstres: Object.fromEntries(TYPES_MONSTRES_REGLES.map(t => [t.id, {}])),
    };
  }

  // Valeur saisie, ou null si elle manque.
  function valeur(caracs, famille, type, champ) {
    const v = caracs?.[famille]?.[type]?.[champ];
    return Number.isFinite(v) ? v : null;
  }

  // Caractéristique d'UN monstre : celle donnée par la quête pour cette figurine
  // (champ « caracs »), sinon celle de son type dans les Réglages.
  function valeurMonstre(caracs, monstre, champ) {
    const v = monstre?.caracs?.[champ];
    return Number.isFinite(v) ? v : valeur(caracs, 'monstres', monstre.type, champ);
  }

  // Liste lisible des valeurs manquantes pour un type (vide = complet).
  function manquantes(caracs, famille, type) {
    const champs = famille === 'heros' ? CHAMPS_HEROS : CHAMPS_MONSTRES;
    return champs.filter(c => valeur(caracs, famille, type, c.id) === null).map(c => c.nom);
  }

  return { TYPES_HEROS, TYPES_MONSTRES, TYPES_MONSTRES_REGLES, valeurMonstre, infoMonstre, CHAMPS_HEROS, CHAMPS_MONSTRES, lancer, compter, afficher, caracsVides, valeur, manquantes };
})();
