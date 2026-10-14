import { chamar, configurado, mensagemFirebase, garantirConvidado, verificarAdmin } from './firebase-client.js';
const $ = id => document.getElementById(id);
let foods = [], guests = [], cursor = null, loading = false, activeTab = 'convidados', shownGuests = 12, allFoods = false;

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


async function refresh() {
  if (loading) return;
  loading = true;
  status('Atualizando painel...');
  try {
    const [dashboard, page] = await Promise.all([chamar('dadosAdmin'), chamar('paginaConvidados')]);
    foods = dashboard.alimentos; guests = page.confirmacoes; cursor = page.cursorSeguinte; shownGuests = 12;
    const confirmations = dashboard.estatisticas.confirmacoes;
    const people = dashboard.estatisticas.pessoas;
    $('statConfirm').textContent = String(confirmations);
    $('statPeople').textContent = String(people);
    $('statCompanions').textContent = String(dashboard.estatisticas.acompanhantes);
    $('statFoods').textContent = String(foods.filter(f=>f.vagas>0).length);
    $('seedPanel').hidden = foods.length !== 0;
    renderFoods(); renderGuests();
    $('dashboard').hidden = false;
    status('Painel atualizado.');
  } catch(err) { status(mensagemFirebase(err,'Não foi possível carregar o painel.'),true); }
  finally { loading = false; }
}
$('refresh').addEventListener('click',refresh);

