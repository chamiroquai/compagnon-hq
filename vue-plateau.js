/* vue-plateau.js — Dessin du plateau (SVG) et gestes du joueur.
   Affichage, brouillard, portes, vue MJ, annulation (étape 3) ;
   tour par tour et déplacement case par case aux dés (étape 4).
   Règle d'arbitrage : en cas d'écart aux règles (2e déplacement…), l'application
   AVERTIT mais ne bloque pas. Seules les impossibilités physiques sont refusées
   (traverser un mur, un monstre, un meuble…). La vue MJ permet toutes les corrections. */
'use strict';

const VuePlateau = (() => {
  const T = 40; // taille d'une case en unités du dessin
  const NS = 'http://www.w3.org/2000/svg';

  const infoMonstre = type => Regles.infoMonstre(type);

  // Protège un texte avant de l'insérer dans la page.
  const echapperTexte = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Crée un élément SVG avec ses attributs.
  function el(nom, attrs = {}, parent) {
    const e = document.createElementNS(NS, nom);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }

  /* Monte le plateau dans « conteneur ».
     partie : la partie (avec .quete et .etat) ; enregistrer() : sauvegarde la partie. */
  /* options : { quitter() — retour à la liste des parties ; abandonner() — abandon de la quête } */
  function monter(conteneur, partie, enregistrer, options = {}) {
    const quete = partie.quete;
    const g = Plateau.geometrie(quete);
    const { L, H } = g;
    let etat = partie.etat;
    if (!etat.tour) etat.tour = { numero: 1, index: 0 }; // parties commencées avant la v0.5.0
    // Quête de démonstration commencée avant la v0.13.0 : on y ajoute les pièges
    // (la quête est copiée dans la partie au démarrage, l'ancienne copie n'en avait pas).
    if (quete.id === QUETE_DEMO.id && !quete.pieges && QUETE_DEMO.pieges) {
      quete.pieges = JSON.parse(JSON.stringify(QUETE_DEMO.pieges));
      // Un piège déjà « sous » une figurine ou sur une case découverte reste caché mais n'est pas posé
      // là où se trouve déjà un héros (pour ne pas le déclencher par surprise).
      etat.pieges = quete.pieges
        .filter(p => !etat.heros.some(h => h.x === p.x && h.y === p.y))
        .map(p => ({ ...p, trouve: false, declenche: false }));
      partie.quete = quete; partie.etat = etat; enregistrer();
    }
    if (!etat.pieges) etat.pieges = [];
    // Quête de démonstration commencée avant la v0.14.0 : trésors, monstre errant et coffre piégé.
    if (quete.id === QUETE_DEMO.id && !quete.tresors) {
      quete.tresors = JSON.parse(JSON.stringify(QUETE_DEMO.tresors));
      quete.monstreErrant = QUETE_DEMO.monstreErrant;
      for (const m of quete.mobilier || []) {
        const ref = QUETE_DEMO.mobilier.find(k => k.id === m.id);
        if (ref?.piege) m.piege = { ...ref.piege };
      }
      partie.quete = quete; enregistrer();
    }
    if (!etat.piegesMobilier) etat.piegesMobilier = Object.fromEntries((quete.mobilier || []).filter(m => m.piege).map(m => [m.id, { trouve: false, declenche: false, desamorce: false }]));
    if (!etat.tresorsPris) etat.tresorsPris = [];
    if (!etat.fouillesTresor) etat.fouillesTresor = {};
    const caracs = options.caracs || Regles.caracsVides();
    const carac = (famille, type, champ) => Regles.valeur(caracs, famille, type, champ);
    // Caractéristique d'un héros : celle de son personnage (registre), sinon celle des Réglages.
    const caracBrute = (h, champ) => (Number.isFinite(h?.[champ]) ? h[champ] : carac('heros', h.classe || h.id, champ));
    // Dans une fosse : un dé de combat de moins en attaque et en défense (minimum 1).
    const penaliteFosse = (f, champ, n) => (n !== null && (champ === 'attaque' || champ === 'defense') && Plateau.fosseEn(etat, f.x, f.y) ? Math.max(1, n - 1) : n);
    const bonusSorts = (h, champ, n) => (n === null ? n : n + (champ === 'attaque' && h.courage ? 2 : 0) + (champ === 'defense' && h.peauRoc ? 2 : 0));
    const caracHeros = (h, champ) => bonusSorts(h, champ, penaliteFosse(h, champ, caracBrute(h, champ)));
    const caracMonstre = (m, champ) => penaliteFosse(m, champ, Regles.valeurMonstre(caracs, m, champ));
    // Points de Vie (champ « corps ») et d'Esprit de départ, d'après les caractéristiques saisies.
    // (Seulement s'ils n'existent pas encore : une quête en cours garde ses valeurs.)
    let initialise = false;
    for (const h of etat.heros) {
      if (h.corps === undefined && carac('heros', h.id, 'corps') !== null) {
        h.corpsMax = h.corps = carac('heros', h.id, 'corps');
        h.espritMax = h.esprit = carac('heros', h.id, 'esprit');
        initialise = true;
      }
    }
    for (const m of etat.monstres) {
      if (m.corps === undefined && Regles.valeurMonstre(caracs, m, 'corps') !== null) {
        m.corpsMax = m.corps = Regles.valeurMonstre(caracs, m, 'corps');
        initialise = true;
      }
    }
    if (initialise) { partie.etat = etat; enregistrer(); }
    // Partie arrêtée pendant le tour de Zargon avant la v0.8.0 : on prépare son tour.
    if (etat.tour.index >= (etat.ordre || []).length && !etat.zargon) { demarrerZargon(etat); partie.etat = etat; enregistrer(); }
    let selection = null;        // id du héros sélectionné
    let vueMJ = false;
    let zoom = Number(localStorage.getItem('zoomJeu')) || 1; // 1 = plateau ajusté à l'écran
    const historique = [];       // états précédents, pour « Annuler » (60 au plus)

    const nomHeros = hid => etat.heros.find(h => h.id === hid)?.nom ?? hid;
    // Écran de jeu : barre du haut (retour, ordre, tour), plateau ajusté à la place
    // restante, colonne d'outils à droite, messages par-dessus le plateau, menu en volet.
    conteneur.innerHTML = `
      <div class="jeu">
        <header id="pl-haut" class="jeu-haut">
          <button id="pl-quitter" class="icone" aria-label="Retour aux parties">‹</button>
          <ol id="pl-ordre" class="ordre-jeu" aria-label="Ordre de jeu"></ol>
          <div id="pl-tour" class="panneau-tour"></div>
        </header>
        <div class="jeu-plateau">
          <div id="pl-cadre" class="cadre-plateau"><svg id="pl-svg" viewBox="0 0 ${L * T} ${H * T}" role="img" aria-label="Plateau de jeu"></svg></div>
          <div id="pl-invite" class="invite-porte" hidden></div>
          <div id="pl-modale" class="modale" hidden></div>
          <p id="pl-message" class="message-plateau" hidden></p>
        </div>
        <nav class="jeu-outils" aria-label="Outils">
          <button id="pl-annuler" class="icone" aria-label="Annuler" disabled>↶</button>
          <button id="pl-mj" class="icone" aria-pressed="false" aria-label="Vue MJ">MJ</button>
          <button id="pl-plus" class="icone" aria-label="Zoomer">+</button>
          <button id="pl-moins" class="icone" aria-label="Dézoomer">−</button>
          <button id="pl-ajuster" class="icone petit-texte" aria-label="Ajuster le plateau à l’écran">⤢</button>
          <span class="espace"></span>
          <button id="pl-menu" class="icone" aria-label="Menu">☰</button>
        </nav>
        <div id="pl-fiche" class="feuille fiche" hidden></div>
        <div id="pl-feuille" class="feuille" hidden>
          <div class="feuille-entete">
            <h2>${echapperTexte(quete.titre)}</h2>
            <button id="pl-fermer" class="icone" aria-label="Fermer le menu">✕</button>
          </div>
          <section>
            <h3>Vision</h3>
            <label for="pl-portee">Portée de vue dans les couloirs</label>
            <select id="pl-portee">
              <option value="illimitee">Illimitée (règle officielle)</option>
              ${[4, 5, 6, 7, 8, 10, 12].map(n => `<option value="${n}">${n} cases</option>`).join('')}
            </select>
            <p class="discret petit">Règle maison : au-delà, le couloir reste dans le noir ; la dernière case vue
              s’estompe en fondu. Les pièces sont toujours vues en entier. Réduire la portée ne recache pas
              ce qui a déjà été vu.</p>
          </section>
          <section>
            <h3>Notes de partie</h3>
            <textarea id="pl-notes" rows="6" placeholder="Notes libres : or, objets, quêtes terminées…"></textarea>
            <p id="pl-etat-notes" class="discret petit">Enregistrement automatique.</p>
          </section>
          <section>
            <h3>Comment ça marche</h3>
            <ul class="puces petit">
              <li>Le héros dont c’est le tour porte un anneau blanc. « Actions » ouvre la fenêtre de ses choix :
                  « Se déplacer » (lancez vos 2 dés rouges, touchez le total, puis les cases une par une — les cases possibles
                  sont encadrées), « Terminer le déplacement », « Attaquer »… La croix ✕ la referme.</li>
              <li>Fiche d’un héros (points de Vie, d’Esprit, or, inventaire, dés) : touchez son pion sur le plateau, ou sa pastille dans l’ordre de jeu en haut.</li>
              <li>On peut traverser un autre héros, mais pas s’arrêter sur sa case. Murs, portes fermées, monstres et meubles bloquent.</li>
              <li>Touchez une porte fermée pour l’ouvrir : un héros doit se trouver sur une case qui la touche.</li>
              <li>« Fin du tour » passe au héros suivant, puis à Zargon.</li>
              <li>Colonne de droite : ↶ annuler, MJ (vue du maître du jeu), + et − zoom, ⤢ plateau ajusté à l’écran.</li>
              <li>Vue MJ : tout le plateau apparaît. Toucher un héros puis une case le pose n’importe où ; toucher une case
                  dévoile ou cache sa pièce ; toucher une porte secrète la rend trouvée.</li>
              <li>Touchez un message pour le faire disparaître.</li>
            </ul>
          </section>
          <section>
            <h3>Fin de la quête</h3>
            <p class="discret petit">Enregistre l’or et l’inventaire de chaque héros dans son personnage
              (onglet Héros). Points de Vie et d’Esprit repartent au maximum à la quête suivante.</p>
            <div class="ligne">
              <button id="pl-reussie" class="principal">Quête réussie</button>
              <button id="pl-echouee">Quête échouée</button>
            </div>
          </section>
          <section class="ligne">
            <button id="pl-quitter2">Retour aux parties</button>
            <button id="pl-abandon" class="danger">Abandonner la quête</button>
          </section>
        </div>
      </div>`;

    const svg = conteneur.querySelector('#pl-svg');
    const cadre = conteneur.querySelector('#pl-cadre');
    const bulle = conteneur.querySelector('#pl-message');
    // Message affiché par-dessus le plateau ; un toucher le fait disparaître.
    // msg('texte') ou msg('texte', { ambiance: '…' }, 'suite') : chaque morceau sur sa ligne,
    // les lignes d'ambiance en italique.
    const msg = (...morceaux) => {
      const lignes = morceaux.filter(m => m && (typeof m === 'string' ? m.trim() : m.ambiance));
      bulle.innerHTML = lignes.map(m => typeof m === 'string'
        ? `<span>${echapperTexte(m)}</span>`
        : `<em class="ambiance">${echapperTexte(m.ambiance)}</em>`).join('<br>');
      bulle.hidden = !lignes.length;
    };
    bulle.addEventListener('click', () => msg(''));

    // Taille du plateau : au zoom 1, les cases sont aussi grandes que possible
    // pour que tout le plateau tienne dans la place disponible.
    function appliquerZoom() {
      const r = cadre.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const caseAjustee = Math.max(10, Math.min(r.width / L, r.height / H));
      svg.setAttribute('width', Math.floor(L * caseAjustee * zoom));
      svg.setAttribute('height', Math.floor(H * caseAjustee * zoom));
    }
    if ('ResizeObserver' in window) new ResizeObserver(appliquerZoom).observe(cadre);
    else window.addEventListener('resize', appliquerZoom);

    /* ---------- Modifier l'état ---------- */

    // Toute modification passe par ici : mémorise l'état précédent, applique, dévoile, enregistre, redessine.
    function modifier(action) {
      const avant = JSON.stringify(etat);
      const resultat = action(etat);
      if (resultat === false) return; // action refusée : rien n'a changé
      historique.push(avant);
      if (historique.length > 60) historique.shift();
      Plateau.devoiler(g, etat, Plateau.porteeDe(partie.reglages));
      // Courage prend fin quand plus aucun monstre n'est en vue.
      if (!etat.monstres.some(m => etat.revele.includes(Plateau.idx(L, m.x, m.y)))) etat.heros.forEach(h => { delete h.courage; });
      partie.etat = etat;
      enregistrer();
      dessiner();
    }

    function annuler() {
      if (!historique.length) return;
      etat = JSON.parse(historique.pop());
      partie.etat = etat;
      selection = null; combat = null; conclusion = null; ciblage = false; fenetreActions = null; evenement = null;
      enregistrer();
      msg('Action annulée.');
      dessiner();
    }

    /* ---------- Dessin ---------- */

    function dessiner() {
      const vu = new Set(etat.revele);
      const visible = i => vueMJ || vu.has(i);
      svg.innerHTML = '';
      svg.classList.toggle('mj', vueMJ);

      // 1. Cases
      const fond = el('g', {}, svg);
      for (let i = 0; i < L * H; i++) {
        const z = g.zones[i];
        const cls = z === '#' ? 'c-roche' : z === '.' ? 'c-couloir' : 'c-piece';
        el('rect', { x: (i % L) * T, y: Math.floor(i / L) * T, width: T, height: T, class: 'case ' + cls, 'data-i': i }, fond);
      }

      // 2. Escalier
      if (quete.escalier) {
        const { x, y } = quete.escalier;
        if (visible(Plateau.idx(L, x, y))) {
          const gr = el('g', { class: 'escalier' }, svg);
          el('rect', { x: x * T + 3, y: y * T + 3, width: 2 * T - 6, height: 2 * T - 6, rx: 4 }, gr);
          for (let k = 1; k < 5; k++) el('line', { x1: x * T + 6, x2: x * T + 2 * T - 6, y1: y * T + k * 2 * T / 5, y2: y * T + k * 2 * T / 5 }, gr);
        }
      }

      // 3. Mobilier
      for (const m of quete.mobilier || []) {
        if (!visible(Plateau.idx(L, m.x, m.y))) continue;
        const gr = el('g', { class: 'mobilier m-' + m.type }, svg);
        el('rect', { x: m.x * T + 4, y: m.y * T + 4, width: (m.l || 1) * T - 8, height: (m.h || 1) * T - 8, rx: 3 }, gr);
        const t = el('text', { x: (m.x + (m.l || 1) / 2) * T, y: (m.y + (m.h || 1) / 2) * T + 4, class: 'etiquette' }, gr);
        t.textContent = (m.l || 1) > 1 || (m.h || 1) > 1 ? m.nom : m.nom.slice(0, 3);
        // Meuble piégé : ⚠ quand il est repéré (ou en vue MJ), tant qu'il n'est ni désamorcé ni déclenché.
        const st = etat.piegesMobilier?.[m.id];
        if (m.piege && st && !st.desamorce && !st.declenche && (st.trouve || vueMJ)) {
          const a = el('text', { x: m.x * T + 9, y: m.y * T + 15, class: 'alerte-meuble' + (st.trouve ? '' : ' cache') }, gr);
          a.textContent = '⚠';
        }
      }

      // 3 bis. Pièges : connus (repérés ou déclenchés) ; en vue MJ, aussi les pièges cachés.
      const SYMBOLES_PIEGES = { fosse: '◎', bloc: '▦', lance: '↟' };
      for (const p of etat.pieges || []) {
        const i = Plateau.idx(L, p.x, p.y);
        const connu = p.trouve || p.declenche;
        if (!(vueMJ || (connu && vu.has(i)))) continue;
        const cls = 'piege piege-' + p.type + (p.declenche ? ' declenche' : '') + (!connu ? ' cache' : '');
        const gp = el('g', { class: cls }, svg);
        if (p.declenche && p.type === 'bloc') {
          el('rect', { x: p.x * T + 1, y: p.y * T + 1, width: T - 2, height: T - 2, rx: 3 }, gp);
        } else if (p.declenche && p.type === 'fosse') {
          el('rect', { x: p.x * T + 4, y: p.y * T + 4, width: T - 8, height: T - 8, rx: 10 }, gp);
        } else {
          el('rect', { x: p.x * T + 3, y: p.y * T + 3, width: T - 6, height: T - 6, rx: 4 }, gp);
          const t = el('text', { x: p.x * T + T / 2, y: p.y * T + T / 2 + 6, class: 'symbole-piege' }, gp);
          t.textContent = SYMBOLES_PIEGES[p.type] || '!';
        }
      }

      // 4. Murs (traits épais sur les bords entre zones différentes)
      const murs = el('g', { class: 'murs' }, svg);
      for (let y = 0; y < H; y++) for (let x = 0; x < L; x++) {
        const i = Plateau.idx(L, x, y);
        if (x + 1 < L) {
          const j = i + 1;
          if (Plateau.mur(g, i, j) && (visible(i) || visible(j)))
            el('line', { x1: (x + 1) * T, x2: (x + 1) * T, y1: y * T, y2: (y + 1) * T }, murs);
        }
        if (y + 1 < H) {
          const j = i + L;
          if (Plateau.mur(g, i, j) && (visible(i) || visible(j)))
            el('line', { x1: x * T, x2: (x + 1) * T, y1: (y + 1) * T, y2: (y + 1) * T }, murs);
        }
      }
      // Contour du plateau
      el('rect', { x: 0, y: 0, width: L * T, height: H * T, class: 'contour' }, svg);

      // 5. Portes (leurs zones tactiles sont posées plus loin, au-dessus des pions)
      const zonesPortes = [];
      for (const p of quete.portes || []) {
        const ia = Plateau.idx(L, ...p.a), ib = Plateau.idx(L, ...p.b);
        const trouvee = Plateau.porteVisible(etat, p);
        if (!vueMJ && (!trouvee || (!vu.has(ia) && !vu.has(ib)))) continue;
        const ouverte = etat.portesOuvertes.includes(p.id);
        const horizontale = p.a[1] !== p.b[1]; // les cases sont l'une au-dessus de l'autre
        const cx = (Math.max(p.a[0], p.b[0]) + (horizontale ? 0.5 : 0)) * T;
        const cy = (Math.max(p.a[1], p.b[1]) + (horizontale ? 0 : 0.5)) * T;
        const w = horizontale ? T * 0.8 : T * 0.3, h = horizontale ? T * 0.3 : T * 0.8;
        const cls = 'porte' + (ouverte ? ' ouverte' : '') + (!trouvee ? ' secrete' : '') + (porteProposee()?.id === p.id ? ' proposee' : '');
        const gr = el('g', { class: cls, 'data-porte': p.id }, svg);
        el('rect', { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: 2 }, gr);
        // Zone tactile : toute la longueur de la porte, mais peu épaisse,
        // pour ne pas voler les touchers destinés aux cases voisines.
        const tw = horizontale ? T : T * 0.5, th = horizontale ? T * 0.5 : T;
        zonesPortes.push({ id: p.id, attrs: { x: cx - tw / 2, y: cy - th / 2, width: tw, height: th, class: 'zone-tactile' } });
      }

      // 6. Monstres (seulement sur les cases dévoilées)
      for (const m of etat.monstres) {
        if (!visible(Plateau.idx(L, m.x, m.y))) continue;
        const visableCible = ciblage && ciblesAttaque().some(c => c.id === m.id);
        const gr = el('g', { class: 'pion monstre' + (vu.has(Plateau.idx(L, m.x, m.y)) ? '' : ' cache') + (visableCible ? ' cible' : ''), 'data-monstre': m.id }, svg);
        el('rect', { x: m.x * T + 5, y: m.y * T + 5, width: T - 10, height: T - 10, rx: 5 }, gr);
        const t = el('text', { x: m.x * T + T / 2, y: m.y * T + T / 2 + 5 }, gr);
        t.textContent = infoMonstre(m.type).court;
      }

      // 6 bis. Tour de Zargon : trajet prévu du monstre en cours (cases visibles seulement)
      const plan = etat.zargon?.plan;
      if (plan && !plan.erreur && plan.chemin) {
        const gz = el('g', { class: 'trajet' }, svg);
        plan.chemin.forEach(([x, y], k) => {
          if (!visible(Plateau.idx(L, x, y))) return;
          el('rect', { x: x * T + 6, y: y * T + 6, width: T - 12, height: T - 12, rx: 6, class: k === plan.chemin.length - 1 ? 'arrivee' : '' }, gz);
        });
        const m = etat.monstres.find(k => k.id === plan.monstre);
        if (m && visible(Plateau.idx(L, m.x, m.y))) el('rect', { x: m.x * T + 1, y: m.y * T + 1, width: T - 2, height: T - 2, rx: 7, class: 'monstre-actif' }, gz);
        const h = plan.cible && etat.heros.find(k => k.id === plan.cible);
        if (h) el('circle', { cx: h.x * T + T / 2, cy: h.y * T + T / 2, r: T / 2 - 1, class: 'heros-vise' }, gz);
      }

      // 7. Cases où le héros actif peut avancer (pendant un déplacement)
      const actif = herosActif();
      if (!vueMJ && actif && etat.tour.deplacement) {
        const cibles = el('g', { class: 'cibles' }, svg);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = actif.x + dx, ny = actif.y + dy;
          if (Plateau.raisonBlocage(g, etat, actif.x, actif.y, nx, ny)) continue;
          if (etat.tour.deplacement.restant === 1 && Plateau.autreHerosEn(etat, actif.id, nx, ny)) continue;
          el('rect', { x: nx * T + 3, y: ny * T + 3, width: T - 6, height: T - 6, rx: 6 }, cibles);
        }
      }

      // 8. Héros
      for (const h of etat.heros) {
        if (h.x == null) continue;
        const cls = 'pion heros h-' + h.id + (selection === h.id ? ' choisi' : '') + (!vueMJ && actif?.id === h.id ? ' actif' : '') + (h.corps === 0 ? ' a-terre' : '');
        const gr = el('g', { class: cls, 'data-heros': h.id }, svg);
        // Héros actif : anneau blanc autour du pion, visible quelle que soit sa couleur.
        if (cls.includes(' actif')) el('circle', { cx: h.x * T + T / 2, cy: h.y * T + T / 2, r: T / 2 - 1, class: 'anneau' }, gr);
        el('circle', { cx: h.x * T + T / 2, cy: h.y * T + T / 2, r: T / 2 - 4 }, gr);
        const t = el('text', { x: h.x * T + T / 2, y: h.y * T + T / 2 + 5 }, gr);
        t.textContent = h.court;
      }

      // 8 bis. Zones tactiles des portes, au-dessus des pions : un héros posé
      //        contre une porte ne doit pas empêcher de la toucher.
      const couchePortes = el('g', { class: 'portes-tactiles' }, svg);
      for (const z of zonesPortes) el('rect', z.attrs, el('g', { 'data-porte': z.id }, couchePortes));

      // 9. Brouillard
      const brouillard = el('g', { class: 'brouillard' }, svg);
      for (let i = 0; i < L * H; i++) {
        if (!vu.has(i)) el('rect', { x: (i % L) * T, y: Math.floor(i / L) * T, width: T + 0.5, height: T + 0.5 }, brouillard);
      }

      // 10. Pénombre : la dernière case vue d'un couloir s'estompe vers le noir,
      //    dans la direction du regard (dégradé propre à chaque case).
      const defs = el('defs', {}, svg);
      const penombre = el('g', { class: 'penombre' }, svg);
      for (const [c, [dx, dy]] of Object.entries(etat.penombre || {})) {
        const i = +c;
        if (!vu.has(i)) continue;
        const id = 'fondu-' + i;
        const grad = el('linearGradient', { id, x1: 0.5 - dx / 2, y1: 0.5 - dy / 2, x2: 0.5 + dx / 2, y2: 0.5 + dy / 2 }, defs);
        el('stop', { offset: 0, 'stop-color': '#000', 'stop-opacity': 0.1 }, grad);
        el('stop', { offset: 1, 'stop-color': '#000', 'stop-opacity': vueMJ ? 0.6 : 0.97 }, grad);
        el('rect', { x: (i % L) * T, y: Math.floor(i / L) * T, width: T + 0.5, height: T + 0.5, fill: `url(#${id})` }, penombre);
      }

      dessinerTour();
      dessinerInvite();
      dessinerModale();
      conteneur.querySelector('#pl-annuler').disabled = historique.length === 0;
      const bMJ = conteneur.querySelector('#pl-mj');
      bMJ.classList.toggle('actif', vueMJ);
      bMJ.setAttribute('aria-pressed', String(vueMJ));
    }

    /* ---------- Gestes ---------- */

    function caseTouchee(evt) {
      const pt = svg.createSVGPoint();
      pt.x = evt.clientX; pt.y = evt.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      const x = Math.floor(p.x / T), y = Math.floor(p.y / T);
      return x >= 0 && y >= 0 && x < L && y < H ? { x, y } : null;
    }

    svg.addEventListener('click', evt => {
      const porte = evt.target.closest('[data-porte]');
      const heros = evt.target.closest('[data-heros]');
      if (porte) return toucherPorte(porte.dataset.porte);
      const c = caseTouchee(evt);

      const monstreTouche = evt.target.closest('[data-monstre]');
      if (vueMJ) {
        // Vue MJ : toucher un monstre le choisit, puis une case le pose (correction libre).
        if (monstreTouche && !selection) {
          selection = 'm:' + monstreTouche.dataset.monstre;
          const m = etat.monstres.find(k => k.id === monstreTouche.dataset.monstre);
          msg(`${infoMonstre(m.type).nom} choisi : touchez une case pour le poser (vue MJ).`);
          return dessiner();
        }
        // Vue MJ : toucher un héros le choisit, puis une case le pose (correction libre).
        if (heros) {
          selection = selection === heros.dataset.heros ? null : heros.dataset.heros;
          const h = etat.heros.find(k => k.id === selection);
          msg(h ? `${h.nom} choisi : touchez une case pour l’y poser (vue MJ).` : '');
          return dessiner();
        }
        if (!c) return;
        return selection ? poserHeros(c) : toucherCaseMJ(c);
      }

      // Vue des joueurs : en mode attaque, toucher un monstre le choisit comme cible.
      if (ciblage) {
        if (monstreTouche) return choisirCible(monstreTouche.dataset.monstre);
        return msg('Touchez un monstre entouré de rouge, ou « Retour ».');
      }
      // Pendant un déplacement, toucher une case fait avancer le héros actif.
      if (c && etat.tour?.deplacement) return avancer(c);
      // Toucher le pion d'un héros (hors déplacement) ouvre sa fiche.
      if (heros) return ouvrirFiche(heros.dataset.heros);
      if (!c) return;
      const m = etat.monstres.find(k => k.x === c.x && k.y === c.y);
      if (m && etat.revele.includes(Plateau.idx(L, c.x, c.y))) msg(`${infoMonstre(m.type).nom} — Vie ${m.corps ?? '?'}${m.corpsMax ? '/' + m.corpsMax : ''}.`);
    });

    // Vue MJ : pose un héros n'importe où (sauf roche, meuble ou case occupée).
    function poserHeros({ x, y }) {
      const i = Plateau.idx(L, x, y);
      if (selection.startsWith('m:')) {
        const id = selection.slice(2);
        if (g.zones[i] === '#') return msg('Case de roche : impossible.');
        if (etat.heros.some(k => k.x === x && k.y === y) || etat.monstres.some(k => k.id !== id && k.x === x && k.y === y)) return msg('Case occupée.');
        if (Plateau.meubleEn(g, x, y)) return msg('Meuble : impossible.');
        modifier(e => {
          const m = e.monstres.find(z => z.id === id); m.x = x; m.y = y;
          // Si c'est le monstre en train de jouer, son plan est recalculé depuis sa nouvelle case.
          if (e.zargon?.plan?.monstre === id) preparerZargon(e);
        });
        selection = null;
        msg('Monstre déplacé (vue MJ).');
        return dessiner();
      }
      const h = etat.heros.find(k => k.id === selection);
      if (g.zones[i] === '#') return msg('Case de roche : impossible.');
      if (etat.heros.some(k => k.x === x && k.y === y) || etat.monstres.some(k => k.x === x && k.y === y)) return msg('Case occupée.');
      const meuble = Plateau.meubleEn(g, x, y);
      if (meuble) return msg(`${meuble.nom} : on ne peut pas s’y arrêter.`);
      modifier(e => { const k = e.heros.find(z => z.id === h.id); k.x = x; k.y = y; });
      selection = null;
      msg(`${h.nom} déplacé.`);
      dessiner();
    }

    /* ---------- Tour par tour ---------- */

    // Héros dont c'est le tour, ou null pendant le tour de Zargon.
    function herosActif() {
      const t = etat.tour, ordre = etat.ordre || [];
      if (!t || t.index >= ordre.length) return null;
      return etat.heros.find(h => h.id === ordre[t.index]) || null;
    }

    // Panneau sous la barre : à qui le tour, et les boutons utiles à ce moment.
    function dessinerTour() {
      const t = etat.tour || { numero: 1, index: 0 };
      const ordre = etat.ordre || [];
      const actif = herosActif();
      conteneur.querySelector('#pl-ordre').innerHTML =
        ordre.map((hid, n) => {
          const h = etat.heros.find(k => k.id === hid);
          return `<li class="${n === t.index ? 'en-cours' : ''}${h.corps === 0 ? ' a-terre' : ''}"><button class="puce-heros" data-fiche="${hid}" aria-label="Fiche : ${h.nom}">
            <span class="pastille h-${hid}"></span>${h.court}<span class="pc">♥${h.corps ?? '?'}</span></button></li>`;
        }).join('')
        + `<li class="zargon ${t.index >= ordre.length ? 'en-cours' : ''}" title="Zargon">Z</li>`;

      conteneur.querySelectorAll('[data-fiche]').forEach(b => b.addEventListener('click', () => ouvrirFiche(b.dataset.fiche)));
      const p = conteneur.querySelector('#pl-tour');
      conteneur.querySelector('#pl-haut').classList.toggle('saisie', ciblage && !vueMJ);
      if (vueMJ) { p.innerHTML = '<span class="discret">Vue MJ : le tour de jeu est en pause.</span>'; return; }
      let html = `<span class="titre-tour">T${t.numero} · `;
      if (!actif) {
        const z = etat.zargon || {};
        if (z.plan || z.defense || conclusion) {
          html += `<strong>Zargon</strong> <span class="discret">· monstre ${Math.min(z.n + 1, z.file?.length || 0)} / ${z.file?.length || 0}</span></span>`;
        } else {
          html += `<strong>Zargon</strong></span>
            <span class="discret">${z.file?.length ? 'Tous les monstres ont joué.' : 'Aucun monstre actif.'}</span>
            <button id="tr-fin-zargon" class="principal">Fin du tour de Zargon</button>`;
        }
      } else if (ciblage) {
        html += `<strong>${actif.nom}</strong></span>
          <span>Touchez le monstre à attaquer.</span>
          <button id="tr-retour-attaque">Retour</button>`;
      } else {
        // Bandeau réduit : les choix détaillés sont dans la fenêtre « Actions ».
        html += `<strong>${actif.nom}</strong></span>
          ${t.deplacement ? `<span class="compteur" title="cases restantes">${t.deplacement.restant} case${t.deplacement.restant > 1 ? 's' : ''}</span>` : ''}
          <button id="tr-actions">Actions / Déplacement</button>
          <button id="tr-fin-tour" class="principal">Fin du tour</button>`;
      }
      p.innerHTML = html;
      const sur = (sel, f) => p.querySelector(sel)?.addEventListener('click', f);
      sur('#tr-actions', () => { fenetreActions = 'menu'; dessiner(); });
      sur('#tr-fin-tour', finDuTour);
      sur('#tr-fin-zargon', finTourZargon);
      sur('#tr-retour-attaque', () => { ciblage = false; msg(''); dessiner(); });
    }

    // Fenêtre « Actions » du héros actif : null (fermée), 'menu' (choix) ou 'des' (total des dés).
    let fenetreActions = null;

    function commencerDeplacement() {
      fenetreActions = 'des'; ciblage = false; combat = null; conclusion = null;
      const actif = herosActif();
      // Écart n° 1 : un seul déplacement par tour. On avertit, on ne bloque pas.
      msg(etat.tour.aBouge
        ? `⚠ ${actif.nom} s’est déjà déplacé ce tour-ci (règle : un seul déplacement par tour). Vous pouvez continuer.`
        : `Lancez les 2 dés rouges pour ${actif.nom}, puis touchez le total.`);
      dessiner();
    }

    function choisirTotal(n) {
      fenetreActions = null;
      const hid = herosActif().id;
      modifier(e => {
        const k = e.heros.find(z => z.id === hid);
        // Sorts « au prochain déplacement » : ils s'appliquent à ce déplacement, puis disparaissent.
        const effets = { brume: !!k.brume, traverse: !!k.traverse };
        delete k.brume; delete k.traverse; delete k.ventVif;
        e.tour.deplacement = { total: n, restant: n, effets };
        e.tour.aBouge = true;
      });
      msg(`${herosActif().nom} peut avancer de ${n} cases : touchez les cases une par une.`);
    }

    function avancer({ x, y }) {
      const actif = herosActif();
      const effets = etat.tour.deplacement?.effets || {};
      const raison = raisonDeplacementSort(actif, x, y, effets);
      if (raison) return msg(raison);
      const monstreLa = etat.monstres.some(m => m.x === x && m.y === y);
      if (monstreLa && etat.tour.deplacement.restant === 1)
        return msg('Voile de brume : on traverse la case d’un monstre, mais on ne peut pas s’y arrêter.');
      // Piège connu sur la case : on propose de sauter (ou de descendre dans la fosse).
      const piege = Plateau.piegeEn(etat, x, y);
      if (piege && (piege.trouve || piege.declenche)) {
        evenement = { genre: 'saut', piege: piege.id, depuis: [actif.x, actif.y], dir: [x - actif.x, y - actif.y] };
        return dessiner();
      }
      const surHeros = Plateau.autreHerosEn(etat, actif.id, x, y);
      if (surHeros && etat.tour.deplacement.restant === 1)
        return msg(`Dernière case : on ne peut pas s’arrêter sur la case de ${surHeros.nom}.`);
      const depuis = [actif.x, actif.y];
      modifier(e => {
        const h = e.heros.find(k => k.id === actif.id);
        h.x = x; h.y = y;
        e.tour.deplacement.restant -= 1;
        if (e.tour.deplacement.restant <= 0) e.tour.deplacement = null;
      });
      // Piège caché : il se déclenche sous les pieds du héros.
      if (piege) return declencherPiege(piege.id, depuis, [x - depuis[0], y - depuis[1]]);
      msg(etat.tour.deplacement ? (surHeros ? `${actif.nom} passe la case de ${surHeros.nom}.` : '') : `${actif.nom} a utilisé tout son déplacement.`);
    }

    // Raison de refuser un pas, en tenant compte des sorts de déplacement en cours.
    function raisonDeplacementSort(h, x, y, effets) {
      if (!effets.brume && !effets.traverse) return Plateau.raisonBlocage(g, etat, h.x, h.y, x, y);
      if (x < 0 || y < 0 || x >= L || y >= H) return 'Hors du plateau.';
      if (Math.abs(x - h.x) + Math.abs(y - h.y) !== 1) return 'Une case à la fois, sans diagonale : touchez une case voisine du héros.';
      if (g.zones[Plateau.idx(L, x, y)] === '#') return 'Roche : impossible de passer.';
      if (Plateau.eboulementEn(etat, x, y)) return 'Un éboulement bloque le passage pour toujours.';
      if (!effets.traverse && !Plateau.ouvert(g, etat, Plateau.idx(L, h.x, h.y), Plateau.idx(L, x, y))) return 'Un mur ou une porte fermée bloque le passage.';
      if (!effets.brume && etat.monstres.some(m => m.x === x && m.y === y)) return 'Un monstre bloque le passage.';
      const meuble = Plateau.meubleEn(g, x, y);
      if (meuble) return `${meuble.nom} : on ne peut pas passer par-dessus.`;
      return null;
    }

    // Arrêter le déplacement avant d'avoir tout utilisé (permis par les règles).
    function terminerDeplacement() {
      const actif = herosActif();
      if (etat.monstres.some(m => m.x === actif.x && m.y === actif.y)) return msg('Voile de brume : on ne peut pas s’arrêter sur la case d’un monstre.');
      const autre = Plateau.autreHerosEn(etat, actif.id, actif.x, actif.y);
      if (autre) return msg(`On ne peut pas s’arrêter sur la case de ${autre.nom} : avancez encore d’une case.`);
      fenetreActions = null;
      modifier(e => { e.tour.deplacement = null; });
      msg(`${actif.nom} s’arrête.`);
    }

    function finDuTour() {
      const actif = herosActif();
      if (etat.monstres.some(m => m.x === actif.x && m.y === actif.y)) return msg('On ne peut pas s’arrêter sur la case d’un monstre : avancez encore.');
      if (etat.tour.deplacement) {
        const autre = Plateau.autreHerosEn(etat, actif.id, actif.x, actif.y);
        if (autre) return msg(`On ne peut pas s’arrêter sur la case de ${autre.nom} : avancez encore d’une case.`);
      }
      fenetreActions = null; ciblage = false; combat = null; conclusion = null; evenement = null;
      modifier(e => {
        const k = e.heros.find(z => z.id === actif.id);
        if (k) delete k.passeTour; // la Tempête ne dure qu'un tour
        e.tour = { numero: e.tour.numero, index: e.tour.index + 1 };
        if (e.tour.index >= (e.ordre || []).length) demarrerZargon(e);
      });
      const suivant = herosActif();
      msg(suivant ? `À ${suivant.nom} de jouer.` : '');
    }

    function finTourZargon() {
      conclusion = null;
      modifier(e => { e.tour = { numero: e.tour.numero + 1, index: 0 }; delete e.zargon; });
      msg(`Tour ${etat.tour.numero} : à ${herosActif()?.nom ?? '?'} de jouer.`);
    }

    /* ---------- Invite « ouvrir la porte ? » ----------
       Quand le héros actif se trouve contre une porte fermée qu'il connaît
       (porte normale, ou porte secrète déjà trouvée), on lui propose de l'ouvrir. */

    const refusees = new Set(); // « porte@x,y » : pas de nouvelle question tant que le héros reste là

    function porteProposee() {
      const h = herosActif();
      if (!h || vueMJ || fenetreActions || ciblage || combat || conclusion || evenement) return null;
      return (quete.portes || []).find(p =>
        !etat.portesOuvertes.includes(p.id) && Plateau.porteVisible(etat, p) &&
        [p.a, p.b].some(([x, y]) => x === h.x && y === h.y) &&
        !refusees.has(`${p.id}@${h.x},${h.y}`)) || null;
    }

    function dessinerInvite() {
      const boite = conteneur.querySelector('#pl-invite');
      const p = porteProposee();
      if (!p) { boite.hidden = true; return; }
      const h = herosActif();
      boite.innerHTML = `<span>${p.secrete ? 'Porte secrète' : 'Une porte'} contre ${echapperTexte(h.nom)}. L’ouvrir ?</span>
        <button id="inv-ouvrir" class="principal">Ouvrir</button>
        <button id="inv-non">Pas maintenant</button>`;
      boite.hidden = false;
      boite.querySelector('#inv-ouvrir').addEventListener('click', () => {
        modifier(e => { e.portesOuvertes.push(p.id); });
        msg(`${h.nom} ouvre la porte.`);
      });
      boite.querySelector('#inv-non').addEventListener('click', () => {
        refusees.add(`${p.id}@${h.x},${h.y}`);
        dessiner();
      });
    }

    /* ---------- Tour de Zargon ----------
       Les monstres déjà vus jouent un par un, le plus proche des héros d'abord.
       Pour chacun : fenêtre d'ambiance (Suivant / Passer) → déplacement animé sur
       le plateau → s'il touche un héros : fenêtre de duel, l'application lance les
       dés d'attaque du monstre, le joueur indique ses boucliers blancs → conclusion. */

    // Nom affiché : un monstre dans le brouillard reste anonyme.
    function nomVisible(m, e = etat) {
      return e.revele.includes(Plateau.idx(L, m.x, m.y)) ? infoMonstre(m.type).nom : 'Un monstre dans l’ombre';
    }

    function demarrerZargon(e) {
      const vivants = e.heros.filter(h => h.x != null && h.corps !== 0);
      const distance = m => Math.min(...vivants.map(h => Math.abs(h.x - m.x) + Math.abs(h.y - m.y)), 999);
      const file = e.monstres.filter(m => m.vu).sort((a, b) => distance(a) - distance(b)).map(m => m.id);
      e.zargon = { file, n: 0, plan: null, defense: null, debut: Ambiance.tirer('debutZargon') };
      preparerZargon(e);
    }

    // Calcule le plan du monstre suivant (en sautant ceux qui ont été vaincus entre-temps),
    // avec son message d'ambiance (gardé dans l'état pour rester le même après un rechargement).
    function preparerZargon(e) {
      const z = e.zargon;
      z.plan = null;
      while (z.n < z.file.length) {
        const m = e.monstres.find(k => k.id === z.file[z.n]);
        if (!m) { z.n++; continue; }
        const nomM = infoMonstre(m.type).nom;
        if (m.passeTour) { z.plan = { monstre: m.id, statut: 'tempete', ambiance: `La tempête enveloppe ${nomM} : il passe son tour.` }; return; }
        let reveil = '';
        if (m.endormi) {
          const de = 1 + Math.floor(Math.random() * 6);
          if (de !== 6) { z.plan = { monstre: m.id, statut: 'dort', de, ambiance: Ambiance.tirer('dort', { monstre: nomM }) }; return; }
          delete m.endormi; // réveillé au début de son tour : il agit dans ce même tour (décision du 4/11/2026)
          reveil = Ambiance.tirer('reveil', { monstre: nomM }) + ' ';
        }
        const dep = Regles.valeurMonstre(caracs, m, 'deplacement');
        if (dep === null || Regles.valeurMonstre(caracs, m, 'attaque') === null) { z.plan = { monstre: m.id, erreur: true }; return; }
        const plan = { monstre: m.id, ...Plateau.planMonstre(g, e, m, dep) };
        const h = plan.cible && e.heros.find(k => k.id === plan.cible);
        const cat = !e.revele.includes(Plateau.idx(L, m.x, m.y)) ? 'ombre' : !plan.chemin.length ? (h ? 'attaque' : 'immobile') : 'approche';
        plan.ambiance = reveil + Ambiance.tirer(cat, { monstre: infoMonstre(m.type).nom, heros: h?.nom || 'les héros', type: m.type });
        z.plan = plan;
        return;
      }
    }

    function decrirePlan() {
      const p = etat.zargon?.plan;
      if (!p) return '';
      const m = etat.monstres.find(k => k.id === p.monstre);
      const nom = nomVisible(m);
      if (p.erreur) return `${infoMonstre(m.type).nom} : déplacement ou attaque inconnus (Réglages › Caractéristiques).`;
      if (p.statut === 'tempete') return `${nom} passe son tour (Tempête).`;
      if (p.statut === 'dort') return `${nom} dort (dé de réveil : ${p.de}, il fallait un 6).`;
      const h = p.cible && etat.heros.find(k => k.id === p.cible);
      const pas = p.chemin.length;
      if (!pas && h) return `${nom} attaque ${h.nom} sans bouger.`;
      if (!pas) return `${nom} reste sur place.`;
      return `${nom} avance de ${pas} case${pas > 1 ? 's' : ''}` + (h ? ` et attaque ${h.nom}.` : '.');
    }

    let animation = false; // un monstre est en train de se déplacer à l'écran
    const attendre = ms => new Promise(r => setTimeout(r, ms));

    // « Suivant » sur la fenêtre d'ambiance : déplacement animé, puis attaque éventuelle.
    async function validerMonstre() {
      const p = etat.zargon?.plan;
      if (!p || animation) return;
      if (p.erreur) return passerMonstre();
      if (p.statut) {
        modifier(e => { const k = e.monstres.find(q => q.id === p.monstre); if (k) delete k.passeTour; e.zargon.n++; preparerZargon(e); });
        return;
      }
      const m = etat.monstres.find(k => k.id === p.monstre);
      const depart = [m.x, m.y];
      // Animation : on déplace le pion case par case, puis on remet tout en place
      // avant d'enregistrer le coup pour de bon (pour que « Annuler » fonctionne).
      animation = true;
      dessiner();
      for (const [x, y] of p.chemin) { m.x = x; m.y = y; dessiner(); await attendre(260); }
      [m.x, m.y] = depart;
      animation = false;

      let resultat = null;
      modifier(e => {
        const z = e.zargon, k = e.monstres.find(q => q.id === p.monstre);
        if (p.chemin.length) [k.x, k.y] = p.chemin[p.chemin.length - 1];
        if (p.cible) {
          const tirage = Regles.lancer(caracMonstre(k, 'attaque'));
          const cranes = Regles.compter(tirage, 'crane');
          if (cranes > 0) {
            z.defense = { monstre: k.id, heros: p.cible, tirage, cranes, cle: 'z' + Date.now() };
            z.plan = null;
            return;
          }
          // Aucun crâne : le duel s'affiche quand même, avec la conclusion.
          resultat = { genre: 'zargon', heros: p.cible, monstre: k.id, type: k.type, tirage, cranes: 0, blancs: 0, degats: 0, cle: 'z' + Date.now() };
        }
        z.n++; preparerZargon(e);
      });
      if (resultat) {
        const h = etat.heros.find(k => k.id === resultat.heros);
        resultat.ambiance = Ambiance.tirer('heroIndemne', { heros: h.nom, monstre: infoMonstre(resultat.type).nom });
        conclusion = resultat;
      }
      msg(decrireDernierCoup(p));
      dessiner();
    }

    function decrireDernierCoup(p) {
      const m = etat.monstres.find(k => k.id === p.monstre);
      const pas = p.chemin.length;
      return m ? `${nomVisible(m)} ${pas ? `avance de ${pas} case${pas > 1 ? 's' : ''}` : 'reste sur place'}.` : '';
    }

    // Le joueur indique ses boucliers blancs : blessures, puis conclusion.
    function defendre(blancs) {
      const d = etat.zargon?.defense;
      if (!d) return;
      const h = etat.heros.find(k => k.id === d.heros);
      const m = etat.monstres.find(k => k.id === d.monstre);
      const degats = Math.max(0, d.cranes - blancs);
      modifier(e => {
        const k = e.heros.find(z => z.id === d.heros);
        if (degats > 0) delete k.peauRoc;
        k.corps = Math.max(0, (k.corps ?? 0) - degats);
        e.zargon.defense = null;
        e.zargon.n++; preparerZargon(e);
      });
      conclusion = {
        genre: 'zargon', heros: h.id, monstre: m.id, type: m.type, tirage: d.tirage, cranes: d.cranes, blancs, degats, cle: d.cle,
        ambiance: Ambiance.tirer(degats ? 'heroBlesse' : 'heroIndemne', { heros: h.nom, monstre: infoMonstre(m.type).nom }),
      };
      dessiner();
    }

    function passerMonstre() {
      modifier(e => { e.zargon.n++; preparerZargon(e); });
      msg('Monstre passé.');
    }

    /* ---------- Attaque d'un héros ---------- */

    let ciblage = false;  // le joueur doit toucher un monstre
    let combat = null;    // { monstre, ambiance } : duel ouvert, on attend les crânes du héros
    let conclusion = null; // résultat d'un duel, affiché jusqu'à « Suivant »

    // Monstres que le héros actif peut attaquer : visibles, sur une case voisine
    // (pas de diagonale), sans mur ni porte fermée entre les deux.
    function ciblesAttaque() {
      const h = herosActif();
      if (!h) return [];
      const vu = new Set(etat.revele);
      return etat.monstres.filter(m =>
        vu.has(Plateau.idx(L, m.x, m.y)) &&
        Math.abs(m.x - h.x) + Math.abs(m.y - h.y) === 1 &&
        Plateau.ouvert(g, etat, Plateau.idx(L, h.x, h.y), Plateau.idx(L, m.x, m.y)));
    }

    function commencerAttaque() {
      const h = herosActif();
      const cibles = ciblesAttaque();
      if (!cibles.length) return msg('Aucun monstre à portée : il faut un monstre visible sur une case voisine (sans diagonale).');
      if ((etat.tour.actions || 0) >= 1) msg(`⚠ ${h.nom} a déjà fait une action ce tour-ci (règle : une seule action par tour). Vous pouvez continuer.`);
      fenetreActions = null;
      // Un seul monstre à portée : le duel s'ouvre directement.
      if (cibles.length === 1) return choisirCible(cibles[0].id);
      ciblage = true;
      if (!(etat.tour.actions >= 1)) msg('Touchez le monstre à attaquer (entouré de rouge).');
      dessiner();
    }

    function choisirCible(id) {
      if (!ciblesAttaque().some(m => m.id === id)) return msg('Ce monstre n’est pas à portée.');
      const m = etat.monstres.find(k => k.id === id);
      if (Regles.valeurMonstre(caracs, m, 'defense') === null)
        return msg(m.caracs || Regles.infoMonstre(m.type).variable
          ? `Défense de ce ${infoMonstre(m.type).nom} inconnue : la quête ne la donne pas. Corrigez en vue MJ.`
          : `Défense des ${infoMonstre(m.type).nom}s inconnue : remplissez-la dans Réglages › Caractéristiques.`);
      ciblage = false;
      combat = { monstre: id, ambiance: Ambiance.tirer('attaqueHeros', { heros: herosActif().nom, monstre: infoMonstre(m.type).nom }) };
      dessiner();
    }

    // Les crânes du héros moins les boucliers noirs du monstre = points de Vie perdus.
    function resoudreAttaque(cranes) {
      const h = herosActif();
      const m = etat.monstres.find(k => k.id === combat.monstre);
      const nom = infoMonstre(m.type).nom;
      // Monstre endormi : il se réveille sur un 6 et se défend ; sinon il ne se défend pas.
      let noteSommeil = '';
      let nbDef = caracMonstre(m, 'defense');
      if (m.endormi) {
        const de = 1 + Math.floor(Math.random() * 6);
        if (de === 6) noteSommeil = ` (${nom} se réveille sur un 6 et se défend.)`;
        else { nbDef = 0; noteSommeil = ` (${nom} dort — dé de réveil : ${de} — il ne se défend pas.)`; }
      }
      const tirage = Regles.lancer(nbDef);
      const noirs = Regles.compter(tirage, 'noir');
      const degats = Math.max(0, cranes - noirs);
      const vieAvant = m.corps ?? 1;
      const vieApres = Math.max(0, vieAvant - degats);
      const parSort = !!combat?.djinn;
      combat = null;
      modifier(e => {
        if (!parSort) {
          if (e.tour.deplacement) e.tour.deplacement = null; // une action termine le déplacement en cours
          e.tour.actions = (e.tour.actions || 0) + 1;
        }
        const k = e.monstres.find(z => z.id === m.id);
        if (noteSommeil.includes('réveille')) delete k.endormi;
        k.corps = vieApres;
        if (vieApres === 0) e.monstres = e.monstres.filter(z => z.id !== m.id);
      });
      const valeurs = { heros: h.nom, monstre: nom, type: m.type };
      conclusion = {
        genre: 'heros', heros: h.id, monstre: m.id, type: m.type, monstreCourt: infoMonstre(m.type).court,
        tirage, cranes, noirs, degats, vieMonstre: vieApres, vieMonstreMax: m.corpsMax, cle: 'h' + Date.now(), note: noteSommeil,
        ambiance: Ambiance.tirer(vieApres === 0 ? 'mort' : degats ? 'monstreBlesse' : 'monstreIndemne', valeurs),
      };
      msg('');
      dessiner();
    }

    /* ---------- Pièges, sauts, désamorçage et fouilles ----------
       Les joueurs lancent eux-mêmes leurs dés et indiquent le résultat.
       « Ce qui met fin au tour » (piège) est noté : un nouveau déplacement ou une
       nouvelle action restent possibles, avec un avertissement (règle d'arbitrage). */

    let evenement = null; // fenêtre en cours : piège, saut, désamorçage ou résultat de fouille

    const NOMS_PIEGES = { fosse: 'fosse', bloc: 'bloc qui tombe', lance: 'piège à lance' };

    // Termine le déplacement et note que le piège a mis fin au tour du héros.
    function finParPiege(e) { e.tour.deplacement = null; e.tour.aBouge = true; e.tour.finForcee = true; }

    function blesser(e, hid, n) {
      const h = e.heros.find(k => k.id === hid);
      if (n > 0) delete h.peauRoc; // Une peau de roc prend fin à la première blessure
      h.corps = Math.max(0, (h.corps ?? 0) - n);
      return h.corps;
    }

    // Le héros actif vient d'arriver sur un piège (caché, ou saut raté, ou désamorçage raté).
    function declencherPiege(id, depuis, dir) {
      const h = herosActif();
      const p = etat.pieges.find(q => q.id === id);
      const amb = cat => Ambiance.tirer(cat, { heros: h.nom });
      if (p.type === 'fosse') {
        let vie;
        modifier(e => { const q = e.pieges.find(z => z.id === id); q.declenche = q.trouve = true; vie = blesser(e, h.id, 1); finParPiege(e); });
        evenement = { genre: 'fin', titre: 'Une fosse !', ambiance: amb('piegeFosse'),
          texte: `${h.nom} tombe dans la fosse et perd 1 point de Vie (reste ${vie}). Son tour s’arrête. Dans la fosse : un dé de combat de moins (attaque et défense).` };
      } else if (p.type === 'lance') {
        evenement = { genre: 'lance', piege: id, ambiance: amb('piegeLance') };
      } else {
        evenement = { genre: 'bloc', piege: id, depuis, dir, ambiance: amb('piegeBloc') };
      }
      dessiner();
    }

    function resoudreLance(crane) {
      const h = herosActif(), id = evenement.piege;
      let vie;
      modifier(e => {
        e.pieges = e.pieges.filter(z => z.id !== id); // la lance est partie : la case est sûre désormais
        if (crane) { vie = blesser(e, h.id, 1); finParPiege(e); }
      });
      evenement = { genre: 'fin', titre: 'Piège à lance', ambiance: evenement.ambiance,
        texte: crane ? `Touché ! ${h.nom} perd 1 point de Vie (reste ${vie}). Son tour s’arrête.`
          : `${h.nom} esquive la lance et peut continuer son déplacement.` };
      dessiner();
    }

    function resoudreBloc(cranes) {
      const h = herosActif(), ev = evenement;
      let vie;
      modifier(e => { const q = e.pieges.find(z => z.id === ev.piege); q.declenche = q.trouve = true; vie = blesser(e, h.id, cranes); finParPiege(e); });
      evenement = { ...ev, genre: 'blocChoix', degats: cranes, vie };
      dessiner();
    }

    // Après la chute du bloc : le héros va en avant ou en arrière, sur une case libre.
    function casesApresBloc(ev) {
      const p = etat.pieges.find(q => q.id === ev.piege);
      const h = herosActif();
      // On évalue le passage comme si le bloc n'était pas encore là (le héros en sort).
      const sansBloc = { ...etat, pieges: etat.pieges.filter(q => q.id !== p.id) };
      const libre = ([x, y]) => x >= 0 && y >= 0 && x < L && y < H && !Plateau.raisonBlocage(g, sansBloc, p.x, p.y, x, y) && !Plateau.autreHerosEn(etat, h.id, x, y);
      const avant = [p.x + ev.dir[0], p.y + ev.dir[1]];
      const choix = [];
      if (libre(avant)) choix.push({ nom: 'En avant', c: avant });
      if (libre(ev.depuis)) choix.push({ nom: 'En arrière', c: ev.depuis });
      if (!choix.length) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (libre([p.x + dx, p.y + dy])) choix.push({ nom: 'Sur le côté', c: [p.x + dx, p.y + dy] });
      return choix;
    }

    function allerApresBloc(c) {
      const h = herosActif(), ev = evenement;
      modifier(e => { const k = e.heros.find(z => z.id === h.id); [k.x, k.y] = c; });
      evenement = { genre: 'fin', titre: 'Éboulement', ambiance: ev.ambiance,
        texte: `${ev.degats ? `${h.nom} perd ${ev.degats} point${ev.degats > 1 ? 's' : ''} de Vie (reste ${ev.vie}).` : `${h.nom} s’en tire sans une égratignure.`}`
          + ' La case est bloquée pour toujours. Son tour s’arrête.' };
      dessiner();
    }

    // Saut par-dessus un piège connu : 2 cases de déplacement et une case libre au-delà.
    function infosSaut(ev) {
      const h = herosActif();
      const p = etat.pieges.find(q => q.id === ev.piege);
      const au_dela = [p.x + ev.dir[0], p.y + ev.dir[1]];
      const restant = etat.tour.deplacement?.restant || 0;
      const libre = !Plateau.raisonBlocage(g, etat, p.x, p.y, ...au_dela) && !Plateau.autreHerosEn(etat, h.id, ...au_dela);
      return { p, au_dela, possible: restant >= 2 && libre && !(p.type === 'bloc' && p.declenche), restant, libre };
    }

    function sauter(crane) {
      const h = herosActif(), ev = evenement;
      const { p, au_dela } = infosSaut(ev);
      if (!crane) {
        modifier(e => {
          const k = e.heros.find(z => z.id === h.id); [k.x, k.y] = au_dela;
          e.tour.deplacement.restant -= 2;
          if (e.tour.deplacement.restant <= 0) e.tour.deplacement = null;
        });
        evenement = null;
        msg(`${h.nom} saute par-dessus le piège !`);
        return dessiner();
      }
      // Saut raté : le héros tombe sur le piège, qui se déclenche.
      modifier(e => { const k = e.heros.find(z => z.id === h.id); [k.x, k.y] = [p.x, p.y]; });
      if (p.type === 'lance') { evenement = { genre: 'lance', piege: p.id, ambiance: Ambiance.tirer('piegeLance', { heros: h.nom }) }; return resoudreLance(true); }
      if (p.type === 'fosse' && p.declenche) {
        let vie;
        modifier(e => { vie = blesser(e, h.id, 1); finParPiege(e); });
        evenement = { genre: 'fin', titre: 'Saut manqué', ambiance: Ambiance.tirer('piegeFosse', { heros: h.nom }),
          texte: `${h.nom} retombe au fond de la fosse et perd 1 point de Vie (reste ${vie}). Son tour s’arrête.` };
        return dessiner();
      }
      declencherPiege(p.id, ev.depuis, ev.dir);
    }

    // Descendre volontairement dans une fosse ouverte (1 point de Vie).
    function descendreFosse() {
      const h = herosActif();
      const { p } = infosSaut(evenement);
      let vie;
      modifier(e => { const k = e.heros.find(z => z.id === h.id); [k.x, k.y] = [p.x, p.y]; vie = blesser(e, h.id, 1); finParPiege(e); });
      evenement = { genre: 'fin', titre: 'Dans la fosse', ambiance: '', texte: `${h.nom} descend dans la fosse et perd 1 point de Vie (reste ${vie}). Son tour s’arrête.` };
      dessiner();
    }

    // Marcher exprès sur un piège connu mais pas encore déclenché.
    function marcherSurPiege() {
      const h = herosActif(), ev = evenement;
      const { p } = infosSaut(ev);
      modifier(e => {
        const k = e.heros.find(z => z.id === h.id); [k.x, k.y] = [p.x, p.y];
        e.tour.deplacement.restant -= 1;
        if (e.tour.deplacement.restant <= 0) e.tour.deplacement = null;
      });
      declencherPiege(p.id, ev.depuis, ev.dir);
    }

    /* Désamorcer (action) : piège repéré sur une case voisine ; il faut une trousse à
       outils, ou être le nain. Le héros s'avance sur le piège et lance 1 dé :
       échec sur un crâne (trousse) ou sur un bouclier noir (nain). */
    function piegesDesamorcables() {
      const h = herosActif();
      if (!h) return [];
      const nain = (h.classe || h.id) === 'nain';
      const trousse = (h.inventaire || []).some(o => /trousse/i.test(o.nom));
      if (!nain && !trousse) return [];
      return (etat.pieges || []).filter(p => p.trouve && !p.declenche
        && Math.abs(p.x - h.x) + Math.abs(p.y - h.y) === 1
        && Plateau.ouvert(g, etat, Plateau.idx(L, h.x, h.y), Plateau.idx(L, p.x, p.y)));
    }

    function resoudreDesamorcage(face) {
      const h = herosActif(), ev = evenement;
      const nain = (h.classe || h.id) === 'nain';
      const p = etat.pieges.find(q => q.id === ev.piege);
      const echec = nain ? face === 'noir' : face === 'crane';
      const depuis = [h.x, h.y], dir = [p.x - h.x, p.y - h.y];
      modifier(e => {
        if (e.tour.deplacement) e.tour.deplacement = null;
        e.tour.actions = (e.tour.actions || 0) + 1;
        const k = e.heros.find(z => z.id === h.id); [k.x, k.y] = [p.x, p.y];
        if (!echec) e.pieges = e.pieges.filter(z => z.id !== p.id);
      });
      if (!echec) {
        evenement = { genre: 'fin', titre: 'Piège désamorcé', ambiance: Ambiance.tirer('desamorceOk', { heros: h.nom }),
          texte: `Le piège (${NOMS_PIEGES[p.type]}) est désamorcé : la case est sûre.` };
        return dessiner();
      }
      msg(Ambiance.tirer('desamorceRate', { heros: h.nom }));
      if (p.type === 'lance') { evenement = { genre: 'lance', piege: p.id, ambiance: '' }; return resoudreLance(true); }
      declencherPiege(p.id, depuis, dir);
    }

    // Fouilles (action) : portes secrètes ou pièges, sur les cases visibles de la pièce ou du couloir.
    function monstreVisible() {
      return etat.monstres.some(m => etat.revele.includes(Plateau.idx(L, m.x, m.y)));
    }

    function fouiller(genre) {
      const h = herosActif();
      const avert = [];
      if ((etat.tour.actions || 0) >= 1) avert.push(`${h.nom} a déjà fait une action ce tour-ci.`);
      if (monstreVisible()) avert.push('Un monstre est visible : la règle interdit de fouiller.');
      const portee = Plateau.porteeDe(partie.reglages);
      const trouves = genre === 'portes' ? Plateau.fouillerPortes(g, etat, h, portee) : Plateau.fouillerPieges(g, etat, h, portee);
      // Meubles piégés repérés par la fouille de pièges.
      const zone = Plateau.casesFouillables(g, etat, h, portee);
      const meubles = genre === 'portes' ? [] : (quete.mobilier || []).filter(m => {
        const st = etat.piegesMobilier[m.id];
        return m.piege && st && !st.trouve && !st.declenche && !st.desamorce && casesMeuble(m).some(c => zone.has(c));
      });
      modifier(e => {
        if (e.tour.deplacement) e.tour.deplacement = null;
        e.tour.actions = (e.tour.actions || 0) + 1;
        if (genre === 'portes') e.secretesTrouvees.push(...trouves);
        else for (const id of trouves) e.pieges.find(z => z.id === id).trouve = true;
        for (const m of meubles) e.piegesMobilier[m.id].trouve = true;
      });
      trouves.push(...meubles.map(m => 'meuble:' + m.id));
      const n = trouves.length;
      const texte = genre === 'portes'
        ? (n ? `${n} porte${n > 1 ? 's' : ''} secrète${n > 1 ? 's' : ''} découverte${n > 1 ? 's' : ''} !` : 'Aucune porte secrète ici.')
        : (n ? `${n} piège${n > 1 ? 's' : ''} repéré${n > 1 ? 's' : ''} : ${trouves.map(id => id.startsWith('meuble:')
            ? `${quete.mobilier.find(m => 'meuble:' + m.id === id).nom} piégé`
            : NOMS_PIEGES[etat.pieges.find(z => z.id === id).type]).join(', ')}.` : 'Aucun piège ici.');
      evenement = {
        genre: 'fin', titre: genre === 'portes' ? 'Fouille : portes secrètes' : 'Fouille : pièges',
        texte, avertissement: avert.length ? '⚠ ' + avert.join(' ') + ' (Fouille faite quand même.)' : '',
        ambiance: Ambiance.tirer(n ? (genre === 'portes' ? 'fouillePorte' : 'fouillePiege') : 'fouilleRien', { heros: h.nom }),
      };
      dessiner();
    }

    /* ---------- Fouille de trésor, pioche, monstre errant, meubles piégés ----------
       Trésor propre à la pièce (quête) pour le premier qui fouille ; sinon une carte :
       pioche virtuelle (cartes saisies dans les Réglages) ou vraie carte piochée.
       Un meuble piégé non désamorcé se déclenche à la fouille de trésor. */

    const cartesTresor = options.cartesTresor || [];

    function casesMeuble(m) {
      const res = [];
      for (let dx = 0; dx < (m.l || 1); dx++) for (let dy = 0; dy < (m.h || 1); dy++) res.push(Plateau.idx(L, m.x + dx, m.y + dy));
      return res;
    }

    function fouillerTresor() {
      const h = herosActif();
      const piece = Plateau.pieceDe(g, h.x, h.y);
      if (!piece) return msg('Les trésors ne se trouvent que dans les pièces, pas dans les couloirs.');
      const avert = [];
      if ((etat.tour.actions || 0) >= 1) avert.push(`${h.nom} a déjà fait une action ce tour-ci.`);
      if (etat.monstres.some(m => Plateau.pieceDe(g, m.x, m.y) === piece && etat.revele.includes(Plateau.idx(L, m.x, m.y))))
        avert.push('Un monstre est dans la pièce : la règle interdit de fouiller.');
      if ((etat.fouillesTresor[h.id] || []).includes(piece)) avert.push(`${h.nom} a déjà fouillé cette pièce (une fois par héros).`);
      const avertissement = avert.length ? '⚠ ' + avert.join(' ') + ' (Fouille faite quand même.)' : '';
      const piegeants = (quete.mobilier || []).filter(m => m.piege && Plateau.pieceDe(g, m.x, m.y) === piece
        && !etat.piegesMobilier[m.id]?.desamorce && !etat.piegesMobilier[m.id]?.declenche);
      const degats = piegeants.reduce((t, m) => t + (m.piege.degats || 0), 0);
      let tresor = null, vie;
      modifier(e => {
        if (e.tour.deplacement) e.tour.deplacement = null;
        e.tour.actions = (e.tour.actions || 0) + 1;
        (e.fouillesTresor[h.id] = e.fouillesTresor[h.id] || []).push(piece);
        if (piegeants.length) {
          for (const m of piegeants) e.piegesMobilier[m.id] = { ...e.piegesMobilier[m.id], declenche: true, trouve: true };
          vie = blesser(e, h.id, degats);
          finParPiege(e);
          return;
        }
        const t = quete.tresors?.[piece];
        if (t && !e.tresorsPris.includes(piece)) {
          e.tresorsPris.push(piece);
          const k = e.heros.find(z => z.id === h.id);
          if (t.or) k.or = (k.or || 0) + t.or;
          for (const o of t.objets || []) (k.inventaire = k.inventaire || []).push({ nom: o });
          tresor = t;
        }
      });
      if (piegeants.length) {
        evenement = { genre: 'fin', titre: 'Meuble piégé !', avertissement, ambiance: Ambiance.tirer('piegeMeuble', { heros: h.nom }),
          texte: piegeants.map(m => `${m.nom} : ${m.piege.texte || 'piège !'}`).join(' ')
            + (degats ? ` ${h.nom} perd ${degats} point${degats > 1 ? 's' : ''} de Vie (reste ${vie}).` : '') + ' Son tour s’arrête ; pas de trésor cette fois.' };
      } else if (tresor) {
        evenement = { genre: 'fin', titre: 'Trésor !', avertissement, ambiance: Ambiance.tirer('tresorTrouve', { heros: h.nom }),
          texte: [tresor.texte, tresor.or ? `+${tresor.or} pièces d’or.` : '', (tresor.objets || []).length ? `Dans l’inventaire : ${tresor.objets.join(', ')}.` : ''].filter(Boolean).join(' ') };
      } else {
        evenement = { genre: 'pioche', avertissement };
      }
      dessiner();
    }

    function finCarte(titre, texte, cat = 'tresorTrouve') {
      const h = herosActif();
      evenement = { genre: 'fin', titre, texte, ambiance: cat ? Ambiance.tirer(cat, { heros: h.nom }) : '' };
      dessiner();
    }

    // Pioche virtuelle : or, potions et objets sortent de la pioche jusqu'à la quête suivante ;
    // monstres errants, dangers et cartes « rien » y retournent (pioche remélangée).
    function piocherVirtuelle() {
      const pioche = etat.pioche || cartesTresor.flatMap((c, i) => Array(Math.max(1, c.nombre || 1)).fill(i));
      if (!pioche.length) return finCarte('Pioche vide', 'Toutes les cartes « or » et « potion/objet » ont été prises pendant cette quête.', 'tresorRien');
      const k = Math.floor(Math.random() * pioche.length);
      const carte = cartesTresor[pioche[k]];
      modifier(e => {
        e.pioche = pioche.slice();
        if (['or', 'potion', 'objet'].includes(carte.type)) e.pioche.splice(k, 1);
      });
      appliquerCarte(carte);
    }

    function appliquerCarte(carte) {
      const h = herosActif();
      const titre = carte.nom ? `Carte : ${carte.nom}` : 'Carte trésor';
      const texte = carte.texte ? carte.texte + ' ' : '';
      if (carte.type === 'or') {
        modifier(e => { const k = e.heros.find(z => z.id === h.id); k.or = (k.or || 0) + (carte.valeur || 0); });
        return finCarte(titre, `${texte}+${carte.valeur || 0} pièces d’or pour ${h.nom}.`);
      }
      if (carte.type === 'potion' || carte.type === 'objet') {
        modifier(e => { const k = e.heros.find(z => z.id === h.id); (k.inventaire = k.inventaire || []).push({ nom: carte.nom || 'Objet' }); });
        return finCarte(titre, `${texte}« ${carte.nom || 'Objet'} » ajouté à l’inventaire de ${h.nom}.`);
      }
      if (carte.type === 'danger') {
        let vie;
        modifier(e => { vie = blesser(e, h.id, carte.valeur || 0); });
        return finCarte(titre, `${texte}${carte.valeur ? `${h.nom} perd ${carte.valeur} point${carte.valeur > 1 ? 's' : ''} de Vie (reste ${vie}).` : ''}`, null);
      }
      if (carte.type === 'errant') return monstreErrant();
      modifier(() => {}); // pour garder la trace de la pioche dans l'historique
      finCarte(titre, `${texte}Rien de plus.`, 'tresorRien');
    }

    // Vraie carte piochée : le joueur dit ce qu'elle donne.
    function carteReelle(type) {
      if (type === 'or') {
        const n = parseInt(prompt('Combien de pièces d’or ?', '25'), 10);
        if (!Number.isFinite(n)) return;
        return appliquerCarte({ type: 'or', valeur: Math.max(0, n) });
      }
      if (type === 'objet') {
        const nom = prompt('Nom de la potion ou de l’objet :');
        if (!nom || !nom.trim()) return;
        return appliquerCarte({ type: 'objet', nom: nom.trim().slice(0, 80) });
      }
      if (type === 'danger') {
        const n = parseInt(prompt('Points de Vie perdus (0 si aucun) :', '0'), 10);
        if (!Number.isFinite(n)) return;
        return appliquerCarte({ type: 'danger', nom: 'Danger', valeur: Math.max(0, n) });
      }
      appliquerCarte({ type });
    }

    function monstreErrant(type = quete.monstreErrant) {
      if (!type) { evenement = { genre: 'choixErrant' }; return dessiner(); }
      const h = herosActif();
      const c = Plateau.caseLibreProche(g, etat, h.x, h.y);
      const nom = infoMonstre(type).nom;
      if (!c) return finCarte('Monstre errant', `Un ${nom} rôde, mais il n’y a aucune place pour lui. (Posez-le en vue MJ.)`, null);
      const id = 'err' + Date.now();
      let m;
      modifier(e => {
        m = { id, type, x: c[0], y: c[1], vu: true };
        const v = Regles.valeurMonstre(caracs, m, 'corps');
        if (v !== null) m.corps = m.corpsMax = v;
        e.monstres.push(m);
      });
      const ambiance = Ambiance.tirer('errant', { heros: h.nom, monstre: nom });
      const att = caracMonstre(m, 'attaque');
      if (att === null) return finCarte('Monstre errant !', `${nom} surgit à côté de ${h.nom}. (Attaque inconnue : Réglages › Caractéristiques.)`, null);
      const tirage = Regles.lancer(att);
      const cranes = Regles.compter(tirage, 'crane');
      evenement = cranes
        ? { genre: 'defenseErrant', monstre: id, tirage, cranes, cle: 'e' + Date.now(), ambiance }
        : { genre: 'fin', titre: 'Monstre errant !', ambiance, texte: `${nom} surgit et attaque ${h.nom} : ${Regles.afficher(tirage)} — aucun crâne, aucune blessure.` };
      dessiner();
    }

    function defendreErrant(blancs) {
      const h = herosActif(), ev = evenement;
      const m = etat.monstres.find(k => k.id === ev.monstre);
      const degats = Math.max(0, ev.cranes - blancs);
      let vie;
      modifier(e => { vie = blesser(e, h.id, degats); });
      evenement = { genre: 'fin', titre: 'Monstre errant', ambiance: Ambiance.tirer(degats ? 'heroBlesse' : 'heroIndemne', { heros: h.nom, monstre: infoMonstre(m.type).nom }),
        texte: `${ev.cranes} crâne${ev.cranes > 1 ? 's' : ''} contre ${blancs} bouclier${blancs > 1 ? 's' : ''} blanc${blancs > 1 ? 's' : ''} : `
          + (degats ? `${h.nom} perd ${degats} point${degats > 1 ? 's' : ''} de Vie (reste ${vie}).` : 'aucune blessure.')
          + (vie === 0 ? ` ⚠ ${h.nom} n’a plus de points de Vie : il meurt, sauf potion ou sort de soin.` : '') };
      dessiner();
    }

    // Meubles piégés repérés que le héros actif peut désamorcer (case voisine, trousse ou nain).
    function meublesDesamorcables() {
      const h = herosActif();
      if (!h) return [];
      const nain = (h.classe || h.id) === 'nain';
      const trousse = (h.inventaire || []).some(o => /trousse/i.test(o.nom));
      if (!nain && !trousse) return [];
      const ici = Plateau.idx(L, h.x, h.y);
      return (quete.mobilier || []).filter(m => {
        const st = etat.piegesMobilier[m.id];
        return m.piege && st?.trouve && !st.desamorce && !st.declenche && casesMeuble(m).some(c =>
          Math.abs((c % L) - h.x) + Math.abs(Math.floor(c / L) - h.y) === 1 && Plateau.ouvert(g, etat, ici, c));
      });
    }

    function resoudreDesamorcageMeuble(face) {
      const h = herosActif(), ev = evenement;
      const nain = (h.classe || h.id) === 'nain';
      const m = quete.mobilier.find(k => k.id === ev.meuble);
      const echec = nain ? face === 'noir' : face === 'crane';
      let vie;
      modifier(e => {
        if (e.tour.deplacement) e.tour.deplacement = null;
        e.tour.actions = (e.tour.actions || 0) + 1;
        if (echec) { e.piegesMobilier[m.id].declenche = true; vie = blesser(e, h.id, m.piege.degats || 0); finParPiege(e); }
        else e.piegesMobilier[m.id].desamorce = true;
      });
      evenement = echec
        ? { genre: 'fin', titre: 'Raté !', ambiance: Ambiance.tirer('desamorceRate', { heros: h.nom }),
            texte: `${m.piege.texte || 'Le piège se déclenche !'} ${m.piege.degats ? `${h.nom} perd ${m.piege.degats} point${m.piege.degats > 1 ? 's' : ''} de Vie (reste ${vie}).` : ''} Son tour s’arrête.` }
        : { genre: 'fin', titre: 'Piège désamorcé', ambiance: Ambiance.tirer('desamorceOk', { heros: h.nom }),
            texte: `${m.nom} n’est plus dangereux : la pièce peut être fouillée pour un trésor.` };
      dessiner();
    }

    // Contenu de la fenêtre d'un événement (dans dessinerModale).
    function htmlEvenement() {
      const h = herosActif();
      if (!h) return '';
      const ev = evenement;
      const tete = `<div class="duel seul">${figurine('gauche', Portraits.heros(h.id, h.court), h.nom, h.corps, h.corpsMax)}</div>`;
      const amb = ev.ambiance ? `<p class="ambiance grande">${echapperTexte(ev.ambiance)}</p>` : '';
      if (ev.genre === 'fin') return `${tete}<p class="titre-zargon">${echapperTexte(ev.titre)}</p>${amb}
        ${ev.avertissement ? `<p class="erreur petit">${echapperTexte(ev.avertissement)}</p>` : ''}
        ${ev.tirage ? `<p class="legende">${echapperTexte(ev.legende || '')}</p>${htmlDes(ev.tirage, ev.cle)}` : ''}
        <div class="${ev.tirage ? 'apres-des' : ''}">
          <p class="resultat">${echapperTexte(ev.texte)}</p>
          <div class="choix"><button id="ev-ok" class="principal">OK</button></div>
        </div>`;
      if (ev.genre === 'cibleSort') return `${tete}${htmlCibles(ev)}`;
      if (ev.genre === 'djinn') return `${tete}${htmlDjinn()}`;
      if (ev.genre === 'questionSort') return `${tete}<p class="titre-zargon">${Sorts.sort(ev.sort).nom}</p>${amb}
        ${ev.avertissement ? `<p class="erreur petit">${echapperTexte(ev.avertissement)}</p>` : ''}
        <p class="question">${echapperTexte(ev.question)}</p>
        <div class="choix">${ev.reponses.map(([v, t]) => `<button data-reponse-sort="${v}">${t}</button>`).join('')}</div>`;
      if (ev.genre === 'reveil') return `${tete}<p class="titre-zargon">${echapperTexte(h.nom)} est endormi</p>
        <p class="question">Lancez 1 dé à six faces : avez-vous fait 6 ?</p>
        <div class="choix"><button data-reveil="1" class="principal">Oui, 6 : réveillé</button><button data-reveil="0">Non</button></div>`;
      if (ev.genre === 'lance') return `${tete}<p class="titre-zargon">Piège à lance !</p>${amb}
        <p class="question">${h.nom} : lancez 1 dé de combat.</p>
        <div class="choix"><button data-lance="1">💀 Crâne</button><button data-lance="0">Pas de crâne</button></div>`;
      if (ev.genre === 'bloc') return `${tete}<p class="titre-zargon">Un bloc tombe !</p>${amb}
        <p class="question">${h.nom} : lancez 3 dés de combat (pas de défense). Combien de crânes ?</p>
        <div class="choix nombres">${[0, 1, 2, 3].map(n => `<button data-bloc="${n}">${n}</button>`).join('')}</div>`;
      if (ev.genre === 'blocChoix') {
        const choix = casesApresBloc(ev);
        return `${tete}<p class="titre-zargon">Éboulement</p>
          <p class="resultat">${ev.degats ? `${ev.degats} crâne${ev.degats > 1 ? 's' : ''} : ${h.nom} perd ${ev.degats} point${ev.degats > 1 ? 's' : ''} de Vie.` : 'Aucun crâne : pas de blessure.'}</p>
          <p class="question">La case devient un mur. Où ${h.nom} se met-il à l’abri ?</p>
          <div class="choix">${choix.map((c, k) => `<button data-abri="${k}">${c.nom}</button>`).join('') || '<span class="erreur">Aucune case libre : corrigez en vue MJ.</span><button id="ev-ok">OK</button>'}</div>`;
      }
      if (ev.genre === 'saut') {
        const info = infosSaut(ev);
        const p = info.p;
        const nom = NOMS_PIEGES[p.type] + (p.declenche ? ' (ouverte)' : '');
        return `${tete}<p class="titre-zargon">Piège connu : ${nom}</p>
          ${info.possible ? `<p class="question">Sauter par-dessus : 2 cases de déplacement. Lancez 1 dé de combat — il ne faut pas de crâne.</p>
              <div class="choix"><button data-saut="0" class="principal">Sauté (pas de crâne)</button><button data-saut="1">💀 Crâne</button></div>`
            : `<p class="discret">${p.type === 'bloc' && p.declenche ? 'Un éboulement bloque le passage.' : `Pour sauter, il faut 2 cases de déplacement (il en reste ${info.restant}) et une case libre au-delà${info.libre ? '' : ' (elle ne l’est pas)'}.`}</p>`}
          <div class="choix">
            ${p.type === 'fosse' && p.declenche ? '<button id="ev-descendre">Descendre dans la fosse (1 point de Vie)</button>' : ''}
            ${!p.declenche ? '<button id="ev-marcher">Marcher dessus quand même</button>' : ''}
            <button id="ev-annuler">Annuler</button>
          </div>`;
      }
      if (ev.genre === 'pioche') return `${tete}<p class="titre-zargon">Fouille : trésor</p>
        ${ev.avertissement ? `<p class="erreur petit">${echapperTexte(ev.avertissement)}</p>` : ''}
        <p>Pas de trésor propre à cette pièce : on pioche une carte trésor.</p>
        ${cartesTresor.length ? '<div class="choix"><button id="ev-piocher" class="principal">Piocher une carte</button></div>'
          : '<p class="discret petit">Pioche virtuelle vide : ajoutez vos cartes dans Réglages › Cartes trésor.</p>'}
        <h3 class="titre-section">Ou : j’ai pioché une vraie carte</h3>
        <div class="choix"><button data-carte="or">Pièces d’or</button><button data-carte="objet">Potion ou objet</button>
          <button data-carte="errant">Monstre errant</button><button data-carte="danger">Danger</button><button data-carte="rien">Rien</button></div>`;
      if (ev.genre === 'choixErrant') return `${tete}<p class="titre-zargon">Monstre errant</p>
        <p class="question">La quête ne précise pas le monstre errant : lequel surgit ?</p>
        <div class="choix">${Regles.TYPES_MONSTRES_REGLES.map(t => `<button data-errant="${t.id}">${t.nom}</button>`).join('')}</div>`;
      if (ev.genre === 'defenseErrant') {
        const m = etat.monstres.find(k => k.id === ev.monstre);
        const n = caracHeros(h, 'defense');
        return `<p class="titre-zargon">Monstre errant !</p>
          <div class="duel">${figurine('gauche', Portraits.heros(h.id, h.court), h.nom, h.corps, h.corpsMax, 'defenseur')}<div class="centre">⚔</div>
            ${figurine('droite', Portraits.monstre(m.type, infoMonstre(m.type).court), infoMonstre(m.type).nom, m.corps, m.corpsMax, 'attaquant')}</div>
          ${amb}
          <p class="legende">Attaque de ${infoMonstre(m.type).nom}</p>
          ${htmlDes(ev.tirage, ev.cle)}
          <div class="apres-des">
            <p class="resultat">${ev.cranes} crâne${ev.cranes > 1 ? 's' : ''} !</p>
            <p class="question">${h.nom} : lancez ${n ?? 'vos'} dé${n > 1 ? 's' : ''} de défense. Combien de boucliers blancs ?</p>
            <div class="choix nombres">${boutonsNombre(n, 'blancs-errant')}</div>
          </div>`;
      }
      if (ev.genre === 'desarmerMeuble') {
        const m = quete.mobilier.find(k => k.id === ev.meuble);
        const nain = (h.classe || h.id) === 'nain';
        return `${tete}<p class="titre-zargon">Désamorcer : ${echapperTexte(m.nom)}</p>
          <p class="question">${h.nom} : lancez 1 dé de combat. Qu’obtenez-vous ?</p>
          <p class="discret petit">Échec sur ${nain ? 'un bouclier noir (talent du nain)' : 'un crâne (trousse à outils)'}.</p>
          <div class="choix"><button data-face-meuble="crane">💀 Crâne</button><button data-face-meuble="blanc">🛡️ Bouclier blanc</button><button data-face-meuble="noir">⚫ Bouclier noir</button></div>
          <div class="choix"><button id="ev-annuler">Annuler</button></div>`;
      }
      if (ev.genre === 'desarmer') {
        const p = etat.pieges.find(q => q.id === ev.piege);
        const nain = (h.classe || h.id) === 'nain';
        return `${tete}<p class="titre-zargon">Désamorcer : ${NOMS_PIEGES[p.type]}</p>
          <p class="question">${h.nom} s’avance sur le piège. Lancez 1 dé de combat : qu’obtenez-vous ?</p>
          <p class="discret petit">Échec sur ${nain ? 'un bouclier noir (talent du nain)' : 'un crâne (trousse à outils)'}.</p>
          <div class="choix"><button data-face="crane">💀 Crâne</button><button data-face="blanc">🛡️ Bouclier blanc</button><button data-face="noir">⚫ Bouclier noir</button></div>
          <div class="choix"><button id="ev-annuler">Annuler</button></div>`;
      }
      return '';
    }

    function brancherEvenement(boite) {
      const sur = (sel, f) => boite.querySelector(sel)?.addEventListener('click', f);
      sur('#ev-ok', () => { evenement = null; dessiner(); });
      sur('#ev-annuler', () => { evenement = null; msg(''); dessiner(); });
      sur('#ev-descendre', descendreFosse);
      sur('#ev-marcher', marcherSurPiege);
      boite.querySelectorAll('[data-lance]').forEach(b => b.addEventListener('click', () => resoudreLance(b.dataset.lance === '1')));
      boite.querySelectorAll('[data-bloc]').forEach(b => b.addEventListener('click', () => resoudreBloc(+b.dataset.bloc)));
      boite.querySelectorAll('[data-abri]').forEach(b => b.addEventListener('click', () => allerApresBloc(casesApresBloc(evenement)[+b.dataset.abri].c)));
      boite.querySelectorAll('[data-saut]').forEach(b => b.addEventListener('click', () => sauter(b.dataset.saut === '1')));
      boite.querySelectorAll('[data-face]').forEach(b => b.addEventListener('click', () => resoudreDesamorcage(b.dataset.face)));
      sur('#ev-piocher', piocherVirtuelle);
      boite.querySelectorAll('[data-cible-sort]').forEach(b => b.addEventListener('click', () => {
        const [genre, id] = b.dataset.cibleSort.split(':');
        lancerSort(evenement.sort, { genre, id });
      }));
      boite.querySelectorAll('[data-reponse-sort]').forEach(b => b.addEventListener('click', () => repondreSort(b.dataset.reponseSort)));
      boite.querySelectorAll('[data-djinn-monstre]').forEach(b => b.addEventListener('click', () => djinnAttaque(b.dataset.djinnMonstre)));
      boite.querySelectorAll('[data-djinn-porte]').forEach(b => b.addEventListener('click', () => djinnPorte(b.dataset.djinnPorte)));
      boite.querySelectorAll('[data-reveil]').forEach(b => b.addEventListener('click', () => {
        const hid = herosActif().id, ok = b.dataset.reveil === '1';
        modifier(e => { if (ok) delete e.heros.find(z => z.id === hid).endormi; });
        evenement = null; msg(ok ? 'Réveillé !' : 'Toujours endormi : il ne peut ni bouger ni agir ce tour-ci.'); dessiner();
      }));
      boite.querySelectorAll('[data-carte]').forEach(b => b.addEventListener('click', () => carteReelle(b.dataset.carte)));
      boite.querySelectorAll('[data-errant]').forEach(b => b.addEventListener('click', () => monstreErrant(b.dataset.errant)));
      boite.querySelectorAll('[data-blancs-errant]').forEach(b => b.addEventListener('click', () => defendreErrant(+b.dataset.blancsErrant)));
      boite.querySelectorAll('[data-face-meuble]').forEach(b => b.addEventListener('click', () => resoudreDesamorcageMeuble(b.dataset.faceMeuble)));
    }

    /* ---------- Sorts ----------
       Lancer un sort est l'action du tour ; chaque sort ne sert qu'une fois par quête.
       La cible doit être visible (les figurines bloquent la vue), sauf Djinn et
       Feu du courroux : sinon, avertissement (principe d'arbitrage). */

    const sortsDe = h => etat.sorts?.[h.id] || [];

    // Effets en cours sur un héros, pour la fiche et la fenêtre Actions.
    function effetsHeros(h) {
      const e = [];
      if (h.courage) e.push('Courage (+2 dés d’attaque)');
      if (h.peauRoc) e.push('Peau de roc (+2 dés de défense)');
      if (h.ventVif) e.push('Vent vif (prochain déplacement : 4 dés)');
      if (h.brume) e.push('Voile de brume (prochain déplacement)');
      if (h.traverse) e.push('Au travers de la pierre (prochain déplacement)');
      if (h.endormi) e.push('Endormi');
      if (h.passeTour) e.push('Passe son prochain tour (Tempête)');
      if (Plateau.fosseEn(etat, h.x, h.y)) e.push('Dans une fosse (−1 dé)');
      return e;
    }

    // Une cible est-elle visible depuis le lanceur ? (les autres figurines bloquent la ligne)
    function cibleVisible(lanceur, f) {
      if (f.x === lanceur.x && f.y === lanceur.y) return true;
      if (!etat.revele.includes(Plateau.idx(L, f.x, f.y))) return false;
      const obstacles = new Set([...etat.heros.filter(h => h.x != null), ...etat.monstres].map(k => Plateau.idx(L, k.x, k.y)));
      obstacles.delete(Plateau.idx(L, lanceur.x, lanceur.y));
      return Plateau.ligneDeVue(g, etat, lanceur.x, lanceur.y, f.x, f.y, obstacles);
    }

    function choisirSort(id) {
      const s = Sorts.sort(id);
      fenetreActions = null;
      evenement = { genre: s.id === 'djinn' ? 'djinn' : 'cibleSort', sort: id };
      dessiner();
    }

    // Marque le sort comme utilisé et compte l'action (avec les avertissements habituels).
    function consommerSort(e, hid, id) {
      const x = e.sorts[hid].find(k => k.id === id);
      if (x) x.utilise = true;
      if (e.tour.deplacement) e.tour.deplacement = null;
      e.tour.actions = (e.tour.actions || 0) + 1;
    }

    function lancerSort(id, cible) { // cible : { genre: 'heros' | 'monstre', id }
      const h = herosActif(), s = Sorts.sort(id);
      const amb = Ambiance.tirer('sort', { heros: h.nom });
      const titre = `${s.nom}`;
      const visee = cible.genre === 'heros' ? etat.heros.find(k => k.id === cible.id) : etat.monstres.find(k => k.id === cible.id);
      const nomC = cible.genre === 'heros' ? visee.nom : infoMonstre(visee.type).nom;
      const avert = [];
      if ((etat.tour.actions || 0) >= 1) avert.push(`${h.nom} a déjà fait une action ce tour-ci.`);
      if (!s.partout && !cibleVisible(h, visee)) avert.push(`${nomC} n’est pas en vue.`);
      const avertissement = avert.length ? '⚠ ' + avert.join(' ') + ' (Sort lancé quand même.)' : '';
      const fin = (texte, extra = {}) => { evenement = { genre: 'fin', titre, ambiance: amb, avertissement, texte, ...extra }; dessiner(); };
      const surHeros = f => modifier(e => { consommerSort(e, h.id, id); f(e.heros.find(k => k.id === cible.id), e); });
      const surMonstre = f => modifier(e => { consommerSort(e, h.id, id); f(e.monstres.find(k => k.id === cible.id), e); });

      switch (id) {
        case 'tempete':
          cible.genre === 'heros' ? surHeros(k => { k.passeTour = true; }) : surMonstre(k => { k.passeTour = true; });
          return fin(`${nomC} passera son prochain tour.`);
        case 'ventVif':
          surHeros(k => { k.ventVif = true; });
          return fin(`Au prochain déplacement, ${nomC} lancera 4 dés rouges.`);
        case 'brume':
          surHeros(k => { k.brume = true; });
          return fin(`Au prochain déplacement, ${nomC} pourra traverser les cases occupées (sans s’y arrêter).`);
        case 'traversPierre':
          surHeros(k => { k.traverse = true; });
          return fin(`Au prochain déplacement, ${nomC} traversera les murs.`);
        case 'courage':
          surHeros(k => { k.courage = true; });
          return fin(`${nomC} gagne 2 dés d’attaque tant qu’un monstre est en vue.`);
        case 'peauRoc':
          surHeros(k => { k.peauRoc = true; });
          return fin(`${nomC} gagne 2 dés de défense jusqu’à sa première blessure.`);
        case 'eauGuerison': case 'guerisonCorps': {
          let gain = 0;
          surHeros(k => { const avant = k.corps ?? 0; k.corps = Math.min(k.corpsMax ?? avant + 4, avant + 4); gain = k.corps - avant; });
          return fin(`${nomC} récupère ${gain} point${gain > 1 ? 's' : ''} de Vie (${visee.corps}${visee.corpsMax ? ' / ' + visee.corpsMax : ''}).`);
        }
        case 'sommeil':
          if (cible.genre === 'monstre') {
            const esprit = Regles.valeurMonstre(caracs, visee, 'esprit') ?? 0;
            const tirage = Regles.lancer(esprit);
            const resiste = tirage.some(f => f === 'blanc' || f === 'noir');
            surMonstre(k => { if (!resiste) k.endormi = true; });
            return fin(resiste ? `${nomC} résiste au sommeil (un bouclier sur ${esprit} dé${esprit > 1 ? 's' : ''}).` : `${nomC} s’endort : il ne bouge plus et ne se défend plus, jusqu’à ce qu’il fasse un 6.`,
              { tirage, cle: 'so' + Date.now(), legende: `Résistance de ${nomC} (1 dé par point d’Esprit)` });
          }
          evenement = { genre: 'questionSort', sort: id, cible, avertissement, ambiance: amb,
            question: `${nomC} résiste avec ${visee.espritMax ?? visee.esprit ?? '?'} dé(s) (1 par point d’Esprit). A-t-il obtenu au moins un bouclier ?`,
            reponses: [['resiste', 'Oui, un bouclier'], ['dort', 'Non']] };
          return dessiner();
        case 'bouleFeu':
          if (cible.genre === 'monstre') {
            const tirage = Regles.lancer(2);
            const degats = Math.max(0, 2 - Regles.compter(tirage, 'crane'));
            const res = degatsMonstre(cible.id, degats, h, e => consommerSort(e, h.id, id));
            return fin(`${nomC} lance 2 dés : chaque crâne réduit la perte. ${degats ? `${degats} point${degats > 1 ? 's' : ''} de Vie perdu${degats > 1 ? 's' : ''}.` : 'Aucune perte !'}${res}`,
              { tirage, cle: 'bf' + Date.now(), legende: `Riposte de ${nomC}` });
          }
          evenement = { genre: 'questionSort', sort: id, cible, avertissement, ambiance: amb,
            question: `${nomC} lance 2 dés de combat : combien de crânes ? (chacun réduit la perte de 1)`, reponses: [['0', '0'], ['1', '1'], ['2', '2']] };
          return dessiner();
        case 'feuCourroux':
          if (cible.genre === 'monstre') {
            const tirage = Regles.lancer(1);
            const pare = tirage.some(f => f === 'blanc' || f === 'noir');
            const res = pare ? '' : degatsMonstre(cible.id, 1, h, e => consommerSort(e, h.id, id));
            if (pare) modifier(e => consommerSort(e, h.id, id));
            return fin(pare ? `${nomC} obtient un bouclier : le feu ne l’atteint pas.` : `${nomC} perd 1 point de Vie.${res}`,
              { tirage, cle: 'fc' + Date.now(), legende: `Dé de ${nomC}` });
          }
          evenement = { genre: 'questionSort', sort: id, cible, avertissement, ambiance: amb,
            question: `${nomC} lance 1 dé de combat : un bouclier ?`, reponses: [['pare', 'Oui, un bouclier'], ['touche', 'Non']] };
          return dessiner();
      }
    }

    // Réponse du joueur quand la cible d'un sort est un héros (il lance lui-même ses dés).
    function repondreSort(r) {
      const ev = evenement, h = herosActif(), s = Sorts.sort(ev.sort);
      const k0 = etat.heros.find(z => z.id === ev.cible.id);
      let texte = '';
      modifier(e => {
        consommerSort(e, h.id, ev.sort);
        const k = e.heros.find(z => z.id === ev.cible.id);
        if (ev.sort === 'sommeil') { if (r === 'dort') k.endormi = true; texte = r === 'dort' ? `${k.nom} s’endort.` : `${k.nom} résiste au sommeil.`; }
        if (ev.sort === 'bouleFeu') { const d = Math.max(0, 2 - +r); const v = blesser(e, k.id, d); texte = d ? `${k.nom} perd ${d} point${d > 1 ? 's' : ''} de Vie (reste ${v}).` : `${k.nom} ne perd rien.`; }
        if (ev.sort === 'feuCourroux') { if (r === 'touche') { const v = blesser(e, k.id, 1); texte = `${k.nom} perd 1 point de Vie (reste ${v}).`; } else texte = `${k.nom} pare le feu.`; }
      });
      evenement = { genre: 'fin', titre: s.nom, ambiance: ev.ambiance, avertissement: ev.avertissement, texte: texte || k0.nom };
      dessiner();
    }

    // Blessures infligées à un monstre par un sort ; renvoie le texte de fin (vaincu…).
    function degatsMonstre(mid, degats, h, avant) {
      const m = etat.monstres.find(k => k.id === mid);
      const nom = infoMonstre(m.type).nom;
      let texte = '';
      modifier(e => {
        avant?.(e);
        const k = e.monstres.find(z => z.id === mid);
        k.corps = Math.max(0, (k.corps ?? 1) - degats);
        if (k.corps === 0) { e.monstres = e.monstres.filter(z => z.id !== mid); texte = ` ${nom} est vaincu ! ${Ambiance.tirer('mort', { monstre: nom, heros: h.nom, type: m.type })}`; }
        else if (degats) texte = ` ${nom} : ${k.corps} point${k.corps > 1 ? 's' : ''} de Vie restant${k.corps > 1 ? 's' : ''}.`;
      });
      return texte;
    }

    // Djinn : attaque n'importe quelle figurine avec 5 dés (le joueur les lance), ou ouvre n'importe quelle porte.
    function djinnAttaque(mid) {
      const h = herosActif();
      modifier(e => consommerSort(e, h.id, 'djinn'));
      evenement = null;
      combat = { monstre: mid, djinn: true, des: 5, ambiance: 'Un génie de vent tourbillonnant surgit et fond sur sa proie !' };
      dessiner();
    }
    function djinnPorte(pid) {
      const h = herosActif();
      modifier(e => { consommerSort(e, h.id, 'djinn'); if (!e.portesOuvertes.includes(pid)) e.portesOuvertes.push(pid); });
      evenement = { genre: 'fin', titre: 'Djinn', ambiance: 'Le génie souffle : la porte s’ouvre à la volée.', texte: 'La porte est ouverte et la pièce dévoilée.' };
      dessiner();
    }

    function htmlSorts() {
      const h = herosActif();
      const liste = sortsDe(h);
      return `<div class="liste-sorts">${liste.map(x => {
        const s = Sorts.sort(x.id);
        return `<button data-sort="${x.id}" ${x.utilise ? 'disabled' : ''}><strong>${Sorts.groupe(s.groupe).symbole} ${s.nom}${x.utilise ? ' (utilisé)' : ''}</strong>
          <span class="petit">${s.resume}</span></button>`;
      }).join('')}</div>`;
    }

    function htmlCibles(ev) {
      const h = herosActif(), s = Sorts.sort(ev.sort);
      const vu = new Set(etat.revele);
      const heros = s.cible === 'monstre' ? [] : etat.heros.filter(k => k.x != null && k.corps !== 0);
      const monstres = s.cible === 'heros' ? [] : etat.monstres.filter(m => vu.has(Plateau.idx(L, m.x, m.y)));
      const bouton = (genre, f, nom) => {
        const hv = !s.partout && !cibleVisible(h, f);
        return `<button data-cible-sort="${genre}:${f.id}">${echapperTexte(nom)}${f.id === h.id ? ' (soi-même)' : ''}${hv ? ' — hors de vue ⚠' : ''}</button>`;
      };
      return `<p class="titre-zargon">${Sorts.groupe(s.groupe).symbole} ${s.nom}</p>
        <p class="discret">${s.resume}</p>
        <p class="question">Choisissez la cible :</p>
        <div class="choix">${heros.map(k => bouton('heros', k, k.nom)).join('')}${monstres.map(m => bouton('monstre', m, infoMonstre(m.type).nom)).join('')}</div>
        ${!heros.length && !monstres.length ? '<p class="erreur">Aucune cible possible.</p>' : ''}
        <div class="choix"><button id="ev-annuler">Annuler</button></div>`;
    }

    function htmlDjinn() {
      const vu = new Set(etat.revele);
      const monstres = etat.monstres.filter(m => vu.has(Plateau.idx(L, m.x, m.y)));
      const portes = (quete.portes || []).filter(p => !etat.portesOuvertes.includes(p.id) && Plateau.porteVisible(etat, p)
        && [p.a, p.b].some(([x, y]) => vu.has(Plateau.idx(L, x, y))));
      const nomPorte = p => { const z = [p.a, p.b].map(([x, y]) => Plateau.pieceDe(g, x, y)).find(Boolean); return z ? `Porte de la pièce ${z}` : 'Porte'; };
      return `<p class="titre-zargon">🌪 Djinn</p><p class="discret">${Sorts.sort('djinn').resume}</p>
        <h3 class="titre-section">Attaquer (5 dés)</h3>
        <div class="choix">${monstres.map(m => `<button data-djinn-monstre="${m.id}">${infoMonstre(m.type).nom}</button>`).join('') || '<span class="discret">Aucun monstre connu.</span>'}</div>
        <h3 class="titre-section">Ouvrir une porte</h3>
        <div class="choix">${portes.map(p => `<button data-djinn-porte="${p.id}">${nomPorte(p)}</button>`).join('') || '<span class="discret">Aucune porte fermée connue.</span>'}</div>
        <div class="choix"><button id="ev-annuler">Annuler</button></div>`;
    }

    /* ---------- Fenêtres de combat ----------
       Gauche : le héros ; droite : le monstre. Les dés lancés par l'application
       « roulent » quelques instants avant de s'arrêter (une seule fois par lancer). */

    const animes = new Set();

    function htmlDes(tirage, cle) {
      return `<div class="des-lances" data-cle="${cle}" data-final="${tirage.join(',')}">`
        + tirage.map(f => `<span class="de de-${f}">${Regles.afficher([f])}</span>`).join('')
        + (tirage.length ? '' : '<span class="discret">aucun dé</span>') + '</div>';
    }

    // Fait rouler les dés d'une fenêtre qui vient de s'afficher.
    function animerDes(boite) {
      const zone = boite.querySelector('.des-lances');
      if (!zone || animes.has(zone.dataset.cle)) return;
      animes.add(zone.dataset.cle);
      const des = [...zone.querySelectorAll('.de')];
      const faces = ['crane', 'blanc', 'noir'];
      const suite = boite.querySelectorAll('.apres-des');
      suite.forEach(e => e.classList.add('masque'));
      zone.classList.add('roule');
      let t = 0;
      const minuterie = setInterval(() => {
        t += 90;
        des.forEach(d => { d.textContent = Regles.afficher([faces[Math.floor(Math.random() * 3)]]); });
        if (t >= 900) {
          clearInterval(minuterie);
          const final = zone.dataset.final.split(',');
          des.forEach((d, k) => { d.textContent = Regles.afficher([final[k]]); });
          zone.classList.remove('roule');
          suite.forEach(e => e.classList.remove('masque'));
        }
      }, 90);
    }

    function figurine(cote, html, nom, vie, vieMax, classe = '') {
      return `<figure class="combattant ${cote} ${classe}">
        <div class="portrait">${html}</div>
        <figcaption>${classe.includes('attaquant') ? '<span class="role">⚔ attaque</span>' : ''}<strong>${echapperTexte(nom)}</strong><span class="vie">♥ ${vie ?? '?'}${vieMax != null ? ' / ' + vieMax : ''}</span></figcaption>
      </figure>`;
    }

    function boutonsNombre(n, attribut) {
      return Array.from({ length: (n ?? 6) + 1 }, (_, k) => `<button data-${attribut}="${k}">${k}</button>`).join('');
    }

    function dessinerModale() {
      const boite = conteneur.querySelector('#pl-modale');
      const fermer = () => { boite.hidden = true; boite.innerHTML = ''; };
      if (vueMJ || animation) return fermer();
      const z = etat.zargon;
      let html = '';

      if (conclusion) {
        // Conclusion d'un duel (héros ou monstre attaquant).
        const c = conclusion;
        const h = etat.heros.find(k => k.id === c.heros);
        const mVivant = etat.monstres.find(k => k.id === c.monstre);
        const nomM = infoMonstre(c.type).nom, court = infoMonstre(c.type).court;
        const vieM = mVivant ? mVivant.corps : c.vieMonstre ?? 0;
        const attH = c.genre === 'heros' ? ' attaquant' : ' defenseur', attM = c.genre === 'zargon' ? ' attaquant' : ' defenseur';
        const gauche = figurine('gauche', Portraits.heros(h.id, h.court), h.nom, h.corps, h.corpsMax, (h.corps === 0 ? 'vaincu' : '') + attH);
        const droite = figurine('droite', Portraits.monstre(c.type, court), nomM, vieM, mVivant?.corpsMax ?? c.vieMonstreMax, (vieM === 0 ? 'vaincu' : '') + attM);
        let texte;
        if (c.genre === 'zargon') {
          texte = c.cranes === 0
            ? `${nomM} n’obtient aucun crâne : ${h.nom} n’a rien à parer.`
            : `${c.cranes} crâne${c.cranes > 1 ? 's' : ''} contre ${c.blancs} bouclier${c.blancs > 1 ? 's' : ''} blanc${c.blancs > 1 ? 's' : ''} : `
              + (c.degats ? `${h.nom} perd ${c.degats} point${c.degats > 1 ? 's' : ''} de Vie.` : 'aucune blessure.');
          if (h.corps === 0) texte += ` ⚠ ${h.nom} n’a plus de points de Vie : il meurt, sauf potion ou sort de soin (voir sa fiche).`;
        } else {
          texte = `${c.cranes} crâne${c.cranes > 1 ? 's' : ''} contre ${c.noirs} bouclier${c.noirs > 1 ? 's' : ''} noir${c.noirs > 1 ? 's' : ''} : `
            + (c.degats ? `${nomM} perd ${c.degats} point${c.degats > 1 ? 's' : ''} de Vie.` : 'aucune blessure.')
            + (c.vieMonstre === 0 ? ` ${nomM} est vaincu !` : '') + (c.note || '');
        }
        html = `<div class="duel">${gauche}<div class="centre">⚔</div>${droite}</div>
          <p class="legende">${c.genre === 'zargon' ? `Attaque de ${nomM}` : `Défense de ${nomM}`}</p>
          ${htmlDes(c.tirage, c.cle)}
          <div class="apres-des">
            <p class="resultat">${echapperTexte(texte)}</p>
            <p class="ambiance">${echapperTexte(c.ambiance)}</p>
            <div class="choix"><button id="md-suivant" class="principal">${c.genre === 'zargon' ? 'Suivant' : 'Fermer'}</button></div>
          </div>`;
      } else if (combat) {
        // Duel lancé par le héros actif : on attend ses crânes.
        const h = herosActif();
        const m = etat.monstres.find(k => k.id === combat.monstre);
        const n = combat.des ?? caracHeros(h, 'attaque');
        html = `${combat.djinn ? '<p class="titre-zargon">🌪 Le Djinn attaque !</p>' : ''}<div class="duel">${figurine('gauche', Portraits.heros(h.id, h.court), h.nom, h.corps, h.corpsMax, 'attaquant')}<div class="centre">⚔</div>
            ${figurine('droite', Portraits.monstre(m.type, infoMonstre(m.type).court), infoMonstre(m.type).nom, m.corps, m.corpsMax, 'defenseur')}</div>
          <p class="ambiance">${echapperTexte(combat.ambiance)}</p>
          <p class="question">${h.nom} : lancez ${n ?? 'vos'} dé${n > 1 ? 's' : ''} de combat. Combien de crânes ?</p>
          <div class="choix nombres">${boutonsNombre(n, 'cranes')}</div>
          <div class="choix"><button id="md-annuler-combat">Annuler</button></div>`;
      } else if (z?.defense) {
        // Un monstre attaque : ses dés roulent, puis le joueur indique ses boucliers blancs.
        const d = z.defense;
        const h = etat.heros.find(k => k.id === d.heros);
        const m = etat.monstres.find(k => k.id === d.monstre);
        const n = caracHeros(h, 'defense');
        html = `<div class="duel">${figurine('gauche', Portraits.heros(h.id, h.court), h.nom, h.corps, h.corpsMax, 'defenseur')}<div class="centre">⚔</div>
            ${figurine('droite', Portraits.monstre(m.type, infoMonstre(m.type).court), infoMonstre(m.type).nom, m.corps, m.corpsMax, 'attaquant')}</div>
          <p class="legende">Attaque de ${infoMonstre(m.type).nom}</p>
          ${htmlDes(d.tirage || [], d.cle || 'ancien')}
          <div class="apres-des">
            <p class="resultat">${d.cranes} crâne${d.cranes > 1 ? 's' : ''} !</p>
            <p class="question">${h.nom} : lancez ${n ?? 'vos'} dé${n > 1 ? 's' : ''} de défense. Combien de boucliers blancs ?</p>
            <div class="choix nombres">${boutonsNombre(n, 'blancs')}</div>
          </div>`;
      } else if (z?.plan && !herosActif()) {
        // Fenêtre d'ambiance avant le coup d'un monstre.
        const p = z.plan;
        const m = etat.monstres.find(k => k.id === p.monstre);
        const cache = !etat.revele.includes(Plateau.idx(L, m.x, m.y));
        html = `<p class="titre-zargon">Tour de Zargon <span class="discret">· ${z.n + 1} / ${z.file.length}</span></p>
          ${z.n === 0 && z.debut ? `<p class="ambiance">${echapperTexte(z.debut)}</p>` : ''}
          ${p.erreur ? `<p class="erreur">${echapperTexte(decrirePlan())}</p>` : `
            <div class="duel seul">${figurine('droite', cache ? Portraits.monstre('?', '?') : Portraits.monstre(m.type, infoMonstre(m.type).court), cache ? '???' : infoMonstre(m.type).nom, cache ? '?' : m.corps, cache ? null : m.corpsMax)}</div>
            <p class="ambiance grande">${echapperTexte(p.ambiance)}</p>
            ${p.statut ? `<p class="resultat">${echapperTexte(decrirePlan())}</p>` : ''}`}
          <div class="choix">
            ${p.erreur ? '' : '<button id="md-valider" class="principal">Suivant</button>'}
            <button id="md-passer">Passer ce monstre</button>
          </div>`;
      }

      else if (evenement && herosActif()) {
        html = htmlEvenement();
      }
      else if (fenetreActions && herosActif()) {
        // Fenêtre « Actions » : médaillon du héros, état du tour, choix possibles.
        const h = herosActif(), t = etat.tour;
        const cibles = ciblesAttaque();
        const desamorcables = piegesDesamorcables();
        const fait = (t.actions || 0) >= 1;
        const entete = `<button class="icone fermer-modale" id="md-fermer" aria-label="Fermer">✕</button>
          <div class="duel seul">${figurine('gauche', Portraits.heros(h.id, h.court), h.nom, h.corps, h.corpsMax)}</div>`;
        if (fenetreActions === 'sorts') {
          html = `${entete}<p class="titre-zargon">Sorts — ${echapperTexte(h.nom)}</p>${htmlSorts()}
            <div class="choix"><button id="md-retour-actions">Retour</button></div>`;
        } else if (fenetreActions === 'des') {
          html = `${entete}
            <p class="question">${t.aBouge ? `⚠ ${h.nom} s’est déjà déplacé ce tour-ci. ` : ''}${h.ventVif ? 'Vent vif : lancez 4 dés rouges' : 'Lancez les 2 dés rouges'} : quel total ?</p>
            <div class="choix nombres">${Array.from({ length: h.ventVif ? 21 : 11 }, (_, k) => k + (h.ventVif ? 4 : 2)).map(n => `<button data-total="${n}">${n}</button>`).join('')}</div>
            <div class="choix"><button id="md-retour-actions">Retour</button></div>`;
        } else {
          html = `${entete}
            <p class="etat-tour">Déplacement : ${t.deplacement ? `<strong>en cours (${t.deplacement.restant} case${t.deplacement.restant > 1 ? 's' : ''})</strong>` : t.aBouge ? 'fait' : 'disponible'}
              · Action : ${fait ? 'faite' : 'disponible'}</p>
            <h3 class="titre-section">Déplacement</h3>
            <div class="choix">
              ${t.deplacement
                ? '<button id="md-terminer-depl">Terminer le déplacement</button>'
                : `<button id="md-deplacer" class="${t.aBouge ? '' : 'principal'}">${t.aBouge ? 'Se déplacer encore ⚠' : 'Se déplacer'}</button>`}
            </div>
            ${t.finForcee ? `<p class="erreur petit">⚠ Un piège a mis fin au tour de ${echapperTexte(h.nom)} : normalement, il ne fait plus rien ce tour-ci.</p>` : ''}
            ${h.passeTour ? `<p class="erreur petit">⚠ Tempête : ${echapperTexte(h.nom)} devrait passer ce tour.</p>` : ''}
            ${h.endormi ? `<p class="erreur petit">⚠ ${echapperTexte(h.nom)} est endormi : il ne bouge ni n’agit, sauf s’il fait un 6. <button id="md-reveil">Tenter de se réveiller</button></p>` : ''}
            ${effetsHeros(h).length ? `<p class="etat-heros">${effetsHeros(h).map(echapperTexte).join(' · ')}</p>` : ''}
            <h3 class="titre-section">Actions${fait ? ' ⚠' : ''}</h3>
            <div class="choix">
              ${cibles.length ? `<button id="md-attaquer" class="${fait ? '' : 'principal'}">Attaquer</button>` : ''}
              ${sortsDe(h).some(x => !x.utilise) ? '<button id="md-sorts">Lancer un sort</button>' : ''}
              <button id="md-fouille-tresor">Fouiller : trésor</button>
              <button id="md-fouille-portes">Fouiller : portes secrètes</button>
              <button id="md-fouille-pieges">Fouiller : pièges</button>
              ${desamorcables.length ? '<button id="md-desamorcer">Désamorcer le piège</button>' : ''}
              ${meublesDesamorcables().map(m => `<button data-desarmer-meuble="${m.id}">Désamorcer : ${echapperTexte(m.nom)}</button>`).join('')}
            </div>
            ${monstreVisible() ? '<p class="discret petit">Un monstre est visible : les règles interdisent de fouiller (l’application vous laissera faire, avec un avertissement).</p>' : ''}

            <div class="choix"><button id="md-fiche">Fiche de ${echapperTexte(h.nom)}</button></div>`;
        }
      }

      if (!html) return fermer();
      boite.innerHTML = `<div class="carte-modale">${html}</div>`;
      boite.hidden = false;
      const sur = (sel, f) => boite.querySelector(sel)?.addEventListener('click', f);
      sur('#md-valider', validerMonstre);
      sur('#md-passer', passerMonstre);
      sur('#md-suivant', () => { conclusion = null; dessiner(); });
      sur('#md-annuler-combat', () => { combat = null; dessiner(); });
      sur('#md-fermer', () => { fenetreActions = null; dessiner(); });
      sur('#md-deplacer', commencerDeplacement);
      sur('#md-retour-actions', () => { fenetreActions = 'menu'; msg(''); dessiner(); });
      sur('#md-terminer-depl', terminerDeplacement);
      sur('#md-attaquer', () => { fenetreActions = null; commencerAttaque(); });
      sur('#md-fouille-portes', () => { fenetreActions = null; fouiller('portes'); });
      sur('#md-fouille-tresor', () => { fenetreActions = null; fouillerTresor(); });
      sur('#md-sorts', () => { fenetreActions = 'sorts'; dessiner(); });
      sur('#md-reveil', () => { fenetreActions = null; evenement = { genre: 'reveil' }; dessiner(); });
      boite.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => choisirSort(b.dataset.sort)));
      boite.querySelectorAll('[data-desarmer-meuble]').forEach(b => b.addEventListener('click', () => { fenetreActions = null; evenement = { genre: 'desarmerMeuble', meuble: b.dataset.desarmerMeuble }; dessiner(); }));
      sur('#md-fouille-pieges', () => { fenetreActions = null; fouiller('pieges'); });
      sur('#md-desamorcer', () => { fenetreActions = null; evenement = { genre: 'desarmer', piege: piegesDesamorcables()[0].id }; dessiner(); });
      sur('#md-fiche', () => { fenetreActions = null; dessiner(); ouvrirFiche(herosActif().id); });
      boite.querySelectorAll('[data-total]').forEach(b => b.addEventListener('click', () => choisirTotal(+b.dataset.total)));
      boite.querySelectorAll('[data-cranes]').forEach(b => b.addEventListener('click', () => resoudreAttaque(+b.dataset.cranes)));
      boite.querySelectorAll('[data-blancs]').forEach(b => b.addEventListener('click', () => defendre(+b.dataset.blancs)));
      if (evenement) brancherEvenement(boite);
      animerDes(boite);
    }

    /* ---------- Fiche d'un héros ---------- */

    function ouvrirFiche(hid) {
      const h = etat.heros.find(k => k.id === hid);
      const fiche = conteneur.querySelector('#pl-fiche');
      const classe = Regles.TYPES_HEROS.find(t => t.id === (h.classe || h.id))?.nom || '';
      const manque = ['attaque', 'defense'].filter(c => caracHeros(h, c) === null).map(c => c === 'attaque' ? 'dés d’attaque' : 'dés de défense');
      const ligne = (nom, champ) => `<tr><th>${nom}</th><td>${caracHeros(h, champ) ?? '?'}</td></tr>`;
      const compteur = (nom, champ, pas = [1]) => `
        <div class="compteur-fiche">
          <span>${nom}</span>
          ${pas.slice().reverse().map(d => `<button data-modif="${champ}" data-delta="-${d}" class="icone" aria-label="${nom} moins ${d}">−${d > 1 ? d : ''}</button>`).join('')}
          <strong>${h[champ] ?? (champ === 'or' ? 0 : '?')}${h[champ + 'Max'] != null ? ' / ' + h[champ + 'Max'] : ''}</strong>
          ${pas.map(d => `<button data-modif="${champ}" data-delta="${d}" class="icone" aria-label="${nom} plus ${d}">+${d > 1 ? d : ''}</button>`).join('')}
        </div>`;
      const inventaire = h.inventaire || [];
      fiche.innerHTML = `
        <div class="feuille-entete">
          <h2><span class="pastille h-${hid}"></span> ${echapperTexte(h.nom)}</h2>
          <button class="icone" data-fermer aria-label="Fermer la fiche">✕</button>
        </div>
        ${h.nom !== classe ? `<p class="discret petit">${classe}</p>` : ''}
        ${manque.length ? `<p class="erreur petit">À remplir (onglet Héros ou Réglages) : ${manque.join(', ')}.</p>` : ''}
        ${compteur('Vie', 'corps')}
        ${compteur('Esprit', 'esprit')}
        ${h.corps === 0 ? '<p class="erreur">⚠ 0 point de Vie : le héros meurt, sauf potion ou sort de soin.</p>' : ''}
        ${effetsHeros(h).length ? `<p class="etat-heros">${effetsHeros(h).map(echapperTexte).join(' · ')}</p>` : ''}
        ${compteur('Or', 'or', [1, 10])}
        <table class="caracs petite"><tbody>${ligne('Dés d’attaque', 'attaque')}${ligne('Dés de défense', 'defense')}</tbody></table>
        ${sortsDe(h).length ? `<h3>Sorts</h3><p class="petit">${sortsDe(h).map(x => `${Sorts.sort(x.id).nom}${x.utilise ? ' <span class="discret">(utilisé)</span>' : ''}`).join(' · ')}</p>` : ''}
        <h3>Inventaire</h3>
        ${inventaire.length ? `<ul class="inventaire">${inventaire.map((o, k) => `<li><span>${echapperTexte(o.nom)}</span>
            <button class="icone petit-bouton" data-retirer="${k}" aria-label="Retirer ${echapperTexte(o.nom)}">✕</button></li>`).join('')}</ul>`
          : '<p class="discret petit">Vide.</p>'}
        <button id="fi-ajouter">Ajouter un objet</button>
        <p class="discret petit">Or et inventaire sont enregistrés dans le personnage à la fin de la quête (menu ☰).
          Les boutons − et + s’annulent avec ↶.</p>`;
      fiche.hidden = false;
      fiche.querySelector('[data-fermer]').addEventListener('click', () => { fiche.hidden = true; });
      fiche.querySelectorAll('[data-modif]').forEach(b => b.addEventListener('click', () => {
        const champ = b.dataset.modif, delta = +b.dataset.delta;
        modifier(e => {
          const k = e.heros.find(z => z.id === hid);
          const max = k[champ + 'Max'] ?? 9999;
          k[champ] = Math.max(0, Math.min(max, (k[champ] ?? 0) + delta));
        });
        ouvrirFiche(hid);
      }));
      fiche.querySelectorAll('[data-retirer]').forEach(b => b.addEventListener('click', () => {
        modifier(e => { e.heros.find(z => z.id === hid).inventaire.splice(+b.dataset.retirer, 1); });
        ouvrirFiche(hid);
      }));
      fiche.querySelector('#fi-ajouter').addEventListener('click', () => {
        const nom = prompt(`Objet à ajouter à l’inventaire de ${h.nom} :`);
        if (!nom || !nom.trim()) return;
        modifier(e => { const k = e.heros.find(z => z.id === hid); (k.inventaire = k.inventaire || []).push({ nom: nom.trim().slice(0, 80) }); });
        ouvrirFiche(hid);
      });
    }

    function toucherPorte(id) {
      const p = quete.portes.find(q => q.id === id);
      if (vueMJ) {
        if (p.secrete && !etat.secretesTrouvees.includes(id)) {
          modifier(e => { e.secretesTrouvees.push(id); });
          return msg('Porte secrète marquée comme trouvée.');
        }
        if (!etat.portesOuvertes.includes(id)) {
          modifier(e => { e.portesOuvertes.push(id); });
          return msg('Porte ouverte (vue MJ).');
        }
        return msg('Cette porte est déjà ouverte.');
      }
      if (etat.portesOuvertes.includes(id)) return msg('Cette porte est déjà ouverte.');
      const h = Plateau.herosAdjacent(etat, p);
      if (!h) return msg('Un héros doit se trouver sur une case qui touche la porte. (Vue MJ pour passer outre.)');
      modifier(e => { e.portesOuvertes.push(id); });
      msg(`${h.nom} ouvre la porte.`);
    }

    function toucherCaseMJ({ x, y }) {
      // Pas de dévoilement automatique ici : le MJ décide.
      const avant = JSON.stringify(etat);
      const devoile = Plateau.basculerZone(g, etat, x, y);
      // Les monstres de la zone dévoilée deviennent « vus » : Zargon pourra les faire jouer.
      if (devoile) for (const m of etat.monstres) if (etat.revele.includes(Plateau.idx(L, m.x, m.y))) m.vu = true;
      historique.push(avant);
      if (historique.length > 60) historique.shift();
      partie.etat = etat;
      enregistrer();
      msg(devoile ? 'Zone dévoilée.' : 'Zone cachée.');
      dessiner();
    }

    conteneur.querySelector('#pl-annuler').addEventListener('click', annuler);

    // Réglage de la portée de vue (enregistré dans la partie).
    const choixPortee = conteneur.querySelector('#pl-portee');
    const valeurPortee = partie.reglages?.porteeCouloir ?? Plateau.PORTEE_DEFAUT;
    choixPortee.value = String(valeurPortee);
    // Menu (volet) : vision, notes, aide, retour, abandon.
    const feuille = conteneur.querySelector('#pl-feuille');
    conteneur.querySelector('#pl-menu').addEventListener('click', () => { feuille.hidden = !feuille.hidden; });
    conteneur.querySelector('#pl-fermer').addEventListener('click', () => { feuille.hidden = true; });
    const quitter = () => options.quitter?.();
    conteneur.querySelector('#pl-quitter').addEventListener('click', quitter);
    conteneur.querySelector('#pl-quitter2').addEventListener('click', quitter);
    conteneur.querySelector('#pl-abandon').addEventListener('click', () => options.abandonner?.());
    conteneur.querySelector('#pl-reussie').addEventListener('click', () => options.terminer?.('reussie'));
    conteneur.querySelector('#pl-echouee').addEventListener('click', () => options.terminer?.('echouee'));

    // Notes de partie (enregistrées peu après la dernière frappe).
    const notes = conteneur.querySelector('#pl-notes');
    notes.value = partie.notes || '';
    let minuterieNotes = null;
    notes.addEventListener('input', () => {
      conteneur.querySelector('#pl-etat-notes').textContent = 'Modification…';
      clearTimeout(minuterieNotes);
      minuterieNotes = setTimeout(async () => {
        partie.notes = notes.value;
        await enregistrer();
        conteneur.querySelector('#pl-etat-notes').textContent = 'Enregistré sur cet iPad.';
      }, 600);
    });
    choixPortee.addEventListener('change', () => {
      const v = choixPortee.value;
      partie.reglages = { ...(partie.reglages || {}), porteeCouloir: v === 'illimitee' ? v : Number(v) };
      modifier(() => {}); // recalcule ce que les héros voient avec la nouvelle portée
      msg(v === 'illimitee' ? 'Vue illimitée dans les couloirs (règle officielle).' : `Vue limitée à ${v} cases dans les couloirs.`);
    });
    conteneur.querySelector('#pl-mj').addEventListener('click', () => {
      // Entrer en vue MJ dévoile tout le plateau : on demande confirmation (pas pour en sortir).
      if (!vueMJ && !confirm('Passer en vue MJ ?\n\nTout le plateau sera visible : monstres, portes secrètes, salles cachées. Les joueurs ne doivent pas regarder l’écran.')) return;
      vueMJ = !vueMJ; selection = null;
      msg(vueMJ ? 'Vue MJ : tout est visible. Les joueurs ne doivent pas regarder !' : 'Vue des joueurs.');
      dessiner();
    });
    const changerZoom = f => {
      zoom = Math.min(3, Math.max(0.6, Math.round(zoom * f * 10) / 10));
      try { localStorage.setItem('zoomJeu', zoom); } catch { }
      appliquerZoom();
    };
    conteneur.querySelector('#pl-ajuster').addEventListener('click', () => { zoom = 1; changerZoom(1); });
    conteneur.querySelector('#pl-plus').addEventListener('click', () => changerZoom(1.25));
    conteneur.querySelector('#pl-moins').addEventListener('click', () => changerZoom(0.8));

    appliquerZoom();
    dessiner();
    msg(etat.portesOuvertes.length === 0 && quete.intro ? quete.intro : `Quête : ${quete.titre}`);
  }

  return { monter };
})();
