import { chamar, configurado, mensagemFirebase, observarSessao, entrarAdministrador, sairAdministrador } from './firebase-client.js';
const $ = id => document.getElementById(id);
let foods = [], guests = [], cursor = null, loading = false, activeTab = 'convidados';

function status(text, error = false) {
  const el = $('feedback');
  el.hidden = !text; el.textContent = text || '';
  el.className = error ? 'error' : 'notice';
}
function unit(qty, name) {
  const symbols = {un:'un.',g:'g',kg:'kg',porcao:'porção(ões)',pacote:'pacote(s)',pote:'pote(s)',bandeja:'bandeja(s)',litro:'L'};
  return `${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:3}).format(qty)} ${symbols[name] || name}`;
}
function view(tab) {
  activeTab = tab;
  $('guestsPanel').hidden = tab !== 'convidados';
  $('foodsPanel').hidden = tab !== 'alimentos';
  $('tabGuests').setAttribute('aria-selected',String(tab==='convidados'));
  $('tabFoods').setAttribute('aria-selected',String(tab==='alimentos'));
}
$('tabGuests').addEventListener('click', () => view('convidados'));
$('tabFoods').addEventListener('click', () => view('alimentos'));
$('logout').addEventListener('click', () => sairAdministrador().catch(err => status(mensagemFirebase(err),true)));

async function refresh() {
  if (loading) return;
  loading = true;
  status('Atualizando painel...');
  try {
    const [dashboard, page] = await Promise.all([chamar('dadosAdmin'), chamar('paginaConvidados')]);
    foods = dashboard.alimentos; guests = page.confirmacoes; cursor = page.cursorSeguinte;
    const confirmations = dashboard.estatisticas.confirmacoes;
    const people = dashboard.estatisticas.pessoas;
    $('statConfirm').textContent = String(confirmations);
    $('statPeople').textContent = String(people);
    $('statCompanions').textContent = String(Math.max(0,people-confirmations));
    $('statFoods').textContent = String(foods.filter(f=>f.vagas>0).length);
    $('seedPanel').hidden = foods.length !== 0;
    renderFoods(); renderGuests();
    $('dashboard').hidden = false;
    status('Painel atualizado.');
  } catch(err) { status(mensagemFirebase(err,'Não foi possível carregar o painel.'),true); }
  finally { loading = false; }
}
$('refresh').addEventListener('click',refresh);

function makeTextCell(row, text, className = '') {
  const cell=document.createElement('td');
  if(className) cell.className=className;
  cell.textContent = String(text);
  row.appendChild(cell);
  return cell;
}
function renderGuests() {
  const rows=$('guestRows'); rows.replaceChildren();
  const search=$('search').value.trim().toLocaleLowerCase('pt-BR');
  const filtered = guests.filter(g=>[g.nome,...g.acompanhantes,g.alimento?.nome||'',g.codigo]
    .some(s=>String(s).toLocaleLowerCase('pt-BR').includes(search)));
  for(const g of filtered) {
    const row=document.createElement('tr');
    makeTextCell(row,g.codigo,'code');
    makeTextCell(row,g.nome);
    makeTextCell(row,g.acompanhantes.length ? g.acompanhantes.join(', ') : '—');
    makeTextCell(row,g.total);
    makeTextCell(row,g.alimento ? `${g.alimento.nome} — ${unit(g.alimento.quantidade,g.alimento.unidade)}` : 'Não informado');
    const when = g.criado_em ? new Date(g.criado_em).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : '—';
    makeTextCell(row, when);
    rows.appendChild(row);
  }
  if(!filtered.length) { const row=document.createElement('tr'); const cell=document.createElement('td');cell.colSpan=6;cell.textContent='Nenhum convidado encontrado nesta página.';row.appendChild(cell);rows.appendChild(row); }
  $('loadMore').hidden = !cursor;
}
$('search').addEventListener('input',renderGuests);
$('loadMore').addEventListener('click',async()=>{
  if(!cursor) return;
  const b=$('loadMore');b.disabled=true;
  try {
    const page=await chamar('paginaConvidados',{cursor});
    guests.push(...page.confirmacoes);cursor=page.cursorSeguinte;renderGuests();
  } catch(err){status(mensagemFirebase(err),true)}
  finally{b.disabled=false}
});

