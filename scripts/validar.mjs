import { existsSync, readFileSync, statSync } from 'node:fs';
const files = [
  'public/index.html','public/admin.html','public/firebase-config.js',
  'public/js/firebase-client.js','public/js/admin.js',
  'public/assets/convite.png','public/assets/confirmacao.mp4',
  'public/assets/botao-confirmar.png',
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
if (admin.includes('id="accessBox"') || admin.includes('id="deviceUid"') || admin.includes('id="loginForm"')) throw new Error('Tela antiga de autorização ainda presente');
const rules = readFileSync('firestore.rules','utf8');
if (!rules.includes('existsAfter(conf)') || !rules.includes('match /admins/{uid}')) throw new Error('Regras ausentes');
if (!rules.includes('validCancelamento(uid)') || !rules.includes('reserveOk(d.alimento)') || !rules.includes('devolucaoDoConvidado(id)')) throw new Error('Regras de alimento obrigatório/cancelamento ausentes');
const page = readFileSync('public/index.html','utf8');
if (page.includes('Somente confirmar presença') || page.includes("addLine('Confirmação: '") || page.includes("addLine('Total: '")) throw new Error('Texto antigo de confirmação encontrado');
if (!page.includes('id="receiptMaps"') || !page.includes('id="cancelConfirmation"')) throw new Error('Resumo/Maps/cancelamento ausentes');
if (page.includes('locationButton') || page.includes('botao-local.png')) throw new Error('Botão antigo de localização presente');
console.log('OK: convite, painel com acesso direto, Firestore, arte e vídeo.');
console.log('OK: raiz organizada para Vercel, sem Cloud Functions e sem PHP.');
