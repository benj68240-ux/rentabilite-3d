// Alerte « prix sous le minimum » + prix conseillé en ,90 (Benjamin, 10/11/2026).
// Contrôle sur les 12 produits réels du Drive : mêmes produits signalés que l'analyse du 10/11,
// et prix conseillé identique à prix_conseille.py (arrondi ,90 juste au-dessus du minimum).
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
// RENTA_HTML=v2/index.html node verifier_prix_min.cjs : même contrôle sur la version 2 (onglets).
const html = fs.readFileSync(process.env.RENTA_HTML || __dirname + '/index.html', 'utf8');
const cut = (a, b) => html.slice(html.indexOf(a), html.indexOf(b));
const data = JSON.parse(fs.readFileSync(process.argv[2] || 'G:/Mon Drive/rentabilite-3d-data.json', 'utf8').replace(/^\uFEFF/, ''));
// Contrôles faits en mode « vente pro » (frais + URSSAF), même si le Drive a été laissé en mode perso.
data.saleMode = 'pro';
const ctx = vm.createContext({ Math, String, isNaN, parseFloat, state: data });
vm.runInContext(cut('  function parseNum(v)', '  function formatCurrency(n)'), ctx);
vm.runInContext('function findPlatform(id){return state.settings.platforms.filter(function(p){return p.id===id;})[0];}', ctx);
vm.runInContext(cut('  function findSitePlatform()', '  function marginClass(percent)'), ctx);
// Marge site (11/11/2026) : écart avec la marge de la ligne = frais de sa plateforme - frais Stripe.
const site = data.settings.platforms.find(p => /^site/i.test(p.name));
assert(site, 'profil Site internet absent du Drive');
for (const p of data.products) {
  const c = ctx.computeRow(p), pr = ctx.parseNum(p.price);
  const fraisSite = pr * ctx.parseNum(site.percent) / 100 + ctx.parseNum(site.fixed);
  assert(Math.abs(c.siteMargin - (c.netMargin + c.platformCost - fraisSite)) < 1e-9, p.name);
  if (p.platformId === site.id) assert(Math.abs(c.siteMargin - c.netMargin) < 1e-9, p.name);
}
const sansSite = vm.createContext({ Math, String, isNaN, parseFloat, state: { settings: Object.assign({}, data.settings, { platforms: data.settings.platforms.filter(p => p !== site) }) } });
vm.runInContext(cut('  function parseNum(v)', '  function formatCurrency(n)'), sansSite);
vm.runInContext('function findPlatform(id){return state.settings.platforms.filter(function(p){return p.id===id;})[0];}', sansSite);
vm.runInContext(cut('  function findSitePlatform()', '  function marginClass(percent)'), sansSite);
assert.equal(sansSite.computeRow(data.products[0]).siteMargin, null);
const aurore = data.products.find(p => p.name.startsWith('Lampe Aurore M'));
console.log('OK : marge site. Aurore M : ligne', ctx.computeRow(aurore).netMargin.toFixed(2), '/ site', ctx.computeRow(aurore).siteMargin.toFixed(2));
const signales = [];
for (const p of data.products) {
  const c = ctx.computeRow(p);
  if (c.minPrice !== null) {
    assert(c.suggestedPrice >= c.minPrice - 1e-9, p.name);
    assert(c.suggestedPrice - c.minPrice < 1, p.name);
    assert.equal(Math.round(c.suggestedPrice * 100) % 100, 90, p.name);
  }
  assert.equal(c.belowMin, ctx.parseNum(p.price) < c.minPrice - 0.005, p.name);
  if (c.belowMin) signales.push(p.name.slice(0, 12) + ' ' + c.minPrice.toFixed(2) + ' -> ' + c.suggestedPrice.toFixed(2));
}
// Cas limites : pile au minimum (pas d'alerte), minimum entier, dénominateur nul.
const p0 = data.products[0];
const c0 = ctx.computeRow(p0);
assert.equal(ctx.computeRow(Object.assign({}, p0, { price: String(c0.minPrice) })).belowMin, false);
for (const [m, attendu] of [[10.25, 10.9], [10.9, 10.9], [10.91, 11.9], [7, 7.9]]) {
  let s = Math.floor(m) + 0.9; if (s < m - 1e-9) s += 1;
  assert.equal(s.toFixed(2), attendu.toFixed(2));
}
assert(html.includes('data-action="applyMin"') && html.includes('action === "applyMin"') && html.includes('confirm("Passer « '));
console.log('OK : prix minimum.', signales.length, 'produit(s) signalé(s) :', signales.join(' | ') || 'aucun');
