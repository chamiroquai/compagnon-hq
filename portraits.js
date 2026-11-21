/* portraits.js — Portraits des héros et des monstres pour les fenêtres de combat.
   Portraits PAR DÉFAUT : médaillons dessinés en SVG (aucune illustration officielle).
   Plus tard, des images personnelles pourront les remplacer (enregistrées sur
   l'appareil uniquement) : Portraits.definirPersonnalises({ heros: {id: dataURL}, monstres: {type: dataURL} }). */
'use strict';

const Portraits = (() => {
  const COULEURS_HEROS = { barbare: '#b0352a', nain: '#c08a1e', elfe: '#2f8a4a', enchanteur: '#2c5aa8' };
  let personnalises = { heros: {}, monstres: {} };

  // Médaillon : fond dégradé, bordure, embleme (bouclier pour un héros, cornes pour un monstre) et initiales.
  function medaillon(couleur, initiales, monstre) {
    const embleme = monstre
      ? '<path d="M28 34 L18 12 L40 28 Z M92 34 L102 12 L80 28 Z" fill="#c8f0a0" opacity=".55"/>'
      : '<path d="M60 22 L88 32 L84 70 Q60 96 60 96 Q60 96 36 70 L32 32 Z" fill="#fff" opacity=".14"/>';
    return `<svg viewBox="0 0 120 120" class="portrait-svg" role="img" aria-hidden="true">
      <defs><radialGradient id="pg-${initiales}${monstre ? 'm' : 'h'}" cx="50%" cy="40%" r="65%">
        <stop offset="0" stop-color="${couleur}" stop-opacity="1"/><stop offset="1" stop-color="#120f0b" stop-opacity="1"/></radialGradient></defs>
      <circle cx="60" cy="60" r="56" fill="url(#pg-${initiales}${monstre ? 'm' : 'h'})" stroke="${monstre ? '#9bd16a' : '#d9a441'}" stroke-width="4"/>
      ${embleme}
      <text x="60" y="74" text-anchor="middle" font-size="40" font-weight="700" fill="#fff" font-family="-apple-system, system-ui, sans-serif">${initiales}</text>
    </svg>`;
  }

  // HTML du portrait : image personnelle si elle existe, sinon médaillon par défaut.
  function heros(id, court) {
    const img = personnalises.heros[id];
    return img ? `<img src="${img}" alt="" class="portrait-img">` : medaillon(COULEURS_HEROS[id] || '#555', court, false);
  }
  function monstre(type, court) {
    const img = personnalises.monstres[type];
    return img ? `<img src="${img}" alt="" class="portrait-img">` : medaillon('#2f3a24', court, true);
  }

  function definirPersonnalises(p) { personnalises = { heros: p?.heros || {}, monstres: p?.monstres || {} }; }

  return { heros, monstre, definirPersonnalises };
})();
