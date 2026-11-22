const STATE = {
  token: localStorage.getItem('fg_token') || null,
  user: null,
  charts: { fluxo: null, categorias: null },
  financeiro: null,
  rh: null,
  admin: null,
  ocrLastUploadUrl: null
};

const MODULE_INFO = {
  dashboard: { title: 'Visão Geral', subtitle: 'Indicadores financeiros, vencimentos e alertas de NRs' },
  fluxo: { title: 'Fluxo de Caixa', subtitle: 'Extrato consolidado e lançamentos avulsos' },
  receber: { title: 'Contas a Receber', subtitle: 'Serviços comerciais, parcelas e controle de Nota Fiscal' },
  pagar: { title: 'Contas a Pagar', subtitle: 'Despesas, rateio, transcrição por foto de NF e comprovantes no R2' },
  rh_colaboradores: { title: 'Colaboradores & NRs', subtitle: 'Ficha cadastral, salários, documentos e NRs pré-definidas' },
  rh_folha: { title: 'Vales & Folha de Pagamento', subtitle: 'Adiantamentos, comissões e fechamento mensal' },
  rh_comportamento: { title: 'Comportamento & Produtividade', subtitle: 'Relatórios disciplinares e desempenho da equipe' },
  certificados: { title: 'Gerador de Certificados', subtitle: 'Emissão oficial de certificados de NRs e treinamentos' },
  admin_acessos: { title: 'Acessos & Configurações (ADM)', subtitle: 'Hierarquia de usuários, saldo inicial e categorias' }
};

function formatBRL(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(val || 0));
}

function formatDateBR(dateStr) {
  if (!dateStr) return '-';
  const clean = String(dateStr).slice(0, 10);
  const parts = clean.split('-');
  if (parts.length !== 3) return clean;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function userHasPerm(permList) {
  if (!STATE.user) return false;
  if (STATE.user.perfil === 'admin' || STATE.user.permissoes?.admin) return true;
  if (!permList) return true;
  const required = permList.split(',').map(p => p.trim());
  return required.some(p => Boolean(STATE.user.permissoes?.[p]));
}

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (STATE.token) {
    headers['Authorization'] = `Bearer ${STATE.token}`;
  }
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Erro na comunicação com o servidor.');
  }
  return data;
}

function fecharModal(id) {
  document.getElementById(id).classList.add('hidden');
}

/* ================= LOGIN & SESSÃO ================= */
function showLogin() {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('app-view').classList.add('hidden');
}

function showApp(user) {
  STATE.user = user;
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');

  document.getElementById('topbar-user-name').textContent = user.nome;
  document.getElementById('topbar-user-role').textContent =
    user.perfil === 'admin' ? 'ADM' : (user.setor || 'Equipe');

  document.querySelectorAll('[data-perm]').forEach(el => {
    if (userHasPerm(el.dataset.perm)) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  switchModule('dashboard');
}

async function checkSession() {
  if (!STATE.token) return showLogin();
  try {
    const data = await apiFetch('/api/auth');
    showApp(data.user);
  } catch {
    localStorage.removeItem('fg_token');
    STATE.token = null;
    showLogin();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const senha = document.getElementById('login-senha').value;
  const errorBox = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');

  errorBox.classList.add('hidden');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Entrando...';

  try {
    const data = await apiFetch('/api/auth', {
      method: 'POST',
      body: JSON.stringify({ email, senha })
    });
    STATE.token = data.token;
    localStorage.setItem('fg_token', data.token);
    showApp(data.user);
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Entrar no Sistema';
  }
}

function handleLogout() {
  localStorage.removeItem('fg_token');
  STATE.token = null;
  STATE.user = null;
  showLogin();
}

function switchModule(moduleKey) {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.module === moduleKey);
  });

  const info = MODULE_INFO[moduleKey] || MODULE_INFO.dashboard;
  document.getElementById('page-title').textContent = info.title;
  document.getElementById('page-subtitle').textContent = info.subtitle;

  document.querySelectorAll('main > section').forEach(sec => sec.classList.add('hidden'));
  const target = document.getElementById(`section-${moduleKey}`);
  if (target) target.classList.remove('hidden');

  if (moduleKey === 'dashboard') loadDashboard();
  if (moduleKey === 'fluxo' || moduleKey === 'receber' || moduleKey === 'pagar') loadFinanceiro();
  if (moduleKey.startsWith('rh_') || moduleKey === 'certificados') loadRH();
  if (moduleKey === 'admin_acessos') loadAdmin();
}

/* ================= DASHBOARD ================= */
async function loadDashboard() {
  try {
    const [dash, rhAlertas] = await Promise.all([
      apiFetch('/api/dashboard'),
      apiFetch('/api/rh?resumo_alertas=1').catch(() => ({ nrs_alerta: [] }))
    ]);

    const { kpis, alertas, fluxo_mensal, maiores_categorias, atividades_recentes } = dash;

    document.getElementById('kpi-saldo-atual').textContent = formatBRL(kpis.saldo_atual);
    document.getElementById('kpi-saldo-inicial').textContent = `Saldo inicial: ${formatBRL(kpis.saldo_inicial)}`;

    const projEl = document.getElementById('kpi-projecao');
    projEl.textContent = formatBRL(kpis.projecao_30_dias);
    projEl.className = `kpi-value ${kpis.projecao_30_dias >= 0 ? 'text-success' : 'text-danger'}`;

    document.getElementById('kpi-receber').textContent = formatBRL(kpis.total_a_receber);
    document.getElementById('kpi-nf-pendente').textContent = `${kpis.nf_pendente_qtd} parcela(s) aguardando NF`;
    document.getElementById('kpi-pagar').textContent = formatBRL(kpis.total_a_pagar);

    const alertContainer = document.getElementById('dashboard-alerts');
    alertContainer.innerHTML = '';

    if (alertas.projecao_negativa) {
      alertContainer.innerHTML += `<div class="alert-banner alert-danger"><span><strong>Atenção no Caixa:</strong> A projeção para os próximos 30 dias está negativa.</span></div>`;
    }
    if (alertas.contas_proximas_qtd > 0) {
      alertContainer.innerHTML += `<div class="alert-banner alert-warning"><span><strong>Contas a Pagar Vencendo:</strong> ${alertas.contas_proximas_qtd} conta(s) somando ${formatBRL(alertas.contas_proximas_valor)}.</span></div>`;
    }
    if (alertas.nf_pendente_qtd > 0) {
      alertContainer.innerHTML += `<div class="alert-banner alert-info"><span><strong>Faturamento Pendente:</strong> ${alertas.nf_pendente_qtd} parcela(s) aguardando emissão de NF (${formatBRL(alertas.nf_pendente_valor)}).</span></div>`;
    }
    if (rhAlertas.nrs_alerta && rhAlertas.nrs_alerta.length > 0) {
      const lista = rhAlertas.nrs_alerta
        .slice(0, 3)
        .map(n => `${n.colaborador_nome} (${n.codigo_nr || n.titulo} · ${formatDateBR(n.data_validade)})`)
        .join(', ');
      alertContainer.innerHTML += `<div class="alert-banner alert-warning"><span><strong>Alerta de NRs / Documentos RH:</strong> ${rhAlertas.nrs_alerta.length} vencido(s) ou vencendo em 30 dias: ${lista}.</span></div>`;
    }

    renderDashboardCharts(fluxo_mensal, maiores_categorias);

    const tbody = document.getElementById('recent-activities-body');
    if (!atividades_recentes || atividades_recentes.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:20px;">Nenhuma movimentação registrada ainda.</td></tr>`;
    } else {
      tbody.innerHTML = atividades_recentes.map(item => {
        const isServ = item.origem === 'servico';
        return `
          <tr>
            <td><span class="status-pill ${isServ ? 'pill-blue' : 'pill-amber'}">${isServ ? 'Serviço' : 'Despesa'}</span></td>
            <td><strong>${item.titulo}</strong></td>
            <td class="${isServ ? 'text-success' : 'text-danger'}" style="font-weight:600;">${isServ ? '+' : '-'} ${formatBRL(item.valor)}</td>
            <td><span class="status-pill ${item.status === 'pago' ? 'pill-green' : 'pill-amber'}">${item.status}</span></td>
          </tr>`;
      }).join('');
    }
  } catch (err) {
    console.error(err);
  }
}

