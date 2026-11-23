/* quete-demo.js — Quête de démonstration ENTIÈREMENT INVENTÉE, pour les essais.
   Elle sert aussi d'exemple du format des quêtes (« compagnon-hq/quete »).

   Plateau : une ligne de texte par rangée, un caractère par case.
     .  = couloir
     #  = roche (case infranchissable)
     A–Z = pièce (toutes les cases de même lettre forment une seule pièce)
   Les murs ne sont pas décrits : il y a un mur partout où deux cases voisines
   n'appartiennent pas à la même zone, sauf là où la quête place une porte.
   Coordonnées : x de 0 (gauche) à largeur−1, y de 0 (haut) à hauteur−1. */
'use strict';

const QUETE_DEMO = {
  format: 'compagnon-hq/quete',
  versionFormat: 1,
  id: 'demo-caves-du-moulin',
  titre: 'Les caves du moulin (démonstration)',
  intro: 'Quête inventée pour les essais. Sous le vieux moulin, des bruits de pas résonnent la nuit. Explorez les caves, puis revenez à l’escalier.',
  plateau: {
    largeur: 26,
    hauteur: 19,
    lignes: [
      '..........................',
      '.AAAAA.BBBBB..CCCCCCDDDDD.',
      '.AAAAA.BBBBB..CCCCCCDDDDD.',
      '.AAAAA.BBBBB..CCCCCCDDDDD.',
      '.AAAAA.BBBBB..CCCCCCDDDDD.',
      '..........................',
      '.EEEE.FFFFF.....GGGGG.HHH.',
      '.EEEE.FFFFF.....GGGGG.HHH.',
      '.EEEE.FFFFF.....GGGGG.HHH.',
      '..........................',
      '.IIIII.JJJJJJJJ.KKKK.LLLL.',
      '.IIIII.JJJJJJJJ.KKKK.LLLL.',
      '.IIIII.JJJJJJJJ.KKKK.LLLL.',
      '.IIIII.JJJJJJJJ.KKKK.LLLL.',
      '..........................',
      '.MMMMM.NNNNN##OOOOOO.PPPP.',
      '.MMMMM.NNNNN##OOOOOO.PPPP.',
      '.MMMMM.NNNNN##OOOOOO.PPPP.',
      '..........................',
    ],
  },
  // Escalier : carré de 2 × 2 cases, repéré par sa case en haut à gauche.
  escalier: { x: 12, y: 6 },
  // Cases de départ des 4 héros (dans l'ordre : Barbare, Nain, Elfe, Enchanteur).
  departs: [[12, 6], [13, 6], [12, 7], [13, 7]],
  // Une porte relie deux cases voisines : a et b.
  portes: [
    { id: 'p1', a: [3, 4], b: [3, 5] },
    { id: 'p2', a: [9, 4], b: [9, 5] },
    { id: 'p3', a: [16, 4], b: [16, 5] },
    { id: 'p4', a: [19, 2], b: [20, 2], secrete: true },
    { id: 'p5', a: [24, 3], b: [25, 3] },
    { id: 'p6', a: [4, 7], b: [5, 7] },
    { id: 'p7', a: [8, 6], b: [8, 5] },
    { id: 'p8', a: [16, 7], b: [15, 7] },
    { id: 'p9', a: [23, 8], b: [23, 9] },
    { id: 'p10', a: [3, 10], b: [3, 9] },
    { id: 'p11', a: [11, 10], b: [11, 9] },
    { id: 'p12', a: [11, 13], b: [11, 14] },
    { id: 'p13', a: [18, 10], b: [18, 9] },
    { id: 'p14', a: [21, 12], b: [20, 12] },
    { id: 'p15', a: [3, 15], b: [3, 14] },
    { id: 'p16', a: [9, 15], b: [9, 14] },
    { id: 'p17', a: [16, 15], b: [16, 14] },
    { id: 'p18', a: [22, 15], b: [22, 14] },
  ],
  // Mobilier : rectangle de l × h cases à partir de (x, y).
  mobilier: [
    // piege : coffre ou meuble piégé, déclenché par une fouille de trésor tant qu'il n'est pas désamorcé.
    { id: 'm1', type: 'coffre', nom: 'Coffre', x: 1, y: 1, l: 1, h: 1, piege: { texte: 'Une aiguille jaillit de la serrure !', degats: 1 } },
    { id: 'm2', type: 'table', nom: 'Table', x: 9, y: 11, l: 3, h: 2 },
    { id: 'm3', type: 'etagere', nom: 'Étagère', x: 15, y: 1, l: 3, h: 1 },
    { id: 'm4', type: 'tombeau', nom: 'Tombeau', x: 17, y: 11, l: 1, h: 2 },
    { id: 'm5', type: 'cheminee', nom: 'Cheminée', x: 2, y: 17, l: 3, h: 1 },
  ],
  // Trésors propres à la quête, par pièce (lettre du plateau) : trouvés par le premier héros
  // qui fouille la pièce. Ailleurs, on pioche une carte trésor.
  tresors: {
    A: { texte: 'Au fond du coffre, sous de vieux chiffons : une bourse bien remplie.', or: 30 },
    J: { texte: 'Sous la table, une dalle descellée cache une petite fiole.', objets: ['Fiole de soin (démonstration)'] },
  },
  // Monstre errant de la quête (cartes « monstre errant » de la pioche).
  monstreErrant: 'orque',
  // Pièges : fosse, bloc (qui tombe) ou lance. Cachés tant qu'une fouille ne les a pas repérés.
  pieges: [
    { id: 't1', type: 'lance', x: 12, y: 2 },
    { id: 't2', type: 'fosse', x: 6, y: 9 },
    { id: 't3', type: 'bloc', x: 20, y: 5 },
    { id: 't4', type: 'fosse', x: 2, y: 12 },
  ],
  // Monstres : type, case. Une figurine peut avoir ses propres caractéristiques,
  // ex. { type: 'sorcierEffroi', x, y, nom: '…', caracs: { deplacement, attaque, defense, corps, esprit } }.
  // Comportement (facultatif) : « chasse » (par défaut : avance vers le héros le plus proche,
  // s'en rapproche au mieux s'il ne peut pas l'atteindre), « garde » (ne bouge pas, attaque
  // au contact) ou « piece » (chasse sans quitter sa pièce). Valeur par défaut de toute la
  // quête : champ « comportementMonstres » à la racine.
  // Ciblage (facultatif) : qui le monstre attaque. Par défaut selon son type : « proche »
  // (squelettes, zombies, momies : le héros le plus proche), « opportuniste » (gobelins :
  // héros isolé, blessé ou mal protégé, puis repli après avoir frappé sans bouger),
  // « menace » (orques, guerriers de la Terreur, abominations, gargouilles : celui qui bloque
  // un passage ou frappe le plus fort), « tactique » (sorcier de la Terreur : lanceur de sorts,
  // porteur d'un objet clé, héros qui tient l'entrée de sa pièce ou héros isolé).
  // Valeur pour toute la quête : « ciblageMonstres » ; objets clés : « objetsCles » (noms).
  monstres: [
    { id: 'mo1', type: 'gobelin', x: 3, y: 2 },
    { id: 'mo2', type: 'orque', x: 9, y: 2 },
    { id: 'mo3', type: 'squelette', x: 17, y: 3 },
    { id: 'mo4', type: 'squelette', x: 22, y: 3 },
    { id: 'mo5', type: 'zombie', x: 2, y: 7 },
    { id: 'mo6', type: 'gobelin', x: 8, y: 7 },
    { id: 'mo7', type: 'gobelin', x: 9, y: 8 },
    { id: 'mo8', type: 'orque', x: 19, y: 7 },
    { id: 'mo9', type: 'momie', x: 24, y: 7 },
    { id: 'mo10', type: 'abomination', x: 3, y: 12 },
    { id: 'mo11', type: 'orque', x: 13, y: 11 },
    { id: 'mo12', type: 'momie', x: 19, y: 12, comportement: 'piece' },
    { id: 'mo13', type: 'guerrierEffroi', x: 23, y: 11, comportement: 'garde' },
    { id: 'mo14', type: 'zombie', x: 9, y: 16 },
    { id: 'mo15', type: 'gargouille', x: 17, y: 16 },
    { id: 'mo16', type: 'orque', x: 23, y: 16 },
  ],
};
