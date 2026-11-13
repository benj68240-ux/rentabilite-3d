// Calcul de rentabilité : port (base URSSAF / commission), marge site, prix minimum et prix conseillé en ,90.
// node verifier_prix_min.cjs [fichier.json]  (par défaut : tests/donnees_exemple.json)
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const html = fs.readFileSync(process.env.RENTA_HTML || __dirname + '/index.html', 'utf8');
const cut = (a, b) => html.slice(html.indexOf(a), html.indexOf(b));
const data = JSON.parse(fs.readFileSync(process.argv[2] || __dirname + '/tests/donnees_exemple.json', 'utf8').replace(/^﻿/, ''));
// Contrôles faits en mode « vente pro » (frais + URSSAF), même si le fichier a été laissé en mode perso.
data.saleMode = 'pro';
data.products.forEach(p => { if (p.shipping === undefined || p.shipping === '') p.shipping = '5'; });
const make = state => {
  const ctx = vm.createContext({ Math, String, isNaN, parseFloat, state });
  vm.runInContext(cut('  function parseNum(v)', '  function formatCurrency(n)'), ctx);
  vm.runInContext('function findPlatform(id){return state.settings.platforms.filter(function(p){return p.id===id;})[0];}', ctx);
  vm.runInContext(cut('  function findSitePlatform()', '  function marginClass(percent)'), ctx);
  return ctx;
};
const ctx = make(data);
const near = (a, b, msg) => assert(Math.abs(a - b) < 1e-9, msg + ' : ' + a + ' ≠ ' + b);
const site = data.settings.platforms.find(p => /^site/i.test(p.name));
assert(site, 'profil Site internet absent');
const rate = ctx.parseNum(data.settings.socialChargeRate) / 100;
for (const p of data.products) {
  const c = ctx.computeRow(p), pr = ctx.parseNum(p.price), port = ctx.parseNum(p.shipping);
  const pl = data.settings.platforms.find(x => x.id === p.platformId);
  // Port : payé par l'acheteur (hors marge) mais compté dans la base de la commission et de l'URSSAF.
  near(c.platformCost, (pr + port) * ctx.parseNum(pl.percent) / 100 + ctx.parseNum(pl.fixed), p.name + ' commission');
  near(c.socialCost, (pr + port) * rate, p.name + ' URSSAF');
  near(c.netMargin, pr - c.totalCost, p.name + ' marge');
  const sansPort = ctx.computeRow(Object.assign({}, p, { shipping: '0' }));
  near(sansPort.netMargin - c.netMargin, port * (ctx.parseNum(pl.percent) / 100 + rate), p.name + ' coût du port');
  // Marge site : écart avec la marge de la ligne = frais de sa plateforme - frais du site.
  const fraisSite = (pr + port) * ctx.parseNum(site.percent) / 100 + ctx.parseNum(site.fixed);
  near(c.siteMargin, c.netMargin + c.platformCost - fraisSite, p.name + ' marge site');
  if (p.platformId === site.id) near(c.siteMargin, c.netMargin, p.name);
  // Au prix minimum, la marge vaut exactement la marge cible.
  if (c.minPrice !== null) {
    const auMin = ctx.computeRow(Object.assign({}, p, { price: String(c.minPrice) }));
    near(auMin.netMarginPercent, ctx.parseNum(data.settings.targetMargin), p.name + ' marge au prix min');
    assert.equal(auMin.belowMin, false);
    assert(c.suggestedPrice >= c.minPrice - 1e-9 && c.suggestedPrice - c.minPrice < 1, p.name);
    assert.equal(Math.round(c.suggestedPrice * 100) % 100, 90, p.name);
  }
  assert.equal(c.belowMin, pr < c.minPrice - 0.005, p.name);
}
// Mode perso : ni commission ni URSSAF, port sans effet.
data.saleMode = 'perso';
for (const p of data.products) {
  const c = ctx.computeRow(p);
  assert.equal(c.platformCost, 0); assert.equal(c.socialCost, 0);
  near(c.netMargin, ctx.computeRow(Object.assign({}, p, { shipping: '0' })).netMargin, p.name + ' perso');
}
data.saleMode = 'pro';
// Échecs d'impression : pas de majoration sur les pièces achetées (options).
const opt = data.products.find(p => (p.extras || []).length);
if (opt) near(ctx.computeRow(opt).totalCost - ctx.computeRow(Object.assign({}, opt, { extras: [] })).totalCost, ctx.parseNum(opt.extras[0].cost), 'coût pièce sans majoration');
// Saisie négative : comptée comme 0.
near(ctx.computeRow(Object.assign({}, data.products[0], { weight: '-50' })).materialCost, 0, 'poids négatif');
// Sans profil « Site » : pas de marge site.
const sansSite = make({ saleMode: 'pro', settings: Object.assign({}, data.settings, { platforms: data.settings.platforms.filter(p => p !== site) }) });
assert.equal(sansSite.computeRow(data.products[0]).siteMargin, null);
for (const [m, attendu] of [[10.25, 10.9], [10.9, 10.9], [10.91, 11.9], [7, 7.9]]) {
  let s = Math.floor(m) + 0.9; if (s < m - 1e-9) s += 1;
  assert.equal(s.toFixed(2), attendu.toFixed(2));
}
assert(html.includes('data-action="applyMin"') && html.includes('action === "applyMin"') && html.includes('confirm("Passer « '));
const signales = data.products.filter(p => ctx.computeRow(p).belowMin).map(p => p.name.slice(0, 14) + ' ' + ctx.computeRow(p).minPrice.toFixed(2) + ' -> ' + ctx.computeRow(p).suggestedPrice.toFixed(2));
console.log('OK : port, marge site, prix minimum.', signales.length, 'produit(s) sous le minimum :', signales.join(' | ') || 'aucun');
