'use strict';
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
initializeApp();
const db = getFirestore();

const REGION = 'southamerica-east1';
const opts = { region: REGION, memory: '256MiB', timeoutSeconds: 30, maxInstances: 10 };
const FOOD_NAMES = [
  'Batata chips', 'Quibe cru', 'Muçarela em cubinhos', 'Presunto em cubinhos',
  'Calabresa', 'Salsicha picada', 'Ovo de codorna', 'Azeitona', 'Tutu de feijão',
  'Farofa', 'Amendoim torrado', 'Batata em conserva', 'Salada de jiló',
  'Feijão tropeiro', 'Torrada temperada', 'Patê de frango', 'Bolinho de arroz',
  'Pururuca', 'Pimentinha', 'Salaminho italiano fatiado', 'Provolone fatiado',
  'Mandioca cozida ou frita', 'Palmito em rodelas', 'Isca de frango',
  'Cenoura em palitos', 'Almôndegas'
];
const GRAM_IDS = new Set([1,3,4,5,8,9,10,11,12,13,14,16,18,19,20,21,22,23,24,25]);
const UNITS = new Set(['un', 'g', 'kg', 'porcao', 'pacote', 'pote', 'bandeja', 'litro']);
const round3 = n => Math.round((n + Number.EPSILON) * 1000) / 1000;

function validName(input) {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/\s+/gu, ' ');
  if (/[\u0000-\u001F\u007F<>]/u.test(cleaned)) return null;
  const length = Array.from(cleaned).length;
  return length >= 2 && length <= 90 ? cleaned : null;
}
function validAmount(value, allowZero = false) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim().replace(',', '.');
  if (!/^\d{1,9}(?:\.\d{1,3})?$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) && number <= 999999999 && (allowZero ? number >= 0 : number > 0) ? number : null;
}
function payloadOf(request) {
  return request.data && typeof request.data === 'object' && !Array.isArray(request.data) ? request.data : {};
}
function validFoodFields(raw) {
  const nome = validName(raw.nome);
  const unidade = raw.unidade;
  const total = validAmount(raw.total, true);
  const por_confirmacao = validAmount(raw.por_confirmacao);
  if (!nome || !UNITS.has(unidade) || total === null || por_confirmacao === null || typeof raw.ativo !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Preencha o nome, a unidade, o total, a porção e a ativação corretamente.');
  }
  return { nome, unidade, total, por_confirmacao, ativo: raw.ativo };
}
async function exigeAdmin(request) {
  if (!request.auth?.uid || request.auth.token?.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('unauthenticated', 'Entre com o e-mail e a senha do administrador.');
  }
  const doc = await db.doc(`admins/${request.auth.uid}`).get();
  if (!doc.exists || doc.data()?.active !== true) {
    throw new HttpsError('permission-denied', 'Essa conta não foi autorizada como administradora.');
  }
}
function foodInfo(doc) {
  return { id: doc.id, ...doc.data() };
}
function available(food) {
  const left = round3(food.total - food.used);
  const qty = food.por_confirmacao;
  return !!food.ativo && qty > 0 && left + 0.0000001 >= qty;
}
function toFoodCard(food) {
  const saldo = Math.max(0, round3(food.total - food.used));
  return { ...food, saldo, vagas: food.ativo && food.por_confirmacao > 0
    ? Math.max(0, Math.floor((saldo + 0.0000001) / food.por_confirmacao)) : 0 };
}
function sortedFoods(snapshot) {
  return snapshot.docs.map(foodInfo).sort((a,b) => (a.ordem || 0) - (b.ordem || 0));
}
function resultEntry(row) {
  return { codigo: row.codigo, nome: row.nome,
    acompanhantes: row.acompanhantes || [], total: row.total,
    alimento: row.alimento, criado_em: row.criado_em || row.createdAt?.toDate?.().toISOString() };
}

