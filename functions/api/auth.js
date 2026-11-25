import { getSql, json, signToken, verifyAuth } from './_db.js';

export async function onRequestGet({ request, env }) {
  const user = await verifyAuth(request, env);
  if (!user) {
    return json({ error: 'Sessão inválida ou expirada.' }, 401);
  }
  return json({ user });
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const sql = getSql(env);

    // === NOVA AÇÃO: SOLICITAÇÃO DE CONTA ===
    if (body.action === 'solicitar_cadastro') {
      const nome = (body.nome || '').trim();
      const cargo = (body.cargo || '').trim();
      const setor = (body.setor || 'geral').trim();
      const email = (body.email || '').trim().toLowerCase();
      const senha = (body.senha || '').trim();

      if (!nome || !cargo || !email || !senha) {
        return json({ error: 'Preencha nome, cargo, login e senha.' }, 400);
      }

      const existe = await sql`
        SELECT id FROM usuarios WHERE LOWER(email) = ${email} LIMIT 1
      `;
      if (existe.length > 0) {
        return json({ error: 'Este login de acesso já está cadastrado.' }, 409);
      }

      const permsIniciais = {
        dashboard: true,
        financeiro: false,
        vendas: false,
        producao: false,
        estoque: false,
        rh: false,
        administrativo: false,
        admin: false
      };

      // Cria com ativo = FALSE (aguardando aprovação do Gean)
      await sql`
        INSERT INTO usuarios (nome, email, senha_hash, perfil, setor, cargo, ativo, permissoes)
        VALUES (
          ${nome},
          ${email},
          ${senha},
          'funcionario',
          ${setor},
          ${cargo},
          FALSE,
          ${JSON.stringify(permsIniciais)}::jsonb
        )
      `;

      return json({
        ok: true,
        message: 'Solicitação enviada com sucesso! Aguarde a aprovação e liberação de acessos pelo administrador.'
      });
    }

    // === LOGIN NORMAL ===
    const email = (body.email || '').trim().toLowerCase();
    const senha = (body.senha || '').trim();

    if (!email || !senha) {
      return json({ error: 'Informe login e senha.' }, 400);
    }

    const rows = await sql`
      SELECT id, nome, email, senha_hash, perfil, ativo, setor, cargo, foto_perfil, permissoes
      FROM usuarios
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return json({ error: 'Usuário não encontrado.' }, 401);
    }

    const usuario = rows[0];

    if (usuario.senha_hash !== senha) {
      return json({ error: 'Senha incorreta.' }, 401);
    }

    if (!usuario.ativo) {
      return json({
        error: 'Sua conta está pendente de aprovação ou desativada. Aguarde o administrador (Gean) liberar seus acessos.'
      }, 403);
    }

    const defaultPerms = usuario.perfil === 'admin'
      ? { dashboard: true, financeiro: true, vendas: true, producao: true, estoque: true, rh: true, administrativo: true, admin: true }
      : { dashboard: true, financeiro: false, vendas: true, producao: true, estoque: true, rh: false, administrativo: false, admin: false };

    const userSafe = {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      setor: usuario.setor || 'geral',
      cargo: usuario.cargo || '',
      foto_perfil: usuario.foto_perfil || null,
      permissoes: usuario.permissoes || defaultPerms
    };

    const token = await signToken(userSafe, env);
    return json({ token, user: userSafe });
  } catch (err) {
    return json({ error: 'Erro ao autenticar: ' + err.message }, 500);
  }
}