function renderDashboardCharts(fluxoMensal, maioresCategorias) {
  const ctxFluxo = document.getElementById('chart-fluxo').getContext('2d');
  if (STATE.charts.fluxo) STATE.charts.fluxo.destroy();
  STATE.charts.fluxo = new Chart(ctxFluxo, {
    type: 'bar',
    data: {
      labels: fluxoMensal.map(i => i.label),
      datasets: [
        { label: 'Entradas', data: fluxoMensal.map(i => i.entradas), backgroundColor: '#10B981', borderRadius: 6 },
        { label: 'Saídas', data: fluxoMensal.map(i => i.saidas), backgroundColor: '#EF4444', borderRadius: 6 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
  });

  const ctxCat = document.getElementById('chart-categorias').getContext('2d');
  if (STATE.charts.categorias) STATE.charts.categorias.destroy();
  const hasCat = maioresCategorias.length > 0;
  STATE.charts.categorias = new Chart(ctxCat, {
    type: 'doughnut',
    data: {
      labels: hasCat ? maioresCategorias.map(c => c.nome) : ['Sem despesas no mês'],
      datasets: [{
        data: hasCat ? maioresCategorias.map(c => c.total) : [1],
        backgroundColor: hasCat ? maioresCategorias.map(c => c.cor) : ['#E2E8F0'],
        borderWidth: 0
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'bottom' } } }
  });
}

/* ================= FINANCEIRO (FLUXO, A RECEBER, A PAGAR) ================= */
async function loadFinanceiro() {
  try {
    const data = await apiFetch('/api/financeiro');
    STATE.financeiro = data;

    const catSelect = document.getElementById('pagar-categoria');
    catSelect.innerHTML = data.categorias
      .filter(c => c.tipo === 'despesa')
      .map(c => `<option value="${c.id}">${c.nome}</option>`)
      .join('');

    const vendSelect = document.getElementById('serv-vendedor');
    vendSelect.innerHTML = `<option value="">Sem vendedor vinculado</option>` +
      data.vendedores.map(v => `<option value="${v.id}">${v.nome}</option>`).join('');

    const extratoBody = document.getElementById('fluxo-extrato-body');
    extratoBody.innerHTML = data.extrato.length === 0
      ? `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhuma movimentação encontrada.</td></tr>`
      : data.extrato.map(item => `
        <tr>
          <td>${formatDateBR(item.data)}</td>
          <td><span class="status-pill ${item.tipo === 'entrada' ? 'pill-green' : 'pill-red'}">${item.tipo === 'entrada' ? 'Entrada' : 'Saída'}</span></td>
          <td><strong>${item.descricao}</strong></td>
          <td>${item.categoria}</td>
          <td class="${item.tipo === 'entrada' ? 'text-success' : 'text-danger'}" style="font-weight:700;">
            ${item.tipo === 'entrada' ? '+' : '-'} ${formatBRL(item.valor)}
          </td>
          <td><span class="status-pill ${item.status === 'pago' ? 'pill-green' : 'pill-amber'}">${item.status}</span></td>
          <td>${item.comprovante_url ? `<a href="${item.comprovante_url}" target="_blank" class="btn-pill btn-outline btn-sm">Ver</a>` : '-'}</td>
        </tr>`).join('');

    const recBody = document.getElementById('receber-table-body');
    recBody.innerHTML = data.parcelas.length === 0
      ? `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhuma parcela cadastrada.</td></tr>`
      : data.parcelas.map(p => `
        <tr>
          <td>${formatDateBR(p.data_vencimento)}</td>
          <td><strong>${p.cliente_nome}</strong><br><small style="color:var(--text-muted);">${p.servico_descricao}</small></td>
          <td>Parc. ${p.numero_parcela}</td>
          <td>${p.tipo_cobranca === 'mediante_nf' ? `<span class="status-pill pill-blue">Mediante NF ${p.numero_nf || '(Pendente)'}</span>` : 'Direta'}</td>
          <td class="text-success" style="font-weight:700;">${formatBRL(p.valor)}</td>
          <td><span class="status-pill ${p.status === 'pago' ? 'pill-green' : 'pill-amber'}">${p.status}</span></td>
          <td>
            ${p.status === 'pendente'
              ? `<button class="btn-pill btn-primary btn-sm" onclick="baixarParcela('${p.id}')">Dar Baixa</button>`
              : `<small style="color:var(--text-muted);">Pago em ${formatDateBR(p.data_pagamento)}</small>`}
          </td>
        </tr>`).join('');

    const pagBody = document.getElementById('pagar-table-body');
    pagBody.innerHTML = data.contas_pagar.length === 0
      ? `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhuma conta a pagar lançada.</td></tr>`
      : data.contas_pagar.map(cp => {
        const rateioTxt = cp.rateios && cp.rateios.length > 0
          ? cp.rateios.map(r => `${r.centro_custo} (${r.percentual}%)`).join(', ')
          : '';
        return `
          <tr>
            <td>${formatDateBR(cp.data_vencimento)}</td>
            <td><strong>${cp.fornecedor || 'Fornecedor'}</strong> · ${cp.descricao} ${cp.numero_nf ? `<span class="status-pill pill-teal">NF ${cp.numero_nf}</span>` : ''}</td>
            <td>${cp.categoria_nome}${rateioTxt ? `<br><small style="color:var(--text-muted);">${rateioTxt}</small>` : ''}</td>
            <td class="text-danger" style="font-weight:700;">${formatBRL(cp.valor)}</td>
            <td><span class="status-pill ${cp.status === 'pago' ? 'pill-green' : 'pill-amber'}">${cp.status}</span></td>
            <td>${cp.comprovante_url ? `<a href="${cp.comprovante_url}" target="_blank" class="btn-pill btn-outline btn-sm">Anexo</a>` : '-'}</td>
            <td>
              ${cp.status === 'pendente'
                ? `<button class="btn-pill btn-primary btn-sm" onclick="baixarContaPagar('${cp.id}')">Pagar</button>`
                : `<small style="color:var(--text-muted);">Pago ${formatDateBR(cp.data_pagamento)}</small>`}
            </td>
          </tr>`;
      }).join('');
  } catch (err) {
    alert(err.message);
  }
}

async function baixarParcela(id) {
  const nf = prompt('Número da Nota Fiscal (opcional, deixe em branco se não houver):') || '';
  try {
    await apiFetch('/api/financeiro', {
      method: 'POST',
      body: JSON.stringify({ action: 'baixar_parcela', id, numero_nf: nf.trim() || null })
    });
    loadFinanceiro();
  } catch (err) {
    alert(err.message);
  }
}

async function baixarContaPagar(id) {
  if (!confirm('Confirmar pagamento desta conta?')) return;
  try {
    await apiFetch('/api/financeiro', {
      method: 'POST',
      body: JSON.stringify({ action: 'baixar_conta_pagar', id })
    });
    loadFinanceiro();
  } catch (err) {
    alert(err.message);
  }
}

/* ================= RH 360º & GERADOR DE CERTIFICADOS ================= */
async function loadRH() {
  const mesInput = document.getElementById('rh-mes-filtro');
  if (!mesInput.value) mesInput.value = new Date().toISOString().slice(0, 7);
  const mes = mesInput.value;

  try {
    const data = await apiFetch(`/api/rh?mes=${mes}`);
    STATE.rh = data;

    const colabOptions = data.colaboradores
      .map(c => `<option value="${c.id}">${c.nome} (${c.cargo || 'Colaborador'})</option>`)
      .join('');

    ['doc-colaborador', 'vale-colaborador', 'ocorr-colaborador', 'prod-colaborador', 'cert-colaborador'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = colabOptions || '<option value="">Cadastre um colaborador primeiro</option>';
    });

    const filtroOcorr = document.getElementById('filtro-ocorr-colab');
    if (filtroOcorr) {
      filtroOcorr.innerHTML = `<option value="">Todos os Colaboradores</option>` + colabOptions;
    }

    const nrOptions = data.catalogo_nrs
      .map(n => `<option value="${n.id}">${n.codigo} - ${n.nome} (${n.validade_meses}m)</option>`)
      .join('');
    document.getElementById('doc-nr-select').innerHTML = `<option value="">Documento Geral (Sem NR)</option>` + nrOptions;
    document.getElementById('cert-nr-select').innerHTML = `<option value="">Treinamento Personalizado</option>` + nrOptions;

    document.getElementById('colab-table-body').innerHTML = data.colaboradores.length === 0
      ? `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhum colaborador cadastrado.</td></tr>`
      : data.colaboradores.map(c => `
        <tr>
          <td><strong>${c.nome}</strong></td>
          <td>${c.cpf || '-'}</td>
          <td>${c.cargo || '-'} · <span class="status-pill pill-teal">${c.setor || 'geral'}</span></td>
          <td style="font-weight:600;">${formatBRL(c.salario_base)}</td>
          <td>${c.chave_pix || '-'}</td>
          <td><span class="status-pill ${c.status === 'ativo' ? 'pill-green' : 'pill-amber'}">${c.status}</span></td>
          <td><button class="btn-pill btn-outline btn-sm" onclick="editarColaborador('${c.id}')">Editar</button></td>
        </tr>`).join('');

    document.getElementById('docs-table-body').innerHTML = data.documentos.length === 0
      ? `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhum documento ou NR registrado.</td></tr>`
      : data.documentos.map(d => {
        const badgeClass = d.status_validade === 'vencido'
          ? 'pill-red'
          : d.status_validade === 'vencendo'
            ? 'pill-amber'
            : 'pill-green';
        return `
          <tr>
            <td><strong>${d.colaborador_nome}</strong></td>
            <td>${d.codigo_nr ? `<span class="status-pill pill-teal">${d.codigo_nr}</span> ` : ''}${d.titulo}</td>
            <td>${formatDateBR(d.data_emissao)}</td>
            <td>${formatDateBR(d.data_validade)}</td>
            <td><span class="status-pill ${badgeClass}">${d.status_validade}</span></td>
            <td>${d.arquivo_url ? `<a href="${d.arquivo_url}" target="_blank" class="btn-pill btn-outline btn-sm">Abrir</a>` : '-'}</td>
          </tr>`;
      }).join('');

    document.getElementById('folha-table-body').innerHTML = data.folha.length === 0
      ? `<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhum colaborador ativo para fechamento.</td></tr>`
      : data.folha.map(f => `
        <tr>
          <td><strong>${f.nome}</strong><br><small style="color:var(--text-muted);">${f.cargo || ''} ${f.chave_pix ? '· PIX: ' + f.chave_pix : ''}</small></td>
          <td>${formatBRL(f.salario_base)}</td>
          <td class="text-success">+ ${formatBRL(f.total_comissoes)}</td>
          <td class="text-success">+ ${formatBRL(f.total_bonus)}</td>
          <td class="text-danger">- ${formatBRL(f.total_vales_descontos)}</td>
          <td style="font-weight:700; color:var(--primary);">${formatBRL(f.valor_liquido)}</td>
          <td><span class="status-pill ${f.status === 'pago' ? 'pill-green' : 'pill-amber'}">${f.status}</span></td>
          <td>
            ${f.status === 'aberto'
              ? `<button class="btn-pill btn-primary btn-sm" onclick="fecharFolhaColab('${f.colaborador_id}')">Pagar Folha</button>`
              : `<small style="color:var(--text-muted);">Pago ${formatDateBR(f.data_pagamento)}</small>`}
          </td>
        </tr>`).join('');

    document.getElementById('vales-table-body').innerHTML = data.vales.length === 0
      ? `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhum vale ou bônus neste mês.</td></tr>`
      : data.vales.map(v => `
        <tr>
          <td>${formatDateBR(v.data_lancamento)}</td>
          <td><strong>${v.colaborador_nome}</strong></td>
          <td><span class="status-pill ${v.tipo === 'bonus' ? 'pill-green' : 'pill-amber'}">${v.tipo}</span></td>
          <td>${v.descricao}</td>
          <td style="font-weight:600;">${formatBRL(v.valor)}</td>
          <td>${v.descontado ? 'Processado na folha' : 'Em aberto'}</td>
        </tr>`).join('');

    renderOcorrenciasTable(data.ocorrencias);

    document.getElementById('prod-ranking-body').innerHTML = data.ranking_produtividade.length === 0
      ? `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">Sem apontamentos no mês.</td></tr>`
      : data.ranking_produtividade.map(r => `
        <tr>
          <td><strong>${r.nome}</strong></td>
          <td><span class="status-pill pill-teal">${r.setor || 'geral'}</span></td>
          <td style="font-weight:700; color:var(--primary);">${r.total_m2.toFixed(2)} m²</td>
          <td>${r.total_pecas} pçs</td>
          <td>${r.total_horas}h</td>
          <td class="${r.total_retrabalho > 0 ? 'text-danger' : ''}">${r.total_retrabalho} pçs</td>
          <td><span class="status-pill pill-green">${r.media_qualidade} / 5</span></td>
        </tr>`).join('');

    document.getElementById('cert-table-body').innerHTML = data.certificados.length === 0
      ? `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhum certificado emitido ainda.</td></tr>`
      : data.certificados.map(cert => `
        <tr>
          <td><span class="status-pill pill-teal">${cert.codigo_validacao}</span></td>
          <td><strong>${cert.colaborador_nome}</strong></td>
          <td>${cert.titulo_curso} (${cert.carga_horaria}h)</td>
          <td>${formatDateBR(cert.data_conclusao)}</td>
          <td>${formatDateBR(cert.data_validade)}</td>
          <td><button class="btn-pill btn-gold btn-sm" onclick="abrirCertificado('${cert.id}')">Visualizar / PDF</button></td>
        </tr>`).join('');
  } catch (err) {
    alert(err.message);
  }
}

function renderOcorrenciasTable(lista) {
  const filtroId = document.getElementById('filtro-ocorr-colab')?.value || '';
  const filtrada = filtroId ? lista.filter(o => o.colaborador_id === filtroId) : lista;

  document.getElementById('ocorr-table-body').innerHTML = filtrada.length === 0
    ? `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhuma ocorrência registrada para este filtro.</td></tr>`
    : filtrada.map(o => {
      const cls = o.classificacao === 'positiva' ? 'pill-green' : o.classificacao === 'negativa' ? 'pill-red' : 'pill-blue';
      return `
        <tr>
          <td>${formatDateBR(o.data_ocorrencia)}</td>
          <td><strong>${o.colaborador_nome}</strong></td>
          <td>${o.tipo.replace('_', ' ')}</td>
          <td><span class="status-pill ${cls}">${o.classificacao}</span></td>
          <td>${o.descricao}</td>
          <td>${o.registrado_por || '-'}</td>
        </tr>`;
    }).join('');
}

function imprimirRelatorioComportamento() {
  const area = document.getElementById('relatorio-comportamental-card');
  area.id = 'printable-area';
  window.print();
  area.id = 'relatorio-comportamental-card';
}

function editarColaborador(id) {
  const c = STATE.rh?.colaboradores.find(x => x.id === id);
  if (!c) return;
  document.getElementById('colab-id').value = c.id;
  document.getElementById('colab-nome').value = c.nome || '';
  document.getElementById('colab-cpf').value = c.cpf || '';
  document.getElementById('colab-rg').value = c.rg || '';
  document.getElementById('colab-telefone').value = c.telefone || '';
  document.getElementById('colab-cargo').value = c.cargo || '';
  document.getElementById('colab-setor').value = c.setor || 'producao';
  document.getElementById('colab-admissao').value = c.data_admissao ? String(c.data_admissao).slice(0, 10) : '';
  document.getElementById('colab-salario').value = c.salario_base || 0;
  document.getElementById('colab-pix').value = c.chave_pix || '';
  document.getElementById('colab-comissao1').value = c.comissao_faixa1_pct || 0;
  document.getElementById('colab-status').value = c.status || 'ativo';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetFormColaborador() {
  document.getElementById('form-colaborador').reset();
  document.getElementById('colab-id').value = '';
}

async function fecharFolhaColab(colabId) {
  const item = STATE.rh?.folha.find(f => f.colaborador_id === colabId);
  if (!item) return;
  const lancarCp = confirm(`Confirmar pagamento líquido de ${formatBRL(item.valor_liquido)} para ${item.nome}?\n\nClique em OK para fechar a folha e lançar automaticamente como despesa paga no Financeiro.`);
  if (!lancarCp) return;

  try {
    await apiFetch('/api/rh', {
      method: 'POST',
      body: JSON.stringify({
        action: 'fechar_folha',
        colaborador_id: colabId,
        mes_referencia: document.getElementById('rh-mes-filtro').value,
        salario_base: item.salario_base,
        total_comissoes: item.total_comissoes,
        total_bonus: item.total_bonus,
        total_vales_descontos: item.total_vales_descontos,
        valor_liquido: item.valor_liquido,
        lancar_contas_pagar: true
      })
    });
    loadRH();
  } catch (err) {
    alert(err.message);
  }
}

function abrirCertificado(certId) {
  const cert = STATE.rh?.certificados.find(c => c.id === certId);
  if (!cert) return;
  preencherModalCertificado(cert);
  document.getElementById('modal-certificado').classList.remove('hidden');
}

function preencherModalCertificado(cert) {
  document.getElementById('cert-view-nome').textContent = cert.colaborador_nome;
  document.getElementById('cert-view-doc').textContent =
    `${cert.colaborador_cpf ? 'CPF: ' + cert.colaborador_cpf + ' · ' : ''}${cert.colaborador_cargo || ''}`;
  document.getElementById('cert-view-curso').textContent = cert.titulo_curso;
  document.getElementById('cert-view-data').textContent = formatDateBR(cert.data_conclusao);
  document.getElementById('cert-view-carga').textContent = `${cert.carga_horaria} horas`;
  document.getElementById('cert-view-validade').textContent = cert.data_validade
    ? `Validade regulamentar até ${formatDateBR(cert.data_validade)}`
    : '';
  document.getElementById('cert-view-programa').textContent =
    cert.conteudo_programatico || 'Capacitação teórica e prática conforme normas técnicas vigentes.';
  document.getElementById('cert-view-instrutor').textContent = cert.instrutor_nome;
  document.getElementById('cert-view-registro').textContent = cert.instrutor_registro || 'Instrutor Credenciado';
  document.getElementById('cert-view-codigo').textContent = cert.codigo_validacao;
}

/* ================= ADMINISTRAÇÃO (ADM) ================= */
async function loadAdmin() {
  try {
    const data = await apiFetch('/api/admin');
    STATE.admin = data;

    document.getElementById('cfg-saldo-inicial').value = data.saldo_inicial;

    document.getElementById('adm-usuarios-body').innerHTML = data.usuarios.map(u => {
      const p = u.permissoes || {};
      const badges = [];
      if (u.perfil === 'admin' || p.admin) badges.push('<span class="status-pill pill-teal">ADM Total</span>');
      if (p.financeiro) badges.push('<span class="status-pill pill-green">Financeiro</span>');
      if (p.administrativo) badges.push('<span class="status-pill pill-blue">Administrativo</span>');
      if (p.rh) badges.push('<span class="status-pill pill-blue">RH</span>');
      if (p.vendas) badges.push('<span class="status-pill pill-amber">Vendas</span>');
      if (p.producao) badges.push('<span class="status-pill pill-amber">Produção</span>');

      return `
        <tr>
          <td><strong>${u.nome}</strong></td>
          <td>${u.email}</td>
          <td>${u.setor || '-'}</td>
          <td>${badges.join(' ') || 'Acesso Básico'}</td>
          <td><button class="btn-pill btn-outline btn-sm" onclick="editarUsuarioAdm('${u.id}')">Editar Acessos</button></td>
        </tr>`;
    }).join('');
  } catch (err) {
    alert(err.message);
  }
}

function editarUsuarioAdm(id) {
  const u = STATE.admin?.usuarios.find(x => x.id === id);
  if (!u) return;
  const p = u.permissoes || {};
  document.getElementById('adm-user-id').value = u.id;
  document.getElementById('adm-user-nome').value = u.nome;
  document.getElementById('adm-user-login').value = u.email;
  document.getElementById('adm-user-senha').value = '';
  document.getElementById('adm-user-setor').value = u.setor || 'geral';
  document.getElementById('perm-financeiro').checked = Boolean(p.financeiro);
  document.getElementById('perm-administrativo').checked = Boolean(p.administrativo);
  document.getElementById('perm-rh').checked = Boolean(p.rh);
  document.getElementById('perm-vendas').checked = Boolean(p.vendas);
  document.getElementById('perm-producao').checked = Boolean(p.producao);
  document.getElementById('perm-admin').checked = Boolean(u.perfil === 'admin' || p.admin);
}

function resetFormUsuarioAdm() {
  document.getElementById('form-usuario-adm').reset();
  document.getElementById('adm-user-id').value = '';
}

/* ================= TRANSCRIÇÃO DE FOTO DE NF / DOCUMENTOS + UPLOAD R2 ================= */
async function uploadArquivoR2(file, pasta) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('pasta', pasta);
  const res = await apiFetch('/api/upload', { method: 'POST', body: formData });
  return res.url;
}

function prepararImagemParaOcr(file) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = img.width < 1600 ? Math.min(2.2, 1800 / img.width) : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.filter = 'grayscale(100%) contrast(145%) brightness(105%)';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => resolve(blob || file), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

async function extrairTextoArquivo(file, onProgress) {
  const name = file.name.toLowerCase();

  // 1. Se for XML NF-e
  if (name.endsWith('.xml')) {
    const xmlText = await file.text();
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    const getTag = tag => doc.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
    const emitNome = doc.getElementsByTagName('emit')[0]?.getElementsByTagName('xNome')[0]?.textContent?.trim() || '';
    const emitCnpj = doc.getElementsByTagName('emit')[0]?.getElementsByTagName('CNPJ')[0]?.textContent?.trim() || '';
    const nNF = getTag('nNF');
    const vNF = getTag('vNF');
    const dVenc = getTag('dVenc') || getTag('dhEmi').slice(0, 10);
    return {
      nome: emitNome,
      doc: emitCnpj,
      nf: nNF,
      valor: vNF,
      data: dVenc,
      texto: `NF-e Nº ${nNF} | Emitente: ${emitNome} | CNPJ: ${emitCnpj} | Valor: R$ ${vNF} | Data: ${dVenc}`
    };
  }

  // 2. Se for PDF
  let rawText = '';
  if (name.endsWith('.pdf') && window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      if (onProgress) onProgress(`Lendo página ${i} do PDF...`);
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      rawText += content.items.map(item => item.str).join(' ') + '\n';
    }
  } else if (file.type.startsWith('image/') && window.Tesseract) {
    // 3. Foto / Print de NF com pré-processamento de nitidez
    if (onProgress) onProgress('Melhorando nitidez da imagem...');
    const imagemNitida = await prepararImagemParaOcr(file);
    const result = await Tesseract.recognize(imagemNitida, 'por', {
      logger: m => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(`Transcrevendo imagem da NF... ${Math.round((m.progress || 0) * 100)}%`);
        }
      }
    });
    rawText = result.data.text || '';
  } else {
    rawText = await file.text().catch(() => '');
  }

  return parseTextoNotaFiscal(rawText);
}

