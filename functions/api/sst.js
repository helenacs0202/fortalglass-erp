import { neon } from '@neondatabase/serverless';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function getUserNameFromAuth(request) {
  try {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token || !token.includes('.')) return 'Gestor / ADM';
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.nome || payload.email || 'Gestor / ADM';
  } catch {
    return 'Gestor / ADM';
  }
}

async function registrarAuditoria(sql, usuario, acao, detalhes) {
  await sql`
    INSERT INTO auditoria_admin (usuario_nome, acao, detalhes)
    VALUES (${usuario}, ${acao}, ${detalhes})
  `.catch(() => {});
}

function calcularStatusData(dataValidade) {
  if (!dataValidade) return 'valido';
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const val = new Date(String(dataValidade).slice(0, 10) + 'T12:00:00');
  const diffDias = Math.ceil((val - hoje) / (1000 * 60 * 60 * 24));
  if (diffDias < 0) return 'vencido';
  if (diffDias <= 30) return 'vencendo';
  return 'valido';
}

export async function onRequest(context) {
  const { request, env } = context;
  const sql = neon(env.DATABASE_URL);
  const url = new URL(request.url);

  try {
    if (request.method === 'GET') {
      const action = url.searchParams.get('action') || 'overview';

      const [colaboradores, catalogoNrs, matrizNrs, asos, tiposDocRh, categoriasAcervo, acervo, auditoria] =
        await Promise.all([
          sql`SELECT id, nome, cpf, cargo, setor, status FROM colaboradores ORDER BY nome ASC`,
          sql`SELECT * FROM catalogo_nrs WHERE COALESCE(ativo, TRUE) = TRUE ORDER BY codigo ASC, nome ASC`,
          sql`
            SELECT m.id, m.setor, m.nr_id, m.obrigatorio, n.codigo AS nr_codigo, n.nome AS nr_nome, n.validade_meses
            FROM sst_matriz_nrs m
            JOIN catalogo_nrs n ON n.id = m.nr_id
            ORDER BY m.setor ASC, n.codigo ASC
          `,
          sql`
            SELECT a.*, c.nome AS colaborador_nome, c.setor AS colaborador_setor, c.status AS colaborador_status
            FROM sst_asos a
            JOIN colaboradores c ON c.id = a.colaborador_id
            ORDER BY a.data_exame DESC, a.created_at DESC
          `,
          sql`SELECT * FROM tipos_documento_rh ORDER BY obrigatorio DESC, nome ASC`,
          sql`SELECT * FROM categorias_acervo ORDER BY nome ASC`,
          sql`
            SELECT a.*, c.nome AS colaborador_nome
            FROM acervo_digital a
            LEFT JOIN colaboradores c ON c.id = a.colaborador_id
            ORDER BY a.created_at DESC
            LIMIT 200
          `,
          sql`SELECT * FROM auditoria_admin ORDER BY created_at DESC LIMIT 30`
        ]);

      // Calcula status de cada ASO
      const asosEnriquecidos = asos.map(a => ({
        ...a,
        status_validade: a.tipo_exame === 'demissional' ? 'concluido' : calcularStatusData(a.data_validade)
      }));

      // Calcula ASOs pendentes ("a fazer" e "vencidos")
      const asosPendentes = [];
      for (const colab of colaboradores) {
        const asosColab = asosEnriquecidos.filter(a => a.colaborador_id === colab.id);
        if (colab.status === 'ativo') {
          if (asosColab.length === 0) {
            asosPendentes.push({
              colaborador_id: colab.id,
              colaborador_nome: colab.nome,
              setor: colab.setor || 'geral',
              situacao: 'a_fazer',
              motivo: 'ASO Admissional pendente (nunca realizado)',
              data_validade: null
            });
          } else {
            const ultimo = asosColab[0];
            if (ultimo.status_validade === 'vencido' || ultimo.status_validade === 'vencendo') {
              asosPendentes.push({
                colaborador_id: colab.id,
                colaborador_nome: colab.nome,
                setor: colab.setor || 'geral',
                situacao: ultimo.status_validade,
                motivo: `ASO ${ultimo.tipo_exame} ${ultimo.status_validade === 'vencido' ? 'vencido' : 'vencendo em breve'}`,
                data_validade: ultimo.data_validade
              });
            }
          }
        } else if (colab.status === 'inativo') {
          const temDemissional = asosColab.some(a => a.tipo_exame === 'demissional');
          if (!temDemissional) {
            asosPendentes.push({
              colaborador_id: colab.id,
              colaborador_nome: colab.nome,
              setor: colab.setor || 'geral',
              situacao: 'a_fazer',
              motivo: 'ASO Demissional pendente',
              data_validade: null
            });
          }
        }
      }

      if (action === 'resumo_alertas') {
        return json({
          asos_pendentes: asosPendentes,
          matriz_nrs: matrizNrs,
          catalogo_nrs: catalogoNrs
        });
      }

      return json({
        colaboradores,
        catalogo_nrs: catalogoNrs,
        matriz_nrs: matrizNrs,
        asos: asosEnriquecidos,
        asos_pendentes: asosPendentes,
        tipos_doc_rh: tiposDocRh,
        categorias_acervo: categoriasAcervo,
        acervo,
        auditoria
      });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const usuarioNome = getUserNameFromAuth(request);

      // --- ASOs ---
      if (body.action === 'salvar_aso') {
        const [row] = await sql`
          INSERT INTO sst_asos (
            colaborador_id, tipo_exame, resultado, data_exame, data_validade, medico_clinica, observacoes, arquivo_url
          )
          VALUES (
            ${body.colaborador_id},
            ${body.tipo_exame || 'periodico'},
            ${body.resultado || 'apto'},
            ${body.data_exame},
            ${body.data_validade || null},
            ${body.medico_clinica || null},
            ${body.observacoes || null},
            ${body.arquivo_url || null}
          )
          RETURNING *
        `;
        return json({ ok: true, aso: row });
      }

      if (body.action === 'excluir_aso') {
        await sql`DELETE FROM sst_asos WHERE id = ${body.id}`;
        return json({ ok: true });
      }

      // --- AUTONOMIA ADM: NORMAS (NRs) ---
      if (body.action === 'salvar_nr') {
        if (body.id) {
          await sql`
            UPDATE catalogo_nrs
            SET codigo = ${body.codigo},
                nome = ${body.nome},
                validade_meses = ${Number(body.validade_meses || 12)},
                carga_horaria_padrao = ${Number(body.carga_horaria_padrao || 8)},
                conteudo_programatico = ${body.conteudo_programatico || null}
            WHERE id = ${body.id}
          `;
          await registrarAuditoria(sql, usuarioNome, 'Editou Norma/Treinamento', `${body.codigo} - ${body.nome}`);
        } else {
          await sql`
            INSERT INTO catalogo_nrs (codigo, nome, validade_meses, carga_horaria_padrao, conteudo_programatico)
            VALUES (
              ${body.codigo},
              ${body.nome},
              ${Number(body.validade_meses || 12)},
              ${Number(body.carga_horaria_padrao || 8)},
              ${body.conteudo_programatico || null}
            )
          `;
          await registrarAuditoria(sql, usuarioNome, 'Criou Norma/Treinamento', `${body.codigo} - ${body.nome}`);
        }
        return json({ ok: true });
      }

      if (body.action === 'excluir_nr') {
        const [nr] = await sql`SELECT codigo, nome FROM catalogo_nrs WHERE id = ${body.id}`;
        await sql`DELETE FROM catalogo_nrs WHERE id = ${body.id}`;
        await registrarAuditoria(sql, usuarioNome, 'Excluiu Norma/Treinamento', nr ? `${nr.codigo} - ${nr.nome}` : body.id);
        return json({ ok: true });
      }

      // --- AUTONOMIA ADM: MATRIZ DE OBRIGATORIEDADE POR SETOR ---
      if (body.action === 'salvar_matriz_nr') {
        await sql`
          INSERT INTO sst_matriz_nrs (setor, nr_id, obrigatorio)
          VALUES (${body.setor}, ${body.nr_id}, TRUE)
          ON CONFLICT (setor, nr_id) DO NOTHING
        `;
        await registrarAuditoria(sql, usuarioNome, 'Vinculou NR obrigatória ao setor', `Setor: ${body.setor}`);
        return json({ ok: true });
      }

      if (body.action === 'excluir_matriz_nr') {
        await sql`DELETE FROM sst_matriz_nrs WHERE id = ${body.id}`;
        await registrarAuditoria(sql, usuarioNome, 'Removeu obrigatoriedade de NR do setor', `ID: ${body.id}`);
        return json({ ok: true });
      }

      // --- AUTONOMIA ADM: CHECKLIST DOCUMENTOS PRONTUÁRIO RH ---
      if (body.action === 'salvar_tipo_doc_rh') {
        await sql`
          INSERT INTO tipos_documento_rh (nome, obrigatorio)
          VALUES (${body.nome}, ${Boolean(body.obrigatorio)})
          ON CONFLICT (nome) DO UPDATE SET obrigatorio = EXCLUDED.obrigatorio
        `;
        await registrarAuditoria(sql, usuarioNome, 'Adicionou item de prontuário RH', body.nome);
        return json({ ok: true });
      }

      if (body.action === 'excluir_tipo_doc_rh') {
        await sql`DELETE FROM tipos_documento_rh WHERE id = ${body.id}`;
        await registrarAuditoria(sql, usuarioNome, 'Excluiu item de prontuário RH', body.id);
        return json({ ok: true });
      }

      // --- AUTONOMIA ADM: CATEGORIAS DO ACERVO & CATEGORIAS FINANCEIRAS ---
      if (body.action === 'salvar_categoria_acervo') {
        await sql`
          INSERT INTO categorias_acervo (nome)
          VALUES (${body.nome})
          ON CONFLICT (nome) DO NOTHING
        `;
        await registrarAuditoria(sql, usuarioNome, 'Criou categoria de Acervo Digital', body.nome);
        return json({ ok: true });
      }

      if (body.action === 'excluir_categoria_acervo') {
        await sql`DELETE FROM categorias_acervo WHERE id = ${body.id}`;
        await registrarAuditoria(sql, usuarioNome, 'Excluiu categoria de Acervo Digital', body.id);
        return json({ ok: true });
      }

      if (body.action === 'excluir_categoria_financeira') {
        await sql`DELETE FROM categorias WHERE id = ${body.id}`;
        await registrarAuditoria(sql, usuarioNome, 'Excluiu categoria financeira', body.id);
        return json({ ok: true });
      }

      // --- ACERVO DIGITAL (DIGITALIZAÇÃO DE PAPEL COM OCR) ---
      if (body.action === 'salvar_acervo_item') {
        const [item] = await sql`
          INSERT INTO acervo_digital (
            titulo, categoria, pasta_fisica, data_documento, colaborador_id, nome_arquivo, arquivo_url, texto_ocr, criado_por
          )
          VALUES (
            ${body.titulo},
            ${body.categoria || 'Geral'},
            ${body.pasta_fisica || null},
            ${body.data_documento || null},
            ${body.colaborador_id || null},
            ${body.nome_arquivo || null},
            ${body.arquivo_url},
            ${body.texto_ocr || ''},
            ${usuarioNome}
          )
          RETURNING *
        `;
        return json({ ok: true, item });
      }

      if (body.action === 'excluir_acervo_item') {
        await sql`DELETE FROM acervo_digital WHERE id = ${body.id}`;
        await registrarAuditoria(sql, usuarioNome, 'Excluiu arquivo do Acervo Digital', body.id);
        return json({ ok: true });
      }

      return json({ error: 'Ação não reconhecida em /api/sst.' }, 400);
    }

    return json({ error: 'Método não permitido.' }, 405);
  } catch (err) {
    return json({ error: 'Erro no módulo SST/Acervo: ' + err.message }, 500);
  }
}
