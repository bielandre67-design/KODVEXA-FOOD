import crypto from 'node:crypto'

const MP_API = 'https://api.mercadopago.com'

function json(res, status, body) {
  return res.status(status).json(body)
}

function addMonth(date) {
  const d = new Date(date)
  d.setUTCMonth(d.getUTCMonth() + 1)
  return d
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10)
}

function diasEntre(a, b) {
  const ms = new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)
  return Math.max(0, Math.round(ms / 86400000))
}

function proporcional(inicio, vencimento, mensal = 29.90) {
  const fim = new Date(`${vencimento}T00:00:00Z`)
  const inicioCiclo = new Date(fim)
  inicioCiclo.setUTCMonth(inicioCiclo.getUTCMonth() - 1)
  const total = Math.max(1, diasEntre(isoDate(inicioCiclo), vencimento))
  const restante = diasEntre(inicio, vencimento)
  if (restante <= 0) return Number(mensal.toFixed(2))
  return Number(Math.max(0.01, mensal * restante / total).toFixed(2))
}

async function sb(path, { method = 'GET', body, token, service = false } = {}) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const key = service ? serviceKey : anon
  if (!url || !key) throw new Error('Supabase não configurado no servidor.')
  const r = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${service ? serviceKey : token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await r.json().catch(() => null)
  if (!r.ok) throw new Error(data?.message || data?.error || `Supabase ${r.status}`)
  return data
}

async function getUser(jwt) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !anon) throw new Error('Supabase não configurado no servidor.')
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${jwt}` } })
  if (!r.ok) return null
  return r.json()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método não permitido.' })
  try {
    const auth = req.headers.authorization || ''
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const user = jwt ? await getUser(jwt) : null
    if (!user?.id) return json(res, 401, { error: 'Sessão inválida.' })

    const matrizId = String(req.body?.matriz_id || '')
    if (!matrizId) return json(res, 400, { error: 'Matriz não informada.' })

    const vinculos = await sb(`estabelecimento_usuarios?select=funcao&estabelecimento_id=eq.${encodeURIComponent(matrizId)}&usuario_id=eq.${encodeURIComponent(user.id)}&limit=1`, { token: jwt })
    const funcao = String(vinculos?.[0]?.funcao || '').toLowerCase()
    if (!['dono','owner','proprietario','proprietário','admin','administrador'].includes(funcao)) {
      return json(res, 403, { error: 'Somente o dono pode contratar uma filial.' })
    }

    if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) throw new Error('MERCADO_PAGO_ACCESS_TOKEN não configurado.')
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurado.')

    const unidades = await sb(`estabelecimentos?select=id,tipo_unidade,ativo&or=(id.eq.${matrizId},matriz_id.eq.${matrizId})&ativo=eq.true`, { service: true })
    const filiais = (unidades || []).filter(x => x.tipo_unidade === 'filial').length
    if (filiais >= 5) return json(res, 409, { error: 'Limite de 5 filiais atingido.' })

    let assinaturas = await sb(`assinaturas_kodvexa?select=*&estabelecimento_id=eq.${encodeURIComponent(matrizId)}&produto=eq.food&limit=1`, { service: true })
    let assinatura = assinaturas?.[0]
    if (!assinatura) {
      const hoje = new Date()
      const proximo = addMonth(hoje)
      const criadas = await sb('assinaturas_kodvexa', {
        method: 'POST', service: true,
        body: { estabelecimento_id: matrizId, produto: 'food', status: 'ativa', valor_base: 79.90, valor_filial: 29.90, limite_filiais: 5, ciclo_inicio: isoDate(hoje), proximo_vencimento: isoDate(proximo) }
      })
      assinatura = criadas?.[0]
      await sb('assinatura_itens_kodvexa', { method: 'POST', service: true, body: { assinatura_id: assinatura.id, tipo: 'matriz', estabelecimento_id: matrizId, valor_mensal: 79.90, status: 'ativo', inicio_cobranca: isoDate(hoje) } })
    }

    const hoje = isoDate(new Date())
    const proximo = assinatura.proximo_vencimento || isoDate(addMonth(new Date()))
    const valor = proporcional(hoje, proximo, Number(assinatura.valor_filial || 29.90))
    const licencaId = crypto.randomUUID()
    const cobrancaId = crypto.randomUUID()
    const externalReference = `KODVEXA_FILIAL:${cobrancaId}`

    await sb('licencas_filiais', { method: 'POST', service: true, body: { id: licencaId, matriz_id: matrizId, status: 'pendente', origem: 'pagamento' } })
    await sb('cobrancas_kodvexa', { method: 'POST', service: true, body: { id: cobrancaId, assinatura_id: assinatura.id, tipo: 'proporcional_filial', status: 'pendente', competencia: hoje, vencimento: hoje, valor, mp_external_reference: externalReference } })

    const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}`
    const preference = await fetch(`${MP_API}/checkout/preferences`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': cobrancaId },
      body: JSON.stringify({
        items: [{ id: 'kodvexa-filial', title: 'KODVEXA Food - ativação de filial', quantity: 1, currency_id: 'BRL', unit_price: valor }],
        external_reference: externalReference,
        metadata: { kodvexa_tipo: 'filial', matriz_id: matrizId, licenca_id: licencaId, cobranca_id: cobrancaId },
        back_urls: {
          success: `${origin}/painel/unidades?pagamento=sucesso`,
          pending: `${origin}/painel/unidades?pagamento=pendente`,
          failure: `${origin}/painel/unidades?pagamento=falhou`
        },
        auto_return: 'approved',
        notification_url: `${origin}/api/mercadopago-webhook`
      })
    })
    const mp = await preference.json().catch(() => ({}))
    if (!preference.ok || !mp?.init_point) {
      await sb(`cobrancas_kodvexa?id=eq.${cobrancaId}`, { method: 'PATCH', service: true, body: { status: 'falhou' } })
      throw new Error(mp?.message || 'Mercado Pago não criou a preferência.')
    }
    return json(res, 200, { ok: true, checkout_url: mp.init_point, valor, proximo_vencimento: proximo })
  } catch (e) {
    console.error('mercadopago-criar-filial:', e)
    return json(res, 500, { error: e?.message || 'Falha ao iniciar pagamento.' })
  }
}
