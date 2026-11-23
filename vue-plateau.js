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
    // Dés rouges lancés par l'application (résistances aux sorts, carte 2021) : valeurs de 1 à 6.
    const desRouges = n => Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 6));
    const MORTS_VIVANTS = ['squelette', 'zombie', 'momie']; // le Sommeil n'a pas d'effet sur eux
    const bonusSorts = (h, champ, n) => (n === null ? n : n + (champ === 'attaque' && h.courage ? 2 : 0) + (champ === 'defense' && h.peauRoc ? 1 : 0));
    /* Équipement (inventaire.js), décision de l'utilisateur du 22/11/2026 :
       l'arme en main REMPLACE les dés d'attaque (si ses dés sont indiqués) ;
       les pièces d'armure AJOUTENT leurs bonus aux dés de défense. */
    const armeEnMain = h => Inventaire.tri(h?.inventaire || []).arme?.o || null;
    const avecEquipement = (h, champ, n) => {
      if (champ === 'attaque') { const a = armeEnMain(h); return a && Number.isFinite(a.des) ? a.des : n; }
      if (champ === 'defense') { const b = Inventaire.bonusArmure(h?.inventaire || []); return n === null ? n : n + b; }
      return n;
    };
    const caracHeros = (h, champ) => bonusSorts(h, champ, penaliteFosse(h, champ, avecEquipement(h, champ, caracBrute(h, champ))));
    // Explication courte du nombre de dés (fiche du héros).
    function detailDes(h, champ) {
      const base = caracBrute(h, champ), parts = [];
      if (champ === 'attaque') { const a = armeEnMain(h); if (a && Number.isFinite(a.des)) parts.push(`${a.nom}`); else if (a) parts.push(`⚠ dés de « ${a.nom} » non indiqués`); else parts.push('mains nues'); }
      if (champ === 'attaque') { const a = armeEnMain(h); if (Inventaire.interditeA(a, h.classe || h.id)) parts.push('⚠ arme interdite à cette classe'); }
      if (champ === 'defense') { const b = Inventaire.bonusArmure(h?.inventaire || []); if (b && base !== null) parts.push(`${base} + ${b} d’armure`); }
      if (champ === 'defense' && Inventaire.bouclierInutile(h?.inventaire || [])) parts.push('bouclier inutilisable avec une arme à deux mains');
      if (Plateau.fosseEn(etat, h.x, h.y)) parts.push('−1 dans la fosse');
      if (champ === 'attaque' && h.courage) parts.push('+2 Courage');
      if (champ === 'defense' && h.peauRoc) parts.push('+1 Peau de roc');
      return parts.length ? ` <span class="discret petit">(${parts.map(echapperTexte).join(', ')})</span>` : '';
    }
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
              s’estompe en fondu (comme tout bord du brouillard). Les pièces sont toujours vues en entier. Réduire la portée ne recache pas
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
                  « Attaquer », « Lancer un sort », fouilles… La croix ✕ la referme.</li>
              <li>Se déplacer : touchez le héros dont c’est le tour, puis les cases éclairées une par une (lancez vos dés rouges et comptez vous-mêmes).
                  Le numéro de chaque pas s’inscrit discrètement dans le coin de la case ; un retour en arrière compte aussi.
                  Touchez à nouveau le héros pour s’arrêter. Les numéros s’effacent à la fin du tour.</li>
              <li>Fiche d’un héros (points de Vie, d’Esprit, or, inventaire, dés) : bouton « Fiche » en haut pour le héros actif, ou touchez sa pastille dans l’ordre de jeu, ou le pion d’un autre héros.</li>
              <li>On peut traverser un autre héros, mais pas s’arrêter sur sa case. Murs, portes fermées, monstres et meubles bloquent.</li>
              <li>Touchez une porte fermée pour l’ouvrir : le héros actif doit se trouver devant elle (une case en diagonale ne suffit pas). Quand le héros actif arrive contre une porte, l’application propose de l’ouvrir ; après « Pas maintenant », touchez le héros pour que la proposition revienne.</li>
              <li>Trésor (règle maison) : dans une pièce qui contient un coffre, on ne peut chercher le trésor que depuis une case voisine d’un coffre (le bouton reste grisé sinon).</li>
              <li>Fouille des pièges (règle maison) : un héros sur la case devant une porte ouverte fouille aussi l’autre côté — la pièce depuis le couloir, ou le couloir depuis la pièce. Pas pour les portes secrètes ni le trésor.</li>
              <li>Interrupteurs et passages secrets (certaines quêtes) : une fouille de pièges repère un interrupteur (◉) ; marcher dessus l’actionne et révèle ce qu’il commande. Un passage secret (⇄) connu s’emprunte en un pas : quand le héros actif est dessus, l’application propose de l’emprunter (après « Pas maintenant », touchez le héros pour que la proposition revienne).</li>
              <li>« Fin du tour » passe au héros suivant, puis à Zargon.</li>
              <li>Allié à escorter (certaines quêtes) : une fois trouvé, il joue juste après le héros qui l’a trouvé. À son tour, lancez ses dés rouges, touchez son pion et déplacez-le ; il n’a pas d’action. Les monstres peuvent l’attaquer ; à 0 point de Vie, il meurt. Ramené vivant sur l’escalier, il rapporte sa récompense en fin de quête réussie.</li>
              <li>Colonne de droite : ↶ annuler, MJ (vue du maître du jeu), + et − zoom, ⤢ plateau ajusté à l’écran. On peut aussi pincer le plateau à deux doigts pour zoomer, et le faire glisser avec un doigt.</li>
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
      const trouves = decouvrirAllies(etat);
      const tombes = mortsAllies(etat);
      // Courage prend fin quand plus aucun monstre n'est en vue.
      if (!etat.monstres.some(m => etat.revele.includes(Plateau.idx(L, m.x, m.y)))) etat.heros.forEach(h => { delete h.courage; });
      // Escalier : la question « terminer la quête ? » n'a de sens qu'après un départ, et revient après un nouveau départ.
      if (quete.escalier) {
        const dehors = etat.heros.filter(debout).some(h => !surEscalier(h));
        if (dehors) { etat.sortisEscalier = true; delete etat.escalierRefuse; }
      }
      // Un héros soigné n'est plus « à terre en attente ».
      etat.heros.forEach(h => { if (h.corps !== 0) delete h.secoursReporte; });
      partie.etat = etat;
      if (trouves.length) annoncerAllies(trouves);
      enregistrer();
      dessiner();
      // Après le message éventuel de l'appelant.
      if (tombes.length) setTimeout(() => msg(...tombes.map(h => `☠ ${h.nom} ne survit pas.${allieDe(h)?.recompense?.or ? ' La récompense est perdue.' : ''}`)), 0);
    }

    /* ---------- Alliés à escorter (v0.33.0) ----------
       Un allié de la quête (ex. un prisonnier) reste caché jusqu'à ce que sa case soit dévoilée.
       Il rejoint alors les héros : il joue juste après le héros qui l'a trouvé (son escorte),
       se déplace au toucher comme un héros (on lance ses dés rouges à la main), n'a aucune action,
       peut être attaqué par les monstres, et meurt à 0 point de Vie (pas de secours).
       Revenu vivant à l'escalier, il rapporte sa récompense en fin de quête réussie. */
    const allieDe = h => (h?.allie ? (quete.allies || []).find(a => a.id === h.allie) : null);

    function decouvrirAllies(e) {
      const trouves = [];
      for (const a of quete.allies || []) {
        e.alliesTrouves = e.alliesTrouves || [];
        if (e.alliesTrouves.includes(a.id) || !e.revele.includes(Plateau.idx(L, a.x, a.y))) continue;
        e.alliesTrouves.push(a.id);
        const ordre = e.ordre || [];
        const actif = e.heros.find(h => h.id === ordre[e.tour?.index]);
        const escorte = actif && !actif.allie ? actif
          : e.heros.find(h => !h.allie && !h.mort && h.corps !== 0 && h.x != null && ordre.includes(h.id));
        const id = 'allie-' + a.id;
        const court = a.nom.split(/\s+/).map(m => m[0]).join('').slice(0, 2).toUpperCase();
        const corps = a.corps || 2;
        e.heros.push({ id, allie: a.id, escorte: escorte?.id || null, classe: 'allie', nom: a.nom, court,
          x: a.x, y: a.y, corps, corpsMax: corps, attaque: 0, defense: a.defense || 2, or: 0, inventaire: [] });
        const pos = escorte ? ordre.indexOf(escorte.id) + 1 : ordre.length;
        ordre.splice(pos, 0, id);
        e.ordre = ordre;
        if (e.tour && pos <= e.tour.index) e.tour.index++;
        if (a.alarme) {
          // Alarme : tout le donjon est dévoilé, les portes (non secrètes) s'ouvrent, tous les monstres s'éveillent.
          e.revele = g.zones.map((z, i) => i);
          e.penombre = {};
          for (const p of quete.portes || []) if (!p.secrete && !e.portesOuvertes.includes(p.id)) e.portesOuvertes.push(p.id);
          for (const m of e.monstres) m.vu = true;
        }
        trouves.push({ a, escorte: escorte?.nom || null });
      }
      return trouves;
    }

    // Allié tombé à 0 : il meurt aussitôt (ni potion, ni héritage) et quitte l'ordre de jeu.
    function mortsAllies(e) {
      const tombes = [];
      for (const h of e.heros) {
        if (!h.allie || h.mort || h.corps !== 0) continue;
        const etaitActif = (e.ordre || [])[e.tour?.index] === h.id;
        h.mort = true; h.mortEn = { x: h.x, y: h.y }; h.x = null; h.y = null;
        if (etaitActif && e.tour && !e.zargon) { e.tour.deplacement = null; passerAuSuivant(e); }
        tombes.push(h);
      }
      return tombes;
    }

    function annoncerAllies(trouves) {
      const textes = trouves.map(({ a, escorte }) => {
        const n = a.deplacementDes || 2, d = a.defense || 2;
        return [a.texte || `Vous avez trouvé ${a.nom} !`,
          a.alarme ? 'Une alarme retentit : tout le donjon apparaît et les portes s’ouvrent.' : '',
          `${a.nom} vous accompagne${escorte ? ` et joue juste après ${escorte}` : ''}. À son tour, lancez ${n} dé${n > 1 ? 's' : ''} rouge${n > 1 ? 's' : ''}, puis touchez son pion pour le déplacer.`,
          `${a.nom} n’attaque pas et se défend avec ${d} dé${d > 1 ? 's' : ''}.`,
          a.recompense?.or ? `Récompense : ${a.recompense.or} pièces d’or à partager, si ${a.nom} atteint l’escalier en vie.` : ''].filter(Boolean).join(' ');
      });
      evenement = { genre: 'fin', titre: trouves.map(t => t.a.nom).join(', '), ambiance: '', texte: textes.join(' '), figure: 'allie-' + trouves[0].a.id };
    }

    function annuler() {
      if (!historique.length) return;
      etat = JSON.parse(historique.pop());
      partie.etat = etat;
      selection = null; combat = null; conclusion = null; ciblage = false; djinnPorteChoix = false; djinnMonstreChoix = false; sortCible = null; fenetreActions = null; evenement = null; heritage = null; potionInconnue = null;
      enregistrer();
      msg('Action annulée.');
      dessiner();
      // Une fiche restée ouverte montre l'état rétabli.
      const fiche = conteneur.querySelector('#pl-fiche');
      if (fiche && !fiche.hidden && ficheHeros && etat.heros.some(k => k.id === ficheHeros)) ouvrirFiche(ficheHeros);
    }

    /* ---------- Dessin ---------- */

    function dessiner() {
      const vu = new Set(etat.revele);
      const visible = i => vueMJ || vu.has(i);
      svg.innerHTML = '';
      svg.classList.toggle('mj', vueMJ);

      /* 0. Image du plateau (Réglages › Image du plateau ; reste sur l'appareil).
            Seulement pour un plateau de 26 × 19 cases (celui du jeu de base). Les marges
            indiquent, en % de l'image, où commence et finit le quadrillage. */
      const img = options.imagePlateau;
      const avecImage = !!(img?.donnees && L === 26 && H === 19);
      svg.classList.toggle('avec-image', avecImage);
      svg.classList.toggle('murs-app', !avecImage || !!img?.murs);
      if (avecImage) {
        const g0 = (img.gauche || 0) / 100, d0 = (img.droite || 0) / 100, h0 = (img.haut || 0) / 100, b0 = (img.bas || 0) / 100;
        const largeur = (L * T) / Math.max(0.05, 1 - g0 - d0), hauteur = (H * T) / Math.max(0.05, 1 - h0 - b0);
        el('image', { href: img.donnees, x: -g0 * largeur, y: -h0 * hauteur, width: largeur, height: hauteur, preserveAspectRatio: 'none', class: 'image-plateau' }, svg);
      }

      // 1. Cases. Thème « Pierre et couleurs » (theme-plateau.js) sauf avec une image ou en thème classique.
      const theme = !avecImage && (options.themePlateau || 'pierre') === 'pierre';
      svg.classList.toggle('theme-pierre', theme);
      const remplissage = theme ? ThemePlateau.preparer(el('defs', {}, svg), el, T, Object.keys(g.pieces || {})) : null;
      const fond = el('g', {}, svg);
      for (let i = 0; i < L * H; i++) {
        const z = g.zones[i];
        const cls = z === '#' ? 'c-roche' : theme ? 'c-theme' : z === '.' ? 'c-couloir' : 'c-piece';
        el('rect', { x: (i % L) * T, y: Math.floor(i / L) * T, width: T, height: T, class: 'case ' + cls, 'data-i': i,
          ...(theme && z !== '#' ? { fill: remplissage(z) } : {}) }, fond);
      }
      if (theme) el('rect', { x: 0, y: 0, width: L * T, height: H * T, fill: 'url(#t-grain)', class: 'grain' }, fond);

      // 2. Escalier
      if (quete.escalier) {
        const { x, y } = quete.escalier;
        if (visible(Plateau.idx(L, x, y))) {
          const gr = el('g', { class: 'escalier' }, svg);
          el('rect', { x: x * T + 3, y: y * T + 3, width: 2 * T - 6, height: 2 * T - 6, rx: 4 }, gr);
          if (!Icones.poser(gr, 'plateau', 'escalier', (x + 1) * T, (y + 1) * T, T * 1.4))
            for (let k = 1; k < 5; k++) el('line', { x1: x * T + 6, x2: x * T + 2 * T - 6, y1: y * T + k * 2 * T / 5, y2: y * T + k * 2 * T / 5 }, gr);
        }
      }

      // 3. Mobilier
      for (const m of quete.mobilier || []) {
        if (!visible(Plateau.idx(L, m.x, m.y))) continue;
        const gr = el('g', { class: 'mobilier m-' + m.type }, svg);
        const ml = m.l || 1, mh = m.h || 1;
        el('rect', { x: m.x * T + 4, y: m.y * T + 4, width: ml * T - 8, height: mh * T - 8, rx: 3 }, gr);
        el('title', {}, gr).textContent = m.nom;
        // Pictogramme centré ; sur un meuble allongé d'au moins 3 cases, le nom s'ajoute à côté.
        const avecNom = Icones.existe('meuble', m.type) && Math.max(ml, mh) >= 3 && Math.min(ml, mh) === 1;
        const taille = Math.min(ml, mh) * T * 0.75;
        const icx = avecNom && ml >= mh ? (m.x + 0.5) * T : (m.x + ml / 2) * T;
        const icy = avecNom && mh > ml ? (m.y + 0.5) * T : (m.y + mh / 2) * T;
        if (Icones.poser(gr, 'meuble', m.type, icx, icy, taille)) {
          if (avecNom) {
            const vertical = mh > ml;
            const t = el('text', { x: vertical ? (m.x + 0.5) * T : (m.x + 0.5 + ml / 2) * T, y: vertical ? (m.y + 0.5 + mh / 2) * T + 4 : (m.y + 0.5) * T + 4, class: 'etiquette' }, gr);
            t.textContent = m.nom;
          }
        } else {
          // Meuble sans pictogramme : son nom (abrégé sur une seule case).
          const t = el('text', { x: (m.x + ml / 2) * T, y: (m.y + mh / 2) * T + 4, class: 'etiquette' }, gr);
          t.textContent = ml > 1 || mh > 1 ? m.nom : m.nom.slice(0, 3);
        }
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
          if (!Icones.poser(gp, 'piege', p.type, p.x * T + T / 2, p.y * T + T / 2, T * 0.68, 'icone symbole-piege')) {
            const t = el('text', { x: p.x * T + T / 2, y: p.y * T + T / 2 + 6, class: 'symbole-piege' }, gp);
            t.textContent = SYMBOLES_PIEGES[p.type] || '!';
          }
        }
      }

      // 3 ter. Passages secrets (⇄) connus ; interrupteurs (◉) repérés. En vue MJ, aussi ceux encore cachés.
      for (const p of quete.passages || []) {
        const connu = Plateau.passageConnu(etat, p.id);
        for (const [x, y] of [p.a, p.b]) {
          if (!(vueMJ || (connu && vu.has(Plateau.idx(L, x, y))))) continue;
          const gp = el('g', { class: 'passage' + (connu ? '' : ' cache') }, svg);
          el('rect', { x: x * T + 3, y: y * T + 3, width: T - 6, height: T - 6, rx: 8 }, gp);
          el('text', { x: x * T + T / 2, y: y * T + T / 2 + 7 }, gp).textContent = '⇄';
        }
      }
      for (const t of quete.interrupteurs || []) {
        const st = etat.interrupteurs?.[t.id];
        if (!(vueMJ || (st?.trouve && vu.has(Plateau.idx(L, t.x, t.y))))) continue;
        const gi = el('g', { class: 'interrupteur' + (st?.trouve ? '' : ' cache') + (st?.active ? ' actif' : '') }, svg);
        el('circle', { cx: t.x * T + T / 2, cy: t.y * T + T / 2, r: T / 2 - 6 }, gi);
        el('text', { x: t.x * T + T / 2, y: t.y * T + T / 2 + 7 }, gi).textContent = '◉';
      }

      // 4. Murs (traits épais sur les bords entre zones différentes) ; thème pierre : trait clair sur une ombre.
      const ombres = theme ? el('g', { class: 'murs-ombre' }, svg) : null;
      const murs = el('g', { class: 'murs' }, svg);
      for (let y = 0; y < H; y++) for (let x = 0; x < L; x++) {
        const i = Plateau.idx(L, x, y);
        if (x + 1 < L) {
          const j = i + 1;
          if (Plateau.mur(g, i, j) && (visible(i) || visible(j))) {
            const a = { x1: (x + 1) * T, x2: (x + 1) * T, y1: y * T, y2: (y + 1) * T };
            el('line', a, murs); if (ombres) el('line', a, ombres);
          }
        }
        if (y + 1 < H) {
          const j = i + L;
          if (Plateau.mur(g, i, j) && (visible(i) || visible(j))) {
            const a = { x1: x * T, x2: (x + 1) * T, y1: (y + 1) * T, y2: (y + 1) * T };
            el('line', a, murs); if (ombres) el('line', a, ombres);
          }
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
        const cls = 'porte' + (ouverte ? ' ouverte' : '') + (!trouvee ? ' secrete' : '') + (porteProposee()?.id === p.id ? ' proposee' : '')
          + (djinnPorteChoix && !ouverte && !vueMJ ? ' cible-djinn' : '');
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
        // Cibles entourées : monstres attaquables (attaque normale) ou tout monstre en vue (Djinn).
        const visableSort = sortCible && !vueMJ && ciblesSort(sortCible).monstres.some(c => c.id === m.id);
        const visableCible = (ciblage && ciblesAttaque().some(c => c.id === m.id)) || (djinnMonstreChoix && !vueMJ && vu.has(Plateau.idx(L, m.x, m.y))) || visableSort;
        // Pointillés : cible qu'une autre figurine interceptera (sort ou tir).
        const horsVueSort = (visableSort && !Sorts.sort(sortCible).partout && intercepte(herosActif(), m))
          || (ciblage && visableCible && intercepte(herosActif(), m));
        const gr = el('g', { class: 'pion monstre' + (vu.has(Plateau.idx(L, m.x, m.y)) ? '' : ' cache') + (visableCible ? ' cible' : '') + (horsVueSort ? ' hors-vue' : ''), 'data-monstre': m.id }, svg);
        el('rect', { x: m.x * T + 3, y: m.y * T + 3, width: T - 6, height: T - 6, rx: 5 }, gr);
        el('title', {}, gr).textContent = m.nom || infoMonstre(m.type).nom;
        if (!Icones.poser(gr, 'monstre', m.type, m.x * T + T / 2, m.y * T + T / 2, T - 9)) {
          const t = el('text', { x: m.x * T + T / 2, y: m.y * T + T / 2 + 5 }, gr);
          t.textContent = infoMonstre(m.type).court;
        }
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
        const effets = etat.tour.deplacement.effets || {};
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = actif.x + dx, ny = actif.y + dy;
          if (raisonDeplacementSort(actif, nx, ny, effets)) continue;
          el('rect', { x: nx * T + 3, y: ny * T + 3, width: T - 6, height: T - 6, rx: 6 }, cibles);
        }
        for (const [nx, ny] of Plateau.sortiesPassage(g, etat, actif.x, actif.y)) {
          if (Plateau.raisonBlocage(g, etat, actif.x, actif.y, nx, ny)) continue;
          el('rect', { x: nx * T + 3, y: ny * T + 3, width: T - 6, height: T - 6, rx: 6 }, cibles);
        }
      }

      // 8. Héros
      for (const h of etat.heros) {
        if (h.x == null) continue;
        const cibleS = sortCible && !vueMJ && ciblesSort(sortCible).heros.some(k => k.id === h.id);
        const horsVueS = cibleS && !Sorts.sort(sortCible).partout && h.id !== actif?.id && intercepte(actif, h);
        const cls = 'pion heros h-' + h.id + (h.allie ? ' allie' : '') + (selection === h.id ? ' choisi' : '') + (!vueMJ && actif?.id === h.id ? ' actif' : '') + (h.corps === 0 ? ' a-terre' : '')
          + (cibleS ? ' cible-sort' : '') + (horsVueS ? ' hors-vue' : '');
        const gr = el('g', { class: cls, 'data-heros': h.id }, svg);
        // Héros actif : anneau blanc autour du pion, visible quelle que soit sa couleur.
        if (cls.includes(' actif')) el('circle', { cx: h.x * T + T / 2, cy: h.y * T + T / 2, r: T / 2 - 1, class: 'anneau' }, gr);
        el('circle', { cx: h.x * T + T / 2, cy: h.y * T + T / 2, r: T / 2 - 3 }, gr);
        el('title', {}, gr).textContent = h.nom;
        if (!Icones.poser(gr, 'heros', h.classe || h.id, h.x * T + T / 2, h.y * T + T / 2, T - 12)) {
          const t = el('text', { x: h.x * T + T / 2, y: h.y * T + T / 2 + 5 }, gr);
          t.textContent = h.court;
        }
      }

      // 8 bis. Zones tactiles des portes, au-dessus des pions : un héros posé
      //        contre une porte ne doit pas empêcher de la toucher.
      const couchePortes = el('g', { class: 'portes-tactiles' }, svg);
      for (const z of zonesPortes) el('rect', z.attrs, el('g', { 'data-porte': z.id }, couchePortes));

      // Compteur de pas du tour (en filigrane, dans le coin des cases parcourues ; effacé à la fin du tour).
      if (!vueMJ && actif && etat.tour.trace) {
        const gt = el('g', { class: 'trace-pas' }, svg);
        for (const [cle, n] of Object.entries(etat.tour.trace)) {
          const [x, y] = cle.split(',').map(Number);
          if (!visible(Plateau.idx(L, x, y))) continue;
          el('text', { x: x * T + 4, y: y * T + T * 0.3 }, gt).textContent = n;
        }
      }

      // 9. Brouillard
      const brouillard = el('g', { class: 'brouillard' }, svg);
      for (let i = 0; i < L * H; i++) {
        if (!vu.has(i)) el('rect', { x: (i % L) * T, y: Math.floor(i / L) * T, width: T + 0.5, height: T + 0.5 }, brouillard);
      }

      const defs = el('defs', {}, svg);

      // 9 bis. Bord du brouillard en fondu : une case visible qui donne librement (sans mur ni
      //        porte fermée) sur une case encore dans le brouillard s'assombrit de ce côté,
      //        sur une demi-case. Les cases de pénombre (10) ont déjà leur propre fondu.
      const bordMax = vueMJ ? 0.5 : 0.92;
      const COTES = [
        { nom: 'haut', dx: 0, dy: -1, grad: { x1: 0, y1: 1, x2: 0, y2: 0 }, rect: (x, y) => ({ x, y, width: T + 0.5, height: T / 2 }) },
        { nom: 'bas', dx: 0, dy: 1, grad: { x1: 0, y1: 0, x2: 0, y2: 1 }, rect: (x, y) => ({ x, y: y + T / 2, width: T + 0.5, height: T / 2 + 0.5 }) },
        { nom: 'gauche', dx: -1, dy: 0, grad: { x1: 1, y1: 0, x2: 0, y2: 0 }, rect: (x, y) => ({ x, y, width: T / 2, height: T + 0.5 }) },
        { nom: 'droite', dx: 1, dy: 0, grad: { x1: 0, y1: 0, x2: 1, y2: 0 }, rect: (x, y) => ({ x: x + T / 2, y, width: T / 2 + 0.5, height: T + 0.5 }) },
      ];
      for (const c of COTES) {
        const grad = el('linearGradient', { id: 'bord-' + c.nom, ...c.grad }, defs);
        el('stop', { offset: 0, 'stop-color': '#000', 'stop-opacity': 0 }, grad);
        el('stop', { offset: 1, 'stop-color': '#000', 'stop-opacity': bordMax }, grad);
      }
      const bords = el('g', { class: 'penombre bords-brouillard' }, svg);
      for (const i of vu) {
        if (String(i) in (etat.penombre || {})) continue;
        const x = i % L, y = Math.floor(i / L);
        for (const c of COTES) {
          const nx = x + c.dx, ny = y + c.dy;
          if (nx < 0 || ny < 0 || nx >= L || ny >= H) continue;
          const j = Plateau.idx(L, nx, ny);
          if (vu.has(j) || g.zones[j] === '#' || !Plateau.ouvert(g, etat, i, j)) continue;
          el('rect', { ...c.rect(x * T, y * T), fill: `url(#bord-${c.nom})` }, bords);
        }
      }

      // 10. Pénombre : la dernière case vue d'un couloir s'estompe vers le noir,
      //    dans la direction du regard (dégradé propre à chaque case).
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
      if (porte && !djinnPorteChoix && !djinnMonstreChoix && !sortCible) return toucherPorte(porte.dataset.porte);
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

      // Sort ciblé : toucher le héros ou le monstre visé.
      if (sortCible) {
        const { heros: hs, monstres: ms } = ciblesSort(sortCible);
        const hid = heros?.dataset.heros || (c && hs.find(k => k.x === c.x && k.y === c.y)?.id);
        const mid = monstreTouche?.dataset.monstre || (c && ms.find(k => k.x === c.x && k.y === c.y)?.id);
        const id = sortCible;
        if (hid && hs.some(k => k.id === hid)) { sortCible = null; return lancerSort(id, { genre: 'heros', id: hid }); }
        if (mid && ms.some(k => k.id === mid)) { sortCible = null; return lancerSort(id, { genre: 'monstre', id: mid }); }
        return msg(`${Sorts.sort(id).nom} : touchez une cible entourée, ou « Retour ».`);
      }
      // Sort du Djinn : toucher le monstre à attaquer (n'importe où, s'il est en vue).
      if (djinnMonstreChoix) {
        const mt = monstreTouche && etat.monstres.find(k => k.id === monstreTouche.dataset.monstre);
        if (mt && etat.revele.includes(Plateau.idx(L, mt.x, mt.y))) { djinnMonstreChoix = false; return djinnAttaque(mt.id); }
        return msg('Djinn : touchez un monstre entouré de rouge, ou « Retour ».');
      }
      // Sort du Djinn : toucher la porte fermée à ouvrir.
      if (djinnPorteChoix) {
        if (porte && !etat.portesOuvertes.includes(porte.dataset.porte)) { djinnPorteChoix = false; return djinnPorte(porte.dataset.porte); }
        return msg(porte ? 'Cette porte est déjà ouverte : touchez une porte fermée.' : 'Djinn : touchez une porte fermée (encadrée en bleu), ou « Retour ».');
      }
      // Vue des joueurs : en mode attaque, toucher un monstre le choisit comme cible.
      if (ciblage) {
        if (monstreTouche) return choisirCible(monstreTouche.dataset.monstre);
        return msg('Touchez un monstre entouré de rouge, ou « Retour ».');
      }
      // Toucher le héros actif : commencer ou arrêter son déplacement.
      const actifTouche = herosActif();
      if (actifTouche && (heros?.dataset.heros === actifTouche.id || (c && c.x === actifTouche.x && c.y === actifTouche.y))) {
        // Contre une porte fermée écartée par « Pas maintenant » : le toucher fait revenir l'invite.
        const cle = porteRefuseeIci(actifTouche);
        if (cle) { refusees.delete(cle); return dessiner(); }
        const clePassage = `passage@${actifTouche.x},${actifTouche.y}`;
        if (refusees.has(clePassage) && Plateau.sortiesPassage(g, etat, actifTouche.x, actifTouche.y).length) { refusees.delete(clePassage); return dessiner(); }
        return basculerDeplacement();
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

    // Héros encore en jeu : ni mort, ni à terre (0 point de Vie), et posé sur le plateau.
    const debout = h => !!h && !h.mort && h.x != null && h.corps !== 0;
    // Prochain index de l'ordre de jeu (à partir de « depuis ») d'un héros qui peut jouer.
    function prochainJoueur(e, depuis) {
      const o = e.ordre || [];
      let i = depuis;
      while (i < o.length && !debout(e.heros.find(k => k.id === o[i]))) i++;
      return i;
    }
    // Passe au héros suivant (ou à Zargon) ; utilisé par « Fin du tour » et quand le héros actif tombe.
    function passerAuSuivant(e) {
      e.tour = { numero: e.tour.numero, index: prochainJoueur(e, e.tour.index + 1) };
      if (e.tour.index >= (e.ordre || []).length) demarrerZargon(e);
    }

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
          return `<li class="${n === t.index ? 'en-cours' : ''}${h.corps === 0 ? ' a-terre' : ''}${h.mort ? ' mort' : ''}"><button class="puce-heros" data-fiche="${hid}" aria-label="Fiche : ${h.nom}">
            <span class="pastille h-${hid}${h.allie ? ' allie' : ''}"></span>${h.court}<span class="pc">${h.mort ? '☠' : `♥${h.corps ?? '?'}`}</span></button></li>`;
        }).join('')
        + `<li class="zargon ${t.index >= ordre.length ? 'en-cours' : ''}" title="Zargon">Z</li>`;

      conteneur.querySelectorAll('[data-fiche]').forEach(b => b.addEventListener('click', () => ouvrirFiche(b.dataset.fiche)));
      const p = conteneur.querySelector('#pl-tour');
      conteneur.querySelector('#pl-haut').classList.toggle('saisie', (ciblage || djinnMonstreChoix || djinnPorteChoix || sortCible) && !vueMJ);
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
      } else if (sortCible) {
        html += `<strong>${actif.nom}</strong></span>
          <span>${Sorts.groupe(Sorts.sort(sortCible).groupe).symbole} ${Sorts.sort(sortCible).nom} : touchez la cible.</span>
          <button id="tr-retour-sort">Retour</button>`;
      } else if (djinnPorteChoix || djinnMonstreChoix) {
        html += `<strong>${actif.nom}</strong></span>
          <span>🌪 Djinn : touchez ${djinnPorteChoix ? 'la porte à ouvrir' : 'le monstre à attaquer'}.</span>
          <button id="tr-retour-djinn">Retour</button>`;
      } else if (actif.allie) {
        const a = allieDe(actif), n = a?.deplacementDes || 2;
        html += `<strong>${actif.nom}</strong></span>
          <span class="discret">${n} dé${n > 1 ? 's' : ''} rouge${n > 1 ? 's' : ''}, puis touchez son pion</span>
          <button id="tr-fin-tour" class="principal">Fin du tour</button>`;
      } else {
        // Bandeau réduit : les choix détaillés sont dans la fenêtre « Actions ».
        html += `<strong>${actif.nom}</strong></span>
          <button id="tr-actions">Actions</button>
          <button id="tr-fiche">Fiche</button>
          <button id="tr-fin-tour" class="principal">Fin du tour</button>`;
      }
      p.innerHTML = html;
      const sur = (sel, f) => p.querySelector(sel)?.addEventListener('click', f);
      sur('#tr-actions', () => { fenetreActions = 'menu'; djinnPorteChoix = false; djinnMonstreChoix = false; sortCible = null; dessiner(); });
      sur('#tr-fin-tour', finDuTour);
      sur('#tr-fiche', () => ouvrirFiche(herosActif().id));
      sur('#tr-fin-zargon', finTourZargon);
      sur('#tr-retour-attaque', () => { ciblage = false; msg(''); dessiner(); });
      sur('#tr-retour-sort', () => { sortCible = null; fenetreActions = 'sorts'; msg(''); dessiner(); });
      sur('#tr-retour-djinn', () => { djinnPorteChoix = false; djinnMonstreChoix = false; evenement = { genre: 'djinn', sort: 'djinn' }; msg(''); dessiner(); });
    }

    // Fenêtre « Actions » du héros actif : null (fermée), 'menu' (choix) ou 'sorts'.
    let fenetreActions = null;

    /* Déplacement : toucher le héros actif le commence (sans saisir les dés : les joueurs
       comptent eux-mêmes), le toucher à nouveau l'arrête. Pas de limite de cases ; chaque pas,
       retour en arrière compris, augmente le compteur affiché en filigrane jusqu'à la fin du tour. */
    function basculerDeplacement() {
      if (etat.tour.deplacement) return terminerDeplacement();
      const actif = herosActif();
      fenetreActions = null; ciblage = false; combat = null; conclusion = null;
      const avert = [];
      // Écart n° 1 : un seul déplacement par tour. On avertit, on ne bloque pas.
      if (etat.tour.aBouge) avert.push(`⚠ ${actif.nom} s’est déjà déplacé ce tour-ci (règle : un seul déplacement par tour).`);
      if (actif.endormi) avert.push(`⚠ ${actif.nom} est endormi.`);
      if (actif.passeTour) avert.push(`⚠ Tornade : ${actif.nom} devrait passer ce tour.`);
      modifier(e => {
        const k = e.heros.find(z => z.id === actif.id);
        // Sorts « au prochain déplacement » : ils s'appliquent à ce déplacement, puis disparaissent.
        const effets = { brume: !!k.brume, traverse: !!k.traverse };
        delete k.brume; delete k.traverse; delete k.ventVif;
        e.tour.deplacement = { effets };
        e.tour.aBouge = true;
      });
      msg(...avert, `${actif.nom} se déplace : touchez les cases éclairées. Touchez ${actif.nom} pour s’arrêter.`);
    }

    // Un pas (ou un saut de 2 cases) : compteur du tour et numéro inscrit sur la case d'arrivée.
    function compterPas(e, x, y, n = 1) {
      e.tour.pas = (e.tour.pas || 0) + n;
      (e.tour.trace = e.tour.trace || {})[x + ',' + y] = e.tour.pas;
    }

    function avancer({ x, y }) {
      const actif = herosActif();
      const effets = etat.tour.deplacement?.effets || {};
      const raison = raisonDeplacementSort(actif, x, y, effets);
      if (raison) return msg(raison);
      // Piège connu sur la case : on propose de sauter (ou de descendre dans la fosse).
      const piege = Plateau.piegeEn(etat, x, y);
      if (piege && (piege.trouve || piege.declenche)) {
        evenement = { genre: 'saut', piege: piege.id, depuis: [actif.x, actif.y], dir: [x - actif.x, y - actif.y] };
        return dessiner();
      }
      const surHeros = Plateau.autreHerosEn(etat, actif.id, x, y);
      const surMonstre = etat.monstres.some(m => m.x === x && m.y === y);
      const depuis = [actif.x, actif.y];
      const parPassage = !!Plateau.passageEntre(g, etat, actif.x, actif.y, x, y);
      // À travers la pierre : un pas qui franchit un mur (ou entre dans le roc, ou en sort) compte un mur.
      const mur = !!effets.traverse && !parPassage && (!Plateau.ouvert(g, etat, Plateau.idx(L, actif.x, actif.y), Plateau.idx(L, x, y))
        || g.zones[Plateau.idx(L, x, y)] === '#' || g.zones[Plateau.idx(L, actif.x, actif.y)] === '#');
      let actionne = null;
      modifier(e => {
        const h = e.heros.find(k => k.id === actif.id);
        h.x = x; h.y = y;
        if (mur && e.tour.deplacement?.effets) e.tour.deplacement.effets.murs = (e.tour.deplacement.effets.murs || 0) + 1;
        compterPas(e, x, y);
        // Interrupteur repéré sous les pieds du héros : il s'actionne.
        const t = Plateau.interrupteurPret(g, e, x, y);
        if (t) actionne = { t, ...Plateau.actionnerInterrupteur(g, e, t.id) };
      });
      // « Pas maintenant » sur un passage ne vaut que tant que le héros reste sur la case.
      for (const k of [...refusees]) if (k.startsWith('passage@') && k !== `passage@${x},${y}`) refusees.delete(k);
      // Piège caché : il se déclenche sous les pieds du héros.
      if (piege) return declencherPiege(piege.id, depuis, [x - depuis[0], y - depuis[1]]);
      if (actionne) {
        const np = actionne.passages.length, nd = actionne.portes.length;
        const effets = [np ? (np > 1 ? `${np} passages secrets s’ouvrent.` : 'Un passage secret s’ouvre.') : '',
          nd ? (nd > 1 ? `${nd} portes secrètes apparaissent.` : 'Une porte secrète apparaît.') : ''].filter(Boolean).join(' ');
        evenement = { genre: 'fin', titre: 'Interrupteur', ambiance: '',
          texte: [actionne.t.texte || `Sous le pied de ${actif.nom}, la dalle s’enfonce avec un déclic.`, effets || 'Rien ne semble se passer… pour l’instant.'].join(' ') };
        return dessiner();
      }
      if (parPassage) return msg(`${actif.nom} emprunte le passage secret.`);
      if (effets.traverse) {
        const n = etat.tour.deplacement?.effets?.murs || 0;
        return msg(`À travers la pierre : ${n} mur${n > 1 ? 's' : ''} traversé${n > 1 ? 's' : ''} (pas plus que le total de vos dés).`,
          dansLeRoc(herosActif()) ? `⚠ Roc massif : si ${actif.nom} s’arrête ici, il y restera emprisonné à jamais.` : '');
      }
      msg(surHeros ? `${actif.nom} passe la case de ${surHeros.nom} (on ne peut pas s’y arrêter).`
        : surMonstre ? 'Voile de brume : on traverse la case d’un monstre, mais on ne peut pas s’y arrêter.' : '');
    }

    // Raison de refuser un pas, en tenant compte des sorts de déplacement en cours.
    function raisonDeplacementSort(h, x, y, effets) {
      if ((!effets.brume && !effets.traverse) || Plateau.passageEntre(g, etat, h.x, h.y, x, y)) return Plateau.raisonBlocage(g, etat, h.x, h.y, x, y);
      if (x < 0 || y < 0 || x >= L || y >= H) return 'Hors du plateau.';
      if (Math.abs(x - h.x) + Math.abs(y - h.y) !== 1) return 'Une case à la fois, sans diagonale : touchez une case voisine du héros.';
      if (!effets.traverse && g.zones[Plateau.idx(L, x, y)] === '#') return 'Roche : impossible de passer.';
      if (Plateau.eboulementEn(etat, x, y)) return 'Un éboulement bloque le passage pour toujours.';
      if (!effets.traverse && !Plateau.ouvert(g, etat, Plateau.idx(L, h.x, h.y), Plateau.idx(L, x, y))) return 'Un mur ou une porte fermée bloque le passage.';
      if (!effets.brume && etat.monstres.some(m => m.x === x && m.y === y)) return 'Un monstre bloque le passage.';
      const meuble = Plateau.meubleEn(g, x, y);
      if (meuble) return `${meuble.nom} : on ne peut pas passer par-dessus.`;
      return null;
    }

    // Arrêter le déplacement avant d'avoir tout utilisé (permis par les règles).
    // Règle (p. 12) : deux figurines peuvent partager la case de l'escalier ou une oubliette.
    function casePartageable(h) { return surEscalier(h) || Plateau.fosseEn(etat, h.x, h.y); }

    // Héros dans le roc massif (À travers la pierre, carte 2021).
    function dansLeRoc(h) { return !!h && h.x != null && g.zones[Plateau.idx(L, h.x, h.y)] === '#'; }
    // S'arrêter dans le roc : emprisonné à jamais (confirmation). Renvoie true si le héros y reste.
    function emprisonnerDansLeRoc(h) {
      if (!confirm(`${h.nom} est dans le roc massif. S’il s’arrête ici, il y restera emprisonné à jamais et sera perdu pour la quête.\n\nS’arrêter quand même ?`)) {
        msg(`Continuez le déplacement de ${h.nom} pour sortir du roc.`);
        return false;
      }
      modifier(e => { e.tour.deplacement = null; });
      mourir(h.id);
      msg(`☠ ${h.nom} est emprisonné à jamais dans le roc.`);
      return true;
    }

    function terminerDeplacement() {
      const actif = herosActif();
      if (dansLeRoc(actif)) return emprisonnerDansLeRoc(actif);
      if (etat.monstres.some(m => m.x === actif.x && m.y === actif.y)) return msg('Voile de brume : on ne peut pas s’arrêter sur la case d’un monstre.');
      const autre = !casePartageable(actif) && Plateau.autreHerosEn(etat, actif.id, actif.x, actif.y);
      if (autre) return msg(`On ne peut pas s’arrêter sur la case de ${autre.nom} : avancez encore d’une case.`);
      fenetreActions = null;
      modifier(e => { e.tour.deplacement = null; });
      msg(`${actif.nom} s’arrête (${etat.tour.pas || 0} case${(etat.tour.pas || 0) > 1 ? 's' : ''} ce tour-ci).`);
    }

    function finDuTour() {
      const actif = herosActif();
      if (dansLeRoc(actif)) return emprisonnerDansLeRoc(actif);
      if (etat.monstres.some(m => m.x === actif.x && m.y === actif.y)) return msg('On ne peut pas s’arrêter sur la case d’un monstre : avancez encore.');
      if (etat.tour.deplacement) {
        const autre = !casePartageable(actif) && Plateau.autreHerosEn(etat, actif.id, actif.x, actif.y);
        if (autre) return msg(`On ne peut pas s’arrêter sur la case de ${autre.nom} : avancez encore d’une case.`);
      }
      fenetreActions = null; ciblage = false; djinnPorteChoix = false; djinnMonstreChoix = false; sortCible = null; combat = null; conclusion = null; evenement = null;
      modifier(e => {
        const k = e.heros.find(z => z.id === actif.id);
        if (k) delete k.passeTour; // la Tornade ne dure qu'un tour
        passerAuSuivant(e);
      });
      const suivant = herosActif();
      msg(suivant ? `À ${suivant.nom} de jouer.` : '');
    }

    function finTourZargon() {
      conclusion = null;
      modifier(e => { e.tour = { numero: e.tour.numero + 1, index: prochainJoueur(e, 0) }; delete e.zargon; });
      msg(`Tour ${etat.tour.numero} : à ${herosActif()?.nom ?? '?'} de jouer.`);
    }

    /* ---------- Invite « ouvrir la porte ? » ----------
       Quand le héros actif se trouve contre une porte fermée qu'il connaît
       (porte normale, ou porte secrète déjà trouvée), on lui propose de l'ouvrir. */

    const refusees = new Set(); // « porte@x,y » : pas de nouvelle question tant que le héros reste là

    function porteProposee() {
      const h = herosActif();
      if (!h || h.allie || vueMJ || fenetreActions || ciblage || djinnPorteChoix || djinnMonstreChoix || sortCible || combat || conclusion || evenement || secours() || heritage) return null;
      return (quete.portes || []).find(p =>
        !etat.portesOuvertes.includes(p.id) && Plateau.porteVisible(etat, p) &&
        Plateau.devantPorte(h, p) &&
        !refusees.has(`${p.id}@${h.x},${h.y}`)) || null;
    }

    // Clé (« porte@x,y ») d'une porte fermée contre le héros, refusée à cet endroit, ou null.
    function porteRefuseeIci(h) {
      const p = (quete.portes || []).find(q =>
        !etat.portesOuvertes.includes(q.id) && Plateau.porteVisible(etat, q) &&
        Plateau.devantPorte(h, q) && refusees.has(`${q.id}@${h.x},${h.y}`));
      return p ? `${p.id}@${h.x},${h.y}` : null;
    }

    // Case de l'escalier (2 × 2 cases à partir de quete.escalier).
    function surEscalier(h) {
      const s = quete.escalier;
      return !!s && h.x != null && h.x >= s.x && h.x <= s.x + 1 && h.y >= s.y && h.y <= s.y + 1;
    }

    // Tous les héros debout sont revenus à l'escalier après en être partis : proposer la fin de la quête.
    function escalierPropose() {
      if (!quete.escalier || vueMJ || !herosActif() || fenetreActions || ciblage || combat || conclusion || evenement || secours() || heritage) return false;
      if (!etat.sortisEscalier || etat.escalierRefuse) return false;
      const vivants = etat.heros.filter(h => debout(h) && !h.allie);
      return vivants.length > 0 && vivants.every(surEscalier);
    }

    function dessinerInviteEscalier(boite) {
      const aTerre = etat.heros.filter(h => !h.allie && !h.mort && h.corps === 0).map(h => h.nom);
      // Alliés : sont-ils ramenés ? (la récompense n'est versée que s'ils sont sur l'escalier, vivants)
      const allies = etat.heros.filter(h => h.allie).map(h => {
        const or = allieDe(h)?.recompense?.or;
        if (h.mort) return `${h.nom} n’a pas survécu.`;
        if (surEscalier(h)) return `${h.nom} est à l’escalier${or ? ` : ${or} pièces d’or à partager` : ''}.`;
        return `${h.nom} n’est pas à l’escalier${or ? ' : pas de récompense si vous terminez maintenant' : ''}.`;
      });
      boite.innerHTML = `<span>Tous les héros sont revenus à l’escalier. Terminer la quête ?${aTerre.length
          ? ` <span class="erreur">${echapperTexte(aTerre.join(', '))} (à terre) ${aTerre.length > 1 ? 'seront comptés comme morts' : 'sera compté comme mort'}.</span>` : ''}${allies.length ? ' ' + echapperTexte(allies.join(' ')) : ''}</span>
        <button id="inv-reussie" class="principal">Quête réussie</button>
        <button id="inv-echouee">Quête échouée</button>
        <button id="inv-pas-encore">Pas encore</button>`;
      boite.hidden = false;
      boite.querySelector('#inv-reussie').addEventListener('click', () => options.terminer?.('reussie'));
      boite.querySelector('#inv-echouee').addEventListener('click', () => options.terminer?.('echouee'));
      boite.querySelector('#inv-pas-encore').addEventListener('click', () => {
        etat.escalierRefuse = true; partie.etat = etat; enregistrer(); dessiner();
      });
    }

    /* Invite « emprunter le passage ? » (v0.27.1) : le héros actif est sur l'extrémité d'un
       passage secret connu. La case d'arrivée est souvent dans le brouillard : on ne peut pas
       compter sur la case éclairée. Après le passage, pas de nouvelle invite pour revenir
       tant que le héros reste sur la case d'arrivée. */
    function passageProposee() {
      const h = herosActif();
      if (!h || h.allie || vueMJ || fenetreActions || ciblage || djinnPorteChoix || djinnMonstreChoix || sortCible || combat || conclusion || evenement || secours() || heritage) return null;
      if (refusees.has(`passage@${h.x},${h.y}`)) return null;
      const sortie = Plateau.sortiesPassage(g, etat, h.x, h.y)[0];
      return sortie ? { sortie } : null;
    }

    function dessinerInvitePassage(boite, { sortie }) {
      const h = herosActif();
      boite.innerHTML = `<span>Passage secret sous ${echapperTexte(h.nom)}. L’emprunter ?</span>
        <button id="inv-passage" class="principal">Emprunter</button>
        <button id="inv-non">Pas maintenant</button>`;
      boite.hidden = false;
      boite.querySelector('#inv-passage').addEventListener('click', () => {
        const raison = Plateau.raisonBlocage(g, etat, h.x, h.y, ...sortie);
        if (raison) return msg(raison);
        if (!etat.tour.deplacement) basculerDeplacement();
        refusees.add(`passage@${sortie[0]},${sortie[1]}`);
        avancer({ x: sortie[0], y: sortie[1] });
      });
      boite.querySelector('#inv-non').addEventListener('click', () => {
        refusees.add(`passage@${h.x},${h.y}`);
        dessiner();
      });
    }

    function dessinerInvite() {
      const boite = conteneur.querySelector('#pl-invite');
      const p = porteProposee();
      if (!p) {
        const pa = passageProposee();
        if (pa) return dessinerInvitePassage(boite, pa);
        if (escalierPropose()) return dessinerInviteEscalier(boite);
        boite.hidden = true; return;
      }
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
        if (m.passeTour) { z.plan = { monstre: m.id, statut: 'tempete', ambiance: `Une tornade enveloppe ${nomM} : il passe son tour.` }; return; }
        let reveil = '';
        if (m.endormi) {
          // Carte 2021 : 1 dé rouge par point d'Esprit ; un 6 brise le sort.
          const des = desRouges(Math.max(0, Regles.valeurMonstre(caracs, m, 'esprit') ?? 0));
          if (!des.includes(6)) { z.plan = { monstre: m.id, statut: 'dort', de: des.join(', '), ambiance: Ambiance.tirer('dort', { monstre: nomM }) }; return; }
          delete m.endormi; // réveillé au début de son tour : il agit dans ce même tour (décision du 4/11/2026)
          reveil = Ambiance.tirer('reveil', { monstre: nomM }) + ' ';
        }
        const dep = Regles.valeurMonstre(caracs, m, 'deplacement');
        if (dep === null || Regles.valeurMonstre(caracs, m, 'attaque') === null) { z.plan = { monstre: m.id, erreur: true }; return; }
        const plan = { monstre: m.id, ...Plateau.planMonstre(g, e, m, dep, infosCible) };
        const h = plan.cible && e.heros.find(k => k.id === plan.cible);
        const cat = !e.revele.includes(Plateau.idx(L, m.x, m.y)) ? 'ombre' : !plan.chemin.length ? (h ? 'attaque' : 'immobile') : 'approche';
        plan.ambiance = reveil + Ambiance.tirer(cat, { monstre: infoMonstre(m.type).nom, heros: h?.nom || 'les héros', type: m.type });
        z.plan = plan;
        return;
      }
    }

    // Ce que les monstres « savent » d'un héros pour choisir leur cible (équipement compris).
    function infosCible(h) { return { attaque: caracHeros(h, 'attaque'), defense: caracHeros(h, 'defense') }; }

    // Après une attaque sans déplacement, un monstre opportuniste (gobelin) se replie :
    // le plan suivant est son repli (sinon on passe au monstre suivant).
    function suiteApresAttaque(e, idMonstre, repli) {
      const z = e.zargon, k = e.monstres.find(q => q.id === idMonstre);
      if (repli && k) {
        const chemin = Plateau.planRepli(g, e, k, Regles.valeurMonstre(caracs, k, 'deplacement') || 0);
        if (chemin.length) {
          z.plan = { monstre: k.id, chemin, cible: null, atteint: false, repliEnCours: true,
            ambiance: `${infoMonstre(k.type).nom} frappe puis détale hors de portée.` };
          return;
        }
      }
      z.n++; preparerZargon(e);
    }

    function decrirePlan() {
      const p = etat.zargon?.plan;
      if (!p) return '';
      const m = etat.monstres.find(k => k.id === p.monstre);
      const nom = nomVisible(m);
      if (p.erreur) return `${infoMonstre(m.type).nom} : déplacement ou attaque inconnus (Réglages › Caractéristiques).`;
      if (p.statut === 'tempete') return `${nom} passe son tour (Tornade).`;
      if (p.statut === 'dort') return `${nom} dort (dés rouges : ${p.de} ; il fallait un 6).`;
      const h = p.cible && etat.heros.find(k => k.id === p.cible);
      const pas = p.chemin.length;
      if (!pas && h) return `${nom} attaque ${h.nom} sans bouger.`;
      if (!pas) return `${nom} reste sur place.`;
      if (p.repliEnCours) return `${nom} se replie de ${pas} case${pas > 1 ? 's' : ''}.`;
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
            z.defense = { monstre: k.id, heros: p.cible, tirage, cranes, cle: 'z' + Date.now(), repli: !!p.repli };
            z.plan = null;
            return;
          }
          // Aucun crâne : le duel s'affiche quand même, avec la conclusion.
          resultat = { genre: 'zargon', heros: p.cible, monstre: k.id, type: k.type, tirage, cranes: 0, blancs: 0, degats: 0, cle: 'z' + Date.now() };
          suiteApresAttaque(e, k.id, p.repli);
          return;
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
      if (m && p.repliEnCours) return `${nomVisible(m)} se replie de ${pas} case${pas > 1 ? 's' : ''}.`;
      return m ? `${nomVisible(m)} ${pas ? `avance de ${pas} case${pas > 1 ? 's' : ''}` : 'reste sur place'}.` : '';
    }

    // Le joueur indique ses boucliers blancs : blessures, puis conclusion.
    function defendre(blancs) {
      const d = etat.zargon?.defense;
      if (!d) return;
      const h = etat.heros.find(k => k.id === d.heros);
      const m = etat.monstres.find(k => k.id === d.monstre);
      const degats = Math.max(0, d.cranes - blancs);
      const vieHerosAvant = h.corps;
      modifier(e => {
        const k = e.heros.find(z => z.id === d.heros);
        if (degats > 0) delete k.peauRoc;
        k.corps = Math.max(0, (k.corps ?? 0) - degats);
        e.zargon.defense = null;
        suiteApresAttaque(e, d.monstre, d.repli);
      });
      conclusion = {
        genre: 'zargon', heros: h.id, monstre: m.id, type: m.type, tirage: d.tirage, cranes: d.cranes, blancs, degats, cle: d.cle, vieHerosAvant,
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
    let djinnPorteChoix = false; // sort du Djinn : le joueur doit toucher la porte à ouvrir
    let djinnMonstreChoix = false; // sort du Djinn : le joueur doit toucher le monstre à attaquer
    let sortCible = null; // id du sort (autre que le Djinn) dont le joueur doit toucher la cible sur le plateau
    let combat = null;    // { monstre, ambiance } : duel ouvert, on attend les crânes du héros
    let conclusion = null; // résultat d'un duel, affiché jusqu'à « Suivant »

    /* Façon dont le héros h peut attaquer le monstre m avec l'arme en main (v0.30.0, règles du 23/11/2026) :
       - 'contact' : case voisine (sans diagonale), sans mur ni porte fermée entre les deux ;
       - 'diagonale' : arme « diagonale », case voisine en diagonale (même règle de coin que la ligne de vue) ;
       - 'tir' : arme « à distance » (ne s'utilise pas sur une case adjacente, diagonale comprise) ;
       - 'lancer' : arme « se lance » sur un monstre qui n'est pas au contact ; l'arme est perdue.
       Tir et lancer suivent la trajectoire de tir (voir tir()) : sans trajectoire libre, pas d'attaque ;
       une figurine sur la trajectoire reçoit le coup. null : pas attaquable. */
    function modeAttaque(h, m) {
      if (!h || !etat.revele.includes(Plateau.idx(L, m.x, m.y))) return null;
      const a = armeEnMain(h) || {};
      const dx = Math.abs(m.x - h.x), dy = Math.abs(m.y - h.y);
      const adjacent = Math.max(dx, dy) === 1;
      if (a.distance && !a.lancer) return !adjacent && tir(h, m) ? 'tir' : null;
      if (dx + dy === 1) return Plateau.ouvert(g, etat, Plateau.idx(L, h.x, h.y), Plateau.idx(L, m.x, m.y)) ? 'contact' : null;
      if (adjacent && a.diagonale && Plateau.ligneDeVue(g, etat, h.x, h.y, m.x, m.y)) return 'diagonale';
      if (a.lancer && tir(h, m)) return 'lancer';
      if (a.distance && !adjacent && tir(h, m)) return 'tir';
      return null;
    }

    /* Trajectoire d'un tir (arme ou sort) du tireur f vers la cible c (Plateau.trajectoireTir).
       Renvoie null si le tir est impossible (cible non dévoilée, mur, meuble…), sinon
       { genre, id } de la figurine qui reçoit le tir (la cible, ou celle qui l'intercepte). */
    function tir(f, c) {
      if (!etat.revele.includes(Plateau.idx(L, c.x, c.y))) return null;
      const occupees = new Map();
      for (const k of etat.heros) if (k.x != null && !k.mort && k.id !== f.id) occupees.set(Plateau.idx(L, k.x, k.y), { genre: 'heros', id: k.id });
      for (const k of etat.monstres) if (k.id !== f.id) occupees.set(Plateau.idx(L, k.x, k.y), { genre: 'monstre', id: k.id });
      const i = Plateau.trajectoireTir(g, etat, f.x, f.y, c.x, c.y, occupees);
      return i === null ? null : occupees.get(i) || null;
    }
    const intercepte = (f, c) => { const t = tir(f, c); return !!t && t.id !== c.id; };
    const nomFigurine = t => t.genre === 'heros' ? etat.heros.find(k => k.id === t.id)?.nom : infoMonstre(etat.monstres.find(k => k.id === t.id)?.type).nom;
    // Monstres que le héros actif peut attaquer.
    function ciblesAttaque() {
      const h = herosActif();
      if (!h) return [];
      return etat.monstres.filter(m => modeAttaque(h, m));
    }
    function porteeArme(h) {
      const a = armeEnMain(h) || {};
      const p = ['un monstre visible sur une case voisine (sans diagonale)'];
      if (a.diagonale) p.push('en diagonale');
      if (a.distance || a.lancer) p.push('ou en vue (ligne de vue libre)');
      return p.join(', ');
    }

    function commencerAttaque() {
      const h = herosActif();
      const cibles = ciblesAttaque();
      if (!cibles.length) return msg(`Aucun monstre à portée : il faut ${porteeArme(h)}.`);
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
      const h = herosActif(), mode = modeAttaque(h, m), a = armeEnMain(h);
      const alertes = [];
      if (Inventaire.interditeA(a, h.classe || h.id)) alertes.push(`⚠ Règle : « ${a.nom} » ne peut pas servir à ${h.nom}. Vous pouvez continuer.`);
      if ((etat.tour.actions || 0) >= 1) alertes.unshift(`⚠ ${h.nom} a déjà fait une action ce tour-ci (règle : une seule action par tour). Vous pouvez continuer.`);
      if (alertes.length) msg(...alertes.slice(0, 2));
      // Tir ou lancer : la première figurine sur la trajectoire reçoit le coup.
      const touche = mode === 'tir' || mode === 'lancer' ? tir(h, m) : { genre: 'monstre', id };
      const intercept = touche.id !== id ? `${infoMonstre(m.type).nom} était visé, mais ${nomFigurine(touche)} est sur la trajectoire et reçoit le coup.` : '';
      if (touche.genre === 'heros') {
        evenement = { genre: 'tirHeros', heros: touche.id, mode, arme: a?.nom || '', intercept, ambiance: Ambiance.tirer('attaqueHeros', { heros: h.nom, monstre: nomFigurine(touche) }) };
        return dessiner();
      }
      const victime = etat.monstres.find(k => k.id === touche.id);
      if (touche.id !== id && Regles.valeurMonstre(caracs, victime, 'defense') === null)
        return msg(`${intercept} Sa défense est inconnue : corrigez en vue MJ ou dans Réglages › Caractéristiques.`);
      combat = { monstre: touche.id, mode, arme: a?.nom || null, intercept, ambiance: Ambiance.tirer('attaqueHeros', { heros: h.nom, monstre: infoMonstre(victime.type).nom }) };
      dessiner();
    }

    // Tir ou arme lancée qui touche un héros (interception) : crânes du tireur moins boucliers blancs du héros touché.
    function resoudreTirHeros(cranes, blancs) {
      const ev = evenement, h = herosActif();
      const v = etat.heros.find(k => k.id === ev.heros);
      const degats = Math.max(0, cranes - blancs);
      let vie = v.corps;
      modifier(e => {
        if (e.tour.deplacement) e.tour.deplacement = null;
        e.tour.actions = (e.tour.actions || 0) + 1;
        if (ev.mode === 'lancer') { const kh = e.heros.find(z => z.id === h.id), t = Inventaire.tri(kh.inventaire || []); if (t.arme) kh.inventaire.splice(t.arme.k, 1); }
        delete e.heros.find(z => z.id === h.id).courage; // Courage : valable pour une seule attaque
        vie = blesser(e, v.id, degats);
      });
      const texte = (cranes === 0 ? 'Aucun crâne : le coup ne fait rien.'
        : `${cranes} crâne${cranes > 1 ? 's' : ''} contre ${blancs} bouclier${blancs > 1 ? 's' : ''} blanc${blancs > 1 ? 's' : ''} : `
          + (degats ? `${v.nom} perd ${degats} point${degats > 1 ? 's' : ''} de Vie (reste ${vie}).` : 'aucune blessure.'))
        + (ev.mode === 'lancer' ? ` « ${ev.arme} » est perdue.` : '');
      evenement = { genre: 'fin', titre: `${v.nom} est touché`, texte };
      dessiner();
    }

    // Les crânes du héros moins les boucliers noirs du monstre = points de Vie perdus.
    function resoudreAttaque(cranes) {
      const h = herosActif();
      const m = etat.monstres.find(k => k.id === combat.monstre);
      const nom = infoMonstre(m.type).nom;
      // Monstre endormi (Sommeil, carte 2021) : il ne se défend pas.
      let noteSommeil = '';
      let nbDef = caracMonstre(m, 'defense');
      if (m.endormi) { nbDef = 0; noteSommeil = ` (${nom} dort : il ne se défend pas.)`; }
      const tirage = Regles.lancer(nbDef);
      const noirs = Regles.compter(tirage, 'noir');
      const degats = Math.max(0, cranes - noirs);
      const vieAvant = m.corps ?? 1;
      const vieApres = Math.max(0, vieAvant - degats);
      const parSort = !!combat?.djinn;
      // Arme lancée : elle est perdue une fois lancée (retirée de l'inventaire).
      const lancee = !parSort && combat?.mode === 'lancer' ? armeEnMain(h) : null;
      combat = null;
      modifier(e => {
        if (!parSort) {
          if (e.tour.deplacement) e.tour.deplacement = null; // une action termine le déplacement en cours
          e.tour.actions = (e.tour.actions || 0) + 1;
          delete e.heros.find(z => z.id === h.id).courage; // Courage : valable pour une seule attaque
        }
        if (lancee) {
          const kh = e.heros.find(z => z.id === h.id), t = Inventaire.tri(kh.inventaire || []);
          if (t.arme) kh.inventaire.splice(t.arme.k, 1);
        }
        const k = e.monstres.find(z => z.id === m.id);
        k.corps = vieApres;
        if (vieApres === 0) e.monstres = e.monstres.filter(z => z.id !== m.id);
      });
      const valeurs = { heros: h.nom, monstre: nom, type: m.type };
      conclusion = {
        genre: 'heros', heros: h.id, monstre: m.id, type: m.type, monstreCourt: infoMonstre(m.type).court,
        tirage, cranes, noirs, degats, vieMonstre: vieApres, vieMonstreAvant: vieAvant, vieMonstreMax: m.corpsMax, cle: 'h' + Date.now(),
        note: noteSommeil + (lancee ? ` « ${lancee.nom} » est perdue (une arme lancée ne se récupère pas).` : ''),
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
    let heritage = null;  // { heros } : un héros vient de mourir, on choisit qui reprend son or et ses objets
    let potionInconnue = null; // { heros, k } : potion bue au secours, on demande combien de points de Vie elle rend

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
      const [dx, dy] = ev.dir;
      const b = [p.x + dx, p.y + dy];
      // Pas de limite de cases : le saut compte pour 2 cases au compteur, sans condition de reste.
      // Règle (p. 19) : jusqu'à trois cases d'atterrissage au-delà du piège (en face et les deux diagonales).
      const passe = (ax, ay, bx, by) => bx >= 0 && by >= 0 && bx < L && by < H && g.zones[Plateau.idx(L, bx, by)] !== '#'
        && Plateau.ouvert(g, etat, Plateau.idx(L, ax, ay), Plateau.idx(L, bx, by));
      const pose = (x, y) => !Plateau.autreHerosEn(etat, h.id, x, y);
      const options = [];
      if (!Plateau.raisonBlocage(g, etat, p.x, p.y, ...b) && pose(...b)) options.push(b);
      for (const s of [1, -1]) {
        const [px, py] = [dy * s, dx * s];
        const d = [b[0] + px, b[1] + py], cote = [p.x + px, p.y + py];
        const parFace = passe(p.x, p.y, ...b) && !Plateau.raisonBlocage(g, etat, ...b, ...d);
        const parCote = passe(p.x, p.y, ...cote) && !Plateau.raisonBlocage(g, etat, ...cote, ...d);
        if ((parFace || parCote) && pose(...d)) options.push(d);
      }
      const libre = options.length > 0;
      return { p, au_dela: options[0] || b, options, possible: libre && !(p.type === 'bloc' && p.declenche), restant: Infinity, libre };
    }

    // « en haut à gauche », « à droite »… (position d'une case par rapport au piège, à l'écran).
    function nomDirection(dx, dy) {
      const v = dy < 0 ? 'en haut' : dy > 0 ? 'en bas' : '', hz = dx < 0 ? 'à gauche' : dx > 0 ? 'à droite' : '';
      return [v, hz].filter(Boolean).join(' ');
    }

    function sauter(crane, choix = 0) {
      const h = herosActif(), ev = evenement;
      const { p, options } = infosSaut(ev);
      const au_dela = options[choix] || options[0];
      if (!crane) {
        modifier(e => {
          const k = e.heros.find(z => z.id === h.id); [k.x, k.y] = au_dela;
          compterPas(e, ...au_dela, 2);
        });
        evenement = null;
        msg(`${h.nom} saute par-dessus le piège !`);
        return dessiner();
      }
      // Saut raté : le héros tombe sur le piège, qui se déclenche.
      modifier(e => { const k = e.heros.find(z => z.id === h.id); [k.x, k.y] = [p.x, p.y]; compterPas(e, p.x, p.y); });
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
      modifier(e => { const k = e.heros.find(z => z.id === h.id); [k.x, k.y] = [p.x, p.y]; compterPas(e, p.x, p.y); vie = blesser(e, h.id, 1); finParPiege(e); });
      evenement = { genre: 'fin', titre: 'Dans la fosse', ambiance: '', texte: `${h.nom} descend dans la fosse et perd 1 point de Vie (reste ${vie}). Son tour s’arrête.` };
      dessiner();
    }

    // Marcher exprès sur un piège connu mais pas encore déclenché.
    function marcherSurPiege() {
      const h = herosActif(), ev = evenement;
      const { p } = infosSaut(ev);
      modifier(e => {
        const k = e.heros.find(z => z.id === h.id); [k.x, k.y] = [p.x, p.y];
        compterPas(e, p.x, p.y);
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
      const passages = genre === 'portes' ? Plateau.fouillerPassages(g, etat, h, portee) : [];
      const interrupteurs = genre === 'portes' ? [] : Plateau.fouillerInterrupteurs(g, etat, h, portee);
      // Meubles piégés repérés par la fouille de pièges.
      const { zone, auDela } = genre === 'portes' ? { zone: null, auDela: 0 } : Plateau.casesFouillablesPieges(g, etat, h, portee);
      const meubles = genre === 'portes' ? [] : (quete.mobilier || []).filter(m => {
        const st = etat.piegesMobilier[m.id];
        return m.piege && st && !st.trouve && !st.declenche && !st.desamorce && casesMeuble(m).some(c => zone.has(c));
      });
      modifier(e => {
        if (e.tour.deplacement) e.tour.deplacement = null;
        e.tour.actions = (e.tour.actions || 0) + 1;
        if (genre === 'portes') e.secretesTrouvees.push(...trouves);
        else for (const id of trouves) e.pieges.find(z => z.id === id).trouve = true;
        if (passages.length) e.passagesTrouves = [...(e.passagesTrouves || []), ...passages];
        e.interrupteurs = e.interrupteurs || {};
        for (const id of interrupteurs) e.interrupteurs[id] = { ...e.interrupteurs[id], trouve: true };
        for (const m of meubles) e.piegesMobilier[m.id].trouve = true;
      });
      trouves.push(...meubles.map(m => 'meuble:' + m.id));
      const n = trouves.length, np = passages.length, ni = interrupteurs.length;
      const texte = genre === 'portes'
        ? ([n ? `${n} porte${n > 1 ? 's' : ''} secrète${n > 1 ? 's' : ''} découverte${n > 1 ? 's' : ''} !` : '',
            np ? `${np > 1 ? np + ' passages secrets découverts' : 'Un passage secret découvert'} !` : ''].filter(Boolean).join(' ') || 'Aucune porte secrète ici.')
        : ([n ? `${n} piège${n > 1 ? 's' : ''} repéré${n > 1 ? 's' : ''} : ${trouves.map(id => id.startsWith('meuble:')
            ? `${quete.mobilier.find(m => 'meuble:' + m.id === id).nom} piégé`
            : NOMS_PIEGES[etat.pieges.find(z => z.id === id).type]).join(', ')}.` : '',
            ni ? `${ni > 1 ? ni + ' interrupteurs repérés' : 'Un interrupteur repéré'} (◉) : marcher dessus l’actionne.` : ''].filter(Boolean).join(' ') || 'Aucun piège ici.')
          + (auDela ? ` (La fouille couvre aussi l’autre côté de la porte ouverte.)` : '');
      evenement = {
        genre: 'fin', titre: genre === 'portes' ? 'Fouille : portes secrètes' : 'Fouille : pièges',
        texte, avertissement: avert.length ? '⚠ ' + avert.join(' ') + ' (Fouille faite quand même.)' : '',
        ambiance: Ambiance.tirer(n + np + ni ? (genre === 'portes' ? 'fouillePorte' : 'fouillePiege') : 'fouilleRien', { heros: h.nom }),
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

    /* Règle maison (22/11/2026) : dans une pièce qui contient un ou plusieurs coffres, on ne
       cherche un trésor que depuis une case voisine (sans diagonale) d'un coffre.
       Renvoie true si la pièce a un coffre et que le héros n'est contre aucun. */
    const estCoffre = m => m.type === 'coffre' || /coffre/i.test(m.nom || '');
    // Une oubliette se fouille « comme une autre pièce » (règle p. 17).
    const pieceFouille = h => (Plateau.fosseEn(etat, h.x, h.y) ? `fosse@${h.x},${h.y}` : Plateau.pieceDe(g, h.x, h.y));
    const memeLieu = (piece, f) => (piece.startsWith('fosse@') ? `fosse@${f.x},${f.y}` === piece : Plateau.pieceDe(g, f.x, f.y) === piece);

    function coffreTropLoin(h) {
      if (Plateau.fosseEn(etat, h.x, h.y)) return false;
      const piece = Plateau.pieceDe(g, h.x, h.y);
      if (!piece) return false;
      const coffres = (quete.mobilier || []).filter(m => estCoffre(m) && Plateau.pieceDe(g, m.x, m.y) === piece);
      if (!coffres.length) return false;
      return !coffres.some(m => casesMeuble(m).some(c => Math.abs(c % L - h.x) + Math.abs(Math.floor(c / L) - h.y) === 1));
    }

    function fouillerTresor() {
      const h = herosActif();
      const piece = pieceFouille(h);
      if (!piece) return msg('Les trésors ne se trouvent que dans les pièces (ou au fond d’une oubliette), pas dans les couloirs.');
      // Règle maison bloquante (décision de l'utilisateur, exception au principe d'arbitrage).
      if (coffreTropLoin(h)) return msg(`Il y a un coffre dans cette pièce : ${h.nom} doit d’abord se placer sur une case voisine d’un coffre pour chercher un trésor.`);
      const avert = [];
      if ((etat.tour.actions || 0) >= 1) avert.push(`${h.nom} a déjà fait une action ce tour-ci.`);
      if (etat.monstres.some(m => memeLieu(piece, m) && etat.revele.includes(Plateau.idx(L, m.x, m.y))))
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
        const objet = { nom: carte.nom || 'Objet' };
        if (carte.type === 'potion') {
          objet.potion = true;
          if (Number.isFinite(carte.valeur)) objet.soin = carte.valeur;
          if (carte.texte) objet.texte = carte.texte;
        }
        modifier(e => { const k = e.heros.find(z => z.id === h.id); (k.inventaire = k.inventaire || []).push(objet); });
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
      // Règle (p. 15) : à côté du héros, et il attaque aussitôt ; sinon au plus près, dans la même pièce
      // (ou le même couloir), et il n'agira qu'au prochain tour de Zargon.
      // Aucune place dans la pièce : au plus près au-delà (sans renvoyer les joueurs en vue MJ, pour ne rien dévoiler).
      const c = Plateau.caseLibreProche(g, etat, h.x, h.y, true) || Plateau.caseLibreProche(g, etat, h.x, h.y);
      const nom = infoMonstre(type).nom;
      if (!c) return finCarte('Monstre errant', `Un ${nom} rôde, mais il ne trouve aucune place pour surgir.`, null);
      const id = 'err' + Date.now();
      let m;
      modifier(e => {
        m = { id, type, x: c[0], y: c[1], vu: true };
        const v = Regles.valeurMonstre(caracs, m, 'corps');
        if (v !== null) m.corps = m.corpsMax = v;
        e.monstres.push(m);
      });
      const ambiance = Ambiance.tirer('errant', { heros: h.nom, monstre: nom });
      if (c[2] > 1) return finCarte('Monstre errant !', `${nom} surgit, mais aucune case n’est libre à côté de ${h.nom} : il apparaît au plus près et attaquera au prochain tour de Zargon.`, null);
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
      // Un événement peut montrer une autre figurine que le héros actif (ex. un allié retrouvé).
      const f = (ev.figure && etat.heros.find(k => k.id === ev.figure)) || h;
      const tete = `<div class="duel seul">${figurine('gauche', Portraits.heros(f.id, f.court), f.nom, f.corps, f.corpsMax)}</div>`;
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
      if (ev.genre === 'tirHeros') {
        const v = etat.heros.find(k => k.id === ev.heros);
        const n = caracHeros(h, 'attaque'), d = caracHeros(v, 'defense');
        const quoi = ev.mode === 'lancer' ? `« ${ev.arme} » lancée` : `Tir de « ${ev.arme} »`;
        return `<div class="duel">${figurine('gauche', Portraits.heros(h.id, h.court), h.nom, h.corps, h.corpsMax, 'attaquant')}<div class="centre">⚔</div>
            ${figurine('droite', Portraits.heros(v.id, v.court), v.nom, v.corps, v.corpsMax, 'defenseur')}</div>
          <p class="titre-zargon">${echapperTexte(quoi)} : ${echapperTexte(v.nom)} est touché !</p>
          ${ev.intercept ? `<p class="erreur petit">${echapperTexte(ev.intercept)}</p>` : ''}
          ${ev.cranes == null
            ? `<p class="question">${echapperTexte(h.nom)} : lancez ${n ?? 'vos'} dé${n > 1 ? 's' : ''} de combat. Combien de crânes ?</p>
               <div class="choix nombres">${boutonsNombre(n, 'tir-cranes')}</div>`
            : `<p class="question">${ev.cranes} crâne${ev.cranes > 1 ? 's' : ''}. ${echapperTexte(v.nom)} : lancez ${d ?? 'vos'} dé${d > 1 ? 's' : ''} de défense. Combien de boucliers blancs ?</p>
               <div class="choix nombres">${boutonsNombre(d, 'tir-blancs')}</div>`}
          <div class="choix"><button id="ev-annuler">Annuler</button></div>`;
      }
      if (ev.genre === 'reveil') return `${tete}<p class="titre-zargon">${echapperTexte(h.nom)} est endormi</p>
        <p class="question">Lancez 1 dé rouge par point d’Esprit (${h.espritMax ?? h.esprit ?? '?'}) : avez-vous fait au moins un 6 ?</p>
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
              <div class="choix">${info.options.length > 1
                ? info.options.map(([x, y], k) => `<button data-saut="0" data-atterrir="${k}" class="principal">Sauté : atterrir ${nomDirection(x - p.x, y - p.y)}</button>`).join('')
                : '<button data-saut="0" class="principal">Sauté (pas de crâne)</button>'}<button data-saut="1">💀 Crâne</button></div>`
            : `<p class="discret">${p.type === 'bloc' && p.declenche ? 'Un éboulement bloque le passage.' : 'Pour sauter, il faut une case libre au-delà du piège (en face ou en diagonale) : aucune ne l’est.'}</p>`}
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
      boite.querySelectorAll('[data-saut]').forEach(b => b.addEventListener('click', () => sauter(b.dataset.saut === '1', +(b.dataset.atterrir || 0))));
      boite.querySelectorAll('[data-face]').forEach(b => b.addEventListener('click', () => resoudreDesamorcage(b.dataset.face)));
      sur('#ev-piocher', piocherVirtuelle);
      boite.querySelectorAll('[data-cible-sort]').forEach(b => b.addEventListener('click', () => {
        const [genre, id] = b.dataset.cibleSort.split(':');
        lancerSort(evenement.sort, { genre, id });
      }));
      boite.querySelectorAll('[data-reponse-sort]').forEach(b => b.addEventListener('click', () => repondreSort(b.dataset.reponseSort)));
      boite.querySelectorAll('[data-tir-cranes]').forEach(b => b.addEventListener('click', () => {
        const c = +b.dataset.tirCranes;
        if (c === 0) return resoudreTirHeros(0, 0);
        evenement = { ...evenement, cranes: c }; dessiner();
      }));
      boite.querySelectorAll('[data-tir-blancs]').forEach(b => b.addEventListener('click', () => resoudreTirHeros(evenement.cranes, +b.dataset.tirBlancs)));
      boite.querySelector('#djinn-choisir-monstre')?.addEventListener('click', () => {
        evenement = null; djinnMonstreChoix = true;
        msg('Djinn : touchez le monstre à attaquer (entouré de rouge).');
        dessiner();
      });
      boite.querySelector('#djinn-choisir-porte')?.addEventListener('click', () => {
        evenement = null; djinnPorteChoix = true;
        msg('Djinn : touchez la porte fermée à ouvrir (encadrée en bleu).');
        dessiner();
      });
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
       La cible doit être visible et atteignable par une trajectoire libre (sauf Djinn).
       Effets alignés sur les cartes françaises 2021 (23/11/2026) : résistances aux dés rouges,
       Sommeil sans effet sur les morts-vivants, Courage pour une attaque, Peau de roc +1 dé. */

    const sortsDe = h => etat.sorts?.[h.id] || [];

    // Effets en cours sur un héros, pour la fiche et la fenêtre Actions.
    function effetsHeros(h) {
      const e = [];
      if (h.courage) e.push('Courage (+2 dés à la prochaine attaque)');
      if (h.peauRoc) e.push('Peau de roc (+1 dé de défense)');
      if (h.ventVif) e.push('Vif comme le vent (prochain déplacement : dés rouges doublés)');
      if (h.brume) e.push('Voile de brume (prochain déplacement)');
      if (h.traverse) e.push('À travers la pierre (prochain déplacement)');
      if (h.endormi) e.push('Endormi');
      if (h.passeTour) e.push('Passe son prochain tour (Tornade)');
      if (Plateau.fosseEn(etat, h.x, h.y)) e.push('Dans une fosse (−1 dé)');
      return e;
    }

    function choisirSort(id) {
      const s = Sorts.sort(id);
      fenetreActions = null;
      if (s.id === 'djinn') { evenement = { genre: 'djinn', sort: id }; return dessiner(); }
      // Les autres sorts : la cible se touche sur le plateau (comme une attaque).
      evenement = null; sortCible = id;
      const qui = s.cible === 'heros' ? 'le héros visé (lanceur compris)' : s.cible === 'monstre' ? 'le monstre visé' : 'le héros ou le monstre visé';
      msg(`${Sorts.groupe(s.groupe).symbole} ${s.nom} : ${s.resume}`, s.partout ? `Touchez ${qui}.` : `Touchez ${qui}. En pointillés : une autre figurine est sur la trajectoire et recevra le sort.`);
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
      if (id === 'sommeil' && cible.genre === 'monstre' && MORTS_VIVANTS.includes(etat.monstres.find(k => k.id === cible.id)?.type)) {
        sortCible = id; dessiner();
        return msg('Sommeil : sans effet sur les momies, zombies et squelettes. Touchez un autre monstre, ou « Retour ».');
      }
      const amb = Ambiance.tirer('sort', { heros: h.nom });
      const titre = `${s.nom}`;
      // Trajectoire (règles du 23/11/2026) : sauf sur soi-même et pour les sorts « n'importe où »,
      // le sort suit la trajectoire de tir ; impossible si elle est bloquée ; la première figurine
      // rencontrée le reçoit (option a : sorts d'aide compris).
      let intercept = '';
      if (!s.partout && cible.id !== h.id) {
        const v0 = cible.genre === 'heros' ? etat.heros.find(k => k.id === cible.id) : etat.monstres.find(k => k.id === cible.id);
        const t = tir(h, v0);
        if (!t) return msg(`${s.nom} : la cible n’est pas atteignable (mur, porte ou meuble sur la trajectoire).`);
        if (t.id !== cible.id) {
          intercept = `${nomFigurine(cible)} était visé, mais ${nomFigurine(t)} est sur la trajectoire et reçoit le sort.`;
          cible = t;
          // Sort réservé aux héros qui atteint un monstre : il se perd.
          if (s.cible === 'heros' && t.genre === 'monstre') {
            modifier(e => consommerSort(e, h.id, id));
            evenement = { genre: 'fin', titre, ambiance: amb, avertissement: '⚠ ' + intercept, texte: `Le sort se dissipe sans effet sur ${nomFigurine(t)}.` };
            return dessiner();
          }
        }
      }
      const visee = cible.genre === 'heros' ? etat.heros.find(k => k.id === cible.id) : etat.monstres.find(k => k.id === cible.id);
      const nomC = cible.genre === 'heros' ? visee.nom : infoMonstre(visee.type).nom;
      const avert = [];
      if ((etat.tour.actions || 0) >= 1) avert.push(`${h.nom} a déjà fait une action ce tour-ci (sort lancé quand même).`);
      if (intercept) avert.push(intercept);
      const avertissement = avert.length ? '⚠ ' + avert.join(' ') : '';
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
          return fin(`Au prochain déplacement, ${nomC} pourra traverser les cases occupées par des monstres (sans s’y arrêter).`);
        case 'traversPierre':
          surHeros(k => { k.traverse = true; });
          return fin(`Au prochain déplacement, ${nomC} pourra traverser autant de murs que le total de ses dés. Attention : finir dans le roc massif, c’est y rester emprisonné à jamais.`);
        case 'courage':
          surHeros(k => { k.courage = true; });
          return fin(`${nomC} lancera 2 dés de combat de plus à sa prochaine attaque (le sort prend fin s’il n’y a plus de monstre en vue).`);
        case 'peauRoc':
          surHeros(k => { k.peauRoc = true; });
          return fin(`${nomC} gagne 1 dé de défense jusqu’à sa première blessure.`);
        case 'eauGuerison': case 'guerisonCorps': {
          let gain = 0;
          surHeros(k => { const avant = k.corps ?? 0; k.corps = Math.min(k.corpsMax ?? avant + 4, avant + 4); gain = k.corps - avant; });
          return fin(`${nomC} récupère ${gain} point${gain > 1 ? 's' : ''} de Vie (${visee.corps}${visee.corpsMax ? ' / ' + visee.corpsMax : ''}).`);
        }
        case 'sommeil':
          if (cible.genre === 'monstre') {
            if (MORTS_VIVANTS.includes(visee.type)) {
              surMonstre(() => {});
              return fin(`Le sommeil n’a aucun effet sur ${nomC} (momies, zombies et squelettes y échappent).`);
            }
            const esprit = Math.max(0, Regles.valeurMonstre(caracs, visee, 'esprit') ?? 0);
            const des = desRouges(esprit);
            const resiste = des.includes(6);
            surMonstre(k => { if (!resiste) k.endormi = true; });
            return fin((resiste ? `${nomC} fait un 6 : il se libère aussitôt du sommeil.` : `${nomC} s’endort : il ne bouge plus, n’attaque plus et ne se défend plus. À chacun de ses tours, il tentera de faire un 6.`)
              + ` (${esprit} dé${esprit > 1 ? 's' : ''} rouge${esprit > 1 ? 's' : ''} : ${des.join(', ')}.)`);
          }
          evenement = { genre: 'questionSort', sort: id, cible, avertissement, ambiance: amb,
            question: `${nomC} lance 1 dé rouge par point d’Esprit (${visee.espritMax ?? visee.esprit ?? '?'}). A-t-il fait au moins un 6 ?`,
            reponses: [['resiste', 'Oui, un 6 : il se libère'], ['dort', 'Non : il s’endort']] };
          return dessiner();
        case 'bouleFeu':
          if (cible.genre === 'monstre') {
            const des = desRouges(2);
            const degats = Math.max(0, 2 - des.filter(d => d >= 5).length);
            const res = degatsMonstre(cible.id, degats, h, e => consommerSort(e, h.id, id));
            return fin(`${nomC} lance 2 dés rouges (${des.join(', ')}) : chaque 5 ou 6 réduit la perte. ${degats ? `${degats} point${degats > 1 ? 's' : ''} de Vie perdu${degats > 1 ? 's' : ''}.` : 'Aucune perte !'}${res}`);
          }
          evenement = { genre: 'questionSort', sort: id, cible, avertissement, ambiance: amb,
            question: `${nomC} lance 2 dés rouges : combien de 5 ou de 6 ? (chacun réduit la perte de 1)`, reponses: [['0', '0'], ['1', '1'], ['2', '2']] };
          return dessiner();
        case 'feuCourroux':
          if (cible.genre === 'monstre') {
            const [de] = desRouges(1);
            const pare = de >= 5;
            const res = pare ? '' : degatsMonstre(cible.id, 1, h, e => consommerSort(e, h.id, id));
            if (pare) modifier(e => consommerSort(e, h.id, id));
            return fin(pare ? `${nomC} fait ${de} sur le dé rouge : le feu ne l’atteint pas.` : `${nomC} fait ${de} sur le dé rouge : il perd 1 point de Vie.${res}`);
          }
          evenement = { genre: 'questionSort', sort: id, cible, avertissement, ambiance: amb,
            question: `${nomC} lance 1 dé rouge : a-t-il fait 5 ou 6 ?`, reponses: [['pare', 'Oui, 5 ou 6'], ['touche', 'Non']] };
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

    // Djinn : attaque un monstre en vue avec 5 dés (le joueur les lance), ou ouvre une porte.
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

    // Cibles possibles d'un sort sur le plateau : héros debout et/ou monstres en vue.
    function ciblesSort(id) {
      const s = Sorts.sort(id), h = herosActif();
      const vu = new Set(etat.revele);
      // Cible atteignable : soi-même, sort « n'importe où », ou trajectoire libre (peut-être interceptée).
      const ok = f => s.partout || (h && f.id === h.id) || !!tir(h, f);
      return {
        heros: s.cible === 'monstre' ? [] : etat.heros.filter(k => k.x != null && k.corps !== 0 && !k.mort && ok(k)),
        monstres: s.cible === 'heros' ? [] : etat.monstres.filter(m => vu.has(Plateau.idx(L, m.x, m.y)) && ok(m)),
      };
    }

    function htmlCibles(ev) {
      const h = herosActif(), s = Sorts.sort(ev.sort);
      const vu = new Set(etat.revele);
      const heros = s.cible === 'monstre' ? [] : etat.heros.filter(k => k.x != null && k.corps !== 0);
      const monstres = s.cible === 'heros' ? [] : etat.monstres.filter(m => vu.has(Plateau.idx(L, m.x, m.y)));
      const bouton = (genre, f, nom) => {
        const hv = !s.partout && f.id !== h.id && intercepte(h, f);
        if (!s.partout && f.id !== h.id && !tir(h, f)) return '';
        return `<button data-cible-sort="${genre}:${f.id}">${echapperTexte(nom)}${f.id === h.id ? ' (soi-même)' : ''}${hv ? ' — interceptée ⚠' : ''}</button>`;
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
      return `<p class="titre-zargon">🌪 Djinn</p><p class="discret">${Sorts.sort('djinn').resume}</p>
        <h3 class="titre-section">Attaquer (5 dés)</h3>
        <div class="choix">${monstres.length ? '<button id="djinn-choisir-monstre">Choisir le monstre sur le plateau…</button>' : '<span class="discret">Aucun monstre en vue.</span>'}</div>
        <h3 class="titre-section">Ouvrir une porte</h3>
        <div class="choix">${portes.length ? '<button id="djinn-choisir-porte">Choisir la porte sur le plateau…</button>' : '<span class="discret">Aucune porte fermée connue.</span>'}</div>
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
      if (!zone || animes.has(zone.dataset.cle)) return 0;
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
        if (t >= DUREE_DES) {
          clearInterval(minuterie);
          const final = zone.dataset.final.split(',');
          des.forEach((d, k) => { d.textContent = Regles.afficher([final[k]]); });
          zone.classList.remove('roule');
          suite.forEach(e => e.classList.remove('masque'));
        }
      }, 90);
      return DUREE_DES;
    }

    /* Figurine d'un duel. « deroule » (facultatif) : { vieAvant, classeApres } — la vie d'avant le
       coup est affichée pendant les dés et l'ambiance, puis remplacée par « vie » (voir deroulerEtapes). */
    function figurine(cote, html, nom, vie, vieMax, classe = '', deroule = null) {
      const txt = v => `♥ ${v ?? '?'}${vieMax != null ? ' / ' + vieMax : ''}`;
      const change = deroule && deroule.vieAvant != null && deroule.vieAvant !== vie;
      return `<figure class="combattant ${cote} ${classe}"${deroule?.classeApres ? ` data-classe-apres="${deroule.classeApres}"` : ''}>
        <div class="portrait">${html}</div>
        <figcaption>${classe.includes('attaquant') ? '<span class="role">⚔ attaque</span>' : ''}<strong>${echapperTexte(nom)}</strong><span class="vie"${change ? ` data-apres="${txt(vie)}"` : ''}>${txt(change ? deroule.vieAvant : vie)}</span></figcaption>
      </figure>`;
    }

    /* Déroulé d'un résultat de combat : dés (s'ils roulent), puis l'ambiance (.etape-1), puis après
       une pause les dégâts (.etape-2, vies mises à jour, « vaincu »). Une fois vu, il s'affiche
       directement dans son état final si la fenêtre est redessinée. */
    const etapesVues = new Set();
    // Durées du déroulé (ms) : roulement des dés, pause avant l'ambiance, temps de lecture de l'ambiance.
    const DUREE_DES = 1200, PAUSE_AVANT_AMBIANCE = 700, LECTURE_AMBIANCE = 2500;
    function deroulerEtapes(boite, dureeDes) {
      const porteur = boite.querySelector('[data-etapes]');
      if (!porteur) return;
      const cle = porteur.dataset.etapes;
      const e1 = boite.querySelectorAll('.etape-1'), e2 = boite.querySelectorAll('.etape-2');
      const fin = eclat => {
        boite.querySelectorAll('[data-apres]').forEach(el => { el.textContent = el.dataset.apres; if (eclat) el.classList.add('touche'); });
        boite.querySelectorAll('[data-classe-apres]').forEach(el => el.classList.add(...el.dataset.classeApres.split(' ').filter(Boolean)));
        e1.forEach(el => el.classList.remove('masque')); e2.forEach(el => el.classList.remove('masque'));
      };
      if (etapesVues.has(cle)) return fin(false);
      etapesVues.add(cle);
      e1.forEach(el => el.classList.add('masque')); e2.forEach(el => el.classList.add('masque'));
      setTimeout(() => {
        e1.forEach(el => el.classList.remove('masque'));
        setTimeout(() => fin(true), LECTURE_AMBIANCE);
      }, dureeDes + PAUSE_AVANT_AMBIANCE);
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
        const gauche = figurine('gauche', Portraits.heros(h.id, h.court), h.nom, h.corps, h.corpsMax, attH,
          { vieAvant: c.genre === 'zargon' ? c.vieHerosAvant : null, classeApres: h.corps === 0 ? 'vaincu' : '' });
        const droite = figurine('droite', Portraits.monstre(c.type, court), nomM, vieM, mVivant?.corpsMax ?? c.vieMonstreMax, attM,
          { vieAvant: c.genre === 'heros' ? c.vieMonstreAvant : null, classeApres: vieM === 0 ? 'vaincu' : '' });
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
        html = `<div class="duel" data-etapes="${c.cle}:fin">${gauche}<div class="centre">⚔</div>${droite}</div>
          <p class="legende">${c.genre === 'zargon' ? `Attaque de ${nomM}` : `Défense de ${nomM}`}</p>
          ${htmlDes(c.tirage, c.cle)}
          <div class="apres-des">
            <p class="ambiance etape-1">${echapperTexte(c.ambiance)}</p>
            <div class="etape-2">
              <p class="resultat">${echapperTexte(texte)}</p>
              <div class="choix"><button id="md-suivant" class="principal">${c.genre === 'zargon' ? 'Suivant' : 'Fermer'}</button></div>
            </div>
          </div>`;
      } else if (combat) {
        // Duel lancé par le héros actif : on attend ses crânes.
        const h = herosActif();
        const m = etat.monstres.find(k => k.id === combat.monstre);
        const n = combat.des ?? caracHeros(h, 'attaque');
        html = `${combat.djinn ? '<p class="titre-zargon">🌪 Le Djinn attaque !</p>' : ''}<div class="duel">${figurine('gauche', Portraits.heros(h.id, h.court), h.nom, h.corps, h.corpsMax, 'attaquant')}<div class="centre">⚔</div>
            ${figurine('droite', Portraits.monstre(m.type, infoMonstre(m.type).court), infoMonstre(m.type).nom, m.corps, m.corpsMax, 'defenseur')}</div>
          <p class="ambiance">${echapperTexte(combat.ambiance)}</p>
          ${combat.intercept ? `<p class="erreur petit">${echapperTexte(combat.intercept)}</p>` : ''}
          ${combat.mode && combat.mode !== 'contact' ? `<p class="mode-attaque">${echapperTexte(
            combat.mode === 'diagonale' ? `En diagonale, avec « ${combat.arme} ».`
            : combat.mode === 'tir' ? `Tir à distance avec « ${combat.arme} ».`
            : combat.mode === 'lancer' ? `${h.nom} lance « ${combat.arme} » : elle sera perdue.`
            : `⚠ « ${combat.arme} » contre un monstre voisin (interdit par la règle).`)}</p>` : ''}
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
      } else if ((secours() || heritage) && !evenement) {
        // Un héros vient de tomber (ou de mourir) : on décide avant de continuer.
        html = htmlSecours();
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
        } else {
          html = `${entete}
            <p class="etat-tour">Déplacement : ${t.deplacement ? '<strong>en cours</strong>' : t.aBouge ? 'fait' : 'disponible'}${t.pas ? ` (${t.pas} case${t.pas > 1 ? 's' : ''})` : ''}
              · Action : ${fait ? 'faite' : 'disponible'}</p>
            <p class="discret petit">Pour se déplacer : touchez ${echapperTexte(h.nom)} sur le plateau, puis les cases éclairées ; touchez-le à nouveau pour s’arrêter.</p>
            ${t.deplacement ? '<div class="choix"><button id="md-terminer-depl">Arrêter le déplacement</button></div>' : ''}
            ${t.finForcee ? `<p class="erreur petit">⚠ Un piège a mis fin au tour de ${echapperTexte(h.nom)} : normalement, il ne fait plus rien ce tour-ci.</p>` : ''}
            ${h.passeTour ? `<p class="erreur petit">⚠ Tornade : ${echapperTexte(h.nom)} devrait passer ce tour.</p>` : ''}
            ${h.endormi ? `<p class="erreur petit">⚠ ${echapperTexte(h.nom)} est endormi : il ne bouge ni n’agit, sauf s’il fait un 6. <button id="md-reveil">Tenter de se réveiller</button></p>` : ''}
            ${effetsHeros(h).length ? `<p class="etat-heros">${effetsHeros(h).map(echapperTexte).join(' · ')}</p>` : ''}
            <h3 class="titre-section">Actions${fait ? ' ⚠' : ''}</h3>
            <div class="choix">
              ${cibles.length ? `<button id="md-attaquer" class="${fait ? '' : 'principal'}">Attaquer</button>` : ''}
              ${sortsDe(h).some(x => !x.utilise) ? '<button id="md-sorts">Lancer un sort</button>' : ''}
              <button id="md-fouille-tresor"${coffreTropLoin(h) ? ' disabled' : ''}>Fouiller : trésor</button>
              <button id="md-fouille-portes">Fouiller : portes secrètes</button>
              <button id="md-fouille-pieges">Fouiller : pièges</button>
              ${desamorcables.length ? '<button id="md-desamorcer">Désamorcer le piège</button>' : ''}
              ${meublesDesamorcables().map(m => `<button data-desarmer-meuble="${m.id}">Désamorcer : ${echapperTexte(m.nom)}</button>`).join('')}
            </div>
            ${coffreTropLoin(h) ? '<p class="erreur petit">Il y a un coffre dans cette pièce : pour chercher un trésor, placez-vous d’abord sur une case voisine d’un coffre.</p>' : ''}
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
      boite.querySelectorAll('[data-cranes]').forEach(b => b.addEventListener('click', () => resoudreAttaque(+b.dataset.cranes)));
      boite.querySelectorAll('[data-blancs]').forEach(b => b.addEventListener('click', () => defendre(+b.dataset.blancs)));
      if (evenement) brancherEvenement(boite);
      if ((secours() || heritage) && !evenement && !conclusion && !combat && !z?.defense) brancherSecours(boite);
      deroulerEtapes(boite, animerDes(boite));
    }

    /* ---------- Héros à terre, potions, mort ----------
       Règle : à 0 point de Vie, un héros meurt, sauf s'il est sauvé tout de suite
       (potion ou sort de soin). L'application ouvre une fenêtre de secours ; on peut
       aussi « décider plus tard » (le héros reste à terre et ne joue plus). */

    const SORTS_SOIN = ['eauGuerison', 'guerisonCorps'];
    const estPotion = o => !!o && (o.potion || /potion/i.test(o.nom || ''));

    // Premier héros à terre dont le sort n'est pas encore décidé.
    function secours() {
      return etat.heros.find(h => !h.allie && h.corps === 0 && !h.mort && h.x != null && !h.secoursReporte) || null;
    }

    // Boire la potion n° k de l'inventaire ; « valeur » : points de Vie rendus (0 si effet autre).
    function boirePotion(hid, k, valeur) {
      const h = etat.heros.find(z => z.id === hid);
      const o = h?.inventaire?.[k];
      if (!o) return;
      let gain = 0;
      potionInconnue = null;
      modifier(e => {
        const z = e.heros.find(q => q.id === hid);
        z.inventaire.splice(k, 1);
        const avant = z.corps ?? 0;
        z.corps = Math.min(z.corpsMax ?? avant + valeur, avant + valeur);
        gain = z.corps - avant;
      });
      msg(`${h.nom} boit « ${o.nom} »${gain ? ` : +${gain} point${gain > 1 ? 's' : ''} de Vie` : ''}.${o.texte ? ' ' + o.texte : ''}`);
    }

    // Sort de soin lancé par « lanceur » sur le héros à terre (hors de son tour : avertissement).
    function soignerParSort(lanceurId, sortId, cibleId) {
      const l = etat.heros.find(z => z.id === lanceurId), c = etat.heros.find(z => z.id === cibleId);
      const actif = herosActif();
      const avert = [];
      if (actif?.id !== lanceurId) avert.push(`${l.nom} le lance hors de son tour`);
      else if ((etat.tour.actions || 0) >= 1) avert.push(`${l.nom} a déjà fait une action ce tour-ci`);
      let gain = 0;
      modifier(e => {
        const x = e.sorts[lanceurId].find(q => q.id === sortId);
        if (x) x.utilise = true;
        if (actif?.id === lanceurId) { e.tour.actions = (e.tour.actions || 0) + 1; e.tour.deplacement = null; }
        const z = e.heros.find(q => q.id === cibleId);
        const avant = z.corps ?? 0;
        z.corps = Math.min(z.corpsMax ?? avant + 4, avant + 4);
        gain = z.corps - avant;
      });
      msg(`${l.nom} lance ${Sorts.sort(sortId).nom} : ${c.nom} récupère ${gain} point${gain > 1 ? 's' : ''} de Vie.${avert.length ? ` ⚠ Écart aux règles : ${avert.join(', ')}.` : ''}`);
    }

    // Le héros meurt : il quitte le plateau et ne joue plus ; ses biens peuvent passer à un autre héros.
    function mourir(hid) {
      const h = etat.heros.find(z => z.id === hid);
      const etaitActif = herosActif()?.id === hid;
      fenetreActions = null; evenement = null; ciblage = false; combat = null;
      const biens = (h.or || 0) > 0 || (h.inventaire || []).length > 0;
      // Règle (p. 21, décision de l'utilisateur du 23/11/2026) : seuls les héros de la même pièce (ou du même
      // couloir, en vue) peuvent ramasser ses biens ; sinon un monstre présent s'en empare et ils sont perdus.
      const ici = h.x != null ? { x: h.x, y: h.y } : null;
      const auMemeEndroit = f => {
        if (!ici || f.x == null) return false;
        const za = g.zones[Plateau.idx(L, ici.x, ici.y)], zb = g.zones[Plateau.idx(L, f.x, f.y)];
        if (za !== zb || za === '#') return false;
        return Plateau.estPiece(za) || Plateau.ligneDeVue(g, etat, ici.x, ici.y, f.x, f.y);
      };
      const heritiers = etat.heros.filter(k => k.id !== hid && !k.allie && debout(k) && auMemeEndroit(k)).map(k => k.id);
      const voleur = biens && !heritiers.length ? etat.monstres.find(m => auMemeEndroit(m) && etat.revele.includes(Plateau.idx(L, m.x, m.y))) : null;
      const butin = [h.or ? `${h.or} pièce${h.or > 1 ? 's' : ''} d’or` : '', ...(h.inventaire || []).map(o => o.nom)].filter(Boolean);
      // Posé avant modifier(), qui redessine l'écran.
      heritage = biens && heritiers.length ? { heros: hid, heritiers } : null;
      modifier(e => {
        const z = e.heros.find(q => q.id === hid);
        z.mort = true; z.mortEn = { x: z.x, y: z.y }; z.x = null; z.y = null;
        if (voleur) { z.or = 0; z.inventaire = []; }
        delete z.secoursReporte;
        if (etaitActif) passerAuSuivant(e);
      });
      if (voleur) {
        evenement = { genre: 'fin', titre: `☠ ${h.nom} est mort`, ambiance: '',
          texte: `Aucun héros n’est là pour ramasser ses biens : ${infoMonstre(voleur.type).nom} s’en empare (${butin.join(', ')}). Ils sont perdus. `
            + 'Si un artéfact était dans le lot, il revient dans le premier trésor trouvé à la quête suivante (règle des artéfacts perdus).' };
        return dessiner();
      }
      if (biens && !heritiers.length) return msg(`☠ ${h.nom} est mort. Aucun héros n’est près de lui : ses biens restent avec lui.`);
      msg(`☠ ${h.nom} est mort.`);
    }

    function reporterSecours(hid) {
      const etaitActif = herosActif()?.id === hid;
      if (etaitActif) fenetreActions = null;
      modifier(e => {
        e.heros.find(q => q.id === hid).secoursReporte = true;
        if (etaitActif) passerAuSuivant(e);
      });
      msg('Décision reportée : le héros reste à terre et ne joue plus. Sa fiche permet de le secourir ou de le déclarer mort.');
    }

    function heriter(receveurId) {
      const hid = heritage.heros;
      heritage = null;
      if (receveurId) modifier(e => {
        const z = e.heros.find(q => q.id === hid), r = e.heros.find(q => q.id === receveurId);
        r.or = (r.or || 0) + (z.or || 0);
        // Ce qui est récupéré va avec les « autres objets » de celui qui le reprend.
        r.inventaire = [...(r.inventaire || []), ...(z.inventaire || []).map(({ emplacement, ...o }) => o)];
        z.or = 0; z.inventaire = [];
      });
      else dessiner();
      msg(receveurId ? `${etat.heros.find(q => q.id === receveurId).nom} récupère l’or et les objets.` : 'L’or et les objets restent avec lui.');
    }

    // Contenu de la fenêtre de secours (ou d'héritage), pour dessinerModale.
    function htmlSecours() {
      if (heritage) {
        const h = etat.heros.find(z => z.id === heritage.heros);
        const biens = [h.or ? `${h.or} pièce${h.or > 1 ? 's' : ''} d’or` : '', ...(h.inventaire || []).map(o => o.nom)].filter(Boolean);
        return `<div class="duel seul">${figurine('gauche', Portraits.heros(h.id, h.court), h.nom, 0, h.corpsMax, 'vaincu')}</div>
          <p class="titre-zargon">☠ ${echapperTexte(h.nom)} est mort</p>
          <p class="resultat">Il laisse : ${echapperTexte(biens.join(', '))}. Qui les récupère ?</p>
          <p class="discret petit">Seuls les héros de la même pièce (ou du même couloir) peuvent les ramasser.</p>
          <div class="choix">${etat.heros.filter(k => debout(k) && (!heritage.heritiers || heritage.heritiers.includes(k.id))).map(k => `<button data-heritier="${k.id}">${echapperTexte(k.nom)}</button>`).join('')}
            <button data-heritier="">Personne (ils restent avec lui)</button></div>`;
      }
      const h = secours();
      const tete = `<div class="duel seul">${figurine('gauche', Portraits.heros(h.id, h.court), h.nom, 0, h.corpsMax, 'vaincu')}</div>
        <p class="titre-zargon">${echapperTexte(h.nom)} est à terre</p>`;
      if (potionInconnue) {
        const o = h.inventaire[potionInconnue.k];
        return `${tete}<p class="question">Combien de points de Vie rend « ${echapperTexte(o.nom)} » ? (voir la carte)</p>
          <div class="choix nombres">${[1, 2, 3, 4, 5, 6].map(n => `<button data-valeur-potion="${n}">${n}</button>`).join('')}</div>
          <div class="choix"><button data-valeur-potion="0">Aucun (autre effet)</button><button id="sc-retour">Retour</button></div>`;
      }
      const potions = (h.inventaire || []).map((o, k) => ({ o, k })).filter(({ o }) => estPotion(o));
      const soins = [];
      for (const l of etat.heros.filter(debout)) for (const x of sortsDe(l)) if (!x.utilise && SORTS_SOIN.includes(x.id)) soins.push({ l, id: x.id });
      const vivants = etat.heros.filter(debout).length;
      return `${tete}
        <p class="resultat">Plus aucun point de Vie : ${echapperTexte(h.nom)} meurt, sauf s’il est sauvé tout de suite par une potion ou un sort de soin.</p>
        ${potions.length || soins.length ? `<div class="choix">
          ${potions.map(({ o, k }) => `<button data-boire-secours="${k}" class="principal">Boire : ${echapperTexte(o.nom)}${Number.isFinite(o.soin) ? ` (+${o.soin})` : ''}</button>`).join('')}
          ${soins.map(({ l, id }) => `<button data-soin="${l.id}:${id}">${echapperTexte(Sorts.sort(id).nom)} (${echapperTexte(l.nom)})</button>`).join('')}
        </div>` : '<p class="discret">Aucune potion dans son inventaire, aucun sort de soin disponible.</p>'}
        ${!vivants ? '<p class="erreur">Plus aucun héros debout : la quête est perdue s’il meurt.</p>' : ''}
        <div class="choix">
          <button id="sc-mort" class="danger">Il meurt</button>
          <button id="sc-plus-tard">Décider plus tard</button>
          ${!vivants ? '<button id="sc-echec">Quête échouée</button>' : ''}
        </div>
        <p class="discret petit">Tout s’annule avec ↶.</p>`;
    }

    function brancherSecours(boite) {
      const h = secours();
      boite.querySelectorAll('[data-heritier]').forEach(b => b.addEventListener('click', () => heriter(b.dataset.heritier || null)));
      boite.querySelectorAll('[data-boire-secours]').forEach(b => b.addEventListener('click', () => {
        const k = +b.dataset.boireSecours, o = h.inventaire[k];
        if (Number.isFinite(o.soin)) boirePotion(h.id, k, o.soin);
        else { potionInconnue = { heros: h.id, k }; dessiner(); }
      }));
      boite.querySelectorAll('[data-valeur-potion]').forEach(b => b.addEventListener('click', () => boirePotion(h.id, potionInconnue.k, +b.dataset.valeurPotion)));
      boite.querySelector('#sc-retour')?.addEventListener('click', () => { potionInconnue = null; dessiner(); });
      boite.querySelectorAll('[data-soin]').forEach(b => b.addEventListener('click', () => {
        const [lid, sid] = b.dataset.soin.split(':');
        soignerParSort(lid, sid, h.id);
      }));
      boite.querySelector('#sc-mort')?.addEventListener('click', () => mourir(h.id));
      boite.querySelector('#sc-plus-tard')?.addEventListener('click', () => reporterSecours(h.id));
      boite.querySelector('#sc-echec')?.addEventListener('click', () => { mourir(h.id); options.terminer?.('echouee'); });
    }

    /* ---------- Fiche d'un héros ---------- */

    let ficheHeros = null; // héros dont la fiche est ouverte (pour la rafraîchir après ↶)
    function ouvrirFiche(hid) {
      const h = etat.heros.find(k => k.id === hid);
      if (h?.allie) {
        const d = h.defense || 2;
        return msg(`${h.nom} — ${h.mort ? 'mort' : `Vie ${h.corps}/${h.corpsMax}`} · n’attaque pas · se défend avec ${d} dé${d > 1 ? 's' : ''}.`);
      }
      const fiche = conteneur.querySelector('#pl-fiche');
      ficheHeros = hid;
      const classe = Regles.TYPES_HEROS.find(t => t.id === (h.classe || h.id))?.nom || '';
      const manque = ['attaque', 'defense'].filter(c => caracHeros(h, c) === null).map(c => c === 'attaque' ? 'dés d’attaque' : 'dés de défense');
      const ligne = (nom, champ) => `<tr><th>${nom}</th><td>${caracHeros(h, champ) ?? '?'}${detailDes(h, champ)}</td></tr>`;
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
          <h2><span class="pastille h-${hid}${h.allie ? ' allie' : ''}"></span> ${echapperTexte(h.nom)}</h2>
          <button class="icone" data-fermer aria-label="Fermer la fiche">✕</button>
        </div>
        ${h.nom !== classe ? `<p class="discret petit">${classe}</p>` : ''}
        ${manque.length ? `<p class="erreur petit">À remplir (onglet Héros ou Réglages) : ${manque.join(', ')}.</p>` : ''}
        ${compteur('Vie', 'corps')}
        ${compteur('Esprit', 'esprit')}
        ${h.mort ? '<p class="erreur">☠ Mort pendant cette quête.</p>'
          : h.corps === 0 ? `<p class="erreur">⚠ 0 point de Vie : le héros meurt, sauf potion ou sort de soin.
              ${h.secoursReporte ? '<button id="fi-secours">Décider maintenant…</button>' : ''}</p>` : ''}
        ${effetsHeros(h).length ? `<p class="etat-heros">${effetsHeros(h).map(echapperTexte).join(' · ')}</p>` : ''}
        ${compteur('Or', 'or', [1, 10])}
        <table class="caracs petite"><tbody>${ligne('Dés d’attaque', 'attaque')}${ligne('Dés de défense', 'defense')}</tbody></table>
        ${sortsDe(h).length ? `<h3>Sorts</h3><p class="petit">${sortsDe(h).map(x => `${Sorts.sort(x.id).nom}${x.utilise ? ' <span class="discret">(utilisé)</span>' : ''}`).join(' · ')}</p>` : ''}
        <h3>Inventaire</h3>
        ${Inventaire.html(inventaire, { peutBoire: !h.mort, classe: h.classe || h.id })}
        ${h.mort ? '' : '<button id="fi-equipement" class="petit-bouton">Ajouter l’équipement de départ (Réglages)</button>'}
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
      Inventaire.brancher(fiche, fn => {
        modifier(e => { const k = e.heros.find(z => z.id === hid); fn(k.inventaire = k.inventaire || []); });
        ouvrirFiche(hid);
      }, h.nom);
      fiche.querySelectorAll('[data-boire]').forEach(b => b.addEventListener('click', () => {
        const k = +b.dataset.boire, o = h.inventaire[k];
        let valeur = o.soin;
        if (!Number.isFinite(valeur)) {
          const r = prompt(`Combien de points de Vie rend « ${o.nom} » ? (voir la carte ; 0 si son effet est autre)`, '0');
          if (r === null) return;
          valeur = Math.max(0, Math.min(99, parseInt(r, 10) || 0));
        }
        boirePotion(hid, k, valeur);
        ouvrirFiche(hid);
      }));
      fiche.querySelector('#fi-equipement')?.addEventListener('click', async () => {
        const e = await Stockage.lireReglage('equipementDepart');
        const ajout = JSON.parse(JSON.stringify(e?.[h.classe || h.id] || []));
        if (!ajout.length) return msg('Aucun équipement de départ pour ce héros (Réglages › Équipement de départ).');
        modifier(et => {
          const k = et.heros.find(z => z.id === hid);
          k.inventaire = k.inventaire || [];
          // Une seule arme en main : si le héros en tient déjà une, l'arme de départ va avec les autres objets.
          if (k.inventaire.some(o => o.emplacement === 'arme')) ajout.forEach(o => { if (o.emplacement === 'arme') delete o.emplacement; });
          k.inventaire.push(...ajout);
        });
        msg(`Équipement de départ ajouté à ${h.nom} (↶ pour annuler).`);
        ouvrirFiche(hid);
      });
      fiche.querySelector('#fi-secours')?.addEventListener('click', () => {
        fiche.hidden = true;
        modifier(e => { delete e.heros.find(z => z.id === hid).secoursReporte; });
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
      // Seul le héros actif ouvre une porte, et seulement s'il est devant (pas en diagonale).
      const h = herosActif();
      if (!h) return msg('Une porte s’ouvre pendant le tour d’un héros. (Vue MJ pour passer outre.)');
      if (!Plateau.devantPorte(h, p)) return msg(`${h.nom} doit se trouver devant la porte pour l’ouvrir (une case en diagonale ne suffit pas). (Vue MJ pour passer outre.)`);
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
    const ZOOM_MIN = 0.6, ZOOM_MAX = 4;
    const changerZoom = f => {
      zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * f * 10) / 10));
      try { localStorage.setItem('zoomJeu', zoom); } catch { }
      appliquerZoom();
    };

    /* Pincer pour zoomer le plateau (et non la page Safari). Deux doigts : le point du plateau
       situé entre les doigts reste sous les doigts ; déplacer les deux doigts fait aussi glisser
       le plateau. Un doigt : défilement normal du cadre. */
    let pince = null;
    // Glissement à un doigt : un toucher ne devient un glissement qu'au-delà de SEUIL pixels,
    // pour que les touchers brefs (choisir une case, un pion, une porte) restent des touchers.
    const SEUIL = 10;
    let glisse = null, finGlisse = 0;
    const milieu = t => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const ecart = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    cadre.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        glisse = { x: t.clientX, y: t.clientY, sl: cadre.scrollLeft, st: cadre.scrollTop, actif: false };
        return;
      }
      glisse = null;
      if (e.touches.length !== 2) return;
      const m = milieu(e.touches), r = cadre.getBoundingClientRect();
      const larg = svg.width.baseVal.value || 1, haut = svg.height.baseVal.value || 1;
      // Position (de 0 à 1) dans le plateau du point situé entre les doigts.
      const ox = svg.getBoundingClientRect();
      pince = { d0: ecart(e.touches), z0: zoom,
        fx: (m.x - ox.left) / larg, fy: (m.y - ox.top) / haut, r };
      e.preventDefault();
    }, { passive: false });
    let image = 0;
    cadre.addEventListener('touchmove', e => {
      if (glisse && e.touches.length === 1) {
        const t = e.touches[0], dx = t.clientX - glisse.x, dy = t.clientY - glisse.y;
        if (!glisse.actif && Math.hypot(dx, dy) < SEUIL) return;
        glisse.actif = true;
        e.preventDefault();
        cadre.scrollLeft = glisse.sl - dx;
        cadre.scrollTop = glisse.st - dy;
        return;
      }
      if (!pince || e.touches.length !== 2) return;
      e.preventDefault(); // pas de zoom ni de défilement de la page
      const t = [e.touches[0], e.touches[1]];
      if (image) return;
      image = requestAnimationFrame(() => {
        image = 0;
        zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pince.z0 * ecart(t) / pince.d0));
        appliquerZoom();
        // Ramène sous les doigts le point du plateau qui s'y trouvait au début.
        const m = milieu(t), ox = svg.getBoundingClientRect();
        cadre.scrollLeft += ox.left + pince.fx * svg.width.baseVal.value - m.x;
        cadre.scrollTop += ox.top + pince.fy * svg.height.baseVal.value - m.y;
      });
    }, { passive: false });
    const finPince = e => {
      if (glisse && e.touches.length === 0) {
        if (glisse.actif) finGlisse = Date.now();
        glisse = null;
      }
      if (!pince || e.touches.length >= 2) return;
      pince = null;
      zoom = Math.round(zoom * 100) / 100;
      try { localStorage.setItem('zoomJeu', zoom); } catch { }
    };
    cadre.addEventListener('touchend', finPince);
    cadre.addEventListener('touchcancel', finPince);
    // Après un glissement, le « clic » éventuel du navigateur ne doit rien sélectionner.
    cadre.addEventListener('click', e => {
      if (Date.now() - finGlisse < 250) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    // Safari : les « gestes » (pincement) zoomeraient toute la page ; on les bloque sur l'écran de jeu.
    const bloquerGeste = e => { if (document.body.classList.contains('mode-jeu')) e.preventDefault(); };
    if (!window.__gestesBloques) {
      window.__gestesBloques = true;
      ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, bloquerGeste, { passive: false }));
    }
    conteneur.querySelector('#pl-ajuster').addEventListener('click', () => { zoom = 1; changerZoom(1); });
    conteneur.querySelector('#pl-plus').addEventListener('click', () => changerZoom(1.25));
    conteneur.querySelector('#pl-moins').addEventListener('click', () => changerZoom(0.8));

    appliquerZoom();
    dessiner();
    msg(etat.portesOuvertes.length === 0 && quete.intro ? quete.intro : `Quête : ${quete.titre}`);
  }

  return { monter };
})();
