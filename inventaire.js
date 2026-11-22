/* inventaire.js — Inventaire d'un héros en trois blocs (décision de l'utilisateur, 22/11/2026) :
   - Arme active : une seule ; nom, dés d'attaque, note (diagonale, à distance…) ;
   - Armure : plusieurs pièces ; nom, bonus de dés de défense, note ;
   - Autres objets : tout le reste (armes de rechange, potions, objets divers).
   Un objet reste un élément du tableau « inventaire » ; son bloc est donné par « emplacement »
   ('arme' ou 'armure' ; absent = autres objets). Les anciens inventaires restent valables.
   Les valeurs (dés, bonus) sont saisies par l'utilisateur d'après ses cartes : rien d'officiel ici.
   Utilisé par la fiche en jeu (vue-plateau.js) et par l'onglet Héros (ecran-heros.js). */
'use strict';

const Inventaire = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const estPotion = o => !!o && (o.potion || /potion/i.test(o.nom || ''));

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

  const bonusArmure = inv => tri(inv).armures.reduce((t, { o }) => t + (Number.isFinite(o.des) ? o.des : 0), 0);

  function champs(o, k, libelleDes, aide) {
    return `<div class="champs-inv">
        <input type="text" maxlength="80" data-inv-k="${k}" data-inv-champ="nom" value="${esc(o.nom)}" aria-label="Nom">
        <label class="petit">${libelleDes} <input type="number" min="0" max="12" inputmode="numeric" data-inv-k="${k}" data-inv-champ="des" value="${Number.isFinite(o.des) ? o.des : ''}" placeholder="—"></label>
        <input type="text" maxlength="120" class="note-inv" data-inv-k="${k}" data-inv-champ="note" value="${esc(o.note || '')}" placeholder="${aide}" aria-label="Note">
      </div>`;
  }

  /* HTML des trois blocs. options : { lectureSeule, peutBoire } */
  function html(inv = [], { lectureSeule = false, peutBoire = false } = {}) {
    const { arme, armures, autres } = tri(inv);
    const bonus = bonusArmure(inv);
    const boutons = (k, liste) => lectureSeule ? '' : `<span class="actions-inv">${liste.join('')}
        <button class="icone petit-bouton" data-inv-retirer="${k}" aria-label="Retirer">✕</button></span>`;
    return `
      <div class="bloc-inv">
        <h4>Arme active</h4>
        ${arme ? `<div class="ligne-inv">${champs(arme.o, arme.k, 'Dés d’attaque', 'Particularité : diagonale, à distance…')}
            ${boutons(arme.k, [`<button class="petit-bouton" data-inv-ranger="${arme.k}">Ranger</button>`])}</div>`
          : '<p class="discret petit">Aucune arme en main.</p>'}
        ${lectureSeule ? '' : '<button class="petit-bouton" data-inv-ajouter="arme">Nouvelle arme en main…</button>'}
      </div>
      <div class="bloc-inv">
        <h4>Armure${bonus ? ` <span class="discret petit">· bonus total : +${bonus} dé${bonus > 1 ? 's' : ''} de défense</span>` : ''}</h4>
        ${armures.length ? armures.map(({ o, k }) => `<div class="ligne-inv">${champs(o, k, 'Défense +', 'Note')}
            ${boutons(k, [`<button class="petit-bouton" data-inv-ranger="${k}">Ôter</button>`])}</div>`).join('')
          : '<p class="discret petit">Aucune pièce d’armure.</p>'}
        ${lectureSeule ? '' : '<button class="petit-bouton" data-inv-ajouter="armure">Ajouter une pièce d’armure…</button>'}
      </div>
      <div class="bloc-inv">
        <h4>Autres objets</h4>
        ${autres.length ? `<ul class="inventaire">${autres.map(({ o, k }) => `<li>
            <span>${esc(o.nom)}${Number.isFinite(o.soin) ? ` <span class="discret petit">(+${o.soin} Vie)</span>` : ''}${o.note ? ` <span class="discret petit">· ${esc(o.note)}</span>` : ''}</span>
            ${boutons(k, [
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

  return { tri, html, brancher, bonusArmure, estPotion };
})();
