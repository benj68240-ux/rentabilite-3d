const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
new vm.Script(fs.readFileSync(__dirname + '/sw.js', 'utf8'));
const code = html.slice(html.indexOf('  var WORKSHOP_FILAMENT_PRICE'), html.indexOf('  // Certains navigateurs mobiles'));
let stored;
const context = vm.createContext({
  uid: () => 'test-id', embaseTitle: (name, type) => name + ' ' + type,
  STORAGE_KEY: 'test', console, Date, JSON, String,
  localStorage: {getItem: () => stored || null, setItem: (_, value) => {stored = value;}},
  hideStorageWarning() {}, showStorageWarning() {}, scheduleDriveUpload() {}, renderBody() {}
});
vm.runInContext(code, context);
assert.equal(context.state.products[0].filamentPrice, '15');
assert.equal(context.state.products[0].packaging, '1.5');
// Données réelles du Drive (31/10, ancienne base fixe 2 €) : passage unique à 1,5 €, rien d'autre ne change.
const source = JSON.parse(fs.readFileSync(__dirname + '/donnees_drive_31_10.json', 'utf8').replace(/^﻿/, ''));
stored = JSON.stringify(source);
const loaded = context.loadState();
assert.equal(loaded.products.length, source.products.length);
for (let i = 0; i < loaded.products.length; i++) {
  const p = loaded.products[i], previous = source.products[i];
  assert.equal(p.filamentPrice, '15'); assert.equal(p.packaging, '1.5');
  const omit = ({name, filamentPrice, packaging, ...rest}) => rest;
  assert.deepEqual(omit(p), omit(previous));
  assert(!/\((P1S|A1)\)$/.test(p.name));
}
assert.deepEqual(loaded.sales, source.sales);
// Import / sync Drive d'un fichier ancienne base : même résultat.
const imported = context.ensureSalesFields(JSON.parse(JSON.stringify(source)));
assert.deepEqual(imported.products, loaded.products);
// Saisie de Benjamin : l'emballage est conservé (y compris 2 € après la migration), le filament reste fixe.
context.state = imported;
context.state.products[0].filamentPrice = '99';
context.state.products[0].packaging = '0,80';
context.state.products[1].packaging = '2';
context.saveState();
let saved = JSON.parse(stored);
assert.equal(saved.products[0].filamentPrice, '15');
assert.equal(saved.products[0].packaging, '0,80');
assert.equal(saved.products[1].packaging, '2');
// Rechargement puis nouvel import Drive du fichier enregistré : les saisies restent.
const reloaded = context.loadState();
assert.equal(reloaded.products[0].packaging, '0,80');
assert.equal(reloaded.products[1].packaging, '2');
const reimported = context.ensureSalesFields(JSON.parse(stored));
assert.equal(reimported.products[1].packaging, '2');
// Champ vide -> valeur par défaut.
const vide = {products: [{name: 'X', packaging: ''}], packagingBase: '1.5'};
context.applyWorkshopProductRules(vide, true);
assert.equal(vide.products[0].packaging, '1.5');
for (const [name, expected] of [
  ['Objet (P1S)', 'Objet'], ['Objet (A1) (copie)', 'Objet (copie)'],
  ['Objet (4 couleurs)', 'Objet (4 couleurs)'], ['Modèle A1', 'Modèle A1']
]) {
  const sample = {products: [{name}]};
  context.applyWorkshopProductRules(sample, true);
  assert.equal(sample.products[0].name, expected);
}
const marker = 'document.getElementById("btnAddRow").addEventListener("click", function () {';
const addStart = html.indexOf(marker) + marker.length;
const addEnd = html.indexOf('\n  });', addStart);
vm.runInContext(html.slice(addStart, addEnd), context);
assert.equal(context.state.products.at(-1).filamentPrice, '15');
assert.equal(context.state.products.at(-1).packaging, '1.5');
assert(!/data-field="packaging"[^>]*readonly/.test(html) && !html.includes('emballage 2 € par produit'));
console.log('OK : syntaxe, chargement, import/Drive, emballage modifiable et conservé, passage unique 2 -> 1,5, filament fixe, nouveaux produits, noms.');
