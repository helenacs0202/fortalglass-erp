const STATE = {
  token: localStorage.getItem('fg_token') || null,
  user: null,
  charts: { fluxo: null, categorias: null },
  financeiro: null,
  rh: null,
  admin: null,
  sst: null,
  sstPendenciasCache: [],
  ocrLastUploadUrl: null
};

const MODULE_INFO = {
  dashboard: { title: 'Visão Geral', subtitle: 'Indicadores financeiros, vencimentos, ASOs e alertas de NRs' },
  fluxo: { title: 'Fluxo de Caixa', subtitle: 'Extrato consolidado e lançamentos avulsos' },
  receber: { title: 'Contas a Receber', subtitle: 'Serviços comerciais, parcelas e controle de Nota Fiscal' },
  pagar: { title: 'Contas a Pagar', subtitle: 'Despesas, rateio, transcrição por foto de NF e comprovantes no R2' },
  rh_colaboradores: { title: 'Colaboradores & NRs', subtitle: 'Ficha cadastral, salários, documentos e NRs pré-definidas' },
  rh_folha: { title: 'Vales & Folha de Pagamento', subtitle: 'Adiantamentos, comissões e fechamento mensal' },
  rh_comportamento: { title: 'Comportamento & Produtividade', subtitle: 'Relatórios disciplinares e desempenho da equipe' },
  certificados: { title: 'Gerador de Certificados', subtitle: 'Emissão oficial de certificados de NRs e treinamentos' },
  sst: { title: 'SST: ASOs & Treinamentos', subtitle: 'Exames ocupacionais (PCMSO), matriz de NRs obrigatórias e prontuário digital' },
  acervo: { title: 'Acervo Digital (Papel)', subtitle: 'Digitalização em lote com leitura OCR automática e busca inteligente' },
  admin_acessos: { title: 'Acessos & Configurações (ADM)', subtitle: 'Hierarquia de usuários, normas, matriz SST, saldo inicial e categorias' }
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
  if (moduleKey === 'sst') loadSST();
  if (moduleKey === 'acervo') loadAcervo();
  if (moduleKey === 'admin_acessos') {
    loadAdmin();
    loadSST();
  }
}

