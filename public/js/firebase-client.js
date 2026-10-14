import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js';
import { firebaseConfig, functionsRegion } from '../firebase-config.js';

export const configurado = !!(firebaseConfig.apiKey && firebaseConfig.appId && firebaseConfig.projectId &&
  !Object.values(firebaseConfig).some(v => typeof v === 'string' && /(COLE_AQUI|SEU_PROJECT_ID)/.test(v)));
const app = configurado ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
const functions = app ? getFunctions(app, functionsRegion) : null;

export async function garantirConvidado() {
  if (!auth) throw new Error('Firebase não configurado.');
  // Aguarda a sessão salva ser recuperada antes de criar outro usuário anônimo.
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser;
}
export async function chamar(nome, parametros = {}) {
  if (!functions) throw new Error('Firebase não configurado.');
  const resposta = await httpsCallable(functions, nome, { timeout: 30000 })(parametros);
  return resposta.data;
}
export function mensagemFirebase(erro, alternativa = 'Erro de conexão. Tente novamente.') {
  const codigo = String(erro?.code || '');
  const mensagem = String(erro?.message || '');
  if (mensagem.includes('Firebase não configurado')) return mensagem;
  if (codigo.includes('unauthenticated')) return 'A sessão expirou. Atualize a página e tente novamente.';
  if (codigo.includes('permission-denied')) return 'Seu usuário não tem permissão para acessar esta área.';
  if (codigo.includes('unavailable') || codigo.includes('deadline-exceeded')) return 'Conexão indisponível. Tente novamente; seu pedido não será duplicado.';
  if (codigo.includes('auth/operation-not-allowed')) return 'O organizador precisa habilitar o acesso Anônimo no Firebase Authentication.';
  if (codigo.includes('auth/invalid-credential')) return 'E-mail ou senha incorretos.';
  if (codigo.includes('auth/too-many-requests')) return 'Muitas tentativas. Tente novamente mais tarde.';
  // Firebase callable transmite mensagens que foram explicitamente definidas pelo servidor.
  if (codigo.startsWith('functions/') && mensagem && !/internal|unknown/i.test(codigo)) return mensagem;
  return alternativa;
}
