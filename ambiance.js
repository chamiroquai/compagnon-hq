/* ambiance.js — Petits messages d'ambiance tirés au hasard.
   Textes originaux, écrits pour cette application (aucun texte officiel).
   Pour en ajouter : une ligne par message, entre apostrophes droites ou guillemets.
   {monstre} et {heros} sont remplacés par les noms en jeu. */
'use strict';

const Ambiance = (() => {
  const TEXTES = {
    // Début du tour de Zargon
    debutZargon: [
      'Les torches vacillent. Zargon se penche sur son grimoire.',
      'Un rire sec roule sous les voûtes. Le Maître du jeu s’éveille.',
      'L’air se refroidit d’un coup : les ténèbres reprennent la main.',
      'Quelque part, une goutte tombe. Puis le silence se brise.',
      'Les ombres s’étirent sur les dalles, comme si elles respiraient.',
      'Zargon compte ses pions… et sourit.',
      'Le donjon tout entier semble retenir son souffle.',
      'Une odeur de pierre mouillée et de fer rouillé envahit les couloirs.',
      'Des griffes raclent la pierre, quelque part derrière les murs.',
      'Les flammes bleuissent un instant. Ce n’est jamais bon signe.',
      'Un murmure parcourt les couloirs, dans une langue oubliée.',
      'Au loin, une chaîne glisse lentement sur la pierre.',
    ],
    // Un monstre visible se met en marche vers un héros
    approche: [
      '{monstre} renifle l’air. Il a senti {heros}.',
      'Des pas lourds martèlent la pierre : {monstre} arrive.',
      '{monstre} grogne et se met en marche.',
      'Les yeux de {monstre} se fixent sur {heros}.',
      '{monstre} sort de l’ombre, arme au poing.',
      'Un cliquetis d’armure : {monstre} avance sans hâte.',
      '{monstre} montre les dents et presse le pas.',
      'La silhouette de {monstre} se découpe à la lueur des torches.',
      '{monstre} a repéré une proie. Il ne la lâchera plus.',
      'Un souffle rauque se rapproche : {monstre} est en chasse.',
      '{monstre} traîne les pieds, mais il avance, inexorable.',
      '« Par ici… », semble ricaner {monstre}.',
      '{monstre} contourne l’obstacle et file droit sur {heros}.',
      'Le sol tremble légèrement sous la marche de {monstre}.',
      '{monstre} lève la tête, hume la peur, et s’élance.',
      'Une ombre glisse d’une dalle à l’autre : {monstre} approche.',
    ],
    // Un monstre visible attaque sans bouger (déjà au contact)
    attaque: [
      '{monstre} n’a pas besoin de bouger : {heros} est à portée.',
      '{monstre} lève son arme au-dessus de {heros}.',
      '{monstre} pousse un cri de guerre et frappe !',
      'Pas un pas de plus : {monstre} frappe {heros} de plein fouet.',
      '{monstre} se campe sur ses appuis et attaque.',
      'Un éclair d’acier : {monstre} porte son coup.',
      '{monstre} rugit au visage de {heros}.',
      '{monstre} vise la faille dans la garde de {heros}.',
      'Le combat reprend. {monstre} ne recule pas.',
      '{monstre} frappe avec la rage du désespoir.',
    ],
    // Un monstre visible ne peut atteindre personne
    immobile: [
      '{monstre} gronde, mais aucun chemin ne mène aux héros.',
      '{monstre} tourne en rond, frustré.',
      '{monstre} reste aux aguets, immobile comme une statue.',
      '{monstre} tend l’oreille… et attend son heure.',
      '{monstre} gratte la porte close, en vain.',
      '{monstre} montre les crocs à travers l’obscurité.',
      '{monstre} se tapit et guette le moindre bruit.',
    ],
    // Un monstre dans le brouillard agit
    ombre: [
      'Quelque chose bouge dans l’obscurité…',
      'Un frottement, tout près. Puis plus rien.',
      'Des pas pressés résonnent, sans qu’on voie qui les fait.',
      'Une porte grince quelque part, au loin.',
      'Les ténèbres remuent. Mieux vaut ne pas savoir.',
      'Un grognement étouffé traverse les murs.',
      'Un courant d’air froid annonce une présence invisible.',
      'On entend respirer, là-bas, dans le noir.',
      'Le cliquetis d’une arme, quelque part dans l’ombre.',
      'Une odeur de charogne flotte un instant, puis s’efface.',
    ],
    // Un héros engage le combat
    attaqueHeros: [
      '{heros} serre son arme et marche sur {monstre}.',
      '{heros} pousse un cri et se jette sur {monstre}.',
      '{heros} fixe {monstre} droit dans les yeux. Le combat s’engage.',
      'D’un pas décidé, {heros} engage {monstre}.',
      '{heros} feinte à gauche… et frappe à droite !',
      '{heros} prend une grande inspiration, puis attaque.',
      '{monstre} montre les dents. {heros} ne recule pas.',
      'Le métal siffle : {heros} passe à l’attaque.',
      '{heros} cherche l’ouverture dans la garde de {monstre}.',
      '« Pour la gloire ! » lance {heros} en chargeant {monstre}.',
      '{heros} assure sa prise et frappe de toutes ses forces.',
      'Un regard aux compagnons, et {heros} fond sur {monstre}.',
    ],
    // Un héros est blessé
    heroBlesse: [
      '{heros} serre les dents sous le coup.',
      'La lame de {monstre} trouve sa cible. {heros} chancelle.',
      '{heros} est touché, mais tient bon.',
      'Un éclair de douleur : {heros} recule d’un pas.',
      '{heros} essuie le sang qui coule sur son front.',
      'Le coup de {monstre} fait plier {heros}.',
      '{heros} grimace : la blessure est sérieuse.',
      '{heros} vacille, puis se redresse, furieux.',
    ],
    // Un héros pare tout
    heroIndemne: [
      '{heros} pare le coup au dernier moment.',
      'Le bouclier de {heros} résonne, mais tient bon.',
      '{heros} esquive d’un bond. {monstre} frappe dans le vide.',
      'Le coup de {monstre} glisse sur l’armure de {heros}.',
      '{heros} dévie l’attaque avec aisance.',
      '{monstre} enrage : {heros} est toujours debout, sans une égratignure.',
      'Un réflexe salvateur : {heros} s’écarte juste à temps.',
    ],
    // Un monstre est blessé sans mourir
    monstreBlesse: [
      '{monstre} hurle de douleur, mais reste debout.',
      'Touché ! {monstre} titube.',
      '{monstre} recule, blessé, l’œil mauvais.',
      'Le coup porte. {monstre} gronde de rage.',
      '{monstre} vacille, mais refuse de tomber.',
    ],
    // Un monstre pare tout
    monstreIndemne: [
      '{monstre} pare le coup avec un ricanement.',
      'L’arme de {heros} ricoche sur la défense de {monstre}.',
      '{monstre} esquive d’un mouvement vif.',
      '{heros} frappe… dans le vide.',
      '{monstre} encaisse sans broncher.',
      'Raté ! {monstre} semble presque amusé.',
    ],
    // Fouilles
    fouilleRien: [
      '{heros} tâte les murs, gratte les joints… rien.',
      '{heros} inspecte chaque recoin. Pierre ordinaire, poussière ordinaire.',
      'Rien d’anormal. Mais l’impression d’être observé ne s’en va pas.',
      '{heros} se relève, les mains noires de poussière, bredouille.',
      'Une araignée dérangée détale. C’est tout ce que {heros} trouve.',
    ],
    fouillePorte: [
      'Une pierre sonne creux sous les doigts de {heros}… Un passage secret !',
      '{heros} remarque un léger courant d’air entre deux pierres. Une porte dérobée !',
      'Un déclic : un pan de mur pivote sous la main de {heros}.',
      '{heros} repère des traces d’usure sur le sol, devant un mur trop parfait…',
    ],
    fouillePiege: [
      '{heros} s’arrête net : cette dalle ne lui inspire aucune confiance.',
      'Un fil, presque invisible, tendu au ras du sol… {heros} l’a vu à temps.',
      'Le plafond est fissuré d’une drôle de façon. Mieux vaut ne pas passer dessous.',
      '{heros} sourit : celui qui a posé ce piège n’était pas très soigneux.',
    ],
    // Pièges qui se déclenchent
    piegeFosse: [
      'Le sol se dérobe sous les pieds de {heros} !',
      'Un craquement, puis la chute : {heros} tombe dans une fosse.',
      'La dalle bascule. {heros} dégringole au fond d’un trou.',
    ],
    piegeBloc: [
      'Un grondement au-dessus de {heros}… le plafond s’effondre !',
      'Des pierres pleuvent : un bloc s’abat dans un fracas assourdissant.',
      'La voûte cède. {heros} plonge pour éviter l’éboulement.',
    ],
    piegeLance: [
      'Un déclic : une lance jaillit du mur vers {heros} !',
      'Un sifflement — une pointe d’acier surgit du sol.',
      '{heros} entend le mécanisme trop tard : une lance fuse !',
    ],
    desamorceOk: [
      'Un dernier tour de main : {heros} bloque le mécanisme. Le piège est inoffensif.',
      '{heros} essuie son front. Le piège ne fera plus de victime.',
      'Avec une patience d’horloger, {heros} neutralise le piège.',
    ],
    desamorceRate: [
      'Un faux mouvement… le piège se déclenche sous les mains de {heros} !',
      'Le mécanisme résiste, puis claque : raté !',
    ],
    // Un monstre est vaincu (en plus des messages propres à chaque type, plus bas)
    mort: [
      '{monstre} s’effondre dans un dernier râle.',
      '{monstre} vacille, lâche son arme et s’écroule.',
      'Le silence retombe : {monstre} ne se relèvera pas.',
      'Un dernier cri, puis {monstre} tombe face contre terre.',
      '{monstre} s’écroule. Son ombre semble s’attarder un instant.',
      'Un coup net : {monstre} est terrassé.',
      '{monstre} recule d’un pas, puis s’effondre lourdement.',
      'Victoire ! {monstre} mord la poussière.',
      '{monstre} tombe. Les torches reprennent un peu d’éclat.',
      'Le corps de {monstre} heurte les dalles dans un bruit sourd.',
      '{heros} essuie sa lame : {monstre} n’est plus une menace.',
      '{heros} reprend son souffle au-dessus de {monstre} terrassé.',
      'L’écho du combat s’éteint. {monstre} gît à terre.',
      '{monstre} lâche un juron dans sa langue avant de s’écrouler.',
    ],
  };

  // Messages de mort propres à certains types (mélangés aux messages généraux).
  const MORT_PAR_TYPE = {
    gobelin: ['Le gobelin couine une dernière fois et se recroqueville.', 'Le gobelin roule sur le côté, sa dague tinte sur la pierre.'],
    orque: ['L’orque tombe à genoux en grondant, puis bascule.', 'L’orque s’écroule comme un arbre abattu.'],
    abomination: ['L’abomination se tord dans un gargouillis immonde, puis se tait.', 'La masse difforme s’affaisse et ne bouge plus.'],
    guerrierEffroi: ['L’armure du Guerrier de la Terreur s’effondre dans un fracas de métal.', 'Le Guerrier de la Terreur tombe ; une fumée noire s’échappe de son heaume.'],
    gargouille: ['La gargouille se fige, se fend, et éclate en morceaux de pierre.', 'Un craquement sinistre : la gargouille n’est plus qu’un tas de gravats.'],
    squelette: ['Les os du squelette s’éparpillent en cliquetant sur les dalles.', 'Le squelette se disloque ; son crâne roule jusqu’au mur.'],
    zombie: ['Le zombie s’affale dans une odeur écœurante. Pour de bon, cette fois.', 'Le zombie s’écroule, enfin rendu au repos.'],
    momie: ['Les bandelettes de la momie se défont en poussière.', 'La momie s’effondre dans un nuage de poussière millénaire.'],
    sorcierEffroi: ['Le sorcier pousse un cri strident et se dissout en fumée.', 'La silhouette du sorcier vacille, puis s’efface comme un mauvais rêve.'],
  };

  const derniers = {}; // dernier message tiré par catégorie, pour éviter les répétitions

  function remplir(t, valeurs) {
    return t.replace(/\{(\w+)\}/g, (_, k) => valeurs[k] ?? '');
  }

  // Tire un message de la catégorie (jamais deux fois de suite le même).
  // valeurs : { monstre, heros, type } ; type sert aux messages de mort propres.
  function tirer(categorie, valeurs = {}) {
    let liste = TEXTES[categorie] || [];
    if (categorie === 'mort' && MORT_PAR_TYPE[valeurs.type]) liste = liste.concat(MORT_PAR_TYPE[valeurs.type], MORT_PAR_TYPE[valeurs.type]);
    if (!liste.length) return '';
    let choix, essais = 0;
    do { choix = liste[Math.floor(Math.random() * liste.length)]; } while (choix === derniers[categorie] && liste.length > 1 && ++essais < 10);
    derniers[categorie] = choix;
    return remplir(choix, valeurs);
  }

  return { tirer };
})();
