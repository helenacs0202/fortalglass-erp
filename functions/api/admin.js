import { getSql, json, verifyAuth, hasPerm } from './_db.js';

export async function onRequestGet({ request, env }) {
  const user = await verifyAuth(request, env);
  if (!user) return json({ error: 'Não autorizado.' }, 401);
  if (!hasPerm(user, 'admin')) {
    return json({ error: 'Acesso exclusivo do Administrador (ADM).' }, 403);
  }

  try {
    const sql = getSql(env);

    const usuarios = await sql`
      SELECT id, nome, email, perfil, ativo, setor, cargo, permissoes, created_at
      FROM usuarios
      ORDER BY ativo ASC, created_at DESC
    `;

    const categorias = await sql`
      SELECT id, nome, tipo, cor_hex, ativo
      FROM categorias
      ORDER BY nome ASC
    `;

    const config = await sql`SELECT saldo_inicial FROM configuracoes WHERE id = 1`;

    return json({
      usuarios,
      categorias,
      saldo_inicial: Number(config[0]?.saldo_inicial || 0)
    });
  } catch (err) {
    return json({ error: 'Erro ao carregar administração: ' + err.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const user = await verifyAuth(request, env);
  if (!user) return json({ error: 'Não autorizado.' }, 401);

  try {
    const body = await request.json();
    const { action } = body;
    const sql = getSql(env);

    // Qualquer usuário logado pode atualizar a própria foto de perfil
    if (action === 'salvar_foto') {
      const { foto_perfil } = body;
      await sql`
        UPDATE usuarios SET foto_perfil = ${foto_perfil}
        WHERE id = ${user.id}
      `;
      return json({ ok: true });
    }

    // Ações abaixo exigem permissão ADM
    if (!hasPerm(user, 'admin')) {
      return json({ error: 'Acesso exclusivo do Administrador (ADM).' }, 403);
    }

    if (action === 'salvar_usuario') {
      const { id, nome, email, senha, setor, cargo, ativo, permissoes } = body;
      const loginNorm = (email || '').trim().toLowerCase();

      if (!nome || !loginNorm) {
        return json({ error: 'Informe o nome e o login de acesso.' }, 400);
      }

      const perms = {
        dashboard: true,
        financeiro: Boolean(permissoes?.financeiro),
        vendas: Boolean(permissoes?.vendas),
        producao: Boolean(permissoes?.producao),
        estoque: Boolean(permissoes?.estoque),
        rh: Boolean(permissoes?.rh),
        administrativo: Boolean(permissoes?.administrativo),
        admin: Boolean(permissoes?.admin)
      };

      const perfilDb = perms.admin ? 'admin' : 'funcionario';

      if (id) {
        if (senha && senha.trim()) {
          await sql`
            UPDATE usuarios SET
              nome = ${nome},
              email = ${loginNorm},
              senha_hash = ${senha.trim()},
              perfil = ${perfilDb},
              setor = ${setor || 'geral'},
              cargo = ${cargo || null},
              ativo = ${ativo !== false},
              permissoes = ${JSON.stringify(perms)}::jsonb
            WHERE id = ${id}
          `;
        } else {
          await sql`
            UPDATE usuarios SET
              nome = ${nome},
              email = ${loginNorm},
              perfil = ${perfilDb},
              setor = ${setor || 'geral'},
              cargo = ${cargo || null},
              ativo = ${ativo !== false},
              permissoes = ${JSON.stringify(perms)}::jsonb
            WHERE id = ${id}
          `;
        }
        return json({ ok: true });
      }

      if (!senha || !senha.trim()) {
        return json({ error: 'Defina uma senha para o novo usuário.' }, 400);
      }

      await sql`
        INSERT INTO usuarios (nome, email, senha_hash, perfil, setor, cargo, ativo, permissoes)
        VALUES (
          ${nome},
          ${loginNorm},
          ${senha.trim()},
          ${perfilDb},
          ${setor || 'geral'},
          ${cargo || null},
          ${ativo !== false},
          ${JSON.stringify(perms)}::jsonb
        )
      `;
      return json({ ok: true });
    }

    // Recusar / excluir solicitação pendente
    if (action === 'excluir_usuario') {
      const { id } = body;
      if (!id) return json({ error: 'ID inválido.' }, 400);
      await sql`DELETE FROM usuarios WHERE id = ${id} AND ativo = FALSE`;
      return json({ ok: true });
    }

    if (action === 'criar_categoria') {
      const { nome, tipo, cor_hex } = body;
      if (!nome) return json({ error: 'Informe o nome da categoria.' }, 400);
      await sql`
        INSERT INTO categorias (nome, tipo, cor_hex, ativo)
        VALUES (${nome}, ${tipo || 'despesa'}, ${cor_hex || '#034C53'}, TRUE)
      `;
      return json({ ok: true });
    }

    return json({ error: 'Ação inválida.' }, 400);
  } catch (err) {
    return json({ error: 'Erro ao salvar configuração: ' + err.message }, 500);
  }
}
