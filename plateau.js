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
    // Un bloc tombé est un mur : on ne passe pas et on ne voit pas à travers.
    if (eboulementEn(etat, j % g.L, Math.floor(j / g.L)) || eboulementEn(etat, i % g.L, Math.floor(i / g.L))) return false;
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
  // obstacles (facultatif) : ensemble de numéros de cases occupées par des figurines,
  // qui bloquent la ligne (sauf la case d'arrivée) — pour viser avec un sort.
  function ligneDeVue(g, etat, ax, ay, bx, by, obstacles = null) {
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
        if (obstacles && obstacles.has(ici()) && (x !== bx || y !== by)) return false;
      } else if (prochainX < prochainY) {
        if (!ouvert(g, etat, avant, idx(g.L, x + sx, y))) return false;
        x += sx; prochainX += pasX;
        if (obstacles && obstacles.has(ici()) && (x !== bx || y !== by)) return false;
      } else {
        if (!ouvert(g, etat, avant, idx(g.L, x, y + sy))) return false;
        y += sy; prochainY += pasY;
        if (obstacles && obstacles.has(ici()) && (x !== bx || y !== by)) return false;
      }
    }
    return true;
  }

  /* ---------- Trajectoire d'un tir (armes à distance, armes lancées, sorts) ----------
     Règles de l'utilisateur (23/11/2026) : la ligne va du centre de la case du tireur au centre
     de la case visée. Murs, portes fermées, éboulements et meubles l'arrêtent ; passer exactement
     par un coin (de mur ou de meuble) est permis tant qu'un des deux côtés du coin est libre.
     La première figurine rencontrée reçoit le tir, quelle qu'elle soit (interception).
     occupees : Map numéro de case → figurine ({ genre, id }) ; la case du tireur n'y est pas.
     Renvoie null si le tir est impossible, sinon le numéro de la case touchée.
     (La ligne de vue du brouillard, plus haut, reste inchangée : les meubles n'y cachent rien.) */
  function trajectoireTir(g, etat, ax, ay, bx, by, occupees = new Map()) {
    let x = ax, y = ay;
    const dx = bx - ax, dy = by - ay;
    const sx = Math.sign(dx), sy = Math.sign(dy);
    const pasX = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
    const pasY = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
    let prochainX = pasX / 2, prochainY = pasY / 2;
    const meuble = i => !!meubleEn(g, i % g.L, Math.floor(i / g.L));
    const passe = (i, j) => ouvert(g, etat, i, j) && !meuble(j);
    while (x !== bx || y !== by) {
      const avant = idx(g.L, x, y);
      if (Math.abs(prochainX - prochainY) < 1e-9) {
        const c1 = idx(g.L, x + sx, y), c2 = idx(g.L, x, y + sy), d = idx(g.L, x + sx, y + sy);
        // Les murs se rejoignent au coin : la ligne passe entre deux côtés fermés.
        const libre1 = ouvert(g, etat, avant, c1) && ouvert(g, etat, c1, d) && !meuble(c1);
        const libre2 = ouvert(g, etat, avant, c2) && ouvert(g, etat, c2, d) && !meuble(c2);
        if (!libre1 && !libre2) return null;
        x += sx; y += sy; prochainX += pasX; prochainY += pasY;
        if (meuble(d)) return null;
      } else if (prochainX < prochainY) {
        if (!passe(avant, idx(g.L, x + sx, y))) return null;
        x += sx; prochainX += pasX;
      } else {
        if (!passe(avant, idx(g.L, x, y + sy))) return null;
        y += sy; prochainY += pasY;
      }
      const ici = idx(g.L, x, y);
      if (occupees.has(ici)) return ici;
    }
    return idx(g.L, bx, by);
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

  // Le héros h est-il devant la porte, c.-à-d. sur une des deux cases qu'elle relie ?
  // Une case en diagonale ne compte pas (écart n° 12, confirmé le 23/11/2026).
  function devantPorte(h, p) {
    return !!h && h.x != null && [p.a, p.b].some(([x, y]) => h.x === x && h.y === y);
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
    // Passage secret connu : on l'emprunte en un pas, d'une extrémité à l'autre.
    if (passageEntre(g, etat, x, y, nx, ny)) {
      if (etat.monstres.some(m => m.x === nx && m.y === ny)) return 'Un monstre bloque la sortie du passage.';
      const meubleSortie = meubleEn(g, nx, ny);
      return meubleSortie ? `${meubleSortie.nom} bloque la sortie du passage.` : null;
    }
    if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) return 'Une case à la fois, sans diagonale : touchez une case voisine du héros.';
    const i = idx(g.L, x, y), j = idx(g.L, nx, ny);
    if (g.zones[j] === '#') return 'Roche : impossible de passer.';
    if (!ouvert(g, etat, i, j)) {
      const p = g.portesParBord[bord(i, j)];
      return p && porteVisible(etat, p) ? 'La porte est fermée : ouvrez-la d’abord.' : 'Un mur bloque le passage.';
    }
    if (eboulementEn(etat, nx, ny)) return 'Un éboulement bloque le passage pour toujours.';
    if (etat.monstres.some(m => m.x === nx && m.y === ny)) return 'Un monstre bloque le passage.';
    const meuble = meubleEn(g, nx, ny);
    if (meuble) return `${meuble.nom} : on ne peut pas passer par-dessus.`;
    return null;
  }

  // Autre héros sur la case (x, y) ?
  function autreHerosEn(etat, idHeros, x, y) {
    return etat.heros.find(h => h.id !== idHeros && h.x === x && h.y === y);
  }

  /* ---------- Déplacement des monstres (tour de Zargon) ---------- */

  // Règles : une case à la fois, sans diagonale ; les monstres n'ouvrent pas les portes
  // (porte fermée = mur) ; pas à travers la roche, les meubles ni les héros ;
  // ils peuvent traverser un autre monstre mais pas s'arrêter sur sa case.
  // zone (facultatif) : le monstre ne quitte pas cette zone (comportement « piece »).
  function passageMonstre(g, etat, i, j, zone = null) {
    if (g.zones[j] === '#') return false;
    if (zone !== null && g.zones[j] !== zone) return false;
    if (!ouvert(g, etat, i, j)) return false;
    const x = j % g.L, y = Math.floor(j / g.L);
    if (meubleEn(g, x, y)) return false;
    if (eboulementEn(etat, x, y)) return false;
    if (etat.heros.some(h => h.x === x && h.y === y && h.corps !== 0)) return false;
    return true;
  }

  function voisins(g, i) {
    const x = i % g.L, y = Math.floor(i / g.L), v = [];
    if (x > 0) v.push(i - 1);
    if (x < g.L - 1) v.push(i + 1);
    if (y > 0) v.push(i - g.L);
    if (y < g.H - 1) v.push(i + g.L);
    return v;
  }

  // Comportements possibles d'un monstre (décision du 22/11/2026), réglables par la quête :
  // champ « comportement » du monstre, sinon « comportementMonstres » de la quête, sinon « chasse ».
  //  - chasse : avance vers le héros le plus proche ; s'il ne peut pas l'atteindre, s'en rapproche ;
  //  - garde  : ne bouge jamais, attaque un héros qui vient à son contact ;
  //  - piece  : comme « chasse », sans jamais quitter la zone (pièce ou couloir) où la quête l'a placé.
  const COMPORTEMENTS = ['chasse', 'garde', 'piece'];
  function comportementDe(g, monstre) {
    const c = monstre.comportement || g.quete.comportementMonstres;
    return COMPORTEMENTS.includes(c) ? c : 'chasse';
  }

  /* Choix de la cible (demande de l'utilisateur du 23/11/2026) : chaque monstre a un
     « ciblage », d'après son type, modifiable par la quête (champ « ciblage » du monstre,
     sinon « ciblageMonstres » à la racine, sinon la valeur de son type) :
     - proche       : le héros le plus proche qu'il peut atteindre (morts-vivants) ;
     - menace       : parmi les héros qu'il peut attaquer le plus tôt, celui qui bloque un
                      passage, puis celui qui frappe le plus fort, puis le plus proche
                      (orques, guerriers de la Terreur, abominations, gargouilles) ;
     - opportuniste : parmi les héros qu'il peut attaquer le plus tôt, le plus isolé,
                      blessé ou mal protégé ; s'il frappe sans avoir bougé, il se replie
                      ensuite hors de portée des héros (gobelins) ;
     - tactique     : accepte un tour de marche en plus pour viser le lanceur de sorts,
                      le porteur d'un objet clé, le héros qui tient l'entrée de sa pièce
                      ou un héros isolé (sorcier de la Terreur). */
  const CIBLAGES = ['proche', 'menace', 'opportuniste', 'tactique'];
  const CIBLAGE_PAR_TYPE = {
    squelette: 'proche', zombie: 'proche', momie: 'proche',
    gobelin: 'opportuniste',
    orque: 'menace', guerrierEffroi: 'menace', abomination: 'menace', gargouille: 'menace',
    sorcierEffroi: 'tactique',
  };
  function ciblageDe(g, monstre) {
    const c = monstre.ciblage || g.quete.ciblageMonstres || CIBLAGE_PAR_TYPE[monstre.type];
    return CIBLAGES.includes(c) ? c : 'proche';
  }

  // Ce qui rend un héros intéressant pour un monstre. infos(h) (facultatif, fourni par
  // l'écran de jeu) donne { attaque, defense } avec l'équipement.
  function profilHeros(g, etat, h, vivants, monstre, infos) {
    const i = idx(g.L, h.x, h.y);
    const inf = (infos && infos(h)) || {};
    const autres = vivants.filter(k => k.id !== h.id);
    const isole = !autres.some(k => Math.abs(k.x - h.x) + Math.abs(k.y - h.y) <= 2);
    const blesse = Number.isFinite(h.corps) && Number.isFinite(h.corpsMax) && h.corps < h.corpsMax;
    const defenses = vivants.map(k => ((infos && infos(k)) || {}).defense).filter(Number.isFinite);
    const malProtege = Number.isFinite(inf.defense) && defenses.length > 1 && inf.defense === Math.min(...defenses);
    const lanceur = ((etat.sorts || {})[h.id] || []).some(s => !s.utilise);
    const cles = (g.quete.objetsCles || []).map(n => String(n).toLowerCase());
    const porteNom = nom => cles.some(n => String(nom || '').toLowerCase().includes(n));
    const porteCle = cles.length > 0 && ((h.inventaire || []).some(o => porteNom(o.nom))
      || objetsPortes(g.quete, etat, h.id).some(o => porteNom(o.nom)));
    // Sur une case d'une porte ouverte : il bloque un passage ; si c'est une porte de la
    // pièce où se trouve le monstre, il en tient l'entrée.
    const portes = (g.quete.portes || []).filter(p => (!p.secrete || (etat.secretesTrouvees || []).includes(p.id))
      && (etat.portesOuvertes || []).includes(p.id) && [p.a, p.b].some(([x, y]) => x === h.x && y === h.y));
    const zoneM = g.zones[idx(g.L, monstre.x, monstre.y)];
    const tientPiece = estPiece(zoneM) && portes.some(p => [p.a, p.b].some(([x, y]) => g.zones[idx(g.L, x, y)] === zoneM));
    // Couloir d'une case de large : au plus deux cases voisines praticables.
    const etroit = g.zones[i] === '.' && voisins(g, i).filter(v => g.zones[v] !== '#' && ouvert(g, etat, i, v) && !meubleEn(g, v % g.L, Math.floor(v / g.L))).length <= 2;
    return { isole, blesse, malProtege, lanceur, porteCle, tientPiece, bloque: portes.length > 0 || etroit, attaque: Number.isFinite(inf.attaque) ? inf.attaque : 0 };
  }

  // Parmi les héros atteignables (pas = nombre de pas jusqu'à une case d'où l'attaquer),
  // celui que vise le monstre selon son ciblage. Renvoie l'id du héros.
  function choisirCible(g, etat, monstre, portee, atteignables, vivants, infos) {
    const tours = a => (a.pas <= portee ? 0 : Math.ceil((a.pas - portee) / Math.max(1, portee)));
    const ordre = a => vivants.indexOf(a.h);
    const parPas = (a, b) => a.pas - b.pas || ordre(a) - ordre(b);
    const ciblage = ciblageDe(g, monstre);
    if (ciblage === 'proche') return atteignables.slice().sort(parPas)[0].h.id;
    const min = Math.min(...atteignables.map(tours));
    const marge = ciblage === 'tactique' ? 1 : 0;
    const candidats = atteignables.filter(a => tours(a) <= min + marge)
      .map(a => ({ ...a, p: profilHeros(g, etat, a.h, vivants, monstre, infos) }));
    const note = a => {
      const p = a.p;
      if (ciblage === 'menace') return (p.bloque ? 100 : 0) + p.attaque;
      if (ciblage === 'opportuniste') return (p.isole ? 3 : 0) + (p.blesse ? 2 : 0) + (p.malProtege ? 2 : 0);
      return (p.lanceur ? 3 : 0) + (p.porteCle ? 3 : 0) + (p.tientPiece ? 2 : 0) + (p.isole ? 2 : 0) + (p.blesse ? 1 : 0);
    };
    candidats.sort((a, b) => note(b) - note(a) || parPas(a, b));
    return candidats[0].h.id;
  }

  // Plan d'un monstre : choisit sa cible (ciblage ci-dessus) parmi les héros vivants qu'il
  // peut atteindre, puis avance vers la case libre la plus proche d'où l'attaquer
  // (case voisine, sans mur entre eux).
  // Renvoie { chemin: [[x,y]…] (sans la case de départ), cible: id du héros ou null,
  //           atteint: true si le monstre pourra attaquer ce tour-ci,
  //           vise: id du héros choisi, même s'il ne l'atteint pas ce tour-ci,
  //           repli: true si, après avoir frappé sans bouger, il se repliera (gobelins) }.
  function planMonstre(g, etat, monstre, portee, infos = null) {
    const depart = idx(g.L, monstre.x, monstre.y);
    const vivants = etat.heros.filter(h => h.x != null && h.corps !== 0);
    const occupeeParMonstre = c => etat.monstres.some(m => m.id !== monstre.id && idx(g.L, m.x, m.y) === c);
    const attaquables = c => vivants
      .filter(h => voisins(g, c).includes(idx(g.L, h.x, h.y)) && ouvert(g, etat, c, idx(g.L, h.x, h.y)));

    const comportement = comportementDe(g, monstre);
    // « garde » : ne bouge jamais ; attaque seulement au contact.
    if (comportement === 'garde') {
      const ici = attaquables(depart);
      if (!ici.length) return { chemin: [], cible: null, atteint: false };
      const id = choisirCible(g, etat, monstre, 0, ici.map(h => ({ h, pas: 0, c: depart })), vivants, infos);
      return { chemin: [], cible: id, atteint: true };
    }
    // « piece » : zone de la case où la quête a posé le monstre (monstre errant : sa zone actuelle).
    const origine = (g.quete.monstres || []).find(q => q.id === monstre.id) || monstre;
    const zone = comportement === 'piece' ? g.zones[idx(g.L, origine.x, origine.y)] : null;

    // Parcours en largeur complet : pour chaque héros, la case d'attaque la plus proche.
    const precedent = new Map([[depart, null]]);
    const pas = new Map([[depart, 0]]);
    const meilleur = new Map(); // id du héros → { h, pas, c }
    for (let k = 0, file = [depart]; k < file.length; k++) {
      const c = file[k];
      if (c === depart || !occupeeParMonstre(c)) {
        for (const h of attaquables(c)) if (!meilleur.has(h.id)) meilleur.set(h.id, { h, pas: pas.get(c), c });
      }
      for (const v of voisins(g, c)) {
        if (precedent.has(v) || !passageMonstre(g, etat, c, v, zone)) continue;
        precedent.set(v, c);
        pas.set(v, pas.get(c) + 1);
        file.push(v);
      }
    }
    if (!meilleur.size) return planRapprochement(g, etat, monstre, portee, vivants, occupeeParMonstre, zone);

    const cible = choisirCible(g, etat, monstre, portee, [...meilleur.values()], vivants, infos);
    const but = meilleur.get(cible).c;
    // Chemin complet, puis limité à la portée ; on recule si la case d'arrivée est occupée.
    const complet = [];
    for (let c = but; c !== depart; c = precedent.get(c)) complet.unshift(c);
    let n = Math.min(portee, complet.length);
    while (n > 0 && occupeeParMonstre(complet[n - 1])) n--;
    const chemin = complet.slice(0, n);
    const arrivee = n ? chemin[n - 1] : depart;
    const ici = attaquables(arrivee);
    // Pas encore au contact de sa cible : il frappe en passant un autre héros à sa portée.
    let id = ici.some(h => h.id === cible) ? cible : null;
    if (!id && ici.length) id = choisirCible(g, etat, monstre, 0, ici.map(h => ({ h, pas: 0, c: arrivee })), vivants, infos);
    return {
      chemin: chemin.map(c => [c % g.L, Math.floor(c / g.L)]),
      cible: id,
      atteint: !!id,
      vise: cible,
      repli: !!id && !chemin.length && ciblageDe(g, monstre) === 'opportuniste',
    };
  }

  // Repli après une attaque (gobelins) : dans la limite de son déplacement, le monstre
  // gagne la case libre la plus éloignée des héros, hors de leur contact. Chemin vide
  // s'il ne trouve aucune case hors de contact.
  function planRepli(g, etat, monstre, portee) {
    const depart = idx(g.L, monstre.x, monstre.y);
    const vivants = etat.heros.filter(h => h.x != null && h.corps !== 0);
    if (!vivants.length || portee <= 0) return [];
    const comportement = comportementDe(g, monstre);
    if (comportement === 'garde') return [];
    const origine = (g.quete.monstres || []).find(q => q.id === monstre.id) || monstre;
    const zone = comportement === 'piece' ? g.zones[idx(g.L, origine.x, origine.y)] : null;
    const occupee = c => etat.monstres.some(m => m.id !== monstre.id && idx(g.L, m.x, m.y) === c);
    const auContact = c => vivants.some(h => voisins(g, c).includes(idx(g.L, h.x, h.y)) && ouvert(g, etat, c, idx(g.L, h.x, h.y)));
    const eloignement = c => Math.min(...vivants.map(h => Math.abs(h.x - c % g.L) + Math.abs(h.y - Math.floor(c / g.L))));
    const precedent = new Map([[depart, null]]), pas = new Map([[depart, 0]]);
    let meilleure = null;
    for (let k = 0, file = [depart]; k < file.length; k++) {
      const c = file[k];
      if (c !== depart && !occupee(c) && !auContact(c)) {
        if (meilleure === null || eloignement(c) > eloignement(meilleure)
          || (eloignement(c) === eloignement(meilleure) && pas.get(c) < pas.get(meilleure))) meilleure = c;
      }
      if (pas.get(c) >= portee) continue;
      for (const v of voisins(g, c)) {
        if (precedent.has(v) || !passageMonstre(g, etat, c, v, zone)) continue;
        precedent.set(v, c); pas.set(v, pas.get(c) + 1); file.push(v);
      }
    }
    if (meilleure === null) return [];
    const chemin = [];
    for (let c = meilleure; c !== depart; c = precedent.get(c)) chemin.unshift([c % g.L, Math.floor(c / g.L)]);
    return chemin;
  }

  // Distance « idéale » de chaque case au héros vivant le plus proche, comme si les
  // obstacles passagers n'existaient pas : les portes connues comptent comme ouvertes,
  // les figurines ne bloquent pas ; la roche, les murs, les meubles et les éboulements, si.
  // Sert à savoir de quel côté se rapprocher quand aucun chemin libre n'existe.
  function distancesIdeales(g, etat, vivants) {
    const dist = new Map();
    const file = [];
    for (const h of vivants) {
      const c = idx(g.L, h.x, h.y);
      if (!dist.has(c)) { dist.set(c, 0); file.push(c); }
    }
    const passable = (i, j) => {
      if (g.zones[i] === '#' || g.zones[j] === '#') return false;
      const x = j % g.L, y = Math.floor(j / g.L);
      if (eboulementEn(etat, x, y) || meubleEn(g, x, y)) return false;
      if (g.zones[i] === g.zones[j]) return true;
      const p = g.portesParBord[bord(i, j)];
      return !!p && porteVisible(etat, p);
    };
    for (let k = 0; k < file.length; k++) {
      const c = file[k];
      for (const v of voisins(g, c)) {
        if (dist.has(v) || !passable(c, v)) continue;
        dist.set(v, dist.get(c) + 1);
        file.push(v);
      }
    }
    return dist;
  }

  // Aucun héros atteignable (porte fermée, passage bouché…) : le monstre contourne
  // ce qu'il peut et s'arrête, dans la limite de son déplacement, sur la case libre
  // la plus proche d'un héros (décision du 22/11/2026). S'il ne gagne rien, il reste.
  function planRapprochement(g, etat, monstre, portee, vivants, occupeeParMonstre, zone = null) {
    const rien = { chemin: [], cible: null, atteint: false };
    if (!vivants.length || portee <= 0) return rien;
    const depart = idx(g.L, monstre.x, monstre.y);
    const ideale = distancesIdeales(g, etat, vivants);
    const manhattan = c => Math.min(...vivants.map(h => Math.abs(h.x - c % g.L) + Math.abs(h.y - Math.floor(c / g.L))));
    // Note d'une case : distance idéale si un trajet existe, sinon distance à vol d'oiseau (pénalisée).
    const note = c => ideale.has(c) ? ideale.get(c) : 1000 + manhattan(c);

    const precedent = new Map([[depart, null]]);
    const pas = new Map([[depart, 0]]);
    const file = [depart];
    let meilleure = depart;
    for (let k = 0; k < file.length; k++) {
      const c = file[k];
      if (c !== depart && !occupeeParMonstre(c)) {
        // Plus proche du héros d'abord ; à égalité, le trajet le plus court.
        if (note(c) < note(meilleure) || (note(c) === note(meilleure) && meilleure !== depart && pas.get(c) < pas.get(meilleure))) meilleure = c;
      }
      if (pas.get(c) >= portee) continue;
      for (const v of voisins(g, c)) {
        if (precedent.has(v) || !passageMonstre(g, etat, c, v, zone)) continue;
        precedent.set(v, c);
        pas.set(v, pas.get(c) + 1);
        file.push(v);
      }
    }
    if (meilleure === depart) return rien;
    const chemin = [];
    for (let c = meilleure; c !== depart; c = precedent.get(c)) chemin.unshift([c % g.L, Math.floor(c / g.L)]);
    return { chemin, cible: null, atteint: false };
  }

  /* ---------- Pièges et fouilles ---------- */

  // Piège encore actif sur la case (pas désamorcé, pas une lance déjà partie), ou undefined.
  function piegeEn(etat, x, y) {
    return (etat.pieges || []).find(p => p.x === x && p.y === y);
  }
  // Bloc tombé : la case est bloquée pour toujours (héros et monstres).
  function eboulementEn(etat, x, y) {
    return (etat.pieges || []).some(p => p.type === 'bloc' && p.declenche && p.x === x && p.y === y);
  }
  // Fosse ouverte sur la case : −1 dé d'attaque et de défense (minimum 1) pour qui s'y trouve.
  function fosseEn(etat, x, y) {
    return (etat.pieges || []).some(p => p.type === 'fosse' && p.declenche && p.x === x && p.y === y);
  }

  // Cases concernées par une fouille du héros (principe de visibilité) :
  // dans une pièce, toute la pièce ; dans un couloir, les cases de couloir
  // qu'il voit en ce moment (ligne de vue et portée).
  function casesFouillables(g, etat, h, portee = Infinity) {
    const i = idx(g.L, h.x, h.y), z = g.zones[i];
    if (estPiece(z)) return new Set(g.pieces[z]);
    const res = new Set([i]);
    g.zones.forEach((zc, c) => {
      if (zc !== '.') return;
      const cx = c % g.L, cy = Math.floor(c / g.L);
      if (Math.hypot(cx - h.x, cy - h.y) > portee + 1e-9) return;
      if (ligneDeVue(g, etat, h.x, h.y, cx, cy)) res.add(c);
    });
    return res;
  }

  // Portes secrètes trouvées par la fouille (une des deux cases dans la zone fouillée).
  function fouillerPortes(g, etat, h, portee) {
    const zone = casesFouillables(g, etat, h, portee), cmd = commandes(g);
    return (g.quete.portes || []).filter(p => p.secrete && !cmd.has(p.id) && !etat.secretesTrouvees.includes(p.id)
      && [p.a, p.b].some(([x, y]) => zone.has(idx(g.L, x, y)))).map(p => p.id);
  }

  /* Zone de la fouille de pièges. Dérogation (règle maison du 22/11/2026) : un héros posé sur
     la case devant une porte ouverte fouille aussi l'autre côté — la pièce entière vue depuis
     le couloir, ou le couloir (dans sa ligne de vue, depuis la case de l'autre côté) vu depuis
     la pièce. Seules les cases déjà dévoilées comptent (principe de visibilité).
     Renvoie { zone, auDela } : auDela = nombre de portes ainsi utilisées. */
  function casesFouillablesPieges(g, etat, h, portee = Infinity) {
    const zone = casesFouillables(g, etat, h, portee);
    const ici = idx(g.L, h.x, h.y), revele = new Set(etat.revele || []);
    let auDela = 0;
    for (const p of g.quete.portes || []) {
      const ia = idx(g.L, ...p.a), ib = idx(g.L, ...p.b);
      if (ici !== ia && ici !== ib) continue;
      if (!ouvert(g, etat, ia, ib)) continue;
      const autre = ici === ia ? ib : ia;
      if (g.zones[autre] === g.zones[ici]) continue;
      const ax = autre % g.L, ay = Math.floor(autre / g.L);
      const cote = estPiece(g.zones[autre]) ? g.pieces[g.zones[autre]] : casesFouillables(g, etat, { x: ax, y: ay }, portee);
      let ajout = 0;
      for (const c of cote) if (revele.has(c) && !zone.has(c)) { zone.add(c); ajout++; }
      if (ajout || revele.has(autre)) auDela++;
    }
    return { zone, auDela };
  }

  // Pièges repérés par la fouille (pas encore connus, dans la zone fouillée, dérogation des portes comprise).
  function fouillerPieges(g, etat, h, portee) {
    const { zone } = casesFouillablesPieges(g, etat, h, portee);
    return (etat.pieges || []).filter(p => !p.trouve && !p.declenche && zone.has(idx(g.L, p.x, p.y))).map(p => p.id);
  }

  /* ---------- Passages secrets et interrupteurs (v0.27.0) ----------
     Passage : relie deux cases éloignées (« a » et « b ») ; une fois connu, un héros posé
     sur une extrémité passe à l'autre en un pas. Interrupteur : caché ; une fouille de pièges
     le repère ; un héros qui marche dessus ensuite l'actionne, ce qui révèle les passages et
     portes secrètes qu'il commande (champ « active »). Un passage ou une porte secrète commandé
     par un interrupteur ne se trouve pas par la fouille ; un passage libre se trouve par la
     fouille des portes secrètes, comme une porte. */

  // Identifiants (passages et portes) commandés par un interrupteur de la quête.
  function commandes(g) {
    return new Set((g.quete.interrupteurs || []).flatMap(t => t.active || []));
  }
  function passageConnu(etat, id) { return (etat.passagesTrouves || []).includes(id); }
  // Passage connu reliant (x, y) à (nx, ny), ou undefined.
  function passageEntre(g, etat, x, y, nx, ny) {
    return (g.quete.passages || []).find(p => passageConnu(etat, p.id)
      && ((p.a[0] === x && p.a[1] === y && p.b[0] === nx && p.b[1] === ny) || (p.b[0] === x && p.b[1] === y && p.a[0] === nx && p.a[1] === ny)));
  }
  // Autres extrémités des passages connus dont une extrémité est en (x, y).
  function sortiesPassage(g, etat, x, y) {
    const res = [];
    for (const p of g.quete.passages || []) {
      if (!passageConnu(etat, p.id)) continue;
      if (p.a[0] === x && p.a[1] === y) res.push(p.b);
      else if (p.b[0] === x && p.b[1] === y) res.push(p.a);
    }
    return res;
  }
  // Passages libres (non commandés) trouvés par une fouille des portes secrètes.
  function fouillerPassages(g, etat, h, portee) {
    const zone = casesFouillables(g, etat, h, portee), cmd = commandes(g);
    return (g.quete.passages || []).filter(p => !cmd.has(p.id) && !passageConnu(etat, p.id)
      && [p.a, p.b].some(([x, y]) => zone.has(idx(g.L, x, y)))).map(p => p.id);
  }
  // Interrupteurs repérés par une fouille de pièges (même zone que les pièges).
  function fouillerInterrupteurs(g, etat, h, portee) {
    const { zone } = casesFouillablesPieges(g, etat, h, portee);
    return (g.quete.interrupteurs || []).filter(t => !etat.interrupteurs?.[t.id]?.trouve
      && zone.has(idx(g.L, t.x, t.y))).map(t => t.id);
  }
  // Interrupteur repéré mais pas encore actionné, sur la case (x, y), ou undefined.
  function interrupteurPret(g, etat, x, y) {
    return (g.quete.interrupteurs || []).find(t => t.x === x && t.y === y
      && etat.interrupteurs?.[t.id]?.trouve && !etat.interrupteurs[t.id].active);
  }
  // Actionne l'interrupteur (modifie l'état). Renvoie { passages, portes } : ce qui vient d'apparaître.
  function actionnerInterrupteur(g, etat, id) {
    const t = (g.quete.interrupteurs || []).find(k => k.id === id);
    etat.interrupteurs = etat.interrupteurs || {};
    etat.interrupteurs[id] = { ...etat.interrupteurs[id], trouve: true, active: true };
    etat.passagesTrouves = etat.passagesTrouves || [];
    const res = { passages: [], portes: [] };
    for (const cible of t?.active || []) {
      if ((g.quete.passages || []).some(p => p.id === cible)) {
        if (!etat.passagesTrouves.includes(cible)) { etat.passagesTrouves.push(cible); res.passages.push(cible); }
      } else if ((g.quete.portes || []).some(p => p.id === cible && p.secrete)) {
        if (!etat.secretesTrouvees.includes(cible)) { etat.secretesTrouvees.push(cible); res.portes.push(cible); }
      }
    }
    return res;
  }

  // Lettre de la pièce où se trouve la case, ou null (couloir, roche).
  function pieceDe(g, x, y) {
    const z = g.zones[idx(g.L, x, y)];
    return estPiece(z) ? z : null;
  }

  // Case libre la plus proche de (x, y), en avançant de case en case sans traverser les murs
  // (pour poser un monstre errant à côté du héros qui fouille).
  // memeZone : rester dans la pièce (ou le couloir) de départ. Renvoie [x, y, distance en pas].
  function caseLibreProche(g, etat, x, y, memeZone = false) {
    const depart = idx(g.L, x, y);
    const vus = new Set([depart]);
    const file = [depart];
    const dist = new Map([[depart, 0]]);
    const occupee = c => {
      const cx = c % g.L, cy = Math.floor(c / g.L);
      return etat.heros.some(h => h.x === cx && h.y === cy) || etat.monstres.some(m => m.x === cx && m.y === cy)
        || meubleEn(g, cx, cy) || eboulementEn(etat, cx, cy) || piegeEn(etat, cx, cy);
    };
    while (file.length) {
      const c = file.shift();
      for (const v of voisins(g, c)) {
        if (vus.has(v) || !ouvert(g, etat, c, v)) continue;
        if (memeZone && g.zones[v] !== g.zones[depart]) continue;
        vus.add(v);
        dist.set(v, dist.get(c) + 1);
        if (!occupee(v)) return [v % g.L, Math.floor(v / g.L), dist.get(v)];
        file.push(v);
      }
    }
    return null;
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

  // groupe (facultatif) : personnages du registre, au plus un par classe :
  //   [{ persoId, classe, nom, court, vieMax, espritMax, attaque, defense, or, inventaire }]
  // Sans groupe, les 4 héros de base sont utilisés, sans nom personnel.
  function etatInitial(quete, portee = Infinity, groupe = null) {
    const membres = groupe?.length
      ? HEROS.filter(c => groupe.some(p => p.classe === c.id)).map(c => {
          const p = groupe.find(q => q.classe === c.id);
          return {
            id: c.id, classe: c.id, persoId: p.persoId, nom: p.nom || c.nom, court: p.court || c.court,
            corps: p.vieMax ?? undefined, corpsMax: p.vieMax ?? undefined,
            esprit: p.espritMax ?? undefined, espritMax: p.espritMax ?? undefined,
            attaque: p.attaque ?? undefined, defense: p.defense ?? undefined,
            or: p.or || 0, inventaire: JSON.parse(JSON.stringify(p.inventaire || [])),
          };
        })
      : HEROS.map(h => ({ ...h, classe: h.id }));
    const etat = {
      heros: membres.map((h, n) => ({ ...h, x: quete.departs[n]?.[0] ?? null, y: quete.departs[n]?.[1] ?? null })),
      monstres: (quete.monstres || []).map(m => ({ ...m })),
      // Pièges : trouve = repéré par une fouille ; declenche = tombé dedans (fosse, bloc).
      pieges: (quete.pieges || []).map(p => ({ ...p, trouve: false, declenche: false })),
      // Meubles piégés : id du meuble → { trouve, declenche, desamorce }.
      piegesMobilier: Object.fromEntries((quete.mobilier || []).filter(m => m.piege).map(m => [m.id, { trouve: false, declenche: false, desamorce: false }])),
      tresorsPris: [],      // pièces dont le trésor propre a été trouvé
      fouillesTresor: {},   // héros → pièces qu'il a déjà fouillées pour un trésor
      portesOuvertes: [],
      secretesTrouvees: [],
      passagesTrouves: [],  // passages secrets connus
      interrupteurs: {},    // id → { trouve, active }
      objets: objetsInitiaux(quete), // objets transportables : position et porteur
      revele: [],
      penombre: {},
    };
    // L'escalier est visible dès le départ si les héros partent de lui ; sinon (sortie ailleurs),
    // il reste dans le brouillard jusqu'à ce qu'on le voie.
    if (quete.escalier) {
      const L = quete.plateau.largeur, { x, y } = quete.escalier;
      const cases = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
      if ((quete.departs || []).some(([dx, dy]) => cases.some(([cx, cy]) => cx === dx && cy === dy)))
        etat.revele.push(...cases.map(([cx, cy]) => idx(L, cx, cy)));
    }
    devoiler(geometrie(quete), etat, portee);
    return etat;
  }

  /* ---------- Objets transportables (v0.35.0) ----------
     Objet de quête qu'un héros ramasse et porte (ex. un coffre à rapporter). Au sol, il est
     dessiné sur sa case (caché tant que la case n'est pas dévoilée) et ne bloque pas le passage.
     Porté, il suit son porteur ; si le porteur meurt, l'objet tombe sur sa case.
     Rien de tout cela ne vaut pour les meubles ordinaires : seuls les objets que la quête
     déclare dans « transportables » se portent. Le ralentissement n'existe que si la quête
     le précise (« deplacementDes ») ; sans ce champ, le porteur se déplace normalement. */
  const objetsInitiaux = q => (q.transportables || []).map(o => ({ id: o.id, x: o.x, y: o.y, porteur: null }));
  // État des objets ; les parties commencées avant la v0.35.0 n'en ont pas : on le crée.
  function etatObjets(q, etat) {
    if (!Array.isArray(etat.objets)) etat.objets = objetsInitiaux(q);
    return etat.objets;
  }
  // Description de l'objet (quête) fusionnée avec son état (partie) ; un objet porté
  // est à la position de son porteur.
  function objetsDe(q, etat) {
    return etatObjets(q, etat).map(s => {
      const o = { ...(q.transportables || []).find(k => k.id === s.id), ...s };
      const h = s.porteur && etat.heros.find(k => k.id === s.porteur);
      if (h && !h.mort && h.x != null) { o.x = h.x; o.y = h.y; }
      return o;
    }).filter(o => o.nom);
  }
  const objetsPortes = (q, etat, hid) => objetsDe(q, etat).filter(o => o.porteur === hid);
  const desPort = o => (Number.isInteger(o.deplacementDes) ? o.deplacementDes : null);
  // Un objet porté suit son porteur ; porteur mort ou retiré du plateau : l'objet reste à terre
  // sur sa dernière case connue (case où il est mort, sinon dernière position).
  function synchroniserObjets(q, etat) {
    for (const s of etatObjets(q, etat)) {
      if (!s.porteur) continue;
      const h = etat.heros.find(k => k.id === s.porteur);
      if (h && !h.mort && h.x != null) { s.x = h.x; s.y = h.y; continue; }
      if (h?.mortEn?.x != null) { s.x = h.mortEn.x; s.y = h.mortEn.y; }
      s.porteur = null;
    }
  }
  // Objets au sol que le héros peut ramasser : sur sa case, ou sur une case voisine
  // (sans diagonale) sans mur ni porte fermée entre les deux.
  function objetsAPortee(g, etat, h) {
    if (!h || h.x == null) return [];
    const i = idx(g.L, h.x, h.y);
    return objetsDe(g.quete, etat).filter(o => {
      if (o.porteur || o.x == null) return false;
      const d = Math.abs(o.x - h.x) + Math.abs(o.y - h.y);
      return d === 0 || (d === 1 && ouvert(g, etat, i, idx(g.L, o.x, o.y)));
    });
  }
  function surEscalierQ(q, x, y) {
    const s = q.escalier;
    return !!s && x != null && x >= s.x && x <= s.x + 1 && y >= s.y && y <= s.y + 1;
  }
  // Objets à rapporter à l'escalier (« aRapporter » vaut vrai par défaut) et ceux qui y sont.
  function bilanObjets(q, etat) {
    const aRapporter = objetsDe(q, etat).filter(o => o.aRapporter !== false);
    return { aRapporter, rapportes: aRapporter.filter(o => surEscalierQ(q, o.x, o.y)) };
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
        if (z(m.x + dx, m.y + dy) !== z(m.x, m.y)) { err.push(`mobilier ${m.id} : à cheval sur deux zones (mur au milieu)`); dx = 99; break; }
      }
    }
    for (const m of q.monstres || []) {
      idUnique(m, 'monstre');
      if (!libre(m.x, m.y)) err.push(`monstre ${m.id} : case hors du plateau ou dans la roche`);
      if (m.comportement != null && !COMPORTEMENTS.includes(m.comportement)) err.push(`monstre ${m.id} : comportement inconnu « ${m.comportement} » (${COMPORTEMENTS.join(', ')})`);
    }
    if (q.comportementMonstres != null && !COMPORTEMENTS.includes(q.comportementMonstres)) err.push(`comportementMonstres : valeur inconnue « ${q.comportementMonstres} » (${COMPORTEMENTS.join(', ')})`);
    for (const m of q.monstres || []) {
      if (m.ciblage != null && !CIBLAGES.includes(m.ciblage)) err.push(`monstre ${m.id} : ciblage inconnu « ${m.ciblage} » (${CIBLAGES.join(', ')})`);
    }
    if (q.ciblageMonstres != null && !CIBLAGES.includes(q.ciblageMonstres)) err.push(`ciblageMonstres : valeur inconnue « ${q.ciblageMonstres} » (${CIBLAGES.join(', ')})`);
    if (q.objetsCles != null && !Array.isArray(q.objetsCles)) err.push('objetsCles : doit être une liste de noms d’objets');
    for (const p of q.pieges || []) {
      idUnique(p, 'piège');
      if (!['fosse', 'bloc', 'lance'].includes(p.type)) err.push(`piège ${p.id} : type inconnu « ${p.type} » (fosse, bloc ou lance)`);
      if (!libre(p.x, p.y)) err.push(`piège ${p.id} : case hors du plateau ou dans la roche`);
    }
    const cibles = new Set();
    for (const p of q.passages || []) {
      idUnique(p, 'passage');
      const [ax, ay] = p.a || [], [bx, by] = p.b || [];
      if (!libre(ax, ay) || !libre(bx, by)) { err.push(`passage ${p.id} : case hors du plateau ou dans la roche`); continue; }
      if (ax === bx && ay === by) err.push(`passage ${p.id} : les deux extrémités sont sur la même case`);
      cibles.add(p.id);
    }
    for (const p of q.portes || []) if (p.secrete) cibles.add(p.id);
    for (const t of q.interrupteurs || []) {
      idUnique(t, 'interrupteur');
      if (!libre(t.x, t.y)) err.push(`interrupteur ${t.id} : case hors du plateau ou dans la roche`);
      if (t.active != null && !Array.isArray(t.active)) err.push(`interrupteur ${t.id} : « active » doit être une liste`);
      for (const c of Array.isArray(t.active) ? t.active : []) if (!cibles.has(c)) err.push(`interrupteur ${t.id} : « ${c} » n’est ni un passage ni une porte secrète`);
    }
    // Alliés à escorter (v0.33.0) : personnages à retrouver puis à ramener (ex. un prisonnier).
    for (const a of q.allies || []) {
      idUnique(a, 'allié');
      if (!a.nom) err.push(`allié ${a.id} : nom manquant`);
      if (!libre(a.x, a.y)) err.push(`allié ${a.id} : case hors du plateau ou dans la roche`);
      for (const champ of ['corps', 'defense', 'deplacementDes'])
        if (a[champ] != null && !(Number.isInteger(a[champ]) && a[champ] >= 1 && a[champ] <= 12)) err.push(`allié ${a.id} : « ${champ} » doit être un nombre entier entre 1 et 12`);
      if (a.recompense != null && !(Number.isInteger(a.recompense.or) && a.recompense.or >= 0)) err.push(`allié ${a.id} : « recompense.or » doit être un nombre entier positif`);
      if ((q.monstres || []).some(m => m.x === a.x && m.y === a.y)) err.push(`allié ${a.id} : case déjà occupée par un monstre`);
    }
    // Images propres à la quête (v0.37.0) : racine « symboles » { cle: { donnees, l, h } } ;
    // un monstre, allié, meuble ou objet transportable y renvoie par « symbole ».
    if (q.symboles != null && (typeof q.symboles !== 'object' || Array.isArray(q.symboles))) err.push('symboles : doit être un objet { clé: image }');
    const clesImages = new Set();
    for (const [cle, im] of q.symboles && typeof q.symboles === 'object' && !Array.isArray(q.symboles) ? Object.entries(q.symboles) : []) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(cle)) err.push(`symboles : clé « ${cle} » invalide (lettres, chiffres, - et _ ; 40 caractères au plus)`);
      else if (typeof Symboles !== 'undefined' && !Symboles.imageValide(im)) err.push(`symboles : image « ${cle} » invalide (data:image webp, png ou jpeg en base64, avec l et h)`);
      else clesImages.add(cle);
    }
    const standard = typeof Symboles !== 'undefined' ? new Set(Object.values(Symboles.CLES).flat()) : new Set();
    for (const [liste, quoi] of [[q.monstres, 'monstre'], [q.allies, 'allié'], [q.mobilier, 'meuble'], [q.transportables, 'objet transportable']])
      for (const o of Array.isArray(liste) ? liste : [])
        if (o.symbole != null && !clesImages.has(o.symbole) && !standard.has(o.symbole))
          err.push(`${quoi} ${o.id || o.nom || ''} : symbole « ${o.symbole} » absent de « symboles »`);
    // Objets transportables (v0.35.0).
    if (q.transportables != null && !Array.isArray(q.transportables)) err.push('transportables : doit être une liste');
    for (const o of Array.isArray(q.transportables) ? q.transportables : []) {
      idUnique(o, 'objet transportable');
      if (!o.nom) err.push(`objet ${o.id} : nom manquant`);
      if (!libre(o.x, o.y)) err.push(`objet ${o.id} : case hors du plateau ou dans la roche`);
      if (o.deplacementDes != null && !(Number.isInteger(o.deplacementDes) && o.deplacementDes >= 0 && o.deplacementDes <= 12)) err.push(`objet ${o.id} : « deplacementDes » doit être un nombre entier entre 0 et 12`);
      if (o.aRapporter != null && typeof o.aRapporter !== 'boolean') err.push(`objet ${o.id} : « aRapporter » doit valoir true ou false`);
    }
    if (q.recompenseObjets != null) {
      if (!(Number.isInteger(q.recompenseObjets.or) && q.recompenseObjets.or >= 0)) err.push('recompenseObjets : « or » doit être un nombre entier positif');
      if (!(q.transportables || []).some(o => o.aRapporter !== false)) err.push('recompenseObjets : aucun objet transportable à rapporter');
      if (!q.escalier) err.push('recompenseObjets : il faut un escalier où rapporter les objets');
    }
    if (q.escalier) {
      const { x, y } = q.escalier;
      if (![[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dy]) => libre(x + dx, y + dy))) err.push('escalier : ses 2 × 2 cases doivent être sur le plateau, hors de la roche');
    }
    if (!Array.isArray(q.departs) || q.departs.length < 1) err.push('aucune case de départ pour les héros');
    else q.departs.forEach(([x, y], n) => { if (!libre(x, y)) err.push(`départ n° ${n + 1} : case invalide`); });
    return err;
  }

  // Fin de quête réussie (v0.33.0) : un allié revenu vivant sur l'escalier rapporte sa récompense,
  // partagée à parts égales entre les héros encore debout (le reste au premier dans l'ordre de jeu).
  // Modifie etat ; renvoie les phrases à afficher.
  function verserRecompenses(q, etat) {
    const s = q.escalier, phrases = [];
    const surEscalier = h => !!s && h.x != null && h.x >= s.x && h.x <= s.x + 1 && h.y >= s.y && h.y <= s.y + 1;
    const ordre = etat.ordre || [];
    const heros = etat.heros.filter(h => !h.allie && !h.mort && h.corps !== 0)
      .sort((a, b) => ordre.indexOf(a.id) - ordre.indexOf(b.id));
    for (const a of q.allies || []) {
      const h = etat.heros.find(k => k.allie === a.id);
      if (!h || h.recompenseVersee) continue;
      const or = a.recompense?.or || 0;
      if (h.mort || h.corps === 0) { if (or) phrases.push(`${a.nom} n’a pas survécu : pas de récompense.`); continue; }
      if (!surEscalier(h)) { if (or) phrases.push(`${a.nom} n’est pas à l’escalier : pas de récompense.`); continue; }
      h.recompenseVersee = true;
      if (!or || !heros.length) continue;
      const part = Math.floor(or / heros.length), reste = or - part * heros.length;
      heros.forEach((k, n) => { k.or = (k.or || 0) + part + (n === 0 ? reste : 0); });
      phrases.push(`Sauvetage de ${a.nom} réussi : ${or} pièces d’or partagées (${part} chacun${reste ? `, ${reste} de plus pour ${heros[0].nom}` : ''}).`);
    }
    // Objets à rapporter (v0.35.0) : la récompense n'est versée que si tous sont sur l'escalier.
    const ro = q.recompenseObjets?.or || 0;
    if (ro && !etat.recompenseObjetsVersee) {
      const { aRapporter, rapportes } = bilanObjets(q, etat);
      if (rapportes.length < aRapporter.length) {
        phrases.push(`Objets rapportés : ${rapportes.length} sur ${aRapporter.length}, pas de récompense.`);
      } else if (heros.length) {
        etat.recompenseObjetsVersee = true;
        const part = Math.floor(ro / heros.length), reste = ro - part * heros.length;
        heros.forEach((k, n) => { k.or = (k.or || 0) + part + (n === 0 ? reste : 0); });
        phrases.push(`Tout est rapporté : ${ro} pièces d’or partagées (${part} chacun${reste ? `, ${reste} de plus pour ${heros[0].nom}` : ''}).`);
      }
    }
    return phrases;
  }

  return { verserRecompenses, objetsDe, objetsPortes, objetsAPortee, synchroniserObjets, etatObjets, bilanObjets, desPort, geometrie, idx, estPiece, ouvert, mur, ligneDeVue, trajectoireTir, devoiler, basculerZone, porteVisible, devantPorte, etatInitial, verifierQuete, porteeDe, PORTEE_DEFAUT, raisonBlocage, autreHerosEn, meubleEn, planMonstre, planRepli, comportementDe, COMPORTEMENTS, ciblageDe, CIBLAGES, CIBLAGE_PAR_TYPE, pieceDe, caseLibreProche, piegeEn, eboulementEn, fosseEn, casesFouillables, casesFouillablesPieges, fouillerPortes, fouillerPieges,
    passageConnu, passageEntre, sortiesPassage, fouillerPassages, fouillerInterrupteurs, interrupteurPret, actionnerInterrupteur, HEROS };
})();