function parseTextoNotaFiscal(text) {
  const cleanText = text.replace(/\r/g, '');

  // Chave de acesso de 44 dígitos (extrai também o nº da NF posições 25..34)
  const chaveMatch = cleanText.replace(/\s+/g, '').match(/\d{44}/);
  let nfFromChave = '';
  if (chaveMatch) {
    nfFromChave = String(parseInt(chaveMatch[0].slice(25, 34), 10) || '');
  }

  const cnpjMatch = cleanText.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
  const cpfMatch = cleanText.match(/\d{3}\.\d{3}\.\d{3}-\d{2}/);

  const nfMatch = cleanText.match(/(?:NF-e|NFE|NOTA FISCAL|N[º°o]\.?)\s*[:\-]?\s*0*(\d{1,9})/i);
  const numeroNf = (nfMatch && nfMatch[1]) ? nfMatch[1] : nfFromChave;

  // Busca valor próximo a TOTAL ou pega o maior valor em R$ da nota
  const totalEspecifico = cleanText.match(/(?:VALOR\s+TOTAL\s+DA\s+NOTA|VALOR\s+TOTAL|TOTAL\s+GERAL|VALOR\s+L[ÍI]QUIDO|TOTAL\s+R\$)\s*[:\-]?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  let valorNum = '';
  if (totalEspecifico) {
    valorNum = totalEspecifico[1].replace(/\./g, '').replace(',', '.');
  } else {
    const todosValores = [...cleanText.matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2})/g)]
      .map(m => parseFloat(m[1].replace(/\./g, '').replace(',', '.')))
      .filter(n => !isNaN(n) && n > 0 && n < 10000000);
    if (todosValores.length > 0) {
      valorNum = Math.max(...todosValores).toFixed(2);
    }
  }

  // Busca data de vencimento ou emissão
  const vencMatch = cleanText.match(/(?:VENCIMENTO|VENC\.?)\s*[:\-]?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const anyDateMatch = cleanText.match(/(\d{2})\/(\d{2})\/(20\d{2})/);
  let dataIso = '';
  if (vencMatch) {
    dataIso = `${vencMatch[3]}-${vencMatch[2]}-${vencMatch[1]}`;
  } else if (anyDateMatch) {
    dataIso = `${anyDateMatch[3]}-${anyDateMatch[2]}-${anyDateMatch[1]}`;
  }

  // Busca razão social ignorando cabeçalhos padrão de DANFE
  const lines = cleanText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 4 && !/^(DANFE|DOCUMENTO AUXILIAR|CHAVE DE ACESSO|CONSULTA DE AUTENTICIDADE|RECEBEMOS DE)/i.test(l));

  const empresaLine = lines.find(l => /(LTDA|S\/A|S\.A|EIRELI|ME\b|EPP\b|VIDROS|DISTRIBUIDORA|COMERCIO|INDUSTRIA)/i.test(l));

  return {
    nome: (empresaLine || lines[0] || '').slice(0, 90),
    doc: cnpjMatch ? cnpjMatch[0] : (cpfMatch ? cpfMatch[0] : ''),
    nf: numeroNf,
    valor: valorNum,
    data: dataIso,
    texto: cleanText.trim()
  };
}