function exportField(raw) {
  let text=String(raw??'');
  // Evita que nomes que comecem com =, +, -, @, etc. sejam executados como fórmula no Excel.
  if (/^\s*[=+@\-\t\r]/u.test(text)) text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
$('exportCSV').addEventListener('click',async()=>{
  const button=$('exportCSV'); button.disabled=true;
  status('Preparando exportação de todas as confirmações...');
  try {
    let all=[], next=null;
    do {
      const page=await chamar('paginaConvidados', next ? {cursor:next} : {});
      all.push(...page.confirmacoes);next=page.cursorSeguinte;
    } while(next);
    const lines=[['Código','Data','Convidado','Acompanhantes','Total de pessoas','Alimento','Quantidade','Unidade']];
    for(const g of all) lines.push([
      g.codigo,g.criado_em,g.nome,g.acompanhantes.join(' | '),g.total,
      g.alimento?.nome||'',g.alimento?.quantidade??'',g.alimento?.unidade||''
    ]);
    const csv='\uFEFF'+lines.map(row=>row.map(exportField).join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='convidados-made-in-brasil.csv';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    status(`${all.length} confirmação(ões) incluída(s) no CSV.`);
  }catch(err){status(mensagemFirebase(err),true)}
  finally{button.disabled=false}
});

function renderFoods() {
  const grid=$('foodGrid');grid.replaceChildren();
  for(const [index,food] of foods.entries()) {
    const section=$('foodTemplate').content.firstElementChild.cloneNode(true);
    section.querySelector('.food-name').textContent=`${index+1}. ${food.nome}`;
    const pill=section.querySelector('.pill');
    pill.textContent=food.vagas>0?`${food.vagas} vagas`:'Indisponível';
    pill.classList.toggle('off',food.vagas<=0);
    const form=section.querySelector('form');
    form.elements.namedItem('nome').value=food.nome;
    form.elements.namedItem('unidade').value=food.unidade;
    form.elements.namedItem('total').value=food.total;
    form.elements.namedItem('por_confirmacao').value=food.por_confirmacao;
    form.elements.namedItem('ativo').checked=food.ativo;
    section.querySelector('.food-amount').textContent=`Reservado: ${unit(food.used,food.unidade)} · Saldo: ${unit(food.saldo,food.unidade)}`;
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');button.disabled=true;
      try {
        await chamar('salvarAlimento',{id:food.id,...readForm(form)});
        status(`Alimento "${food.nome}" atualizado.`);
        await refresh();
      }catch(err){status(mensagemFirebase(err),true)}
      finally{button.disabled=false}
    });
    grid.appendChild(section);
  }
  if(foods.length) {
    const section=$('foodTemplate').content.firstElementChild.cloneNode(true);
    section.classList.add('add-card');
    section.querySelector('.food-name').textContent='+ Adicionar outro alimento';
    section.querySelector('.pill').remove();
    section.querySelector('.food-amount').textContent='O alimento será cadastrado com saldo integral disponível.';
    const form=section.querySelector('form');
    form.reset();form.elements.namedItem('total').value='0';form.elements.namedItem('por_confirmacao').value='1';
    form.elements.namedItem('ativo').checked=true;
    form.querySelector('button[type="submit"]').textContent='Adicionar item';
    form.addEventListener('submit',async event=>{
      event.preventDefault(); const button=form.querySelector('button[type="submit"]');button.disabled=true;
      try{await chamar('adicionarAlimento',readForm(form));status('Novo alimento criado.');await refresh();}
      catch(err){status(mensagemFirebase(err),true)}finally{button.disabled=false}
    });
    grid.appendChild(section);
  }
}
function readForm(form) {
  return {
    nome:form.elements.namedItem('nome').value.trim(),
    unidade:form.elements.namedItem('unidade').value,
    total:form.elements.namedItem('total').value,
    por_confirmacao:form.elements.namedItem('por_confirmacao').value,
    ativo:form.elements.namedItem('ativo').checked
  };
}
$('seedButton').addEventListener('click',async()=>{
  const button=$('seedButton');button.disabled=true;
  try{
    await chamar('inicializarAlimentos');
    status('Alimentos cadastrados.');
    await refresh();
  }catch(err){status(mensagemFirebase(err),true)}finally{button.disabled=false}
});

$('loginForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=$('loginButton');button.disabled=true;
  status('Autenticando...');
  try{await entrarAdministrador($('email').value.trim(),$('password').value);}
  catch(err){status(mensagemFirebase(err,'Não foi possível entrar. Confira o e-mail e a senha.'),true);}
  finally{button.disabled=false}
});
if (!configurado) {
  $('loginBox').hidden=false;
  $('loginButton').disabled=true;
  status('Painel temporariamente indisponível.',true);
} else {
  observarSessao(async user=>{
    $('dashboard').hidden=true;
    $('logout').hidden=!user || user.isAnonymous;
    $('loginBox').hidden=!!user && !user.isAnonymous;
    if(user && !user.isAnonymous) await refresh();
    else if(!user) status('Entre com a conta administrativa cadastrada no Firebase.');
  }).catch(err=>{ $('loginBox').hidden=false; status(mensagemFirebase(err,'Não foi possível abrir o painel.'),true); });
}
