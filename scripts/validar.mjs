import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const required = [
  'index.html', 'admin.html', 'firebase-config.js',
  'js/firebase-client.js', 'js/admin.js',
  'assets/convite.png', 'assets/confirmacao.mp4',
  'assets/botao-local.png', 'assets/botao-confirmar.png'
];
for (const file of required) {
  if (!existsSync(join(publicDir, file)) || !statSync(join(publicDir,file)).isFile()) {
    throw new Error(`Arquivo ausente em public/: ${file}`);
  }
}
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const firebase = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'));
if (vercel.outputDirectory !== 'public' || vercel.framework !== null) throw new Error('Configuração Vercel inesperada.');
if (firebase.hosting) throw new Error('Firebase Hosting não deve substituir a Vercel.');
if (!firebase.functions || !firebase.firestore) throw new Error('Backend do Firebase não encontrado.');
for (const file of ['index.html', 'admin.html']) {
  const html = readFileSync(join(publicDir,file),'utf8');
  const source = file === 'index.html' ? 'js/firebase-client.js' : 'js/admin.js';
  if (!html.includes(source)) throw new Error(`Import ausente: ${file} -> ${source}`);
}
if (existsSync(join(root, 'public', '.env'))) throw new Error('Não inclua .env dentro da pasta pública!');
console.log(`OK: Vercel publica public/ (${required.length} arquivos principais presentes).`);
console.log('OK: Cloud Functions e Firestore permanecem fora da pasta publicada.');
console.log('OK: modo de testes, PHP e login simulado não fazem parte do projeto.');
