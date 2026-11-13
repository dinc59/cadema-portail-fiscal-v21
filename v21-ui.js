/* Portail Fiscal CADEMA — interactions V21.
   Chargé par bootstrap.js APRÈS portal.js.

   Règle : React possède le DOM du portail. Ce module n'en déplace ni n'en
   supprime aucun nœud — il pose des classes, des attributs, et ajoute ses
   propres éléments (pastille, infobulle, bouton de repli, voile) que React
   ne connaît pas et ne touchera donc jamais. Toute erreur ici est capturée :
   au pire, le portail s'affiche comme en V20. */

import { installRecettes, syncMenu, taxViewCode } from './v21-recettes.js';

const RAIL_KEY = 'cadema.v21.rail';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const mobile = matchMedia('(width <= 980px)');

const safe = fn => (...args) => {
  try { return fn(...args); } catch (error) { console.warn('[V21]', error); }
};

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* sans stockage */ } },
};

/* ── Entrée active : celle de React, ou « Budget & CFU » quand sa vue
   (posée par l'adaptateur, hors React) est ouverte. ─────────────────────── */

const accountingOpen = () => Boolean(document.querySelector('.cadema-accounting-overlay'));
const activeEntry = (nav = document.querySelector('.sidebar nav')) => {
  if (!nav) return null;
  if (accountingOpen()) return nav.querySelector(':scope > button[data-cadema-accounting]');
  const tax = taxViewCode();
  if (tax) return nav.querySelector(`.v21-nav-sub [data-v21-tax="${CSS.escape(tax)}"]`);
  return nav.querySelector(':scope > button.active');
};

/* ── Pastille glissante sous l'entrée active ─────────────────────────────── */

let pill = null;
let lastActive = null;

const placePill = safe(({instant = false} = {}) => {
  const nav = document.querySelector('.sidebar nav');
  if (!nav) return;
  if (!pill || !nav.contains(pill)) {
    pill = document.createElement('span');
    pill.className = 'v21-nav-pill';
    pill.setAttribute('aria-hidden', 'true');
    nav.appendChild(pill);
    instant = true;
  }
  const active = activeEntry(nav);
  if (!active) { pill.removeAttribute('data-ready'); lastActive = null; return; }
  if (instant || reduceMotion.matches) pill.setAttribute('data-instant', '');
  /* Position mesurée par rapport au menu, pas à offsetParent : les
     sous-entrées des recettes vivent dans un groupe positionné. */
  const navBox = nav.getBoundingClientRect();
  const box = active.getBoundingClientRect();
  pill.style.transform = `translate(${box.left - navBox.left}px, ${box.top - navBox.top}px)`;
  pill.style.width = `${box.width}px`;
  pill.style.height = `${box.height}px`;
  pill.setAttribute('data-ready', '');
  if (pill.hasAttribute('data-instant')) {
    requestAnimationFrame(() => requestAnimationFrame(() => pill?.removeAttribute('data-instant')));
  }
  lastActive = active;
});

/* ── Menu replié (rail) ──────────────────────────────────────────────────── */

let railButton = null;

const setRail = safe((on, {animate = true} = {}) => {
  const body = document.body;
  if (animate && !reduceMotion.matches) {
    body.classList.add('v21-anim');
    clearTimeout(setRail.timer);
    setRail.timer = setTimeout(() => body.classList.remove('v21-anim'), 320);
  }
  body.classList.toggle('v21-rail', on);
  storage.set(RAIL_KEY, on ? '1' : '0');
  if (railButton) {
    railButton.setAttribute('aria-pressed', String(on));
    railButton.setAttribute('aria-label', on ? 'Déplier le menu' : 'Replier le menu');
  }
  hideTip(true);
  setTimeout(() => placePill({instant: true}), animate ? 280 : 0);
});

const installRailToggle = safe(() => {
  if (railButton && document.body.contains(railButton)) return;
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  railButton = document.createElement('button');
  railButton.type = 'button';
  railButton.className = 'v21-rail-toggle';
  railButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  railButton.addEventListener('click', () => setRail(!document.body.classList.contains('v21-rail')));
  /* Placé juste après la barre latérale, dans son parent, pour que le
     sélecteur `.sidebar:hover ~ .v21-rail-toggle` fonctionne. React
     n'insère jamais de nœud relativement à celui-ci. */
  sidebar.after(railButton);
  setRail(storage.get(RAIL_KEY) === '1', {animate: false});
});

/* ── Infobulles du rail ──────────────────────────────────────────────────── */

let tip = null;
let tipTimer = null;
let tipWarmUntil = 0;

