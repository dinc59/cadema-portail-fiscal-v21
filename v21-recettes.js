/* Portail Fiscal CADEMA — V21 : fiche complète de chaque recette fiscale.

   - Une entrée par recette dans le menu, sous « Produits & recettes ».
   - Cliquer une recette (menu, accueil « Poids des recettes », bandeau de
     Produits & recettes) ouvre sa fiche : produit par exercice, évolution,
     croissance, part des recettes, taux, base, exécution budgétaire,
     historique détaillé.

   Données : tables Grist `Taxes` et `Produits_Recettes`, relues à chaque
   ouverture. Aucun chiffre n'est inventé : une valeur absente est affichée
   comme absente, avec l'endroit où la saisir dans Grist.

   Comme la vue Budget & CFU de l'adaptateur, la fiche vit hors de React :
   on ajoute nos propres nœuds, on ne touche à aucun nœud de React. */

const STATUS_RANK = {'définitif': 3, 'renseigné': 2, 'prévision': 1};
const COLORS = {
  VM: '#835fe4', TEOM: '#2889e1', CFE: '#14b8aa', COMP: '#5b79d1', TASCOM: '#f0a928', IFER: '#ef6a69',
};
const FALLBACK_COLORS = ['#14b8aa', '#2889e1', '#835fe4', '#f0a928', '#ef6a69', '#5b79d1', '#35b56f'];

