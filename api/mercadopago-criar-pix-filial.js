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
  const ms =
    new Date(`${b}T00:00:00Z`) -
    new Date(`${a}T00:00:00Z`)

  return Math.max(0, Math.round(ms / 86400000))
}

function proporcional(inicio, vencimento, mensal = 29.90) {
  const fim = new Date(`${vencimento}T00:00:00Z`)
  const inicioCiclo = new Date(fim)

  inicioCiclo.setUTCMonth(inicioCiclo.getUTCMonth() - 1)

  const total = Math.max(
    1,
    diasEntre(isoDate(inicioCiclo), vencimento)
  )

  const restante = diasEntre(inicio, vencimento)

  if (restante <= 0) {
    return Number(Number(mensal).toFixed(2))
  }

  return Number(
    Math.max(0.01, Number(mensal) * restante / total).toFixed(2)
  )
}

function getSupabaseConfig() {
  const url =
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL

  const publishableKey =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY

  const secretKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY

  return {
    url,
    publishableKey,
    secretKey,
  }
}

/*
 * Requisição do usuário logado.
 * Aqui SIM usamos:
 *   apikey: publishable key
 *   Authorization: Bearer <JWT do usuário>
 */
async function sbUser(path, jwt, options = {}) {
  const { method = 'GET', body } = options
  const { url, publishableKey } = getSupabaseConfig()

  if (!url || !publishableKey) {
    throw new Error('Supabase público não configurado no servidor.')
  }

  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error_description ||
      data?.error ||
      `Supabase ${response.status}`
    )
  }

  return data
}

/*
 * Requisição administrativa do backend.
 *
 * IMPORTANTE:
 * As novas chaves sb_secret_... do Supabase devem ir no header
 * "apikey". Não enviamos sb_secret_... como Bearer JWT.
 */
async function sbAdmin(path, options = {}) {
  const { method = 'GET', body } = options
  const { url, secretKey } = getSupabaseConfig()

  if (!url || !secretKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY não configurado no servidor.'
    )
  }

  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: secretKey,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error_description ||
      data?.error ||
      `Supabase ${response.status}`
    )
  }

  return data
}