function aplicarOcrEmContasPagar() {
  document.getElementById('pagar-fornecedor').value = document.getElementById('ocr-res-nome').value;
  document.getElementById('pagar-cnpj').value = document.getElementById('ocr-res-doc').value;
  const nf = document.getElementById('ocr-res-nf').value;
  document.getElementById('pagar-nf').value = nf;
  if (nf && !document.getElementById('pagar-descricao').value) {
    document.getElementById('pagar-descricao').value = `Nota Fiscal Nº ${nf}`;
  }
  document.getElementById('pagar-valor').value = document.getElementById('ocr-res-valor').value;
  document.getElementById('pagar-vencimento').value = document.getElementById('ocr-res-data').value;
  if (STATE.ocrLastUploadUrl) {
    document.getElementById('pagar-comprovante-url').value = STATE.ocrLastUploadUrl;
  }
  fecharModal('modal-ocr-global');
  switchModule('pagar');
}

function aplicarOcrEmContasReceber() {
  document.getElementById('serv-cliente').value = document.getElementById('ocr-res-nome').value;
  const nf = document.getElementById('ocr-res-nf').value;
  document.getElementById('serv-nf').value = nf;
  if (nf) {
    document.getElementById('serv-tipo-cobranca').value = 'mediante_nf';
    if (!document.getElementById('serv-descricao').value) {
      document.getElementById('serv-descricao').value = `Serviço ref. NF Nº ${nf}`;
    }
  }
  document.getElementById('serv-valor').value = document.getElementById('ocr-res-valor').value;
  document.getElementById('serv-primeiro-venc').value = document.getElementById('ocr-res-data').value;
  fecharModal('modal-ocr-global');
  switchModule('receber');
}