const hideTip = safe((immediate = false) => {
  clearTimeout(tipTimer);
  if (!tip) return;
  if (immediate) tip.setAttribute('data-instant', '');
  tip.removeAttribute('data-open');
  tipWarmUntil = Date.now() + 300;
});

const tipLabel = el => {
  if (el.matches('.sidebar button')) {
    if (!document.body.classList.contains('v21-rail') || mobile.matches) return null;
    return el.querySelector('b')?.textContent?.trim() || null;
  }
  return el.getAttribute('data-v21-tip');
};

const showTip = safe(button => {
  const label = tipLabel(button);
  if (!label) return;
  const below = !button.matches('.sidebar button');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'v21-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  const open = () => {
    if (!button.isConnected || !tipLabel(button)) return;
    const rect = button.getBoundingClientRect();
    tip.textContent = label;
    const above = button.getAttribute('data-v21-tip-side') === 'top';
    tip.toggleAttribute('data-below', below && !above);
    tip.toggleAttribute('data-above', above);
    if (below) {
      const half = tip.offsetWidth / 2;
      const center = Math.min(innerWidth - half - 8, Math.max(half + 8, rect.left + rect.width / 2));
      tip.style.left = `${center}px`;
      tip.style.top = above ? `${rect.top - 8}px` : `${rect.bottom + 8}px`;
    } else {
      const edge = document.querySelector('.sidebar')?.getBoundingClientRect().right ?? rect.right;
      tip.style.left = `${edge + 8}px`;
      tip.style.top = `${rect.top + rect.height / 2}px`;
    }
    tip.setAttribute('data-open', '');
  };
  clearTimeout(tipTimer);
  const warm = tip.hasAttribute('data-open') || Date.now() < tipWarmUntil;
  if (warm) { tip.setAttribute('data-instant', ''); open(); }
  else { tip.removeAttribute('data-instant'); tipTimer = setTimeout(open, 350); }
});

/* ── Largeur de la barre système (posée à droite de l'en-tête) ──────────── */

let dockObserved = null;
const dockSizer = typeof ResizeObserver === 'function'
  ? new ResizeObserver(entries => {
      for (const entry of entries) {
        const width = Math.ceil(entry.target.getBoundingClientRect().width);
        document.documentElement.style.setProperty('--v21-dock-w', `${width}px`);
      }
    })
  : null;

const watchDock = safe(() => {
  const dock = document.querySelector('.system-dock');
  if (!dock || dock === dockObserved || !dockSizer) return;
  if (dockObserved) dockSizer.unobserve(dockObserved);
  dockObserved = dock;
  dockSizer.observe(dock);
});

/* ── Accords : « 7 alerte(s) critique(s) » → « 7 alertes critiques » ─────
   On réécrit le texte des nœuds texte existants (nodeValue), sans en
   créer ni en retirer : React garde ses nœuds, et s'il réécrit un libellé
   avec « (s) », l'observateur le corrige de nouveau. En français, 0 et 1
   sont au singulier. Sans nombre trouvable à proximité, on garde le
   pluriel. */

const NUMBER = /(\d[\d   ]*)(?:[,.]\d+)?(?!.*\d)/s;
const lastNumber = text => {
  const match = String(text).match(NUMBER);
  return match ? Number(match[1].replace(/[^\d]/g, '')) : null;
};
const firstNumber = text => {
  const match = String(text).match(/\d[\d   ]*/);
  return match ? Number(match[0].replace(/[^\d]/g, '')) : null;
};

const textBefore = node => {
  let text = '';
  for (let sib = node.previousSibling; sib; sib = sib.previousSibling) text = (sib.textContent || '') + text;
  return text;
};
const textAfter = node => {
  let text = '';
  for (let sib = node.nextSibling; sib; sib = sib.nextSibling) text += sib.textContent || '';
  return text;
};

const nearbyCount = node => {
  let level = node;
  for (let depth = 0; depth < 3 && level && !level.matches?.('.main, .portal, article, section'); depth++) {
    const before = lastNumber(textBefore(level));
    if (before !== null) return before;
    level = level.parentElement;
  }
  level = node;
  for (let depth = 0; depth < 2 && level && !level.matches?.('.main, .portal, article, section'); depth++) {
    const after = firstNumber(textAfter(level));
    if (after !== null) return after;
    level = level.parentElement;
  }
  return null;
};

