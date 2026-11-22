import { getSql, json, verifyAuth } from './_db.js';

export async function onRequestGet({ request, env }) {
  const user = await verifyAuth(request, env);
  if (!user) {
    return json({ error: 'Não autorizado.' }, 401);
  }

  try {
    const sql = getSql(env);

    const configRows = await sql`SELECT saldo_inicial FROM configuracoes WHERE id = 1`;
    const saldoInicial = Number(configRows[0]?.saldo_inicial || 0);

    const parcelasStats = await sql`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'pago' THEN valor ELSE 0 END), 0) AS total_recebido,
        COALESCE(SUM(CASE WHEN status = 'pendente' THEN valor ELSE 0 END), 0) AS total_a_receber,
        COALESCE(SUM(CASE WHEN status = 'pendente' AND data_vencimento <= CURRENT_DATE + INTERVAL '30 days' THEN valor ELSE 0 END), 0) AS receber_30d,
        COUNT(CASE WHEN status = 'pendente' AND tipo_cobranca = 'mediante_nf' THEN 1 END)::int AS nf_pendente_qtd,
        COALESCE(SUM(CASE WHEN status = 'pendente' AND tipo_cobranca = 'mediante_nf' THEN valor ELSE 0 END), 0) AS nf_pendente_valor
      FROM servico_parcelas
    `;

    const avulsasStats = await sql`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'receita' THEN valor ELSE 0 END), 0) AS receitas_avulsas,
        COALESCE(SUM(CASE WHEN tipo = 'despesa' THEN valor ELSE 0 END), 0) AS despesas_avulsas
      FROM movimentacoes_avulsas
    `;

    const pagarStats = await sql`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'pago' THEN valor ELSE 0 END), 0) AS total_pago,
        COALESCE(SUM(CASE WHEN status = 'pendente' THEN valor ELSE 0 END), 0) AS total_a_pagar,
        COALESCE(SUM(CASE WHEN status = 'pendente' AND data_vencimento <= CURRENT_DATE + INTERVAL '30 days' THEN valor ELSE 0 END), 0) AS pagar_30d,
        COUNT(CASE WHEN status = 'pendente' AND data_vencimento <= CURRENT_DATE + (COALESCE(dias_lembrete, 3) * INTERVAL '1 day') THEN 1 END)::int AS proximas_qtd,
        COALESCE(SUM(CASE WHEN status = 'pendente' AND data_vencimento <= CURRENT_DATE + (COALESCE(dias_lembrete, 3) * INTERVAL '1 day') THEN valor ELSE 0 END), 0) AS proximas_valor
      FROM contas_pagar
    `;

    const totalRecebido = Number(parcelasStats[0].total_recebido) + Number(avulsasStats[0].receitas_avulsas);
    const totalPago = Number(pagarStats[0].total_pago) + Number(avulsasStats[0].despesas_avulsas);
    const saldoAtual = saldoInicial + totalRecebido - totalPago;

    const totalAReceber = Number(parcelasStats[0].total_a_receber);
    const totalAPagar = Number(pagarStats[0].total_a_pagar);
    const receber30d = Number(parcelasStats[0].receber_30d);
    const pagar30d = Number(pagarStats[0].pagar_30d);
    const projecao30d = saldoAtual + receber30d - pagar30d;

    const fluxoRows = await sql`
      WITH meses AS (
        SELECT generate_series(
          date_trunc('month', CURRENT_DATE) - INTERVAL '5 months',
          date_trunc('month', CURRENT_DATE),
          '1 month'::interval
        ) AS mes
      ),
      entradas AS (
        SELECT date_trunc('month', COALESCE(data_pagamento, data_vencimento)) AS mes, SUM(valor) AS total
        FROM servico_parcelas
        WHERE status = 'pago'
        GROUP BY 1
        UNION ALL
        SELECT date_trunc('month', data_movimentacao) AS mes, SUM(valor) AS total
        FROM movimentacoes_avulsas
        WHERE tipo = 'receita'
        GROUP BY 1
      ),
      saidas AS (
        SELECT date_trunc('month', COALESCE(data_pagamento, data_vencimento)) AS mes, SUM(valor) AS total
        FROM contas_pagar
        WHERE status = 'pago'
        GROUP BY 1
        UNION ALL
        SELECT date_trunc('month', data_movimentacao) AS mes, SUM(valor) AS total
        FROM movimentacoes_avulsas
        WHERE tipo = 'despesa'
        GROUP BY 1
      )
      SELECT
        to_char(m.mes, 'Mon') AS label,
        COALESCE((SELECT SUM(total) FROM entradas e WHERE e.mes = m.mes), 0) AS entradas,
        COALESCE((SELECT SUM(total) FROM saidas s WHERE s.mes = m.mes), 0) AS saidas
      FROM meses m
      ORDER BY m.mes ASC
    `;

    const categoriasRows = await sql`
      SELECT
        COALESCE(c.nome, 'Sem Categoria') AS nome,
        COALESCE(c.cor_hex, '#3B82F6') AS cor,
        SUM(cp.valor) AS total
      FROM contas_pagar cp
      LEFT JOIN categorias c ON c.id = cp.categoria_id
      WHERE date_trunc('month', cp.data_vencimento) = date_trunc('month', CURRENT_DATE)
      GROUP BY 1, 2
      ORDER BY total DESC
      LIMIT 5
    `;

    const recentesRows = await sql`
      (
        SELECT
          s.id::text,
          'servico' AS origem,
          s.cliente_nome || ' · ' || s.descricao AS titulo,
          s.valor_total AS valor,
          s.status_producao AS status,
          s.created_at
        FROM servicos s
        ORDER BY s.created_at DESC
        LIMIT 3
      )
      UNION ALL
      (
        SELECT
          cp.id::text,
          'despesa' AS origem,
          cp.descricao AS titulo,
          cp.valor AS valor,
          cp.status AS status,
          cp.created_at
        FROM contas_pagar cp
        ORDER BY cp.created_at DESC
        LIMIT 3
      )
      ORDER BY created_at DESC
      LIMIT 5
    `;

    return json({
      kpis: {
        saldo_inicial: saldoInicial,
        saldo_atual: saldoAtual,
        projecao_30_dias: projecao30d,
        total_a_receber: totalAReceber,
        total_a_pagar: totalAPagar,
        nf_pendente_qtd: parcelasStats[0].nf_pendente_qtd,
        nf_pendente_valor: Number(parcelasStats[0].nf_pendente_valor)
      },
      alertas: {
        projecao_negativa: projecao30d < 0,
        contas_proximas_qtd: pagarStats[0].proximas_qtd,
        contas_proximas_valor: Number(pagarStats[0].proximas_valor),
        nf_pendente_qtd: parcelasStats[0].nf_pendente_qtd,
        nf_pendente_valor: Number(parcelasStats[0].nf_pendente_valor)
      },
      fluxo_mensal: fluxoRows.map(r => ({
        label: r.label,
        entradas: Number(r.entradas),
        saidas: Number(r.saidas)
      })),
      maiores_categorias: categoriasRows.map(r => ({
        nome: r.nome,
        cor: r.cor,
        total: Number(r.total)
      })),
      atividades_recentes: recentesRows.map(r => ({
        id: r.id,
        origem: r.origem,
        titulo: r.titulo,
        valor: Number(r.valor),
        status: r.status
      }))
    });
  } catch (err) {
    return json({ error: 'Erro ao carregar dashboard: ' + err.message }, 500);
  }
}
