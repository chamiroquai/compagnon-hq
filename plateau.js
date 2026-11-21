/* plateau.js — Géométrie du plateau : zones, murs, portes, ligne de vue, brouillard.
   Ce fichier ne dessine rien : il répond aux questions « peut-on passer ? »,
   « voit-on cette case ? », « que faut-il dévoiler ? ».

   Vocabulaire :
   - case : repérée par (x, y), ou par son numéro i = y × largeur + x ;
   - zone : '.' couloir, '#' roche, une lettre = une pièce ;
   - état : ce qui change pendant la partie (héros, portes ouvertes, cases dévoilées…). */
'use strict';

const Plateau = (() => {

  /* ---------- Préparation d'une quête ---------- */

  // Construit les outils de géométrie pour une quête (calculé une fois, jamais enregistré).
  function geometrie(quete) {
    const L = quete.plateau.largeur, H = quete.plateau.hauteur;
    const zones = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < L; x++) zones.push(quete.plateau.lignes[y][x]);

    // Liste des cases de chaque pièce.
    const pieces = {};
    zones.forEach((z, i) => { if (estPiece(z)) (pieces[z] = pieces[z] || []).push(i); });

    // Portes rangées par « bord » (paire de cases voisines).
    const portesParBord = {};
    for (const p of quete.portes || []) portesParBord[bord(idx(L, ...p.a), idx(L, ...p.b))] = p;

    return { L, H, zones, pieces, portesParBord, quete };
  }

  const idx = (L, x, y) => y * L + x;
  const estPiece = z => z !== '.' && z !== '#';
  const bord = (i, j) => (i < j ? i + '-' + j : j + '-' + i);

  function dansPlateau(g, x, y) { return x >= 0 && y >= 0 && x < g.L && y < g.H; }

  /* ---------- Murs et portes ---------- */

  // Peut-on passer (ou voir) de la case i à la case voisine j ?
  // Oui si j n'est pas de la roche et si i et j sont dans la même zone,
  // ou si une porte ouverte les relie.
  function ouvert(g, etat, i, j) {
    if (g.zones[j] === '#' || g.zones[i] === '#') return false;
    if (g.zones[i] === g.zones[j]) return true;
    const p = g.portesParBord[bord(i, j)];
    return !!p && etat.portesOuvertes.includes(p.id);
  }

  // Y a-t-il un mur entre i et j (pour le dessin) ? Une porte compte comme une ouverture dans le mur.
  function mur(g, i, j) {
    return g.zones[i] !== g.zones[j];
  }

  /* ---------- Ligne de vue ---------- */

  // La ligne va du centre de la case A au centre de la case B.
  // On parcourt les cases traversées une par une. Si la ligne passe exactement
  // par un coin de case, elle reste valide tant qu'un des deux chemins qui
  // contournent ce coin est libre : une ligne qui ne fait que toucher un coin
  // de mur n'est pas bloquée (règle officielle, écart n° 9).
  // Les figurines ne bloquent pas ici : cette fonction sert au dévoilement du plan.
  function ligneDeVue(g, etat, ax, ay, bx, by) {
    let x = ax, y = ay;
    const dx = bx - ax, dy = by - ay;
    const sx = Math.sign(dx), sy = Math.sign(dy);
    const pasX = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
    const pasY = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
    let prochainX = pasX / 2, prochainY = pasY / 2;
    const ici = () => idx(g.L, x, y);

    while (x !== bx || y !== by) {
      const avant = ici();
      if (Math.abs(prochainX - prochainY) < 1e-9) {
        // Passage exact par un coin.
        const c1 = idx(g.L, x + sx, y), c2 = idx(g.L, x, y + sy), d = idx(g.L, x + sx, y + sy);
        const chemin1 = ouvert(g, etat, avant, c1) && ouvert(g, etat, c1, d);
        const chemin2 = ouvert(g, etat, avant, c2) && ouvert(g, etat, c2, d);
        if (!chemin1 && !chemin2) return false;
        x += sx; y += sy; prochainX += pasX; prochainY += pasY;
      } else if (prochainX < prochainY) {
        if (!ouvert(g, etat, avant, idx(g.L, x + sx, y))) return false;
        x += sx; prochainX += pasX;
      } else {
        if (!ouvert(g, etat, avant, idx(g.L, x, y + sy))) return false;
        y += sy; prochainY += pasY;
      }
    }
    return true;
  }

  /* ---------- Brouillard de guerre ---------- */

  // Ajoute à etat.revele tout ce que les héros voient maintenant. Ce qui a été
  // dévoilé le reste. Renvoie le nombre de cases nouvellement dévoilées.
  // - héros dans une pièce : toute la pièce ;
  // - héros dans un couloir : les cases de couloir en ligne de vue ;
  // - porte ouverte : les pièces des deux côtés ;
  // - la roche qui touche un couloir dévoilé est montrée, pour voir la forme des couloirs.
  function devoiler(g, etat) {
    const vu = new Set(etat.revele);
    const avant = vu.size;
    const ajouterPiece = z => (g.pieces[z] || []).forEach(i => vu.add(i));

    for (const h of etat.heros) {
      if (h.x == null) continue;
      const i = idx(g.L, h.x, h.y), z = g.zones[i];
      vu.add(i);
      if (estPiece(z)) { ajouterPiece(z); continue; }
      g.zones.forEach((zc, c) => {
        if (zc !== '.' || vu.has(c)) return;
        if (ligneDeVue(g, etat, h.x, h.y, c % g.L, Math.floor(c / g.L))) vu.add(c);
      });
    }

    for (const id of etat.portesOuvertes) {
      const p = (g.quete.portes || []).find(q => q.id === id);
      if (!p) continue;
      for (const [x, y] of [p.a, p.b]) {
        const z = g.zones[idx(g.L, x, y)];
        if (estPiece(z)) ajouterPiece(z); else vu.add(idx(g.L, x, y));
      }
    }

    // Roche voisine d'un couloir dévoilé.
    for (const i of [...vu]) {
      if (g.zones[i] !== '.') continue;
      const x = i % g.L, y = Math.floor(i / g.L);
      for (const [vx, vy] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1], [x + 1, y + 1], [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1]]) {
        if (dansPlateau(g, vx, vy) && g.zones[idx(g.L, vx, vy)] === '#') vu.add(idx(g.L, vx, vy));
      }
    }

    etat.revele = [...vu].sort((a, b) => a - b);
    return vu.size - avant;
  }

  // Dévoile ou cache à la main (vue MJ) : la pièce entière, ou la case de couloir / roche.
  function basculerZone(g, etat, x, y) {
    const i = idx(g.L, x, y), z = g.zones[i];
    const cases = estPiece(z) ? g.pieces[z] : [i];
    const vu = new Set(etat.revele);
    const cacher = vu.has(i);
    cases.forEach(c => (cacher ? vu.delete(c) : vu.add(c)));
    etat.revele = [...vu].sort((a, b) => a - b);
    return !cacher;
  }

  /* ---------- Portes ---------- */

  // Une porte est-elle visible par les joueurs ? (une porte secrète doit d'abord être trouvée)
  function porteVisible(etat, p) {
    return !p.secrete || etat.secretesTrouvees.includes(p.id);
  }

  // Un héros est-il sur une des deux cases que la porte relie ? (écart n° 12)
  function herosAdjacent(etat, p) {
    return etat.heros.find(h => h.x != null && [p.a, p.b].some(([x, y]) => h.x === x && h.y === y));
  }

  /* ---------- Début de partie ---------- */

  const HEROS = [
    { id: 'barbare', nom: 'Barbare', court: 'Ba' },
    { id: 'nain', nom: 'Nain', court: 'Na' },
    { id: 'elfe', nom: 'Elfe', court: 'El' },
    { id: 'enchanteur', nom: 'Enchanteur', court: 'En' },
  ];

  function etatInitial(quete) {
    const etat = {
      heros: HEROS.map((h, n) => ({ ...h, x: quete.departs[n]?.[0] ?? null, y: quete.departs[n]?.[1] ?? null })),
      monstres: (quete.monstres || []).map(m => ({ ...m })),
      portesOuvertes: [],
      secretesTrouvees: [],
      revele: [],
    };
    // L'escalier est toujours visible.
    if (quete.escalier) {
      const L = quete.plateau.largeur, { x, y } = quete.escalier;
      etat.revele.push(idx(L, x, y), idx(L, x + 1, y), idx(L, x, y + 1), idx(L, x + 1, y + 1));
    }
    devoiler(geometrie(quete), etat);
    return etat;
  }

  /* ---------- Vérification d'une quête (pour les imports) ---------- */

  // Renvoie la liste des problèmes trouvés, en français ; liste vide = quête correcte.
  function verifierQuete(q) {
    const err = [];
    if (!q || q.format !== 'compagnon-hq/quete') return ['ce n’est pas une quête du Compagnon (champ « format »)'];
    const P = q.plateau;
    if (!P || !Number.isInteger(P.largeur) || !Number.isInteger(P.hauteur) || !Array.isArray(P.lignes)) return ['plateau absent ou incomplet'];
    if (P.lignes.length !== P.hauteur) err.push(`le plateau a ${P.lignes.length} lignes au lieu de ${P.hauteur}`);
    P.lignes.forEach((l, y) => { if (typeof l !== 'string' || l.length !== P.largeur) err.push(`ligne ${y} : ${l?.length ?? 0} cases au lieu de ${P.largeur}`); });
    if (err.length) return err;

    const z = (x, y) => (x >= 0 && y >= 0 && x < P.largeur && y < P.hauteur ? P.lignes[y][x] : null);
    const libre = (x, y) => z(x, y) !== null && z(x, y) !== '#';
    const ids = new Set();
    const idUnique = (o, quoi) => { if (!o.id) err.push(`${quoi} sans identifiant`); else if (ids.has(o.id)) err.push(`identifiant en double : ${o.id}`); else ids.add(o.id); };

    for (const p of q.portes || []) {
      idUnique(p, 'porte');
      const [ax, ay] = p.a || [], [bx, by] = p.b || [];
      if (!libre(ax, ay) || !libre(bx, by)) { err.push(`porte ${p.id} : case hors du plateau ou dans la roche`); continue; }
      if (Math.abs(ax - bx) + Math.abs(ay - by) !== 1) err.push(`porte ${p.id} : les deux cases ne sont pas voisines`);
      else if (z(ax, ay) === z(bx, by)) err.push(`porte ${p.id} : les deux cases sont dans la même zone (pas de mur à percer)`);
    }
    for (const m of q.mobilier || []) {
      idUnique(m, 'mobilier');
      for (let dx = 0; dx < (m.l || 1); dx++) for (let dy = 0; dy < (m.h || 1); dy++) {
        if (!libre(m.x + dx, m.y + dy)) { err.push(`mobilier ${m.id} : déborde du plateau ou sur la roche`); dx = 99; break; }
      }
    }
    for (const m of q.monstres || []) {
      idUnique(m, 'monstre');
      if (!libre(m.x, m.y)) err.push(`monstre ${m.id} : case hors du plateau ou dans la roche`);
    }
    if (!Array.isArray(q.departs) || q.departs.length < 1) err.push('aucune case de départ pour les héros');
    else q.departs.forEach(([x, y], n) => { if (!libre(x, y)) err.push(`départ n° ${n + 1} : case invalide`); });
    return err;
  }

  return { geometrie, idx, estPiece, ouvert, mur, ligneDeVue, devoiler, basculerZone, porteVisible, herosAdjacent, etatInitial, verifierQuete, HEROS };
})();