const agree = node => {
  const value = node.nodeValue;
  let outer;
  /* « (s) » → s ; « (x) » (nouveau(x)…) → x. */
  const fixed = value.replace(/\((s|x)\)/g, (token, letter, index) => {
    let count = lastNumber(value.slice(0, index));
    if (count === null) count = outer === undefined ? (outer = nearbyCount(node)) : outer;
    return count !== null && count <= 1 ? '' : letter;
  });
  if (fixed !== value) node.nodeValue = fixed;
};

const fixPlurals = safe(() => {
  /* Tout le document : menus, notifications et fenêtres sont rendus hors
     de .portal (portails Radix). */
  const root = document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => /\((s|x)\)/.test(node.nodeValue) &&
      !node.parentElement?.closest('input, textarea, select, option, script, style, [contenteditable="true"]')
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(agree);
});

/* ── Données : absences, jauges, rappels répétés ──────────────────────────
   Seulement des attributs et une variable CSS : aucun texte ni nœud de
   React n'est modifié ici. */

const setFlag = (el, name, on) => {
  if (el.hasAttribute(name) !== on) el.toggleAttribute(name, on);
};

const rangeFill = range => {
  const min = Number(range.min || 0), max = Number(range.max || 100);
  const pct = max > min ? ((Number(range.value) - min) / (max - min)) * 100 : 0;
  const value = `${pct}%`;
  if (range.style.getPropertyValue('--v') !== value) range.style.setProperty('--v', value);
};

const decorateData = safe(() => {
  for (const el of document.querySelectorAll('.main :is(.rs-table > button > *, .rs-company-grid dd, .rs-card-money b, .cadema-accounting-table td)')) {
    setFlag(el, 'data-v21-empty', el.childElementCount === 0 && /^(À renseigner|—|-)$/.test(el.textContent.trim()));
  }
  for (const range of document.querySelectorAll('.main .priority-range')) rangeFill(range);
  for (const el of document.querySelectorAll('.main .priority-card :is(p, small)')) {
    setFlag(el, 'data-v21-hidden', el.textContent.trim().startsWith('Aucune note pour le moment'));
  }
});

/* ── Budget & CFU : recettes / dépenses par section ──────────────────────
   Lu dans le tableau « Synthèse CFU » que l'adaptateur vient d'afficher :
   aucun chiffre n'est recalculé ni inventé, on redessine ceux du tableau.
   La vue appartient à l'adaptateur (hors React) : on peut y insérer. */

const euros = text => {
  const clean = String(text).replace(/[^\d,-]/g, '').replace(',', '.');
  return clean && clean !== '-' ? Number(clean) : null;
};
const formatEuro = value => new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 0}).format(value) + ' €';

const drawCfuBars = safe(() => {
  const card = [...document.querySelectorAll('.cadema-accounting-card')]
    .find(el => /Synthèse CFU/i.test(el.querySelector('h2')?.textContent || ''));
  const table = card?.querySelector('table');
  if (!table) return;
  const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim().toLowerCase());
  const col = name => heads.findIndex(h => h.startsWith(name));
  const [iEx, iBudget, iSection, iRec, iDep] = [col('exercice'), col('budget'), col('section'), col('recettes'), col('dépenses')];
  if (iRec < 0 || iDep < 0) return;
  const rows = [...table.querySelectorAll('tbody tr')].map(tr => {
    const cells = [...tr.children].map(td => td.textContent.trim());
    return {
      label: [cells[iSection], cells[iBudget], cells[iEx]].filter(Boolean).join(' · '),
      section: (cells[iSection] || '').toLowerCase(),
      rec: euros(cells[iRec]),
      dep: euros(cells[iDep]),
    };
  }).filter(row => row.rec !== null && row.dep !== null && !row.section.startsWith('total'));
  const signature = JSON.stringify(rows);
  const existing = card.querySelector('.v21-cfu-bars');
  if (existing?.dataset.signature === signature) return;
  existing?.remove();
  if (!rows.length) return;
  const max = Math.max(...rows.flatMap(row => [row.rec, row.dep]), 1);
  const box = document.createElement('div');
  box.className = 'v21-cfu-bars';
  box.dataset.signature = signature;
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', rows.map(r => `${r.label} : recettes ${formatEuro(r.rec)}, dépenses ${formatEuro(r.dep)}`).join(' ; '));
  box.innerHTML = `<div class="v21-cfu-legend" aria-hidden="true"><span><i class="rec"></i>Recettes</span><span><i class="dep"></i>Dépenses</span></div>` +
    rows.map(row => `
      <div class="v21-cfu-row" aria-hidden="true">
        <b>${row.label.replace(/[<>&]/g, '')}</b>
        <div class="v21-cfu-track"><span class="rec" style="--w:${(row.rec / max) * 100}%"></span><em>${formatEuro(row.rec)}</em></div>
        <div class="v21-cfu-track"><span class="dep" style="--w:${(row.dep / max) * 100}%"></span><em>${formatEuro(row.dep)}</em></div>
      </div>`).join('');
  table.closest('.cadema-accounting-table')?.before(box);
});