// Listagem pública sem acesso direto ao Firestore. Nomes de convidados nunca são expostos.
exports.listarAlimentos = onCall(opts, async () => {
  const foods = sortedFoods(await db.collection('alimentos').get());
  return { ok: true, alimentos: foods.filter(available).map(food => ({
    id: food.id, nome: food.nome, unidade: food.unidade,
    quantidade: food.por_confirmacao, vagas: toFoodCard(food).vagas
  })) };
});

// O saldo e a confirmação são gravados juntos, em transação, evitando reservas acima do estoque.
exports.confirmarPresenca = onCall(opts, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'A sessão de convidado expirou. Atualize a página.');
  const data = payloadOf(request);
  if (data.website) throw new HttpsError('invalid-argument', 'Não foi possível validar o formulário.');
  const nome = validName(data.nome);
  const guests = data.acompanhantes;
  if (!nome || !Array.isArray(guests) || guests.length > 12 || guests.some(v => validName(v) === null)) {
    throw new HttpsError('invalid-argument', 'Preencha seu nome e até 12 acompanhantes válidos.');
  }
  const acompanhantes = guests.map(validName);
  const foodId = data.alimento_id;
  if (typeof foodId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(foodId)) {
    throw new HttpsError('invalid-argument', 'Selecione um alimento para levar.');
  }
  const requestId = data.solicitacao_id;
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,90}$/.test(requestId)) {
    throw new HttpsError('invalid-argument', 'Atualize a página e tente novamente.');
  }
  const confirmationRef = db.doc(`confirmacoes/${requestId}`);
  const foodRef = db.doc(`alimentos/${foodId}`);
  const rateRef = db.doc(`limites/${uid}`);
  const statsRef = db.doc('meta/estatisticas');
  const now = Date.now();
  const output = await db.runTransaction(async tx => {
    // TODAS as leituras precedem as gravações.
    const [existing, foodSnap, rateSnap, statsSnap] = await Promise.all([
      tx.get(confirmationRef), tx.get(foodRef), tx.get(rateRef), tx.get(statsRef)
    ]);
    if (existing.exists) {
      if (existing.data().uid !== uid) throw new HttpsError('permission-denied', 'Confirmação inválida.');
      return resultEntry(existing.data()); // idempotência em retransmissões
    }
    const previous = rateSnap.exists ? rateSnap.data().ultimoMs : 0;
    if (Number.isFinite(previous) && now - previous < 8000) {
      throw new HttpsError('resource-exhausted', 'Aguarde alguns segundos antes de registrar outra confirmação.');
    }
    if (!foodSnap.exists) throw new HttpsError('failed-precondition', 'Este alimento não está disponível. Escolha outro.');
    const food = foodSnap.data();
    if (!available(food)) throw new HttpsError('failed-precondition', 'Este alimento acabou de esgotar. Escolha outro.');
    const quantidade = food.por_confirmacao;
    const used = round3(food.used + quantidade);
    const totalPeople = 1 + acompanhantes.length;
    const row = {
      codigo: `MB-${requestId.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      uid, nome, acompanhantes, total: totalPeople,
      alimento: { id: foodId, nome: food.nome, quantidade, unidade: food.unidade },
      criado_em: new Date(now).toISOString(), createdAt: Timestamp.fromMillis(now)
    };
    tx.update(foodRef, { used });
    tx.create(confirmationRef, row);
    tx.set(rateRef, { ultimoMs: now, ultimaConfirmacao: requestId });
    tx.set(statsRef, {
      confirmacoes: (statsSnap.exists ? (statsSnap.data().confirmacoes || 0) : 0) + 1,
      pessoas: (statsSnap.exists ? (statsSnap.data().pessoas || 0) : 0) + totalPeople,
      updatedAt: FieldValue.serverTimestamp()
    });
    return resultEntry(row);
  });
  return { ok: true, ...output };
});

exports.dadosAdmin = onCall(opts, async (request) => {
  await exigeAdmin(request);
  const [foods, stats] = await Promise.all([
    db.collection('alimentos').get(), db.doc('meta/estatisticas').get()
  ]);
  const foodRows = sortedFoods(foods).map(toFoodCard);
  return { ok: true, alimentos: foodRows, estatisticas: stats.exists
    ? { confirmacoes: stats.data().confirmacoes || 0, pessoas: stats.data().pessoas || 0 }
    : { confirmacoes: 0, pessoas: 0 } };
});

// Páginas para que lista e exportação CSV não percam convidados após muitos registros.
exports.paginaConvidados = onCall(opts, async (request) => {
  await exigeAdmin(request);
  const cursor = payloadOf(request).cursor;
  if (cursor !== undefined && (typeof cursor !== 'string' || !/^[a-zA-Z0-9-]{16,90}$/.test(cursor))) {
    throw new HttpsError('invalid-argument', 'Cursor inválido.');
  }
  let query = db.collection('confirmacoes').orderBy('createdAt', 'desc').limit(100);
  if (cursor) {
    const snap = await db.doc(`confirmacoes/${cursor}`).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Não foi possível continuar a lista. Atualize o painel.');
    query = query.startAfter(snap);
  }
  const results = await query.get();
  return { ok: true,
    confirmacoes: results.docs.map(snap => ({ id: snap.id, ...resultEntry(snap.data()) })),
    cursorSeguinte: results.docs.length === 100 ? results.docs[results.docs.length - 1].id : null
  };
});

// Chamado UMA vez no primeiro acesso administrativo. Todos os totais iniciam em zero.
exports.inicializarAlimentos = onCall(opts, async (request) => {
  await exigeAdmin(request);
  return db.runTransaction(async tx => {
    const configRef = db.doc('meta/configuracao');
    const firstRef = db.doc('alimentos/1');
    const [config, first] = await Promise.all([tx.get(configRef), tx.get(firstRef)]);
    if (config.exists || first.exists) return { ok: true, jaInicializado: true };
    FOOD_NAMES.forEach((nome, index) => {
      const id = index + 1;
      tx.create(db.doc(`alimentos/${id}`), {
        nome, unidade: GRAM_IDS.has(id) ? 'g' : 'un', total: 0,
        por_confirmacao: 1, ativo: true, used: 0, ordem: id
      });
    });
    tx.create(configRef, { inicializado: true, quantidadeAlimentos: FOOD_NAMES.length, criadoEm: FieldValue.serverTimestamp() });
    return { ok: true, jaInicializado: false };
  });
});

exports.salvarAlimento = onCall(opts, async (request) => {
  await exigeAdmin(request);
  const raw = payloadOf(request);
  if (typeof raw.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(raw.id)) {
    throw new HttpsError('invalid-argument', 'Alimento inválido.');
  }
  const fields = validFoodFields(raw);
  const ref = db.doc(`alimentos/${raw.id}`);
  await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (!doc.exists) throw new HttpsError('not-found', 'Alimento não encontrado.');
    const old = doc.data();
    if (fields.total + 0.0000001 < old.used) {
      throw new HttpsError('failed-precondition', `O total não pode ser menor que o reservado (${old.used} ${old.unidade}).`);
    }
    if (old.used > 0 && old.unidade !== fields.unidade) {
      throw new HttpsError('failed-precondition', 'Não é possível mudar a unidade de um alimento que já tem reservas.');
    }
    tx.update(ref, fields);
  });
  return { ok: true };
});

exports.adicionarAlimento = onCall(opts, async (request) => {
  await exigeAdmin(request);
  const fields = validFoodFields(payloadOf(request));
  const configRef = db.doc('meta/configuracao');
  const newRef = db.collection('alimentos').doc();
  await db.runTransaction(async tx => {
    const config = await tx.get(configRef);
    if (!config.exists) throw new HttpsError('failed-precondition', 'Inicialize os 26 alimentos primeiro.');
    const count = Number(config.data().quantidadeAlimentos || 0);
    if (count >= 100) throw new HttpsError('resource-exhausted', 'Limite de 100 alimentos atingido.');
    tx.create(newRef, { ...fields, used: 0, ordem: count + 1 });
    tx.update(configRef, { quantidadeAlimentos: count + 1 });
  });
  return { ok: true, id: newRef.id };
});
