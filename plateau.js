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
  // - héros dans un couloir : les cases de couloir en ligne de vue,
  //   jusqu'à « portee » cases de distance (règle maison ; Infinity = règle officielle) ;
  // - porte ouverte : les pièces des deux côtés ;
  // - la roche qui touche un couloir bien vu est montrée, pour voir la forme des couloirs.
  //
  // Pénombre (règle maison) : la dernière case vue dans un couloir (distance comprise
  // entre portee − 1 et portee) n'est qu'entrevue. Elle est notée dans etat.penombre
  // avec la direction du regard (du héros vers la case), pour dessiner un fondu vers le noir.
  // Si un héros la voit ensuite de plus près, elle redevient une case bien vue.
  function devoiler(g, etat, portee = Infinity) {
    const vu = new Set(etat.revele);
    const avant = vu.size;
    const penombre = { ...(etat.penombre || {}) };
    const bienVu = i => { vu.add(i); delete penombre[i]; };
    const ajouterPiece = z => (g.pieces[z] || []).forEach(bienVu);
    const fondu = {}; // cases entrevues pendant ce calcul : case → [dx, dy, distance]

    for (const h of etat.heros) {
      if (h.x == null) continue;
      const i = idx(g.L, h.x, h.y), z = g.zones[i];
      bienVu(i);
      if (estPiece(z)) { ajouterPiece(z); continue; }
      g.zones.forEach((zc, c) => {
        if (zc !== '.' || (vu.has(c) && !(c in penombre))) return;
        const cx = c % g.L, cy = Math.floor(c / g.L);
        const d = Math.hypot(cx - h.x, cy - h.y);
        if (d > portee + 1e-9) return;
        if (!ligneDeVue(g, etat, h.x, h.y, cx, cy)) return;
        if (d > portee - 1 + 1e-9) {
          // Case au bord de la vue : garder la vue la plus proche si plusieurs héros l'entrevoient.
          if (!fondu[c] || d < fondu[c][2]) fondu[c] = [(cx - h.x) / d, (cy - h.y) / d, d];
        } else bienVu(c);
      });
    }
    for (const [c, [dx, dy]] of Object.entries(fondu)) {
      if (vu.has(+c) && !(c in penombre)) continue; // déjà bien vue par un autre héros
      vu.add(+c);
      penombre[c] = [Math.round(dx * 100) / 100, Math.round(dy * 100) / 100];
    }

    for (const id of etat.portesOuvertes) {
      const p = (g.quete.portes || []).find(q => q.id === id);
      if (!p) continue;
      for (const [x, y] of [p.a, p.b]) {
        const z = g.zones[idx(g.L, x, y)];
        if (estPiece(z)) ajouterPiece(z); else if (!vu.has(idx(g.L, x, y))) bienVu(idx(g.L, x, y));
      }
    }

    // Roche voisine d'un couloir bien vu.
    for (const i of [...vu]) {
      if (g.zones[i] !== '.' || i in penombre) continue;
      const x = i % g.L, y = Math.floor(i / g.L);
      for (const [vx, vy] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1], [x + 1, y + 1], [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1]]) {
        if (dansPlateau(g, vx, vy) && g.zones[idx(g.L, vx, vy)] === '#') vu.add(idx(g.L, vx, vy));
      }
    }

    etat.revele = [...vu].sort((a, b) => a - b);
    etat.penombre = penombre;

    // Monstres vus (décision du 21/11/2026) : un monstre n'existe pour Zargon qu'une fois
    // aperçu par les héros (case dévoilée, pénombre comprise). Il reste ensuite actif,
    // même s'il repart dans le brouillard. Un monstre jamais vu ne bouge pas.
    for (const m of etat.monstres) {
      if (!m.vu && vu.has(idx(g.L, m.x, m.y))) m.vu = true;
    }
    return vu.size - avant;
  }

  // Dévoile ou cache à la main (vue MJ) : la pièce entière, ou la case de couloir / roche.
  // Une case dévoilée par le MJ est bien vue (pas de pénombre).
  function basculerZone(g, etat, x, y) {
    const i = idx(g.L, x, y), z = g.zones[i];
    const cases = estPiece(z) ? g.pieces[z] : [i];
    const vu = new Set(etat.revele);
    const penombre = { ...(etat.penombre || {}) };
    const cacher = vu.has(i) && !(i in penombre);
    cases.forEach(c => { delete penombre[c]; cacher ? vu.delete(c) : vu.add(c); });
    etat.revele = [...vu].sort((a, b) => a - b);
    etat.penombre = penombre;
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

  /* ---------- Déplacement des héros ---------- */

  // Meuble présent sur la case (x, y), ou undefined.
  function meubleEn(g, x, y) {
    return (g.quete.mobilier || []).find(m => x >= m.x && x < m.x + (m.l || 1) && y >= m.y && y < m.y + (m.h || 1));
  }

  // Un héros peut-il avancer d'une case, de (x, y) vers (nx, ny) ?
  // Renvoie null si oui, sinon la raison en français.
  // Règles : une case à la fois, pas de diagonale ; pas à travers les murs ni les
  // portes fermées (on entre dans une pièce par une porte) ; pas à travers un monstre
  // ou un meuble ; on peut traverser un autre héros (mais pas s'arrêter sur sa case).
  function raisonBlocage(g, etat, x, y, nx, ny) {
    if (!dansPlateau(g, nx, ny)) return 'Hors du plateau.';
    if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) return 'Une case à la fois, sans diagonale : touchez une case voisine du héros.';
    const i = idx(g.L, x, y), j = idx(g.L, nx, ny);
    if (g.zones[j] === '#') return 'Roche : impossible de passer.';
    if (!ouvert(g, etat, i, j)) {
      const p = g.portesParBord[bord(i, j)];
      return p && porteVisible(etat, p) ? 'La porte est fermée : ouvrez-la d’abord.' : 'Un mur bloque le passage.';
    }
    if (etat.monstres.some(m => m.x === nx && m.y === ny)) return 'Un monstre bloque le passage.';
    const meuble = meubleEn(g, nx, ny);
    if (meuble) return `${meuble.nom} : on ne peut pas passer par-dessus.`;
    return null;
  }

  // Autre héros sur la case (x, y) ?
  function autreHerosEn(etat, idHeros, x, y) {
    return etat.heros.find(h => h.id !== idHeros && h.x === x && h.y === y);
  }

  /* ---------- Réglages de vision ---------- */

  // Portée de vue dans les couloirs, d'après les réglages de la partie.
  // 'illimitee' = règle officielle ; sinon un nombre de cases (8 par défaut).
  const PORTEE_DEFAUT = 8;
  function porteeDe(reglages) {
    const v = reglages?.porteeCouloir ?? PORTEE_DEFAUT;
    return v === 'illimitee' ? Infinity : (Number(v) || PORTEE_DEFAUT);
  }

  /* ---------- Début de partie ---------- */

  const HEROS = [
    { id: 'barbare', nom: 'Barbare', court: 'Ba' },
    { id: 'nain', nom: 'Nain', court: 'Na' },
    { id: 'elfe', nom: 'Elfe', court: 'El' },
    { id: 'enchanteur', nom: 'Enchanteur', court: 'En' },
  ];

  function etatInitial(quete, portee = Infinity) {
    const etat = {
      heros: HEROS.map((h, n) => ({ ...h, x: quete.departs[n]?.[0] ?? null, y: quete.departs[n]?.[1] ?? null })),
      monstres: (quete.monstres || []).map(m => ({ ...m })),
      portesOuvertes: [],
      secretesTrouvees: [],
      revele: [],
      penombre: {},
    };
    // L'escalier est toujours visible.
    if (quete.escalier) {
      const L = quete.plateau.largeur, { x, y } = quete.escalier;
      etat.revele.push(idx(L, x, y), idx(L, x + 1, y), idx(L, x, y + 1), idx(L, x + 1, y + 1));
    }
    devoiler(geometrie(quete), etat, portee);
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

  return { geometrie, idx, estPiece, ouvert, mur, ligneDeVue, devoiler, basculerZone, porteVisible, herosAdjacent, etatInitial, verifierQuete, porteeDe, PORTEE_DEFAUT, raisonBlocage, autreHerosEn, meubleEn, HEROS };
})();
