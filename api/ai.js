// Vercel Edge Function — proxy para a API da Anthropic.
//
// Por que isto existe: antes, a chave da Anthropic ficava salva no navegador de
// cada usuário e era enviada direto para api.anthropic.com. Qualquer pessoa com
// acesso ao dispositivo (ou a um XSS futuro) podia extrair a chave e gastar a
// conta do usuário. Aqui a chave real fica só nesta função, como variável de
// ambiente do servidor, e nunca chega ao navegador. A função também repassa a
// resposta em streaming (Server-Sent Events), permitindo que o texto da IA
// apareça sendo escrito aos poucos em vez do usuário esperar tudo pronto.
//
// Variáveis de ambiente (configurar no painel da Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY  (obrigatória) — chave real da Anthropic.
//   APP_ACCESS_TOKEN   (opcional)    — se definida, o app só libera a IA para quem
//                                      colar esse código em "Configurações da IA".
//                                      Se não definida, a IA fica aberta para
//                                      qualquer pessoa que acesse o app.

export const config = { runtime: 'edge' };

var ALLOWED_MODELS = ['claude-haiku-4-5'];

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return json({ error: { message: 'Método não permitido.' } }, 405);
  }

  var anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return json({ error: { message: 'IA não configurada: falta ANTHROPIC_API_KEY nas variáveis de ambiente da Vercel.' } }, 500);
  }

  var requiredToken = process.env.APP_ACCESS_TOKEN;
  if (requiredToken) {
    var provided = req.headers.get('x-app-token') || '';
    if (provided !== requiredToken) {
      return json({ error: { message: 'Código de acesso inválido.', code: 'invalid_token' } }, 401);
    }
  }

  var body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: { message: 'Corpo da requisição inválido.' } }, 400);
  }

  var messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return json({ error: { message: 'Nenhuma mensagem enviada.' } }, 400);
  }
  var model = ALLOWED_MODELS.indexOf(body.model) >= 0 ? body.model : ALLOWED_MODELS[0];
  var maxTokens = parseInt(body.max_tokens, 10);
  if (!maxTokens || maxTokens < 1) maxTokens = 600;
  if (maxTokens > 2000) maxTokens = 2000;
  var stream = body.stream === true;

  var upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model: model, max_tokens: maxTokens, messages: messages, stream: stream })
    });
  } catch (e) {
    return json({ error: { message: 'Falha ao conectar com a IA.' } }, 502);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}
