/* stockage.js — Enregistrement des données sur l'appareil uniquement.
   Les parties sont rangées dans IndexedDB (base locale du navigateur).
   Rien n'est jamais envoyé sur Internet. */
'use strict';

const Stockage = (() => {
  const NOM_BASE = 'compagnon-hq';
  const VERSION_BASE = 2; // v2 : ajout du magasin « personnages »
  let basePromise = null;

  // Ouvre (ou crée) la base locale. Une seule ouverture pour toute l'application.
  function base() {
    if (!basePromise) {
      basePromise = new Promise((ok, echec) => {
        const req = indexedDB.open(NOM_BASE, VERSION_BASE);
        req.onupgradeneeded = () => {
          const db = req.result;
          // Magasin « parties » : une entrée par partie, repérée par son identifiant.
          if (!db.objectStoreNames.contains('parties')) db.createObjectStore('parties', { keyPath: 'id' });
          // Magasin « reglages » : petites valeurs diverses (date de dernière sauvegarde…).
          if (!db.objectStoreNames.contains('reglages')) db.createObjectStore('reglages');
          // Magasin « personnages » : le registre des héros durables (nom, or, inventaire…).
          if (!db.objectStoreNames.contains('personnages')) db.createObjectStore('personnages', { keyPath: 'id' });
        };
        req.onsuccess = () => ok(req.result);
        req.onerror = () => echec(req.error);
      });
    }
    return basePromise;
  }

  // Petite aide : exécute une opération dans un magasin et renvoie son résultat.
  async function operation(magasin, mode, action) {
    const db = await base();
    return new Promise((ok, echec) => {
      const tx = db.transaction(magasin, mode);
      const req = action(tx.objectStore(magasin));
      tx.oncomplete = () => ok(req ? req.result : undefined);
      tx.onerror = () => echec(tx.error);
      tx.onabort = () => echec(tx.error);
    });
  }

  return {
    listerParties: () => operation('parties', 'readonly', s => s.getAll()),
    lirePartie: id => operation('parties', 'readonly', s => s.get(id)),
    enregistrerPartie: partie => operation('parties', 'readwrite', s => s.put(partie)),
    supprimerPartie: id => operation('parties', 'readwrite', s => s.delete(id)),
    listerPersonnages: () => operation('personnages', 'readonly', s => s.getAll()),
    lirePersonnage: id => operation('personnages', 'readonly', s => s.get(id)),
    enregistrerPersonnage: p => operation('personnages', 'readwrite', s => s.put(p)),
    supprimerPersonnage: id => operation('personnages', 'readwrite', s => s.delete(id)),
    lireReglage: cle => operation('reglages', 'readonly', s => s.get(cle)),
    ecrireReglage: (cle, valeur) => operation('reglages', 'readwrite', s => s.put(valeur, cle)),
  };
})();
