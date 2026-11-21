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

  const MONSTRES = {
    gobelin: { nom: 'Gobelin', court: 'Go' },
    orque: { nom: 'Orque', court: 'Or' },
    abomination: { nom: 'Abomination', court: 'Ab' },
    guerrierEffroi: { nom: 'Guerrier de l’Effroi', court: 'GE' },
    gargouille: { nom: 'Gargouille', court: 'Ga' },
    squelette: { nom: 'Squelette', court: 'Sq' },
    zombie: { nom: 'Zombie', court: 'Zo' },
    momie: { nom: 'Momie', court: 'Mo' },
    sorcierEffroi: { nom: 'Sorcier de l’Effroi', court: 'SE' },
  };
  const infoMonstre = type => MONSTRES[type] || { nom: type, court: String(type).slice(0, 2) };

  // Crée un élément SVG avec ses attributs.
  function el(nom, attrs = {}, parent) {
    const e = document.createElementNS(NS, nom);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }

  /* Monte le plateau dans « conteneur ».
     partie : la partie (avec .quete et .etat) ; enregistrer() : sauvegarde la partie. */
  function monter(conteneur, partie, enregistrer) {
    const quete = partie.quete;
    const g = Plateau.geometrie(quete);
    const { L, H } = g;
    let etat = partie.etat;
    if (!etat.tour) etat.tour = { numero: 1, index: 0 }; // parties commencées avant la v0.5.0
    let selection = null;        // id du héros sélectionné
    let vueMJ = false;
    let zoom = Number(localStorage.getItem('zoomPlateau')) || 1;
    const historique = [];       // états précédents, pour « Annuler » (60 au plus)

    const nomHeros = hid => etat.heros.find(h => h.id === hid)?.nom ?? hid;
    conteneur.innerHTML = `
      <ol id="pl-ordre" class="ordre-jeu" aria-label="Ordre de jeu"></ol>
      <div class="barre-plateau">
        <button id="pl-annuler" disabled>↶ Annuler</button>
        <button id="pl-mj" aria-pressed="false">Vue MJ</button>
        <button id="pl-vision" aria-expanded="false">Vision</button>
        <span class="espace"></span>
        <button id="pl-moins" aria-label="Dézoomer">−</button>
        <button id="pl-plus" aria-label="Zoomer">+</button>
      </div>
      <div id="pl-tour" class="panneau-tour"></div>
      <div id="pl-reglages" class="reglages-vision" hidden>
        <label for="pl-portee">Portée de vue dans les couloirs</label>
        <select id="pl-portee">
          <option value="illimitee">Illimitée (règle officielle)</option>
          ${[4, 5, 6, 7, 8, 10, 12].map(n => `<option value="${n}">${n} cases</option>`).join('')}
        </select>
        <p class="discret petit">Règle maison : au-delà, le couloir reste dans le noir ; la dernière case vue
          s’estompe en fondu. Les pièces sont toujours vues en entier. Réduire la portée ne recache pas
          ce qui a déjà été vu.</p>
      </div>
      <p id="pl-message" class="message-plateau"></p>
      <div class="cadre-plateau"><svg id="pl-svg" viewBox="0 0 ${L * T} ${H * T}" role="img" aria-label="Plateau de jeu"></svg></div>
      <details class="aide">
        <summary>Comment ça marche</summary>
        <ul class="puces petit">
          <li>Le héros dont c’est le tour est entouré d’or. « Se déplacer » : lancez vos 2 dés rouges, touchez le total,
              puis touchez les cases une par une (les cases possibles sont marquées).</li>
          <li>On peut traverser un autre héros, mais pas s’arrêter sur sa case. Murs, portes fermées, monstres et meubles bloquent.</li>
          <li>Touchez une porte fermée pour l’ouvrir : un héros doit se trouver sur une case qui la touche.</li>
          <li>« Fin du tour » passe au héros suivant, puis à Zargon.</li>
          <li>Vue MJ : tout le plateau apparaît. Toucher un héros puis une case le pose n’importe où ; toucher une case
              dévoile ou cache sa pièce ; toucher une porte secrète la rend trouvée.</li>
        </ul>
      </details>`;

    const svg = conteneur.querySelector('#pl-svg');
    const msg = texte => { conteneur.querySelector('#pl-message').textContent = texte || ''; };

    function appliquerZoom() {
      // 32 px par case au zoom 1 : le plateau tient sur la largeur d'un iPad à l'horizontale.
      svg.setAttribute('width', Math.round(L * 32 * zoom));
      svg.setAttribute('height', Math.round(H * 32 * zoom));
    }

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
        const gr = el('g', { class: 'pion monstre' + (vu.has(Plateau.idx(L, m.x, m.y)) ? '' : ' cache') }, svg);
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
        const cls = 'pion heros h-' + h.id + (selection === h.id ? ' choisi' : '') + (!vueMJ && actif?.id === h.id ? ' actif' : '');
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

      // Vue des joueurs : pendant un déplacement, toucher une case fait avancer le héros actif.
      if (c && etat.tour?.deplacement) return avancer(c);
      if (heros) {
        const h = etat.heros.find(k => k.id === heros.dataset.heros);
        return msg(h.id === herosActif()?.id ? `C’est au tour de ${h.nom}.` : `${h.nom} — ce n’est pas son tour.`);
      }
      if (!c) return;
      const m = etat.monstres.find(k => k.x === c.x && k.y === c.y);
      if (m && etat.revele.includes(Plateau.idx(L, c.x, c.y))) msg(infoMonstre(m.type).nom + '.');
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
        ordre.map((hid, n) => `<li class="${n === t.index ? 'en-cours' : ''}"><span class="pastille h-${hid}"></span>${nomHeros(hid)}</li>`).join('')
        + `<li class="zargon ${t.index >= ordre.length ? 'en-cours' : ''}">Zargon</li>`;

      const p = conteneur.querySelector('#pl-tour');
      if (vueMJ) { p.innerHTML = '<span class="discret">Vue MJ : le tour de jeu est en pause.</span>'; return; }
      let html = `<span class="titre-tour">Tour ${t.numero} · `;
      if (!actif) {
        html += `<strong>Zargon</strong></span>
          <span class="discret petit">Les monstres agiront ici à l’étape 5.</span>
          <button id="tr-fin-zargon" class="principal">Fin du tour de Zargon</button>`;
      } else if (saisieDes) {
        html += `<strong>${actif.nom}</strong></span>
          <span>Total des 2 dés rouges :</span>
          <div class="des">${[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => `<button data-total="${n}">${n}</button>`).join('')}</div>
          <button id="tr-annuler-des">Retour</button>`;
      } else if (t.deplacement) {
        html += `<strong>${actif.nom}</strong></span>
          <span class="compteur">${t.deplacement.restant} case${t.deplacement.restant > 1 ? 's' : ''} restante${t.deplacement.restant > 1 ? 's' : ''}</span>
          <button id="tr-fin-depl">Terminer le déplacement</button>
          <button id="tr-fin-tour" class="principal">Fin du tour</button>`;
      } else {
        html += `<strong>${actif.nom}</strong></span>
          <button id="tr-depl">${t.aBouge ? 'Se déplacer encore' : 'Se déplacer'}</button>
          <button id="tr-fin-tour" class="principal">Fin du tour de ${actif.nom}</button>`;
      }
      p.innerHTML = html;
      const sur = (sel, f) => p.querySelector(sel)?.addEventListener('click', f);
      sur('#tr-depl', commencerDeplacement);
      sur('#tr-annuler-des', () => { saisieDes = false; msg(''); dessiner(); });
      p.querySelectorAll('[data-total]').forEach(b => b.addEventListener('click', () => choisirTotal(+b.dataset.total)));
      sur('#tr-fin-depl', terminerDeplacement);
      sur('#tr-fin-tour', finDuTour);
      sur('#tr-fin-zargon', finTourZargon);
    }

    let saisieDes = false; // le panneau affiche les boutons 2 à 12

    function commencerDeplacement() {
      saisieDes = true;
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
      saisieDes = false;
      modifier(e => { e.tour = { numero: e.tour.numero, index: e.tour.index + 1 }; });
      const suivant = herosActif();
      msg(suivant ? `À ${suivant.nom} de jouer.` : 'Au tour de Zargon.');
    }

    function finTourZargon() {
      modifier(e => { e.tour = { numero: e.tour.numero + 1, index: 0 }; });
      msg(`Tour ${etat.tour.numero} : à ${herosActif()?.nom ?? '?'} de jouer.`);
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
    conteneur.querySelector('#pl-vision').addEventListener('click', e => {
      const panneau = conteneur.querySelector('#pl-reglages');
      panneau.hidden = !panneau.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!panneau.hidden));
      e.currentTarget.classList.toggle('actif', !panneau.hidden);
    });
    choixPortee.addEventListener('change', () => {
      const v = choixPortee.value;
      partie.reglages = { ...(partie.reglages || {}), porteeCouloir: v === 'illimitee' ? v : Number(v) };
      modifier(() => {}); // recalcule ce que les héros voient avec la nouvelle portée
      msg(v === 'illimitee' ? 'Vue illimitée dans les couloirs (règle officielle).' : `Vue limitée à ${v} cases dans les couloirs.`);
    });
    conteneur.querySelector('#pl-mj').addEventListener('click', () => {
      vueMJ = !vueMJ; selection = null;
      msg(vueMJ ? 'Vue MJ : tout est visible. Les joueurs ne doivent pas regarder !' : 'Vue des joueurs.');
      dessiner();
    });
    const changerZoom = f => {
      zoom = Math.min(3, Math.max(0.6, Math.round(zoom * f * 10) / 10));
      try { localStorage.setItem('zoomPlateau', zoom); } catch { }
      appliquerZoom();
    };
    conteneur.querySelector('#pl-plus').addEventListener('click', () => changerZoom(1.25));
    conteneur.querySelector('#pl-moins').addEventListener('click', () => changerZoom(0.8));

    appliquerZoom();
    dessiner();
    msg(etat.portesOuvertes.length === 0 && quete.intro ? quete.intro : `Quête : ${quete.titre}`);
  }

  return { monter };
})();
