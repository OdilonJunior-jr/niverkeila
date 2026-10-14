import { existsSync, readFileSync, statSync } from 'node:fs';
const files = [
  'public/index.html','public/admin.html','public/firebase-config.js',
  'public/js/firebase-client.js','public/js/admin.js',
  'public/assets/convite.png','public/assets/confirmacao.mp4',
  'public/assets/botao-local.png','public/assets/botao-confirmar.png',
  'firestore.rules','firebase.json','vercel.json'
];
for (const path of files) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error('Arquivo ausente: ' + path);
}
const vercel = JSON.parse(readFileSync('vercel.json','utf8'));
const firebase = JSON.parse(readFileSync('firebase.json','utf8'));
if (vercel.outputDirectory !== 'public') throw new Error('Output Vercel incorreto');
if (!firebase.firestore || firebase.functions) throw new Error('Somente Firestore (plano Spark)');
const admin = readFileSync('public/admin.html','utf8');
if (!admin.includes('id="accessBox"') || admin.includes('id="loginForm"')) throw new Error('Painel sem login não foi aplicado');
const rules = readFileSync('firestore.rules','utf8');
if (!rules.includes('existsAfter(conf)') || !rules.includes('match /admins/{uid}')) throw new Error('Regras ausentes');
console.log('OK: arquivo do convite, painel sem login, Firestore, arte e vídeo.');
console.log('OK: raiz organizada para Vercel, sem Cloud Functions e sem PHP.');
