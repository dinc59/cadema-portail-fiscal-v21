const STATE_KEY = 'cadema-fiscal-next-v1';
const BRIDGE_VERSION = '20.2.0-rs-annual';
const PROFILE_KEY = 'cadema-grist-profile';
const EXERCISE_KEY = 'cadema-fiscal-exercise';
const EXERCISE_RETURN_KEY = 'cadema-fiscal-exercise-return';
const STATE_PARAM = 'PORTAL_STATE_JSON';
const UPDATED_PARAM = 'PORTAL_STATE_UPDATED_AT';
const TABLE_NAMES = [
  'Utilisateurs', 'Taxes', 'Produits_Recettes', 'Taches', 'Plans_Actions',
  'Documents_Fiscaux', 'Entreprises_RS', 'Suivi_RS_Annuel', 'Employeurs_VM', 'Etablissements_CFE',
  'Calendrier_Fiscal', 'Messages_Equipe', 'Notifications', 'Budgets',
  'Grand_Livre', 'CFU_Synthese', 'Parametres',
];

/* Couleurs de séries des six produits fiscaux. Elles sont posées en style
   inline par le portail : le CSS ne peut pas les corriger après coup, c'est
   donc ici qu'elles se règlent. Les valeurs d'origine étaient saturées
   (#14b8aa, #f0a928, #ef5c68) et juraient avec la palette institutionnelle.
   Toutes les nouvelles dépassent 5,4:1 sur blanc et sur le fond de page.
   Présentation seule : aucune de ces valeurs n'est écrite dans Grist. */
const TAX_COLORS = ['#0e6d70', '#1e5fa8', '#5b4ba8', '#8a5a0b', '#a8382b', '#2c6146'];
const DEFAULT_TAXES = [
  {key:'CFE',label:'Cotisation foncière',amount:null,delta:null,color:'#0e6d70',source:'',status:'À compléter',history:[]},
  {key:'TEOM',label:'Ordures ménagères',amount:null,delta:null,color:'#1e5fa8',source:'',status:'À compléter',history:[]},
  {key:'VM',label:'Versement mobilité',amount:null,delta:null,color:'#5b4ba8',source:'',status:'À compléter',history:[]},
  {key:'TASCOM',label:'Surfaces commerciales',amount:null,delta:null,color:'#8a5a0b',source:'',status:'À compléter',history:[]},
  {key:'IFER',label:'Entreprises de réseaux',amount:null,delta:null,color:'#a8382b',source:'',status:'À compléter',history:[]},
  {key:'COMP',label:'Compensation CVAE par TVAE',amount:null,delta:null,color:'#2c6146',source:'',status:'À compléter',history:[]},
];

const euro = new Intl.NumberFormat('fr-FR', {style:'currency', currency:'EUR', maximumFractionDigits:0});

function columnarToRows(table) {
  if (!table || !Array.isArray(table.id)) return [];
  return table.id.map((id, index) => {
    const row = {id};
    for (const [column, values] of Object.entries(table)) {
      if (Array.isArray(values)) row[column] = values[index];
    }
    return row;
  });
}

function cleanFields(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asIso(value) {
  if (!value) return new Date().toISOString();
  if (typeof value === 'number') {
    const millis = value > 100000000 ? value * 1000 : (value - 25569) * 86400000;
    const date = new Date(millis);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function gristDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
}

function gristDateValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return gristDate(value);
}

function attachmentId(value) {
  if (!Array.isArray(value)) return null;
  const ids = value[0] === 'L' ? value.slice(1) : value;
  return ids.find(item => Number.isInteger(item)) || null;
}

function gristFieldPresent(value) {
  if (attachmentId(value)) return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  return typeof value === 'string' && value.trim().length > 0;
}

/* Le portail V19 ne connaît qu'un seul profil interne : `grist`.
   L'ancienne version renvoyait ici des clés de prénoms d'agents ou 'invite',
   qui n'existent dans aucune version du portail : la recherche de profil
   retournait undefined et l'accès non protégé qui suit vidait tout le widget.
   C'était la vraie cause du "widget vide". On garde donc la clé unique et on
   expose séparément l'identité réelle, pour l'affichage seulement. */
const PORTAL_PROFILE = 'grist';

function initialsOf(name) {
  const parts = String(name || '').trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return 'G';
  return (parts.length === 1 ? parts[0][0] : parts[0][0] + parts[1][0]).toUpperCase();
}

/* ── Trombinoscope du pôle ────────────────────────────────────────────────
   Le portail ne connaît qu'une liste de profils, `rK`, codée en dur dans le
   bundle et réduite à une seule entrée (« Utilisateur Grist »). Toute la
   mécanique d'affectation des priorités travaille pourtant par NOM :
   `assignees.includes(profil.name)` pour la sélection, la même chose pour le
   filtre « Charge de l'équipe ». Il suffit donc que la liste contienne les
   bons noms — aucune colonne, aucune table, aucune structure à changer.

   Cette liste est construite ici à partir de deux sources réelles du
   document, jamais d'une liste écrite en dur :
     1. la table `Utilisateurs` (lignes actives), que l'adaptateur charge
        déjà mais dont il ne gardait qu'une ligne pour l'identité affichée ;
     2. les responsables déjà présents sur les priorités — c'est-à-dire le
        contenu de `Taches.Assigne_A`, la donnée qui contient aujourd'hui
        les membres de l'équipe.
   Un nom qui n'existe dans aucune des deux sources n'apparaît pas.        */

const ROSTER_COLORS = ['#1e5fa8', '#5b4ba8', '#8a5a0b', '#2c6146', '#a8382b', '#0e6d70'];

function profileKeyFor(name, taken) {
  const base = String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'membre';
  let key = base;
  let index = 2;
  while (taken.has(key)) key = `${base}-${index++}`;
  taken.add(key);
  return key;
}

function rosterNames(tables, state) {
  const seen = new Map();
  /* `declared` distingue une personne réellement inscrite dans la table
     `Utilisateurs` d'un nom seulement rencontré dans `Assigne_A`. Sans cette
     distinction, la page « Équipe & accès » afficherait « Administrateur »
     pour quelqu'un dont aucune ligne ne dit quoi que ce soit de ses droits :
     ce serait affirmer une information que la donnée ne contient pas. */
  const add = (name, role, declared) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    const id = clean.toLowerCase();
    const known = seen.get(id);
    if (known) {
      if (!known.role && role) known.role = String(role).trim();
      known.declared = known.declared || declared;
      return;
    }
    seen.set(id, {name:clean, role:String(role || '').trim(), declared:!!declared});
  };
  for (const row of tables?.Utilisateurs || []) {
    if (row.Actif === false) continue;
    add(row.Nom_Affiche ?? row.Nom ?? row.Utilisateur ?? row.Prenom, row.Role, true);
  }
  for (const task of state?.tasks || []) {
    for (const name of task.assignees || []) add(name, '', false);
  }
  for (const row of tables?.Taches || []) {
    for (const name of String(row.Assigne_A || row.Responsable || '').split(/[·,;]/)) add(name, '', false);
  }
  return [...seen.values()];
}

function buildProfiles(tables, state, identity) {
  const base = {
    key: PORTAL_PROFILE,
    name: identity?.name || 'Utilisateur Grist',
    role: identity?.role || 'Profil chargé depuis Grist',
    initials: identity?.initials || 'G',
    admin: identity?.admin ?? true,
    color: '#0e6d70',
  };
  const taken = new Set([PORTAL_PROFILE]);
  const members = rosterNames(tables, state)
    .filter(person => person.name.toLowerCase() !== base.name.toLowerCase())
    .map((person, index) => ({
      key: profileKeyFor(person.name, taken),
      name: person.name,
      /* Le rôle réel de `Utilisateurs` prime toujours et s'affiche tel quel.
         À défaut : « Membre », qui n'affirme rien.

         Le badge de la page « Équipe & accès » est une AUTRE information —
         un niveau de droit. `Utilisateurs` porte une fonction (« Gestionnaire
         CFE »), pas une habilitation : en déduire « Administrateur » serait
         inventer. On force donc `admin: false` et on remplit `accessLabel`
         pour toute personne du trombinoscope. Seul le profil de session, dont
         les droits viennent de sa propre ligne via `identityFrom()`, garde le
         libellé calculé par le portail. */
      role: person.role || 'Membre',
      accessLabel: 'Membre',
      initials: initialsOf(person.name),
      color: ROSTER_COLORS[index % ROSTER_COLORS.length],
      admin: false,
    }));
  return [base, ...members];
}

function identityFrom(user) {
  const name = String(user?.Nom_Affiche || '').trim();
  const role = String(user?.Role || '').trim();
  if (!name && !role) return null;
  return {
    name: name || 'Utilisateur Grist',
    role: role || 'Profil chargé depuis Grist',
    initials: initialsOf(name),
    admin: !/invit|lecture seule/i.test(`${name} ${role}`),
  };
}

function mergeTaxes(rows, productRows) {
  const map = new Map(DEFAULT_TAXES.map(tax => [tax.key, structuredClone(tax)]));
  for (const [index, row] of rows.entries()) {
    const key = String(row.Code || '').trim().toUpperCase();
    if (!key) continue;
    const year = asNumber(row.Exercice) || new Date().getFullYear();
    const amount = asNumber(row.Produit);
    const current = map.get(key) || {key, label:row.Intitule || key, amount:null, delta:null, color:TAX_COLORS[index % TAX_COLORS.length], source:'', status:'À compléter', history:[]};
    const history = [...(current.history || []).filter(item => item.year !== year), {year, amount, source:row.Source || '', status:row.Statut || 'Renseigné'}].sort((a,b) => a.year - b.year);
    map.set(key, {...current, _gristId:row.Taxe_ID, label:row.Intitule || current.label, amount, source:row.Source || current.source, status:row.Statut || current.status, history});
  }
  for (const [index, row] of productRows.entries()) {
    const key = String(row.Code_Produit || '').trim().toUpperCase();
    if (!key) continue;
    const year = asNumber(row.Exercice) || new Date().getFullYear();
    const amount = asNumber(row.Realise) ?? asNumber(row.Prevision);
    const current = map.get(key) || {key, label:row.Intitule || key, amount:null, delta:null, color:TAX_COLORS[index % TAX_COLORS.length], source:'', status:'À compléter', history:[]};
    if (rows.some(tax => String(tax.Code || '').toUpperCase() === key)) {
      map.set(key, {...current, _recetteId:row.Recette_ID});
      continue;
    }
    map.set(key, {...current, _recetteId:row.Recette_ID, label:row.Intitule || current.label, amount, source:row.Source || '', status:'Renseigné', history:[...(current.history || []).filter(item => item.year !== year), {year, amount, source:row.Source || '', status:'Renseigné'}].sort((a,b) => a.year - b.year)});
  }
  return [...map.values()];
}

/* La fiche `Entreprises_RS` décrit l'entreprise ; les montants et l'état du
   recouvrement appartiennent à `Suivi_RS_Annuel`. Le portail ne propose que
   trois valeurs administratives dans son formulaire, tandis que son badge
   métier (Soldée / Partielle / Non réglée / À qualifier) est calculé à
   partir des montants. On conserve donc une valeur éditable compatible sans
   déformer les montants annuels qui restent la source du badge. */
