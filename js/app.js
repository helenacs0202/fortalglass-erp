const STATE = {
  token: localStorage.getItem('fg_token') || null,
  user: null,
  charts: {
    fluxo: null,
    categorias: null
  }
};

const MODULE_INFO = {
  dashboard: {
    title: 'Visão Geral Financeira',
    subtitle: 'Indicadores de caixa, projeção de 30 dias e movimentações recentes'
  },
  fluxo: {
    title: 'Fluxo de Caixa & Lançamentos',
    subtitle: 'Entradas, saídas avulsas e conciliação de saldo'
  },
  servicos: {
    title: 'Serviços & Comercial',
    subtitle: 'Pedidos de vidro, parcelas, notas fiscais e comissões'
  },
  pagar: {
    title: 'Contas a Pagar & Rateio',
    subtitle: 'Fornecedores, despesas fixas/variáveis e comprovantes'
  },
  estoque: {
    title: 'Controle de Estoque',
    subtitle: 'Chapas de vidro, ferragens, insumos e alertas de reposição'
  },
  producao: {
    title: 'Chão de Fábrica & Produção',
    subtitle: 'Acompanhamento de corte, têmpera, lapidação e entregas'
  },
  folha: {
    title: 'Folha de Pagamento & Comissões',
    subtitle: 'Fechamento mensal de colaboradores e equipe comercial'
  },
  config: {
    title: 'Configurações do Sistema',
    subtitle: 'Saldo inicial, categorias, processos e gestão de usuários'
  }
};

function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(value || 0));
}

async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
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
    user.perfil === 'admin' ? 'Administrador' : 'Equipe';

  document.querySelectorAll('[data-admin-only="true"]').forEach(el => {
    if (user.perfil === 'admin') {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  switchModule('dashboard');
}

async function checkSession() {
  if (!STATE.token) {
    showLogin();
    return;
  }
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

  const dashSection = document.getElementById('section-dashboard');
  const moduleSection = document.getElementById('section-module-placeholder');

  if (moduleKey === 'dashboard') {
    dashSection.classList.remove('hidden');
    moduleSection.classList.add('hidden');
    loadDashboard();
  } else {
    dashSection.classList.add('hidden');
    moduleSection.classList.remove('hidden');
    document.getElementById('placeholder-title').textContent = info.title;
    document.getElementById('placeholder-desc').textContent =
      `Módulo "${info.title}" estruturado e autenticado para ${STATE.user.nome}. Pronto para receber as rotas de cadastro e listagem.`;
  }
}

function renderAlerts(alertas) {
  const container = document.getElementById('dashboard-alerts');
  container.innerHTML = '';

  if (alertas.projecao_negativa) {
    container.innerHTML += `
      <div class="alert-banner alert-danger">
        <span><strong>Atenção no Caixa:</strong> A projeção financeira para os próximos 30 dias está negativa.</span>
      </div>`;
  }

  if (alertas.contas_proximas_qtd > 0) {
    container.innerHTML += `
      <div class="alert-banner alert-warning">
        <span><strong>Contas Próximas do Vencimento:</strong> ${alertas.contas_proximas_qtd} conta(s) somando ${formatBRL(alertas.contas_proximas_valor)}.</span>
      </div>`;
  }

  if (alertas.nf_pendente_qtd > 0) {
    container.innerHTML += `
      <div class="alert-banner alert-info">
        <span><strong>Faturamento Pendente:</strong> ${alertas.nf_pendente_qtd} parcela(s) aguardando emissão de Nota Fiscal (${formatBRL(alertas.nf_pendente_valor)}).</span>
      </div>`;
  }
}

function renderCharts(fluxoMensal, maioresCategorias) {
  const ctxFluxo = document.getElementById('chart-fluxo').getContext('2d');
  if (STATE.charts.fluxo) STATE.charts.fluxo.destroy();

  STATE.charts.fluxo = new Chart(ctxFluxo, {
    type: 'bar',
    data: {
      labels: fluxoMensal.map(item => item.label),
      datasets: [
        {
          label: 'Entradas',
          data: fluxoMensal.map(item => item.entradas),
          backgroundColor: '#10B981',
          borderRadius: 6
        },
        {
          label: 'Saídas',
          data: fluxoMensal.map(item => item.saidas),
          backgroundColor: '#EF4444',
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: '#F1F5F9' }
        },
        x: {
          grid: { display: false }
        }
      }
    }
  });

  const ctxCat = document.getElementById('chart-categorias').getContext('2d');
  if (STATE.charts.categorias) STATE.charts.categorias.destroy();

  const hasCategorias = maioresCategorias.length > 0;
  STATE.charts.categorias = new Chart(ctxCat, {
    type: 'doughnut',
    data: {
      labels: hasCategorias ? maioresCategorias.map(c => c.nome) : ['Sem despesas no mês'],
      datasets: [
        {
          data: hasCategorias ? maioresCategorias.map(c => c.total) : [1],
          backgroundColor: hasCategorias
            ? maioresCategorias.map(c => c.cor)
            : ['#E2E8F0'],
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  });
}

function renderActivities(atividades) {
  const tbody = document.getElementById('recent-activities-body');
  if (!atividades || atividades.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align:center; color: var(--text-muted); padding: 24px;">
          Nenhuma movimentação registrada ainda no banco de dados.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = atividades
    .map(item => {
      const isServico = item.origem === 'servico';
      const tipoBadge = isServico
        ? '<span class="status-pill pill-blue">Serviço</span>'
        : '<span class="status-pill pill-amber">Despesa</span>';

      const statusClass =
        item.status === 'pago' || item.status === 'entregue'
          ? 'pill-green'
          : 'pill-amber';

      return `
        <tr>
          <td>${tipoBadge}</td>
          <td><strong>${item.titulo}</strong></td>
          <td class="${isServico ? 'text-success' : 'text-danger'}" style="font-weight:600;">
            ${isServico ? '+' : '-'} ${formatBRL(item.valor)}
          </td>
          <td><span class="status-pill ${statusClass}">${item.status.replace('_', ' ')}</span></td>
        </tr>`;
    })
    .join('');
}

async function loadDashboard() {
  try {
    const data = await apiFetch('/api/dashboard');
    const { kpis, alertas, fluxo_mensal, maiores_categorias, atividades_recentes } = data;

    document.getElementById('kpi-saldo-atual').textContent = formatBRL(kpis.saldo_atual);
    document.getElementById('kpi-saldo-inicial').textContent =
      `Saldo inicial: ${formatBRL(kpis.saldo_inicial)}`;

    const projEl = document.getElementById('kpi-projecao');
    projEl.textContent = formatBRL(kpis.projecao_30_dias);
    projEl.className = `kpi-value ${kpis.projecao_30_dias >= 0 ? 'text-success' : 'text-danger'}`;

    document.getElementById('kpi-receber').textContent = formatBRL(kpis.total_a_receber);
    document.getElementById('kpi-nf-pendente').textContent =
      `${kpis.nf_pendente_qtd} parcela(s) aguardando NF`;

    document.getElementById('kpi-pagar').textContent = formatBRL(kpis.total_a_pagar);

    renderAlerts(alertas);
    renderCharts(fluxo_mensal, maiores_categorias);
    renderActivities(atividades_recentes);
  } catch (err) {
    console.error('Erro ao carregar dashboard:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('btn-logout').addEventListener('click', handleLogout);
  document.getElementById('btn-refresh-dashboard').addEventListener('click', loadDashboard);

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchModule(btn.dataset.module));
  });

  checkSession();
});
