/* symboles.js — Symboles personnels du plateau (monstres, portes, meubles, pièges, escalier, dés, logo).
   Le CODE ne contient aucune image : l'utilisateur importe un fichier « compagnon-hq/symboles »
   (par ex. symboles-livre.prive.json, découpé dans SES photos de SON livre de quêtes).
   Ce fichier reste sur l'appareil (IndexedDB, réglage « symbolesLivre ») et dans ses sauvegardes ;
   il ne va jamais sur GitHub. Sans fichier, l'application garde ses pictogrammes libres (icones.js).

   Format : { format: 'compagnon-hq/symboles', versionFormat: 1, nom, creeLe,
              images: { cle: { donnees: 'data:image/webp;base64,…' (ou png, jpeg), l, h } } }
   Clés reconnues : voir CLES ci-dessous ; une clé inconnue est ignorée. */
'use strict';

const Symboles = (() => {
  const FORMAT = 'compagnon-hq/symboles';
  const NS = 'http://www.w3.org/2000/svg';
  const CLES = {
    monstre: ['gobelin', 'orque', 'squelette', 'zombie', 'abomination', 'momie', 'guerrierEffroi', 'gargouille', 'sorcierEffroi'],
    meuble: ['table', 'coffre', 'bibliotheque', 'buffet', 'armoire', 'etagere', 'trone', 'cheminee', 'ratelier', 'alchimiste', 'tableSorcier', 'tombeau', 'torture'],
    plateau: ['escalier', 'porte', 'porteSecrete', 'caseObstruee', 'caseObstrueeDouble'],
    piege: ['fosse', 'eboulement', 'lance'],
    divers: ['logo', 'de-crane', 'de-blanc', 'de-noir'],
  };
  const TOUTES = new Set(Object.values(CLES).flat());
  // Le « buffet » du livre sert aussi pour l'armoire et l'étagère si le fichier n'a pas d'image propre.
  const ALIAS = { armoire: 'buffet', etagere: 'buffet' };
  const TAILLE_MAX = 4 * 1024 * 1024; // 4 Mo de texte au plus

  let images = {};
  let actif = false;

  // Pack enregistré (ou null) → symboles utilisés.
  function definir(pack) {
    images = pack?.images && typeof pack.images === 'object' ? pack.images : {};
    actif = !!pack && pack.actif !== false && Object.keys(images).length > 0;
  }

  const image = cle => (actif && (images[cle] || images[ALIAS[cle]])) || null;
  const existe = cle => !!image(cle);
  const src = cle => image(cle)?.donnees || null;

  /* Vérifie un fichier importé ; renvoie { pack } (images reconnues seulement) ou { erreur }. */
  function valider(donnees, tailleTexte = 0) {
    if (tailleTexte > TAILLE_MAX) return { erreur: 'Fichier de symboles trop gros (4 Mo au plus).' };
    if (donnees?.format !== FORMAT) return { erreur: 'Ce fichier n’est pas un fichier de symboles.' };
    if (donnees.versionFormat > 1) return { erreur: 'Ce fichier de symboles vient d’une version plus récente de l’application.' };
    if (!donnees.images || typeof donnees.images !== 'object') return { erreur: 'Le fichier ne contient aucune image.' };
    const gardees = {}, ignorees = [];
    for (const [cle, im] of Object.entries(donnees.images)) {
      const ok = TOUTES.has(cle) && typeof im?.donnees === 'string' && /^data:image\/(webp|png|jpeg);base64,/.test(im.donnees)
        && Number(im.l) > 0 && Number(im.h) > 0;
      if (ok) gardees[cle] = { donnees: im.donnees, l: Number(im.l), h: Number(im.h) };
      else ignorees.push(cle);
    }
    if (!Object.keys(gardees).length) return { erreur: 'Aucune image utilisable dans ce fichier.' };
    return { pack: { format: FORMAT, versionFormat: 1, nom: String(donnees.nom || 'Symboles personnels').slice(0, 80),
      creeLe: donnees.creeLe || null, actif: true, images: gardees }, ignorees };
  }

  function element(parent, cle, x, y, w, h, rotation, classe, aspect) {
    const im = image(cle);
    if (!im) return null;
    const e = document.createElementNS(NS, 'image');
    const cx = x + w / 2, cy = y + h / 2;
    // Pour un quart de tour, l'image est dessinée dans la boîte « couchée » puis tournée.
    const quart = ((rotation % 180) + 180) % 180 === 90;
    const iw = quart ? h : w, ih = quart ? w : h;
    e.setAttribute('href', im.donnees);
    e.setAttribute('x', cx - iw / 2); e.setAttribute('y', cy - ih / 2);
    e.setAttribute('width', iw); e.setAttribute('height', ih);
    e.setAttribute('preserveAspectRatio', aspect);
    if (rotation) e.setAttribute('transform', `rotate(${rotation} ${cx} ${cy})`);
    e.setAttribute('class', classe);
    parent.appendChild(e);
    return e;
  }

  /* Étire l'image sur la boîte (meubles, escalier, cases) ; rotation en degrés (0, 90, 180, 270). */
  const etirer = (parent, cle, x, y, w, h, rotation = 0, classe = 'symbole') =>
    element(parent, cle, x, y, w, h, rotation, classe, 'none');

  /* Image entière, centrée en (cx, cy), dans un carré de côté « taille » (médaillons, lances). */
  const centrer = (parent, cle, cx, cy, taille, rotation = 0, classe = 'symbole') =>
    element(parent, cle, cx - taille / 2, cy - taille / 2, taille, taille, rotation, classe, 'xMidYMid meet');

  return { FORMAT, CLES, definir, existe, src, valider, etirer, centrer, actif: () => actif };
})();
