import { firebaseConfig } from '../firebase-config.js';

// Versão sem Cloud Functions: Firestore + login anônimo (plano Spark).
export const configurado = Boolean(firebaseConfig.apiKey && firebaseConfig.appId && firebaseConfig.projectId);
let sdkPromise;
const FOOD_NAMES = [
  'Batata chips','Quibe cru','Muçarela em cubinhos','Presunto em cubinhos',
  'Calabresa','Salsicha picada','Ovo de codorna','Azeitona','Tutu de feijão',
  'Farofa','Amendoim torrado','Batata em conserva','Salada de jiló',
  'Feijão tropeiro','Torrada temperada','Patê de frango','Bolinho de arroz',
  'Pururuca','Pimentinha','Salaminho italiano fatiado','Provolone fatiado',
  'Mandioca cozida ou frita','Palmito em rodelas','Isca de frango',
  'Cenoura em palitos','Almôndegas'
];
const GRAM_IDS = new Set([1,3,4,5,8,9,10,11,12,13,14,16,18,19,20,21,22,23,24,25]);
const UNIT_SET = new Set(['un','g','kg','porcao','pacote','pote','bandeja','litro']);
const round3 = n => Math.round((n + Number.EPSILON) * 1000) / 1000;
const checkName = s => typeof s === 'string' && [...s.trim()].length >= 2 && [...s.trim()].length <= 90 && !/[<>\x00-\x1f]/.test(s);

async function conectar() {
  if (!configurado) throw new Error('Firebase não configurado.');
  if (!sdkPromise) sdkPromise = Promise.all([
    import('https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js')
  ]).then(([appSdk, authSdk, store]) => {
    const app = appSdk.initializeApp(firebaseConfig);
    return { auth: authSdk.getAuth(app), db: store.getFirestore(app), authSdk, store };
  }).catch(e => { sdkPromise = undefined; throw e; });
  return sdkPromise;
}
export async function garantirConvidado() {
  const { auth, authSdk } = await conectar();
  await auth.authStateReady();
  if (!auth.currentUser) await authSdk.signInAnonymously(auth);
  return auth.currentUser;
}
export async function verificarAdmin() {
  const user = await garantirConvidado();
  const { db, store } = await conectar();
  const snap = await store.getDoc(store.doc(db, 'admins', user.uid));
  return { liberado: snap.exists() && snap.data().active === true, uid: user.uid };
}
function foodList(snap) {
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.ordem || 0) - (b.ordem || 0));
}
function amount(value, zero = false) {
  const s = String(value).trim().replace(',', '.');
  if (!/^\d{1,9}(?:\.\d{1,3})?$/.test(s)) throw new Error('Use números positivos com até três casas decimais.');
  const v = Number(s);
  if (!Number.isFinite(v) || (zero ? v < 0 : v <= 0)) throw new Error('Informe uma quantidade válida.');
  return v;
}
function validateFood(raw) {
  if (!checkName(raw.nome) || !UNIT_SET.has(raw.unidade) || typeof raw.ativo !== 'boolean') {
    throw new Error('Confira o nome, a unidade e a ativação do alimento.');
  }
  return { nome: raw.nome.trim(), unidade: raw.unidade, total: amount(raw.total, true),
    por_confirmacao: amount(raw.por_confirmacao), ativo: raw.ativo };
}
const foodCard = f => ({ ...f, saldo: Math.max(0,round3(f.total-f.used)),
  vagas: f.ativo && f.por_confirmacao > 0 ? Math.max(0,Math.floor((f.total-f.used+0.0000001)/f.por_confirmacao)) : 0 });
