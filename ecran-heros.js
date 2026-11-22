/* ecran-heros.js — Registre des personnages (onglet « Héros ») et groupes.
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
          ${champ('Dés d’attaque', 'attaque')}
          ${champ('Dés de défense', 'defense')}
          ${champ('Pièces d’or', 'or')}
        </div>
        <p id="pf-etat" class="discret petit">Enregistrement automatique.</p>
      </section>
      <section class="carte">
        <h2>Inventaire</h2>
        <div id="pf-inventaire">${Inventaire.html(p.inventaire || [])}</div>
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
        <button id="pf-supprimer" class="danger">Supprimer ce personnage</button>
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
    $('#pf-supprimer').addEventListener('click', async () => {
      if (!confirm(`Supprimer définitivement ${p.nom} ? (Pensez à une sauvegarde.)`)) return;
      await Stockage.supprimerPersonnage(id);
      afficherListe();
    });
  }

  /* ---------- Groupe d'une partie (carte sur l'écran de la partie) ---------- */

  // HTML de la carte « Groupe » : une case par classe, un personnage vivant au choix.
  async function carteGroupe(partie, verrouille) {
    const persos = (await Stockage.listerPersonnages()).filter(p => !p.mort);
    const g = partie.groupe || {};
    return `
      <section class="carte">
        <h2>Groupe</h2>
        ${verrouille ? '<p class="discret petit">Le groupe ne change pas pendant une quête.</p>' : ''}
        <div class="grille-groupe">
          ${Regles.TYPES_HEROS.map(t => {
            const choix = persos.filter(p => p.classe === t.id);
            return `<label class="case-groupe"><span><span class="pastille h-${t.id}"></span> ${t.nom}</span>
              <select data-classe="${t.id}" ${verrouille ? 'disabled' : ''}>
                <option value="">— personne —</option>
                ${choix.map(p => `<option value="${echapper(p.id)}" ${g[t.id] === p.id ? 'selected' : ''}>${echapper(p.nom)}</option>`).join('')}
              </select></label>`;
          }).join('')}
        </div>
        ${persos.length ? '' : '<p class="discret petit">Créez d’abord des personnages dans l’onglet Héros. Sans groupe, la quête se joue avec les 4 héros de base, sans nom.</p>'}
      </section>`;
  }

  function brancherGroupe(partie, enregistrer) {
    vue.querySelectorAll('select[data-classe]').forEach(sel => sel.addEventListener('change', async () => {
      partie.groupe = { ...(partie.groupe || {}), [sel.dataset.classe]: sel.value || null };
      await enregistrer();
    }));
  }

  return { initiales, creer, groupeDe, terminerQuete, afficherListe, afficherFiche, carteGroupe, brancherGroupe };
})();