function makeInfo(text, className, parent, tag='p') {
  const el=document.createElement(tag);
  el.className=className;
  el.textContent=text;
  parent.appendChild(el);
  return el;
}
function renderGuests() {
  const rows=$('guestRows'); rows.replaceChildren();
  const search=$('search').value.trim().toLocaleLowerCase('pt-BR');
  const state=$('guestStatus').value;
  const filtered=guests.filter(g=>
    (state==='todos'||g.status===state)&&
    [g.nome,...g.acompanhantes,g.alimento?.nome||'',g.codigo]
      .some(t=>String(t).toLocaleLowerCase('pt-BR').includes(search)));
  for(const g of filtered.slice(0,shownGuests)) {
    const article=document.createElement('article');article.className='guest-card';
    if(g.status==='cancelado') article.classList.add('cancelled');

    const main=document.createElement('div');main.className='guest-main';
    const header=document.createElement('header');header.className='guest-heading';
    makeInfo(g.nome,'',header,'h3');
    makeInfo(g.status==='cancelado'?'Cancelado':`${1+g.acompanhantes.length} pessoa(s)`,'guest-pill',header,'span');
    main.appendChild(header);
    makeInfo(g.alimento ? `${g.alimento.nome} · ${unit(g.alimento.quantidade,g.alimento.unidade)}` : 'Alimento não informado','guest-food',main);
    article.appendChild(main);

    const meta=document.createElement('div');meta.className='guest-meta';
    const count=g.acompanhantes.length;
    makeInfo(`Acompanhantes: ${count}`,'guest-count',meta);
    makeInfo(`Código: ${g.codigo}`,'guest-code',meta);
    const when=g.criado_em ? new Date(g.criado_em).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : '—';
    makeInfo(`Confirmado em: ${when}`,'guest-date',meta);
    article.appendChild(meta);

    const actions=document.createElement('div');actions.className='row-actions';
    if(g.status!=='cancelado') {
      const edit=document.createElement('button');edit.type='button';edit.className='btn-edit';
      edit.textContent='Editar';edit.setAttribute('aria-label',`Editar confirmação de ${g.nome}`);
      edit.addEventListener('click',()=>openEditGuest(g));actions.appendChild(edit);
    }
    const remove=document.createElement('button');remove.type='button';remove.className='btn-delete';
    remove.textContent='Excluir';remove.setAttribute('aria-label',`Excluir confirmação de ${g.nome}`);
    remove.addEventListener('click',()=>deleteGuest(g,remove));actions.appendChild(remove);
    article.appendChild(actions);

    const details=document.createElement('details');details.className='guest-details';
    const summary=document.createElement('summary');summary.textContent='Ver detalhes';details.appendChild(summary);
    if(count) makeInfo(`Nomes dos acompanhantes: ${g.acompanhantes.join(', ')}`,'',details);
    else makeInfo('Sem acompanhantes informados.','',details);
    article.appendChild(details);

    rows.appendChild(article);
  }
  if(!filtered.length) makeInfo('Nenhum convidado encontrado.','guest-empty',rows);
  const more=filtered.length>shownGuests||Boolean(cursor);
  $('loadMore').hidden=!more;
  $('loadMore').textContent=filtered.length>shownGuests?'Mostrar mais convidados':'Carregar mais convidados';
}
let editingGuestId=null;
function openEditGuest(g) {
  editingGuestId=g.id;
  const dialog=$('editGuestDialog');
  $('editGuestName').value=g.nome;
  $('editGuestCompanions').value=g.acompanhantes.join('\n');
  const select=$('editGuestFood');select.replaceChildren();
  // Oferece alimentos com saldo, mesmo que outra opção tenha esgotado.
  const options=foods.filter(f=>f.vagas>0 || f.id===g.alimento?.id);
  for(const f of options) {
    const o=document.createElement('option');o.value=f.id;
    o.textContent=`${f.nome}${f.id===g.alimento?.id ? ' (atual)' : ` — ${f.vagas} vaga(s)`}`;
    select.appendChild(o);
  }
  if (g.alimento?.id && !options.some(f=>f.id===g.alimento.id)) {
    const o=document.createElement('option');o.value=g.alimento.id;
    o.textContent=`${g.alimento.nome} (atual)`;select.appendChild(o);
  }
  select.value=g.alimento?.id||'';
  $('editGuestError').hidden=true;
  if (!dialog.open) dialog.showModal();
}
$('editGuestClose').addEventListener('click',()=> $('editGuestDialog').close());
$('editGuestDialog').addEventListener('close',()=>{editingGuestId=null;});
$('editGuestForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!editingGuestId) return;
  const companions=$('editGuestCompanions').value.split(/\r?\n/u).map(x=>x.trim()).filter(Boolean);
  const save=$('editGuestSave');save.disabled=true;
  const dialogError=$('editGuestError');dialogError.hidden=true;
  try {
    await chamar('editarConfirmacao',{id:editingGuestId,nome:$('editGuestName').value,
      acompanhantes:companions,alimento_id:$('editGuestFood').value});
    $('editGuestDialog').close();
    await refresh();status('Confirmação editada com sucesso.');
  }catch(err){dialogError.textContent=mensagemFirebase(err);dialogError.hidden=false;}
  finally{save.disabled=false;}
});
async function deleteGuest(g,button) {
  const extra=g.status==='cancelado' ? '' : ' A porção do alimento será devolvida automaticamente.';
  if (!window.confirm(`Excluir definitivamente a confirmação de ${g.nome}?${extra}\n\nEssa ação não pode ser desfeita.`)) return;
  button.disabled=true;
  try {
    await chamar('excluirConfirmacao',{id:g.id});
    await refresh();status(`Confirmação de ${g.nome} excluída.`);
  }catch(err){status(mensagemFirebase(err),true);}
  finally{button.disabled=false;}
}
$('search').addEventListener('input',()=>{shownGuests=12;renderGuests()});
$('guestStatus').addEventListener('change',()=>{shownGuests=12;renderGuests()});
$('loadMore').addEventListener('click',async()=>{
  if (shownGuests<guests.length) {shownGuests+=12;renderGuests();return;}
  if (!cursor) return;
  const b=$('loadMore');b.disabled=true;
  try {
    const page=await chamar('paginaConvidados',{cursor});
    guests.push(...page.confirmacoes);cursor=page.cursorSeguinte;shownGuests+=12;renderGuests();
  }catch(err){status(mensagemFirebase(err),true)}
  finally{b.disabled=false}
});