function portalRsStatus(situation, amount, paid) {
  const text = String(situation || '').trim();
  if ((amount !== null && amount > 0 && paid !== null && paid >= amount) || /sold/i.test(text)) return 'Soldée';
  if ((paid !== null && paid > 0) || /part|cours|relanc|factur|titre|impay|non.?r[eé]gl/i.test(text)) return 'En cours';
  return 'À compléter';
}

function annualRsKey(companyId, exercise) {
  return `${String(companyId)}::${Number(exercise)}`;
}

function annualCompanyId(reference, companyRows) {
  const direct = String(reference ?? '');
  const referenced = companyRows.find(row => String(row.id) === direct);
  return referenced?.Entreprise_ID || direct;
}

function rsCompanyFromRows(companyRow, annualRow, exercise, previous = {}) {
  const id = companyRow.Entreprise_ID || `rs-${companyRow.id}`;
  const amount = annualRow ? asNumber(annualRow.Montant_Facture) : null;
  const paid = annualRow ? asNumber(annualRow.Montant_Regle) : null;
  const situation = annualRow?.Situation || '';
  return {
    ...previous,
    id,
    name: companyRow.Raison_Sociale || previous.name || 'Entreprise',
    sector: companyRow.Activite || previous.sector || 'À renseigner',
    amount,
    paid,
    status: portalRsStatus(situation, amount, paid),
    siret: String(companyRow.SIRET || previous.siret || ''),
    address: [companyRow.Adresse, companyRow.Commune].filter(Boolean).join(', ') || previous.address || '',
    convention: companyRow.Convention || previous.convention || '',
    /* Compatibilité immédiate avec les noms de colonnes documentaires les
       plus explicites. Si elles n'existent pas encore, l'indicateur reste
       honnêtement « manquant » au lieu de déduire une pièce d'un numéro de
       titre. `Convention` peut toutefois porter une référence réelle déjà
       saisie et vaut alors comme délibération renseignée. */
    deliberationPresent: gristFieldPresent(companyRow.Deliberation)
      || gristFieldPresent(companyRow.Deliberation_Fichier)
      || gristFieldPresent(companyRow.Convention_Fichier)
      || gristFieldPresent(companyRow.Convention),
    avisPresent: gristFieldPresent(annualRow?.Avis_Somme_A_Payer)
      || gristFieldPresent(annualRow?.Avis_Fichier),
    /* Identifiants bruts de pièce jointe, distincts des booléens ci-dessus :
       « présent » suffit au badge, mais « Voir »/« Remplacer » ont besoin du
       véritable identifiant Grist. Toujours relus depuis la ligne live, donc
       jamais figés dans un ancien PORTAL_STATE_JSON — même garantie que pour
       les documents fiscaux. */
    conventionAttachmentId: attachmentId(companyRow.Convention_Fichier) ?? attachmentId(companyRow.Deliberation_Fichier),
    avisAttachmentId: annualRow ? attachmentId(annualRow.Avis_Fichier) : null,
    /* Les observations du suivi sont annuelles. Les notes générales de la
       fiche ne servent que de repli tant qu'aucun suivi n'existe. */
    notes: annualRow ? String(annualRow.Observations || '') : String(companyRow.Notes || previous.notes || ''),
    email: companyRow.Email || previous.email || '',
    contact: companyRow.Responsable || previous.contact || '',
    phone: companyRow.Telephone || previous.phone || '',
    _annual: {
      exists: !!annualRow,
      suiviId: annualRow?.Suivi_ID || `RS-${id}-${exercise}`,
      exercise: Number(exercise),
      situation,
      numeroTitre: annualRow?.Numero_Titre || '',
      dateTitre: annualRow?.Date_Titre || null,
      datePaiement: annualRow?.Date_Paiement || null,
    },
  };
}

function reconcileRsWithGrist(tables, state) {
  const companies = tables.Entreprises_RS || [];
  if (!companies.length) return state;
  const exercise = Number(state.exercise) || 2026;
  const companyRows = tables.Entreprises_RS || [];
  const annualByCompanyYear = new Map((tables.Suivi_RS_Annuel || [])
    .filter(row => row.Entreprise_ID && asNumber(row.Exercice) !== null)
    .map(row => [annualRsKey(annualCompanyId(row.Entreprise_ID, companyRows), row.Exercice), row]));
  const previousById = new Map((state.companies || []).map(company => [String(company.id), company]));

  /* La redevance a commencé en 2024 : un avis ne vit pas que dans l'exercice
     affiché. On relève donc, pour chaque entreprise, l'avis de CHAQUE année
     présente dans le suivi, afin que la fiche puisse les montrer tous — et
     que déposer l'avis 2024 depuis un écran réglé sur 2026 reste possible.
     Les années viennent uniquement de la table, aucune n'est inventée. */
  const avisByCompany = new Map();
  for (const row of tables.Suivi_RS_Annuel || []) {
    const annee = asNumber(row.Exercice);
    if (!row.Entreprise_ID || annee === null) continue;
    const cle = String(annualCompanyId(row.Entreprise_ID, companyRows));
    if (!avisByCompany.has(cle)) avisByCompany.set(cle, {});
    avisByCompany.get(cle)[annee] = attachmentId(row.Avis_Fichier);
  }

  return {
    ...state,
    companies: companies.map(row => {
      const id = row.Entreprise_ID || `rs-${row.id}`;
      const company = rsCompanyFromRows(row, annualByCompanyYear.get(annualRsKey(id, exercise)), exercise, previousById.get(String(id)));
      company.avisByExercise = avisByCompany.get(String(id)) || {};
      return company;
    }),
  };
}

function stateFromTables(tables) {
  const params = new Map((tables.Parametres || []).map(row => [row.Cle, row.Valeur]));
  const saved = params.get(STATE_PARAM);
  let state = null;
  if (saved) {
    try { state = JSON.parse(saved); } catch { /* fall back to structured tables */ }
  }

  const hasSavedState = !!state;
  const users = (tables.Utilisateurs || []).filter(row => row.Actif !== false);
  const visibleUser = users.length === 1 ? users[0] : null;
  const years = [
    ...(tables.Taxes || []).map(row => asNumber(row.Exercice)),
    ...(tables.Budgets || []).map(row => asNumber(row.Exercice)),
    ...(tables.CFU_Synthese || []).map(row => asNumber(row.Exercice)),
    ...(tables.Suivi_RS_Annuel || []).map(row => asNumber(row.Exercice)),
  ].filter(Boolean);
  const preferredExercise = asNumber(localStorage.getItem(EXERCISE_KEY));
  if (!state) {
    state = {
      dataVersion: 8,
      exercise: preferredExercise || (years.length ? Math.max(...years) : 2026),
      meetingMode: String(params.get('MEETING_MODE') || 'false') === 'true',
      taxes: mergeTaxes(tables.Taxes || [], tables.Produits_Recettes || []),
    };
  } else {
    state = {...state, exercise: preferredExercise || asNumber(state.exercise) || (years.length ? Math.max(...years) : 2026)};
  }
  /* Toujours la clé que le portail connaît. L'identité affichée passe par
     window.CADEMA_IDENTITY, jamais par la clé de profil. */
  state.activeProfile = PORTAL_PROFILE;
  const identity = identityFrom(visibleUser);
  if (identity) {
    window.CADEMA_IDENTITY = identity;
    localStorage.setItem(PROFILE_KEY, identity.name);
  }

  if (!hasSavedState && (tables.Taches || []).length) {
    state.tasks = tables.Taches.map(row => ({
      id: row.Tache_ID || `task-${row.id}`,
      title: row.Titre || 'Priorité sans titre',
      status: row.Statut || 'À traiter',
      progress: Math.round((asNumber(row.Progression) || 0) <= 1 ? (asNumber(row.Progression) || 0) * 100 : asNumber(row.Progression)),
      assignees: String(row.Assigne_A || row.Responsable || '').split(/[·,;]/).map(value => value.trim()).filter(Boolean),
      notes: row.Notes ? [{author:row.Dernier_Auteur || row.Responsable || 'Équipe', text:String(row.Notes), date:asIso(row.Derniere_MAJ || row.Date_Creation)}] : [],
    }));
  }
  if (!hasSavedState && (tables.Documents_Fiscaux || []).length) {
    state.docs = tables.Documents_Fiscaux.map(row => ({id:row.Document_ID || `doc-${row.id}`, name:row.Titre || 'Document fiscal', category:row.Type_Document || 'Autre', year:asNumber(row.Exercice) || state.exercise, size:0, createdAt:asIso(row.Date_Ajout), author:row.Ajoute_Par || 'Équipe', link:row.Lien || '', gristAttachmentId:attachmentId(row.Fichier)}));
  }
  if (!hasSavedState && (tables.Calendrier_Fiscal || []).length) {
    state.deadlines = tables.Calendrier_Fiscal.map(row => ({id:row.Evenement_ID || `event-${row.id}`, title:row.Titre || 'Échéance', date:asIso(row.Date_Debut).slice(0,10), owner:row.Responsable || 'Équipe', module:row.Module || 'Pilotage', status:row.Statut || 'À préparer'}));
  }
  if (!hasSavedState && (tables.Messages_Equipe || []).length) {
    state.rsMessages = tables.Messages_Equipe.filter(row => row.Visible_Invites !== false || state.activeProfile !== 'invite').map(row => ({id:row.Message_ID || `message-${row.id}`, companyId:String(row.Canal || '').startsWith('RS:') ? String(row.Canal).slice(3) : null, author:row.Auteur || 'Équipe', authorKey:'equipe', text:row.Message || '', date:asIso(row.Date_Heure)}));
  }
  if (!hasSavedState && (tables.Etablissements_CFE || []).length) {
    state.cfe = {fileName:'Table Grist Etablissements_CFE', rows:tables.Etablissements_CFE.length, importedAt:new Date().toISOString(), visited:tables.Etablissements_CFE.filter(row => row.Derniere_Visite).length, exploited:tables.Etablissements_CFE.filter(row => /exploité/i.test(row.Statut_Terrain || '')).length, vacant:tables.Etablissements_CFE.filter(row => /vacant/i.test(row.Statut_Terrain || '')).length, review:tables.Etablissements_CFE.filter(row => !row.Statut_Terrain).length};
  }
  return reconcileRsWithGrist(tables, state);
}

/* `stateFromTables()` peut renvoyer `Parametres.PORTAL_STATE_JSON` tel quel
   (ligne 223 ci-dessus) : sur un document déjà utilisé, c'est le cas à
   chaque chargement. Un `state.docs` ainsi figé peut dater d'une version
   antérieure du portail et ne plus porter le bon `gristAttachmentId`, alors
   que `Documents_Fiscaux.Fichier` — lu frais à chaque connexion dans
   `tables`, indépendamment de ce court-circuit — dit la vérité. On recale
   donc `docs` sur la table live après coup, par `Document_ID` :
     - une valeur live remplace/complète `gristAttachmentId` ;
     - son absence conserve tel quel ce qu'il y avait déjà (jamais de vide
       écrasant une valeur valide) ;
     - une ligne Grist sans aucun `doc` correspondant en local est ajoutée,
       pour qu'aucun document déjà dans Grist ne puisse rester invisible
       simplement parce que l'état local est ancien.
   Lecture seule : aucune pièce jointe n'est déplacée, recréée ou supprimée
   ici, et rien n'est réécrit vers Grist par cette fonction. */
