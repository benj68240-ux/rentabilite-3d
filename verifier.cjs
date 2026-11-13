// Contrôle du cœur du logiciel : node verifier.cjs (aucun fichier externe nécessaire).
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const html = fs.readFileSync(process.env.RENTA_HTML || __dirname + '/index.html', 'utf8');
for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
new vm.Script(fs.readFileSync(__dirname + '/sw.js', 'utf8'));
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); assert(i >= 0 && j > i, a); return html.slice(i, j); };
const code = cut('  function parseNum(v)', '  function formatCurrency(n)') + cut('  var WORKSHOP_FILAMENT_PRICE', '  // Certains navigateurs mobiles') +
  cut('  var EMBASE_PRESETS', '  function findSitePlatform()');
const fixture = () => JSON.parse(fs.readFileSync(__dirname + '/tests/donnees_exemple.json', 'utf8'));
let stored, n = 0;
const context = vm.createContext({
  uid: p => p + '_test' + (++n), STORAGE_KEY: 'test', console, Date, JSON, String, Math, Object, Array, isNaN, parseFloat,
  localStorage: {getItem: () => stored || null, setItem: (_, value) => {stored = value;}},
  hideStorageWarning() {}, showStorageWarning() {}, scheduleDriveUpload() {}
});
vm.runInContext(code + '\nthis.api = {get state() { return state; }, set state(v) { state = v; syncSnapshot = takeSnapshot(v); }};', context);
const api = context.api;

// Saisies numériques.
for (const [v, attendu] of [['1.234,56', 1234.56], ['0,25', 0.25], ['1.5', 1.5], ['1 200', 1200], ['abc', 0], ['', 0], [null, 0]]) assert.equal(context.parseNum(v), attendu, String(v));
assert.equal(context.nonNeg('-5'), 0);
assert(context.isValidNumberInput('12,5') && context.isValidNumberInput('') && !context.isValidNumberInput('-5') && !context.isValidNumberInput('abc'));

// État par défaut : nouvelles bases.
const def = context.defaultState();
assert.equal(def.products[0].filamentPrice, '15');
assert.equal(def.products[0].packaging, '1.5');
assert.equal(def.products[0].shipping, '5');
assert.equal(def.settings.socialChargeRate, '13,4');

// Chargement d'un ancien fichier : passages uniques, rien d'autre ne change.
const source = fixture();
stored = JSON.stringify(source);
const loaded = context.loadState();
assert.equal(loaded.products.length, source.products.length);
const omit = ({name, filamentPrice, packaging, laborTime, shipping, weight, ...rest}) => rest;
for (let i = 0; i < loaded.products.length; i++) {
  assert.equal(loaded.products[i].filamentPrice, '15');
  assert.deepEqual(omit(loaded.products[i]), omit(source.products[i]));
  assert(!/\((P1S|A1)\)$/.test(loaded.products[i].name));
}
assert.deepEqual(loaded.products.map(p => p.packaging), ['1.5', '1.5', '0,80', '1.5']);   // 2 € -> 1,5 € une fois
assert.deepEqual(loaded.products.map(p => p.laborTime), ['20', '10', '10', '5']);        // 0 ou vide -> 10 min une fois
assert.deepEqual(loaded.products.map(p => p.shipping), ['5', '5', '5', '0']);            // port 5 € par défaut, 0 saisi conservé
assert.equal(loaded.products[3].weight, '24.3');                                          // résidu d'arrondi nettoyé
assert.deepEqual(loaded.sales, source.sales);
assert.equal(loaded.settings.socialChargeRate, '13,4');
// Import / Drive du même fichier : même résultat.
assert.deepEqual(context.normalizeImported(fixture()).products, loaded.products);
// Les saisies sont conservées ensuite (emballage, main d'œuvre remise à 0, port à 0, taux URSSAF).
api.state = loaded;
api.state.products[0].filamentPrice = '99';
api.state.products[0].packaging = '2';
api.state.products[1].laborTime = '0';
api.state.products[1].shipping = '0';
api.state.settings.socialChargeRate = '14';
context.saveState();
const reloaded = context.loadState();
assert.equal(reloaded.products[0].filamentPrice, '15');
assert.equal(reloaded.products[0].packaging, '2');
assert.equal(reloaded.products[1].laborTime, '0');
assert.equal(reloaded.products[1].shipping, '0');
assert.equal(reloaded.settings.socialChargeRate, '14');
assert(reloaded.products[0].updatedAt && reloaded.products[1].updatedAt && !reloaded.products[2].updatedAt && reloaded.settingsAt);
// Champ vide -> valeur par défaut.
const vide = {products: [{name: 'X', packaging: '', shipping: ''}], packagingBase: '1.5', laborBase: '10'};
context.applyWorkshopProductRules(vide, true);
assert.equal(vide.products[0].packaging, '1.5');
assert.equal(vide.products[0].shipping, '5');
for (const [name, expected] of [
  ['Objet (P1S)', 'Objet'], ['Objet (A1) (copie)', 'Objet (copie)'],
  ['Objet (4 couleurs)', 'Objet (4 couleurs)'], ['Modèle A1', 'Modèle A1']
]) {
  const sample = {products: [{name}]};
  context.applyWorkshopProductRules(sample, true);
  assert.equal(sample.products[0].name, expected);
}
// Nouveau produit : valeurs par défaut.
const marker = 'document.getElementById("btnAddRow").addEventListener("click", function () {';
const addStart = html.indexOf(marker) + marker.length;
const addEnd = html.indexOf('    saveState();', addStart);
vm.runInContext(html.slice(addStart, addEnd), context);
const nouveau = api.state.products.at(-1);
assert.deepEqual([nouveau.filamentPrice, nouveau.packaging, nouveau.laborTime, nouveau.shipping], ['15', '1.5', '10', '5']);