function rowData(d) {
  const r = d.data();
  return { id:d.id, codigo:r.codigo, nome:r.nome, acompanhantes:r.acompanhantes||[],
    total:r.total, alimento:r.alimento, criado_em:r.criado_em,
    status:r.status === 'cancelado' ? 'cancelado' : 'confirmado', cancelado_em:r.cancelado_em || null };
}
async function assertAdmin() {
  const admin = await verificarAdmin();
  if (!admin.liberado) throw Object.assign(new Error('Este dispositivo não foi autorizado como administrador.'), { code:'permission-denied' });
}
export async function chamar(nome, parametros = {}) {
  const { db, store } = await conectar();
  if (nome === 'listarAlimentos') {
    const all = foodList(await store.getDocs(store.collection(db, 'alimentos')));
    return { ok: true, alimentos: all.map(foodCard).filter(f => f.vagas > 0).map(f => ({
      id:f.id, nome:f.nome, unidade:f.unidade, quantidade:f.por_confirmacao, vagas:f.vagas
    })) };
  }
  if (nome === 'minhaConfirmacao') {
    // Não criamos contas anônimas para quem apenas abre o convite.
    const {auth} = await conectar();
    await auth.authStateReady();
    if (!auth.currentUser) return {ok:true, confirmacao:null};
    const own = await store.getDoc(store.doc(db, 'confirmacoes', auth.currentUser.uid));
    return {ok:true, confirmacao:own.exists() ? rowData(own) : null};
  }
  if (nome === 'cancelarPresenca') {
    const user = await garantirConvidado();
    const ref = store.doc(db, 'confirmacoes', user.uid);
    const result = await store.runTransaction(db, async tx => {
      const current = await tx.get(ref);
      if (!current.exists()) return {cancelado:true};
      const record = current.data();
      if (record.status === 'cancelado') return {cancelado:true};
      const f = record.alimento;
      const foodRef = f?.id ? store.doc(db, 'alimentos', f.id) : null;
      const existingFood = foodRef ? await tx.get(foodRef) : null;
      if (existingFood?.exists()) {
        const oldUsed = Number(existingFood.data().used);
        const used = round3(oldUsed - Number(f.quantidade));
        if (used < 0) throw new Error('O saldo do alimento precisa ser conferido pela organização.');
        tx.update(foodRef, {used});
      }
      tx.update(ref, {status:'cancelado',cancelado_em:store.serverTimestamp()});
      return {cancelado:true};
    });
    return {ok:true,...result};
  }
  if (nome === 'confirmarPresenca') {
    const user = await garantirConvidado();
    if (parametros.website) throw new Error('Não foi possível validar a confirmação.');
    const guestName = String(parametros.nome||'').trim().replace(/\s+/g,' ');
    const companions = parametros.acompanhantes;
    if (!checkName(guestName) || !Array.isArray(companions) || companions.length > 12 || companions.some(n => !checkName(n))) {
      throw new Error('Confira o seu nome e os acompanhantes.');
    }
    const names = companions.map(n => n.trim().replace(/\s+/g,' '));
    const selectedId = String(parametros.alimento_id || '');
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(selectedId)) throw new Error('Escolha um alimento para confirmar presença.');
    const ref = store.doc(db, 'confirmacoes', user.uid);
    const result = await store.runTransaction(db, async tx => {
      const existing = await tx.get(ref);
      if (existing.exists() && existing.data().status !== 'cancelado') return existing.data(); // Não duplica confirmação.
      const foodRef = store.doc(db, 'alimentos', selectedId);
      const foodDoc = await tx.get(foodRef);
      let selectedFood = null;
      if (foodDoc) {
        if (!foodDoc.exists()) throw new Error('O alimento escolhido não está mais disponível.');
        const f = foodDoc.data();
        if (!f.ativo || f.por_confirmacao <= 0 || f.used + f.por_confirmacao > f.total + 0.0000001) {
          throw new Error('O alimento escolhido acabou. Atualize a lista e tente novamente.');
        }
        selectedFood = { id: selectedId, nome:f.nome, unidade:f.unidade, quantidade:f.por_confirmacao };
        tx.update(foodRef, { used: round3(f.used + f.por_confirmacao) });
      }
      const uuid = String(parametros.solicitacao_id || user.uid).replace(/-/g,'').slice(0,8).toUpperCase();
      const row = { codigo:`MB-${uuid}`, uid:user.uid, nome:guestName,
        acompanhantes:names, total:names.length+1, alimento:selectedFood,
        criado_em:new Date().toISOString(), createdAt:store.serverTimestamp(), status:'confirmado' };
      tx.set(ref, row);
      return row;
    });
    return { ok: true, codigo:result.codigo, nome:result.nome, acompanhantes:result.acompanhantes,
      total:result.total, alimento:result.alimento, status:result.status || 'confirmado' };
  }
  await assertAdmin();
  if (nome === 'dadosAdmin') {
    const [f, c] = await Promise.all([
      store.getDocs(store.collection(db, 'alimentos')),
      store.getDocs(store.collection(db, 'confirmacoes'))
    ]);
    const list = foodList(f).map(foodCard);
    const active = c.docs.filter(d => d.data().status !== 'cancelado');
    return { ok:true, alimentos:list, estatisticas: { confirmacoes:active.length,
      pessoas:active.reduce((n,d) => n + (d.data().total||1),0) } };
  }
  if (nome === 'paginaConvidados') {
    let q = store.query(store.collection(db,'confirmacoes'),store.orderBy('createdAt','desc'),store.limit(100));
    if (parametros.cursor) {
      const last = await store.getDoc(store.doc(db,'confirmacoes',parametros.cursor));
      if (!last.exists()) throw new Error('Página não encontrada. Atualize o painel.');
      q = store.query(store.collection(db,'confirmacoes'),store.orderBy('createdAt','desc'),store.startAfter(last),store.limit(100));
    }
    const snap = await store.getDocs(q);
    return { ok:true, confirmacoes:snap.docs.map(rowData),
      cursorSeguinte:snap.docs.length===100 ? snap.docs.at(-1).id : null };
  }
  if (nome === 'inicializarAlimentos') {
    const existing = await store.getDocs(store.collection(db,'alimentos'));
    const ids = new Set(existing.docs.map(d => d.id));
    const missing = FOOD_NAMES.map((name,i) => ({name,id:i+1})).filter(x => !ids.has(String(x.id)));
    for (let offset=0;offset<missing.length;offset+=10) {
      const batch = store.writeBatch(db);
      for (const {name,id} of missing.slice(offset,offset+10)) {
        batch.set(store.doc(db,'alimentos',String(id)), {
          nome:name,unidade:GRAM_IDS.has(id)?'g':'un',total:0,por_confirmacao:1,
          ativo:true,used:0,ordem:id
        });
      }
      await batch.commit();
    }
    return {ok:true,jaInicializado:missing.length===0};
  }
  if (nome === 'salvarAlimento') {
    const id = String(parametros.id || '');
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error('Alimento inválido.');
    const payload=validateFood(parametros);
    await store.runTransaction(db,async tx => {
      const ref=store.doc(db,'alimentos',id);
      const old=await tx.get(ref);
      if (!old.exists()) throw new Error('Alimento não encontrado.');
      if (payload.total+0.0000001 < old.data().used) throw new Error('O total não pode ser menor que a quantidade já reservada.');
      if (old.data().used > 0 && old.data().unidade !== payload.unidade) throw new Error('Não é possível mudar a unidade após receber reservas.');
      tx.update(ref,payload);
    });
    return {ok:true};
  }
  if (nome === 'adicionarAlimento') {
    const data=validateFood(parametros);
    const ref=store.doc(store.collection(db,'alimentos'));
    await store.setDoc(ref,{...data,used:0,ordem:FOOD_NAMES.length+1});
    return {ok:true,id:ref.id};
  }
  throw new Error('Operação desconhecida.');
}
export function mensagemFirebase(erro, alternativa='Erro de conexão. Tente novamente.') {
  const code=String(erro?.code||'');
  const message=String(erro?.message||'');
  if (/operation-not-allowed/.test(code)) return 'Ative o provedor Anônimo no Firebase Authentication.';
  if (/permission-denied/.test(code)) return 'Permissão negada. Verifique as regras do Firestore ou o acesso do administrador.';
  if (/unavailable|deadline-exceeded|network/.test(code)) return 'Sem conexão com o banco de dados. Tente novamente.';
  if (/already-exists/.test(code)) return 'Este dispositivo já confirmou presença.';
  if (message && !/FirebaseError|INTERNAL ASSERTION|Missing or insufficient permissions/.test(message)) return message;
  return alternativa;
}