function aplicarOcrEmColaborador() {
  document.getElementById('colab-nome').value = document.getElementById('ocr-res-nome').value;
  document.getElementById('colab-cpf').value = document.getElementById('ocr-res-doc').value;
  fecharModal('modal-ocr-global');
  switchModule('rh_colaboradores');
}

/* ================= EVENT LISTENERS ================= */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('btn-logout').addEventListener('click', handleLogout);
  document.getElementById('btn-refresh-dashboard').addEventListener('click', loadDashboard);

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchModule(btn.dataset.module));
  });

  document.querySelectorAll('[data-rhtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-rhtab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.rhtab;
      document.getElementById('subtab-comportamento').classList.toggle('hidden', tab !== 'comportamento');
      document.getElementById('subtab-produtividade').classList.toggle('hidden', tab !== 'produtividade');
    });
  });

  document.getElementById('doc-nr-select').addEventListener('change', e => {
    const nr = STATE.rh?.catalogo_nrs.find(n => n.id === e.target.value);
    if (!nr) return;
    document.getElementById('doc-titulo').value = `${nr.codigo} - ${nr.nome}`;
    const dt = new Date();
    document.getElementById('doc-emissao').value = dt.toISOString().slice(0, 10);
    dt.setMonth(dt.getMonth() + Number(nr.validade_meses || 12));
    document.getElementById('doc-validade').value = dt.toISOString().slice(0, 10);
  });

  document.getElementById('cert-nr-select').addEventListener('change', e => {
    const nr = STATE.rh?.catalogo_nrs.find(n => n.id === e.target.value);
    if (!nr) return;
    document.getElementById('cert-titulo').value = `${nr.codigo} - ${nr.nome}`;
    document.getElementById('cert-carga').value = nr.carga_horaria_padrao || 8;
    document.getElementById('cert-validade-meses').value = nr.validade_meses || 12;
    document.getElementById('cert-conteudo').value = nr.conteudo_programatico || '';
  });

  document.getElementById('filtro-ocorr-colab').addEventListener('change', () => {
    if (STATE.rh) renderOcorrenciasTable(STATE.rh.ocorrencias);
  });

  document.getElementById('rh-mes-filtro').addEventListener('change', loadRH);

  // Leitor por Foto de NF direto em Contas a Pagar
  document.getElementById('pagar-file-ocr').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('pagar-ocr-status');
    const previewEl = document.getElementById('pagar-ocr-preview');

    if (file.type.startsWith('image/')) {
      previewEl.src = URL.createObjectURL(file);
      previewEl.classList.remove('hidden');
    } else {
      previewEl.classList.add('hidden');
    }

    statusEl.textContent = 'Iniciando leitura da imagem da NF...';

    try {
      const [parsed, uploadedUrl] = await Promise.all([
        extrairTextoArquivo(file, msg => { statusEl.textContent = msg; }),
        uploadArquivoR2(file, 'contas-pagar').catch(() => null)
      ]);

      if (parsed.nome) document.getElementById('pagar-fornecedor').value = parsed.nome;
      if (parsed.doc) document.getElementById('pagar-cnpj').value = parsed.doc;
      if (parsed.nf) {
        document.getElementById('pagar-nf').value = parsed.nf;
        if (!document.getElementById('pagar-descricao').value) {
          document.getElementById('pagar-descricao').value = `Nota Fiscal Nº ${parsed.nf}`;
        }
      }
      if (parsed.valor) document.getElementById('pagar-valor').value = parsed.valor;
      if (parsed.data) document.getElementById('pagar-vencimento').value = parsed.data;
      if (uploadedUrl) document.getElementById('pagar-comprovante-url').value = uploadedUrl;

      statusEl.textContent = 'NF transcrita e imagem anexada com sucesso!';
    } catch (err) {
      statusEl.textContent = 'Erro na leitura: ' + err.message;
    }
  });

  // Modal Global de Transcrição por Foto
  document.getElementById('btn-open-ocr-global').addEventListener('click', () => {
    document.getElementById('modal-ocr-global').classList.remove('hidden');
  });

  document.getElementById('global-ocr-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const status = document.getElementById('global-ocr-status');
    const preview = document.getElementById('global-ocr-preview');

    if (file.type.startsWith('image/')) {
      preview.src = URL.createObjectURL(file);
      preview.classList.remove('hidden');
    } else {
      preview.classList.add('hidden');
    }

    status.textContent = 'Iniciando transcrição da imagem...';
    try {
      const [parsed, url] = await Promise.all([
        extrairTextoArquivo(file, msg => { status.textContent = msg; }),
        uploadArquivoR2(file, 'documentos-ocr').catch(() => null)
      ]);
      STATE.ocrLastUploadUrl = url;
      document.getElementById('ocr-res-nome').value = parsed.nome;
      document.getElementById('ocr-res-doc').value = parsed.doc;
      document.getElementById('ocr-res-nf').value = parsed.nf;
      document.getElementById('ocr-res-valor').value = parsed.valor;
      document.getElementById('ocr-res-data').value = parsed.data;
      document.getElementById('ocr-res-texto').value = parsed.texto;
      status.textContent = 'Transcrição concluída! Confira e clique no botão abaixo para preencher.';
    } catch (err) {
      status.textContent = 'Erro: ' + err.message;
    }
  });

  // Submits Financeiro
  document.getElementById('form-avulsa').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await apiFetch('/api/financeiro', {
        method: 'POST',
        body: JSON.stringify({
          action: 'criar_avulsa',
          tipo: document.getElementById('avulsa-tipo').value,
          descricao: document.getElementById('avulsa-descricao').value,
          valor: document.getElementById('avulsa-valor').value,
          data_movimentacao: document.getElementById('avulsa-data').value
        })
      });
      e.target.reset();
      loadFinanceiro();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('form-servico').addEventListener('submit', async e => {
    e.preventDefault();
    const total = Number(document.getElementById('serv-valor').value);
    const qtd = Number(document.getElementById('serv-qtd-parcelas').value || 1);
    const baseDate = new Date(document.getElementById('serv-primeiro-venc').value + 'T12:00:00');
    const tipoCob = document.getElementById('serv-tipo-cobranca').value;
    const nf = document.getElementById('serv-nf').value;

    const parcelas = [];
    const valorParc = Number((total / qtd).toFixed(2));
    for (let i = 0; i < qtd; i++) {
      const dt = new Date(baseDate);
      dt.setMonth(dt.getMonth() + i);
      parcelas.push({
        numero_parcela: i + 1,
        valor: i === qtd - 1 ? Number((total - valorParc * (qtd - 1)).toFixed(2)) : valorParc,
        data_vencimento: dt.toISOString().slice(0, 10),
        tipo_cobranca: tipoCob,
        numero_nf: nf || null
      });
    }

    try {
      await apiFetch('/api/financeiro', {
        method: 'POST',
        body: JSON.stringify({
          action: 'criar_servico',
          cliente_nome: document.getElementById('serv-cliente').value,
          descricao: document.getElementById('serv-descricao').value,
          valor_total: total,
          vendedor_id: document.getElementById('serv-vendedor').value || null,
          parcelas
        })
      });
      e.target.reset();
      loadFinanceiro();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('form-pagar').addEventListener('submit', async e => {
    e.preventDefault();
    const rateioSel = document.getElementById('pagar-rateio-cc').value;
    let rateios = [];
    if (rateioSel === 'Misto: 70% Fábrica / 30% Adm') {
      rateios = [
        { centro_custo: 'Produção / Fábrica', percentual: 70 },
        { centro_custo: 'Administrativo', percentual: 30 }
      ];
    } else if (rateioSel) {
      rateios = [{ centro_custo: rateioSel.replace(' (100%)', ''), percentual: 100 }];
    }

    try {
      await apiFetch('/api/financeiro', {
        method: 'POST',
        body: JSON.stringify({
          action: 'criar_conta_pagar',
          fornecedor: document.getElementById('pagar-fornecedor').value,
          cnpj_fornecedor: document.getElementById('pagar-cnpj').value,
          descricao: document.getElementById('pagar-descricao').value,
          numero_nf: document.getElementById('pagar-nf').value,
          categoria_id: document.getElementById('pagar-categoria').value || null,
          tipo_despesa: document.getElementById('pagar-tipo').value,
          valor: document.getElementById('pagar-valor').value,
          data_vencimento: document.getElementById('pagar-vencimento').value,
          status: document.getElementById('pagar-status').value,
          comprovante_url: document.getElementById('pagar-comprovante-url').value || null,
          rateios
        })
      });
      e.target.reset();
      document.getElementById('pagar-comprovante-url').value = '';
      document.getElementById('pagar-ocr-status').textContent = '';
      document.getElementById('pagar-ocr-preview').classList.add('hidden');
      loadFinanceiro();
    } catch (err) {
      alert(err.message);
    }
  });

  // Submits RH
  document.getElementById('form-colaborador').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await apiFetch('/api/rh', {
        method: 'POST',
        body: JSON.stringify({
          action: 'salvar_colaborador',
          id: document.getElementById('colab-id').value || null,
          nome: document.getElementById('colab-nome').value,
          cpf: document.getElementById('colab-cpf').value,
          rg: document.getElementById('colab-rg').value,
          telefone: document.getElementById('colab-telefone').value,
          cargo: document.getElementById('colab-cargo').value,
          setor: document.getElementById('colab-setor').value,
          data_admissao: document.getElementById('colab-admissao').value || null,
          salario_base: document.getElementById('colab-salario').value,
          chave_pix: document.getElementById('colab-pix').value,
          comissao_faixa1_pct: document.getElementById('colab-comissao1').value,
          status: document.getElementById('colab-status').value
        })
      });
      resetFormColaborador();
      loadRH();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('form-documento').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      let fileUrl = null;
      const fileInput = document.getElementById('doc-file');
      if (fileInput.files[0]) {
        fileUrl = await uploadArquivoR2(fileInput.files[0], 'rh-documentos');
      }
      await apiFetch('/api/rh', {
        method: 'POST',
        body: JSON.stringify({
          action: 'criar_documento',
          colaborador_id: document.getElementById('doc-colaborador').value,
          nr_id: document.getElementById('doc-nr-select').value || null,
          tipo_documento: document.getElementById('doc-nr-select').value ? 'nr' : 'documento',
          titulo: document.getElementById('doc-titulo').value,
          data_emissao: document.getElementById('doc-emissao').value || null,
          data_validade: document.getElementById('doc-validade').value || null,
          arquivo_url: fileUrl
        })
      });
      e.target.reset();
      loadRH();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('form-vale').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await apiFetch('/api/rh', {
        method: 'POST',
        body: JSON.stringify({
          action: 'criar_vale',
          colaborador_id: document.getElementById('vale-colaborador').value,
          tipo: document.getElementById('vale-tipo').value,
          descricao: document.getElementById('vale-descricao').value,
          valor: document.getElementById('vale-valor').value,
          mes_referencia: document.getElementById('rh-mes-filtro').value
        })
      });
      e.target.reset();
      loadRH();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('form-ocorrencia').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await apiFetch('/api/rh', {
        method: 'POST',
        body: JSON.stringify({
          action: 'criar_ocorrencia',
          colaborador_id: document.getElementById('ocorr-colaborador').value,
          tipo: document.getElementById('ocorr-tipo').value,
          classificacao: document.getElementById('ocorr-classificacao').value,
          data_ocorrencia: document.getElementById('ocorr-data').value,
          descricao: document.getElementById('ocorr-descricao').value
        })
      });
      e.target.reset();
      loadRH();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('form-produtividade').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await apiFetch('/api/rh', {
        method: 'POST',
        body: JSON.stringify({
          action: 'criar_produtividade',
          colaborador_id: document.getElementById('prod-colaborador').value,
          etapa_producao: document.getElementById('prod-etapa').value,
          quantidade_pecas: document.getElementById('prod-pecas').value,
          metragem_m2: document.getElementById('prod-m2').value,
          horas_trabalhadas: document.getElementById('prod-horas').value,
          retrabalho_qtd: document.getElementById('prod-retrabalho').value,
          nota_qualidade: document.getElementById('prod-nota').value
        })
      });
      e.target.reset();
      loadRH();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('form-certificado').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/rh', {
        method: 'POST',
        body: JSON.stringify({
          action: 'gerar_certificado',
          colaborador_id: document.getElementById('cert-colaborador').value,
          nr_id: document.getElementById('cert-nr-select').value || null,
          titulo_curso: document.getElementById('cert-titulo').value,
          carga_horaria: document.getElementById('cert-carga').value,
          data_conclusao: document.getElementById('cert-data').value,
          validade_meses: document.getElementById('cert-validade-meses').value,
          instrutor_nome: document.getElementById('cert-instrutor').value,
          instrutor_registro: document.getElementById('cert-registro').value,
          conteudo_programatico: document.getElementById('cert-conteudo').value
        })
      });
      e.target.reset();
      await loadRH();
      if (res.certificado) {
        preencherModalCertificado(res.certificado);
        document.getElementById('modal-certificado').classList.remove('hidden');
      }
    } catch (err) {
      alert(err.message);
    }
  });

  // Submits ADM
  document.getElementById('form-usuario-adm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin', {
        method: 'POST',
        body: JSON.stringify({
          action: 'salvar_usuario',
          id: document.getElementById('adm-user-id').value || null,
          nome: document.getElementById('adm-user-nome').value,
          email: document.getElementById('adm-user-login').value,
          senha: document.getElementById('adm-user-senha').value,
          setor: document.getElementById('adm-user-setor').value,
          permissoes: {
            financeiro: document.getElementById('perm-financeiro').checked,
            administrativo: document.getElementById('perm-administrativo').checked,
            rh: document.getElementById('perm-rh').checked,
            vendas: document.getElementById('perm-vendas').checked,
            producao: document.getElementById('perm-producao').checked,
            admin: document.getElementById('perm-admin').checked
          }
        })
      });
      resetFormUsuarioAdm();
      loadAdmin();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('form-saldo-inicial').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await apiFetch('/api/financeiro', {
        method: 'POST',
        body: JSON.stringify({
          action: 'salvar_saldo_inicial',
          saldo_inicial: document.getElementById('cfg-saldo-inicial').value
        })
      });
      alert('Saldo inicial atualizado com sucesso!');
      loadDashboard();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('form-categoria').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin', {
        method: 'POST',
        body: JSON.stringify({
          action: 'criar_categoria',
          nome: document.getElementById('cat-nome').value,
          cor_hex: document.getElementById('cat-cor').value
        })
      });
      e.target.reset();
      alert('Categoria criada!');
    } catch (err) {
      alert(err.message);
    }
  });

  checkSession();
});
