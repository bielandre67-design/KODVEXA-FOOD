const MP_API = 'https://api.mercadopago.com'

async function sb(path, { method = 'GET', body } = {}) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service role não configurado.')
  const r = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await r.json().catch(() => null)
  if (!r.ok) throw new Error(data?.message || `Supabase ${r.status}`)
  return data
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' })
  try {
    const paymentId = String(req.body?.data?.id || req.query?.['data.id'] || '')
    if (!paymentId) return res.status(200).json({ ok: true })
    if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) throw new Error('Mercado Pago não configurado.')

    const mpRes = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}` } })
    const payment = await mpRes.json().catch(() => ({}))
    if (!mpRes.ok) throw new Error(payment?.message || 'Não foi possível consultar o pagamento.')

    const external = String(payment.external_reference || '')
    if (!external.startsWith('KODVEXA_FILIAL:')) return res.status(200).json({ ok: true, ignored: true })
    const cobrancaId = external.split(':')[1]
    const cobrancas = await sb(`cobrancas_kodvexa?select=*&id=eq.${encodeURIComponent(cobrancaId)}&limit=1`)
    const cobranca = cobrancas?.[0]
    if (!cobranca) return res.status(200).json({ ok: true, ignored: true })

    if (String(cobranca.mp_payment_id || '') === paymentId && cobranca.status === 'paga') {
      return res.status(200).json({ ok: true, duplicate: true })
    }

    const valorPago = Number(payment.transaction_amount || 0)
    const valorEsperado = Number(cobranca.valor || 0)
    const status = String(payment.status || '')

    await sb(`cobrancas_kodvexa?id=eq.${encodeURIComponent(cobrancaId)}`, {
      method: 'PATCH',
      body: { mp_payment_id: paymentId, mp_status: status, status: status === 'approved' ? 'paga' : (status === 'rejected' || status === 'cancelled' ? 'falhou' : 'pendente'), pago_em: status === 'approved' ? new Date().toISOString() : null }
    })

    if (status !== 'approved') return res.status(200).json({ ok: true, status })
    if (Math.abs(valorPago - valorEsperado) > 0.009) throw new Error('Valor do pagamento diferente da cobrança KODVEXA.')

    const licencaId = payment?.metadata?.licenca_id
    if (!licencaId) throw new Error('Pagamento aprovado sem licenca_id.')
    await sb(`licencas_filiais?id=eq.${encodeURIComponent(licencaId)}&status=eq.pendente`, {
      method: 'PATCH',
      body: { status: 'ativa', origem: 'pagamento', referencia_pagamento: paymentId, ativado_em: new Date().toISOString() }
    })

    return res.status(200).json({ ok: true, status: 'approved' })
  } catch (e) {
    console.error('mercadopago-webhook:', e)
    return res.status(500).json({ error: 'Falha ao processar webhook.' })
  }
}
