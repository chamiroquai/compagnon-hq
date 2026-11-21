/* app.js — Interface du Compagnon de quête (étape 3 : plateau et brouillard).
   Contenu : liste des parties, notes de partie, sauvegarde et restauration
   en fichier JSON, installation hors ligne et mises à jour.
   Le plateau, les héros et les monstres arriveront aux étapes suivantes. */
'use strict';

const VERSION_APP = '0.14.0';
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
  if (partie.quete && partie.etat?.ordre) {
    document.body.classList.add('mode-jeu');
    vue.innerHTML = '<div id="zone-plateau" class="zone-jeu"></div>';
    const caracs = await lireCaracs();
    const cartesTresor = await Stockage.lireReglage('cartesTresor') || [];
    VuePlateau.monter($('#zone-plateau'), partie, enregistrerPartie, {
      quitter: afficherParties, abandonner: abandonnerQuete, caracs, cartesTresor,
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
          <button id="btn-demo" class="principal">Commencer la quête de démonstration</button>`}
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

  // Plateau : démarrer la quête de démonstration, ou fixer l'ordre de jeu avant le début.
  if (partie.quete) {
    // Avant le début : fixer l'ordre de jeu des héros. La quête démarre ensuite.
    choisirOrdre($('#zone-plateau'), partie, async ordre => {
      partie.etat.ordre = ordre;
      partie.etat.tour = { numero: 1, index: 0 }; // tour n° 1, premier héros de l'ordre
      await enregistrerPartie();
      afficherPartie(id);
    });
    $('#btn-abandon').addEventListener('click', abandonnerQuete);
  } else {
    $('#btn-demo').addEventListener('click', async () => {
      // Copie de la quête dans la partie : la partie reste lisible même si la quête change plus tard.
      partie.quete = JSON.parse(JSON.stringify(QUETE_DEMO));
      partie.reglages = { porteeCouloir: Plateau.PORTEE_DEFAUT, ...(partie.reglages || {}) };
      partie.etat = Plateau.etatInitial(partie.quete, Plateau.porteeDe(partie.reglages), await Heros.groupeDe(partie));
      await enregistrerPartie();
      afficherPartie(id);
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
      <p>Crée un fichier contenant toutes vos parties (${nb}). Sur l’iPad, choisissez ensuite
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
  };
  const blob = new Blob([JSON.stringify(contenu, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `compagnon-sauvegarde-${maintenant.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
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
    + (Array.isArray(donnees.personnages) && donnees.personnages.length ? `\n${donnees.personnages.length} personnage(s) du fichier seront ajoutés (ou remplacés s’ils existent déjà).` : '')
    + '\n\nContinuer ?';
  if (!confirm(message)) return dire('Restauration annulée.');

  for (const p of donnees.parties) {
    await Stockage.enregistrerPartie({ notes: '', creeeLe: donnees.exporteeLe, modifieeLe: donnees.exporteeLe, ...p });
  }
  for (const p of Array.isArray(donnees.personnages) ? donnees.personnages : []) {
    if (p && typeof p.id === 'string' && typeof p.nom === 'string') await Stockage.enregistrerPersonnage(p);
  }
  if (Array.isArray(donnees.cartesTresor) && donnees.cartesTresor.length) await Stockage.ecrireReglage('cartesTresor', donnees.cartesTresor);
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
  vue.innerHTML = `
    ${formulaireCaracs(caracs)}
    ${formulaireCartes(cartes)}
    <section class="carte">
      <h2>Compagnon de quête ${VERSION_APP}</h2>
      <p>Application personnelle, à usage familial. Elle ne contient aucun texte, aucune illustration
         ni aucun logo officiel.</p>
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
      <p class="discret petit">${total} carte(s) dans la pioche. « Valeur » : pièces d’or (or) ou points de Vie perdus (danger).
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

afficherParties();
verifierRappel();
preparerHorsLigne();