// Embase : plus d'ajout automatique, arrondi propre.
assert(!html.includes('normalizeEmbaseTypes'));
const lampe = {name: 'Lampe', weight: '49.3', printTime: '3.123611'};
context.applyEmbaseType(lampe, 'E27');
assert.deepEqual([lampe.weight, lampe.printTime, lampe.name], ['74.3', '4.123611', 'Lampe + Embase E27']);
context.applyEmbaseType(lampe, 'NONE');
assert.deepEqual([lampe.weight, lampe.printTime, lampe.name], ['49.3', '3.123611', 'Lampe']);

// Fusion entre deux appareils partis du même état.
const base = context.normalizeImported(fixture());
const clone = o => JSON.parse(JSON.stringify(o));
const save = (s, at, change) => { api.state = clone(s); change(api.state); context.stampChanges(api.state, at); api.state.savedAt = at; return clone(api.state); };
const tel = save(base, '2026-11-13T10:00:00.000Z', s => { s.sales.push({id: 'sale_tel', name: 'Vase test', price: 19}); s.products[0].price = '59'; });
const pc = save(base, '2026-11-13T10:05:00.000Z', s => { s.products[1].price = '9'; s.products = s.products.filter(p => p.id !== 'prod_3'); s.settings.targetMargin = '35'; });
for (const merged of [context.mergeStates(tel, pc), context.mergeStates(pc, tel)].map(clone)) {
  assert.deepEqual(merged.products.map(p => p.id), ['prod_1', 'prod_2', 'prod_4']);      // suppression respectée
  assert.equal(merged.products[0].price, '59');                                          // modif du téléphone gardée
  assert.equal(merged.products[1].price, '9');                                           // modif du PC gardée
  assert.deepEqual(merged.sales.map(s => s.id), ['sale_1', 'sale_tel']);                 // vente du téléphone gardée
  assert.equal(merged.settings.targetMargin, '35');
}
assert.equal(context.contentKey(context.mergeStates(tel, pc)), context.contentKey(context.mergeStates(context.mergeStates(tel, pc), pc)));
// Même produit modifié des deux côtés : la modification la plus récente gagne.
const tel2 = save(tel, '2026-11-13T10:10:00.000Z', s => { s.products[1].price = '10'; });
assert.equal(context.mergeStates(pc, tel2).products[1].price, '10');

assert(html.includes('if (state.saleMode === "perso") { toast("Mode vente directe (perso) : vente non comptabilisée"); return; }'));
assert(/origin !== self\.location\.origin\) return;/.test(fs.readFileSync(__dirname + '/sw.js', 'utf8')));
console.log('OK : syntaxe, saisies, valeurs par défaut (main d\'œuvre 10 min, port 5 €), passages uniques, embase, fusion entre appareils.');
