import { json, verifyAuth } from './_db.js';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    if (!key) return json({ error: 'Chave do arquivo não informada.' }, 400);

    if (!env.BUCKET_COMPROVANTES) {
      return json({ error: 'Bucket R2 não vinculado.' }, 500);
    }

    const object = await env.BUCKET_COMPROVANTES.get(key);
    if (!object) {
      return json({ error: 'Arquivo não encontrado no armazenamento.' }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'private, max-age=3600');

    return new Response(object.body, { headers });
  } catch (err) {
    return json({ error: 'Erro ao abrir arquivo: ' + err.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const user = await verifyAuth(request, env);
  if (!user) return json({ error: 'Não autorizado.' }, 401);

  try {
    if (!env.BUCKET_COMPROVANTES) {
      return json({ error: 'Bucket R2 (BUCKET_COMPROVANTES) não configurado.' }, 500);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const pasta = (formData.get('pasta') || 'geral').replace(/[^a-z0-9_-]/gi, '');

    if (!file || typeof file === 'string') {
      return json({ error: 'Nenhum arquivo enviado.' }, 400);
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${pasta}/${Date.now()}-${safeName}`;
    const buffer = await file.arrayBuffer();

    await env.BUCKET_COMPROVANTES.put(key, buffer, {
      httpMetadata: {
        contentType: file.type || 'application/octet-stream'
      }
    });

    return json({
      key,
      name: file.name,
      url: `/api/upload?key=${encodeURIComponent(key)}`
    });
  } catch (err) {
    return json({ error: 'Falha no upload: ' + err.message }, 500);
  }
}