async function getUser(jwt) {
  const { url, publishableKey } = getSupabaseConfig()

  if (!url || !publishableKey) {
    throw new Error('Supabase não configurado no servidor.')
  }

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${jwt}`,
    },
  })

  if (!response.ok) return null

  return response.json()
}

async function getMinhasUnidades(jwt) {
  return sbUser('rpc/get_meus_estabelecimentos', jwt, {
    method: 'POST',
    body: {},
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, {
      error: 'Método não permitido.',
    })
  }

  try {
    const auth = req.headers.authorization || ''
    const jwt = auth.startsWith('Bearer ')
      ? auth.slice(7)
      : ''

    if (!jwt) {
      return json(res, 401, {
        error: 'Sessão não encontrada.',
      })
    }

    const user = await getUser(jwt)

    if (!user?.id) {
      return json(res, 401, {
        error: 'Sessão inválida.',
      })
    }

    const matrizId = String(req.body?.matriz_id || '').trim()
    const formaPagamento = 'cartao'
    // Cartão usa Checkout Pro. Pix direto usa /api/mercadopago-criar-pix-filial.
      .trim()
      .toLowerCase()

    if (!['pix', 'cartao'].includes(formaPagamento)) {
      return json(res, 400, {
        error: 'Forma de pagamento inválida.',
      })
    }

    if (!matrizId) {
      return json(res, 400, {
        error: 'Matriz não informada.',
      })
    }

    if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
      throw new Error(
        'MERCADO_PAGO_ACCESS_TOKEN não configurado.'
      )
    }

    const { secretKey } = getSupabaseConfig()

    if (!secretKey) {
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY não configurado.'
      )
    }

    /*
     * Usa a RPC que o projeto já possui para descobrir as unidades
     * que o usuário realmente pode acessar.
     *
     * Isso evita consultar "estabelecimentos" diretamente com a
     * chave administrativa.
     */
    const unidades = await getMinhasUnidades(jwt)

    const matriz = (unidades || []).find(
      (u) =>
        String(u.estabelecimento_id) === matrizId &&
        String(u.tipo_unidade || '').toLowerCase() === 'matriz'
    )

    if (!matriz) {
      return json(res, 403, {
        error: 'Matriz não encontrada para este usuário.',
      })
    }

    const funcao = String(matriz.funcao || '').toLowerCase()

    if (
      ![
        'dono',
        'owner',
        'proprietario',
        'proprietário',
        'admin',
        'administrador',
      ].includes(funcao)
    ) {
      return json(res, 403, {
        error: 'Somente o dono pode contratar uma filial.',
      })
    }

    const filiaisAtivas = (unidades || []).filter(
      (u) =>
        String(u.matriz_id || '') === matrizId &&
        String(u.tipo_unidade || '').toLowerCase() === 'filial' &&
        u.unidade_ativa !== false
    ).length

    if (filiaisAtivas >= 5) {
      return json(res, 409, {
        error: 'Limite de 5 filiais atingido.',
      })
    }

    /*
     * Evita gerar duas cobranças pendentes para o mesmo clique/rede.
     * Se houver uma licença de pagamento já ATIVA e ainda sem filial,
     * o App poderá simplesmente liberar o cadastro.
     */
    const licencasAtivas = await sbAdmin(
      `licencas_filiais?select=id,status,origem,filial_id&matriz_id=eq.${encodeURIComponent(
        matrizId
      )}&status=eq.ativa&origem=eq.pagamento&filial_id=is.null&limit=1`
    )

    if (licencasAtivas?.length) {
      return json(res, 200, {
        ok: true,
        licenca_ativa: true,
        mensagem: 'Já existe uma licença de filial ativa.',
      })
    }

    let assinaturas = await sbAdmin(
      `assinaturas_kodvexa?select=*&estabelecimento_id=eq.${encodeURIComponent(
        matrizId
      )}&produto=eq.food&limit=1`
    )

    let assinatura = assinaturas?.[0]

    if (!assinatura) {
      const hojeData = new Date()
      const proximo = addMonth(hojeData)

      const criadas = await sbAdmin(
        'assinaturas_kodvexa',
        {
          method: 'POST',
          body: {
            estabelecimento_id: matrizId,
            produto: 'food',
            status: 'ativa',
            valor_base: 79.90,
            valor_filial: 29.90,
            limite_filiais: 5,
            ciclo_inicio: isoDate(hojeData),
            proximo_vencimento: isoDate(proximo),
          },
        }
      )

      assinatura = criadas?.[0]

      if (!assinatura?.id) {
        throw new Error(
          'Não foi possível criar a assinatura da matriz.'
        )
      }

      await sbAdmin(
        'assinatura_itens_kodvexa',
        {
          method: 'POST',
          body: {
            assinatura_id: assinatura.id,
            tipo: 'matriz',
            estabelecimento_id: matrizId,
            valor_mensal: 79.90,
            status: 'ativo',
            inicio_cobranca: isoDate(hojeData),
          },
        }
      )
    }

    const hoje = isoDate(new Date())

    const proximo =
      assinatura.proximo_vencimento ||
      isoDate(addMonth(new Date()))

    const valor = proporcional(
      hoje,
      proximo,
      Number(assinatura.valor_filial || 29.90)
    )

    const licencaId = crypto.randomUUID()
    const cobrancaId = crypto.randomUUID()

    const externalReference =
      `KODVEXA_FILIAL:${cobrancaId}`

    await sbAdmin(
      'licencas_filiais',
      {
        method: 'POST',
        body: {
          id: licencaId,
          matriz_id: matrizId,
          status: 'pendente',
          origem: 'pagamento',
        },
      }
    )

    await sbAdmin(
      'cobrancas_kodvexa',
      {
        method: 'POST',
        body: {
          id: cobrancaId,
          assinatura_id: assinatura.id,
          tipo: 'proporcional_filial',
          status: 'pendente',
          competencia: hoje,
          vencimento: hoje,
          valor,
          mp_external_reference: externalReference,
        },
      }
    )

    const proto =
      req.headers['x-forwarded-proto'] || 'https'

    const host =
      req.headers['x-forwarded-host'] ||
      req.headers.host

    const origin = `${proto}://${host}`

    const expiracao = new Date(Date.now() + 30 * 60 * 1000).toISOString()

    const pixResponse = await fetch(
      `${MP_API}/v1/payments`,
      {
        method: 'POST',
        headers: {
          Authorization:
            `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': cobrancaId,
        },
        body: JSON.stringify({
          transaction_amount: valor,
          description: 'KODVEXA Food - ativação de filial',
          payment_method_id: 'pix',
          external_reference: externalReference,
          date_of_expiration: expiracao,
          payer: {
            email: user.email,
          },
          metadata: {
            kodvexa_tipo: 'filial',
            forma_pagamento: 'pix',
            matriz_id: matrizId,
            licenca_id: licencaId,
            cobranca_id: cobrancaId,
          },
          notification_url:
            `${origin}/api/mercadopago-webhook`,
        }),
      }
    )

    const mp =
      await pixResponse.json().catch(() => ({}))

    const transactionData =
      mp?.point_of_interaction?.transaction_data || {}

    if (
      !pixResponse.ok ||
      !mp?.id ||
      !transactionData?.qr_code ||
      !transactionData?.qr_code_base64
    ) {
      await sbAdmin(
        `cobrancas_kodvexa?id=eq.${encodeURIComponent(
          cobrancaId
        )}`,
        {
          method: 'PATCH',
          body: {
            status: 'falhou',
            mp_status: String(mp?.status || 'erro_criacao_pix'),
          },
        }
      )

      await sbAdmin(
        `licencas_filiais?id=eq.${encodeURIComponent(
          licencaId
        )}&status=eq.pendente`,
        {
          method: 'PATCH',
          body: {
            status: 'cancelada',
            cancelado_em: new Date().toISOString(),
          },
        }
      )

      throw new Error(
        mp?.message ||
        mp?.cause?.[0]?.description ||
        'Mercado Pago não conseguiu gerar o Pix.'
      )
    }

    await sbAdmin(
      `cobrancas_kodvexa?id=eq.${encodeURIComponent(
        cobrancaId
      )}`,
      {
        method: 'PATCH',
        body: {
          mp_payment_id: String(mp.id),
          mp_status: String(mp.status || 'pending'),
        },
      }
    )

    return json(res, 200, {
      ok: true,
      payment_id: String(mp.id),
      qr_code: transactionData.qr_code,
      qr_code_base64: transactionData.qr_code_base64,
      ticket_url: transactionData.ticket_url || null,
      valor,
      expira_em: expiracao,
      proximo_vencimento: proximo,
    })
  } catch (error) {
    console.error(
      'mercadopago-criar-pix-filial:',
      error
    )

    return json(res, 500, {
      error:
        error?.message ||
        'Falha ao iniciar pagamento.',
    })
  }
}
