/* app.js — Interface du Compagnon de quête (étape 3 : plateau et brouillard).
   Contenu : liste des parties, notes de partie, sauvegarde et restauration
   en fichier JSON, installation hors ligne et mises à jour.
   Le plateau, les héros et les monstres arriveront aux étapes suivantes. */
'use strict';

const VERSION_APP = '0.32.2';
const FORMAT_SAUVEGARDE = 'compagnon-hq/sauvegarde';
const VERSION_FORMAT = 1;
const JOURS_RAPPEL = 7; // rappel de sauvegarde au-delà de ce nombre de jours

const $ = sel => document.querySelector(sel);
const vue = $('#vue');
let partieOuverte = null; // identifiant de la partie affichée, ou null

/* ---------- Outils ---------- */

// Protège le texte saisi avant de l'insérer dans la page.
function echapper(texte) {
  return String(texte ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function nouvelId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function dateLisible(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

// Propose un fichier JSON à enregistrer (sur l'iPad : « Enregistrer dans Fichiers »). Rien n'est envoyé ailleurs.
function telechargerJson(contenu, nomFichier) {
  const blob = new Blob([JSON.stringify(contenu, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomFichier;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function joursDepuis(iso) {
  return iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity;
}

function bandeau(html, actions = []) {
  const b = $('#bandeau');
  if (!html) { b.hidden = true; b.innerHTML = ''; return; }
  b.innerHTML = `<span>${html}</span>` + actions.map((a, i) => `<button data-i="${i}">${echapper(a.texte)}</button>`).join('');
  b.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => actions[btn.dataset.i].action()));
  b.hidden = false;
}

function choisirOnglet(nom) {
  document.querySelectorAll('.onglets button').forEach(b => b.classList.toggle('actif', b.dataset.vue === nom));
}

/* ---------- Vue : liste des parties ---------- */

async function afficherParties() {
  document.body.classList.remove('mode-jeu');
  partieOuverte = null;
  choisirOnglet('parties');
  $('#titre-vue').textContent = 'Parties';
  $('#btn-retour').hidden = true;

  const parties = (await Stockage.listerParties()).sort((a, b) => b.modifieeLe.localeCompare(a.modifieeLe));
  vue.innerHTML = `
    <section class="carte">
      <h2>Nouvelle partie</h2>
      <form id="form-nouvelle" class="ligne">
        <input id="nom-nouvelle" type="text" placeholder="Nom (ex. Campagne avec mon fils)" maxlength="80" required>
        <button type="submit" class="principal">Créer</button>
      </form>
    </section>
    <section class="carte">
      <h2>Mes parties</h2>
      ${parties.length === 0 ? '<p class="discret">Aucune partie pour l’instant.</p>' : `
      <ul class="liste">
        ${parties.map(p => `
          <li>
            <button class="ouvrir" data-id="${echapper(p.id)}">
              <strong>${echapper(p.nom)}</strong>
              <span class="discret petit">modifiée le ${dateLisible(p.modifieeLe)}</span>
            </button>
          </li>`).join('')}
      </ul>`}
    </section>`;

  $('#form-nouvelle').addEventListener('submit', async e => {
    e.preventDefault();
    const nom = $('#nom-nouvelle').value.trim();
    if (!nom) return;
    const maintenant = new Date().toISOString();
    const partie = { id: nouvelId(), nom, notes: '', creeeLe: maintenant, modifieeLe: maintenant };
    await Stockage.enregistrerPartie(partie);
    afficherPartie(partie.id);
  });
  vue.querySelectorAll('.ouvrir').forEach(b => b.addEventListener('click', () => afficherPartie(b.dataset.id)));
  verifierRappel();
}

/* ---------- Vue : une partie ---------- */

async function afficherPartie(id) {
  const partie = await Stockage.lirePartie(id);
  if (!partie) return afficherParties();
  partieOuverte = id;
  choisirOnglet('parties');
  $('#titre-vue').textContent = partie.nom;
  $('#btn-retour').hidden = false;

  const enregistrerPartie = async () => {
    partie.modifieeLe = new Date().toISOString();
    await Stockage.enregistrerPartie(partie);
  };
  const abandonnerQuete = async () => {
    if (!confirm('Abandonner la quête en cours ? Les héros, portes et cases dévoilées seront effacés (les notes restent).')) return;
    delete partie.quete; delete partie.etat;
    await enregistrerPartie();
    afficherPartie(id);
  };

  // Quête en cours : écran de jeu plein écran (sans en-tête ni onglets, sans défilement).
  if (partie.quete && partie.etat?.ordre && !besoinRepartition(partie)) {
    document.body.classList.add('mode-jeu');
    vue.innerHTML = '<div id="zone-plateau" class="zone-jeu"></div>';
    const caracs = await lireCaracs();
    const cartesTresor = await Stockage.lireReglage('cartesTresor') || [];
    const imagePlateau = await Stockage.lireReglage('imagePlateau') || null;
    const themePlateau = await Stockage.lireReglage('themePlateau') || 'pierre';
    VuePlateau.monter($('#zone-plateau'), partie, enregistrerPartie, {
      quitter: afficherParties, abandonner: abandonnerQuete, caracs, cartesTresor, imagePlateau, themePlateau,
      terminer: async issue => {
        if (!confirm(`Terminer la quête : ${issue === 'reussie' ? 'réussie' : 'échouée'} ?\nL’or et l’inventaire de chaque héros seront enregistrés dans son personnage.`)) return;
        const morts = await Heros.terminerQuete(partie, issue);
        delete partie.quete; delete partie.etat;
        await enregistrerPartie();
        await afficherPartie(id);
        bandeau(`${issue === 'reussie' ? 'Quête réussie !' : 'Quête échouée.'} Or et inventaires enregistrés.`
          + (morts.length ? ` ☠ ${morts.map(echapper).join(', ')} ${morts.length > 1 ? 'sont morts' : 'est mort'}.` : ''),
          [{ texte: 'OK', action: () => bandeau(null) }]);
      },
      reglages: () => afficherAPropos(),
    });
    return;
  }
  document.body.classList.remove('mode-jeu');

  vue.innerHTML = `
    <section class="carte carte-plateau">
      <h2>${partie.quete ? echapper(partie.quete.titre) : 'Plateau'}</h2>
      <div id="zone-plateau">
        ${partie.quete ? '' : `
          <p class="discret">Aucune quête en cours dans cette partie.</p>
          <div class="ligne">
            <button id="btn-demo" class="principal">Commencer la quête de démonstration</button>
            <button id="btn-ouvrir-quete">Ouvrir une quête (fichier)…</button>
          </div>
          <p class="discret petit">Une quête au format du Compagnon (fichier .json), par exemple depuis l’app Fichiers.
            Elle est copiée dans cette partie et reste sur cet iPad.</p>
          <p id="erreurs-quete" class="erreur petit" hidden></p>`}
      </div>
      ${partie.quete ? '<div class="ligne fin-quete"><button id="btn-abandon" class="danger">Abandonner la quête</button></div>' : ''}
    </section>
    ${await Heros.carteGroupe(partie, !!partie.quete)}
    <section class="carte">
      <h2>Notes de partie</h2>
      <textarea id="notes" rows="8" placeholder="Notes libres : héros, or, quêtes terminées…">${echapper(partie.notes)}</textarea>
      <p id="etat-notes" class="discret petit">Enregistrement automatique.</p>
    </section>
    <section class="carte">
      <h2>Gérer</h2>
      <p class="discret petit">Créée le ${dateLisible(partie.creeeLe)} · modifiée le ${dateLisible(partie.modifieeLe)}</p>
      <div class="ligne">
        <button id="btn-renommer">Renommer</button>
        <button id="btn-supprimer" class="danger">Supprimer</button>
      </div>
    </section>`;

  // Plateau : démarrer la quête de démonstration, ou fixer l'ordre de jeu (puis les sorts) avant le début.
  if (partie.quete && partie.etat?.ordre) {
    choisirSorts($('#zone-plateau'), partie, async sorts => {
      partie.etat.sorts = sorts;
      await enregistrerPartie();
      afficherPartie(id);
    });
    $('#btn-abandon').addEventListener('click', abandonnerQuete);
  } else if (partie.quete) {
    // Avant le début : fixer l'ordre de jeu des héros. La quête démarre ensuite.
    choisirOrdre($('#zone-plateau'), partie, async ordre => {
      partie.etat.ordre = ordre;
      partie.etat.tour = { numero: 1, index: 0 }; // tour n° 1, premier héros de l'ordre
      await enregistrerPartie();
      afficherPartie(id);
    });
    $('#btn-abandon').addEventListener('click', abandonnerQuete);
  } else {
    // Copie de la quête dans la partie : la partie reste lisible même si la quête change plus tard.
    const demarrer = async quete => {
      partie.quete = JSON.parse(JSON.stringify(quete));
      partie.reglages = { porteeCouloir: Plateau.PORTEE_DEFAUT, ...(partie.reglages || {}) };
      const groupe = await Heros.groupeDe(partie);
      partie.etat = Plateau.etatInitial(partie.quete, Plateau.porteeDe(partie.reglages), groupe);
      // Héros de base (sans personnages du registre) : ils reçoivent l'équipement de départ des Réglages.
      if (!groupe.length) {
        const equipement = await lireEquipementDepart();
        for (const h of partie.etat.heros) h.inventaire = JSON.parse(JSON.stringify(equipement[h.classe] || []));
      }
      await enregistrerPartie();
      afficherPartie(id);
    };
    $('#btn-demo').addEventListener('click', () => demarrer(QUETE_DEMO));
    // Quête depuis un fichier : lue sur l'appareil, vérifiée, jamais envoyée ailleurs.
    const choixQuete = document.createElement('input');
    choixQuete.type = 'file'; choixQuete.accept = '.json,application/json'; choixQuete.hidden = true;
    $('#zone-plateau').appendChild(choixQuete);
    $('#btn-ouvrir-quete').addEventListener('click', () => choixQuete.click());
    choixQuete.addEventListener('change', async () => {
      const f = choixQuete.files[0];
      choixQuete.value = '';
      if (!f) return;
      const zoneErr = $('#erreurs-quete');
      const montrer = lignes => { zoneErr.innerHTML = lignes.map(echapper).join('<br>'); zoneErr.hidden = false; };
      if (f.size > 2_000_000) return montrer(['Fichier trop gros pour une quête (2 Mo au plus).']);
      let q;
      try { q = JSON.parse(await f.text()); } catch { return montrer(['Ce fichier n’est pas du JSON lisible.']); }
      const err = Plateau.verifierQuete(q);
      if (err.length) return montrer([`Quête refusée (${err.length} problème${err.length > 1 ? 's' : ''}) :`, ...err.slice(0, 12).map(e => '• ' + e), ...(err.length > 12 ? ['…'] : [])]);
      if (!q.titre) q.titre = f.name.replace(/\.json$/i, '');
      if (!q.id) q.id = 'fichier-' + Date.now();
      if (!confirm(`Commencer la quête « ${q.titre} » dans cette partie ?`)) return;
      demarrer(q);
    });
  }

  Heros.brancherGroupe(partie, enregistrerPartie);

  // Enregistre les notes peu après la dernière frappe.
  let minuterie = null;
  $('#notes').addEventListener('input', () => {
    $('#etat-notes').textContent = 'Modification…';
    clearTimeout(minuterie);
    minuterie = setTimeout(async () => {
      partie.notes = $('#notes').value;
      partie.modifieeLe = new Date().toISOString();
      await Stockage.enregistrerPartie(partie);
      $('#etat-notes').textContent = 'Enregistré sur cet iPad.';
    }, 600);
  });

  $('#btn-renommer').addEventListener('click', async () => {
    const nom = prompt('Nouveau nom de la partie :', partie.nom);
    if (!nom || !nom.trim()) return;
    partie.nom = nom.trim().slice(0, 80);
    partie.modifieeLe = new Date().toISOString();
    await Stockage.enregistrerPartie(partie);
    afficherPartie(id);
  });

  $('#btn-supprimer').addEventListener('click', async () => {
    if (!confirm(`Supprimer définitivement « ${partie.nom} » de cet iPad ?\nPensez à faire une sauvegarde avant si besoin.`)) return;
    await Stockage.supprimerPartie(id);
    afficherParties();
  });
}

/* ---------- Ordre de jeu (avant le début de la quête) ---------- */

// Affiche la liste des héros, réordonnable avec ↑ ↓ ; « Tirer au sort » mélange ;
// « Commencer la quête » valide. L'ordre ne change plus ensuite.
function choisirOrdre(conteneur, partie, valider) {
  let ordre = partie.etat.heros.map(h => h.id);
  const nom = hid => partie.etat.heros.find(h => h.id === hid).nom;

  function dessiner() {
    conteneur.innerHTML = `
      <p>Avant de commencer, fixez l’ordre dans lequel les héros joueront.
         Il restera le même pendant toute la quête ; Zargon joue après le dernier héros.</p>
      <ol class="liste-ordre">
        ${ordre.map((hid, n) => `
          <li>
            <span class="pastille h-${hid}"></span>
            <span class="nom-ordre">${n + 1}. ${echapper(nom(hid))}</span>
            <button data-monter="${n}" aria-label="Monter ${echapper(nom(hid))}" ${n === 0 ? 'disabled' : ''}>↑</button>
            <button data-descendre="${n}" aria-label="Descendre ${echapper(nom(hid))}" ${n === ordre.length - 1 ? 'disabled' : ''}>↓</button>
          </li>`).join('')}
      </ol>
      <div class="ligne">
        <button id="btn-hasard">Tirer au sort</button>
        <button id="btn-commencer" class="principal">Commencer la quête</button>
      </div>`;
    const echanger = (a, b) => { [ordre[a], ordre[b]] = [ordre[b], ordre[a]]; dessiner(); };
    conteneur.querySelectorAll('[data-monter]').forEach(b => b.addEventListener('click', () => echanger(+b.dataset.monter, +b.dataset.monter - 1)));
    conteneur.querySelectorAll('[data-descendre]').forEach(b => b.addEventListener('click', () => echanger(+b.dataset.descendre, +b.dataset.descendre + 1)));
    conteneur.querySelector('#btn-hasard').addEventListener('click', () => {
      // Mélange de Fisher-Yates : chaque ordre a la même chance.
      for (let i = ordre.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
      }
      dessiner();
    });
    conteneur.querySelector('#btn-commencer').addEventListener('click', () => valider([...ordre]));
  }
  dessiner();
}

/* ---------- Répartition des sorts (avant le début de la quête) ----------
   Règle : l'Enchanteur choisit un groupe, puis l'Elfe un groupe parmi les trois
   restants ; l'Enchanteur prend les deux derniers. Sans Elfe, l'Enchanteur choisit
   ses trois groupes ; sans Enchanteur, l'Elfe choisit le sien. */

function besoinRepartition(partie) {
  const h = partie.etat?.heros || [];
  return !partie.etat?.sorts && h.some(k => ['elfe', 'enchanteur'].includes(k.classe || k.id));
}

function choisirSorts(conteneur, partie, valider) {
  const heros = partie.etat.heros;
  const ench = heros.find(k => (k.classe || k.id) === 'enchanteur');
  const elfe = heros.find(k => (k.classe || k.id) === 'elfe');
  // Étapes : qui choisit, et combien de groupes à cette étape.
  const etapes = ench && elfe ? [['enchanteur', 1], ['elfe', 1]] : ench ? [['enchanteur', 3]] : [['elfe', 1]];
  let choix = { enchanteur: [], elfe: [] };
  let etape = 0;

  function termine() {
    if (ench && elfe) {
      const pris = [...choix.enchanteur, ...choix.elfe];
      choix.enchanteur.push(...Sorts.GROUPES.map(g => g.id).filter(g => !pris.includes(g)));
    }
    const sorts = {};
    if (ench) sorts[ench.id] = Sorts.deGroupes(choix.enchanteur);
    if (elfe) sorts[elfe.id] = Sorts.deGroupes(choix.elfe);
    return sorts;
  }

  function dessiner() {
    const fini = etape >= etapes.length;
    const [qui, combien] = fini ? [] : etapes[etape];
    const lanceur = qui === 'enchanteur' ? ench : elfe;
    const pris = [...choix.enchanteur, ...choix.elfe];
    const resultat = fini ? termine() : null;
    conteneur.innerHTML = `
      <p>Les sorts se répartissent en quatre groupes de trois. ${ench && elfe
        ? 'L’Enchanteur choisit un groupe, puis l’Elfe un groupe parmi les trois restants ; l’Enchanteur prend les deux derniers.'
        : ench ? 'Sans Elfe dans le groupe, l’Enchanteur choisit ses trois groupes.' : 'L’Elfe choisit un groupe.'}</p>
      <p class="discret petit">Suggestion des règles pour une première quête : le Feu pour l’Enchanteur, la Terre pour l’Elfe.</p>
      ${fini ? `
        <ul class="puces">${Object.entries(resultat).map(([hid, liste]) => {
          const h = heros.find(k => k.id === hid);
          return `<li><strong>${echapper(h.nom)}</strong> : ${liste.map(x => Sorts.sort(x.id).nom).join(', ')}</li>`;
        }).join('')}</ul>
        <div class="ligne"><button id="so-recommencer">Recommencer</button><button id="so-valider" class="principal">Commencer la quête</button></div>`
      : `
        <p class="question"><span class="pastille h-${lanceur.id}"></span> <strong>${echapper(lanceur.nom)}</strong> choisit
          ${combien > 1 ? `ses groupes (${choix[qui].length + 1} / ${combien})` : 'un groupe'} :</p>
        <div class="grille-groupes-sorts">
          ${Sorts.GROUPES.filter(g => !pris.includes(g.id)).map(g => `
            <button class="groupe-sort" data-groupe="${g.id}">
              <span class="titre">${g.symbole} ${g.nom}</span>
              <span class="petit">${Sorts.duGroupe(g.id).map(x => x.nom).join(' · ')}</span>
            </button>`).join('')}
        </div>
        ${pris.length ? '<div class="ligne"><button id="so-recommencer">Recommencer</button></div>' : ''}`}`;
    conteneur.querySelectorAll('[data-groupe]').forEach(b => b.addEventListener('click', () => {
      choix[qui].push(b.dataset.groupe);
      if (choix[qui].length >= combien) etape++;
      dessiner();
    }));
    conteneur.querySelector('#so-recommencer')?.addEventListener('click', () => { choix = { enchanteur: [], elfe: [] }; etape = 0; dessiner(); });
    conteneur.querySelector('#so-valider')?.addEventListener('click', () => valider(termine()));
  }
  dessiner();
}

/* ---------- Vue : sauvegardes ---------- */

async function afficherSauvegardes() {
  document.body.classList.remove('mode-jeu');
  partieOuverte = null;
  choisirOnglet('sauvegardes');
  $('#titre-vue').textContent = 'Sauvegardes';
  $('#btn-retour').hidden = true;

  const derniere = await Stockage.lireReglage('derniereSauvegarde');
  const nb = (await Stockage.listerParties()).length;

  vue.innerHTML = `
    <section class="carte">
      <h2>Sauvegarder</h2>
      <p>Crée un fichier contenant toutes vos parties (${nb}), vos héros et vos groupes. Sur l’iPad, choisissez ensuite
         « Enregistrer dans Fichiers ». Ce fichier vous appartient : il ne quitte l’iPad que si vous le déplacez.</p>
      <p class="discret petit">Dernière sauvegarde : ${dateLisible(derniere)}</p>
      <button id="btn-exporter" class="principal">Créer le fichier de sauvegarde</button>
    </section>
    <section class="carte">
      <h2>Restaurer</h2>
      <p>Ouvre un fichier de sauvegarde. Les parties qu’il contient sont ajoutées ; une partie déjà présente
         (même identifiant) est remplacée par la version du fichier, après confirmation.</p>
      <button id="btn-importer">Ouvrir un fichier…</button>
      <p id="resultat-import" class="petit"></p>
    </section>`;

  $('#btn-exporter').addEventListener('click', exporter);
  $('#btn-importer').addEventListener('click', () => $('#fichier-import').click());
}

async function exporter() {
  const maintenant = new Date().toISOString();
  const contenu = {
    format: FORMAT_SAUVEGARDE,
    versionFormat: VERSION_FORMAT,
    versionApp: VERSION_APP,
    exporteeLe: maintenant,
    parties: await Stockage.listerParties(),
    caracteristiques: await Stockage.lireReglage('caracteristiques') || null,
    personnages: await Stockage.listerPersonnages(),
    cartesTresor: await Stockage.lireReglage('cartesTresor') || [],
    equipementDepart: await Stockage.lireReglage('equipementDepart') || null,
    armurerie: await Stockage.lireReglage('armurerie') || [],
    imagePlateau: await Stockage.lireReglage('imagePlateau') || null,
    groupes: await Heros.lireGroupes(),
  };
  telechargerJson(contenu, `compagnon-sauvegarde-${maintenant.slice(0, 10)}.json`);
  await Stockage.ecrireReglage('derniereSauvegarde', maintenant);
  verifierRappel();
  if (!partieOuverte) afficherSauvegardes();
}

// Vérifie qu'une partie importée a la forme attendue ; renvoie un message d'erreur ou null.
function erreurPartie(p, i) {
  if (!p || typeof p !== 'object') return `élément n° ${i + 1} : ce n’est pas une partie`;
  if (typeof p.id !== 'string' || !p.id) return `élément n° ${i + 1} : identifiant manquant`;
  if (typeof p.nom !== 'string' || !p.nom) return `élément n° ${i + 1} : nom manquant`;
  return null;
}

async function importerFichier(fichier) {
  const sortie = $('#resultat-import');
  const dire = (texte, classe) => { if (sortie) { sortie.textContent = texte; sortie.className = 'petit ' + (classe || ''); } };
  let donnees;
  try {
    donnees = JSON.parse(await fichier.text());
  } catch {
    return dire('Ce fichier n’est pas un fichier JSON lisible.', 'erreur');
  }
  // Un fichier de héros ou de groupe ouvert ici est accepté aussi.
  if (donnees?.format === Heros.FORMAT_HEROS) {
    const r = await Heros.importer(donnees);
    return dire(r.erreur || (r.annule ? 'Ouverture annulée.' : r.succes), r.erreur ? 'erreur' : r.succes ? 'succes' : '');
  }
  // Un fichier d'armes aussi.
  if (donnees?.format === FORMAT_ARMURERIE) {
    const r = await importerArmurerie(donnees);
    return dire(r.erreur || (r.annule ? 'Ouverture annulée.' : r.succes), r.erreur ? 'erreur' : r.succes ? 'succes' : '');
  }
  if (donnees?.format !== FORMAT_SAUVEGARDE) return dire('Ce fichier n’est pas une sauvegarde du Compagnon de quête.', 'erreur');
  if (donnees.versionFormat > VERSION_FORMAT) return dire('Cette sauvegarde vient d’une version plus récente de l’application : mettez-la à jour d’abord.', 'erreur');
  if (!Array.isArray(donnees.parties)) return dire('La sauvegarde ne contient pas de liste de parties.', 'erreur');
  const erreurs = donnees.parties.map(erreurPartie).filter(Boolean);
  if (erreurs.length) return dire('Sauvegarde abîmée : ' + erreurs.join(' ; '), 'erreur');

  const existantes = new Set((await Stockage.listerParties()).map(p => p.id));
  const remplacees = donnees.parties.filter(p => existantes.has(p.id));
  const message = `Ce fichier contient ${donnees.parties.length} partie(s), sauvegardée(s) le ${dateLisible(donnees.exporteeLe)}.`
    + (remplacees.length ? `\n${remplacees.length} existe(nt) déjà sur cet iPad et sera(ont) remplacée(s) :\n– ${remplacees.map(p => p.nom).join('\n– ')}` : '')
    + (donnees.caracteristiques ? '\nLes caractéristiques (héros et monstres) du fichier remplaceront celles de cet iPad.' : '')
    + (donnees.equipementDepart ? '\nL’équipement de départ des héros du fichier remplacera celui de cet iPad.' : '')
    + (Array.isArray(donnees.armurerie) && donnees.armurerie.length ? '\nL’armurerie du fichier remplacera celle de cet iPad.' : '')
    + (Array.isArray(donnees.personnages) && donnees.personnages.length ? `\n${donnees.personnages.length} personnage(s) du fichier seront ajoutés (ou remplacés s’ils existent déjà).` : '')
    + (Array.isArray(donnees.groupes) && donnees.groupes.length ? `\n${donnees.groupes.length} groupe(s) enregistré(s) du fichier seront ajoutés (ou remplacés s’ils existent déjà).` : '')
    + '\n\nContinuer ?';
  if (!confirm(message)) return dire('Restauration annulée.');

  for (const p of donnees.parties) {
    await Stockage.enregistrerPartie({ notes: '', creeeLe: donnees.exporteeLe, modifieeLe: donnees.exporteeLe, ...p });
  }
  for (const p of Array.isArray(donnees.personnages) ? donnees.personnages : []) {
    if (p && typeof p.id === 'string' && typeof p.nom === 'string') await Stockage.enregistrerPersonnage(p);
  }
  if (Array.isArray(donnees.groupes) && donnees.groupes.length) {
    const recus = donnees.groupes.filter(g => g && typeof g.id === 'string' && typeof g.nom === 'string' && g.membres && typeof g.membres === 'object');
    const deja = (await Heros.lireGroupes()).filter(x => !recus.some(g => g.id === x.id));
    await Stockage.ecrireReglage('groupes', [...deja, ...recus]);
  }
  if (Array.isArray(donnees.cartesTresor) && donnees.cartesTresor.length) await Stockage.ecrireReglage('cartesTresor', donnees.cartesTresor);
  if (donnees.equipementDepart && typeof donnees.equipementDepart === 'object') await Stockage.ecrireReglage('equipementDepart', donnees.equipementDepart);
  if (Array.isArray(donnees.armurerie) && donnees.armurerie.length)
    await ecrireArmurerie(donnees.armurerie.map(Inventaire.nettoyerArme).filter(Boolean));
  if (typeof donnees.imagePlateau?.donnees === 'string' && donnees.imagePlateau.donnees.startsWith('data:image/'))
    await Stockage.ecrireReglage('imagePlateau', donnees.imagePlateau);
  if (donnees.caracteristiques && typeof donnees.caracteristiques === 'object') {
    await Stockage.ecrireReglage('caracteristiques', donnees.caracteristiques);
  }
  dire(`${donnees.parties.length} partie(s) restaurée(s)${donnees.caracteristiques ? ', caractéristiques comprises' : ''}.`, 'succes');
}

$('#fichier-import').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = ''; // permet de rouvrir le même fichier
  if (f) await importerFichier(f);
});

/* ---------- Vue : à propos ---------- */

async function afficherAPropos() {
  document.body.classList.remove('mode-jeu');
  partieOuverte = null;
  choisirOnglet('apropos');
  $('#titre-vue').textContent = 'Réglages';
  $('#btn-retour').hidden = true;

  let persistant = null;
  try { persistant = navigator.storage?.persisted ? await navigator.storage.persisted() : null; } catch { }
  const installee = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  const caracs = await lireCaracs();
  const cartes = await Stockage.lireReglage('cartesTresor') || [];
  const equipement = await lireEquipementDepart();
  const armes = await lireArmurerie();
  const imagePlateau = await Stockage.lireReglage('imagePlateau') || null;
  const themePlateau = await Stockage.lireReglage('themePlateau') || 'pierre';
  vue.innerHTML = `
    ${formulaireCaracs(caracs)}
    ${formulaireArmurerie(armes)}
    ${formulaireEquipement(equipement)}
    ${formulaireImagePlateau(imagePlateau, themePlateau)}
    ${formulaireCartes(cartes)}
    <section class="carte">
      <h2>Compagnon de quête ${VERSION_APP}</h2>
      <p>Application personnelle, à usage familial. Elle ne contient aucun texte, aucune illustration
         ni aucun logo officiel.</p>
      <p>Pictogrammes : <strong>game-icons.net</strong>, licence Creative Commons BY 3.0.
         Auteurs : Delapouite, Lorc et Skoll
         (détail dans le fichier CREDITS.md du code). Fond retiré et couleurs adaptées.</p>
    </section>
    <section class="carte">
      <h2>Vos données</h2>
      <ul class="puces">
        <li>Toutes les parties sont enregistrées <strong>uniquement sur cet appareil</strong>.</li>
        <li>L’application n’envoie rien sur Internet : pas de compte, pas de statistiques, pas de serveur.</li>
        <li>Seul le code de l’application est publié sur GitHub ; vos parties et vos quêtes n’y vont jamais.</li>
      </ul>
      <p class="petit">Installée sur l’écran d’accueil : <strong>${installee ? 'oui' : 'non'}</strong>
        ${installee ? '' : '— dans Safari : bouton Partager, puis « Sur l’écran d’accueil ».'}</p>
      <p class="petit">Stockage protégé contre l’effacement automatique :
        <strong>${persistant === true ? 'oui' : persistant === false ? 'non garanti' : 'inconnu'}</strong>.
        Dans tous les cas, faites des sauvegardes régulières.</p>
    </section>
    <section class="carte">
      <h2>Mises à jour</h2>
      <button id="btn-maj">Rechercher une mise à jour</button>
      <p id="etat-maj" class="discret petit"></p>
    </section>`;

  brancherCaracs(caracs);
  brancherArmurerie(armes);
  brancherEquipement(equipement);
  brancherImagePlateau(imagePlateau);
  brancherCartes(cartes);

  $('#btn-maj').addEventListener('click', async () => {
    const etat = $('#etat-maj');
    if (!('serviceWorker' in navigator)) return (etat.textContent = 'Mises à jour automatiques indisponibles ici.');
    etat.textContent = 'Recherche…';
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
      etat.textContent = reg?.waiting || reg?.installing ? 'Une mise à jour arrive : un bandeau va s’afficher.' : 'Vous avez la dernière version.';
    } catch {
      etat.textContent = 'Impossible de vérifier (pas de connexion ?).';
    }
  });
}

/* ---------- Caractéristiques (saisies d'après vos cartes) ---------- */

async function lireCaracs() {
  const c = await Stockage.lireReglage('caracteristiques');
  const vide = Regles.caracsVides();
  // Complète avec les types éventuellement ajoutés dans une version plus récente.
  return { heros: { ...vide.heros, ...(c?.heros || {}) }, monstres: { ...vide.monstres, ...(c?.monstres || {}) } };
}

function tableCaracs(caracs, famille, types, champs) {
  return `
    <div class="tableau-defilant">
      <table class="caracs">
        <thead><tr><th></th>${champs.map(c => `<th>${c.nom}</th>`).join('')}</tr></thead>
        <tbody>
          ${types.map(t => `<tr><th>${echapper(t.nom)}</th>${champs.map(c => {
            const v = Regles.valeur(caracs, famille, t.id, c.id);
            return `<td><input type="number" inputmode="numeric" min="0" max="20" step="1"
                      data-famille="${famille}" data-type="${t.id}" data-champ="${c.id}"
                      value="${v ?? ''}" aria-label="${echapper(t.nom)} — ${c.nom}"></td>`;
          }).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function formulaireCaracs(caracs) {
  const nbManquantes = [...Regles.TYPES_HEROS.map(t => Regles.manquantes(caracs, 'heros', t.id).length),
    ...Regles.TYPES_MONSTRES_REGLES.map(t => Regles.manquantes(caracs, 'monstres', t.id).length)].reduce((a, b) => a + b, 0);
  return `
    <section class="carte">
      <h2>Caractéristiques</h2>
      <p>Recopiez ici les valeurs de vos cartes de héros et du tableau des monstres (paravent de Zargon).
         Elles restent sur cet iPad et sont incluses dans vos fichiers de sauvegarde.</p>
      <p id="etat-caracs" class="petit ${nbManquantes ? 'erreur' : 'succes'}">${nbManquantes ? `${nbManquantes} valeur(s) à remplir.` : 'Toutes les valeurs sont remplies.'}</p>
      <h3>Héros</h3>
      ${tableCaracs(caracs, 'heros', Regles.TYPES_HEROS, Regles.CHAMPS_HEROS)}
      <h3>Monstres</h3>
      ${tableCaracs(caracs, 'monstres', Regles.TYPES_MONSTRES_REGLES, Regles.CHAMPS_MONSTRES)}
      <p class="discret petit">Le Sorcier de la Terreur n’est pas dans ce tableau : sa figurine représente des personnages
         différents selon les quêtes, qui donnent leurs propres caractéristiques.</p>
      <p class="discret petit">Les nouvelles valeurs s’appliquent aux quêtes commencées ensuite.
         Pour une quête en cours, corrigez les points de Vie depuis la fiche du héros.</p>
    </section>`;
}

function brancherCaracs(caracs) {
  vue.querySelectorAll('input[data-famille]').forEach(inp => inp.addEventListener('change', async () => {
    const { famille, type, champ } = inp.dataset;
    const n = inp.value === '' ? null : Math.max(0, Math.min(20, Math.round(Number(inp.value))));
    caracs[famille][type] = { ...(caracs[famille][type] || {}) };
    if (n === null || !Number.isFinite(n)) delete caracs[famille][type][champ];
    else { caracs[famille][type][champ] = n; inp.value = n; }
    await Stockage.ecrireReglage('caracteristiques', caracs);
    const reste = [...Regles.TYPES_HEROS.map(t => Regles.manquantes(caracs, 'heros', t.id).length),
      ...Regles.TYPES_MONSTRES_REGLES.map(t => Regles.manquantes(caracs, 'monstres', t.id).length)].reduce((a, b) => a + b, 0);
    const etat = $('#etat-caracs');
    etat.textContent = reste ? `Enregistré. ${reste} valeur(s) à remplir.` : 'Enregistré. Toutes les valeurs sont remplies.';
    etat.className = 'petit ' + (reste ? 'erreur' : 'succes');
  }));
}

/* ---------- Équipement de départ des héros (saisi d'après vos cartes) ----------
   Par classe, un inventaire au format d'inventaire.js (arme active, armure, autres objets).
   Copié dans l'inventaire de chaque nouveau personnage de la classe (onglet Héros) ;
   un bouton de la fiche d'un personnage permet aussi de le lui ajouter. */

async function lireEquipementDepart() {
  const e = await Stockage.lireReglage('equipementDepart');
  const res = {};
  for (const t of Regles.TYPES_HEROS) res[t.id] = Array.isArray(e?.[t.id]) ? e[t.id] : [];
  return res;
}

function blocEquipement(equipement, classe) {
  return Inventaire.html(equipement[classe], { classe });
}

function formulaireEquipement(equipement) {
  return `
    <section class="carte">
      <h2>Équipement de départ</h2>
      <p>Pour chaque héros : son arme en main, ses pièces d’armure et ses autres objets au début de l’aventure,
         d’après vos cartes. Ils sont donnés à chaque nouveau personnage de la classe (onglet Héros) ;
         la fiche d’un personnage existant a un bouton pour les lui ajouter.</p>
      <p id="etat-equipement" class="discret petit">Enregistrement automatique.</p>
      ${Regles.TYPES_HEROS.map(t => `
        <details class="equipement-classe">
          <summary><span class="pastille h-${t.id}"></span> ${echapper(t.nom)}
            <span class="discret petit">${resumeEquipement(equipement[t.id])}</span></summary>
          <div data-equipement="${t.id}">${blocEquipement(equipement, t.id)}</div>
        </details>`).join('')}
    </section>`;
}

function resumeEquipement(inv) {
  const { arme, armures, autres } = Inventaire.tri(inv);
  const n = (arme ? 1 : 0) + armures.length + autres.length;
  return n ? `· ${n} élément${n > 1 ? 's' : ''}` : '· rien';
}

function brancherEquipement(equipement) {
  vue.querySelectorAll('[data-equipement]').forEach(zone => {
    const classe = zone.dataset.equipement;
    const nom = Regles.TYPES_HEROS.find(t => t.id === classe)?.nom || classe;
    const brancher = () => Inventaire.brancher(zone, async fn => {
      fn(equipement[classe]);
      await Stockage.ecrireReglage('equipementDepart', equipement);
      zone.innerHTML = blocEquipement(equipement, classe);
      zone.closest('details').querySelector('summary .petit').textContent = resumeEquipement(equipement[classe]);
      $('#etat-equipement').textContent = `Enregistré (${nom}).`;
      brancher();
    }, nom);
    brancher();
  });
}

/* ---------- Armurerie (armes saisies ou importées d'un fichier personnel, v0.30.0) ----------
   Rien d'officiel dans le code : les noms, dés, prix et capacités viennent des cartes de l'utilisateur.
   Le catalogue sert à remplir les inventaires (copie) ; il servira aussi à une future boutique. */

const FORMAT_ARMURERIE = 'compagnon-hq/armurerie';

async function lireArmurerie() {
  const a = await Stockage.lireReglage('armurerie');
  const liste = (Array.isArray(a) ? a : []).map(Inventaire.nettoyerArme).filter(Boolean);
  Inventaire.definirArmurerie(liste);
  return liste;
}

async function ecrireArmurerie(liste) {
  await Stockage.ecrireReglage('armurerie', liste);
  Inventaire.definirArmurerie(liste);
}

function resumeArme(a) {
  const morceaux = [];
  morceaux.push(Number.isFinite(a.des) ? `${a.des} dé${a.des > 1 ? 's' : ''}` : 'dés ?');
  if (Number.isFinite(a.prix)) morceaux.push(`${a.prix} po`);
  const cap = Inventaire.etiquettes(a);
  if (cap.length) morceaux.push(cap.join(', ').toLowerCase());
  if (a.interdits?.length) morceaux.push('interdite : ' + a.interdits.map(c => Regles.TYPES_HEROS.find(t => t.id === c)?.nom || c).join(', '));
  return morceaux.join(' · ');
}

function formulaireArmurerie(armes) {
  return `
    <section class="carte">
      <h2>Armurerie</h2>
      <p>Les armes du jeu, d’après vos cartes : dés d’attaque, prix et capacités. On les prend ensuite
         dans l’inventaire d’un héros (fiche, onglet Héros, équipement de départ). Elles restent sur cet iPad.</p>
      <p class="discret petit">${armes.length} arme(s). Capacités appliquées en combat : diagonale, tir à distance
        (pas sur un monstre voisin), arme lancée (perdue ensuite), deux mains (le bouclier ne compte pas).</p>
      ${armes.length ? `<div class="tableau-defilant"><table class="caracs"><thead><tr><th>Arme</th><th>Détails</th><th></th></tr></thead><tbody>
        ${armes.map((a, k) => `<tr><td>${echapper(a.nom)}${a.note ? `<br><span class="discret petit">${echapper(a.note)}</span>` : ''}</td>
          <td class="petit">${echapper(resumeArme(a))}</td>
          <td><button class="petit-bouton" data-modifier-arme="${k}">Modifier</button>
            <button class="icone petit-bouton" data-retirer-arme="${k}" aria-label="Retirer">✕</button></td></tr>`).join('')}
      </tbody></table></div>` : ''}
      <form id="form-arme" class="grille-champs">
        <input id="ar-index" type="hidden" value="">
        <label class="champ-perso"><span>Nom</span><input id="ar-nom" type="text" maxlength="60" placeholder="ex. Épée courte" required></label>
        <label class="champ-perso"><span>Dés d’attaque</span><input id="ar-des" type="number" inputmode="numeric" min="0" max="12"></label>
        <label class="champ-perso"><span>Prix (pièces d’or)</span><input id="ar-prix" type="number" inputmode="numeric" min="0" max="99999"></label>
        <div class="cases-armurerie"><span class="petit">Capacités</span>
          ${Inventaire.CAPACITES.map(c => `<label class="petit" title="${echapper(c.aide)}"><input type="checkbox" data-ar-cap="${c.id}"> ${c.court}</label>`).join('')}</div>
        <div class="cases-armurerie"><span class="petit">Interdite à</span>
          ${Regles.TYPES_HEROS.map(t => `<label class="petit"><input type="checkbox" data-ar-interdit="${t.id}"> ${echapper(t.nom)}</label>`).join('')}</div>
        <label class="champ-perso large"><span>Note (facultatif)</span><input id="ar-note" type="text" maxlength="200"></label>
        <button type="submit" id="ar-valider">Ajouter l’arme</button>
        <button type="button" id="ar-annuler" hidden>Annuler la modification</button>
      </form>
      <p class="choix">
        <button id="ar-ouvrir">Ouvrir un fichier d’armes…</button>
        <button id="ar-exporter"${armes.length ? '' : ' disabled'}>Exporter l’armurerie</button>
        <input id="ar-fichier" type="file" accept=".json,application/json" hidden>
      </p>
      <p id="etat-armurerie" class="petit"></p>
    </section>`;
}

function brancherArmurerie(armes) {
  const etat = (t, c = '') => { $('#etat-armurerie').textContent = t; $('#etat-armurerie').className = 'petit ' + c; };
  const remplir = a => {
    $('#ar-nom').value = a?.nom || '';
    $('#ar-des').value = Number.isFinite(a?.des) ? a.des : '';
    $('#ar-prix').value = Number.isFinite(a?.prix) ? a.prix : '';
    $('#ar-note').value = a?.note || '';
    vue.querySelectorAll('[data-ar-cap]').forEach(c => { c.checked = !!a?.[c.dataset.arCap]; });
    vue.querySelectorAll('[data-ar-interdit]').forEach(c => { c.checked = !!a?.interdits?.includes(c.dataset.arInterdit); });
  };
  $('#form-arme').addEventListener('submit', async e => {
    e.preventDefault();
    const k = $('#ar-index').value;
    const brut = { id: k !== '' ? armes[+k]?.id : undefined, nom: $('#ar-nom').value, des: $('#ar-des').value, prix: $('#ar-prix').value, note: $('#ar-note').value,
      interdits: [...vue.querySelectorAll('[data-ar-interdit]:checked')].map(c => c.dataset.arInterdit) };
    vue.querySelectorAll('[data-ar-cap]').forEach(c => { if (c.checked) brut[c.dataset.arCap] = true; });
    const a = Inventaire.nettoyerArme(brut);
    if (!a) return;
    if (k !== '' && armes[+k]) armes[+k] = a; else armes.push(a);
    await ecrireArmurerie(armes);
    afficherAPropos();
  });
  vue.querySelectorAll('[data-modifier-arme]').forEach(b => b.addEventListener('click', () => {
    const k = +b.dataset.modifierArme;
    $('#ar-index').value = k; remplir(armes[k]);
    $('#ar-valider').textContent = 'Enregistrer la modification'; $('#ar-annuler').hidden = false;
    $('#ar-nom').focus();
  }));
  $('#ar-annuler').addEventListener('click', () => {
    $('#ar-index').value = ''; remplir(null);
    $('#ar-valider').textContent = 'Ajouter l’arme'; $('#ar-annuler').hidden = true;
  });
  vue.querySelectorAll('[data-retirer-arme]').forEach(b => b.addEventListener('click', async () => {
    const a = armes[+b.dataset.retirerArme];
    if (!confirm(`Retirer « ${a.nom} » de l’armurerie ? (Les héros qui la portent la gardent.)`)) return;
    armes.splice(+b.dataset.retirerArme, 1);
    await ecrireArmurerie(armes);
    afficherAPropos();
  }));
  $('#ar-exporter').addEventListener('click', () => {
    const maintenant = new Date().toISOString();
    telechargerJson({ format: FORMAT_ARMURERIE, versionFormat: 1, versionApp: VERSION_APP, exporteLe: maintenant, armes },
      `armurerie-${maintenant.slice(0, 10)}.prive.json`);
  });
  $('#ar-ouvrir').addEventListener('click', () => $('#ar-fichier').click());
  $('#ar-fichier').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let donnees;
    try { donnees = JSON.parse(await f.text()); } catch { return etat('Ce fichier n’est pas un fichier JSON lisible.', 'erreur'); }
    const r = await importerArmurerie(donnees);
    if (r.erreur) return etat(r.erreur, 'erreur');
    if (r.annule) return etat('Ouverture annulée.');
    await afficherAPropos();
    $('#etat-armurerie').textContent = r.succes; $('#etat-armurerie').className = 'petit succes';
  });
}

/* Fichier d'armes (format compagnon-hq/armurerie v1) : les armes de même identifiant (ou, à défaut,
   de même nom) sont remplacées, les autres ajoutées, après confirmation. */
async function importerArmurerie(donnees) {
  if (donnees?.format !== FORMAT_ARMURERIE) return { erreur: 'Ce fichier n’est pas un fichier d’armes du Compagnon de quête.' };
  if (donnees.versionFormat > 1) return { erreur: 'Ce fichier vient d’une version plus récente de l’application : mettez-la à jour d’abord.' };
  if (!Array.isArray(donnees.armes)) return { erreur: 'Le fichier ne contient pas de liste d’armes.' };
  const recues = donnees.armes.map(Inventaire.nettoyerArme).filter(Boolean);
  const refusees = donnees.armes.length - recues.length;
  if (!recues.length) return { erreur: 'Aucune arme utilisable dans ce fichier (il faut au moins un nom).' };
  const armes = await lireArmurerie();
  const meme = (x, y) => x.id === y.id || x.nom.toLowerCase() === y.nom.toLowerCase();
  const remplacees = recues.filter(a => armes.some(b => meme(a, b)));
  if (!confirm(`Ce fichier contient ${recues.length} arme(s).`
    + (remplacees.length ? `\n${remplacees.length} existe(nt) déjà et sera(ont) remplacée(s) :\n– ${remplacees.map(a => a.nom).join('\n– ')}` : '')
    + (refusees ? `\n${refusees} élément(s) sans nom seront ignorés.` : '')
    + '\n\nContinuer ?')) return { annule: true };
  const garde = armes.filter(b => !recues.some(a => meme(a, b)));
  await ecrireArmurerie([...garde, ...recues]);
  return { succes: `${recues.length} arme(s) ajoutée(s) ou remplacée(s) dans l’armurerie.` };
}

/* ---------- Image du plateau (photo ou scan personnel, reste sur l'appareil) ----------
   L'image est réduite (2400 px de large au plus) et enregistrée dans IndexedDB.
   Les marges (en % de l'image) indiquent où se trouve le quadrillage de 26 × 19 cases. */

const MARGES_PLATEAU = [['gauche', 'Gauche'], ['haut', 'Haut'], ['droite', 'Droite'], ['bas', 'Bas']];

function formulaireImagePlateau(img, theme) {
  return `
    <section class="carte">
      <h2>Apparence du plateau</h2>
      <label class="champ-perso large"><span>Plateau dessiné par l’application</span>
        <select id="theme-plateau">
          <option value="pierre" ${theme === 'pierre' ? 'selected' : ''}>Pierre et couleurs (dalles claires, une couleur par pièce)</option>
          <option value="classique" ${theme === 'classique' ? 'selected' : ''}>Classique (sombre et uni)</option>
        </select></label>
      <p class="discret petit">Une image de votre plateau (ci-dessous), si vous en chargez une, remplace ce dessin
         pour les quêtes sur le plateau du jeu de base.</p>
      <h3>Image du plateau</h3>
      <p>Une photo ou un scan de votre plateau, affiché sous les pions pendant le jeu (seulement pour les quêtes
         sur le plateau du jeu de base, 26 × 19 cases). L’image reste sur cet iPad.</p>
      <div class="ligne">
        <button id="img-choisir">${img?.donnees ? 'Remplacer l’image…' : 'Choisir une image…'}</button>
        ${img?.donnees ? '<button id="img-retirer" class="danger">Retirer l’image</button>' : ''}
      </div>
      <p id="img-etat" class="discret petit"></p>
      ${img?.donnees ? `
        <p class="petit">Ajustez les marges (en % de l’image) pour que la grille rouge tombe sur les cases du plateau :</p>
        <div class="grille-champs">
          ${MARGES_PLATEAU.map(([cle, nom]) => `<label class="champ-perso"><span>${nom} (%)</span>
            <input type="number" inputmode="decimal" step="0.1" min="0" max="45" data-marge="${cle}" value="${img[cle] ?? 0}"></label>`).join('')}
        </div>
        <label class="ligne petit"><input type="checkbox" id="img-murs" ${img.murs ? 'checked' : ''}> Tracer aussi les murs de l’application par-dessus l’image</label>
        <div class="apercu-plateau"><svg id="img-apercu" viewBox="0 0 1040 760" preserveAspectRatio="xMidYMid meet"></svg></div>` : ''}
    </section>`;
}

// Réduit une image choisie par l'utilisateur et renvoie un « data URL » JPEG.
function reduireImage(fichier, largeurMax = 2400) {
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(fichier);
    const im = new Image();
    im.onload = () => {
      const r = Math.min(1, largeurMax / im.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(im.naturalWidth * r); c.height = Math.round(im.naturalHeight * r);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok(c.toDataURL('image/jpeg', 0.85));
    };
    im.onerror = () => { URL.revokeObjectURL(url); ko(new Error('image illisible')); };
    im.src = url;
  });
}

// Aperçu : l'image placée comme en jeu, avec la grille de 26 × 19 cases en rouge.
function dessinerApercuPlateau(img) {
  const svg = $('#img-apercu');
  if (!svg || !img?.donnees) return;
  const T = 40, L = 26, H = 19;
  const g0 = (img.gauche || 0) / 100, d0 = (img.droite || 0) / 100, h0 = (img.haut || 0) / 100, b0 = (img.bas || 0) / 100;
  const largeur = (L * T) / Math.max(0.05, 1 - g0 - d0), hauteur = (H * T) / Math.max(0.05, 1 - h0 - b0);
  let html = `<image href="${img.donnees}" x="${-g0 * largeur}" y="${-h0 * hauteur}" width="${largeur}" height="${hauteur}" preserveAspectRatio="none"/>`;
  for (let x = 0; x <= L; x++) html += `<line class="grille-apercu" x1="${x * T}" y1="0" x2="${x * T}" y2="${H * T}"/>`;
  for (let y = 0; y <= H; y++) html += `<line class="grille-apercu" x1="0" y1="${y * T}" x2="${L * T}" y2="${y * T}"/>`;
  svg.innerHTML = html;
}

function brancherImagePlateau(img) {
  const etat = $('#img-etat');
  $('#theme-plateau').addEventListener('change', async () => {
    await Stockage.ecrireReglage('themePlateau', $('#theme-plateau').value);
    etat.textContent = 'Apparence enregistrée.';
  });
  const choix = document.createElement('input');
  choix.type = 'file'; choix.accept = 'image/*'; choix.hidden = true;
  vue.appendChild(choix);
  $('#img-choisir').addEventListener('click', () => choix.click());
  choix.addEventListener('change', async () => {
    const f = choix.files[0];
    choix.value = '';
    if (!f) return;
    etat.textContent = 'Préparation de l’image…';
    try {
      const donnees = await reduireImage(f);
      const nouvelle = { gauche: 0, haut: 0, droite: 0, bas: 0, murs: false, ...(img || {}), donnees };
      await Stockage.ecrireReglage('imagePlateau', nouvelle);
      afficherAPropos();
    } catch {
      etat.textContent = 'Cette image n’a pas pu être lue.';
    }
  });
  $('#img-retirer')?.addEventListener('click', async () => {
    if (!confirm('Retirer l’image du plateau ?')) return;
    await Stockage.ecrireReglage('imagePlateau', null);
    afficherAPropos();
  });
  if (!img?.donnees) return;
  dessinerApercuPlateau(img);
  vue.querySelectorAll('[data-marge]').forEach(inp => inp.addEventListener('input', async () => {
    const v = Number(inp.value);
    img[inp.dataset.marge] = Number.isFinite(v) ? Math.max(0, Math.min(45, v)) : 0;
    dessinerApercuPlateau(img);
    await Stockage.ecrireReglage('imagePlateau', img);
    etat.textContent = 'Enregistré.';
  }));
  $('#img-murs').addEventListener('change', async () => {
    img.murs = $('#img-murs').checked;
    await Stockage.ecrireReglage('imagePlateau', img);
    etat.textContent = 'Enregistré.';
  });
}

/* ---------- Cartes trésor (pioche virtuelle, saisie d'après vos cartes) ---------- */

const TYPES_CARTES = [
  { id: 'or', nom: 'Pièces d’or' }, { id: 'potion', nom: 'Potion' }, { id: 'objet', nom: 'Objet' },
  { id: 'errant', nom: 'Monstre errant' }, { id: 'danger', nom: 'Danger' }, { id: 'rien', nom: 'Rien' },
];

function formulaireCartes(cartes) {
  const total = cartes.reduce((t, c) => t + (c.nombre || 1), 0);
  return `
    <section class="carte">
      <h2>Cartes trésor</h2>
      <p>La pioche virtuelle utilise ces cartes. Recopiez les vôtres si vous voulez que l’application pioche ;
         sinon, en jeu, vous pourrez toujours indiquer la vraie carte piochée. Elles restent sur cet iPad.</p>
      <p class="discret petit">${total} carte(s) dans la pioche. « Valeur » : pièces d’or (or), points de Vie perdus (danger) ou rendus (potion).
        Or, potions et objets sortent de la pioche jusqu’à la quête suivante ; les autres y retournent.</p>
      ${cartes.length ? `<div class="tableau-defilant"><table class="caracs"><thead><tr><th>Nom</th><th>Type</th><th>Valeur</th><th>Nombre</th><th></th></tr></thead><tbody>
        ${cartes.map((c, k) => `<tr><td>${echapper(c.nom || '')}${c.texte ? `<br><span class="discret petit">${echapper(c.texte)}</span>` : ''}</td>
          <td>${TYPES_CARTES.find(t => t.id === c.type)?.nom || c.type}</td><td>${c.valeur ?? ''}</td><td>${c.nombre || 1}</td>
          <td><button class="icone petit-bouton" data-retirer-carte="${k}" aria-label="Retirer">✕</button></td></tr>`).join('')}
      </tbody></table></div>` : ''}
      <form id="form-carte" class="grille-champs">
        <label class="champ-perso"><span>Nom</span><input id="ct-nom" type="text" maxlength="60" placeholder="ex. Potion de soin" required></label>
        <label class="champ-perso"><span>Type</span><select id="ct-type" class="choix-classe">${TYPES_CARTES.map(t => `<option value="${t.id}">${t.nom}</option>`).join('')}</select></label>
        <label class="champ-perso"><span>Valeur</span><input id="ct-valeur" type="number" inputmode="numeric" min="0" max="999"></label>
        <label class="champ-perso"><span>Nombre</span><input id="ct-nombre" type="number" inputmode="numeric" min="1" max="20" value="1"></label>
        <label class="champ-perso large"><span>Texte (facultatif)</span><input id="ct-texte" type="text" maxlength="200"></label>
        <button type="submit">Ajouter la carte</button>
      </form>
    </section>`;
}

function brancherCartes(cartes) {
  $('#form-carte').addEventListener('submit', async e => {
    e.preventDefault();
    const nom = $('#ct-nom').value.trim();
    if (!nom) return;
    const v = parseInt($('#ct-valeur').value, 10), n = parseInt($('#ct-nombre').value, 10);
    cartes.push({ nom: nom.slice(0, 60), type: $('#ct-type').value, valeur: Number.isFinite(v) ? v : null,
      nombre: Number.isFinite(n) ? Math.max(1, Math.min(20, n)) : 1, texte: $('#ct-texte').value.trim().slice(0, 200) });
    await Stockage.ecrireReglage('cartesTresor', cartes);
    afficherAPropos();
  });
  vue.querySelectorAll('[data-retirer-carte]').forEach(b => b.addEventListener('click', async () => {
    cartes.splice(+b.dataset.retirerCarte, 1);
    await Stockage.ecrireReglage('cartesTresor', cartes);
    afficherAPropos();
  }));
}

/* ---------- Rappel de sauvegarde ---------- */

async function verifierRappel() {
  const nb = (await Stockage.listerParties()).length;
  const derniere = await Stockage.lireReglage('derniereSauvegarde');
  if (nb > 0 && joursDepuis(derniere) > JOURS_RAPPEL) {
    bandeau(derniere ? `Dernière sauvegarde il y a plus de ${JOURS_RAPPEL} jours.` : 'Aucune sauvegarde n’a encore été faite.',
      [{ texte: 'Sauvegarder', action: afficherSauvegardes }, { texte: 'Plus tard', action: () => bandeau(null) }]);
  } else if (!$('#bandeau').dataset.maj) {
    bandeau(null);
  }
}

/* ---------- Hors ligne et mises à jour ---------- */

async function preparerHorsLigne() {
  // Demande au système de ne pas effacer les données de l'application.
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { }
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
    const proposer = w => {
      $('#bandeau').dataset.maj = '1';
      bandeau('Nouvelle version disponible.', [{ texte: 'Mettre à jour', action: () => w.postMessage('activer') }]);
    };
    if (reg.waiting && navigator.serviceWorker.controller) proposer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) proposer(w); });
    });
    // Recharge seulement lors d'une vraie mise à jour, pas lors de la toute première installation.
    let recharge = !navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!recharge) { recharge = true; location.reload(); } else recharge = true;
    });
    // Vérifie s'il existe une nouvelle version à chaque retour dans l'application.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  } catch { /* hors ligne au premier lancement : rien à faire */ }
}

/* ---------- Démarrage ---------- */

document.querySelectorAll('.onglets button').forEach(b => b.addEventListener('click', () => {
  ({ parties: afficherParties, heros: () => Heros.afficherListe(), sauvegardes: afficherSauvegardes, apropos: afficherAPropos })[b.dataset.vue]();
}));
$('#btn-retour').addEventListener('click', afficherParties);

lireArmurerie().catch(() => {}).finally(afficherParties);
verifierRappel();
preparerHorsLigne();