/* ── Textes : dire où sont vraiment les données ─────────────────────────
   Le portail a été écrit pour un usage hors ligne : « stockage local »,
   « vos données restent sur cet appareil »… Dans Grist, c'est faux : les
   montants, tâches, documents et paramètres sont enregistrés dans le
   document Grist. Ces libellés sont réécrits UNIQUEMENT quand le portail
   est connecté à Grist ; hors Grist, ils restent exacts et inchangés.
   Même technique que les accords : nodeValue des nœuds existants. */

const GRIST_WORDING = [
  ['Les montants, tâches et métadonnées sont conservés dans le navigateur. Les fichiers et grands jeux de données restent dans son stockage local IndexedDB. Le code du portail est en ligne, pas vos données métier.',
   'Les montants, tâches, documents et paramètres sont enregistrés dans le document Grist, avec ses droits d\'accès (ProConnect). Le code du portail est en ligne, pas vos données métier.'],
  ['Les fichiers restent dans le navigateur de cet appareil et sont inclus dans votre sauvegarde JSON complète.',
   'Les fichiers sont enregistrés dans les pièces jointes du document Grist.'],
  ['Vos données restent uniquement sur cet appareil.', 'Vos données sont enregistrées dans le document Grist.'],
  ['Confidentiel · stockage local', 'Confidentiel · données dans Grist'],
  ['Aucune donnée envoyée en ligne', 'Données enregistrées dans Grist'],
  ['événement(s) conservé(s) localement', 'événement(s) enregistré(s) dans Grist'],
  ['message(s) conservé(s) localement', 'message(s) enregistré(s) dans Grist'],
  ['élément(s) enregistrés localement', 'élément(s) enregistré(s) dans Grist'],
  ['Exercice enregistré localement', 'Exercice enregistré dans Grist'],
  ['Répartition FPIC enregistrée localement', 'Répartition FPIC enregistrée dans Grist'],
  ['Entreprise ajoutée localement', 'Entreprise ajoutée dans Grist'],
  ['Enregistrer localement', 'Enregistrer dans Grist'],
  ['Stockage sur cet appareil', 'Stockage dans Grist'],
  ['Conservées sur cet appareil', 'Conservées dans Grist'],
  ['Local à cet appareil', 'Document Grist'],
  ['Aucun envoi en ligne', 'Enregistré dans Grist'],
  ['Saisi localement', 'Saisi dans Grist'],
  ['Stockage local', 'Stockage Grist'],
];

const rewordForGrist = safe(() => {
  if (!window.CADEMA_GRIST?.connected) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: node => /localement|cet appareil|navigateur|stockage local|Stockage local|en ligne/.test(node.nodeValue) &&
      !node.parentElement?.closest('input, textarea, select, option, script, style, [contenteditable="true"], .v21-tax-view')
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    let value = node.nodeValue;
    for (const [from, to] of GRIST_WORDING) if (value.includes(from)) value = value.split(from).join(to);
    if (value !== node.nodeValue) node.nodeValue = value;
  }
});

/* ── Libellés d'infobulle sur les commandes compactées ────────────────── */

const labelCompactControls = safe(() => {
  const set = (el, text) => {
    if (el && text && el.getAttribute('data-v21-tip') !== text) el.setAttribute('data-v21-tip', text);
  };
  for (const button of document.querySelectorAll('.system-dock > button')) set(button, button.textContent.trim());
  const sync = document.querySelector('.system-dock .autosave-state');
  if (sync) set(sync, [sync.querySelector('b')?.textContent, sync.querySelector('small')?.textContent].filter(Boolean).join(' · '));
  set(document.querySelector('.topbar .nav-back'), 'Retour');
  for (const button of document.querySelectorAll('.topbar .round')) set(button, button.getAttribute('aria-label') || button.title);

  /* Commandes à icône seule sans nom accessible en V20 : le lecteur d'écran
     annonçait « bouton », sans plus. Attributs seulement. */
  const name = (el, text) => {
    if (!el || !text) return;
    if (el.getAttribute('aria-label') !== text) el.setAttribute('aria-label', text);
    set(el, text);
  };
  name(document.querySelector('.topbar .hamb'), 'Ouvrir le menu');
  const dark = document.documentElement.dataset.theme === 'dark';
  for (const button of document.querySelectorAll('.topbar .round:not(.notification-trigger)')) {
    if (!button.textContent.trim() && !button.title) name(button, dark ? 'Passer en mode clair' : 'Passer en mode sombre');
  }
  const bell = document.querySelector('.topbar .notification-trigger');
  if (bell && !bell.getAttribute('aria-label') && !bell.title) name(bell, 'Notifications');
  const views = document.querySelectorAll('.rs-view-switch > button');
  ['Vue en cartes', 'Vue en tableau'].forEach((label, i) => {
    const button = views[i];
    if (!button) return;
    name(button, label);
    const pressed = String(button.classList.contains('active'));
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
  });
  const year = document.querySelector('.top-actions > select');
  if (year && !year.getAttribute('aria-label')) year.setAttribute('aria-label', 'Exercice affiché');
});

