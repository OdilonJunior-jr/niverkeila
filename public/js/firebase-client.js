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
  // Painel público, conforme solicitado: sem liberação por dispositivo.
  await garantirConvidado();
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
  // Alterações administrativas são transacionais para manter os saldos exatos.
  if (nome === 'editarConfirmacao') {
    const id = String(parametros.id || '');
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Confirmação inválida.');
    const guestName = String(parametros.nome || '').trim().replace(/\s+/g, ' ');
    const companions = parametros.acompanhantes;
    const foodId = String(parametros.alimento_id || '');
    if (!checkName(guestName) || !Array.isArray(companions) || companions.length > 12 ||
        companions.some(n => !checkName(n)) || !/^[a-zA-Z0-9_-]{1,64}$/.test(foodId)) {
      throw new Error('Confira nome, acompanhantes e alimento.');
    }
    const names = companions.map(n => n.trim().replace(/\s+/g, ' '));
    await store.runTransaction(db, async tx => {
      const guestRef = store.doc(db, 'confirmacoes', id);
      const guestSnap = await tx.get(guestRef);
      if (!guestSnap.exists()) throw new Error('Confirmação não encontrada. Atualize o painel.');
      const old = guestSnap.data();
      if (old.status === 'cancelado') throw new Error('Não é possível editar uma confirmação cancelada.');
      if (!old.alimento?.id) throw new Error('Esta confirmação não possui alimento associado.');
      const changed = old.alimento.id !== foodId;
      let selected = old.alimento;
      if (changed) {
        const oldRef = store.doc(db, 'alimentos', old.alimento.id);
        const newRef = store.doc(db, 'alimentos', foodId);
        // Todas as leituras precisam acontecer antes das escritas na transação.
        const [oldFood, newFood] = await Promise.all([tx.get(oldRef), tx.get(newRef)]);
        if (!oldFood.exists() || !newFood.exists()) throw new Error('Um dos alimentos não existe mais.');
        const oldUsed = round3(Number(oldFood.data().used) - Number(old.alimento.quantidade));
        if (oldUsed < -0.000001) throw new Error('Saldo inconsistente do alimento anterior.');
        const f = newFood.data();
        if (!f.ativo || !(f.por_confirmacao > 0) ||
            Number(f.used) + Number(f.por_confirmacao) > Number(f.total) + 0.000001) {
          throw new Error('O novo alimento está indisponível ou sem saldo.');
        }
        selected = { id:foodId, nome:f.nome, unidade:f.unidade, quantidade:f.por_confirmacao };
        tx.update(oldRef, {used: Math.max(0, oldUsed)});
        tx.update(newRef, {used: round3(Number(f.used) + Number(f.por_confirmacao))});
      }
      tx.update(guestRef, {nome:guestName, acompanhantes:names, total:names.length+1, alimento:selected});
    });
    return {ok:true};
  }
  if (nome === 'excluirConfirmacao') {
    const id = String(parametros.id || '');
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Confirmação inválida.');
    const guestRef = store.doc(db, 'confirmacoes', id);
    // O painel é autorizado nas regras do Firestore por admins/<uid>.
    // A confirmação e a devolução de saldo devem ocorrer na MESMA transação.
    const resultado = await store.runTransaction(db, async tx => {
      const guest = await tx.get(guestRef);
      // Remover uma confirmação já excluída também é considerado sucesso.
      if (!guest.exists()) return { jaExcluido: true, saldoRevisar: false };
      const record = guest.data();
      let saldoRevisar = false;
      // O cancelamento já liberou a porção; nunca devolvê-la novamente.
      if (record.status !== 'cancelado' && record.alimento?.id) {
        const foodRef = store.doc(db, 'alimentos', String(record.alimento.id));
        const food = await tx.get(foodRef);
        if (food.exists()) {
          const used = Number(food.data().used);
          const qty = Number(record.alimento.quantidade);
          if (!Number.isFinite(used) || !Number.isFinite(qty) || qty < 0) {
            // Não alterar quantidade malformada: ainda assim permitir exclusão.
            saldoRevisar = true;
          } else {
            const descontado = round3(used - qty);
            // Registros antigos podem ter saldos menores que a reserva registrada.
            // Não bloquear a exclusão nem deixar saldo negativo.
            if (descontado < -0.000001) saldoRevisar = true;
            tx.update(foodRef, { used: Math.max(0, descontado) });
          }
        } else {
          // Se o alimento foi excluído antes, não há estoque a devolver.
          saldoRevisar = true;
        }
      }
      tx.delete(guestRef);
      return { jaExcluido: false, saldoRevisar };
    });
    return { ok:true, ...resultado };
  }
  if (nome === 'excluirAlimento') {
    const id=String(parametros.id || '');
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error('Alimento inválido.');
    await store.runTransaction(db, async tx => {
      const ref=store.doc(db,'alimentos',id);
      const snap=await tx.get(ref);
      if (!snap.exists()) throw new Error('Alimento não encontrado.');
      if (Number(snap.data().used) !== 0) {
        throw new Error('Esse alimento possui reservas. Exclua ou altere as confirmações que o utilizam antes.');
      }
      tx.delete(ref);
    });
    return {ok:true};
  }
  if (nome === 'dadosAdmin') {
    const [f, c] = await Promise.all([
      store.getDocs(store.collection(db, 'alimentos')),
      store.getDocs(store.collection(db, 'confirmacoes'))
    ]);
    const list = foodList(f).map(foodCard);
    const active = c.docs.map(d=>d.data()).filter(d=>d.status !== 'cancelado');
    const titulares = active.length;
    const acompanhantes = active.reduce((n,d) => n + (Array.isArray(d.acompanhantes) ? d.acompanhantes.length : 0), 0);
    return { ok:true, alimentos:list, estatisticas: { confirmacoes:titulares,
      acompanhantes, pessoas:titulares+acompanhantes } };
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
  if (/permission-denied/.test(code)) return 'O Firebase bloqueou esta ação. Publique o arquivo firestore.rules desta mesma versão em Firestore → Regras.';
  if (/unavailable|deadline-exceeded|network/.test(code)) return 'Sem conexão com o banco de dados. Tente novamente.';
  if (/already-exists/.test(code)) return 'Este dispositivo já confirmou presença.';
  if (message && !/FirebaseError|INTERNAL ASSERTION|Missing or insufficient permissions/.test(message)) return message;
  return alternativa;
}
