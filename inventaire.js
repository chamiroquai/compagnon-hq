/* inventaire.js — Inventaire d'un héros en trois blocs (décision de l'utilisateur, 22/11/2026) :
   - Arme active : une seule ; nom, dés d'attaque, note (diagonale, à distance…) ;
   - Armure : plusieurs pièces ; nom, bonus de dés de défense, note ;
   - Autres objets : tout le reste (armes de rechange, potions, objets divers).
   Un objet reste un élément du tableau « inventaire » ; son bloc est donné par « emplacement »
   ('arme' ou 'armure' ; absent = autres objets). Les anciens inventaires restent valables.
   Les valeurs (dés, bonus) sont saisies par l'utilisateur d'après ses cartes : rien d'officiel ici.
   Utilisé par la fiche en jeu (vue-plateau.js) et par l'onglet Héros (ecran-heros.js).

   v0.30.0 — Armes et capacités (demande de l'utilisateur du 23/11/2026) :
   - une arme peut porter des capacités : diagonale, distance (tir), lancer (perdue une fois lancée),
     deuxMains (pas de bouclier) ; et « interdits » = classes qui ne peuvent pas s'en servir ;
   - l'armurerie (Réglages › Armurerie) est un catalogue d'armes saisi ou importé par l'utilisateur
     (fichier personnel) ; on y prend une arme pour l'inventaire, qui en reçoit une copie.
   - un bouclier (pièce d'armure marquée « bouclier » ou dont le nom contient « bouclier »)
     ne compte pas tant qu'une arme à deux mains est en main. */
'use strict';