/* ── Fenêtres : le curseur va dans le formulaire ──────────────────────────
   Ouverte depuis le menu « Créer », une fenêtre de saisie laissait le focus
   sur le bouton « Créer » (le menu le lui rend en se fermant, juste après
   l'ouverture de la fenêtre) : au clavier, on tapait dans le vide. */

let lastDialog = null;
const focusDialog = safe(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"]')].pop() || null;
  if (dialog === lastDialog) return;
  lastDialog = dialog;
  if (!dialog) return;
  setTimeout(() => {
    if (!dialog.isConnected || dialog.contains(document.activeElement)) return;
    const field = dialog.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])')
      || dialog.querySelector('button:not([disabled])');
    field?.focus({preventScroll: true});
  }, 60);
});

/* ── Boucle d'observation ────────────────────────────────────────────────── */

let frame = 0;
const tick = () => {
  frame = 0;
  installRailToggle();
  document.body.toggleAttribute('data-v21-accounting', accountingOpen());
  syncMenu();
  document.body.toggleAttribute('data-v21-taxview', Boolean(taxViewCode()));
  /* Replacée à chaque passage : une entrée peut bouger sans changer
     (sous-menu des recettes inséré, menu replié). Sans changement de
     position, le style est identique et rien ne s'anime. */
  placePill();
  watchDock();
  labelCompactControls();
  focusDialog();
  rewordForGrist();
  fixPlurals();
  decorateData();
  drawCfuBars();
};

export function startV21() {
  document.documentElement.classList.add('v21');
  installRecettes();
  tick();
  new MutationObserver(() => { if (!frame) frame = setTimeout(tick, 16); })
    .observe(document.getElementById('root') || document.body, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class']});

  addEventListener('resize', () => placePill({instant: true}), {passive: true});
  mobile.addEventListener?.('change', () => placePill({instant: true}));

  document.addEventListener('pointerover', event => {
    const button = event.target.closest?.('.sidebar button, [data-v21-tip]');
    if (button) showTip(button);
  });
  document.addEventListener('pointerout', event => {
    const button = event.target.closest?.('.sidebar button, [data-v21-tip]');
    if (button && !button.contains(event.relatedTarget)) hideTip();
  });
  document.addEventListener('focusin', event => {
    const button = event.target.closest?.('.sidebar button, [data-v21-tip]');
    if (button && event.target.matches(':focus-visible')) showTip(button); else hideTip(true);
  });
  document.addEventListener('click', () => hideTip(true), true);
  /* La vue Budget & CFU se ferme dès qu'on choisit une autre entrée du
     menu, ou avec Échap — en V20 elle restait par-dessus l'écran demandé. */
  document.addEventListener('click', event => {
    const entry = event.target.closest?.('.sidebar button');
    if (entry && !entry.matches('[data-cadema-accounting], .logout-button')) {
      document.querySelector('.cadema-accounting-overlay')?.remove();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (document.querySelector('.command-overlay, .dialog-overlay, [role="dialog"]')) return;
    document.querySelector('.cadema-accounting-overlay')?.remove();
  });
  document.addEventListener('input', event => {
    if (event.target.matches?.('.priority-range')) rangeFill(event.target);
  });
  document.addEventListener('scroll', () => hideTip(true), {capture: true, passive: true});

  /* Ctrl/Cmd + B : replier/déplier le menu. Aucune animation lourde :
     un raccourci se répète, il doit être immédiat. */
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'b') {
      if (event.target.closest?.('input, textarea, [contenteditable="true"]') || mobile.matches) return;
      event.preventDefault();
      setRail(!document.body.classList.contains('v21-rail'), {animate: false});
    }
  });
}
