import { firebaseConfig, functionsRegion } from '../firebase-config.js';

// O convite precisa abrir mesmo antes de configurar o Firebase.
// SDK carregado só quando houver configuração e acesso aos dados.
export const configurado = !!(firebaseConfig.apiKey && firebaseConfig.appId && firebaseConfig.projectId &&
  !Object.values(firebaseConfig).some(v => typeof v === 'string' && /(COLE_AQUI|SEU_PROJECT_ID)/.test(v)));
let sdkPromise;

async function conectar() {
  if (!configurado) throw new Error('Firebase não configurado.');
  if (!sdkPromise) {
    sdkPromise = Promise.all([
      import('https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js')
    ]).then(([appSdk, authSdk, functionsSdk]) => {
      const app = appSdk.initializeApp(firebaseConfig);
      return {
        auth: authSdk.getAuth(app),
        functions: functionsSdk.getFunctions(app, functionsRegion),
        authSdk, functionsSdk
      };
    }).catch(err => { sdkPromise = null; throw err; });
  }
  return sdkPromise;
}

export async function garantirConvidado() {
  const { auth, authSdk } = await conectar();
  await auth.authStateReady();
  if (!auth.currentUser) await authSdk.signInAnonymously(auth);
  return auth.currentUser;
}
export async function chamar(nome, parametros = {}) {
  const { functions, functionsSdk } = await conectar();
  const resposta = await functionsSdk.httpsCallable(functions, nome, { timeout: 30000 })(parametros);
  return resposta.data;
}
export async function observarSessao(aoMudar) {
  const { auth, authSdk } = await conectar();
  return authSdk.onAuthStateChanged(auth, aoMudar);
}
export async function entrarAdministrador(email, senha) {
  const { auth, authSdk } = await conectar();
  return authSdk.signInWithEmailAndPassword(auth, email, senha);
}
export async function sairAdministrador() {
  const { auth, authSdk } = await conectar();
  return authSdk.signOut(auth);
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
  if (codigo.startsWith('functions/') && mensagem && !/internal|unknown/i.test(codigo)) return mensagem;
  return alternativa;
}
