import { getSql, json, verifyAuth, hasPerm } from './_db.js';

export async function onRequestGet({ request, env }) {
  const user = await verifyAuth(request, env);
  if (!user) return json({ error: 'Não autorizado.' }, 401);
  if (!hasPerm(user, 'financeiro') && !hasPerm(user, 'vendas')) {
    return json({ error: 'Acesso restrito ao setor financeiro.' }, 403);
  }

  try {
    const sql = getSql(env);

    const configRows = await sql`SELECT saldo_inicial FROM configuracoes WHERE id = 1`;
    const saldoInicial = Number(configRows[0]?.saldo_inicial || 0);

    const categorias = await sql`
      SELECT id, nome, tipo, cor_hex
      FROM categorias
      WHERE ativo = TRUE
      ORDER BY nome ASC
    `;

    const vendedores = await sql`
      SELECT id, nome
      FROM colaboradores
      WHERE status = 'ativo'
      ORDER BY nome ASC
    `;

    const parcelas = await sql`
      SELECT
        sp.id,
        sp.servico_id,
        sp.numero_parcela,
        sp.valor,
        sp.data_vencimento,
        sp.data_pagamento,
        sp.tipo_cobranca,
        sp.status,
        sp.numero_nf,
        sp.forma_pagamento,
        sp.comprovante_url,
        s.cliente_nome,
        s.descricao AS servico_descricao,
        s.status_producao
      FROM servico_parcelas sp
      JOIN servicos s ON s.id = sp.servico_id
      ORDER BY
        CASE WHEN sp.status = 'pendente' THEN 0 ELSE 1 END,
        sp.data_vencimento ASC
      LIMIT 150
    `;

    const contasPagar = await sql`
      SELECT
        cp.id,
        cp.descricao,
        cp.fornecedor,
        cp.cnpj_fornecedor,
        cp.numero_nf,
        cp.categoria_id,
        COALESCE(c.nome, 'Sem Categoria') AS categoria_nome,
        COALESCE(c.cor_hex, '#64748B') AS categoria_cor,
        cp.tipo_despesa,
        cp.valor,
        cp.data_vencimento,
        cp.data_pagamento,
        cp.dias_lembrete,
        cp.forma_pagamento,
        cp.status,
        cp.comprovante_url
      FROM contas_pagar cp
      LEFT JOIN categorias c ON c.id = cp.categoria_id
      ORDER BY
        CASE WHEN cp.status = 'pendente' THEN 0 ELSE 1 END,
        cp.data_vencimento ASC
      LIMIT 150
    `;

    const rateios = await sql`
      SELECT id, conta_pagar_id, centro_custo, percentual, valor
      FROM contas_pagar_rateio
    `;

    const rateioMap = {};
    for (const r of rateios) {
      if (!rateioMap[r.conta_pagar_id]) rateioMap[r.conta_pagar_id] = [];
      rateioMap[r.conta_pagar_id].push(r);
    }

    const avulsas = await sql`
      SELECT id, tipo, descricao, valor, data_movimentacao, created_at
      FROM movimentacoes_avulsas
      ORDER BY data_movimentacao DESC, created_at DESC
      LIMIT 100
    `;

    // Extrato consolidado (realizados + previstos)
    const extrato = [];
    for (const p of parcelas) {
      extrato.push({
        id: p.id,
        origem: 'receber',
        tipo: 'entrada',
        data: p.status === 'pago' && p.data_pagamento ? p.data_pagamento : p.data_vencimento,
        descricao: `${p.cliente_nome} · ${p.servico_descricao} (Parc. ${p.numero_parcela})`,
        categoria: p.tipo_cobranca === 'mediante_nf' ? `Mediante NF ${p.numero_nf || ''}` : 'Cobrança Direta',
        valor: Number(p.valor),
        status: p.status,
        comprovante_url: p.comprovante_url
      });
    }
    for (const cp of contasPagar) {
      extrato.push({
        id: cp.id,
        origem: 'pagar',
        tipo: 'saida',
        data: cp.status === 'pago' && cp.data_pagamento ? cp.data_pagamento : cp.data_vencimento,
        descricao: cp.fornecedor ? `${cp.fornecedor} · ${cp.descricao}` : cp.descricao,
        categoria: cp.categoria_nome,
        valor: Number(cp.valor),
        status: cp.status,
        comprovante_url: cp.comprovante_url
      });
    }
    for (const av of avulsas) {
      extrato.push({
        id: av.id,
        origem: 'avulsa',
        tipo: av.tipo === 'receita' ? 'entrada' : 'saida',
        data: av.data_movimentacao,
        descricao: av.descricao,
        categoria: 'Lançamento Avulso',
        valor: Number(av.valor),
        status: 'pago',
        comprovante_url: null
      });
    }

    extrato.sort((a, b) => new Date(b.data) - new Date(a.data));

    return json({
      saldo_inicial: saldoInicial,
      categorias,
      vendedores,
      parcelas: parcelas.map(p => ({ ...p, valor: Number(p.valor) })),
      contas_pagar: contasPagar.map(cp => ({
        ...cp,
        valor: Number(cp.valor),
        rateios: rateioMap[cp.id] || []
      })),
      avulsas: avulsas.map(a => ({ ...a, valor: Number(a.valor) })),
      extrato
    });
  } catch (err) {
    return json({ error: 'Erro ao carregar financeiro: ' + err.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const user = await verifyAuth(request, env);
  if (!user) return json({ error: 'Não autorizado.' }, 401);
  if (!hasPerm(user, 'financeiro') && !hasPerm(user, 'vendas')) {
    return json({ error: 'Sem permissão para operar o financeiro.' }, 403);
  }

  try {
    const body = await request.json();
    const { action } = body;
    const sql = getSql(env);

    // 1. Criar Serviço + Parcelas (Contas a Receber)
    if (action === 'criar_servico') {
      const {
        cliente_nome,
        descricao,
        valor_total,
        vendedor_id,
        data_entrega_prevista,
        observacoes,
        parcelas
      } = body;

      if (!cliente_nome || !descricao || !valor_total) {
        return json({ error: 'Preencha cliente, descrição e valor total.' }, 400);
      }

      const servicoRows = await sql`
        INSERT INTO servicos (
          cliente_nome, descricao, valor_total, status_producao,
          vendedor_id, data_entrega_prevista, observacoes
        )
        VALUES (
          ${cliente_nome},
          ${descricao},
          ${Number(valor_total)},
          'aguardando',
          ${vendedor_id || null},
          ${data_entrega_prevista || null},
          ${observacoes || null}
        )
        RETURNING id
      `;
      const servicoId = servicoRows[0].id;

      const listaParcelas = Array.isArray(parcelas) && parcelas.length > 0
        ? parcelas
        : [{
            numero_parcela: 1,
            valor: Number(valor_total),
            data_vencimento: new Date().toISOString().slice(0, 10),
            tipo_cobranca: 'direto',
            numero_nf: null
          }];

      for (const p of listaParcelas) {
        await sql`
          INSERT INTO servico_parcelas (
            servico_id, numero_parcela, valor, data_vencimento,
            tipo_cobranca, numero_nf, status
          )
          VALUES (
            ${servicoId},
            ${Number(p.numero_parcela || 1)},
            ${Number(p.valor)},
            ${p.data_vencimento},
            ${p.tipo_cobranca || 'direto'},
            ${p.numero_nf || null},
            'pendente'
          )
        `;
      }

      return json({ ok: true, id: servicoId });
    }

    // 2. Baixar Parcela a Receber
    if (action === 'baixar_parcela') {
      const { id, data_pagamento, forma_pagamento, numero_nf, comprovante_url } = body;
      await sql`
        UPDATE servico_parcelas
        SET status = 'pago',
            data_pagamento = ${data_pagamento || new Date().toISOString().slice(0, 10)},
            forma_pagamento = ${forma_pagamento || 'PIX'},
            numero_nf = COALESCE(${numero_nf || null}, numero_nf),
            comprovante_url = COALESCE(${comprovante_url || null}, comprovante_url)
        WHERE id = ${id}
      `;
      return json({ ok: true });
    }

    // 3. Criar Conta a Pagar (com Rateio opcional)
    if (action === 'criar_conta_pagar') {
      const {
        descricao,
        fornecedor,
        cnpj_fornecedor,
        numero_nf,
        categoria_id,
        tipo_despesa,
        valor,
        data_vencimento,
        dias_lembrete,
        status,
        forma_pagamento,
        comprovante_url,
        rateios
      } = body;

      if (!descricao || !valor || !data_vencimento) {
        return json({ error: 'Informe descrição, valor e vencimento.' }, 400);
      }

      const valorNum = Number(valor);
      const isPago = status === 'pago';

      const rows = await sql`
        INSERT INTO contas_pagar (
          descricao, fornecedor, cnpj_fornecedor, numero_nf, categoria_id,
          tipo_despesa, valor, data_vencimento, data_pagamento,
          dias_lembrete, status, forma_pagamento, comprovante_url
        )
        VALUES (
          ${descricao},
          ${fornecedor || null},
          ${cnpj_fornecedor || null},
          ${numero_nf || null},
          ${categoria_id || null},
          ${tipo_despesa || 'variavel'},
          ${valorNum},
          ${data_vencimento},
          ${isPago ? data_vencimento : null},
          ${Number(dias_lembrete || 3)},
          ${isPago ? 'pago' : 'pendente'},
          ${forma_pagamento || null},
          ${comprovante_url || null}
        )
        RETURNING id
      `;
      const contaId = rows[0].id;

      if (Array.isArray(rateios) && rateios.length > 0) {
        for (const r of rateios) {
          const pct = Number(r.percentual || 0);
          if (pct > 0) {
            await sql`
              INSERT INTO contas_pagar_rateio (conta_pagar_id, centro_custo, percentual, valor)
              VALUES (${contaId}, ${r.centro_custo}, ${pct}, ${(valorNum * pct) / 100})
            `;
          }
        }
      }

      return json({ ok: true, id: contaId });
    }

    // 4. Baixar Conta a Pagar
    if (action === 'baixar_conta_pagar') {
      const { id, data_pagamento, forma_pagamento, comprovante_url } = body;
      await sql`
        UPDATE contas_pagar
        SET status = 'pago',
            data_pagamento = ${data_pagamento || new Date().toISOString().slice(0, 10)},
            forma_pagamento = COALESCE(${forma_pagamento || null}, forma_pagamento),
            comprovante_url = COALESCE(${comprovante_url || null}, comprovante_url)
        WHERE id = ${id}
      `;
      return json({ ok: true });
    }

    // 5. Movimentação Avulsa (Fluxo de Caixa)
    if (action === 'criar_avulsa') {
      const { tipo, descricao, valor, data_movimentacao } = body;
      if (!descricao || !valor) {
        return json({ error: 'Informe descrição e valor.' }, 400);
      }
      await sql`
        INSERT INTO movimentacoes_avulsas (tipo, descricao, valor, data_movimentacao)
        VALUES (
          ${tipo === 'receita' ? 'receita' : 'despesa'},
          ${descricao},
          ${Number(valor)},
          ${data_movimentacao || new Date().toISOString().slice(0, 10)}
        )
      `;
      return json({ ok: true });
    }

    // 6. Atualizar Saldo Inicial
    if (action === 'salvar_saldo_inicial') {
      if (!hasPerm(user, 'financeiro')) {
        return json({ error: 'Apenas usuários do Financeiro podem alterar o saldo inicial.' }, 403);
      }
      await sql`
        UPDATE configuracoes
        SET saldo_inicial = ${Number(body.saldo_inicial || 0)}
        WHERE id = 1
      `;
      return json({ ok: true });
    }

    return json({ error: 'Ação inválida.' }, 400);
  } catch (err) {
    return json({ error: 'Erro ao salvar no financeiro: ' + err.message }, 500);
  }
}