const Inventaire = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const estPotion = o => !!o && (o.potion || /potion/i.test(o.nom || ''));
  const estBouclier = o => !!o && (o.bouclier === true || (o.bouclier !== false && /bouclier/i.test(o.nom || '')));

  // Capacités d'une arme (ordre d'affichage).
  const CAPACITES = [
    { id: 'diagonale', court: 'Diagonale', aide: 'attaque aussi un monstre voisin en diagonale' },
    { id: 'distance', court: 'À distance', aide: 'tire sur un monstre en vue, mais pas sur un monstre voisin' },
    { id: 'lancer', court: 'Se lance', aide: 'peut être lancée sur un monstre en vue ; elle est perdue une fois lancée' },
    { id: 'deuxMains', court: 'Deux mains', aide: 'pas de bouclier avec cette arme' },
  ];
  const classes = () => (typeof Regles !== 'undefined' ? Regles.TYPES_HEROS : []);
  const nomClasse = id => classes().find(t => t.id === id)?.nom || id;

  /* ---------- Armurerie (catalogue saisi par l'utilisateur) ---------- */
  let catalogue = [];
  // Nettoie une entrée d'armurerie (fichier importé ou formulaire) ; null si inutilisable.
  function nettoyerArme(a) {
    if (!a || typeof a !== 'object' || typeof a.nom !== 'string' || !a.nom.trim()) return null;
    const ent = (v, max) => { const n = Math.round(Number(v)); return v === '' || v == null || !Number.isFinite(n) ? undefined : Math.max(0, Math.min(max, n)); };
    const r = { id: typeof a.id === 'string' && a.id ? a.id.slice(0, 40) : 'arme-' + Math.random().toString(36).slice(2, 10), nom: a.nom.trim().slice(0, 60) };
    const des = ent(a.des, 12), prix = ent(a.prix, 99999);
    if (des !== undefined) r.des = des;
    if (prix !== undefined) r.prix = prix;
    for (const c of CAPACITES) if (a[c.id] === true) r[c.id] = true;
    const interdits = Array.isArray(a.interdits) ? a.interdits.filter(c => classes().some(t => t.id === c)) : [];
    if (interdits.length) r.interdits = [...new Set(interdits)];
    if (typeof a.note === 'string' && a.note.trim()) r.note = a.note.trim().slice(0, 200);
    return r;
  }
  const definirArmurerie = liste => { catalogue = (Array.isArray(liste) ? liste : []).map(nettoyerArme).filter(Boolean); };
  const armurerie = () => catalogue;
  // Objet d'inventaire tiré d'une arme de l'armurerie (copie : modifier l'armurerie ne change pas les inventaires).
  function depuisArmurerie(a, emplacement) {
    const o = { nom: a.nom, armurerie: a.id };
    if (Number.isFinite(a.des)) o.des = a.des;
    for (const c of CAPACITES) if (a[c.id]) o[c.id] = true;
    if (a.interdits?.length) o.interdits = [...a.interdits];
    if (a.note) o.note = a.note.slice(0, 120);
    if (emplacement) o.emplacement = emplacement;
    return o;
  }
  // Petites étiquettes des capacités d'une arme.
  const etiquettes = o => CAPACITES.filter(c => o?.[c.id]).map(c => c.court);
  // Avertissement si l'arme est interdite à cette classe (règle des cartes ; l'application ne bloque pas).
  const interditeA = (o, classe) => !!(o && classe && Array.isArray(o.interdits) && o.interdits.includes(classe));

  // Répartition : { arme: {o, k} | null, armures: [{o, k}], autres: [{o, k}] } (k = position dans le tableau).
  function tri(inv = []) {
    const tous = inv.map((o, k) => ({ o, k }));
    const armes = tous.filter(x => x.o.emplacement === 'arme');
    return {
      arme: armes[0] || null,
      armures: tous.filter(x => x.o.emplacement === 'armure'),
      // Une 2e « arme active » (données anciennes ou importées) est rangée avec les autres objets.
      autres: tous.filter(x => !x.o.emplacement || (x.o.emplacement === 'arme' && x !== armes[0])),
    };
  }

  // Un bouclier ne sert à rien avec une arme à deux mains en main.
  const bouclierInutile = inv => { const t = tri(inv); return !!t.arme?.o.deuxMains && t.armures.some(({ o }) => estBouclier(o)); };
  const bonusArmure = inv => {
    const t = tri(inv), sansBouclier = !!t.arme?.o.deuxMains;
    return t.armures.reduce((s, { o }) => s + (Number.isFinite(o.des) && !(sansBouclier && estBouclier(o)) ? o.des : 0), 0);
  };

  function champs(o, k, libelleDes, aide, arme = false) {
    return `<div class="champs-inv">
        <input type="text" maxlength="80" data-inv-k="${k}" data-inv-champ="nom" value="${esc(o.nom)}" aria-label="Nom">
        <label class="petit">${libelleDes} <input type="number" min="0" max="12" inputmode="numeric" data-inv-k="${k}" data-inv-champ="des" value="${Number.isFinite(o.des) ? o.des : ''}" placeholder="—"></label>
        <input type="text" maxlength="120" class="note-inv" data-inv-k="${k}" data-inv-champ="note" value="${esc(o.note || '')}" placeholder="${aide}" aria-label="Note">
        ${arme ? `<span class="capacites-inv">${CAPACITES.map(c => `<label class="petit" title="${esc(c.aide)}"><input type="checkbox" data-inv-k="${k}" data-inv-cap="${c.id}"${o[c.id] ? ' checked' : ''}> ${c.court}</label>`).join('')}</span>` : ''}
      </div>`;
  }

  // Liste de choix de l'armurerie (si elle n'est pas vide).
  function choixArmurerie() {
    if (!catalogue.length) return '';
    return `<div class="choix-armurerie"><select class="choix-classe" data-inv-armurerie aria-label="Arme de l’armurerie">
        ${catalogue.map((a, i) => `<option value="${i}">${esc(a.nom)}${Number.isFinite(a.des) ? ` — ${a.des} dé${a.des > 1 ? 's' : ''}` : ''}${etiquettes(a).length ? ` (${etiquettes(a).join(', ').toLowerCase()})` : ''}</option>`).join('')}
      </select>
      <button class="petit-bouton" data-inv-prendre="arme">En main</button>
      <button class="petit-bouton" data-inv-prendre="">Dans le sac</button></div>`;
  }

  /* v0.39.0 — Description d'un objet (demande de l'utilisateur du 23/11/2026) : champ « texte »
     (carte trésor, trésor de quête ou saisie « Description… »). Une potion sans description
     ni valeur de soin le signale, pour qu'on sache que son effet reste à décider. */
  const SOIN_TOTAL = 99; // « soin » ≥ 99 : la potion rend tous les points de Vie de départ
  const TEXTE_MAX = 300;
  function description(o, bloc = false) {
    const t = typeof o?.texte === 'string' ? o.texte.trim() : '';
    const cls = `description-inv discret petit${bloc ? ' pleine-largeur' : ''}`;
    if (t) return `<span class="${cls}">${esc(t)}</span>`;
    if (estPotion(o) && !Number.isFinite(o.soin)) return `<span class="${cls}">Effet non indiqué (« Description… » pour le noter).</span>`;
    return '';
  }

  const boutonDecrire = (o, k) => `<button class="petit-bouton" data-inv-decrire="${k}" data-inv-nom="${esc(o.nom)}" data-inv-texte="${esc(o.texte || '')}">Description…</button>`;

  /* HTML des trois blocs. options : { lectureSeule, peutBoire, classe } */
  function html(inv = [], { lectureSeule = false, peutBoire = false, classe = null } = {}) {
    const { arme, armures, autres } = tri(inv);
    const bonus = bonusArmure(inv);
    const avert = [];
    if (arme && interditeA(arme.o, classe)) avert.push(`⚠ Règle : « ${esc(arme.o.nom)} » ne peut pas servir à ${esc(nomClasse(classe))} (ses dés sont comptés quand même).`);
    if (bouclierInutile(inv)) avert.push('⚠ Arme à deux mains : le bouclier ne compte pas.');
    const boutons = (k, liste) => lectureSeule ? '' : `<span class="actions-inv">${liste.join('')}
        <button class="icone petit-bouton" data-inv-retirer="${k}" aria-label="Retirer">✕</button></span>`;
    return `
      <div class="bloc-inv">
        <h4>Arme active <span class="discret petit">· ses dés remplacent les dés d’attaque</span></h4>
        ${arme ? `<div class="ligne-inv">${champs(arme.o, arme.k, 'Dés d’attaque', 'Note', true)}
            ${boutons(arme.k, [boutonDecrire(arme.o, arme.k), `<button class="petit-bouton" data-inv-ranger="${arme.k}">Ranger</button>`])}${description(arme.o, true)}</div>`
          : '<p class="discret petit">Aucune arme en main.</p>'}
        ${avert.map(t => `<p class="erreur petit">${t}</p>`).join('')}
        ${lectureSeule ? '' : `${choixArmurerie()}<button class="petit-bouton" data-inv-ajouter="arme">Autre arme en main…</button>`}
      </div>
      <div class="bloc-inv">
        <h4>Armure <span class="discret petit">· ${bonus ? `+${bonus} dé${bonus > 1 ? 's' : ''} de défense au total` : 'ses bonus s’ajoutent aux dés de défense'}</span></h4>
        ${armures.length ? armures.map(({ o, k }) => `<div class="ligne-inv">${champs(o, k, 'Défense +', 'Note')}
            ${boutons(k, [boutonDecrire(o, k), `<button class="petit-bouton" data-inv-ranger="${k}">Ôter</button>`])}${description(o, true)}</div>`).join('')
          : '<p class="discret petit">Aucune pièce d’armure.</p>'}
        ${lectureSeule ? '' : '<button class="petit-bouton" data-inv-ajouter="armure">Ajouter une pièce d’armure…</button>'}
      </div>
      <div class="bloc-inv">
        <h4>Autres objets</h4>
        ${autres.length ? `<ul class="inventaire">${autres.map(({ o, k }) => `<li>
            <span>${esc(o.nom)}${Number.isFinite(o.soin) && o.soin > 0 ? ` <span class="discret petit">(${o.soin >= SOIN_TOTAL ? 'toute la Vie' : `+${o.soin} Vie`})</span>` : ''}${Number.isFinite(o.des) && !o.emplacement ? ` <span class="discret petit">· ${o.des} dé${o.des > 1 ? 's' : ''}</span>` : ''}${etiquettes(o).length ? ` <span class="discret petit">· ${etiquettes(o).join(', ').toLowerCase()}</span>` : ''}${o.note ? ` <span class="discret petit">· ${esc(o.note)}</span>` : ''}${description(o)}</span>
            ${boutons(k, [
              boutonDecrire(o, k),
              peutBoire && estPotion(o) ? `<button class="petit-bouton" data-boire="${k}">Boire</button>` : '',
              estPotion(o) ? '' : `<button class="petit-bouton" data-inv-equiper="${k}">En main</button>`,
              estPotion(o) ? '' : `<button class="petit-bouton" data-inv-porter="${k}">Porter</button>`,
            ])}</li>`).join('')}</ul>`
          : '<p class="discret petit">Rien d’autre.</p>'}
        ${lectureSeule ? '' : '<button class="petit-bouton" data-inv-ajouter="">Ajouter un objet…</button>'}
      </div>`;
  }

  /* Branche les commandes. changer(fn) : fn(inventaire) modifie le tableau, puis l'appelant
     enregistre et redessine (en jeu : modifier(), donc annulable avec ↶). */
  function brancher(racine, changer, nomHeros = 'ce héros') {
    const k = el => +el.dataset.invK;
    racine.querySelectorAll('[data-inv-champ]').forEach(inp => inp.addEventListener('change', () => {
      const champ = inp.dataset.invChamp, v = inp.value.trim();
      changer(inv => {
        const o = inv[k(inp)];
        if (!o) return;
        if (champ === 'des') {
          const n = Math.round(Number(v));
          if (v === '' || !Number.isFinite(n)) delete o.des; else o.des = Math.max(0, Math.min(12, n));
        } else if (champ === 'nom') { if (v) o.nom = v.slice(0, 80); }
        else if (v) o.note = v.slice(0, 120); else delete o.note;
      });
    }));
    racine.querySelectorAll('[data-inv-cap]').forEach(inp => inp.addEventListener('change', () =>
      changer(inv => { const o = inv[k(inp)]; if (!o) return; if (inp.checked) o[inp.dataset.invCap] = true; else delete o[inp.dataset.invCap]; })));
    racine.querySelectorAll('[data-inv-prendre]').forEach(b => b.addEventListener('click', () => {
      const a = catalogue[+racine.querySelector('[data-inv-armurerie]')?.value];
      if (!a) return;
      const empl = b.dataset.invPrendre;
      changer(inv => {
        if (empl === 'arme') inv.forEach(o => { if (o.emplacement === 'arme') delete o.emplacement; });
        inv.push(depuisArmurerie(a, empl));
      });
    }));
    racine.querySelectorAll('[data-inv-decrire]').forEach(b => b.addEventListener('click', () => {
      const v = prompt(`Description de « ${b.dataset.invNom} » (effet, règle de la carte…) :`, b.dataset.invTexte || '');
      if (v === null) return;
      changer(inv => {
        const o = inv[+b.dataset.invDecrire];
        if (!o) return;
        const t = v.trim().slice(0, TEXTE_MAX);
        if (t) o.texte = t; else delete o.texte;
      });
    }));
    racine.querySelectorAll('[data-inv-ranger]').forEach(b => b.addEventListener('click', () =>
      changer(inv => { delete inv[+b.dataset.invRanger].emplacement; })));
    racine.querySelectorAll('[data-inv-equiper]').forEach(b => b.addEventListener('click', () =>
      changer(inv => {
        inv.forEach(o => { if (o.emplacement === 'arme') delete o.emplacement; }); // l'ancienne arme retourne avec les autres objets
        inv[+b.dataset.invEquiper].emplacement = 'arme';
      })));
    racine.querySelectorAll('[data-inv-porter]').forEach(b => b.addEventListener('click', () =>
      changer(inv => { inv[+b.dataset.invPorter].emplacement = 'armure'; })));
    racine.querySelectorAll('[data-inv-retirer]').forEach(b => b.addEventListener('click', () =>
      changer(inv => { inv.splice(+b.dataset.invRetirer, 1); })));
    racine.querySelectorAll('[data-inv-ajouter]').forEach(b => b.addEventListener('click', () => {
      const empl = b.dataset.invAjouter;
      const quoi = empl === 'arme' ? 'Arme mise en main' : empl === 'armure' ? 'Pièce d’armure' : 'Objet';
      const nom = prompt(`${quoi} pour ${nomHeros} :`);
      if (!nom || !nom.trim()) return;
      changer(inv => {
        if (empl === 'arme') inv.forEach(o => { if (o.emplacement === 'arme') delete o.emplacement; });
        inv.push({ nom: nom.trim().slice(0, 80), ...(empl ? { emplacement: empl } : {}) });
      });
    }));
  }

  return { tri, html, brancher, description, SOIN_TOTAL, TEXTE_MAX, bonusArmure, bouclierInutile, estPotion, estBouclier, CAPACITES, etiquettes, interditeA,
    nettoyerArme, definirArmurerie, armurerie, depuisArmurerie };
})();
