import { getSql, json, verifyAuth, hasPerm } from './_db.js';

export async function onRequestGet({ request, env }) {
  const user = await verifyAuth(request, env);
  if (!user) return json({ error: 'Não autorizado.' }, 401);

  const url = new URL(request.url);
  const mes = url.searchParams.get('mes') || new Date().toISOString().slice(0, 7);
  const apenasAlertas = url.searchParams.get('resumo_alertas') === '1';

  try {
    const sql = getSql(env);

    // Alertas de NRs vencidas ou vencendo em 30 dias (usado também no Dashboard)
    const nrsAlerta = await sql`
      SELECT
        d.id,
        d.titulo,
        d.codigo_nr,
        d.data_validade,
        c.nome AS colaborador_nome,
        (d.data_validade - CURRENT_DATE) AS dias_restantes
      FROM colaborador_documentos d
      JOIN colaboradores c ON c.id = d.colaborador_id
      WHERE c.status = 'ativo'
        AND d.data_validade IS NOT NULL
        AND d.data_validade <= CURRENT_DATE + INTERVAL '30 days'
      ORDER BY d.data_validade ASC
    `;

    if (apenasAlertas) {
      return json({
        nrs_alerta: nrsAlerta.map(n => ({
          ...n,
          dias_restantes: Number(n.dias_restantes)
        }))
      });
    }

    if (!hasPerm(user, 'rh') && !hasPerm(user, 'administrativo') && !hasPerm(user, 'producao')) {
      return json({ error: 'Acesso restrito ao setor de RH / Administrativo.' }, 403);
    }

    const colaboradores = await sql`
      SELECT *
      FROM colaboradores
      ORDER BY
        CASE WHEN status = 'ativo' THEN 0 ELSE 1 END,
        nome ASC
    `;

    const catalogoNrs = await sql`
      SELECT *
      FROM catalogo_nrs
      ORDER BY codigo ASC
    `;

    const documentos = await sql`
      SELECT
        d.*,
        c.nome AS colaborador_nome,
        c.cargo AS colaborador_cargo,
        CASE
          WHEN d.data_validade IS NULL THEN 'permanente'
          WHEN d.data_validade < CURRENT_DATE THEN 'vencido'
          WHEN d.data_validade <= CURRENT_DATE + INTERVAL '30 days' THEN 'vencendo'
          ELSE 'valido'
        END AS status_validade
      FROM colaborador_documentos d
      JOIN colaboradores c ON c.id = d.colaborador_id
      ORDER BY d.created_at DESC
      LIMIT 200
    `;

    const vales = await sql`
      SELECT
        v.*,
        c.nome AS colaborador_nome
      FROM colaborador_vales v
      JOIN colaboradores c ON c.id = v.colaborador_id
      WHERE v.mes_referencia = ${mes}
      ORDER BY v.data_lancamento DESC, v.created_at DESC
    `;

    const ocorrencias = await sql`
      SELECT
        o.*,
        c.nome AS colaborador_nome,
        c.setor AS colaborador_setor,
        c.cargo AS colaborador_cargo
      FROM colaborador_ocorrencias o
      JOIN colaboradores c ON c.id = o.colaborador_id
      ORDER BY o.data_ocorrencia DESC, o.created_at DESC
      LIMIT 200
    `;

    const produtividade = await sql`
      SELECT
        p.*,
        c.nome AS colaborador_nome,
        c.setor AS colaborador_setor
      FROM colaborador_produtividade p
      JOIN colaboradores c ON c.id = p.colaborador_id
      WHERE to_char(p.data_registro, 'YYYY-MM') = ${mes}
      ORDER BY p.data_registro DESC, p.created_at DESC
    `;

    const rankingProdutividade = await sql`
      SELECT
        c.id AS colaborador_id,
        c.nome,
        c.setor,
        c.cargo,
        COALESCE(SUM(p.quantidade_pecas), 0)::int AS total_pecas,
        COALESCE(SUM(p.metragem_m2), 0) AS total_m2,
        COALESCE(SUM(p.horas_trabalhadas), 0) AS total_horas,
        COALESCE(SUM(p.retrabalho_qtd), 0)::int AS total_retrabalho,
        COALESCE(ROUND(AVG(p.nota_qualidade), 1), 5.0) AS media_qualidade
      FROM colaboradores c
      LEFT JOIN colaborador_produtividade p
        ON p.colaborador_id = c.id
        AND to_char(p.data_registro, 'YYYY-MM') = ${mes}
      WHERE c.status = 'ativo'
      GROUP BY c.id, c.nome, c.setor, c.cargo
      ORDER BY total_m2 DESC, total_pecas DESC
    `;

    const certificados = await sql`
      SELECT
        cert.*,
        c.nome AS colaborador_nome,
        c.cpf AS colaborador_cpf,
        c.cargo AS colaborador_cargo
      FROM certificados_emitidos cert
      JOIN colaboradores c ON c.id = cert.colaborador_id
      ORDER BY cert.created_at DESC
      LIMIT 100
    `;

    // Cálculo prévio da folha do mês
    const vendasMes = await sql`
      SELECT
        vendedor_id,
        COALESCE(SUM(valor_total), 0) AS total_vendido
      FROM servicos
      WHERE vendedor_id IS NOT NULL
        AND to_char(created_at, 'YYYY-MM') = ${mes}
      GROUP BY vendedor_id
    `;
    const vendasMap = {};
    for (const v of vendasMes) {
      vendasMap[v.vendedor_id] = Number(v.total_vendido);
    }

    const folhaSalva = await sql`
      SELECT *
      FROM folha_pagamentos
      WHERE mes_referencia = ${mes}
    `;
    const folhaSalvaMap = {};
    for (const f of folhaSalva) {
      folhaSalvaMap[f.colaborador_id] = f;
    }

    const folhaCalculada = colaboradores
      .filter(c => c.status === 'ativo')
      .map(c => {
        const salvo = folhaSalvaMap[c.id];
        if (salvo) {
          return {
            colaborador_id: c.id,
            nome: c.nome,
            cargo: c.cargo,
            setor: c.setor,
            chave_pix: c.chave_pix,
            salario_base: Number(salvo.salario_base),
            total_comissoes: Number(salvo.total_comissoes),
            total_bonus: Number(salvo.total_bonus),
            total_vales_descontos: Number(salvo.total_vales_descontos),
            valor_liquido: Number(salvo.valor_liquido),
            status: salvo.status,
            data_pagamento: salvo.data_pagamento
          };
        }

        const salarioBase = Number(c.salario_base || 0);
        const vendido = vendasMap[c.id] || 0;
        let pctComissao = Number(c.comissao_faixa1_pct || 0);
        if (Number(c.meta_faixa2) > 0 && vendido >= Number(c.meta_faixa2)) {
          pctComissao = Number(c.comissao_faixa3_pct || pctComissao);
        } else if (Number(c.meta_faixa1) > 0 && vendido >= Number(c.meta_faixa1)) {
          pctComissao = Number(c.comissao_faixa2_pct || pctComissao);
        }
        const totalComissoes = (vendido * pctComissao) / 100;

        const valesColab = vales.filter(v => v.colaborador_id === c.id);
        const totalBonus = valesColab
          .filter(v => v.tipo === 'bonus')
          .reduce((acc, v) => acc + Number(v.valor), 0);
        const totalDescontos = valesColab
          .filter(v => v.tipo !== 'bonus')
          .reduce((acc, v) => acc + Number(v.valor), 0);

        const valorLiquido = salarioBase + totalComissoes + totalBonus - totalDescontos;

        return {
          colaborador_id: c.id,
          nome: c.nome,
          cargo: c.cargo,
          setor: c.setor,
          chave_pix: c.chave_pix,
          salario_base: salarioBase,
          total_comissoes: totalComissoes,
          total_bonus: totalBonus,
          total_vales_descontos: totalDescontos,
          valor_liquido: valorLiquido,
          status: 'aberto',
          data_pagamento: null
        };
      });

    return json({
      mes,
      colaboradores: colaboradores.map(c => ({
        ...c,
        salario_base: Number(c.salario_base || 0)
      })),
      catalogo_nrs: catalogoNrs,
      documentos,
      nrs_alerta: nrsAlerta.map(n => ({ ...n, dias_restantes: Number(n.dias_restantes) })),
      vales: vales.map(v => ({ ...v, valor: Number(v.valor) })),
      ocorrencias,
      produtividade: produtividade.map(p => ({
        ...p,
        metragem_m2: Number(p.metragem_m2),
        horas_trabalhadas: Number(p.horas_trabalhadas)
      })),
      ranking_produtividade: rankingProdutividade.map(r => ({
        ...r,
        total_m2: Number(r.total_m2),
        total_horas: Number(r.total_horas),
        media_qualidade: Number(r.media_qualidade)
      })),
      certificados,
      folha: folhaCalculada
    });
  } catch (err) {
    return json({ error: 'Erro ao carregar módulo RH: ' + err.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const user = await verifyAuth(request, env);
  if (!user) return json({ error: 'Não autorizado.' }, 401);

  try {
    const body = await request.json();
    const { action } = body;
    const sql = getSql(env);

    // 1. Cadastrar ou atualizar colaborador
    if (action === 'salvar_colaborador') {
      if (!hasPerm(user, 'rh') && !hasPerm(user, 'administrativo')) {
        return json({ error: 'Sem permissão no RH.' }, 403);
      }

      const {
        id, nome, cpf, rg, data_nascimento, telefone, email, endereco,
        cargo, setor, data_admissao, status, salario_base, chave_pix,
        comissao_faixa1_pct, comissao_faixa2_pct, comissao_faixa3_pct,
        meta_faixa1, meta_faixa2, observacoes
      } = body;

      if (!nome || !cargo) {
        return json({ error: 'Nome e cargo são obrigatórios.' }, 400);
      }

      if (id) {
        await sql`
          UPDATE colaboradores SET
            nome = ${nome},
            cpf = ${cpf || null},
            rg = ${rg || null},
            data_nascimento = ${data_nascimento || null},
            telefone = ${telefone || null},
            email = ${email || null},
            endereco = ${endereco || null},
            cargo = ${cargo},
            setor = ${setor || 'producao'},
            data_admissao = ${data_admissao || null},
            status = ${status || 'ativo'},
            salario_base = ${Number(salario_base || 0)},
            chave_pix = ${chave_pix || null},
            comissao_faixa1_pct = ${Number(comissao_faixa1_pct || 0)},
            comissao_faixa2_pct = ${Number(comissao_faixa2_pct || 0)},
            comissao_faixa3_pct = ${Number(comissao_faixa3_pct || 0)},
            meta_faixa1 = ${Number(meta_faixa1 || 0)},
            meta_faixa2 = ${Number(meta_faixa2 || 0)},
            observacoes = ${observacoes || null}
          WHERE id = ${id}
        `;
        return json({ ok: true, id });
      }

      const rows = await sql`
        INSERT INTO colaboradores (
          nome, cpf, rg, data_nascimento, telefone, email, endereco,
          cargo, setor, data_admissao, status, salario_base, chave_pix,
          comissao_faixa1_pct, comissao_faixa2_pct, comissao_faixa3_pct,
          meta_faixa1, meta_faixa2, observacoes
        )
        VALUES (
          ${nome}, ${cpf || null}, ${rg || null}, ${data_nascimento || null},
          ${telefone || null}, ${email || null}, ${endereco || null},
          ${cargo}, ${setor || 'producao'}, ${data_admissao || null},
          ${status || 'ativo'}, ${Number(salario_base || 0)}, ${chave_pix || null},
          ${Number(comissao_faixa1_pct || 0)}, ${Number(comissao_faixa2_pct || 0)},
          ${Number(comissao_faixa3_pct || 0)}, ${Number(meta_faixa1 || 0)},
          ${Number(meta_faixa2 || 0)}, ${observacoes || null}
        )
        RETURNING id
      `;
      return json({ ok: true, id: rows[0].id });
    }

    // 2. Registrar Documento ou NR
    if (action === 'criar_documento') {
      if (!hasPerm(user, 'rh') && !hasPerm(user, 'administrativo')) {
        return json({ error: 'Sem permissão no RH.' }, 403);
      }

      const {
        colaborador_id, nr_id, tipo_documento, titulo,
        codigo_nr, data_emissao, data_validade, arquivo_url, observacoes
      } = body;

      if (!colaborador_id || !titulo) {
        return json({ error: 'Selecione o colaborador e o título do documento.' }, 400);
      }

      let validadeFinal = data_validade || null;
      let codigoNrFinal = codigo_nr || null;

      if (nr_id && !validadeFinal) {
        const nrRows = await sql`SELECT codigo, validade_meses FROM catalogo_nrs WHERE id = ${nr_id}`;
        if (nrRows.length > 0) {
          codigoNrFinal = codigoNrFinal || nrRows[0].codigo;
          const baseDate = data_emissao ? new Date(data_emissao + 'T12:00:00') : new Date();
          baseDate.setMonth(baseDate.getMonth() + Number(nrRows[0].validade_meses || 12));
          validadeFinal = baseDate.toISOString().slice(0, 10);
        }
      }

      await sql`
        INSERT INTO colaborador_documentos (
          colaborador_id, nr_id, tipo_documento, titulo, codigo_nr,
          data_emissao, data_validade, arquivo_url, observacoes
        )
        VALUES (
          ${colaborador_id},
          ${nr_id || null},
          ${tipo_documento || 'documento'},
          ${titulo},
          ${codigoNrFinal},
          ${data_emissao || new Date().toISOString().slice(0, 10)},
          ${validadeFinal},
          ${arquivo_url || null},
          ${observacoes || null}
        )
      `;
      return json({ ok: true });
    }

    // 3. Lançar Vale / Adiantamento / Bônus
    if (action === 'criar_vale') {
      if (!hasPerm(user, 'rh') && !hasPerm(user, 'administrativo') && !hasPerm(user, 'financeiro')) {
        return json({ error: 'Sem permissão para lançar vales.' }, 403);
      }

      const { colaborador_id, tipo, descricao, valor, data_lancamento, mes_referencia, comprovante_url } = body;
      if (!colaborador_id || !descricao || !valor) {
        return json({ error: 'Preencha colaborador, descrição e valor.' }, 400);
      }

      const dataLanc = data_lancamento || new Date().toISOString().slice(0, 10);
      const mesRef = mes_referencia || dataLanc.slice(0, 7);

      await sql`
        INSERT INTO colaborador_vales (
          colaborador_id, tipo, descricao, valor, data_lancamento, mes_referencia, comprovante_url
        )
        VALUES (
          ${colaborador_id},
          ${tipo || 'adiantamento'},
          ${descricao},
          ${Number(valor)},
          ${dataLanc},
          ${mesRef},
          ${comprovante_url || null}
        )
      `;
      return json({ ok: true });
    }

    // 4. Registrar Ocorrência Comportamental
    if (action === 'criar_ocorrencia') {
      if (!hasPerm(user, 'rh') && !hasPerm(user, 'administrativo') && !hasPerm(user, 'producao')) {
        return json({ error: 'Sem permissão para registrar ocorrências.' }, 403);
      }

      const { colaborador_id, data_ocorrencia, tipo, classificacao, descricao, arquivo_url } = body;
      if (!colaborador_id || !descricao) {
        return json({ error: 'Selecione o colaborador e descreva a ocorrência.' }, 400);
      }

      await sql`
        INSERT INTO colaborador_ocorrencias (
          colaborador_id, data_ocorrencia, tipo, classificacao, descricao, registrado_por, arquivo_url
        )
        VALUES (
          ${colaborador_id},
          ${data_ocorrencia || new Date().toISOString().slice(0, 10)},
          ${tipo || 'observacao'},
          ${classificacao || 'neutra'},
          ${descricao},
          ${user.nome},
          ${arquivo_url || null}
        )
      `;
      return json({ ok: true });
    }

    // 5. Lançar Produtividade
    if (action === 'criar_produtividade') {
      if (!hasPerm(user, 'rh') && !hasPerm(user, 'producao') && !hasPerm(user, 'administrativo')) {
        return json({ error: 'Sem permissão para apontar produtividade.' }, 403);
      }

      const {
        colaborador_id, etapa_producao, data_registro,
        quantidade_pecas, metragem_m2, horas_trabalhadas,
        retrabalho_qtd, nota_qualidade, observacoes
      } = body;

      if (!colaborador_id || !etapa_producao) {
        return json({ error: 'Selecione o colaborador e a etapa de produção.' }, 400);
      }

      await sql`
        INSERT INTO colaborador_produtividade (
          colaborador_id, etapa_producao, data_registro,
          quantidade_pecas, metragem_m2, horas_trabalhadas,
          retrabalho_qtd, nota_qualidade, observacoes
        )
        VALUES (
          ${colaborador_id},
          ${etapa_producao},
          ${data_registro || new Date().toISOString().slice(0, 10)},
          ${Number(quantidade_pecas || 0)},
          ${Number(metragem_m2 || 0)},
          ${Number(horas_trabalhadas || 0)},
          ${Number(retrabalho_qtd || 0)},
          ${Number(nota_qualidade || 5)},
          ${observacoes || null}
        )
      `;
      return json({ ok: true });
    }

    // 6. Gerar Certificado Oficial FortalGlass (e atualizar NR do colaborador)
    if (action === 'gerar_certificado') {
      if (!hasPerm(user, 'rh') && !hasPerm(user, 'administrativo')) {
        return json({ error: 'Sem permissão para emitir certificados.' }, 403);
      }

      const {
        colaborador_id, nr_id, titulo_curso, carga_horaria,
        data_conclusao, validade_meses, instrutor_nome,
        instrutor_registro, conteudo_programatico
      } = body;

      if (!colaborador_id || !titulo_curso || !instrutor_nome) {
        return json({ error: 'Informe colaborador, curso/NR e nome do instrutor.' }, 400);
      }

      const dtConc = data_conclusao || new Date().toISOString().slice(0, 10);
      let dataValidade = null;
      let codigoNr = null;

      if (nr_id) {
        const nrRows = await sql`SELECT codigo, validade_meses FROM catalogo_nrs WHERE id = ${nr_id}`;
        if (nrRows.length > 0) {
          codigoNr = nrRows[0].codigo;
          const mesesVal = Number(validade_meses || nrRows[0].validade_meses || 12);
          const dt = new Date(dtConc + 'T12:00:00');
          dt.setMonth(dt.getMonth() + mesesVal);
          dataValidade = dt.toISOString().slice(0, 10);
        }
      } else if (Number(validade_meses) > 0) {
        const dt = new Date(dtConc + 'T12:00:00');
        dt.setMonth(dt.getMonth() + Number(validade_meses));
        dataValidade = dt.toISOString().slice(0, 10);
      }

      const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
      const codigoValidacao = `FG-${codigoNr || 'CERT'}-${dtConc.slice(0, 4)}-${rand}`;

      const certRows = await sql`
        INSERT INTO certificados_emitidos (
          codigo_validacao, colaborador_id, nr_id, titulo_curso,
          carga_horaria, data_conclusao, data_validade,
          instrutor_nome, instrutor_registro, conteudo_programatico
        )
        VALUES (
          ${codigoValidacao},
          ${colaborador_id},
          ${nr_id || null},
          ${titulo_curso},
          ${Number(carga_horaria || 8)},
          ${dtConc},
          ${dataValidade},
          ${instrutor_nome},
          ${instrutor_registro || null},
          ${conteudo_programatico || null}
        )
        RETURNING *
      `;

      // Atualiza automaticamente a ficha de documentos/NRs do colaborador
      await sql`
        INSERT INTO colaborador_documentos (
          colaborador_id, nr_id, tipo_documento, titulo, codigo_nr,
          data_emissao, data_validade, observacoes
        )
        VALUES (
          ${colaborador_id},
          ${nr_id || null},
          'nr',
          ${titulo_curso},
          ${codigoNr},
          ${dtConc},
          ${dataValidade},
          ${'Certificado emitido pelo sistema · Código: ' + codigoValidacao}
        )
      `;

      const colabRows = await sql`SELECT nome, cpf, cargo FROM colaboradores WHERE id = ${colaborador_id}`;

      return json({
        ok: true,
        certificado: {
          ...certRows[0],
          colaborador_nome: colabRows[0]?.nome || '',
          colaborador_cpf: colabRows[0]?.cpf || '',
          colaborador_cargo: colabRows[0]?.cargo || ''
        }
      });
    }

    // 7. Fechar / Pagar Folha Individual do Mês
    if (action === 'fechar_folha') {
      if (!hasPerm(user, 'rh') && !hasPerm(user, 'financeiro')) {
        return json({ error: 'Sem permissão para fechar folha de pagamento.' }, 403);
      }

      const {
        colaborador_id, mes_referencia, salario_base, total_comissoes,
        total_bonus, total_vales_descontos, valor_liquido, lancar_contas_pagar
      } = body;

      const hoje = new Date().toISOString().slice(0, 10);

      await sql`
        INSERT INTO folha_pagamentos (
          colaborador_id, mes_referencia, salario_base, total_comissoes,
          total_bonus, total_vales_descontos, valor_liquido, status, data_pagamento
        )
        VALUES (
          ${colaborador_id}, ${mes_referencia}, ${Number(salario_base || 0)},
          ${Number(total_comissoes || 0)}, ${Number(total_bonus || 0)},
          ${Number(total_vales_descontos || 0)}, ${Number(valor_liquido || 0)},
          'pago', ${hoje}
        )
        ON CONFLICT (colaborador_id, mes_referencia) DO UPDATE SET
          salario_base = EXCLUDED.salario_base,
          total_comissoes = EXCLUDED.total_comissoes,
          total_bonus = EXCLUDED.total_bonus,
          total_vales_descontos = EXCLUDED.total_vales_descontos,
          valor_liquido = EXCLUDED.valor_liquido,
          status = 'pago',
          data_pagamento = ${hoje}
      `;

      await sql`
        UPDATE colaborador_vales
        SET descontado = TRUE
        WHERE colaborador_id = ${colaborador_id} AND mes_referencia = ${mes_referencia}
      `;

      if (lancar_contas_pagar && Number(valor_liquido) > 0) {
        const colab = await sql`SELECT nome FROM colaboradores WHERE id = ${colaborador_id}`;
        const cat = await sql`SELECT id FROM categorias WHERE nome ILIKE '%Folha%' LIMIT 1`;
        await sql`
          INSERT INTO contas_pagar (
            descricao, fornecedor, categoria_id, tipo_despesa, valor,
            data_vencimento, data_pagamento, status, forma_pagamento
          )
          VALUES (
            ${'Folha ' + mes_referencia + ' · ' + (colab[0]?.nome || 'Colaborador')},
            ${colab[0]?.nome || 'Colaborador'},
            ${cat[0]?.id || null},
            'fixa',
            ${Number(valor_liquido)},
            ${hoje},
            ${hoje},
            'pago',
            'PIX'
          )
        `;
      }

      return json({ ok: true });
    }

    return json({ error: 'Ação inválida no RH.' }, 400);
  } catch (err) {
    return json({ error: 'Erro no RH: ' + err.message }, 500);
  }
}