function renderFoods() {
  const grid=$('foodGrid');grid.replaceChildren();
  const search=$('foodSearch').value.trim().toLocaleLowerCase('pt-BR');
  const matches=foods.filter(f=>f.nome.toLocaleLowerCase('pt-BR').includes(search));
  const visible = allFoods || search ? matches : matches.slice(0,10);
  const toggle=$('foodAllToggle');
  toggle.hidden=Boolean(search)||foods.length<=10;
  toggle.textContent=allFoods?'Ver menos alimentos':`Ver todos (${foods.length})`;
  for(const food of visible) {
    const index=foods.findIndex(f=>f.id===food.id);
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
    const deleteButton=section.querySelector('.remove-food');
    deleteButton.disabled=Number(food.used)>0;
    deleteButton.title=Number(food.used)>0 ? 'Há porções reservadas; remova ou edite essas confirmações antes.' : 'Excluir alimento sem reservas';
    deleteButton.addEventListener('click',async()=>{
      if(!window.confirm(`Excluir o alimento ${food.nome}? Essa ação não pode ser desfeita.`)) return;
      deleteButton.disabled=true;
      try{await chamar('excluirAlimento',{id:food.id});await refresh();status(`Alimento ${food.nome} excluído.`);}
      catch(err){status(mensagemFirebase(err),true)}finally{deleteButton.disabled=false;}
    });
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
    // Cada item fechado ocupa uma linha; os campos de edição aparecem somente ao abrir.
    const accordion=document.createElement('details');accordion.className='food-accordion';
    const summary=document.createElement('summary');summary.className='food-summary';
    makeInfo(food.nome,'food-compact-name',summary,'span');
    const badge=makeInfo(food.vagas>0?`${food.vagas} vagas`:'Sem vagas','food-compact-vagas',summary,'span');
    badge.classList.toggle('off',food.vagas<=0);
    makeInfo('⌄','arrow',summary,'span');
    accordion.appendChild(summary);accordion.appendChild(section);grid.appendChild(accordion);
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
    section.querySelector('.remove-food').remove();
    form.addEventListener('submit',async event=>{
      event.preventDefault(); const button=form.querySelector('button[type="submit"]');button.disabled=true;
      try{await chamar('adicionarAlimento',readForm(form));status('Novo alimento criado.');await refresh();}
      catch(err){status(mensagemFirebase(err),true)}finally{button.disabled=false}
    });
    const accordion=document.createElement('details');accordion.className='food-accordion food-add-details';
    const summary=document.createElement('summary');summary.className='food-summary';
    makeInfo('+ Adicionar alimento','food-compact-name',summary,'span');
    makeInfo('⌄','arrow',summary,'span');
    accordion.appendChild(summary);accordion.appendChild(section);grid.appendChild(accordion);
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
$('foodSearch').addEventListener('input',renderFoods);
$('foodAllToggle').addEventListener('click',()=>{allFoods=!allFoods;renderFoods();});
$('seedButton').addEventListener('click',async()=>{
  const button=$('seedButton');button.disabled=true;
  try{
    await chamar('inicializarAlimentos');
    status('Alimentos cadastrados.');
    await refresh();
  }catch(err){status(mensagemFirebase(err),true)}finally{button.disabled=false}
});

async function checkAccess() {
  if (!configurado) { status('Firebase não configurado.',true); return; }
  status('Verificando acesso do painel...');
  try {
    await garantirConvidado();
    const { liberado, uid } = await verificarAdmin();
    $('deviceUid').value = uid;
    $('accessBox').hidden = liberado;
    $('dashboard').hidden = !liberado;
    if (liberado) await refresh();
    else status('Autorize este dispositivo no Firestore para ver os convidados.');
  } catch(e) {
    $('accessBox').hidden = false;
    status(mensagemFirebase(e,'Não foi possível acessar o banco.'),true);
  }
}
$('copyUid').addEventListener('click',async()=>{
  const id = $('deviceUid').value;
  if (!id) return;
  try { await navigator.clipboard.writeText(id); status('Identificador copiado.'); }
  catch { $('deviceUid').select(); status('Selecione e copie o identificador.'); }
});
$('retryAccess').addEventListener('click',checkAccess);
void checkAccess();