const euro = new Intl.NumberFormat('fr-FR', {style: 'currency', currency: 'EUR', maximumFractionDigits: 0});
const pct1 = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 1, minimumFractionDigits: 1});
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
const num = value => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const clean = String(value).replace(/[\s  €%]/g, '').replace(',', '.');
  const parsed = Number(clean);
  return clean && Number.isFinite(parsed) ? parsed : null;
};
const shortEuro = value => {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${pct1.format(value / 1e6).replace(/,0$/, '')} M€`;
  if (abs >= 1e3) return `${Math.round(value / 1e3).toLocaleString('fr-FR')} k€`;
  return euro.format(value);
};
const signedPct = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${pct1.format(Math.abs(value))} %`;
const signedEuro = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${euro.format(Math.abs(value))}`;
const rateText = value => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && /%/.test(value)) return value.trim();
  const n = num(value);
  if (n === null) return String(value);
  return `${pct1.format(n <= 1 ? n * 100 : n)} %`;
};
const dateText = value => {
  const n = num(value);
  if (n === null) return '';
  const date = new Date(n > 1e11 ? n : n * 1000);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('fr-FR');
};
const rankOf = row => STATUS_RANK[String(row.Statut || '').trim().toLowerCase()] || 0;
const colorOf = (code, index = 0) => COLORS[code] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];

const columnarToRows = table => {
  if (!table || !Array.isArray(table.id)) return [];
  const keys = Object.keys(table);
  return table.id.map((_, i) => Object.fromEntries(keys.map(key => [key, table[key][i]])));
};

const bridge = () => window.CADEMA_GRIST;

async function freshTables() {
  const b = bridge();
  const fallback = {Taxes: b?.tables?.Taxes || [], Produits_Recettes: b?.tables?.Produits_Recettes || []};
  if (!b?.connected || !window.grist?.docApi?.fetchTable) return fallback;
  try {
    const [taxes, produits] = await Promise.all([
      window.grist.docApi.fetchTable('Taxes'),
      window.grist.docApi.fetchTable('Produits_Recettes').catch(() => null),
    ]);
    return {Taxes: columnarToRows(taxes), Produits_Recettes: produits ? columnarToRows(produits) : fallback.Produits_Recettes};
  } catch {
    return fallback;
  }
}

/* Une ligne retenue par exercice : Définitif > Renseigné > Prévision, puis la
   plus récemment mise à jour. Les autres restent visibles dans l'historique. */
function retainedByYear(rows) {
  const byYear = new Map();
  for (const row of rows) {
    const year = num(row.Exercice);
    if (year === null || num(row.Produit) === null) continue;
    const current = byYear.get(year);
    if (!current || rankOf(row) > rankOf(current) ||
        (rankOf(row) === rankOf(current) && (num(row.Derniere_MAJ) || 0) > (num(current.Derniere_MAJ) || 0))) {
      byYear.set(year, row);
    }
  }
  return byYear;
}

function catalogue(taxes) {
  const codes = new Map();
  taxes.forEach(row => {
    const code = String(row.Code || '').trim();
    if (!code) return;
    if (!codes.has(code)) codes.set(code, {code, label: String(row.Intitule || code).trim(), rows: []});
    codes.get(code).rows.push(row);
  });
  const list = [...codes.values()];
  for (const item of list) {
    const retained = retainedByYear(item.rows);
    const years = [...retained.keys()].sort((a, b) => b - a);
    item.latest = years.length ? num(retained.get(years[0]).Produit) : 0;
  }
  return list.sort((a, b) => (b.latest || 0) - (a.latest || 0));
}

/* ── Graphiques (SVG dessinés à la main, sans bibliothèque) ─────────────── */

function productChart({years, retained, focus, color}) {
  const W = 760, H = 260, padL = 56, padR = 12, padT = 28, padB = 34;
  const values = years.map(y => retained.has(y) ? num(retained.get(y).Produit) : null);
  const max = Math.max(...values.filter(v => v !== null), 1);
  const nice = (() => {
    const p = 10 ** Math.floor(Math.log10(max));
    return [1, 2, 2.5, 5, 10].map(m => m * p).find(v => v >= max) || max;
  })();
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / years.length;
  const barW = Math.min(64, slot * 0.58);
  const y = v => padT + plotH - (v / nice) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => t * nice);
  let svg = `<svg class="v21-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Produit par exercice">`;
  svg += ticks.map(t => `<g class="grid"><line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${t ? esc(shortEuro(t)) : '0'}</text></g>`).join('');
  years.forEach((year, i) => {
    const x = padL + slot * i + (slot - barW) / 2;
    const row = retained.get(year);
    const value = values[i];
    const isFocus = year === focus;
    if (value === null) {
      svg += `<g class="bar missing" data-year="${year}" data-v21-tip="${year} : non renseigné" data-v21-tip-side="top">
        <rect x="${x}" y="${padT + plotH - 40}" width="${barW}" height="40" rx="5"/>
        <text class="year" x="${x + barW / 2}" y="${H - 12}" text-anchor="middle">${year}</text></g>`;
      return;
    }
    const status = String(row.Statut || '').toLowerCase();
    const kind = status.startsWith('déf') ? 'definitif' : status.startsWith('pré') ? 'prevision' : 'renseigne';
    const h = Math.max(2, padT + plotH - y(value));
    const tip = `${year} · ${euro.format(value)} · ${row.Statut || 'statut ?'}${row.Source ? ` · ${row.Source}` : ''}`;
    svg += `<g class="bar ${kind}${isFocus ? ' focus' : ''}" data-year="${year}" data-v21-tip="${esc(tip)}" data-v21-tip-side="top" tabindex="0" role="button" aria-label="${esc(tip)}" style="--bar:${color};--delay:${i * 40}ms">
      <rect class="hit" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${plotH}" />
      <rect class="fill" x="${x}" y="${y(value)}" width="${barW}" height="${h}" rx="5"/>
      <text class="value" x="${x + barW / 2}" y="${y(value) - 7}" text-anchor="middle">${esc(shortEuro(value))}</text>
      <text class="year" x="${x + barW / 2}" y="${H - 12}" text-anchor="middle">${year}</text></g>`;
  });
  return `${svg}<line class="axis" x1="${padL}" x2="${W - padR}" y1="${padT + plotH}" y2="${padT + plotH}"/></svg>`;
}

function growthChart(points) {
  if (points.length < 1) {
    return '<p class="v21-tax-empty">Il faut deux exercices consécutifs renseignés pour calculer une évolution.</p>';
  }
  const W = 760, H = 180, padL = 56, padR = 12, padT = 22, padB = 30;
  const maxAbs = Math.max(...points.map(p => Math.abs(p.pct)), 1);
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const mid = padT + plotH / 2;
  const slot = plotW / points.length;
  const barW = Math.min(56, slot * 0.5);
  let svg = `<svg class="v21-chart growth" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution annuelle du produit">`;
  svg += `<line class="axis" x1="${padL}" x2="${W - padR}" y1="${mid}" y2="${mid}"/>`;
  svg += `<text class="tick" x="${padL - 8}" y="${padT + 4}" text-anchor="end">+${Math.round(maxAbs)} %</text>`;
  svg += `<text class="tick" x="${padL - 8}" y="${padT + plotH + 4}" text-anchor="end">−${Math.round(maxAbs)} %</text>`;
  points.forEach((p, i) => {
    const x = padL + slot * i + (slot - barW) / 2;
    const h = Math.max(2, (Math.abs(p.pct) / maxAbs) * (plotH / 2));
    const up = p.pct >= 0;
    const tip = `${p.from} → ${p.to} : ${signedPct(p.pct)} (${signedEuro(p.diff)})`;
    svg += `<g class="delta ${up ? 'up' : 'down'}" data-v21-tip="${esc(tip)}" data-v21-tip-side="top" style="--delay:${i * 40}ms">
      <rect class="fill" x="${x}" y="${up ? mid - h : mid}" width="${barW}" height="${h}" rx="4"/>
      <text class="value" x="${x + barW / 2}" y="${up ? mid - h - 6 : mid + h + 13}" text-anchor="middle">${esc(signedPct(p.pct))}</text>
      <text class="year" x="${x + barW / 2}" y="${H - 8}" text-anchor="middle">${p.to}</text></g>`;
  });
  return `${svg}</svg>`;
}

