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
    const caracs = options.caracs || Regles.caracsVides();
    const carac = (famille, type, champ) => Regles.valeur(caracs, famille, type, champ);
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
              <li>Le héros dont c’est le tour porte un anneau blanc. « Se déplacer » : lancez vos 2 dés rouges, touchez le total,
                  puis touchez les cases une par une (les cases possibles sont encadrées).</li>
              <li>Fiche d’un héros (points de Vie, d’Esprit, dés) : touchez son pion sur le plateau, ou sa pastille dans l’ordre de jeu en haut.</li>
              <li>On peut traverser un autre héros, mais pas s’arrêter sur sa case. Murs, portes fermées, monstres et meubles bloquent.</li>
              <li>Touchez une porte fermée pour l’ouvrir : un héros doit se trouver sur une case qui la touche.</li>
              <li>« Fin du tour » passe au héros suivant, puis à Zargon.</li>
              <li>Colonne de droite : ↶ annuler, MJ (vue du maître du jeu), + et − zoom, ⤢ plateau ajusté à l’écran.</li>
              <li>Vue MJ : tout le plateau apparaît. Toucher un héros puis une case le pose n’importe où ; toucher une case
                  dévoile ou cache sa pièce ; toucher une porte secrète la rend trouvée.</li>
              <li>Touchez un message pour le faire disparaître.</li>
            </ul>
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
    const msg = texte => { bulle.textContent = texte || ''; bulle.hidden = !texte; };
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
      partie.etat = etat;
      enregistrer();
      dessiner();
    }

    function annuler() {
      if (!historique.length) return;
      etat = JSON.parse(historique.pop());
      partie.etat = etat;
      selection = null;
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

      // 5. Portes
      for (const p of quete.portes || []) {
        const ia = Plateau.idx(L, ...p.a), ib = Plateau.idx(L, ...p.b);
        const trouvee = Plateau.porteVisible(etat, p);
        if (!vueMJ && (!trouvee || (!vu.has(ia) && !vu.has(ib)))) continue;
        const ouverte = etat.portesOuvertes.includes(p.id);
        const horizontale = p.a[1] !== p.b[1]; // les cases sont l'une au-dessus de l'autre
        const cx = (Math.max(p.a[0], p.b[0]) + (horizontale ? 0.5 : 0)) * T;
        const cy = (Math.max(p.a[1], p.b[1]) + (horizontale ? 0 : 0.5)) * T;
        const w = horizontale ? T * 0.8 : T * 0.3, h = horizontale ? T * 0.3 : T * 0.8;
        const cls = 'porte' + (ouverte ? ' ouverte' : '') + (!trouvee ? ' secrete' : '');
        const gr = el('g', { class: cls, 'data-porte': p.id }, svg);
        el('rect', { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: 2 }, gr);
        // Zone tactile : toute la longueur de la porte, mais peu épaisse,
        // pour ne pas voler les touchers destinés aux cases voisines.
        const tw = horizontale ? T : T * 0.5, th = horizontale ? T * 0.5 : T;
        el('rect', { x: cx - tw / 2, y: cy - th / 2, width: tw, height: th, class: 'zone-tactile' }, gr);
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

      if (vueMJ) {
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
      const monstreTouche = evt.target.closest('[data-monstre]');
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
      conteneur.querySelector('#pl-haut').classList.toggle('saisie', (saisieDes || ciblage || cible) && !vueMJ);
      if (vueMJ) { p.innerHTML = '<span class="discret">Vue MJ : le tour de jeu est en pause.</span>'; return; }
      let html = `<span class="titre-tour">T${t.numero} · `;
      if (!actif) {
        html += `<strong>Zargon</strong></span>
          <span class="discret petit">(monstres : étape 5)</span>
          <button id="tr-fin-zargon" class="principal">Fin du tour de Zargon</button>`;
      } else if (cible) {
        const m = etat.monstres.find(k => k.id === cible);
        const n = carac('heros', actif.id, 'attaque');
        html += `<strong>${actif.nom}</strong> → ${infoMonstre(m.type).nom}</span>
          <span>Lancez ${n ?? '?'} dé${n > 1 ? 's' : ''} : crânes obtenus ?</span>
          <div class="des">${Array.from({ length: (n ?? 6) + 1 }, (_, k) => `<button data-cranes="${k}">${k}</button>`).join('')}</div>
          <button id="tr-retour-attaque">Retour</button>`;
      } else if (ciblage) {
        html += `<strong>${actif.nom}</strong></span>
          <span>Touchez le monstre à attaquer.</span>
          <button id="tr-retour-attaque">Retour</button>`;
      } else if (saisieDes) {
        html += `<strong>${actif.nom}</strong></span>
          <span>Total des dés :</span>
          <div class="des">${[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => `<button data-total="${n}">${n}</button>`).join('')}</div>
          <button id="tr-annuler-des">Retour</button>`;
      } else if (t.deplacement) {
        html += `<strong>${actif.nom}</strong></span>
          <span class="compteur" title="cases restantes">${t.deplacement.restant} case${t.deplacement.restant > 1 ? 's' : ''}</span>
          <button id="tr-fin-depl">Terminer</button>
          <button id="tr-attaquer">Attaquer</button>
          <button id="tr-fin-tour" class="principal">Fin du tour</button>`;
      } else {
        html += `<strong>${actif.nom}</strong></span>
          <button id="tr-depl">${t.aBouge ? 'Se déplacer encore' : 'Se déplacer'}</button>
          <button id="tr-attaquer">Attaquer</button>
          <button id="tr-fin-tour" class="principal">Fin du tour</button>`;
      }
      p.innerHTML = html;
      const sur = (sel, f) => p.querySelector(sel)?.addEventListener('click', f);
      sur('#tr-depl', commencerDeplacement);
      sur('#tr-annuler-des', () => { saisieDes = false; msg(''); dessiner(); });
      p.querySelectorAll('[data-total]').forEach(b => b.addEventListener('click', () => choisirTotal(+b.dataset.total)));
      sur('#tr-fin-depl', terminerDeplacement);
      sur('#tr-fin-tour', finDuTour);
      sur('#tr-fin-zargon', finTourZargon);
      sur('#tr-attaquer', commencerAttaque);
      sur('#tr-retour-attaque', () => { ciblage = false; cible = null; msg(''); dessiner(); });
      p.querySelectorAll('[data-cranes]').forEach(b => b.addEventListener('click', () => resoudreAttaque(+b.dataset.cranes)));
    }

    let saisieDes = false; // le panneau affiche les boutons 2 à 12

    function commencerDeplacement() {
      saisieDes = true; ciblage = false; cible = null;
      const actif = herosActif();
      // Écart n° 1 : un seul déplacement par tour. On avertit, on ne bloque pas.
      msg(etat.tour.aBouge
        ? `⚠ ${actif.nom} s’est déjà déplacé ce tour-ci (règle : un seul déplacement par tour). Vous pouvez continuer.`
        : `Lancez les 2 dés rouges pour ${actif.nom}, puis touchez le total.`);
      dessiner();
    }

    function choisirTotal(n) {
      saisieDes = false;
      modifier(e => { e.tour.deplacement = { total: n, restant: n }; e.tour.aBouge = true; });
      msg(`${herosActif().nom} peut avancer de ${n} cases : touchez les cases une par une.`);
    }

    function avancer({ x, y }) {
      const actif = herosActif();
      const raison = Plateau.raisonBlocage(g, etat, actif.x, actif.y, x, y);
      if (raison) return msg(raison);
      const surHeros = Plateau.autreHerosEn(etat, actif.id, x, y);
      if (surHeros && etat.tour.deplacement.restant === 1)
        return msg(`Dernière case : on ne peut pas s’arrêter sur la case de ${surHeros.nom}.`);
      modifier(e => {
        const h = e.heros.find(k => k.id === actif.id);
        h.x = x; h.y = y;
        e.tour.deplacement.restant -= 1;
        if (e.tour.deplacement.restant <= 0) e.tour.deplacement = null;
      });
      msg(etat.tour.deplacement ? (surHeros ? `${actif.nom} passe la case de ${surHeros.nom}.` : '') : `${actif.nom} a utilisé tout son déplacement.`);
    }

    // Arrêter le déplacement avant d'avoir tout utilisé (permis par les règles).
    function terminerDeplacement() {
      const actif = herosActif();
      const autre = Plateau.autreHerosEn(etat, actif.id, actif.x, actif.y);
      if (autre) return msg(`On ne peut pas s’arrêter sur la case de ${autre.nom} : avancez encore d’une case.`);
      modifier(e => { e.tour.deplacement = null; });
      msg(`${actif.nom} s’arrête.`);
    }

    function finDuTour() {
      const actif = herosActif();
      if (etat.tour.deplacement) {
        const autre = Plateau.autreHerosEn(etat, actif.id, actif.x, actif.y);
        if (autre) return msg(`On ne peut pas s’arrêter sur la case de ${autre.nom} : avancez encore d’une case.`);
      }
      saisieDes = false; ciblage = false; cible = null;
      modifier(e => { e.tour = { numero: e.tour.numero, index: e.tour.index + 1 }; });
      const suivant = herosActif();
      msg(suivant ? `À ${suivant.nom} de jouer.` : 'Au tour de Zargon.');
    }

    function finTourZargon() {
      modifier(e => { e.tour = { numero: e.tour.numero + 1, index: 0 }; });
      msg(`Tour ${etat.tour.numero} : à ${herosActif()?.nom ?? '?'} de jouer.`);
    }

    /* ---------- Attaque d'un héros ---------- */

    let ciblage = false; // le joueur doit toucher un monstre
    let cible = null;    // monstre choisi : on attend le nombre de crânes

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
      if (!ciblesAttaque().length) return msg('Aucun monstre à portée : il faut un monstre visible sur une case voisine (sans diagonale).');
      ciblage = true; saisieDes = false;
      msg((etat.tour.actions || 0) >= 1
        ? `⚠ ${h.nom} a déjà fait une action ce tour-ci (règle : une seule action par tour). Vous pouvez continuer.`
        : 'Touchez le monstre à attaquer (entouré de rouge).');
      dessiner();
    }

    function choisirCible(id) {
      if (!ciblesAttaque().some(m => m.id === id)) return msg('Ce monstre n’est pas à portée.');
      const m = etat.monstres.find(k => k.id === id);
      if (Regles.valeurMonstre(caracs, m, 'defense') === null)
        return msg(m.caracs || Regles.infoMonstre(m.type).variable
          ? `Défense de ce ${infoMonstre(m.type).nom} inconnue : la quête ne la donne pas. Corrigez en vue MJ.`
          : `Défense des ${infoMonstre(m.type).nom}s inconnue : remplissez-la dans Réglages › Caractéristiques.`);
      ciblage = false; cible = id;
      const n = carac('heros', herosActif().id, 'attaque');
      msg(`Lancez ${n ?? 'vos'} dé${n > 1 ? 's' : ''} de combat, puis touchez le nombre de crânes.`);
      dessiner();
    }

    // Les crânes du héros moins les boucliers noirs du monstre = points de Vie perdus.
    function resoudreAttaque(cranes) {
      const h = herosActif();
      const m = etat.monstres.find(k => k.id === cible);
      const nom = infoMonstre(m.type).nom;
      const nbDef = Regles.valeurMonstre(caracs, m, 'defense');
      const tirage = Regles.lancer(nbDef);
      const noirs = Regles.compter(tirage, 'noir');
      const degats = Math.max(0, cranes - noirs);
      cible = null;
      let fin = '';
      modifier(e => {
        if (e.tour.deplacement) e.tour.deplacement = null; // une action termine le déplacement en cours
        e.tour.actions = (e.tour.actions || 0) + 1;
        const k = e.monstres.find(z => z.id === m.id);
        if (k.corps == null) k.corps = 1;
        k.corps = Math.max(0, k.corps - degats);
        if (k.corps === 0) { e.monstres = e.monstres.filter(z => z.id !== m.id); fin = ` ${nom} est vaincu !`; }
        else fin = degats ? ` ${nom} : ${k.corps} point${k.corps > 1 ? 's' : ''} de Vie restant${k.corps > 1 ? 's' : ''}.` : '';
      });
      msg(`${h.nom} : ${cranes} 💀. Défense ${nom} : ${Regles.afficher(tirage) || '(aucun dé)'} → ${noirs} bouclier${noirs > 1 ? 's' : ''} noir${noirs > 1 ? 's' : ''}. `
        + (degats ? `${degats} blessure${degats > 1 ? 's' : ''}.` : 'Aucune blessure.') + fin);
    }

    /* ---------- Fiche d'un héros ---------- */

    function ouvrirFiche(hid) {
      const h = etat.heros.find(k => k.id === hid);
      const fiche = conteneur.querySelector('#pl-fiche');
      const manque = Regles.manquantes(caracs, 'heros', hid);
      const ligne = (nom, champ) => `<tr><th>${nom}</th><td>${carac('heros', hid, champ) ?? '?'}</td></tr>`;
      const compteur = (nom, champ) => `
        <div class="compteur-fiche">
          <span>${nom}</span>
          <button data-modif="${champ}" data-delta="-1" class="icone" aria-label="${nom} moins 1">−</button>
          <strong>${h[champ] ?? '?'}${h[champ + 'Max'] != null ? ' / ' + h[champ + 'Max'] : ''}</strong>
          <button data-modif="${champ}" data-delta="1" class="icone" aria-label="${nom} plus 1">+</button>
        </div>`;
      fiche.innerHTML = `
        <div class="feuille-entete">
          <h2><span class="pastille h-${hid}"></span> ${h.nom}</h2>
          <button class="icone" data-fermer aria-label="Fermer la fiche">✕</button>
        </div>
        ${manque.length ? `<p class="erreur petit">À remplir dans Réglages › Caractéristiques : ${manque.join(', ')}.</p>` : ''}
        ${compteur('Vie', 'corps')}
        ${compteur('Esprit', 'esprit')}
        ${h.corps === 0 ? '<p class="erreur">⚠ 0 point de Vie : le héros meurt, sauf potion ou sort de soin.</p>' : ''}
        <table class="caracs petite"><tbody>${ligne('Dés d’attaque', 'attaque')}${ligne('Dés de défense', 'defense')}</tbody></table>
        <p class="discret petit">Les boutons − et + servent aux blessures, soins et corrections. Ils s’annulent avec ↶.</p>`;
      fiche.hidden = false;
      fiche.querySelector('[data-fermer]').addEventListener('click', () => { fiche.hidden = true; });
      fiche.querySelectorAll('[data-modif]').forEach(b => b.addEventListener('click', () => {
        const champ = b.dataset.modif, delta = +b.dataset.delta;
        modifier(e => {
          const k = e.heros.find(z => z.id === hid);
          const max = k[champ + 'Max'] ?? 99;
          k[champ] = Math.max(0, Math.min(max, (k[champ] ?? 0) + delta));
        });
        ouvrirFiche(hid);
      }));
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