function reconcileDocsWithGrist(tables, state) {
  const rows = tables.Documents_Fiscaux || [];
  if (!rows.length) return state;
  const byId = new Map(rows.map(row => [row.Document_ID || `doc-${row.id}`, row]));
  const seen = new Set();
  const docs = (state.docs || []).map(doc => {
    const row = byId.get(doc.id);
    if (!row) return doc;
    seen.add(doc.id);
    const live = attachmentId(row.Fichier);
    return live ? {...doc, gristAttachmentId: live} : doc;
  });
  for (const [id, row] of byId) {
    if (seen.has(id)) continue;
    docs.push({
      id, name: row.Titre || 'Document fiscal', category: row.Type_Document || 'Autre',
      year: asNumber(row.Exercice) || state.exercise, size: 0, createdAt: asIso(row.Date_Ajout),
      author: row.Ajoute_Par || 'Équipe', link: row.Lien || '', gristAttachmentId: attachmentId(row.Fichier),
    });
  }
  return {...state, docs};
}

export class CademaGristBridge {
  constructor() {
    this.connected = false;
    this.tables = {};
    this.syncTimer = null;
    this.syncing = false;
    this.lastSavedJson = '';
    this.pendingSyncJson = null;
    this.status = null;
    this.accountingData = null;
    this.pendingAttachments = new Map();
    this.documentHooksInstalled = false;
    this.exerciseHooksInstalled = false;
    this.rsProofHooksInstalled = false;
    this.protectedTables = new Set();
    this.originalSetItem = Storage.prototype.setItem;
    /* Tables réellement lues sur cette session, et colonnes réellement
       présentes. Sans cette trace, une table qui n'a pas pu être chargée
       repartait vide vers Grist et faisait supprimer toutes ses lignes. */
    this.loadedTables = new Set();
    this.columns = new Map();
    this.decorateTimer = null;
  }