/* ── Fiche ──────────────────────────────────────────────────────────────── */

function render(view, data, code, focusYear) {
  const all = catalogue(data.Taxes);
  const item = all.find(entry => entry.code === code);
  if (!item) {
    view.innerHTML = `<div class="v21-tax-head"><div><span>Recette fiscale</span><h1>${esc(code)}</h1><p>Aucune ligne pour ce code dans la table Taxes.</p></div><button class="v21-tax-close" type="button" aria-label="Fermer">×</button></div>`;
    return;
  }
  const color = colorOf(code, all.indexOf(item));
  const retained = retainedByYear(item.rows);
  const knownYears = [...retained.keys()].sort((a, b) => a - b);
  const allYears = item.rows.map(r => num(r.Exercice)).filter(v => v !== null);
  const minYear = Math.min(...allYears, ...(knownYears.length ? knownYears : [new Date().getFullYear()]));
  const maxYear = Math.max(...allYears, ...(knownYears.length ? knownYears : [new Date().getFullYear()]));
  const years = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);
  const focus = retained.has(focusYear) ? focusYear : knownYears[knownYears.length - 1];
  const focusRow = retained.get(focus);
  const focusValue = focusRow ? num(focusRow.Produit) : null;

  const prevRow = retained.get(focus - 1);
  const prevValue = prevRow ? num(prevRow.Produit) : null;
  const delta = focusValue !== null && prevValue ? {diff: focusValue - prevValue, pct: ((focusValue - prevValue) / prevValue) * 100} : null;

  const first = knownYears[0], last = knownYears[knownYears.length - 1];
  const firstValue = first !== undefined ? num(retained.get(first).Produit) : null;
  const lastValue = last !== undefined ? num(retained.get(last).Produit) : null;
  const span = last - first;
  const cagr = span > 0 && firstValue > 0 && lastValue > 0 ? ((lastValue / firstValue) ** (1 / span) - 1) * 100 : null;

  const totalFocus = all.reduce((sum, entry) => {
    const row = retainedByYear(entry.rows).get(focus);
    return sum + (row ? num(row.Produit) || 0 : 0);
  }, 0);
  const share = focusValue !== null && totalFocus > 0 ? (focusValue / totalFocus) * 100 : null;

  const growth = [];
  for (const year of knownYears) {
    const before = retained.get(year - 1);
    const now = num(retained.get(year).Produit), was = before ? num(before.Produit) : null;
    if (was) growth.push({from: year - 1, to: year, diff: now - was, pct: ((now - was) / was) * 100});
  }

  const rates = item.rows.filter(r => rateText(r.Taux) !== null).sort((a, b) => num(a.Exercice) - num(b.Exercice));
  const bases = item.rows.filter(r => num(r.Base_Nette) !== null).sort((a, b) => num(a.Exercice) - num(b.Exercice));
  const exec = (data.Produits_Recettes || [])
    .filter(r => String(r.Code_Produit || '').trim() === code)
    .sort((a, b) => num(b.Exercice) - num(a.Exercice));

  const statusPill = row => {
    const s = String(row?.Statut || '').trim();
    const kind = s.toLowerCase().startsWith('déf') ? 'ok' : s.toLowerCase().startsWith('pré') ? 'warn' : 'info';
    return s ? `<em class="v21-pill ${kind}">${esc(s)}</em>` : '';
  };

  const history = [...item.rows].sort((a, b) => (num(b.Exercice) - num(a.Exercice)) || (rankOf(b) - rankOf(a)));
  const lastUpdate = Math.max(...item.rows.map(r => num(r.Derniere_MAJ) || 0));

  view.style.setProperty('--tax', color);
  view.innerHTML = `
    <div class="v21-tax-head">
      <div>
        <span><i style="background:${color}"></i>Recette fiscale · ${esc(code)}</span>
        <h1>${esc(item.label)}</h1>
        <p>${knownYears.length} exercice${knownYears.length > 1 ? 's' : ''} renseigné${knownYears.length > 1 ? 's' : ''}${lastUpdate ? ` · mise à jour le ${esc(dateText(lastUpdate))}` : ''}</p>
      </div>
      <div class="v21-tax-actions">
        <button type="button" class="v21-tax-edit">Modifier les montants</button>
        <button class="v21-tax-close" type="button" aria-label="Fermer la fiche">×</button>
      </div>
    </div>

    <div class="v21-tax-years" role="tablist" aria-label="Exercice affiché">
      ${knownYears.map(y => `<button type="button" role="tab" data-year="${y}" aria-selected="${y === focus}" class="${y === focus ? 'active' : ''}">${y}</button>`).join('')}
    </div>

    <div class="v21-tax-kpis">
      <article>
        <small>Produit ${focus ?? ''}</small>
        <strong>${focusValue !== null ? esc(euro.format(focusValue)) : '—'}</strong>
        <span>${statusPill(focusRow)}${focusRow?.Source ? ` ${esc(focusRow.Source)}` : ''}</span>
      </article>
      <article class="${delta ? (delta.diff >= 0 ? 'up' : 'down') : ''}">
        <small>Évolution sur un an</small>
        <strong>${delta ? esc(signedPct(delta.pct)) : '—'}</strong>
        <span>${delta ? `${esc(signedEuro(delta.diff))} par rapport à ${focus - 1}` : `${focus ? focus - 1 : 'N-1'} non renseigné`}</span>
      </article>
      <article>
        <small>Croissance annuelle moyenne</small>
        <strong>${cagr !== null ? esc(signedPct(cagr)) : '—'}</strong>
        <span>${cagr !== null ? `de ${first} à ${last}, en moyenne chaque année` : 'au moins deux exercices nécessaires'}</span>
      </article>
      <article>
        <small>Part des recettes ${focus ?? ''}</small>
        <strong>${share !== null ? `${esc(pct1.format(share))} %` : '—'}</strong>
        <span><i class="v21-share"><b style="width:${share ?? 0}%"></b></i>sur ${esc(euro.format(totalFocus))}</span>
      </article>
    </div>

    <div class="v21-tax-grid">
      <article class="v21-tax-card wide">
        <div class="v21-card-title"><div><small>Progression</small><h2>Produit par exercice</h2></div>
          <div class="v21-legend"><span class="definitif">Définitif</span><span class="renseigne">Renseigné</span><span class="prevision">Prévision</span><span class="missing">Non renseigné</span></div></div>
        ${productChart({years, retained, focus, color})}
      </article>

      <article class="v21-tax-card wide">
        <div class="v21-card-title"><div><small>Dynamique</small><h2>Évolution d'un exercice à l'autre</h2></div></div>
        ${growthChart(growth)}
      </article>

      <article class="v21-tax-card">
        <div class="v21-card-title"><div><small>Fiscalité</small><h2>Taux</h2></div></div>
        ${rates.length ? `<ul class="v21-kv">${rates.map(r => `<li><span>${esc(r.Exercice)}</span><b>${esc(rateText(r.Taux))}</b>${statusPill(r)}</li>`).join('')}</ul>`
          : `<div class="v21-tax-empty"><b>Taux non renseigné</b><span>Saisissez-le dans Grist, table <code>Taxes</code>, colonne <code>Taux</code> : son évolution s'affichera ici, exercice par exercice.</span></div>`}
      </article>

      <article class="v21-tax-card">
        <div class="v21-card-title"><div><small>Fiscalité</small><h2>Base nette</h2></div></div>
        ${bases.length ? `<ul class="v21-kv">${bases.map(r => `<li><span>${esc(r.Exercice)}</span><b>${esc(euro.format(num(r.Base_Nette)))}</b>${statusPill(r)}</li>`).join('')}</ul>`
          : `<div class="v21-tax-empty"><b>Base non renseignée</b><span>Saisissez-la dans Grist, table <code>Taxes</code>, colonne <code>Base_Nette</code>.</span></div>`}
      </article>

      <article class="v21-tax-card wide">
        <div class="v21-card-title"><div><small>Budget</small><h2>Exécution : prévu et réalisé</h2></div></div>
        ${exec.length ? exec.map(r => {
          const prev = num(r.Prevision), real = num(r.Realise);
          let rate = num(r.Taux_Execution);
          if (rate === null && prev) rate = real !== null ? real / prev : null;
          const ratePct = rate === null ? null : (rate <= 2 ? rate * 100 : rate);
          const maxBar = Math.max(prev || 0, real || 0, 1);
          return `<div class="v21-exec">
            <div class="v21-exec-year"><b>${esc(r.Exercice)}</b><small>${esc(r.Budget || '')}</small></div>
            <div class="v21-exec-bars">
              <div><span>Prévu</span><i><b class="prev" style="width:${((prev || 0) / maxBar) * 100}%"></b></i><em>${prev !== null ? esc(euro.format(prev)) : '—'}</em></div>
              <div><span>Réalisé</span><i><b class="real" style="width:${((real || 0) / maxBar) * 100}%"></b></i><em>${real !== null ? esc(euro.format(real)) : '—'}</em></div>
            </div>
            <div class="v21-exec-rate ${ratePct !== null && ratePct >= 100 ? 'ok' : ''}"><strong>${ratePct !== null ? `${esc(pct1.format(ratePct))} %` : '—'}</strong><small>taux de réalisation</small></div>
          </div>`;
        }).join('') : `<div class="v21-tax-empty"><b>Aucune prévision budgétaire</b><span>Ajoutez une ligne dans Grist, table <code>Produits_Recettes</code>, pour comparer le prévu et le réalisé.</span></div>`}
      </article>

      <article class="v21-tax-card wide">
        <div class="v21-card-title"><div><small>Traçabilité</small><h2>Historique détaillé</h2></div><b class="v21-count">${item.rows.length} ligne${item.rows.length > 1 ? 's' : ''}</b></div>
        <div class="v21-table-wrap"><table class="v21-table">
          <thead><tr><th>Exercice</th><th>Statut</th><th class="num">Produit</th><th class="num">Évolution</th><th class="num">Taux</th><th class="num">Base nette</th><th>Source</th><th>Mise à jour</th></tr></thead>
          <tbody>${history.map(r => {
            const year = num(r.Exercice), value = num(r.Produit);
            const kept = retained.get(year) === r;
            const before = retained.get(year - 1);
            const was = before ? num(before.Produit) : null;
            const evo = kept && value !== null && was ? signedPct(((value - was) / was) * 100) : '';
            return `<tr class="${kept ? 'kept' : 'other'}${year === focus ? ' focus' : ''}">
              <td>${esc(r.Exercice)}${kept ? '' : ' <small>non retenue</small>'}</td>
              <td>${statusPill(r)}</td>
              <td class="num">${value !== null ? esc(euro.format(value)) : '<span data-v21-empty>—</span>'}</td>
              <td class="num">${evo ? esc(evo) : '<span data-v21-empty>—</span>'}</td>
              <td class="num">${rateText(r.Taux) ? esc(rateText(r.Taux)) : '<span data-v21-empty>—</span>'}</td>
              <td class="num">${num(r.Base_Nette) !== null ? esc(euro.format(num(r.Base_Nette))) : '<span data-v21-empty>—</span>'}</td>
              <td>${esc(r.Source || '')}</td>
              <td>${esc(dateText(r.Derniere_MAJ))}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
        <p class="v21-note">Quand un exercice a plusieurs lignes, le graphique retient la plus avancée : définitif, puis renseigné, puis prévision.</p>
      </article>
    </div>`;
}

/* ── Ouverture / fermeture ──────────────────────────────────────────────── */

let openCode = null;
let openYear = null;
let cache = null;
let editing = false;

export const taxViewCode = () => (document.querySelector('.v21-tax-view') ? openCode : null);

function closeView() {
  document.querySelector('.v21-tax-view')?.remove();
  openCode = null;
}

function topbarYear() {
  const value = Number(document.querySelector('.top-actions select')?.value);
  return Number.isFinite(value) ? value : null;
}

export async function openTax(code, {year} = {}) {
  document.querySelector('.cadema-accounting-overlay')?.remove();
  let view = document.querySelector('.v21-tax-view');
  if (!view) {
    view = document.createElement('section');
    view.className = 'v21-tax-view';
    view.setAttribute('aria-label', 'Fiche recette');
    document.querySelector('.main')?.appendChild(view);
  }
  const changed = openCode !== code;
  openCode = code;
  openYear = year ?? (changed ? topbarYear() : openYear);
  if (changed) {
    view.scrollTop = 0;
    view.classList.remove('v21-enter-view');
    void view.offsetWidth;
    view.classList.add('v21-enter-view');
  }
  if (!cache || changed) {
    if (!view.innerHTML) view.innerHTML = '<div class="v21-tax-loading"><span></span><b>Lecture des recettes dans Grist…</b></div>';
    cache = await freshTables();
  }
  if (openCode !== code || !view.isConnected) return;
  render(view, cache, code, openYear);
}

/* Aller modifier les montants dans l'écran React existant. */
function goEdit(code) {
  const label = catalogue(cache?.Taxes || []).find(e => e.code === code)?.label || code;
  closeView();
  const produits = [...document.querySelectorAll('.sidebar nav > button')]
    .find(b => b.querySelector('b')?.textContent.trim() === 'Produits & recettes');
  produits?.click();
  setTimeout(() => {
    const target = [...document.querySelectorAll('.revenue-product-rail > button')]
      .find(b => b.textContent.includes(label));
    if (target) {
      editing = true;
      target.click();
      editing = false;
      target.scrollIntoView({block: 'center', behavior: 'smooth'});
    }
  }, 250);
}

/* ── Menu : une entrée par recette, sous « Produits & recettes » ────────── */

function menuSignature(list) {
  return list.map(e => `${e.code}:${e.label}`).join('|');
}

export function syncMenu() {
  const nav = document.querySelector('.sidebar nav');
  const b = bridge();
  if (!nav || !b?.tables?.Taxes?.length) return;
  const list = catalogue(b.tables.Taxes);
  const produits = [...nav.querySelectorAll(':scope > button')]
    .find(btn => btn.querySelector('b')?.textContent.trim() === 'Produits & recettes');
  if (!produits) return;
  let group = nav.querySelector(':scope > .v21-nav-sub');
  const signature = menuSignature(list);
  if (!group || group.dataset.signature !== signature) {
    group?.remove();
    group = document.createElement('div');
    group.className = 'v21-nav-sub';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Recettes fiscales');
    group.dataset.signature = signature;
    group.innerHTML = list.map((e, i) => `
      <button type="button" data-v21-tax="${esc(e.code)}" title="${esc(e.label)}" style="--tax:${colorOf(e.code, i)}">
        <i aria-hidden="true"></i><b>${esc(e.code)}</b><small>${esc(e.label)}</small>
      </button>`).join('');
  }
  if (group.previousElementSibling !== produits) produits.after(group);
  const current = taxViewCode();
  for (const btn of group.querySelectorAll('button')) {
    const on = btn.dataset.v21Tax === current;
    btn.classList.toggle('active', on);
    if (on) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
  }
}

/* Reconnaître une recette dans un élément cliqué (accueil, bandeau). */
function codeFromElement(el) {
  const b = bridge();
  const list = catalogue(b?.tables?.Taxes || []);
  const text = el.textContent || '';
  return list.find(e => text.includes(e.label))?.code ||
    list.find(e => new RegExp(`(^|\\s)${e.code}(\\s|$)`).test(text))?.code || null;
}

export function installRecettes() {
  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const sub = target.closest('.v21-nav-sub [data-v21-tax]');
    if (sub) {
      event.preventDefault();
      openTax(sub.dataset.v21Tax);
      document.querySelector('.sidebar.open') && document.querySelector('.portal > .scrim')?.click();
      return;
    }

    const view = target.closest('.v21-tax-view');
    if (view) {
      if (target.closest('.v21-tax-close')) closeView();
      else if (target.closest('.v21-tax-edit')) goEdit(openCode);
      else {
        const pick = target.closest('[data-year]');
        if (pick && openCode) openTax(openCode, {year: Number(pick.dataset.year)});
      }
      return;
    }

    /* Un clic sur une recette ailleurs dans le portail ouvre sa fiche. */
    if (!editing) {
      const card = target.closest('.home-product-bars > button, .revenue-product-rail > button');
      if (card) {
        const code = codeFromElement(card);
        if (code) {
          event.preventDefault();
          event.stopPropagation();
          openTax(code);
          return;
        }
      }
    }

    /* Toute autre entrée du menu ferme la fiche. */
    const entry = target.closest('.sidebar button');
    if (entry && !entry.closest('.v21-nav-sub') && document.querySelector('.v21-tax-view')) closeView();
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.querySelector('.v21-tax-view') &&
        !document.querySelector('.command-overlay, .dialog-overlay')) closeView();
    if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element) {
      const bar = event.target.closest('.v21-tax-view [data-year]');
      if (bar && openCode && bar.tagName !== 'BUTTON') {
        event.preventDefault();
        openTax(openCode, {year: Number(bar.dataset.year)});
      }
    }
  });
}
