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
    const email = (body.email || '').trim().toLowerCase();
    const senha = (body.senha || '').trim();

    if (!email || !senha) {
      return json({ error: 'Informe login e senha.' }, 400);
    }

    const sql = getSql(env);
    const rows = await sql`
      SELECT id, nome, email, senha_hash, perfil, ativo, setor, permissoes
      FROM usuarios
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return json({ error: 'Usuário não encontrado.' }, 401);
    }

    const usuario = rows[0];
    if (!usuario.ativo) {
      return json({ error: 'Usuário desativado. Contate o administrador.' }, 403);
    }

    if (usuario.senha_hash !== senha) {
      return json({ error: 'Senha incorreta.' }, 401);
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
      permissoes: usuario.permissoes || defaultPerms
    };

    const token = await signToken(userSafe, env);
    return json({ token, user: userSafe });
  } catch (err) {
    return json({ error: 'Erro ao autenticar: ' + err.message }, 500);
  }
}
