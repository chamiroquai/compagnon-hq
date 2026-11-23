/* ecran-heros.js — Registre des personnages (onglet « Héros »), groupes enregistrés,
   fichiers d’un héros ou d’un groupe (export / import, v0.29.0).
   Un personnage est durable : il garde son nom, ses caractéristiques, son or,
   son inventaire et le journal de ses quêtes. Une partie réunit un groupe de
   personnages (au plus un par classe). Tout reste sur l'appareil.
   Utilise les outils de app.js : vue, $, echapper, choisirOnglet, nouvelId, dateLisible. */
'use strict';

const Heros = (() => {

  const nomClasse = c => Regles.TYPES_HEROS.find(t => t.id === c)?.nom || c;

  // Deux lettres pour le pion : « Thorgrim » → « Th », « Anne Marie » → « AM ».
  function initiales(nom) {
    const mots = String(nom || '').trim().split(/\s+/).filter(Boolean);
    if (mots.length >= 2) return (mots[0][0] + mots[1][0]).toUpperCase();
    const m = mots[0] || '?';
    return m[0].toUpperCase() + (m[1] || '').toLowerCase();
  }

  // Copie de l'équipement de départ de la classe (Réglages), au format de l'inventaire.
  async function equipementDe(classe) {
    const e = await Stockage.lireReglage('equipementDepart');
    return JSON.parse(JSON.stringify(Array.isArray(e?.[classe]) ? e[classe] : []));
  }

  /* ---------- Groupes enregistrés et fichiers de héros ---------- */

  const FORMAT_HEROS = 'compagnon-hq/personnages';
  const VERSION_FORMAT_HEROS = 1;
  const CLASSES = Regles.TYPES_HEROS.map(t => t.id);

  // Groupes enregistrés (Réglages « groupes ») : [{ id, nom, membres: { classe: id de personnage } }].
  async function lireGroupes() {
    const g = await Stockage.lireReglage('groupes');
    return Array.isArray(g) ? g : [];
  }
  const ecrireGroupes = g => Stockage.ecrireReglage('groupes', g);

  // Garde au plus un personnage par classe connue.
  function membresPropres(m) {
    return Object.fromEntries(CLASSES.filter(c => typeof m?.[c] === 'string' && m[c]).map(c => [c, m[c]]));
  }

  // Enregistre un groupe ; un groupe de même nom est remplacé après confirmation.
  async function enregistrerGroupe(nom, membres) {
    nom = String(nom || '').trim().slice(0, 40);
    if (!nom) return null;
    const propres = membresPropres(membres);
    if (!Object.keys(propres).length) { alert('Le groupe est vide : choisissez au moins un personnage.'); return null; }
    const groupes = await lireGroupes();
    const meme = groupes.find(g => g.nom.toLowerCase() === nom.toLowerCase());
    if (meme && !confirm(`Un groupe « ${meme.nom} » existe déjà. Le remplacer ?`)) return null;
    const g = { id: meme?.id || nouvelId(), nom, membres: propres, modifieLe: new Date().toISOString() };
    await ecrireGroupes([...groupes.filter(x => x.id !== g.id), g]);
    return g;
  }

  // « Thorgrim le Brave » → heros-Thorgrim-le-Brave-2026-11-22.prive.json
  function nomFichier(prefixe, nom) {
    const propre = String(nom).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sans-nom';
    return `${prefixe}-${propre}-${new Date().toISOString().slice(0, 10)}.prive.json`;
  }

  function exporterFichier(personnages, groupes, fichier) {
    telechargerJson({
      format: FORMAT_HEROS, versionFormat: VERSION_FORMAT_HEROS, versionApp: VERSION_APP,
      exporteLe: new Date().toISOString(), personnages, groupes,
    }, fichier);
  }

  async function exporterHeros(id) {
    const p = await Stockage.lirePersonnage(id);
    if (p) exporterFichier([p], [], nomFichier('heros', p.nom));
  }

  // Un groupe part avec ses personnages complets (caractéristiques, or, inventaire, journal).
  async function exporterGroupe(id) {
    const g = (await lireGroupes()).find(x => x.id === id);
    if (!g) return;
    const persos = (await Promise.all(Object.values(g.membres).map(i => Stockage.lirePersonnage(i)))).filter(Boolean);
    exporterFichier(persos, [g], nomFichier('groupe', g.nom));
  }

  // Ouvre un fichier de héros ou de groupe. Renvoie { erreur } | { annule } | { succes }.
  async function importer(donnees) {
    if (donnees?.format !== FORMAT_HEROS) return { erreur: 'Ce fichier n’est pas un fichier de héros ou de groupe du Compagnon de quête.' };
    if (donnees.versionFormat > VERSION_FORMAT_HEROS) return { erreur: 'Ce fichier vient d’une version plus récente de l’application : mettez-la à jour d’abord.' };
    const persos = Array.isArray(donnees.personnages) ? donnees.personnages : [];
    const illisibles = persos.filter(p => !p || typeof p.id !== 'string' || !p.id || typeof p.nom !== 'string' || !p.nom.trim() || !CLASSES.includes(p.classe));
    if (illisibles.length) return { erreur: `Fichier abîmé : ${illisibles.length} personnage(s) illisible(s).` };
    const groupes = (Array.isArray(donnees.groupes) ? donnees.groupes : [])
      .filter(g => g && typeof g.id === 'string' && g.id && typeof g.nom === 'string' && g.nom.trim())
      .map(g => ({ id: g.id, nom: g.nom.trim().slice(0, 40), membres: membresPropres(g.membres), modifieLe: g.modifieLe }));
    if (!persos.length && !groupes.length) return { erreur: 'Ce fichier ne contient aucun héros.' };

    const existants = new Map((await Stockage.listerPersonnages()).map(p => [p.id, p]));
    const remplaces = persos.filter(p => existants.has(p.id));
    const dejaGroupes = await lireGroupes();
    const groupesRemplaces = groupes.filter(g => dejaGroupes.some(x => x.id === g.id));
    const message = (groupes.length ? `Groupe(s) : ${groupes.map(g => g.nom).join(', ')}.\n` : '')
      + `${persos.length} héros : ${persos.map(p => `${p.nom} (${nomClasse(p.classe)})`).join(', ')}.`
      + (donnees.exporteLe ? `\nFichier créé le ${dateLisible(donnees.exporteLe)}.` : '')
      + (remplaces.length ? `\n\n⚠ Déjà sur cet iPad, remplacé(s) par la version du fichier :\n– ${remplaces.map(p => {
          const d = existants.get(p.id);
          return `${d.nom} (sur l’iPad : ${(d.journal || []).length} quête(s), ${d.or || 0} po ; dans le fichier : ${(p.journal || []).length} quête(s), ${p.or || 0} po)`;
        }).join('\n– ')}` : '')
      + (groupesRemplaces.length ? `\nGroupe(s) remplacé(s) : ${groupesRemplaces.map(g => g.nom).join(', ')}.` : '')
      + '\n\nContinuer ?';
    if (!confirm(message)) return { annule: true };

    for (const p of persos) {
      await Stockage.enregistrerPersonnage({ or: 0, inventaire: [], journal: [], mort: false, ...p, nom: p.nom.trim().slice(0, 40) });
    }
    if (groupes.length) await ecrireGroupes([...dejaGroupes.filter(x => !groupes.some(g => g.id === x.id)), ...groupes]);
    return { succes: `${persos.length} héros${groupes.length ? ` et ${groupes.length} groupe(s)` : ''} ajouté(s) sur cet iPad.` };
  }

  // Les quatre listes « une classe = un personnage » (onglet Héros et carte Groupe d'une partie).
  function choixMembres(persos, membres, verrouille) {
    return `<div class="grille-groupe">
      ${Regles.TYPES_HEROS.map(t => {
        const choix = persos.filter(p => p.classe === t.id);
        return `<label class="case-groupe"><span><span class="pastille h-${t.id}"></span> ${t.nom}</span>
          <select data-classe="${t.id}" ${verrouille ? 'disabled' : ''}>
            <option value="">— personne —</option>
            ${choix.map(p => `<option value="${echapper(p.id)}" ${membres?.[t.id] === p.id ? 'selected' : ''}>${echapper(p.nom)}</option>`).join('')}
          </select></label>`;
      }).join('')}
    </div>`;
  }

  // « Thorgrim, Lyra, ☠ Borin, (supprimé) »
  function resumeMembres(g, parId) {
    return CLASSES.filter(c => g.membres[c]).map(c => {
      const p = parId.get(g.membres[c]);
      return p ? `${p.mort ? '☠ ' : ''}${echapper(p.nom)}` : `<span class="erreur">(${nomClasse(c)} supprimé)</span>`;
    }).join(', ');
  }

  // Nouveau personnage : caractéristiques et équipement de départ copiés depuis les Réglages.
  function creer(nom, classe, caracs, inventaire = []) {
    const v = champ => Regles.valeur(caracs, 'heros', classe, champ);
    return {
      id: nouvelId(), nom, classe,
      vieMax: v('corps'), espritMax: v('esprit'), attaque: v('attaque'), defense: v('defense'),
      or: 0, inventaire, journal: [], mort: false,
      creeLe: new Date().toISOString(),
    };
  }

  // Personnages du groupe d'une partie, prêts pour Plateau.etatInitial.
  async function groupeDe(partie) {
    const ids = Object.values(partie.groupe || {}).filter(Boolean);
    const persos = (await Promise.all(ids.map(id => Stockage.lirePersonnage(id)))).filter(p => p && !p.mort);
    return persos.map(p => ({
      persoId: p.id, classe: p.classe, nom: p.nom, court: initiales(p.nom),
      vieMax: p.vieMax, espritMax: p.espritMax, attaque: p.attaque, defense: p.defense,
      or: p.or, inventaire: p.inventaire,
    }));
  }

  // Fin de quête : or et inventaire reviennent dans les personnages ; journal mis à jour.
  // Un héros à 0 point de Vie est marqué « mort » (il peut être ramené dans l'onglet Héros).
  async function terminerQuete(partie, issue) {
    const date = new Date().toISOString();
    const titre = partie.quete?.titre || 'Quête';
    const morts = [];
    for (const h of partie.etat?.heros || []) {
      if (!h.persoId) continue;
      const p = await Stockage.lirePersonnage(h.persoId);
      if (!p) continue;
      p.or = h.or || 0;
      p.inventaire = h.inventaire || [];
      const mort = !!h.mort || h.corps === 0;
      p.journal = [...(p.journal || []), { titre, issue, date, mort }];
      if (mort) { p.mort = true; morts.push(p.nom); }
      await Stockage.enregistrerPersonnage(p);
    }
    partie.historique = [...(partie.historique || []), { titre, issue, date }];
    return morts;
  }

  /* ---------- Écran : liste des personnages ---------- */

  async function afficherListe() {
    document.body.classList.remove('mode-jeu');
    partieOuverte = null;
    choisirOnglet('heros');
    $('#titre-vue').textContent = 'Héros';
    $('#btn-retour').hidden = true;

    const persos = (await Stockage.listerPersonnages()).sort((a, b) => (a.mort - b.mort) || a.nom.localeCompare(b.nom));
    const vivants = persos.filter(p => !p.mort);
    const parId = new Map(persos.map(p => [p.id, p]));
    const groupes = (await lireGroupes()).sort((a, b) => a.nom.localeCompare(b.nom));
    vue.innerHTML = `
      <section class="carte">
        <h2>Nouveau personnage</h2>
        <form id="form-perso" class="ligne">
          <input id="perso-nom" type="text" placeholder="Nom (ex. Thorgrim)" maxlength="40" required>
          <select id="perso-classe" class="choix-classe">
            ${Regles.TYPES_HEROS.map(t => `<option value="${t.id}">${t.nom}</option>`).join('')}
          </select>
          <button type="submit" class="principal">Créer</button>
        </form>
        <p class="discret petit">Ses caractéristiques de départ sont reprises des Réglages ; vous pourrez les modifier
          (par exemple après un achat d’équipement).</p>
      </section>
      <section class="carte">
        <h2>Mes personnages</h2>
        ${persos.length ? `<ul class="liste">${persos.map(p => `
          <li><button class="ouvrir ouvrir-perso ${p.mort ? 'mort' : ''}" data-id="${echapper(p.id)}">
            <span class="ligne-perso"><span class="pastille h-${p.classe}"></span><strong>${echapper(p.nom)}</strong>
              <span class="discret">${nomClasse(p.classe)}</span>${p.mort ? '<span class="erreur">☠ mort</span>' : ''}</span>
            <span class="discret petit">♥ ${p.vieMax ?? '?'} · Esprit ${p.espritMax ?? '?'} · ${p.or || 0} pièces d’or ·
              ${(p.journal || []).length} quête(s)</span>
          </button></li>`).join('')}</ul>` : '<p class="discret">Aucun personnage pour l’instant.</p>'}
      </section>
      <section class="carte">
        <h2>Groupes</h2>
        ${groupes.length ? `<ul class="liste-groupes">${groupes.map(g => `
          <li><div><strong>${echapper(g.nom)}</strong><br><span class="discret petit">${resumeMembres(g, parId)}</span></div>
            <div class="ligne">
              <button class="petit-bouton" data-exporter-groupe="${echapper(g.id)}">Exporter</button>
              <button class="petit-bouton danger" data-supprimer-groupe="${echapper(g.id)}">Supprimer</button>
            </div></li>`).join('')}</ul>` : '<p class="discret">Aucun groupe enregistré.</p>'}
        <h3>Nouveau groupe</h3>
        <form id="form-groupe">
          <input id="groupe-nom" type="text" placeholder="Nom du groupe (ex. La compagnie du soir)" maxlength="40" required>
          ${choixMembres(vivants, {}, false)}
          <button type="submit" class="principal">Enregistrer le groupe</button>
        </form>
        <p class="discret petit">Au plus un personnage par classe. Dans une partie, la carte « Groupe » permet de choisir
          un groupe enregistré, ou d’enregistrer celui qu’on vient de composer. Même nom = groupe remplacé.</p>
      </section>
      <section class="carte">
        <h2>Fichiers de héros</h2>
        <p>Un héros (bouton « Exporter ce héros » de sa fiche) ou un groupe (bouton « Exporter ») peut être enregistré
          dans un fichier à part, avec ses caractéristiques, son or, son inventaire et son journal. Sur l’iPad, choisissez
          « Enregistrer dans Fichiers ». Le fichier reste chez vous.</p>
        <button id="btn-import-heros">Ouvrir un héros ou un groupe (fichier)…</button>
        <p id="import-heros-etat" class="petit"></p>
      </section>`;

    $('#form-perso').addEventListener('submit', async e => {
      e.preventDefault();
      const nom = $('#perso-nom').value.trim();
      if (!nom) return;
      const classe = $('#perso-classe').value;
      const p = creer(nom, classe, await lireCaracs(), await equipementDe(classe));
      await Stockage.enregistrerPersonnage(p);
      afficherFiche(p.id);
    });
    vue.querySelectorAll('.ouvrir-perso').forEach(b => b.addEventListener('click', () => afficherFiche(b.dataset.id)));

    $('#form-groupe').addEventListener('submit', async e => {
      e.preventDefault();
      const membres = {};
      $('#form-groupe').querySelectorAll('select[data-classe]').forEach(sel => { membres[sel.dataset.classe] = sel.value; });
      if (await enregistrerGroupe($('#groupe-nom').value, membres)) afficherListe();
    });
    vue.querySelectorAll('[data-exporter-groupe]').forEach(b => b.addEventListener('click', () => exporterGroupe(b.dataset.exporterGroupe)));
    vue.querySelectorAll('[data-supprimer-groupe]').forEach(b => b.addEventListener('click', async () => {
      const g = groupes.find(x => x.id === b.dataset.supprimerGroupe);
      if (!g || !confirm(`Supprimer le groupe « ${g.nom} » ? Ses personnages sont conservés.`)) return;
      await ecrireGroupes((await lireGroupes()).filter(x => x.id !== g.id));
      afficherListe();
    }));

    // Fichier de héros ou de groupe : lu sur l'appareil, jamais envoyé ailleurs.
    const choix = document.createElement('input');
    choix.type = 'file'; choix.accept = '.json,application/json'; choix.hidden = true;
    vue.appendChild(choix);
    $('#btn-import-heros').addEventListener('click', () => choix.click());
    choix.addEventListener('change', async () => {
      const f = choix.files[0];
      choix.value = '';
      if (!f) return;
      const etat = $('#import-heros-etat');
      const dire = (t, c) => { etat.textContent = t; etat.className = 'petit ' + (c || ''); };
      if (f.size > 5_000_000) return dire('Fichier trop gros pour un fichier de héros.', 'erreur');
      let donnees;
      try { donnees = JSON.parse(await f.text()); } catch { return dire('Ce fichier n’est pas un fichier JSON lisible.', 'erreur'); }
      const r = await importer(donnees);
      if (r.erreur) return dire(r.erreur, 'erreur');
      if (r.annule) return dire('Ouverture annulée.');
      await afficherListe();
      $('#import-heros-etat').textContent = r.succes;
      $('#import-heros-etat').className = 'petit succes';
    });
  }

  /* Dés utilisés en combat, avec l'équipement (même calcul que vue-plateau.js, écart 30) :
     l'arme en main remplace les dés d'attaque, l'armure s'ajoute aux dés de défense. */
  function desCombat(p) {
    const { arme } = Inventaire.tri(p.inventaire || []);
    const bonus = Inventaire.bonusArmure(p.inventaire || []);
    const att = arme && Number.isFinite(arme.o.des) ? `${arme.o.des} (${echapper(arme.o.nom)})`
      : `${p.attaque ?? '?'}${arme ? ` (⚠ dés de « ${echapper(arme.o.nom)} » non indiqués)` : ' (mains nues)'}`;
    const def = p.defense == null ? '?' : bonus ? `${p.defense + bonus} (${p.defense} + ${bonus} d’armure)` : `${p.defense}`;
    const cap = arme ? Inventaire.etiquettes(arme.o) : [];
    return `<strong>En combat</strong> : attaque ${att}${cap.length ? ` · ${cap.join(', ').toLowerCase()}` : ''} · défense ${def}${Inventaire.bouclierInutile(p.inventaire || []) ? ' (bouclier inutilisable avec une arme à deux mains)' : ''}`;
  }

  /* ---------- Écran : fiche d'un personnage ---------- */

  async function afficherFiche(id) {
    const p = await Stockage.lirePersonnage(id);
    if (!p) return afficherListe();
    choisirOnglet('heros');
    $('#titre-vue').textContent = p.nom;
    $('#btn-retour').hidden = true;

    const champ = (libelle, cle) => `
      <label class="champ-perso"><span>${libelle}</span>
        <input type="number" inputmode="numeric" min="0" max="${cle === 'or' ? 99999 : 20}" data-cle="${cle}" value="${p[cle] ?? ''}"></label>`;
    vue.innerHTML = `
      <section class="carte">
        <div class="ligne"><button id="pf-retour">‹ Tous les héros</button></div>
        <h2><span class="pastille h-${p.classe}"></span> ${echapper(p.nom)} <span class="discret">· ${nomClasse(p.classe)}</span></h2>
        ${p.mort ? `<p class="erreur">☠ Ce personnage est mort. <button id="pf-revivre">Le ramener</button></p>` : ''}
        <label class="champ-perso large"><span>Nom</span><input id="pf-nom" type="text" maxlength="40" value="${echapper(p.nom)}"></label>
        <div class="grille-champs">
          ${champ('Points de Vie (max.)', 'vieMax')}
          ${champ('Points d’Esprit (max.)', 'espritMax')}
          ${champ('Dés d’attaque (mains nues)', 'attaque')}
          ${champ('Dés de défense (sans armure)', 'defense')}
          ${champ('Pièces d’or', 'or')}
        </div>
        <p class="des-combat">${desCombat(p)}</p>
        <p id="pf-etat" class="discret petit">Enregistrement automatique.</p>
      </section>
      <section class="carte">
        <h2>Inventaire</h2>
        <div id="pf-inventaire">${Inventaire.html(p.inventaire || [], { classe: p.classe })}</div>
        <button id="pf-equipement" class="petit-bouton">Ajouter l’équipement de départ (${echapper(nomClasse(p.classe))})</button>
        <p id="pf-equipement-etat" class="discret petit"></p>
      </section>
      <section class="carte">
        <h2>Journal des quêtes</h2>
        ${(p.journal || []).length ? `<ul class="puces">${p.journal.slice().reverse().map(j => `<li>${echapper(j.titre)} —
          ${j.issue === 'reussie' ? 'réussie' : 'échouée'}${j.mort ? ' (mort)' : ''} <span class="discret petit">· ${dateLisible(j.date)}</span></li>`).join('')}</ul>`
          : '<p class="discret">Aucune quête terminée.</p>'}
      </section>
      <section class="carte">
        <div class="ligne">
          <button id="pf-exporter">Exporter ce héros (fichier)</button>
          <button id="pf-supprimer" class="danger">Supprimer ce personnage</button>
        </div>
        <p class="discret petit">Le fichier contient le nom, les caractéristiques, l’or, l’inventaire et le journal.
          Il se rouvre dans l’onglet Héros (« Ouvrir un héros ou un groupe »).</p>
      </section>`;

    const sauver = async () => { await Stockage.enregistrerPersonnage(p); $('#pf-etat').textContent = 'Enregistré sur cet iPad.'; };
    $('#pf-retour').addEventListener('click', afficherListe);
    $('#pf-nom').addEventListener('change', async () => {
      const n = $('#pf-nom').value.trim();
      if (!n) { $('#pf-nom').value = p.nom; return; }
      p.nom = n.slice(0, 40); await sauver(); $('#titre-vue').textContent = p.nom;
    });
    vue.querySelectorAll('input[data-cle]').forEach(inp => inp.addEventListener('change', async () => {
      const v = inp.value === '' ? null : Math.max(0, Math.round(Number(inp.value)));
      p[inp.dataset.cle] = Number.isFinite(v) ? v : null;
      if (inp.dataset.cle === 'or' && p.or === null) p.or = 0;
      await sauver();
    }));
    $('#pf-equipement').addEventListener('click', async () => {
      const ajout = await equipementDe(p.classe);
      if (!ajout.length) { $('#pf-equipement-etat').textContent = 'Aucun équipement de départ pour cette classe (Réglages › Équipement de départ).'; return; }
      const dejaArme = (p.inventaire || []).some(o => o.emplacement === 'arme');
      // Une seule arme en main : si le personnage en a déjà une, l'arme de départ va avec les autres objets.
      if (dejaArme) ajout.forEach(o => { if (o.emplacement === 'arme') delete o.emplacement; });
      p.inventaire = [...(p.inventaire || []), ...ajout];
      await sauver(); afficherFiche(id);
    });
    Inventaire.brancher($('#pf-inventaire'), async fn => {
      p.inventaire = p.inventaire || [];
      fn(p.inventaire);
      await sauver(); afficherFiche(id);
    }, p.nom);
    $('#pf-revivre')?.addEventListener('click', async () => { p.mort = false; await sauver(); afficherFiche(id); });
    $('#pf-exporter').addEventListener('click', () => exporterHeros(id));
    $('#pf-supprimer').addEventListener('click', async () => {
      if (!confirm(`Supprimer définitivement ${p.nom} ? (Pensez à une sauvegarde.)`)) return;
      await Stockage.supprimerPersonnage(id);
      afficherListe();
    });
  }

  /* ---------- Groupe d'une partie (carte sur l'écran de la partie) ---------- */

  // HTML de la carte « Groupe » : une case par classe, un personnage vivant au choix,
  // et les groupes enregistrés (avant la quête seulement).
  async function carteGroupe(partie, verrouille) {
    const persos = (await Stockage.listerPersonnages()).filter(p => !p.mort);
    const groupes = (await lireGroupes()).sort((a, b) => a.nom.localeCompare(b.nom));
    return `
      <section class="carte">
        <h2>Groupe</h2>
        ${verrouille ? '<p class="discret petit">Le groupe ne change pas pendant une quête.</p>' : ''}
        ${choixMembres(persos, partie.groupe || {}, verrouille)}
        ${verrouille || !persos.length ? '' : `
          <div class="ligne groupe-enregistre">
            ${groupes.length ? `<select id="choix-groupe" aria-label="Groupe enregistré">
              <option value="">Prendre un groupe enregistré…</option>
              ${groupes.map(g => `<option value="${echapper(g.id)}">${echapper(g.nom)}</option>`).join('')}
            </select>` : ''}
            <button id="btn-enregistrer-groupe">Enregistrer ce groupe…</button>
          </div>
          <p id="etat-groupe" class="petit"></p>`}
        ${persos.length ? '' : '<p class="discret petit">Créez d’abord des personnages dans l’onglet Héros. Sans groupe, la quête se joue avec les 4 héros de base, sans nom.</p>'}
      </section>`;
  }

  function brancherGroupe(partie, enregistrer) {
    vue.querySelectorAll('select[data-classe]').forEach(sel => sel.addEventListener('change', async () => {
      partie.groupe = { ...(partie.groupe || {}), [sel.dataset.classe]: sel.value || null };
      await enregistrer();
    }));
    // Groupe enregistré → composition de la partie (personnages vivants et présents seulement).
    $('#choix-groupe')?.addEventListener('change', async e => {
      const g = (await lireGroupes()).find(x => x.id === e.target.value);
      if (!g) return;
      const absents = [];
      const groupe = {};
      for (const c of CLASSES) {
        const id = g.membres[c];
        if (!id) { groupe[c] = null; continue; }
        const p = await Stockage.lirePersonnage(id);
        if (p && !p.mort) groupe[c] = id;
        else { groupe[c] = null; absents.push(p ? `${p.nom} (mort)` : `${nomClasse(c)} (supprimé)`); }
      }
      partie.groupe = groupe;
      await enregistrer();
      await afficherPartie(partie.id);
      if (absents.length) {
        const etat = $('#etat-groupe');
        if (etat) { etat.textContent = `Groupe « ${g.nom} » choisi, sans : ${absents.join(', ')}.`; etat.className = 'petit erreur'; }
      }
    });
    $('#btn-enregistrer-groupe')?.addEventListener('click', async () => {
      const membres = membresPropres(partie.groupe);
      if (!Object.keys(membres).length) { alert('Choisissez d’abord au moins un personnage.'); return; }
      const cle = g => JSON.stringify(CLASSES.map(c => g.membres?.[c] || ''));
      const pareil = (await lireGroupes()).find(g => cle(g) === cle({ membres }));
      const nom = prompt('Nom du groupe :', pareil?.nom || '');
      if (nom == null) return;
      const g = await enregistrerGroupe(nom, membres);
      if (!g) return;
      await afficherPartie(partie.id);
      const etat = $('#etat-groupe');
      if (etat) { etat.textContent = `Groupe « ${g.nom} » enregistré.`; etat.className = 'petit succes'; }
    });
  }

  return { initiales, creer, groupeDe, terminerQuete, afficherListe, afficherFiche, carteGroupe, brancherGroupe,
    importer, lireGroupes, FORMAT_HEROS };
})();