  async init() {
    globalThis.CADEMA_BRIDGE_VERSION = BRIDGE_VERSION;
    const inFrame = window.parent !== window;
    if (inFrame && window.grist) {
      try {
        window.grist.ready({requiredAccess:'full'});
        await this.loadTables();
        this.connected = true;
        const hydrated = reconcileDocsWithGrist(this.tables, stateFromTables(this.tables));
        this.hydrated = hydrated;
        this.originalSetItem.call(localStorage, STATE_KEY, JSON.stringify(hydrated));
        this.observeParametres();
      } catch (error) {
        console.error('Connexion Grist indisponible', error);
      }
    }

    /* La liste de profils est posée ICI, sur un chemin unique, et quoi qu'il
       soit arrivé au-dessus.

       `bootstrap.js` fait `await bridge.init()` puis `await import(
       './portal.js')` : l'évaluation du bundle — donc de `rK` — ne peut pas
       commencer avant que cette méthode ait rendu la main. L'ordre est
       garanti par le langage, pas par un délai.

       Le point réellement fragile n'était pas le timing mais la gestion
       d'erreur : `this.connected` passait à `true` AVANT `stateFromTables`,
       si bien qu'un échec de cette étape sautait dans le `catch` en laissant
       `connected` à `true` — et l'ancienne reprise, conditionnée à
       `!this.connected`, ne s'exécutait jamais. Le portail retombait alors
       sur « Utilisateur Grist » seul, de façon intermittente et sans erreur
       visible. On relit donc l'état depuis localStorage, seule source
       commune aux deux chemins, et on installe la liste sans condition. */
    try {
      let state = this.hydrated ?? null;
      if (!state) {
        try { state = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); }
        catch { /* état illisible : `tables` reste une source valable */ }
      }
      this.installProfiles(state);
    } catch (error) {
      console.error('Liste des profils indisponible', error);
    }
    this.patchLocalStorage();
  }

  async loadTables() {
    this.loadedTables.clear();
    this.columns.clear();
    const settled = await Promise.allSettled(TABLE_NAMES.map(async name => {
      const table = await window.grist.docApi.fetchTable(name);
      return [name, columnarToRows(table), Object.keys(table || {})];
    }));
    const failed = [];
    for (const [index, result] of settled.entries()) {
      if (result.status === 'fulfilled') {
        const [name, rows, columns] = result.value;
        this.tables[name] = rows;
        this.loadedTables.add(name);
        this.columns.set(name, new Set(columns));
      } else {
        failed.push(TABLE_NAMES[index]);
      }
    }
    if (!this.tables.Parametres) throw new Error('Table Parametres introuvable');
    if (failed.length) console.warn('Tables Grist non lues, écriture désactivée pour elles :', failed.join(', '));
  }

  patchLocalStorage() {
    const bridge = this;
    Storage.prototype.setItem = function(key, value) {
      /* Le sélecteur d'exercice ne remplace, côté React, que le numéro de
         l'année. Sans ce raccord, les entreprises garderaient à l'écran les
         montants de l'exercice précédent. Avant d'enregistrer le nouvel
         état, on remplace donc uniquement le portefeuille RS par les lignes
         annuelles correspondant à l'année choisie. Les autres modules ne
         sont pas touchés. */
      if (this === localStorage && key === STATE_KEY) {
        try {
          const incoming = JSON.parse(value);
          const previous = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
          const incomingExercise = asNumber(incoming.exercise);
          const previousExercise = asNumber(previous?.exercise);
          if (incomingExercise) bridge.originalSetItem.call(localStorage, EXERCISE_KEY, String(incomingExercise));
          if (incomingExercise && previousExercise && incomingExercise !== previousExercise) {
            value = JSON.stringify(reconcileRsWithGrist(bridge.tables, incoming));
          }
        } catch {}
      }
      /* L'envoi du fichier et l'ajout du document dans React sont deux
         opérations asynchrones. Si l'upload Grist finit avant que React ait
         persisté la nouvelle ligne, on conserve temporairement l'identifiant
         de pièce jointe puis on l'injecte dans la première sauvegarde qui
         contient réellement le document. Sans ce raccord, le fichier existe
         dans Grist mais le bouton « Voir » ne sait plus le retrouver. */
      if (this === localStorage && key === STATE_KEY && bridge.pendingAttachments.size) {
        try {
          const state = JSON.parse(value);
          const docs = Array.isArray(state.docs) ? state.docs : [];
          let changed = false;
          for (const [fileName, attachmentId] of bridge.pendingAttachments) {
            const doc = [...docs].reverse().find(item => item?.name === fileName);
            if (!doc) continue;
            if (!doc.gristAttachmentId) {
              doc.gristAttachmentId = attachmentId;
              changed = true;
            }
            bridge.pendingAttachments.delete(fileName);
          }
          if (changed) value = JSON.stringify(state);
        } catch {}
      }
      bridge.originalSetItem.call(this, key, value);
      if (this === localStorage && key === STATE_KEY && bridge.connected) bridge.queueSync(value);
    };
  }

  queueSync(json) {
    clearTimeout(this.syncTimer);
    /* V21 — rien de neuf à envoyer : on ne prétend pas enregistrer. En V20,
       le statut passait à « Enregistrement… » puis n'en sortait jamais. */
    if (!this.syncing && json === this.lastSavedJson) {
      this.setStatus('ok', 'Synchronisé avec Grist');
      return;
    }
    this.setStatus('pending', 'Enregistrement dans Grist…');
    this.syncTimer = setTimeout(() => this.syncState(json), 900);
  }

  async syncState(json) {
    /* V21 — une modification arrivée pendant un envoi en cours était
       abandonnée en V20 : elle n'atteignait Grist qu'à la modification
       suivante, ou jamais si l'onglet était fermé entre-temps. On garde la
       plus récente et on l'envoie dès que l'envoi en cours se termine. */
    if (this.syncing) {
      this.pendingSyncJson = json;
      return;
    }
    if (json === this.lastSavedJson) {
      this.setStatus('ok', 'Synchronisé avec Grist');
      return;
    }
    this.syncing = true;
    try {
      const state = JSON.parse(json);
      await this.upsertParam(STATE_PARAM, json, 'Synchronisation', 'État complet du portail V19');
      await this.upsertParam(UPDATED_PARAM, new Date().toISOString(), 'Synchronisation', 'Dernière synchronisation du widget');
      await this.syncDomainTables(state);
      this.lastSavedJson = json;
      this.setStatus('ok', 'Synchronisé avec Grist');
    } catch (error) {
      console.error('Erreur de synchronisation Grist', error);
      this.setStatus('error', 'Grist en lecture seule ou indisponible');
    } finally {
      this.syncing = false;
      const next = this.pendingSyncJson;
      this.pendingSyncJson = null;
      if (next !== null && next !== this.lastSavedJson) {
        this.setStatus('pending', 'Enregistrement dans Grist…');
        this.syncState(next);
      }
    }
  }

  async upsertParam(key, value, category, description) {
    const rows = columnarToRows(await window.grist.docApi.fetchTable('Parametres'));
    const current = rows.find(row => row.Cle === key);
    const fields = {Valeur:value, Categorie:category, Description:description, Modifiable_Par:'Administrateur'};
    const action = current ? ['UpdateRecord','Parametres',current.id,fields] : ['AddRecord','Parametres',null,{Cle:key,...fields}];
    await window.grist.docApi.applyUserActions([action]);
  }

  async syncDomainTables(state) {
    const taxRows = (state.taxes || []).map((tax, index) => ({
      Taxe_ID:tax._gristId || `PORTAL-${tax.key}`,
      Code:tax.key,
      Intitule:tax.label,
      Exercice:state.exercise,
      Produit:tax.history?.find(item => item.year === state.exercise)?.amount ?? tax.amount,
      Responsable:'',
      Statut:tax.status || 'Suivi',
      Source:tax.history?.find(item => item.year === state.exercise)?.source || tax.source || 'Portail fiscal',
      Derniere_MAJ:gristDate(new Date()),
    }));
    await this.syncTable('Taxes','Taxe_ID',taxRows);
    await this.syncTable('Produits_Recettes','Recette_ID',(state.taxes || []).map(tax => {
      const amount = tax.history?.find(item => item.year === state.exercise)?.amount ?? tax.amount;
      return {Recette_ID:tax._recetteId || `PORTAL-${tax.key}-${state.exercise}`,Code_Produit:tax.key,Intitule:tax.label,Exercice:state.exercise,Budget:'Budget principal',Prevision:amount,Realise:amount,Ecart:0,Taux_Execution:amount === null ? null : 1,Source:tax.history?.find(item => item.year === state.exercise)?.source || tax.source || 'Portail fiscal',Date_MAJ:gristDate(new Date())};
    }));
    await this.syncTable('Taches','Tache_ID',(state.tasks || []).map(task => ({Tache_ID:task.id,Titre:task.title,Module:'Pôle fiscalité',Priorite:'Normale',Statut:task.status,Responsable:(task.assignees || [])[0] || '',Assigne_A:(task.assignees || []).join(' · '),Progression:(asNumber(task.progress) || 0) / 100,Notes:(task.notes || []).map(note => note.text).join('\n'),Dernier_Auteur:(task.notes || []).at(-1)?.author || '',Derniere_MAJ:gristDate(new Date())})));
    await this.syncTable('Documents_Fiscaux','Document_ID',(state.docs || []).map(doc => ({Document_ID:doc.id,Type_Document:doc.category,Exercice:doc.year,Titre:doc.name,Module:'Fiscalité',Fichier:doc.gristAttachmentId ? ['L',doc.gristAttachmentId] : undefined,Lien:doc.link || '',Confidentialite:'Équipe',Ajoute_Par:doc.author || 'Équipe',Date_Ajout:gristDate(doc.createdAt),Version:'1.0',Statut:'Classé'})));
    /* Email et téléphone n'étaient ni lus ni réécrits : toute saisie sur la
       fiche entreprise disparaissait au rechargement. On les réécrit
       uniquement si la colonne existe réellement dans Grist, pour ne pas
       faire échouer tout le lot d'écritures. */
    const rsColumns = this.columns.get('Entreprises_RS') || new Set();
    await this.syncTable('Entreprises_RS','Entreprise_ID',(state.companies || []).map(company => ({
      Entreprise_ID:company.id, SIRET:company.siret || '', Raison_Sociale:company.name,
      Adresse:company.address || '', Activite:company.sector || '', Convention:company.convention || '',
      /* Montants, paiements, situation et observations sont annuels : ils
         sont écrits juste après dans `Suivi_RS_Annuel`, jamais rabattus sur
         la fiche entreprise générale. */
      Responsable:company.contact || '',
      Email:rsColumns.has('Email') ? (company.email || '') : undefined,
      Telephone:rsColumns.has('Telephone') ? (company.phone || '') : undefined,
    })));
    await this.syncRsAnnual(state);
    await this.syncTable('Calendrier_Fiscal','Evenement_ID',(state.deadlines || []).map(event => ({Evenement_ID:event.id,Titre:event.title,Module:event.module || 'Pilotage',Date_Debut:gristDate(event.date),Date_Fin:gristDate(event.date),Responsable:event.owner || 'Équipe',Priorite:'Normale',Statut:event.status || 'Planifié',Recurrence:'Aucune',Notes:''})));
    await this.syncTable('Messages_Equipe','Message_ID',(state.rsMessages || []).map(message => ({Message_ID:message.id,Canal:message.companyId ? `RS:${message.companyId}` : 'Général',Auteur:message.author || 'Équipe',Message:message.text || '',Date_Heure:gristDate(message.date),Lu:false,Visible_Invites:false,Message_Parent_ID:''})));
  }

  async syncRsAnnual(state) {
    if (!this.loadedTables.has('Suivi_RS_Annuel')) {
      console.warn('Synchronisation RS annuelle ignorée : table non lue au démarrage.');
      return;
    }
    let table;
    try { table = await window.grist.docApi.fetchTable('Suivi_RS_Annuel'); }
    catch { return; }
    const current = columnarToRows(table);
    const companyRows = this.tables.Entreprises_RS || [];
    const existing = new Map(current
      .filter(row => row.Entreprise_ID && asNumber(row.Exercice) !== null)
      .map(row => [annualRsKey(annualCompanyId(row.Entreprise_ID, companyRows), row.Exercice), row]));
    const exercise = asNumber(state.exercise);
    if (!exercise) return;
    const columns = this.columns.get('Suivi_RS_Annuel') || new Set(Object.keys(table || {}));
    const actions = [];

    for (const company of state.companies || []) {
      if (!company?.id) continue;
      const row = existing.get(annualRsKey(company.id, exercise));
      const companyRecord = companyRows.find(item => String(item.Entreprise_ID || `rs-${item.id}`) === String(company.id));
      const entrepriseReference = current.some(item => typeof item.Entreprise_ID === 'number')
        ? companyRecord?.id
        : company.id;
      const annual = company._annual || {};
      const hasAnnualData = company.amount !== null && company.amount !== undefined
        || company.paid !== null && company.paid !== undefined
        || (company.status && company.status !== 'À compléter');
      /* Changer simplement d'année ne doit jamais fabriquer 106 lignes
         vides. Une ligne est créée seulement après une vraie saisie. */
      if (!row && !hasAnnualData) continue;
      const hydratedStatus = portalRsStatus(annual.situation, asNumber(company.amount), asNumber(company.paid));
      const situation = row && annual.situation && company.status === hydratedStatus
        ? annual.situation
        : (company.status || hydratedStatus);
      const fields = cleanFields({
        Suivi_ID: row?.Suivi_ID || annual.suiviId || `RS-${company.id}-${exercise}`,
        Entreprise_ID: entrepriseReference ?? company.id,
        Exercice: exercise,
        /* Une situation Grist plus précise (« À vérifier », « Non réglée »…)
           est conservée tant que l'utilisateur n'a pas changé le statut dans
           le formulaire simplifié du portail. */
        Situation: situation,
        Montant_Facture: asNumber(company.amount),
        Montant_Regle: asNumber(company.paid),
        Numero_Titre: columns.has('Numero_Titre') ? (annual.numeroTitre || row?.Numero_Titre || '') : undefined,
        Date_Titre: columns.has('Date_Titre') ? gristDateValue(annual.dateTitre ?? row?.Date_Titre) : undefined,
        Date_Paiement: columns.has('Date_Paiement') ? gristDateValue(annual.datePaiement ?? row?.Date_Paiement) : undefined,
        Observations: columns.has('Observations') ? (company.notes || '') : undefined,
        Derniere_MAJ: columns.has('Derniere_MAJ') ? gristDate(new Date()) : undefined,
      });
      actions.push(row
        ? ['UpdateRecord', 'Suivi_RS_Annuel', row.id, fields]
        : ['AddRecord', 'Suivi_RS_Annuel', null, fields]);
    }

    for (let index = 0; index < actions.length; index += 50) {
      await window.grist.docApi.applyUserActions(actions.slice(index, index + 50));
    }
    if (actions.length) {
      const refreshed = await window.grist.docApi.fetchTable('Suivi_RS_Annuel');
      this.tables.Suivi_RS_Annuel = columnarToRows(refreshed);
      this.columns.set('Suivi_RS_Annuel', new Set(Object.keys(refreshed || {})));
    }
  }

  async syncTable(tableName, keyColumn, desiredRows) {
    /* Une table qui n'a pas pu être lue au démarrage n'a pas alimenté l'état
       local : la réécrire reviendrait à effacer son contenu dans Grist. */
    if (!this.loadedTables.has(tableName)) {
      console.warn(`Synchronisation ignorée pour ${tableName} : table non lue au démarrage.`);
      return;
    }

    let current;
    try { current = columnarToRows(await window.grist.docApi.fetchTable(tableName)); }
    catch { return; }

    const existing = new Map(current.filter(row => row[keyColumn]).map(row => [String(row[keyColumn]), row]));
    const desired = new Map(desiredRows.filter(row => row[keyColumn]).map(row => [String(row[keyColumn]), cleanFields(row)]));

    /* Un état local vide face à une table peuplée n'est jamais une suppression
       volontaire de tout le contenu : c'est un état non hydraté. On refuse. */
    if (!desired.size && existing.size) {
      this.setStatus('error', `${tableName} protégée : état local vide, aucune écriture`);
      console.warn(`Écriture refusée sur ${tableName} : ${existing.size} ligne(s) auraient été supprimées.`);
      return;
    }

    const actions = [];
    for (const [key, fields] of desired) {
      const row = existing.get(key);
      actions.push(row ? ['UpdateRecord',tableName,row.id,fields] : ['AddRecord',tableName,null,fields]);
    }

    const removals = [...existing].filter(([key]) => !desired.has(key));
    /* Une suppression massive (plus de la moitié de la table) relève de
       l'accident, pas de l'usage : on la bloque.

       Ce garde-fou se déclenche en usage normal : l'état local vient du
       snapshot `PORTAL_STATE_JSON`, qui peut être plus ancien que la table
       Grist. Rien n'échoue pour autant — les ajouts et mises à jour de la
       même passe sont bien appliqués juste en dessous, et aucune ligne n'est
       perdue. L'annoncer en rouge à chaque enregistrement faisait donc
       passer une protection qui fonctionne pour une panne. On le trace
       systématiquement dans la console, et on ne le dit à l'écran qu'une
       fois par table et par session, sans couleur d'erreur. */
    if (removals.length && removals.length > existing.size / 2 && existing.size > 3) {
      console.warn(`Suppression de ${removals.length}/${existing.size} lignes refusée sur ${tableName}.`);
      if (!this.protectedTables.has(tableName)) {
        this.protectedTables.add(tableName);
        this.setStatus('preview', `${tableName} : lignes Grist plus anciennes conservées`);
      }
    } else {
      for (const [, row] of removals) actions.push(['RemoveRecord',tableName,row.id]);
    }

    for (let index = 0; index < actions.length; index += 50) {
      await window.grist.docApi.applyUserActions(actions.slice(index, index + 50));
    }
  }

  observeParametres() {
    if (!window.grist?.onRecords) return;
    window.grist.onRecords(records => {
      const stateRow = (records || []).find(row => row.Cle === STATE_PARAM);
      if (!stateRow?.Valeur || stateRow.Valeur === this.lastSavedJson || this.syncing) return;
      this.offerRemoteRefresh(stateRow.Valeur);
    });
  }

  offerRemoteRefresh(json) {
    try { JSON.parse(json); } catch { return; }
    if (document.hidden) {
      this.originalSetItem.call(localStorage, STATE_KEY, json);
      location.reload();
      return;
    }
    if (document.querySelector('.cadema-team-update')) return;
    const banner = document.createElement('div');
    banner.className = 'cadema-team-update';
    banner.innerHTML = '<span>Une modification de l’équipe est disponible.</span><button>Actualiser le portail</button><button class="later" aria-label="Fermer">×</button>';
    banner.querySelector('button').addEventListener('click', () => { this.originalSetItem.call(localStorage, STATE_KEY, json); location.reload(); });
    banner.querySelector('.later').addEventListener('click', () => banner.remove());
    document.body.appendChild(banner);
  }

  watchPortal() {
    this.installDocumentHooks();
    this.installProfileMemory();
    this.installExerciseHooks();
    this.installRsProofHooks();
    /* Sans débounce, chaque mutation du DOM relançait un parcours complet de
       tous les <b>, <small>, <p>, <span> et <dd> de la page. Sur un portail de
       cette taille, c'est un coût CPU permanent. */
    const observer = new MutationObserver(() => {
      if (this.decorateTimer) return;
      this.decorateTimer = requestAnimationFrame(() => {
        this.decorateTimer = null;
        this.autoEnter();
        this.decoratePortal();
        this.injectAccountingButton();
        this.installSkipLink();
        this.injectFooter();
        this.decorateIdentity();
        this.decorateHome();
        this.decoratePriorities();
        this.decorateDocuments();
        this.decorateRs();
        this.restorePageAfterExerciseChange();
      });
    });
    observer.observe(document.body, {childList:true, subtree:true});
    this.autoEnter();
  }

  installExerciseHooks() {
    if (this.exerciseHooksInstalled) return;
    this.exerciseHooksInstalled = true;
    document.addEventListener('change', event => {
      const select = event.target.closest?.('.top-actions select');
      if (!this.connected || !select) return;
      const exercise = asNumber(select.value);
      if (!exercise) return;
      this.originalSetItem.call(localStorage, EXERCISE_KEY, String(exercise));
      const currentPage = document.querySelector('.crumb b')?.textContent?.trim();
      if (currentPage) sessionStorage.setItem(EXERCISE_RETURN_KEY, currentPage);
      this.setStatus('pending', `Chargement de l’exercice ${exercise}…`);
      /* React a besoin d'un rendu pour fermer proprement le changement. Le
         rechargement suivant repart ensuite de la préférence d'exercice et
         des lignes Grist fraîches, sans afficher un instant les montants de
         l'année précédente comme s'ils appartenaient à la nouvelle. */
      setTimeout(() => location.reload(), 180);
    }, true);
  }

  restorePageAfterExerciseChange() {
    const label = sessionStorage.getItem(EXERCISE_RETURN_KEY);
    if (!label) return;
    const buttons = [...document.querySelectorAll('.sidebar nav button, .sidebar-foot button')];
    const target = buttons.find(button => button.querySelector('b')?.textContent?.trim() === label);
    if (!target) return;
    sessionStorage.removeItem(EXERCISE_RETURN_KEY);
    if (!target.classList.contains('active')) target.click();
  }

  /* Lien d'évitement : le portail place 9 entrées de menu et une barre
     supérieure avant le contenu. Sans ce lien, un utilisateur au clavier
     traverse toute la navigation à chaque changement d'écran. */
  installSkipLink() {
    if (document.querySelector('.cadema-skip')) return;
    const main = document.querySelector('.main');
    if (!main) return;
    if (!main.id) main.id = 'contenu-principal';
    main.setAttribute('tabindex', '-1');
    const link = document.createElement('a');
    link.className = 'cadema-skip';
    link.href = '#contenu-principal';
    link.textContent = 'Aller au contenu';
    document.body.insertBefore(link, document.body.firstChild);
  }

  /* Le portail lui-même porte déjà cette mention sur son tout premier écran
     (`.login-panel footer`), qu'`autoEnter()` saute la plupart du temps :
     elle ne s'affiche donc quasiment jamais. On la répète en pied de chaque
     page de l'application, dans `.main` — qui reste monté d'une page à
     l'autre, seul son contenu change — pour qu'elle soit enfin visible.
     Un seul `<footer>`, réinséré s'il disparaît lors d'un rendu React qui
     recrée `.main`. */
  injectFooter() {
    const main = document.querySelector('.main');
    if (!main) return;
    if (main.querySelector(':scope > .cadema-footer')) return;
    const footer = document.createElement('footer');
    footer.className = 'cadema-footer';
    footer.innerHTML = '© 2026, Made with <span aria-hidden="true">❤️</span> by Dina-Ben';
    main.appendChild(footer);
  }

  /* L'accueil affiche « N alerte(s) critique(s) » dans la tuile de maîtrise,
     mais rien ne distingue N = 0 de N = 4 : c'est du texte gris parmi
     d'autres. On relit le nombre déjà rendu et on le reporte en attribut,
     pour que la feuille de style puisse hausser le ton — et seulement quand
     il y a réellement quelque chose à signaler.
     Aucune donnée n'est créée : on ne fait que relire ce que le portail
     vient d'écrire lui-même. */
  decorateHome() {
    const tile = document.querySelector('.home-hero-kpis > button:nth-child(3)');
    if (!tile) return;
    const label = tile.querySelector('span')?.textContent || '';
    const found = label.match(/(\d+)\s*alerte/);
    if (!found) return;
    const count = Number(found[1]);
    const level = count === 0 ? 'nulle' : count <= 2 ? 'vigilance' : 'critique';
    if (tile.dataset.alerte !== level) tile.dataset.alerte = level;
    const texte = count === 0
      ? 'Maîtrise des données : aucune alerte critique'
      : `Maîtrise des données : ${count} alerte${count > 1 ? 's' : ''} critique${count > 1 ? 's' : ''}`;
    if (tile.getAttribute('aria-label') !== texte) tile.setAttribute('aria-label', texte);
  }

  /* Les responsables réels d'une priorité sont stockés dans `assignees` et
     réécrits dans `Taches.Assigne_A`. Mais la carte de priorité ne les
     affiche nulle part : elle ne montre que des pastilles d'affectation
     construites sur la liste des profils du portail, qui n'en compte qu'un.
     Résultat : une priorité confiée à deux agents apparaît sans aucun
     responsable.

     On réaffiche donc, en lecture seule, ce que la donnée contient déjà.
     Aucune donnée n'est créée, aucune n'est modifiée, aucun nouveau moyen
     d'affectation n'est ajouté : c'est de l'affichage. */
  decoratePriorities() {
    const cards = document.querySelectorAll('.priority-card[id^="priority-"]');
    if (!cards.length) return;
    let tasks;
    try { tasks = JSON.parse(localStorage.getItem(STATE_KEY) || '{}').tasks || []; }
    catch { return; }
    if (!Array.isArray(tasks)) return;

    for (const card of cards) {
      const task = tasks.find(t => `priority-${t.id}` === card.id);
      if (!task) continue;
      const noms = Array.isArray(task.assignees) ? task.assignees.filter(Boolean) : [];
      const signature = noms.join('|');
      let row = card.querySelector(':scope > .cadema-responsables');
      if (row && row.dataset.signature === signature) continue;
      if (!row) {
        row = document.createElement('div');
        row.className = 'cadema-responsables';
        card.querySelector('h3')?.insertAdjacentElement('afterend', row);
      }
      row.dataset.signature = signature;
      row.innerHTML = '';
      if (!noms.length) {
        row.dataset.vide = 'true';
        row.textContent = 'Responsable à désigner';
        row.setAttribute('aria-label', 'Aucun responsable désigné');
        continue;
      }
      delete row.dataset.vide;
      row.setAttribute('aria-label', `Responsable${noms.length > 1 ? 's' : ''} : ${noms.join(', ')}`);
      for (const nom of noms) {
        const chip = document.createElement('span');
        chip.className = 'cadema-responsable';
        const ini = document.createElement('i');
        ini.textContent = nom.trim().slice(0, 1).toUpperCase();
        ini.setAttribute('aria-hidden', 'true');
        const lbl = document.createElement('b');
        lbl.textContent = nom;
        chip.append(ini, lbl);
        row.appendChild(chip);
      }
    }
  }

  /* Le module Documents fiscaux vient d'un gabarit générique où chaque pièce
     reste dans l'IndexedDB du navigateur : « Aucun envoi en ligne », « Données
     conservées sur ce PC », le badge « Privé »… Depuis que ce portail écrit
     les fichiers dans les pièces jointes Grist (`uploadDocument`), ce discours
     est faux et trompeur sur la confidentialité réelle des pièces fiscales :
     tout document ajouté est en fait partagé avec toute l'équipe via Grist.
     On ne corrige ce texte que si la connexion Grist est effective — sinon
     le document reste réellement local et le message d'origine est vrai. */
  decorateDocuments() {
    const root = document.querySelector('.documents-command');
    if (!root) return;
    if (!this.connected) return;
    const replacements = new Map([
      ['Aucun envoi en ligne', 'Pièces jointes Grist'],
      ['Données conservées sur ce PC', 'Partagées avec toute l’équipe'],
      ['Un coffre de travail local pour retrouver, contrôler et exploiter chaque pièce fiscale.',
        'Un centre documentaire partagé pour retrouver, contrôler et exploiter chaque pièce fiscale.'],
      ['Les fichiers restent dans le navigateur de cet appareil et sont inclus dans votre sauvegarde JSON complète.',
        'Les fichiers sont conservés comme pièces jointes dans Grist et visibles par toute l’équipe.'],
    ]);
    for (const element of root.querySelectorAll('b, small, p, span, dd')) {
      const text = element.textContent?.trim();
      if (replacements.has(text) && element.children.length === 0) element.textContent = replacements.get(text);
    }
    const badge = root.querySelector('.local-badge');
    if (badge) {
      for (const node of badge.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() === 'Privé') node.textContent = 'Équipe';
      }
    }
  }

  /* La fiche RS est maintenant reliée à `Suivi_RS_Annuel`. Les mentions de
     stockage local du gabarit d'origine deviennent donc fausses, au même
     titre que celles déjà corrigées dans le centre documentaire. */
  decorateRs() {
    const root = document.querySelector('.rs-command, .company-page');
    if (!root || !this.connected) return;
    const replacements = new Map([
      ['Données locales', 'Données Grist'],
      ['Saisi localement', 'Saisi dans Grist'],
      ['Conservées sur cet appareil', 'Enregistrées dans le suivi annuel'],
      ['Entreprise ajoutée localement', 'Entreprise enregistrée dans Grist'],
      ['Entreprise supprimée de cet appareil', 'Entreprise supprimée du suivi partagé'],
    ]);
    for (const element of root.querySelectorAll('b, small, p, span, dd')) {
      const value = element.textContent?.trim();
      if (replacements.has(value) && element.children.length === 0) element.textContent = replacements.get(value);
    }

    let companies;
    try { companies = JSON.parse(localStorage.getItem(STATE_KEY) || '{}').companies || []; }
    catch { return; }
    const byName = new Map(companies.map(company => [String(company.name || '').trim(), company]));

    /* Plus aucun indicateur de pièces dans le portefeuille : sur une colonne
       « Entreprise » déjà étroite, il volait la largeur du nom, qui passait
       à la ligne. L'état des pièces se lit sur la fiche, là où on agit
       dessus. Reste ici ce qui compte vraiment : les montants.

       « Soldée » est en revanche le seul état qui mérite d'être vu de loin.
       Le portail lui donne bien une pastille verte (`.payment-soldée`), mais
       une règle plus spécifique ajoutée plus tard — `.rs-table em` — repeint
       tout en gris, et ses variantes colorées visent des classes (`.paid`,
       `.s-finalis`) que ce module n'émet pas. On marque donc la ligne en
       ASCII pur (`data-cadema-paid`), sans dépendre d'un sélecteur accentué
       dont l'encodage peut différer entre la feuille et le bundle. */
    for (const badge of root.querySelectorAll('.rs-table em, .rs-card-top em, .company-spotlight-status em')) {
      const solde = /^sold/i.test(badge.textContent?.trim() || '');
      if (solde) badge.dataset.cademaPaid = 'oui';
      else delete badge.dataset.cademaPaid;
    }

    /* Aucune rangée de badges sur la fiche non plus : l'état de chaque pièce
       est porté par son propre bloc de dépôt, sous le champ concerné. */
    let exercice = null;
    try { exercice = asNumber(JSON.parse(localStorage.getItem(STATE_KEY) || '{}').exercise); } catch {}
    this.injectRsExerciseSelector(exercice);
    this.decorateCompanyProofs(byName);
  }

  /* « Bonjour Utilisateur Grist » persiste tant que le portail n'a pas su
     QUI est connecté. Grist ne fournit aucune identité à un widget : la
     seule source fiable serait une règle d'accès limitant `Utilisateurs` à
     sa propre ligne (voir README, étape 3), ce que le compte propriétaire
     du document contourne de toute façon en voyant toutes les lignes.

     On rend donc le choix explicite et permanent, à côté du nom affiché :
     une liste des membres réellement présents dans `Utilisateurs` ou parmi
     les responsables des priorités. Le choix est mémorisé et rejoué à
     chaque chargement. Si cette liste est vide, on le dit — c'est alors une
     question de données, pas d'interface, et l'inventer serait pire. */
  decorateIdentity() {
    const chip = document.querySelector('.profile-chip');
    if (!chip?.parentElement) return;
    const profils = Array.isArray(window.CADEMA_PROFILS) ? window.CADEMA_PROFILS : [];
    const membres = profils.filter(profil => profil.key !== PORTAL_PROFILE);
    const actuel = chip.querySelector('b')?.textContent?.trim() || '';
    const signature = `${actuel}|${membres.map(profil => profil.name).join(',')}`;
    const existing = chip.parentElement.querySelector(':scope > .cadema-identity');
    if (existing?.dataset.signature === signature) return;
    existing?.remove();

    const wrap = document.createElement('div');
    wrap.className = 'cadema-identity';
    wrap.dataset.signature = signature;

    if (!membres.length) {
      const note = document.createElement('small');
      note.textContent = 'Aucun membre trouvé dans Utilisateurs ni dans les responsables des priorités.';
      wrap.appendChild(note);
      chip.insertAdjacentElement('afterend', wrap);
      return;
    }

    const label = document.createElement('small');
    label.textContent = 'Vous êtes';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Choisir votre profil');
    const defaut = document.createElement('option');
    defaut.value = '';
    defaut.textContent = 'Choisir…';
    select.appendChild(defaut);
    for (const membre of membres) {
      const option = document.createElement('option');
      option.value = membre.name;
      option.textContent = membre.name;
      if (membre.name === actuel) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      if (!select.value) return;
      this.originalSetItem.call(localStorage, PROFILE_KEY, select.value);
      this.setStatus('pending', `Ouverture du profil ${select.value}…`);
      setTimeout(() => location.reload(), 150);
    });
    wrap.append(label, select);
    chip.insertAdjacentElement('afterend', wrap);
  }

  /* Le sélecteur d'exercice n'existait qu'en haut de page, loin du module :
     on ne voyait donc pas que les montants, les situations et le compte des
     entreprises soldées dépendent de l'année choisie. On le rappelle dans la
     barre du portefeuille, branché sur le mécanisme existant — même
     préférence enregistrée, même rechargement — sans dupliquer la logique.
     Les années proposées viennent du suivi réel, jamais d'une liste figée. */
  injectRsExerciseSelector(exercise) {
    const toolbar = document.querySelector('.rs-toolbar');
    if (!toolbar || !exercise) return;
    const existing = toolbar.querySelector(':scope > .cadema-rs-exercise');
    if (existing?.dataset.exercise === String(exercise)) return;
    existing?.remove();

    const annees = [...new Set([
      ...(this.tables.Suivi_RS_Annuel || []).map(row => asNumber(row.Exercice)).filter(Boolean),
      exercise,
    ])].sort((a, b) => b - a);
    if (annees.length < 2) return;

    const wrap = document.createElement('label');
    wrap.className = 'cadema-rs-exercise';
    wrap.dataset.exercise = String(exercise);
    const titre = document.createElement('small');
    titre.textContent = 'Exercice';
    const select = document.createElement('select');
    for (const annee of annees) {
      const option = document.createElement('option');
      option.value = String(annee);
      option.textContent = String(annee);
      if (annee === exercise) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      const choisi = asNumber(select.value);
      if (!choisi || choisi === exercise) return;
      this.originalSetItem.call(localStorage, EXERCISE_KEY, String(choisi));
      const page = document.querySelector('.crumb b')?.textContent?.trim();
      if (page) sessionStorage.setItem(EXERCISE_RETURN_KEY, page);
      this.setStatus('pending', `Chargement de l’exercice ${choisi}…`);
      setTimeout(() => location.reload(), 180);
    });
    wrap.append(titre, select);
    toolbar.appendChild(wrap);
  }

  /* Sur la fiche, la convention et l'avis doivent pouvoir être déposés, pas
     seulement constatés : le gabarit d'origine n'offre qu'un champ texte
     « Convention / référence » et rien du tout pour l'avis. On ajoute donc
     les deux dépôts manquants juste à côté des champs qu'ils complètent — la
     convention avec l'identité de l'entreprise, l'avis avec la facturation,
     puisqu'il appartient à l'exercice affiché et non à l'entreprise. */
  decorateCompanyProofs(byName) {
    const page = document.querySelector('.company-page');
    if (!page) return;
    const company = byName.get(page.querySelector('.company-title h1')?.textContent?.trim() || '');
    if (!company) return;
    let exercise = null;
    try { exercise = asNumber(JSON.parse(localStorage.getItem(STATE_KEY) || '{}').exercise); } catch {}
    const conventionAnchor = page.querySelector('.company-edit-panel input[name="convention"]')?.closest('label');
    const financeAnchor = page.querySelector('.company-edit-panel .finance-fields');
    if (!conventionAnchor && !financeAnchor) return;

    const signature = [
      company.id,
      company.conventionAttachmentId ?? '',
      exercise ?? '',
      JSON.stringify(company.avisByExercise || {}),
    ].join('|');
    if (page.querySelector('.cadema-rs-piece')?.dataset.signature === signature) return;
    for (const stale of page.querySelectorAll('.cadema-rs-piece')) stale.remove();

    const piece = (kind, titre, sous_titre, fileId, annee = exercise) => {
      const block = document.createElement('div');
      block.className = `cadema-rs-piece${fileId ? ' present' : ''}`;
      block.dataset.signature = signature;
      block.dataset.kind = kind;
      block.dataset.companyId = company.id;
      if (annee) block.dataset.exercise = String(annee);

      /* L'état se lit sur la ligne elle-même : une pastille, un libellé,
         et la phrase qui dit où se trouve la pièce. Pas de badge séparé. */
      const mark = document.createElement('i');
      mark.className = 'cadema-rs-piece-mark';
      mark.textContent = fileId ? '✓' : '!';
      mark.setAttribute('aria-hidden', 'true');

      const identity = document.createElement('div');
      const label = document.createElement('b');
      label.textContent = titre;
      const hint = document.createElement('small');
      hint.textContent = fileId ? `${sous_titre} · pièce jointe dans Grist` : `${sous_titre} · à déposer`;
      identity.append(label, hint);

      const actions = document.createElement('div');
      actions.className = 'cadema-rs-piece-actions';
      if (fileId) {
        const voir = document.createElement('button');
        voir.type = 'button';
        voir.dataset.action = 'open';
        voir.dataset.attachment = String(fileId);
        voir.textContent = 'Voir';
        actions.appendChild(voir);
      }
      const deposer = document.createElement('button');
      deposer.type = 'button';
      deposer.dataset.action = 'upload';
      deposer.className = fileId ? '' : 'primary';
      deposer.textContent = fileId ? 'Remplacer' : 'Déposer le fichier';
      const input = document.createElement('input');
      input.type = 'file';
      input.hidden = true;
      actions.append(deposer, input);

      block.append(mark, identity, actions);
      return block;
    };

    if (conventionAnchor) {
      conventionAnchor.insertAdjacentElement('afterend',
        piece('convention', 'Convention', 'Une seule pour l’entreprise', company.conventionAttachmentId));
    }
    if (financeAnchor) {
      /* Un avis par exercice, du plus récent au plus ancien. Les années
         viennent du suivi réel, complétées par l'exercice affiché : on peut
         donc déposer l'avis 2024 sans quitter l'écran réglé sur 2026. */
      const avis = company.avisByExercise || {};
      const annees = [...new Set([...Object.keys(avis).map(Number), exercise].filter(Boolean))]
        .sort((a, b) => b - a);
      for (const annee of annees.reverse()) {
        financeAnchor.insertAdjacentElement('afterend',
          piece('avis', 'Avis de somme à payer', `Exercice ${annee}`, avis[annee] ?? null, annee));
      }
    }
  }

  /* Dépôt des pièces RS : même chaîne que les documents fiscaux (envoi dans
     les pièces jointes Grist, puis écriture de la ligne métier), mais aucune
     ligne n'est créée tant que Grist n'a pas confirmé l'identifiant. */
  installRsProofHooks() {
    if (this.rsProofHooksInstalled) return;
    this.rsProofHooksInstalled = true;
    document.addEventListener('click', event => {
      const button = event.target.closest?.('.cadema-rs-piece button');
      if (!this.connected || !button) return;
      event.preventDefault();
      const block = button.closest('.cadema-rs-piece');
      if (button.dataset.action === 'open') {
        const id = Number(button.dataset.attachment);
        if (Number.isInteger(id) && id > 0) this.openAttachment(id);
        return;
      }
      block?.querySelector('input[type="file"]')?.click();
    }, true);
    document.addEventListener('change', async event => {
      const input = event.target;
      if (!this.connected || !(input instanceof HTMLInputElement) || input.type !== 'file') return;
      const block = input.closest('.cadema-rs-piece');
      if (!block) return;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      const kind = block.dataset.kind;
      const libelle = kind === 'convention' ? 'Convention non enregistrée' : 'Avis non enregistré';
      const fileId = await this.uploadDocument(file, libelle);
      if (!fileId) return;
      await this.saveRsAttachment(kind, block.dataset.companyId, asNumber(block.dataset.exercise), fileId);
    }, true);
  }

  installDocumentHooks() {
    if (this.documentHooksInstalled) return;
    this.documentHooksInstalled = true;
    /* L'envoi n'est plus lancé en parallèle par un écouteur DOM. Le module
       Documents appelle désormais `uploadDocument()` AVANT de créer ou de
       remplacer sa ligne locale. Cela rend l'opération transactionnelle :
       sans identifiant confirmé par Grist, aucune ligne « classée » n'est
       créée et aucun faux succès n'est affiché. */
    /* `row.dataset.documentId` vient de `data-document-id={e.id}`, posé
       directement sur chaque ligne par `portal.js` (le seul point où
       `Document_ID` existe encore au moment du clic — React ne le rend nulle
       part ailleurs). C'est le VRAI identifiant, pas une reconstitution : le
       nom ne sert plus qu'en repli, pour les rares lignes historiques qui
       n'en porteraient aucun. */
    document.addEventListener('click', event => {
      const button = event.target.closest?.('.premium-document-list button.view');
      if (!this.connected || !button) return;
      const row = button.closest('.premium-document-list > div');
      const id = row?.dataset.documentId;
      const title = row?.querySelector('b[title]')?.getAttribute('title');
      const state = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
      const doc = (id ? (state.docs || []).find(item => item.id === id) : null) || (state.docs || []).find(item => item.name === title);
      if (!doc?.gristAttachmentId && !doc?.link) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (doc.gristAttachmentId) this.openAttachment(doc.gristAttachmentId);
      else window.open(doc.link, '_blank', 'noopener');
    }, true);
    /* Le bouton « Supprimer » du gabarit d'origine ne retire le document que
       de l'IndexedDB locale et affiche « Document supprimé de cet appareil ».
       Mais `syncDomainTables` réécrit ensuite Documents_Fiscaux à partir de
       l'état local : la ligne Grist correspondante — donc la pièce jointe
       partagée par toute l'équipe — est supprimée avec elle. Le message est
       donc faux pour tout document déjà lié à Grist, et l'action n'a rien
       d'anodin ni de réversible depuis le portail. On ne bloque pas la
       suppression (elle reste légitime), on demande juste une confirmation
       exacte avant de l'exécuter. */
    document.addEventListener('click', event => {
      const button = event.target.closest?.('.premium-document-list button.delete');
      if (!this.connected || !button) return;
      const row = button.closest('.premium-document-list > div');
      const id = row?.dataset.documentId;
      const title = row?.querySelector('b[title]')?.getAttribute('title');
      const state = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
      const doc = (id ? (state.docs || []).find(item => item.id === id) : null) || (state.docs || []).find(item => item.name === title);
      if (!doc?.gristAttachmentId) return;
      const confirme = window.confirm(`« ${doc.name} » est une pièce jointe Grist partagée avec toute l'équipe. La supprimer ici l'efface aussi du document Grist, pas seulement de cet appareil. Continuer ?`);
      if (!confirme) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  /* `echec` permet aux pièces RS de rendre compte d'un envoi raté dans leur
     propre vocabulaire ; la valeur par défaut laisse le centre documentaire
     exactement tel qu'il fonctionne aujourd'hui. */
  async uploadDocument(file, echec = 'Document non classé') {
    try {
      this.setStatus('pending', `Envoi de ${file.name} dans Grist…`);
      const token = await window.grist.docApi.getAccessToken({readOnly:false});
      const form = new FormData();
      form.append('upload', file, file.name);
      /* Les jetons temporaires de widget sont fournis avec une base déjà
         limitée au document (`.../api/docs/DOCID`). L'API plugin documente
         leur passage par le paramètre `auth`. Cette forme fonctionne aussi
         lorsque l'instance refuse l'en-tête Authorization depuis l'iframe. */
      const url = new URL(`${token.baseUrl.replace(/\/$/, '')}/attachments`);
      url.searchParams.set('auth', token.token);
      /* Le jeton temporaire passe par `?auth=...`. Pour une requête POST,
         Grist exige aussi un marqueur anti-CSRF. Sans cet en-tête, l'upload
         multipart est traité comme une soumission de formulaire anonyme et
         Firefox ne laisse remonter qu'un `NetworkError` au widget. L'en-tête
         est explicitement autorisé par le CORS de Grist et ne modifie ni la
         lecture des anciennes pièces jointes ni leur identifiant. */
      const response = await fetch(url, {
        method:'POST',
        body:form,
        headers:{'X-Requested-With':'XMLHttpRequest'},
      });
      if (!response.ok) {
        let detail = '';
        try { detail = (await response.text()).trim().slice(0, 240); } catch {}
        throw new Error(`Envoi refusé (${response.status})${detail ? ` : ${detail}` : ''}`);
      }
      const [id] = await response.json();
      if (!Number.isInteger(id) || id <= 0) throw new Error('Identifiant de pièce jointe absent');
      this.setStatus('pending', `${file.name} transféré · finalisation du classement…`);
      return id;
    } catch (error) {
      console.error('Pièce jointe Grist non envoyée', error);
      this.setStatus('error', `${echec} : ${error.message || 'envoi Grist refusé'}`);
      return null;
    }
  }

  async persistDocumentRecord(doc) {
    try {
      if (!doc?.id || !Number.isInteger(doc.gristAttachmentId)) {
        throw new Error('document ou pièce jointe invalide');
      }
      const liveTable = await window.grist.docApi.fetchTable('Documents_Fiscaux');
      const rows = columnarToRows(liveTable);
      const current = rows.find(row => row.Document_ID === doc.id);
      const fields = {
        Document_ID: doc.id,
        Type_Document: doc.category,
        Exercice: doc.year,
        Titre: doc.name,
        Module: 'Fiscalité',
        Fichier: ['L', doc.gristAttachmentId],
        Lien: doc.link || '',
        Confidentialite: 'Équipe',
        Ajoute_Par: doc.author || 'Équipe',
        Date_Ajout: gristDate(doc.createdAt),
        Version: '1.0',
        Statut: 'Classé',
      };
      const action = current
        ? ['UpdateRecord', 'Documents_Fiscaux', current.id, fields]
        : ['AddRecord', 'Documents_Fiscaux', null, fields];
      await window.grist.docApi.applyUserActions([action]);

      /* La table métier est écrite avant le succès affiché. Même si le
         navigateur est fermé juste après, le prochain chargement la relira
         et `reconcileDocsWithGrist()` reconstruira le document. */
      const refreshed = await window.grist.docApi.fetchTable('Documents_Fiscaux');
      this.tables.Documents_Fiscaux = columnarToRows(refreshed);
      this.loadedTables.add('Documents_Fiscaux');
      this.columns.set('Documents_Fiscaux', new Set(Object.keys(refreshed || {})));
      this.setStatus('ok', `${doc.name} classé et enregistré dans Grist`);
      return true;
    } catch (error) {
      console.error('Ligne documentaire Grist non enregistrée', error);
      this.setStatus('error', `Document non classé : ${error.message || 'écriture Grist refusée'}`);
      return false;
    }
  }

  /* Convention et avis de somme à payer empruntent exactement le chemin déjà
     validé pour les documents fiscaux : `uploadDocument()` envoie le fichier
     dans les pièces jointes natives du document Grist, puis la ligne métier
     est écrite ici avec l'identifiant obtenu. La convention appartient à
     l'entreprise (`Entreprises_RS`), l'avis appartient à l'exercice
     (`Suivi_RS_Annuel`) : un avis 2025 ne peut donc jamais devenir l'avis
     2026. Comme pour les documents, la table est relue juste après, si bien
     qu'une mise à jour du portail ne fait pas disparaître la pièce : elle
     est toujours relue depuis Grist, jamais depuis l'état local.
     Si la colonne pièce jointe n'existe pas encore dans le document, on le
     dit explicitement au lieu d'échouer en silence. */
  async saveRsAttachment(kind, companyId, exercise, fileId) {
    const isConvention = kind === 'convention';
    const tableName = isConvention ? 'Entreprises_RS' : 'Suivi_RS_Annuel';
    const column = isConvention ? 'Convention_Fichier' : 'Avis_Fichier';
    const libelle = isConvention ? 'Convention' : 'Avis de somme à payer';
    try {
      if (!companyId || !Number.isInteger(fileId)) throw new Error('entreprise ou pièce jointe invalide');
      const liveTable = await window.grist.docApi.fetchTable(tableName);
      const columns = new Set(Object.keys(liveTable || {}));
      if (!columns.has(column)) {
        throw new Error(`la colonne « ${column} » n'existe pas encore dans ${tableName} (à créer dans Grist, type Pièces jointes)`);
      }
      const rows = columnarToRows(liveTable);
      let action;
      if (isConvention) {
        const current = rows.find(row => String(row.Entreprise_ID || `rs-${row.id}`) === String(companyId));
        if (!current) throw new Error('entreprise introuvable dans Entreprises_RS');
        action = ['UpdateRecord', tableName, current.id, {[column]: ['L', fileId]}];
      } else {
        const annee = Number(exercise);
        if (!annee) throw new Error('exercice inconnu');
        const companyRows = this.tables.Entreprises_RS || [];
        const current = rows.find(row => row.Entreprise_ID
          && annualRsKey(annualCompanyId(row.Entreprise_ID, companyRows), row.Exercice) === annualRsKey(companyId, annee));
        if (current) {
          action = ['UpdateRecord', tableName, current.id, {[column]: ['L', fileId]}];
        } else {
          /* Aucun suivi n'existe encore pour cette année : on crée la ligne
             minimale qui porte l'avis, sans inventer de montant. */
          const companyRecord = companyRows.find(item => String(item.Entreprise_ID || `rs-${item.id}`) === String(companyId));
          const reference = rows.some(item => typeof item.Entreprise_ID === 'number') ? companyRecord?.id : companyId;
          action = ['AddRecord', tableName, null, cleanFields({
            Suivi_ID: columns.has('Suivi_ID') ? `RS-${companyId}-${annee}` : undefined,
            Entreprise_ID: reference ?? companyId,
            Exercice: annee,
            [column]: ['L', fileId],
          })];
        }
      }
      await window.grist.docApi.applyUserActions([action]);

      const refreshed = await window.grist.docApi.fetchTable(tableName);
      this.tables[tableName] = columnarToRows(refreshed);
      this.loadedTables.add(tableName);
      this.columns.set(tableName, new Set(Object.keys(refreshed || {})));
      this.setStatus('ok', `${libelle} enregistrée dans Grist`);
      return true;
    } catch (error) {
      console.error(`${libelle} non enregistrée`, error);
      this.setStatus('error', `${libelle} non enregistrée : ${error.message || 'écriture Grist refusée'}`);
      return false;
    }
  }

  async openAttachment(id) {
    try {
      const token = await window.grist.docApi.getAccessToken({readOnly:true});
      const url = new URL(`${token.baseUrl.replace(/\/$/, '')}/attachments/${id}/download`);
      url.searchParams.set('auth', token.token);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Téléchargement refusé (${response.status})`);
      const objectUrl = URL.createObjectURL(await response.blob());
      window.open(objectUrl, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) {
      console.error('Ouverture de pièce jointe impossible', error);
      this.setStatus('error', 'Pièce jointe Grist inaccessible');
    }
  }

  /* L'ancienne version cherchait des boutons de profil nominatifs
     qui n'existent plus depuis la V19 : la sélection échouait
     silencieusement. L'authentification est de toute façon assurée par
     Grist/ProConnect, pas par cet écran — mais ce même écran contient aussi
     `.profile-select`, la seule liste (dérivée d'`Utilisateurs`, via `rK` =
     `CADEMA_PROFILS`) qui permette de savoir QUI est connecté : Grist ne
     fournit aucune identité côté widget (pas de `getUserInfo`). En cliquant
     `.login-button` sans passer par ce choix, on entrait systématiquement
     avec le premier profil de la liste — le profil générique « Utilisateur
     Grist » — d'où le nom et le badge Administrateur figés à l'écran malgré
     une équipe réelle déjà chargée. On mémorise donc le choix (affichage
     seulement, pas un droit) et on ne saute l'écran que si on peut le
     reconstituer, ou s'il n'y a personne d'autre à choisir. */
  autoEnter() {
    const loginButton = document.querySelector('.login-button');
    if (!loginButton) return;
    const picker = document.querySelector('.profile-select');
    if (picker) {
      const boutons = [...picker.querySelectorAll('button')];
      const remembered = localStorage.getItem(PROFILE_KEY);
      const match = remembered && boutons.find(b => b.querySelector('b')?.textContent?.trim() === remembered);
      if (match) { match.click(); loginButton.click(); return; }
      if (boutons.length > 1) return; // laisser la personne se choisir une fois
    }
    loginButton.click();
  }

  /* Complète la mémorisation ci-dessus : quand quelqu'un choisit son profil
     sur l'écran d'entrée (manuellement, la première fois), on retient le nom
     affiché pour qu'`autoEnter()` puisse le reconnaître aux prochains
     chargements sans repasser par l'écran. */
  installProfileMemory() {
    if (this.profileMemoryInstalled) return;
    this.profileMemoryInstalled = true;
    document.addEventListener('click', event => {
      if (!event.target.closest?.('.login-button')) return;
      const chosen = document.querySelector('.profile-select button.selected b')?.textContent?.trim();
      if (chosen) localStorage.setItem(PROFILE_KEY, chosen);
    }, true);
  }

  /* Pose la liste de profils que le bundle lira. Aucune donnée n'est
     écrite : ni dans Grist, ni dans l'état local. La liste est dérivée,
     jamais saisie. */
  installProfiles(state) {
    const profiles = buildProfiles(this.tables, state, window.CADEMA_IDENTITY);
    window.CADEMA_PROFILS = profiles;
    if (profiles.length === 1) {
      console.info('Portail CADEMA : aucun membre trouvé dans Utilisateurs ni dans les responsables des priorités.');
    }
    return profiles;
  }

  decoratePortal() {
    if (!document.querySelector('.portal')) return;
    const replacements = new Map([
      ['Enregistrement local','Synchronisation Grist'],
      ['Mémoire locale de l’équipe','Activité partagée de l’équipe'],
      ['Local à cet appareil','Document Grist partagé'],
      ['Local uniquement','Données dans Grist'],
      ['Sauvegarde locale','Historique Grist'],
      ['Aucune donnée envoyée en ligne','Accès contrôlé par Grist'],
      ['Confidentiel · stockage local','Accès sécurisé Grist'],
    ]);
    for (const element of document.querySelectorAll('b, small, p, span, dd')) {
      const text = element.textContent?.trim();
      if (replacements.has(text) && element.children.length === 0) element.textContent = replacements.get(text);
    }
    if (!this.status) {
      this.status = document.createElement('div');
      this.status.className = `cadema-grist-status ${this.connected ? 'ok' : 'preview'}`;
      this.status.textContent = this.connected ? '● Synchronisé avec Grist' : '● Mode aperçu local';
      document.body.appendChild(this.status);
    }
  }

  setStatus(kind, message) {
    if (!this.status) this.decoratePortal();
    if (!this.status) return;
    this.status.className = `cadema-grist-status ${kind}`;
    this.status.textContent = `${kind === 'ok' ? '●' : kind === 'pending' ? '◌' : '▲'} ${message}`;
  }

  injectAccountingButton() {
    const nav = document.querySelector('.sidebar nav');
    if (!nav || nav.querySelector('[data-cadema-accounting]')) return;
    const button = document.createElement('button');
    button.dataset.cademaAccounting = 'true';
    button.innerHTML = '<span class="nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16v18H4zM8 7h8M8 11h3m2 0h3m-8 4h3m2 0h3m-8 4h3m2 0h3"/></svg></span><span><b>Budget & CFU</b><small>Grand livre & synthèse</small></span>';
    button.addEventListener('click', () => this.openAccounting());
    nav.appendChild(button);
  }

  async openAccounting() {
    document.querySelector('.cadema-accounting-overlay')?.remove();
    const overlay = document.createElement('section');
    overlay.className = 'cadema-accounting-overlay';
    overlay.innerHTML = '<div class="cadema-accounting-loading"><span></span><b>Lecture du budget dans Grist…</b></div>';
    document.querySelector('.main')?.appendChild(overlay);
    try {
      if (this.connected) await this.loadAccountingData();
      else this.accountingData = {Budgets:[], Grand_Livre:[], CFU_Synthese:[]};
      this.renderAccounting(overlay);
    } catch (error) {
      overlay.innerHTML = `<div class="cadema-accounting-error"><b>Impossible de lire les tables comptables.</b><p>${this.escape(error.message)}</p><button>Fermer</button></div>`;
      overlay.querySelector('button').addEventListener('click', () => overlay.remove());
    }
  }

  async loadAccountingData() {
    const names = ['Budgets','Grand_Livre','CFU_Synthese'];
    const values = await Promise.all(names.map(name => window.grist.docApi.fetchTable(name)));
    this.accountingData = Object.fromEntries(names.map((name,index) => [name,columnarToRows(values[index])]));
  }

  renderAccounting(overlay) {
    const budgets = this.accountingData.Budgets || [];
    const ledger = this.accountingData.Grand_Livre || [];
    const cfu = this.accountingData.CFU_Synthese || [];
    const years = [...new Set([...budgets,...ledger,...cfu].map(row => asNumber(row.Exercice)).filter(Boolean))].sort((a,b) => b-a);
    const budgetNames = [...new Set([...budgets,...ledger,...cfu].map(row => row.Budget).filter(Boolean))].sort();
    overlay.innerHTML = `
      <div class="cadema-accounting-head">
        <div><span>Lecture financière</span><h1>Budget, grand livre & CFU</h1><p>Une vue claire des données comptables déjà présentes dans Grist, sans transmission à Hélios.</p></div>
        <button class="cadema-accounting-close" aria-label="Fermer">×</button>
      </div>
      <div class="cadema-accounting-filters">
        <label>Exercice<select data-filter-year><option value="">Tous</option>${years.map(year => `<option value="${year}" ${year === years[0] ? 'selected' : ''}>${year}</option>`).join('')}</select></label>
        <label>Budget<select data-filter-budget><option value="">Tous les budgets</option>${budgetNames.map(name => `<option>${this.escape(name)}</option>`).join('')}</select></label>
        <label class="search">Recherche dans le grand livre<input data-ledger-search placeholder="Article, tiers, libellé…"></label>
        <button data-accounting-refresh>Actualiser</button>
        <button data-accounting-export>Exporter CSV</button>
      </div>
      <div data-accounting-body></div>`;
    overlay.querySelector('.cadema-accounting-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-accounting-refresh]').addEventListener('click', () => this.openAccounting());
    const refresh = () => this.renderAccountingBody(overlay);
    overlay.querySelector('[data-filter-year]').addEventListener('change', refresh);
    overlay.querySelector('[data-filter-budget]').addEventListener('change', refresh);
    overlay.querySelector('[data-ledger-search]').addEventListener('input', refresh);
    overlay.querySelector('[data-accounting-export]').addEventListener('click', () => this.exportLedger(overlay));
    refresh();
  }

  filteredAccounting(overlay) {
    const year = overlay.querySelector('[data-filter-year]').value;
    const budget = overlay.querySelector('[data-filter-budget]').value;
    const query = overlay.querySelector('[data-ledger-search]').value.trim().toLowerCase();
    const match = row => (!year || String(row.Exercice) === year) && (!budget || row.Budget === budget);
    const ledger = (this.accountingData.Grand_Livre || []).filter(row => match(row) && (!query || `${row.Article || ''} ${row.Libelle || ''} ${row.Tiers || ''} ${row.Mandat_Titre || ''}`.toLowerCase().includes(query)));
    return {budgets:(this.accountingData.Budgets || []).filter(match), cfu:(this.accountingData.CFU_Synthese || []).filter(match), ledger};
  }

  /* V21 — les tables CFU et Budgets contiennent, pour un même exercice et
     un même budget, les lignes de section (Investissement, Fonctionnement)
     ET une ligne « Total ». La V20 additionnait tout : chaque montant était
     compté deux fois (63,3 M€ de recettes affichés pour 31,6 M€ réels).
     Par exercice et par budget, on garde les sections ; la ligne Total ne
     sert que si aucune section n'est détaillée. */
  static withoutTotalRows(rows) {
    const groups = new Map();
    for (const row of rows) {
      const key = `${row.Exercice ?? ''}|${row.Budget ?? ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const isTotal = row => /^\s*total/i.test(String(row.Section ?? ''));
    return [...groups.values()].flatMap(group => {
      const details = group.filter(row => !isTotal(row));
      return details.length ? details : group;
    });
  }

  renderAccountingBody(overlay) {
    const {budgets, cfu, ledger} = this.filteredAccounting(overlay);
    const cfuLines = CademaGristBridge.withoutTotalRows(cfu);
    const budgetLines = CademaGristBridge.withoutTotalRows(budgets);
    const totalRecettes = cfuLines.reduce((sum,row) => sum + (asNumber(row.Recettes_Ligne_B) || 0), 0) || budgetLines.reduce((sum,row) => sum + (asNumber(row.Recettes_Realisees) || 0), 0);
    const totalDepenses = cfuLines.reduce((sum,row) => sum + (asNumber(row.Depenses_Ligne_E) || 0), 0) || budgetLines.reduce((sum,row) => sum + (asNumber(row.Depenses_Realisees) || 0), 0);
    const result = totalRecettes - totalDepenses;
    const ledgerTotal = ledger.reduce((sum,row) => sum + (asNumber(row.Montant) || 0), 0);
    const body = overlay.querySelector('[data-accounting-body]');
    body.innerHTML = `
      <div class="cadema-accounting-kpis">
        <article><small>Recettes CFU</small><strong>${euro.format(totalRecettes)}</strong><span>${cfu.length || budgets.length} ligne(s) de synthèse</span></article>
        <article><small>Dépenses CFU</small><strong>${euro.format(totalDepenses)}</strong><span>Données arrêtées dans Grist</span></article>
        <article class="${result < 0 ? 'negative' : 'positive'}"><small>Résultat</small><strong>${euro.format(result)}</strong><span>Recettes moins dépenses</span></article>
        <article><small>Grand livre filtré</small><strong>${ledger.length.toLocaleString('fr-FR')}</strong><span>${euro.format(ledgerTotal)}</span></article>
      </div>
      <div class="cadema-accounting-grid">
        <article class="cadema-accounting-card"><div class="card-title"><div><small>Compte financier unique</small><h2>Synthèse CFU</h2></div><b>${cfu.length} ligne(s)</b></div>${this.tableHtml(cfu,['Exercice','Budget','Section','Recettes_Ligne_B','Depenses_Ligne_E','Resultat','Controle_GL','Ecart_GL'],80)}</article>
        <article class="cadema-accounting-card"><div class="card-title"><div><small>Comptabilité</small><h2>Grand livre</h2></div><b>${ledger.length} écriture(s)</b></div>${this.tableHtml(ledger,['Date_Comptable','Budget','Sens','Chapitre','Article','Libelle','Tiers','Montant'],250)}</article>
      </div>`;
  }

  tableHtml(rows, columns, limit) {
    if (!rows.length) return '<div class="cadema-accounting-empty"><b>Aucune donnée pour ce filtre.</b><span>Importe ou complète la table correspondante dans Grist.</span></div>';
    const moneyColumns = new Set(['Recettes_Ligne_B','Depenses_Ligne_E','Resultat','Ecart_GL','Montant']);
    const labels = {Recettes_Ligne_B:'Recettes',Depenses_Ligne_E:'Dépenses',Controle_GL:'Contrôle GL',Ecart_GL:'Écart GL',Date_Comptable:'Date',Libelle:'Libellé'};
    return `<div class="cadema-accounting-table"><table><thead><tr>${columns.map(column => `<th>${labels[column] || column.replaceAll('_',' ')}</th>`).join('')}</tr></thead><tbody>${rows.slice(0,limit).map(row => `<tr>${columns.map(column => `<td class="${moneyColumns.has(column) ? 'money' : ''}">${this.escape(moneyColumns.has(column) && asNumber(row[column]) !== null ? euro.format(asNumber(row[column])) : this.displayValue(row[column]))}</td>`).join('')}</tr>`).join('')}</tbody></table>${rows.length > limit ? `<p class="limit-note">${limit} premières lignes affichées sur ${rows.length}. Utilise l’export CSV pour le détail complet.</p>` : ''}</div>`;
  }

  displayValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number' && value > 100000000) return new Date(value * 1000).toLocaleDateString('fr-FR');
    return String(value);
  }

  exportLedger(overlay) {
    const rows = this.filteredAccounting(overlay).ledger;
    if (!rows.length) return;
    const columns = ['Ecriture_ID','Exercice','Budget','Section','Sens','Chapitre','Article','Fonction','Service','Operation','Bordereau','Mandat_Titre','Date_Comptable','Libelle','Tiers','SIRET_Tiers','Montant','Piece','Source_Import','Import_ID'];
    const quote = value => `"${String(value ?? '').replaceAll('"','""')}"`;
    const csv = [columns.map(quote).join(';'), ...rows.map(row => columns.map(column => quote(row[column])).join(';'))].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['\ufeff',csv], {type:'text/csv;charset=utf-8'}));
    link.download = `grand-livre-${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  escape(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
  }
}
