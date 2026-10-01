// ===== Configuração: Supabase =====
const SUPABASE_URL = 'https://mbyvvponmlbeaniseyux.supabase.co';
const SUPABASE_KEY = 'sb_publishable_3dNXSnMhGS_sAoYd4Ua3Tw_OrnEyoTy';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const PAGE = 8;
let page = 0;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dt = d => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function msg(t, erro = true) {
  const el = $('#msg');
  el.textContent = t; el.className = erro ? 'erro' : 'ok'; el.hidden = !t;
}

// Executa uma consulta do Supabase; em caso de erro mostra a mensagem e devolve vazio
async function run(q) {
  try {
    const { data, error, count } = await q;
    if (error) throw error;
    msg('');
    return { data, count };
  } catch (e) {
    msg('Erro ao acessar o banco: ' + (e.message || 'falha de conexão'));
    return { data: null, count: 0 };
  }
}

async function loadDashboard() {
  const [pa, st, es, re] = await Promise.all([
    run(db.from('pacientes').select('*', { count: 'exact', head: true }).eq('ativo', true)),
    run(db.from('v_resumo_status').select('*')),
    run(db.from('v_receita_por_especialidade').select('*').order('receita', { ascending: false }).limit(5)),
    run(db.from('v_consultas_detalhe').select('valor_total').eq('status', 'Realizada')),
  ]);
  const s = Object.fromEntries((st.data || []).map(r => [r.status, r.total]));
  const receita = (re.data || []).reduce((a, r) => a + Number(r.valor_total), 0);
  const top = es.data || [];
  const max = Math.max(1, ...top.map(r => Number(r.receita)));
  $('#cards').innerHTML = [
    ['Pacientes ativos', pa.count ?? 0], ['Agendadas', s.Agendada || 0], ['Realizadas', s.Realizada || 0],
    ['Canceladas', s.Cancelada || 0], ['Receita realizada', brl(receita)],
  ].map(([t, v]) => `<div class="card"><small>${t}</small><b>${v}</b></div>`).join('');
  $('#top').innerHTML = top.map(r =>
    `<li><i style="width:${Number(r.receita) / max * 100}%"></i><span>${esc(r.especialidade)}</span><em>${brl(r.receita)}</em></li>`
  ).join('') || '<li>Sem dados</li>';
}

async function loadConsultas() {
  const t = $('#busca').value.replace(/[,()%]/g, ' ').trim(), s = $('#status').value;
  let q = db.from('v_consultas_detalhe').select('*', { count: 'exact' })
    .order('data_hora', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
  if (t) q = q.or(`paciente.ilike.%${t}%,profissional.ilike.%${t}%,especialidade.ilike.%${t}%`);
  if (s) q = q.eq('status', s);
  const { data, count } = await run(q);
  $('#lista').innerHTML = (data || []).map(r => `<tr>
    <td>${dt(r.data_hora)}</td><td>${esc(r.paciente)}</td>
    <td>${esc(r.profissional)}<br><small>${esc(r.especialidade)}</small></td>
    <td><span class="tag ${r.status}">${r.status}</span></td><td>${brl(r.valor_total)}</td>
    <td><button data-id="${r.id_consulta}">Detalhes</button></td></tr>`).join('')
    || '<tr><td colspan="6">Nenhuma consulta encontrada.</td></tr>';
  const total = Math.max(1, Math.ceil((count || 0) / PAGE));
  $('#pag').textContent = `Página ${page + 1} de ${total}`;
  $('#ant').disabled = page === 0;
  $('#prox').disabled = page + 1 >= total;
}

async function loadPacientes() {
  const { data } = await run(db.from('pacientes').select('*').order('id_paciente', { ascending: false }).limit(10));
  $('#pac').innerHTML = (data || []).map(p => `<tr><td>${esc(p.nome)}</td>
    <td>${new Date(p.data_nascimento + 'T00:00').toLocaleDateString('pt-BR')}</td>
    <td>${esc(p.telefone || '-')}<br><small>${esc(p.email || '')}</small></td>
    <td>${p.ativo ? 'Ativo' : 'Inativo'}</td></tr>`).join('') || '<tr><td colspan="4">Nenhum paciente.</td></tr>';
}

// Detalhe de uma consulta (modal)
$('#lista').onclick = async e => {
  const id = e.target.dataset.id;
  if (!id) return;
  const [c, p] = await Promise.all([
    run(db.from('v_consultas_detalhe').select('*').eq('id_consulta', id).single()),
    run(db.from('consulta_procedimentos').select('quantidade, procedimentos(nome, valor)').eq('id_consulta', id)),
  ]);
  if (!c.data) return;
  const r = c.data;
  $('#det').innerHTML = `<h3>Consulta #${r.id_consulta}</h3>
    <p><b>Paciente:</b> ${esc(r.paciente)}<br><b>Profissional:</b> ${esc(r.profissional)} (${esc(r.especialidade)})<br>
    <b>Data:</b> ${dt(r.data_hora)}<br><b>Status:</b> ${r.status}<br><b>Observações:</b> ${esc(r.observacoes || '-')}</p>
    <ul>${(p.data || []).map(x => `<li>${x.quantidade}x ${esc(x.procedimentos.nome)} - ${brl(x.procedimentos.valor)}</li>`).join('')}</ul>
    <p><b>Total: ${brl(r.valor_total)}</b></p>`;
  $('#dlg').showModal();
};

// Cadastro de paciente (INSERT)
$('#form').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target), nome = f.get('nome').trim();
  if (nome.length < 3) return msg('Informe o nome completo.');
  const { error } = await db.from('pacientes').insert({
    nome, data_nascimento: f.get('nasc'), telefone: f.get('tel') || null, email: f.get('email') || null,
  });
  if (error) return msg(error.code === '23505' ? 'Este e-mail já está cadastrado.' : 'Erro ao cadastrar: ' + error.message);
  e.target.reset();
  await loadPacientes();
  msg('Paciente cadastrado com sucesso!', false);
};

// Filtros e paginação
let timer;
$('#busca').oninput = () => { clearTimeout(timer); timer = setTimeout(() => { page = 0; loadConsultas(); }, 300); };
$('#status').onchange = () => { page = 0; loadConsultas(); };
$('#ant').onclick = () => { page--; loadConsultas(); };
$('#prox').onclick = () => { page++; loadConsultas(); };

// Navegação
const telas = { dashboard: loadDashboard, consultas: loadConsultas, pacientes: loadPacientes };
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('main section').forEach(s => s.hidden = s.id !== b.dataset.s);
  telas[b.dataset.s]();
});

if (SUPABASE_URL.includes('SEU-PROJETO')) msg('Configure SUPABASE_URL e SUPABASE_KEY em js/main.js.');
else loadDashboard();