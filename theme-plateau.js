/* theme-plateau.js — Thème « Pierre et couleurs » du plateau (décision de l'utilisateur, 22/11/2026).
   Inspiré de l'allure générale du plateau du jeu (dalles de pierre claires dans les couloirs,
   une couleur et un motif de sol par pièce, murs clairs avec une ombre), mais entièrement
   dessiné ici : motifs géométriques originaux, aucune partie de l'illustration officielle.
   Les couleurs sont réparties automatiquement entre les pièces (elles ne reproduisent pas
   celles du plateau réel). Pour l'aspect exact : Réglages › Image du plateau (photo personnelle). */
'use strict';

const ThemePlateau = (() => {
  // Teintes de sol des pièces (choisies pour être bien distinctes les unes des autres).
  const COULEURS = ['#c8783a', '#d9786a', '#6fb3b8', '#c0573a', '#a9b0bd', '#e0a95a', '#6f6f80', '#8fbf3e',
    '#d9a52b', '#c3c95a', '#8ec6d6', '#4f9a96', '#c9c9c4', '#8c8fb3', '#c76a4e', '#c4a043',
    '#c4878a', '#d8904a', '#7fbf4f', '#9a9184'];
  const MOTIFS = ['dalles', 'briques', 'parquet', 'pave', 'damier', 'losange', 'dalles4', 'grandes'];

  // Éclaircit (k > 0) ou assombrit (k < 0) une couleur #rrggbb.
  function nuance(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = c => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
    const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  // Petit générateur pseudo-aléatoire stable (mêmes taches à chaque dessin).
  function alea(graine) {
    let s = graine >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /* Ajoute les motifs au <defs> et renvoie la fonction remplissage(zone) → "url(#…)".
     el(nom, attributs, parent) : fabrique d'éléments SVG de vue-plateau.js ; T : taille d'une case. */
  function preparer(defs, el, T, zonesPieces) {
    const ids = new Map();
    const motif = (id, dessin) => {
      const p = el('pattern', { id, width: T, height: T, patternUnits: 'userSpaceOnUse' }, defs);
      dessin(p);
    };
    const R = (p, x, y, w, h, attrs) => el('rect', { x, y, width: w, height: h, ...attrs }, p);

    // Couloir : une dalle claire par case, bords arrondis, joint sombre, reflet.
    motif('t-couloir', p => {
      R(p, 0, 0, T, T, { fill: '#5d574b' });
      R(p, 1.5, 1.5, T - 3, T - 3, { rx: 6, fill: '#d8d0bf' });
      R(p, 6, 6, T - 12, T - 12, { rx: 5, fill: '#ece6d8', 'fill-opacity': 0.55 });
      el('path', { d: `M${T * 0.2} ${T * 0.75} q ${T * 0.25} -${T * 0.15} ${T * 0.45} ${T * 0.05}`, fill: 'none', stroke: '#8f8676', 'stroke-width': 0.8, 'stroke-opacity': 0.6 }, p);
    });

    function sol(couleur, genre) {
      const cle = couleur + genre;
      if (ids.has(cle)) return ids.get(cle);
      const id = 't-' + ids.size;
      const joint = nuance(couleur, -0.55), clair = nuance(couleur, 0.18), sombre = nuance(couleur, -0.12);
      motif(id, p => {
        R(p, 0, 0, T, T, { fill: joint });
        const q = T / 2, t4 = T / 4;
        switch (genre) {
          case 'dalles':
            R(p, 1, 1, T - 2, T - 2, { rx: 4, fill: couleur });
            R(p, 5, 5, T - 10, T - 10, { rx: 3, fill: clair, 'fill-opacity': 0.35 });
            break;
          case 'dalles4':
            for (const [x, y] of [[0, 0], [q, 0], [0, q], [q, q]]) R(p, x + 1, y + 1, q - 2, q - 2, { rx: 3, fill: (x + y) % T ? couleur : sombre });
            break;
          case 'briques':
            for (let r = 0; r < 4; r++) {
              const dec = r % 2 ? -q / 2 : 0;
              for (let k = -1; k < 3; k++) R(p, dec + k * q + 1, r * t4 + 1, q - 2, t4 - 2, { rx: 1.5, fill: (r + k) % 3 ? couleur : sombre });
            }
            break;
          case 'parquet':
            for (const [x, y, v] of [[0, 0, 0], [q, 0, 1], [0, q, 1], [q, q, 0]])
              for (let k = 0; k < 3; k++) {
                const e = q / 3;
                if (v) R(p, x + k * e + 0.8, y + 0.8, e - 1.6, q - 1.6, { fill: k % 2 ? sombre : couleur });
                else R(p, x + 0.8, y + k * e + 0.8, q - 1.6, e - 1.6, { fill: k % 2 ? sombre : couleur });
              }
            break;
          case 'pave':
            R(p, 0, 0, T, T, { fill: couleur });
            el('path', { d: `M0 ${T * 0.35} L${T * 0.3} ${T * 0.42} L${T * 0.55} ${T * 0.2} L${T} ${T * 0.3} M${T * 0.3} ${T * 0.42} L${T * 0.38} ${T} M${T * 0.55} ${T * 0.2} L${T * 0.5} 0 M${T * 0.38} ${T * 0.72} L${T} ${T * 0.68} M${T * 0.7} ${T * 0.7} L${T * 0.78} ${T * 0.27}`,
              fill: 'none', stroke: joint, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }, p);
            R(p, 0, 0, T, T, { fill: 'none', stroke: joint, 'stroke-width': 1.5 });
            break;
          case 'damier':
            for (const [x, y] of [[0, 0], [q, 0], [0, q], [q, q]]) R(p, x + 0.8, y + 0.8, q - 1.6, q - 1.6, { fill: (x + y) % T ? clair : couleur });
            break;
          case 'losange':
            R(p, 1, 1, T - 2, T - 2, { fill: couleur });
            el('path', { d: `M1 1 L${T - 1} ${T - 1} M${T - 1} 1 L1 ${T - 1}`, stroke: joint, 'stroke-width': 1.2, 'stroke-opacity': 0.7 }, p);
            break;
          case 'grandes':
            R(p, 1, 1, T - 2, q - 2, { rx: 2, fill: couleur });
            R(p, -q + 1, q + 1, T - 2, q - 2, { rx: 2, fill: sombre });
            R(p, q + 1, q + 1, T - 2, q - 2, { rx: 2, fill: sombre });
            break;
        }
      });
      const url = `url(#${id})`;
      ids.set(cle, url);
      return url;
    }

    // Grain : taches claires et sombres, posées une fois sur tout le plateau (texture de pierre).
    const grain = el('pattern', { id: 't-grain', width: 160, height: 160, patternUnits: 'userSpaceOnUse' }, defs);
    const hasard = alea(1789);
    for (let k = 0; k < 70; k++) {
      el('circle', { cx: hasard() * 160, cy: hasard() * 160, r: 0.6 + hasard() * 2.6,
        fill: hasard() < 0.5 ? '#000' : '#fff', 'fill-opacity': 0.05 + hasard() * 0.08 }, grain);
    }

    // Répartition des sols : chaque pièce (lettre) reçoit une couleur et un motif, toujours les mêmes.
    const lettres = [...zonesPieces].sort();
    const parPiece = new Map(lettres.map((z, k) => [z, sol(COULEURS[(k * 7) % COULEURS.length], MOTIFS[(k * 3) % MOTIFS.length])]));
    return zone => zone === '.' ? 'url(#t-couloir)' : parPiece.get(zone) || 'url(#t-couloir)';
  }

  return { preparer };
})();