/* ================= DASHBOARD ================= */
async function loadDashboard() {
  try {
    const [dash, rhAlertas, sstAlertas] = await Promise.all([
      apiFetch('/api/dashboard'),
      apiFetch('/api/rh?resumo_alertas=1').catch(() => ({ nrs_alerta: [] })),
      apiFetch('/api/sst?action=resumo_alertas').catch(() => ({ asos_pendentes: [] }))
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
    if (sstAlertas.asos_pendentes && sstAlertas.asos_pendentes.length > 0) {
      const listaAsos = sstAlertas.asos_pendentes
        .slice(0, 3)
        .map(a => `${a.colaborador_nome} (${a.motivo})`)
        .join('; ');
      alertContainer.innerHTML += `<div class="alert-banner alert-danger" style="cursor:pointer;" onclick="switchModule('sst')"><span><strong>Alerta SST (ASOs):</strong> ${sstAlertas.asos_pendentes.length} exame(s) a fazer ou vencido(s): ${listaAsos}.</span></div>`;
    }
    if (rhAlertas.nrs_alerta && rhAlertas.nrs_alerta.length > 0) {
      const lista = rhAlertas.nrs_alerta
        .slice(0, 3)
        .map(n => `${n.colaborador_nome} (${n.codigo_nr || n.titulo} · ${formatDateBR(n.data_validade)})`)
        .join(', ');
      alertContainer.innerHTML += `<div class="alert-banner alert-warning" style="cursor:pointer;" onclick="switchModule('sst')"><span><strong>Alerta de NRs / Treinamentos:</strong> ${rhAlertas.nrs_alerta.length} vencido(s) ou vencendo em 30 dias: ${lista}.</span></div>`;
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

    const nrOptionsTodos = data.catalogo_nrs
      .map(n => `<option value="${n.id}">${n.codigo} - ${n.nome} (${n.validade_meses}m)</option>`)
      .join('');
    const nrOptionsTreinamentos = data.catalogo_nrs
      .filter(n => n.codigo.toUpperCase() !== 'NR-07')
      .map(n => `<option value="${n.id}">${n.codigo} - ${n.nome} (${n.validade_meses}m)</option>`)
      .join('');

    document.getElementById('doc-nr-select').innerHTML = `<option value="">Documento Geral (Sem NR)</option>` + nrOptionsTodos;
    document.getElementById('cert-nr-select').innerHTML = `<option value="">Treinamento Personalizado</option>` + nrOptionsTreinamentos;

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

/* ================= SINCRONIZAÇÃO CRUZADA (SST <-> RH <-> CERTIFICADOS <-> ACERVO) ================= */
async function syncParaAcervoDigital({ titulo, categoria, dataDocumento, colaboradorId, nomeArquivo, arquivoUrl, textoOcr }) {
  if (!arquivoUrl) return;
  await apiFetch('/api/sst', {
    method: 'POST',
    body: JSON.stringify({
      action: 'salvar_acervo_item',
      titulo,
      categoria: categoria || 'RH / Colaboradores',
      pasta_fisica: 'Sincronizado via Sistema',
      data_documento: dataDocumento || new Date().toISOString().slice(0, 10),
      colaborador_id: colaboradorId || null,
      nome_arquivo: nomeArquivo || titulo,
      arquivo_url: arquivoUrl,
      texto_ocr: textoOcr || ''
    })
  }).catch(() => null);
}

async function syncParaDocumentosRH({ colaboradorId, nrId, tipoDocumento, titulo, dataEmissao, dataValidade, arquivoUrl }) {
  if (!colaboradorId || !titulo) return;
  await apiFetch('/api/rh', {
    method: 'POST',
    body: JSON.stringify({
      action: 'criar_documento',
      colaborador_id: colaboradorId,
      nr_id: nrId || null,
      tipo_documento: tipoDocumento || (nrId ? 'nr' : 'documento'),
      titulo,
      data_emissao: dataEmissao || new Date().toISOString().slice(0, 10),
      data_validade: dataValidade || null,
      arquivo_url: arquivoUrl || null
    })
  }).catch(() => null);
}

/* ================= SST: ASOs, MATRIZ DE TREINAMENTOS & PRONTUÁRIO DIGITAL ================= */
async function loadSST() {
  try {
    const mes = new Date().toISOString().slice(0, 7);
    const [sstData, rhData] = await Promise.all([
      apiFetch('/api/sst?action=overview'),
      apiFetch(`/api/rh?mes=${mes}`).catch(() => ({ documentos: [] }))
    ]);
    STATE.sst = sstData;
    const docsRh = rhData.documentos || [];

    const colabOpts = sstData.colaboradores
      .map(c => `<option value="${c.id}">${c.nome} (${c.setor || 'geral'})</option>`)
      .join('');
    const asoColabEl = document.getElementById('aso-colaborador');
    if (asoColabEl) asoColabEl.innerHTML = colabOpts || '<option value="">Cadastre um colaborador</option>';

    const nrOpts = sstData.catalogo_nrs
      .filter(n => n.codigo.toUpperCase() !== 'NR-07')
      .map(n => `<option value="${n.id}" data-val="${n.validade_meses || 12}">${n.codigo} - ${n.nome}</option>`)
      .join('');
    const turmaNrEl = document.getElementById('turma-nr-select');
    if (turmaNrEl) turmaNrEl.innerHTML = nrOpts || '<option value="">Cadastre NRs em Configurações (ADM)</option>';

    const turmaCheckEl = document.getElementById('turma-colabs-checklist');
    if (turmaCheckEl) {
      const ativosList = sstData.colaboradores.filter(c => c.status === 'ativo');
      turmaCheckEl.innerHTML = ativosList.length === 0
        ? '<small style="color:var(--text-muted);">Nenhum colaborador ativo cadastrado.</small>'
        : ativosList.map(c => `
          <label class="perm-item">
            <input type="checkbox" name="turma-colab-item" value="${c.id}">
            <span>${c.nome} <small style="color:var(--text-muted);">(${c.setor || 'geral'})</small></span>
          </label>
        `).join('');
    }

    const pendencias = [];

    for (const a of sstData.asos_pendentes) {
      pendencias.push({
        colaborador_id: a.colaborador_id,
        colaborador_nome: a.colaborador_nome,
        setor: a.setor,
        tipo: 'ASO (Saúde)',
        exigencia: a.motivo,
        situacao: a.situacao,
        data_validade: a.data_validade
      });
    }

    const ativos = sstData.colaboradores.filter(c => c.status === 'ativo');
    for (const colab of ativos) {
      const setorColab = (colab.setor || 'geral').toLowerCase();
      const regrasSetor = sstData.matriz_nrs.filter(
        m => m.setor.toLowerCase() === setorColab || m.setor.toLowerCase() === 'geral'
      );

      for (const regra of regrasSetor) {
        const docsMatch = docsRh.filter(
          d => d.colaborador_id === colab.id &&
            (d.nr_id === regra.nr_id || (d.codigo_nr && d.codigo_nr.toLowerCase() === regra.nr_codigo.toLowerCase()))
        );

        if (docsMatch.length === 0) {
          pendencias.push({
            colaborador_id: colab.id,
            colaborador_nome: colab.nome,
            setor: colab.setor || 'geral',
            tipo: 'Treinamento NR',
            exigencia: `${regra.nr_codigo} - ${regra.nr_nome}`,
            situacao: 'a_fazer',
            data_validade: null,
            nr_id: regra.nr_id
          });
        } else {
          const docRecente = docsMatch[0];
          pendencias.push({
            colaborador_id: colab.id,
            colaborador_nome: colab.nome,
            setor: colab.setor || 'geral',
            tipo: 'Treinamento NR',
            exigencia: `${regra.nr_codigo} - ${regra.nr_nome}`,
            situacao: docRecente.status_validade || 'valido',
            data_validade: docRecente.data_validade,
            nr_id: regra.nr_id
          });
        }
      }
    }

    STATE.sstPendenciasCache = pendencias;

    const asosCriticos = sstData.asos_pendentes.length;
    const nrsCriticos = pendencias.filter(p => p.tipo === 'Treinamento NR' && p.situacao !== 'valido').length;
    const kpiAsosEl = document.getElementById('sst-kpi-asos');
    const kpiNrsEl = document.getElementById('sst-kpi-nrs');
    if (kpiAsosEl) kpiAsosEl.textContent = asosCriticos;
    if (kpiNrsEl) kpiNrsEl.textContent = nrsCriticos;

    renderSstPendencias();
    renderSstAsosTable(sstData.asos);
    renderProntuarioChecklist(ativos, sstData.tipos_doc_rh, docsRh, sstData.acervo);
    renderAdminAutonomia(sstData);
  } catch (err) {
    console.error(err);
    alert('Erro ao carregar dados de SST: ' + err.message);
  }
}

function renderSstPendencias() {
  const filtro = document.getElementById('sst-filtro-status')?.value || 'pendentes';
  const lista = filtro === 'pendentes'
    ? STATE.sstPendenciasCache.filter(p => p.situacao !== 'valido')
    : STATE.sstPendenciasCache;

  const tbody = document.getElementById('sst-pendencias-body');
  if (!tbody) return;

  tbody.innerHTML = lista.length === 0
    ? `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhuma pendência encontrada neste filtro.</td></tr>`
    : lista.map(p => {
      const badge = p.situacao === 'valido'
        ? '<span class="status-pill pill-green">Em Dia</span>'
        : p.situacao === 'vencendo'
          ? '<span class="status-pill pill-amber">Vencendo (30d)</span>'
          : p.situacao === 'vencido'
            ? '<span class="status-pill pill-red">Vencido</span>'
            : '<span class="status-pill pill-red">A Realizar / Fazer</span>';

      const acaoBtn = p.tipo === 'ASO (Saúde)'
        ? `<button class="btn-pill btn-primary btn-sm" onclick="prepararAsoRapido('${p.colaborador_id}')">Lançar ASO</button>`
        : `<button class="btn-pill btn-gold btn-sm" onclick="prepararTreinamentoRapido('${p.colaborador_id}', '${p.nr_id || ''}')">Lançar NR</button>`;

      return `
        <tr>
          <td><strong>${p.colaborador_nome}</strong></td>
          <td><span class="status-pill pill-teal">${p.setor}</span></td>
          <td>${p.tipo}</td>
          <td>${p.exigencia}</td>
          <td>${badge}</td>
          <td>${formatDateBR(p.data_validade)}</td>
          <td>${acaoBtn}</td>
        </tr>`;
    }).join('');
}

function prepararAsoRapido(colabId) {
  document.getElementById('aso-colaborador').value = colabId;
  const hoje = new Date().toISOString().slice(0, 10);
  document.getElementById('aso-data-exame').value = hoje;
  const dtVal = new Date();
  dtVal.setFullYear(dtVal.getFullYear() + 1);
  document.getElementById('aso-data-validade').value = dtVal.toISOString().slice(0, 10);
  document.getElementById('form-sst-aso').scrollIntoView({ behavior: 'smooth' });
}

function prepararTreinamentoRapido(colabId, nrId) {
  if (nrId) document.getElementById('turma-nr-select').value = nrId;
  document.getElementById('turma-data').value = new Date().toISOString().slice(0, 10);
  document.querySelectorAll('input[name="turma-colab-item"]').forEach(cb => {
    cb.checked = cb.value === colabId;
  });
  document.getElementById('form-sst-turma').scrollIntoView({ behavior: 'smooth' });
}

function renderSstAsosTable(asos) {
  const tbody = document.getElementById('sst-asos-body');
  if (!tbody) return;
  tbody.innerHTML = asos.length === 0
    ? `<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhum ASO registrado ainda.</td></tr>`
    : asos.map(a => {
      const badge = a.status_validade === 'vencido'
        ? '<span class="status-pill pill-red">Vencido</span>'
        : a.status_validade === 'vencendo'
          ? '<span class="status-pill pill-amber">Vencendo</span>'
          : '<span class="status-pill pill-green">Válido</span>';
      return `
        <tr>
          <td><strong>${a.colaborador_nome}</strong></td>
          <td style="text-transform:capitalize;">${a.tipo_exame.replace('_', ' ')}</td>
          <td style="text-transform:capitalize;">${a.resultado.replace('_', ' ')}</td>
          <td>${formatDateBR(a.data_exame)}</td>
          <td>${formatDateBR(a.data_validade)}</td>
          <td>${badge}</td>
          <td>${a.arquivo_url ? `<a href="${a.arquivo_url}" target="_blank" class="btn-pill btn-outline btn-sm">Ver ASO</a>` : '-'}</td>
          <td><button class="btn-pill btn-outline btn-sm" onclick="excluirAso('${a.id}')">Excluir</button></td>
        </tr>`;
    }).join('');
}

async function excluirAso(id) {
  if (!confirm('Excluir este registro de ASO?')) return;
  await apiFetch('/api/sst', { method: 'POST', body: JSON.stringify({ action: 'excluir_aso', id }) });
  loadSST();
}

function renderProntuarioChecklist(ativos, tiposDoc, docsRh, acervoItems = []) {
  const tbody = document.getElementById('sst-prontuario-body');
  if (!tbody) return;

  if (ativos.length === 0 || tiposDoc.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">Cadastre colaboradores e itens de prontuário.</td></tr>`;
    return;
  }

  let somaPct = 0;
  tbody.innerHTML = ativos.map(c => {
    const docsColab = docsRh.filter(d => d.colaborador_id === c.id);
    const acervoColab = acervoItems.filter(a => a.colaborador_id === c.id);
    let feitos = 0;

    const chips = tiposDoc.map(td => {
      const chave = td.nome.toLowerCase().slice(0, 8);
      const okRh = docsColab.some(d => d.titulo.toLowerCase().includes(chave));
      const okAcervo = acervoColab.some(a =>
        `${a.titulo} ${a.texto_ocr || ''}`.toLowerCase().includes(chave)
      );
      const ok = okRh || okAcervo;
      if (ok) feitos++;
      return `<span class="status-pill ${ok ? 'pill-green' : 'pill-amber'}" style="margin:2px;">${ok ? '✓' : '○'} ${td.nome}</span>`;
    }).join(' ');

    const pct = Math.round((feitos / tiposDoc.length) * 100);
    somaPct += pct;

    return `
      <tr>
        <td><strong>${c.nome}</strong></td>
        <td>${chips}</td>
        <td><strong>${feitos}/${tiposDoc.length}</strong> (${pct}%)</td>
        <td>
          <label class="btn-pill btn-outline btn-sm" style="cursor:pointer;">
            Digitalizar Folha
            <input type="file" accept="image/*,.pdf" style="display:none;" onchange="digitalizarDocProntuario(event, '${c.id}')">
          </label>
        </td>
      </tr>`;
  }).join('');

  const pastasEl = document.getElementById('sst-kpi-pastas');
  if (pastasEl) pastasEl.textContent = `${Math.round(somaPct / ativos.length)}%`;
}

async function digitalizarDocProntuario(event, colabId) {
  const file = event.target.files[0];
  if (!file) return;
  const tipos = STATE.sst?.tipos_doc_rh || [];
  const sugestao = tipos.map(t => t.nome).join(' | ');
  const titulo = prompt(`Qual documento você está digitalizando?\nOpções: ${sugestao}`, tipos[0]?.nome || 'Documento RH');
  if (!titulo) return;

  const colabObj = STATE.sst?.colaboradores.find(c => c.id === colabId);
  const hoje = new Date().toISOString().slice(0, 10);

  try {
    const url = await uploadArquivoR2(file, 'rh-documentos');
    await Promise.all([
      syncParaDocumentosRH({
        colaboradorId: colabId,
        tipoDocumento: 'documento',
        titulo: titulo.trim(),
        dataEmissao: hoje,
        arquivoUrl: url
      }),
      syncParaAcervoDigital({
        titulo: `${titulo.trim()}${colabObj ? ' - ' + colabObj.nome : ''}`,
        categoria: 'RH / Colaboradores',
        dataDocumento: hoje,
        colaboradorId: colabId,
        nomeArquivo: file.name,
        arquivoUrl: url
      })
    ]);
    alert('Documento digitalizado e sincronizado com RH e Acervo Digital!');
    loadSST();
  } catch (err) {
    alert(err.message);
  }
}

/* ================= ACERVO DIGITAL (DIGITALIZAÇÃO DE PAPEL COM OCR EM LOTE) ================= */
async function loadAcervo() {
  try {
    const data = await apiFetch('/api/sst?action=overview');
    STATE.sst = data;

    const catSelect = document.getElementById('acervo-categoria');
    const filtroCat = document.getElementById('acervo-filtro-cat');
    const catOpts = data.categorias_acervo.map(c => `<option value="${c.nome}">${c.nome}</option>`).join('');
    if (catSelect) catSelect.innerHTML = catOpts;
    if (filtroCat) filtroCat.innerHTML = `<option value="">Todas as Categorias</option>` + catOpts;

    const colabSel = document.getElementById('acervo-colaborador');
    if (colabSel) {
      colabSel.innerHTML = `<option value="">Nenhum (Documento Geral)</option>` +
        data.colaboradores.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
    }

    renderAcervoTable();
  } catch (err) {
    alert(err.message);
  }
}

function renderAcervoTable() {
  const tbody = document.getElementById('acervo-table-body');
  if (!tbody || !STATE.sst) return;

  const busca = (document.getElementById('acervo-busca')?.value || '').toLowerCase().trim();
  const cat = document.getElementById('acervo-filtro-cat')?.value || '';

  const filtrados = STATE.sst.acervo.filter(item => {
    if (cat && item.categoria !== cat) return false;
    if (!busca) return true;
    const blob = `${item.titulo} ${item.categoria} ${item.pasta_fisica || ''} ${item.nome_arquivo || ''} ${item.texto_ocr || ''}`.toLowerCase();
    return blob.includes(busca);
  });

  tbody.innerHTML = filtrados.length === 0
    ? `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhum documento digitalizado encontrado.</td></tr>`
    : filtrados.map(item => `
      <tr>
        <td>${formatDateBR(item.data_documento || item.created_at)}</td>
        <td><strong>${item.titulo}</strong><br><small style="color:var(--text-muted);">${item.nome_arquivo || ''}</small></td>
        <td><span class="status-pill pill-teal">${item.categoria}</span></td>
        <td>${item.pasta_fisica || '-'}</td>
        <td style="max-width:260px;"><small style="color:var(--text-muted);">${(item.texto_ocr || '').slice(0, 95)}${(item.texto_ocr || '').length > 95 ? '...' : ''}</small></td>
        <td>
          <a href="${item.arquivo_url}" target="_blank" class="btn-pill btn-primary btn-sm">Abrir</a>
          <button class="btn-pill btn-outline btn-sm" onclick="excluirItemAcervo('${item.id}')">Excluir</button>
        </td>
      </tr>`).join('');
}

async function excluirItemAcervo(id) {
  if (!confirm('Remover este documento do Acervo Digital?')) return;
  await apiFetch('/api/sst', { method: 'POST', body: JSON.stringify({ action: 'excluir_acervo_item', id }) });
  loadAcervo();
}

/* ================= AUTONOMIA ADMINISTRATIVA (ADM / GESTORES) ================= */
function renderAdminAutonomia(sstData) {
  const nrsBody = document.getElementById('adm-nrs-body');
  if (nrsBody) {
    nrsBody.innerHTML = sstData.catalogo_nrs.map(n => `
      <tr>
        <td><strong>${n.codigo}</strong></td>
        <td>${n.nome}</td>
        <td>${n.validade_meses}m</td>
        <td>
          <button class="btn-pill btn-outline btn-sm" onclick="editarAdmNr('${n.id}')">Editar</button>
          <button class="btn-pill btn-outline btn-sm" onclick="excluirAdmNr('${n.id}')">Excluir</button>
        </td>
      </tr>`).join('');
  }

  const matrizNrSelect = document.getElementById('adm-matriz-nr');
  if (matrizNrSelect) {
    matrizNrSelect.innerHTML = sstData.catalogo_nrs
      .map(n => `<option value="${n.id}">${n.codigo} - ${n.nome}</option>`)
      .join('');
  }

  const matrizBody = document.getElementById('adm-matriz-body');
  if (matrizBody) {
    matrizBody.innerHTML = sstData.matriz_nrs.length === 0
      ? `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">Nenhuma regra cadastrada.</td></tr>`
      : sstData.matriz_nrs.map(m => `
        <tr>
          <td><span class="status-pill pill-teal">${m.setor}</span></td>
          <td><strong>${m.nr_codigo}</strong> - ${m.nr_nome}</td>
          <td><button class="btn-pill btn-outline btn-sm" onclick="excluirAdmMatriz('${m.id}')">Remover</button></td>
        </tr>`).join('');
  }

  const tipoDocBody = document.getElementById('adm-tipodoc-body');
  if (tipoDocBody) {
    tipoDocBody.innerHTML = sstData.tipos_doc_rh.map(t => `
      <tr>
        <td>${t.nome}</td>
        <td>${t.obrigatorio ? 'Obrigatório' : 'Opcional'}</td>
        <td><button class="btn-pill btn-outline btn-sm" onclick="excluirAdmTipoDoc('${t.id}')">Excluir</button></td>
      </tr>`).join('');
  }

  const catAcervoBody = document.getElementById('adm-cat-acervo-body');
  if (catAcervoBody) {
    catAcervoBody.innerHTML = sstData.categorias_acervo.map(c => `
      <tr>
        <td>${c.nome}</td>
        <td><button class="btn-pill btn-outline btn-sm" onclick="excluirAdmCatAcervo('${c.id}')">Excluir</button></td>
      </tr>`).join('');
  }

  const audBody = document.getElementById('adm-auditoria-body');
  if (audBody) {
    audBody.innerHTML = sstData.auditoria.length === 0
      ? `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Nenhuma alteração registrada ainda.</td></tr>`
      : sstData.auditoria.map(a => `
        <tr>
          <td>${formatDateBR(a.created_at)}</td>
          <td><strong>${a.usuario_nome}</strong></td>
          <td>${a.acao}</td>
          <td>${a.detalhes || '-'}</td>
        </tr>`).join('');
  }
}

function editarAdmNr(id) {
  const n = STATE.sst?.catalogo_nrs.find(x => x.id === id);
  if (!n) return;
  document.getElementById('adm-nr-id').value = n.id;
  document.getElementById('adm-nr-codigo').value = n.codigo || '';
  document.getElementById('adm-nr-nome').value = n.nome || '';
  document.getElementById('adm-nr-validade').value = n.validade_meses || 12;
  document.getElementById('adm-nr-carga').value = n.carga_horaria_padrao || 8;
  document.getElementById('adm-nr-conteudo').value = n.conteudo_programatico || '';
}

function resetFormAdmNr() {
  document.getElementById('form-adm-nr').reset();
  document.getElementById('adm-nr-id').value = '';
}

async function excluirAdmNr(id) {
  if (!confirm('Excluir esta norma/treinamento do catálogo?')) return;
  await apiFetch('/api/sst', { method: 'POST', body: JSON.stringify({ action: 'excluir_nr', id }) });
  loadSST();
}

async function excluirAdmMatriz(id) {
  await apiFetch('/api/sst', { method: 'POST', body: JSON.stringify({ action: 'excluir_matriz_nr', id }) });
  loadSST();
}

async function excluirAdmTipoDoc(id) {
  await apiFetch('/api/sst', { method: 'POST', body: JSON.stringify({ action: 'excluir_tipo_doc_rh', id }) });
  loadSST();
}

async function excluirAdmCatAcervo(id) {
  await apiFetch('/api/sst', { method: 'POST', body: JSON.stringify({ action: 'excluir_categoria_acervo', id }) });
  loadSST();
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

/* ================= TRANSCRIÇÃO AVANÇADA DE FOTO DE DANFE / NF ================= */
async function uploadArquivoR2(file, pasta) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('pasta', pasta);
  const res = await apiFetch('/api/upload', { method: 'POST', body: formData });
  return res.url;
}

function renderizarCanvasNitido(img, cropTopRatio = 1.0) {
  const targetWidth = Math.max(2400, Math.min(3200, img.width * 3));
  const scale = targetWidth / img.width;
  const srcH = Math.round(img.height * cropTopRatio);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(srcH * scale);

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.filter = 'grayscale(100%) contrast(125%)';
  ctx.drawImage(img, 0, 0, img.width, srcH, 0, 0, canvas.width, canvas.height);

  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'));
}

function carregarImagem(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = err => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function formatarCnpj14(d) {
  if (!d || d.length !== 14) return '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

function validarChaveNfe44(chave) {
  if (!/^\d{44}$/.test(chave)) return false;
  const modelo = chave.slice(20, 22);
  if (modelo !== '55' && modelo !== '65') return false;
  let peso = 2;
  let soma = 0;
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return dv === Number(chave[43]);
}

async function extrairTextoArquivo(file, onProgress) {
  const name = file.name.toLowerCase();

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
    return parseTextoNotaFiscal(rawText, rawText);
  }

  if (file.type.startsWith('image/') && window.Tesseract) {
    if (onProgress) onProgress('Ampliando cabeçalho da Nota Fiscal...');
    const img = await carregarImagem(file);
    const topBlob = await renderizarCanvasNitido(img, 0.55);
    const fullBlob = await renderizarCanvasNitido(img, 1.0);

    const resTop = await Tesseract.recognize(topBlob, 'por', {
      logger: m => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(`Lendo dados principais... ${Math.round((m.progress || 0) * 100)}%`);
        }
      }
    });

    const resFull = await Tesseract.recognize(fullBlob, 'por', {
      logger: m => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(`Conferindo página completa... ${Math.round((m.progress || 0) * 100)}%`);
        }
      }
    });

    const topText = resTop.data.text || '';
    const fullText = resFull.data.text || topText;
    const parsed = parseTextoNotaFiscal(topText, fullText);
    parsed.texto = fullText.trim();
    return parsed;
  }

  rawText = await file.text().catch(() => '');
  return parseTextoNotaFiscal(rawText, rawText);
}

function parseTextoNotaFiscal(topText, fullText) {
  const cleanTop = (topText || '').replace(/\r/g, '');
  const cleanFull = (fullText || topText || '').replace(/\r/g, '');

  let nfFromChave = '';
  let cnpjFromChave = '';
  const digitsLines = cleanTop.split('\n').map(l => l.replace(/\D/g, ''));
  for (const lineDigits of digitsLines) {
    if (lineDigits.length >= 44) {
      for (let i = 0; i <= lineDigits.length - 44; i++) {
        const cand = lineDigits.slice(i, i + 44);
        if (validarChaveNfe44(cand)) {
          cnpjFromChave = formatarCnpj14(cand.slice(6, 20));
          const nfNum = parseInt(cand.slice(25, 34), 10);
          if (!isNaN(nfNum) && nfNum > 0) nfFromChave = String(nfNum);
          break;
        }
      }
    }
    if (nfFromChave) break;
  }

  const nfRegexList = [
    /N[º°o]\.?\s*[:\-]?\s*0*([\d\.]{1,11})/i,
    /(?:NF-e|NFE|DANFE)[\s\S]{0,35}?N[º°o]\.?\s*[:\-]?\s*0*([\d\.]{1,11})/i
  ];
  let nfFromHeader = '';
  for (const rx of nfRegexList) {
    const m = cleanTop.match(rx);
    if (m && m[1]) {
      const onlyDigits = m[1].replace(/\./g, '').replace(/^0+/, '');
      if (onlyDigits && onlyDigits.length <= 9) {
        nfFromHeader = onlyDigits;
        break;
      }
    }
  }
  const numeroNf = nfFromChave || nfFromHeader;

  let emitente = '';
  const canhotoMatch = cleanTop.match(/RECEBEMOS\s+DE\s+([A-Z0-9À-Ú\s\.\-\/&]+?)\s+(?:OS\s+PRODUTOS|A\(S\)|AS\s+MERCADORIAS|CONSTANTES)/i);
  if (canhotoMatch && canhotoMatch[1]) {
    emitente = canhotoMatch[1].replace(/\s+/g, ' ').trim();
  }

  if (!emitente) {
    const lines = cleanTop
      .split('\n')
      .map(l => l.trim())
      .filter(l =>
        l.length > 4 &&
        !/^(DANFE|DOCUMENTO AUXILIAR|CHAVE DE ACESSO|CONSULTA DE AUTENTICIDADE|RECEBEMOS DE|DESTINAT[ÁA]RIO|NF-E EMITIDA|AMBIENTE DE HOMOLOGA)/i.test(l)
      );
    const empresaLine = lines.find(l =>
      /(LTDA|S\/A|S\.A|EIRELI|ME\b|EPP\b|VIDROS|DISTRIBUIDORA|COMERCIAL|COMERCIO|INDUSTRIA|TRANSPORTADORAS)/i.test(l)
    );
    emitente = (empresaLine || lines[0] || '').slice(0, 90);
  }

  const beforeDestTop = cleanTop.split(/DESTINAT[ÁA]RIO/i)[0] || cleanTop;
  const cnpjTopBeforeDest = beforeDestTop.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)?.[0] || '';
  const cnpjAnyTop = cleanTop.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)?.[0] || '';
  const cpfMatch = cleanTop.match(/\d{3}\.\d{3}\.\d{3}-\d{2}/)?.[0] || '';
  const docFinal = cnpjFromChave || cnpjTopBeforeDest || cnpjAnyTop || cpfMatch;

  const textSemDocs = cleanFull
    .replace(/\d{2}[.,]\d{3}[.,]\d{3}\/\d{4}-\d{2}/g, ' ')
    .replace(/\d{3}[.,]\d{3}[.,]\d{3}-\d{2}/g, ' ');

  let valorNum = '';
  const blocoTotalNota = textSemDocs.match(/VALOR\s+TOTAL\s+DA\s+NOTA([\s\S]{0,160}?)(?:TRANSPORTADOR|DADOS\s+DOS\s+PRODUTOS|$)/i);
  if (blocoTotalNota && blocoTotalNota[1]) {
    const numsBloco = [...blocoTotalNota[1].matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2})/g)]
      .map(m => parseFloat(m[1].replace(/\./g, '').replace(',', '.')))
      .filter(n => !isNaN(n));
    if (numsBloco.length > 0) {
      const ultimo = numsBloco[numsBloco.length - 1];
      if (ultimo > 0) valorNum = ultimo.toFixed(2);
    }
  }

  if (!valorNum) {
    const todosValores = [...textSemDocs.matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2})/g)]
      .map(m => parseFloat(m[1].replace(/\./g, '').replace(',', '.')))
      .filter(n => !isNaN(n) && n > 0 && n < 10000000);
    if (todosValores.length > 0) {
      valorNum = Math.max(...todosValores).toFixed(2);
    }
  }

  let dataIso = '';
  const faturaSection = cleanFull.match(/FATURAS?[\s\S]{0,260}/i)?.[0] || '';
  const vencFaturaMatch = faturaSection.match(/(\d{2})\/(\d{2})\/(20\d{2})/);
  const vencLabelMatch = cleanFull.match(/(?:VENCIMENTO|VENC\.?)[\s\S]{0,30}?(\d{2})\/(\d{2})\/(20\d{2})/i);
  const emissaoMatch = cleanTop.match(/(?:EMISS[ÃA]O)[\s\S]{0,35}?(\d{2})\/(\d{2})\/(20\d{2})/i);
  const anyDateMatch = cleanTop.match(/(\d{2})\/(\d{2})\/(20\d{2})/);

  const chosenDate = vencFaturaMatch || vencLabelMatch || emissaoMatch || anyDateMatch;
  if (chosenDate) {
    dataIso = `${chosenDate[3]}-${chosenDate[2]}-${chosenDate[1]}`;
  }

  return {
    nome: emitente.slice(0, 90),
    doc: docFinal,
    nf: numeroNf,
    valor: valorNum,
    data: dataIso,
    texto: cleanFull.trim()
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

  // --- SINCRONIZAÇÃO: DOCUMENTOS & NRs -> SST (SE FOR ASO) + ACERVO DIGITAL ---
  document.getElementById('form-documento').addEventListener('submit', async e => {
    e.preventDefault();
    const colabId = document.getElementById('doc-colaborador').value;
    const nrId = document.getElementById('doc-nr-select').value || null;
    const titulo = document.getElementById('doc-titulo').value.trim();
    const dataEmissao = document.getElementById('doc-emissao').value || new Date().toISOString().slice(0, 10);
    const dataValidade = document.getElementById('doc-validade').value || null;
    const nrObj = STATE.rh?.catalogo_nrs.find(n => n.id === nrId);
    const colabObj = STATE.rh?.colaboradores.find(c => c.id === colabId);

    try {
      let fileUrl = null;
      const fileInput = document.getElementById('doc-file');
      const fileObj = fileInput.files[0];
      if (fileObj) {
        fileUrl = await uploadArquivoR2(fileObj, 'rh-documentos');
      }

      await apiFetch('/api/rh', {
        method: 'POST',
        body: JSON.stringify({
          action: 'criar_documento',
          colaborador_id: colabId,
          nr_id: nrId,
          tipo_documento: nrId ? 'nr' : 'documento',
          titulo,
          data_emissao: dataEmissao,
          data_validade: dataValidade,
          arquivo_url: fileUrl
        })
      });

      // Se o documento lançado no RH for NR-07 ou ASO, dá baixa automática no painel SST
      if (nrObj?.codigo?.toUpperCase() === 'NR-07' || /\baso\b/i.test(titulo)) {
        await apiFetch('/api/sst', {
          method: 'POST',
          body: JSON.stringify({
            action: 'salvar_aso',
            colaborador_id: colabId,
            tipo_exame: 'periodico',
            resultado: 'apto',
            data_exame: dataEmissao,
            data_validade: dataValidade,
            medico_clinica: 'Lançado via RH',
            arquivo_url: fileUrl
          })
        }).catch(() => null);
      }

      // Se houver anexo, indexa automaticamente no Acervo Digital
      if (fileUrl) {
        await syncParaAcervoDigital({
          titulo: `${titulo}${colabObj ? ' - ' + colabObj.nome : ''}`,
          categoria: nrId ? 'SST / ASOs e NRs' : 'RH / Colaboradores',
          dataDocumento: dataEmissao,
          colaboradorId: colabId,
          nomeArquivo: fileObj?.name || titulo,
          arquivoUrl: fileUrl
        });
      }

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

  // --- SINCRONIZAÇÃO: SST (ASO) -> COLABORADORES & NRs + ACERVO DIGITAL ---
  document.getElementById('aso-data-exame')?.addEventListener('change', e => {
    const tipo = document.getElementById('aso-tipo')?.value;
    if (e.target.value && tipo !== 'demissional') {
      const dt = new Date(e.target.value + 'T12:00:00');
      dt.setFullYear(dt.getFullYear() + 1);
      document.getElementById('aso-data-validade').value = dt.toISOString().slice(0, 10);
    }
  });

  document.getElementById('form-sst-aso')?.addEventListener('submit', async e => {
    e.preventDefault();
    const colabId = document.getElementById('aso-colaborador').value;
    const tipoExame = document.getElementById('aso-tipo').value;
    const resultado = document.getElementById('aso-resultado').value;
    const dataExame = document.getElementById('aso-data-exame').value;
    const dataValidade = document.getElementById('aso-data-validade').value || null;
    const clinica = document.getElementById('aso-clinica').value;

    const colabObj = STATE.sst?.colaboradores.find(c => c.id === colabId);
    const nr07 = STATE.sst?.catalogo_nrs.find(n => n.codigo.toUpperCase() === 'NR-07');

    try {
      let fileUrl = null;
      const f = document.getElementById('aso-file').files[0];
      if (f) fileUrl = await uploadArquivoR2(f, 'sst-asos');

      await apiFetch('/api/sst', {
        method: 'POST',
        body: JSON.stringify({
          action: 'salvar_aso',
          colaborador_id: colabId,
          tipo_exame: tipoExame,
          resultado,
          data_exame: dataExame,
          data_validade: dataValidade,
          medico_clinica: clinica,
          arquivo_url: fileUrl
        })
      });

      const tituloAso = `NR-07 - ASO (${tipoExame.replace('_', ' ')} · ${resultado.replace('_', ' ')})`;
      await syncParaDocumentosRH({
        colaboradorId: colabId,
        nrId: nr07?.id || null,
        tipoDocumento: 'nr',
        titulo: tituloAso,
        dataEmissao: dataExame,
        dataValidade,
        arquivoUrl: fileUrl
      });

      if (fileUrl) {
        await syncParaAcervoDigital({
          titulo: `${tituloAso}${colabObj ? ' - ' + colabObj.nome : ''}`,
          categoria: 'SST / ASOs e NRs',
          dataDocumento: dataExame,
          colaboradorId: colabId,
          nomeArquivo: f?.name || tituloAso,
          arquivoUrl: fileUrl
        });
      }

      e.target.reset();
      loadSST();
    } catch (err) {
      alert(err.message);
    }
  });

  // --- SINCRONIZAÇÃO: SST (TURMA) -> RH + CERTIFICADOS + ACERVO DIGITAL ---
  document.getElementById('turma-nr-select')?.addEventListener('change', e => {
    const opt = e.target.selectedOptions[0];
    if (opt?.dataset.val) {
      document.getElementById('turma-validade-meses').value = opt.dataset.val;
    }
  });

  document.getElementById('form-sst-turma')?.addEventListener('submit', async e => {
    e.preventDefault();
    const selecionados = [...document.querySelectorAll('input[name="turma-colab-item"]:checked')].map(c => c.value);
    if (selecionados.length === 0) {
      return alert('Selecione pelo menos um colaborador participante.');
    }

    const nrId = document.getElementById('turma-nr-select').value;
    const nrObj = STATE.sst?.catalogo_nrs.find(n => n.id === nrId);
    const dataEmissao = document.getElementById('turma-data').value;
    const meses = Number(document.getElementById('turma-validade-meses').value || 12);
    const dtVal = new Date(dataEmissao + 'T12:00:00');
    dtVal.setMonth(dtVal.getMonth() + meses);
    const dataValidade = dtVal.toISOString().slice(0, 10);
    const tituloTreinamento = nrObj ? `${nrObj.codigo} - ${nrObj.nome}` : 'Treinamento SST';

    const emitirCerts = confirm(
      `Deseja também emitir os Certificados Oficiais para os ${selecionados.length} participante(s) no Gerador de Certificados?\n\nOK = Atualizar validade + Emitir Certificados\nCancelar = Apenas atualizar validade da NR`
    );

    try {
      let fileUrl = null;
      const f = document.getElementById('turma-file').files[0];
      if (f) fileUrl = await uploadArquivoR2(f, 'sst-treinamentos');

      for (const colabId of selecionados) {
        if (emitirCerts) {
          await apiFetch('/api/rh', {
            method: 'POST',
            body: JSON.stringify({
              action: 'gerar_certificado',
              colaborador_id: colabId,
              nr_id: nrId,
              titulo_curso: tituloTreinamento,
              carga_horaria: nrObj?.carga_horaria_padrao || 8,
              data_conclusao: dataEmissao,
              validade_meses: meses,
              instrutor_nome: STATE.user?.nome || 'Responsável Técnico SST',
              instrutor_registro: '',
              conteudo_programatico: nrObj?.conteudo_programatico || ''
            })
          });
        } else {
          await syncParaDocumentosRH({
            colaboradorId: colabId,
            nrId,
            tipoDocumento: 'nr',
            titulo: tituloTreinamento,
            dataEmissao,
            dataValidade,
            arquivoUrl: fileUrl
          });
        }
      }

      if (fileUrl) {
        await syncParaAcervoDigital({
          titulo: `Lista de Presença / Certificado - ${tituloTreinamento} (${selecionados.length} participantes)`,
          categoria: 'SST / ASOs e NRs',
          dataDocumento: dataEmissao,
          colaboradorId: selecionados.length === 1 ? selecionados[0] : null,
          nomeArquivo: f?.name || tituloTreinamento,
          arquivoUrl: fileUrl
        });
      }

      alert(
        emitirCerts
          ? `Treinamento lançado e ${selecionados.length} certificado(s) emitido(s) com sucesso!`
          : `Treinamento lançado para ${selecionados.length} colaborador(es)!`
      );
      e.target.reset();
      loadSST();
    } catch (err) {
      alert(err.message);
    }
  });

  // --- SINCRONIZAÇÃO: ACERVO DIGITAL (EM LOTE) -> RH & PRONTUÁRIO SST ---
  document.getElementById('form-acervo-lote')?.addEventListener('submit', async e => {
    e.preventDefault();
    const files = [...document.getElementById('acervo-files').files];
    if (files.length === 0) return;

    const btn = document.getElementById('btn-acervo-upload');
    const status = document.getElementById('acervo-ocr-status');
    const cat = document.getElementById('acervo-categoria').value;
    const prefixo = document.getElementById('acervo-titulo').value.trim();
    const pastaFisica = document.getElementById('acervo-pasta-fisica').value.trim();
    const dataDoc = document.getElementById('acervo-data').value || null;
    const colabId = document.getElementById('acervo-colaborador').value || null;

    btn.disabled = true;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        status.textContent = `Digitalizando arquivo ${i + 1} de ${files.length}: ${file.name}...`;

        const [fileUrl, parsed] = await Promise.all([
          uploadArquivoR2(file, 'acervo-digital'),
          extrairTextoArquivo(file, msg => {
            status.textContent = `[${i + 1}/${files.length}] ${msg}`;
          }).catch(() => ({ texto: '' }))
        ]);

        const tituloFinal = prefixo
          ? (files.length > 1 ? `${prefixo} (${i + 1})` : prefixo)
          : file.name.replace(/\.[^.]+$/, '');

        await apiFetch('/api/sst', {
          method: 'POST',
          body: JSON.stringify({
            action: 'salvar_acervo_item',
            titulo: tituloFinal,
            categoria: cat,
            pasta_fisica: pastaFisica || null,
            data_documento: dataDoc,
            colaborador_id: colabId,
            nome_arquivo: file.name,
            arquivo_url: fileUrl,
            texto_ocr: parsed.texto || ''
          })
        });

        // Se o documento digitalizado foi vinculado a um colaborador, atualiza também o RH e o Prontuário SST
        if (colabId) {
          await syncParaDocumentosRH({
            colaboradorId: colabId,
            tipoDocumento: 'documento',
            titulo: tituloFinal,
            dataEmissao: dataDoc || new Date().toISOString().slice(0, 10),
            arquivoUrl: fileUrl
          });
        }
      }

      status.textContent = `${files.length} documento(s) digitalizado(s) e sincronizado(s) com sucesso!`;
      e.target.reset();
      loadAcervo();
    } catch (err) {
      status.textContent = 'Erro: ' + err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // --- LISTENERS DE AUTONOMIA ADMINISTRATIVA (ADM / GESTORES) ---
  document.getElementById('form-adm-nr')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await apiFetch('/api/sst', {
        method: 'POST',
        body: JSON.stringify({
          action: 'salvar_nr',
          id: document.getElementById('adm-nr-id').value || null,
          codigo: document.getElementById('adm-nr-codigo').value.trim(),
          nome: document.getElementById('adm-nr-nome').value.trim(),
          validade_meses: document.getElementById('adm-nr-validade').value,
          carga_horaria_padrao: document.getElementById('adm-nr-carga').value,
          conteudo_programatico: document.getElementById('adm-nr-conteudo').value.trim()
        })
      });
      resetFormAdmNr();
      loadSST();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('form-adm-matriz')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await apiFetch('/api/sst', {
        method: 'POST',
        body: JSON.stringify({
          action: 'salvar_matriz_nr',
          setor: document.getElementById('adm-matriz-setor').value,
          nr_id: document.getElementById('adm-matriz-nr').value
        })
      });
      loadSST();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('form-adm-tipodoc')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await apiFetch('/api/sst', {
        method: 'POST',
        body: JSON.stringify({
          action: 'salvar_tipo_doc_rh',
          nome: document.getElementById('adm-tipodoc-nome').value.trim(),
          obrigatorio: document.getElementById('adm-tipodoc-obrig').checked
        })
      });
      e.target.reset();
      loadSST();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('form-adm-cat-acervo')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await apiFetch('/api/sst', {
        method: 'POST',
        body: JSON.stringify({
          action: 'salvar_categoria_acervo',
          nome: document.getElementById('adm-cat-acervo-nome').value.trim()
        })
      });
      e.target.reset();
      loadSST();
    } catch (err) {
      alert(err.message);
    }
  });

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
