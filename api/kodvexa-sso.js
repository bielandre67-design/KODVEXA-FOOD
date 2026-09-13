import { createClient } from '@supabase/supabase-js'

function origemPermitida(req) {
  const configurada = String(process.env.KODVEXA_PORTAL_ORIGIN || '').trim().replace(/\/$/, '')
  const recebida = String(req.headers.origin || '').trim().replace(/\/$/, '')

  if (configurada) return configurada
  return recebida || '*'
}

function aplicarCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', origemPermitida(req))
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Cache-Control', 'no-store')
}

function responder(req, res, status, body) {
  aplicarCors(req, res)
  return res.status(status).json(body)
}

function tokenBearer(req) {
  return String(req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim()
}

function origemFood(req) {
  const protocolo = String(req.headers['x-forwarded-proto'] || 'https')
    .split(',')[0]
    .trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()

  if (!host) return ''
  return `${protocolo}://${host}`
}

async function localizarUsuarioFoodPorEmail(adminFood, email) {
  const alvo = String(email || '').trim().toLowerCase()
  if (!alvo) return null

  for (let pagina = 1; pagina <= 20; pagina += 1) {
    const { data, error } = await adminFood.auth.admin.listUsers({
      page: pagina,
      perPage: 1000,
    })

    if (error) throw error

    const usuarios = data?.users || []
    const encontrado = usuarios.find(
      (usuario) => String(usuario.email || '').trim().toLowerCase() === alvo
    )

    if (encontrado) return encontrado
    if (usuarios.length < 1000) break
  }

  return null
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    aplicarCors(req, res)
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return responder(req, res, 405, { error: 'Método não permitido.' })
  }

  try {
    // =====================================================
    // CENTRAL KODVEXA / AGENDA
    // Este Supabase contém produtos_kodvexa e estabelecimento_produtos.
    // =====================================================
    const centralUrl = process.env.KODVEXA_CENTRAL_SUPABASE_URL
    const centralKey =
      process.env.KODVEXA_CENTRAL_SUPABASE_PUBLISHABLE_KEY ||
      process.env.KODVEXA_CENTRAL_SUPABASE_ANON_KEY

    // =====================================================
    // KODVEXA FOOD
    // Este Supabase contém estabelecimento_usuarios e o Auth do Food.
    // =====================================================
    const foodUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const foodServiceRole =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY

    if (!centralUrl || !centralKey) {
      return responder(req, res, 500, {
        error: 'Conexão com a Central KODVEXA ainda não foi configurada no Food.',
      })
    }

    if (!foodUrl || !foodServiceRole) {
      return responder(req, res, 500, {
        error: 'Conexão segura do KODVEXA Food ainda não foi configurada no servidor.',
      })
    }

    const accessToken = tokenBearer(req)
    if (!accessToken) {
      return responder(req, res, 401, {
        error: 'Sessão da Minha KODVEXA não encontrada.',
      })
    }

    // Valida o token no Supabase da Central, não no Supabase do Food.
    const central = createClient(centralUrl, centralKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    })

    const { data: usuarioData, error: usuarioError } =
      await central.auth.getUser(accessToken)

    const usuarioCentral = usuarioData?.user

    if (usuarioError || !usuarioCentral?.id || !usuarioCentral?.email) {
      return responder(req, res, 401, {
        error: 'Sua sessão da Minha KODVEXA expirou. Entre novamente.',
      })
    }

    // Localiza a empresa da conta logada na Central.
    const { data: estabelecimentosCentral, error: estabelecimentoError } =
      await central
        .from('estabelecimentos')
        .select('id, nome, usuario_id, status_financeiro, criado_em')
        .eq('usuario_id', usuarioCentral.id)
        .order('criado_em', { ascending: true })
        .limit(20)

    if (estabelecimentoError) {
      console.error('Erro ao localizar empresa na Central:', estabelecimentoError)
      return responder(req, res, 403, {
        error: 'Não foi possível validar sua empresa na Central KODVEXA.',
      })
    }

    if (!estabelecimentosCentral?.length) {
      return responder(req, res, 403, {
        error: 'Nenhuma empresa KODVEXA foi encontrada para esta conta.',
      })
    }

    const { data: produtoFood, error: produtoError } = await central
      .from('produtos_kodvexa')
      .select('id, nome, ativo')
      .ilike('nome', '%Food%')
      .limit(1)
      .maybeSingle()

    if (produtoError || !produtoFood?.id || produtoFood.ativo === false) {
      console.error('Erro ao localizar KODVEXA Food na Central:', produtoError)
      return responder(req, res, 403, {
        error: 'KODVEXA Food não está disponível para esta conta.',
      })
    }

    const idsEstabelecimentos = estabelecimentosCentral.map((item) => item.id)

    const { data: vinculos, error: vinculoError } = await central
      .from('estabelecimento_produtos')
      .select('estabelecimento_id, status, status_financeiro')
      .in('estabelecimento_id', idsEstabelecimentos)
      .eq('produto_id', produtoFood.id)

    if (vinculoError) {
      console.error('Erro ao validar assinatura Food:', vinculoError)
      return responder(req, res, 403, {
        error: 'Não foi possível validar sua assinatura do KODVEXA Food.',
      })
    }

    const vinculoAtivo = (vinculos || []).find(
      (item) => String(item.status || '').toLowerCase() !== 'inativo'
    )

    if (!vinculoAtivo) {
      return responder(req, res, 403, {
        error: 'KODVEXA Food não está contratado para esta conta.',
      })
    }

    if (String(vinculoAtivo.status_financeiro || '').toLowerCase() === 'bloqueado') {
      return responder(req, res, 403, {
        error: 'O acesso ao KODVEXA Food está bloqueado pela situação financeira.',
      })
    }

    // Agora trabalha no Supabase do Food.
    const adminFood = createClient(foodUrl, foodServiceRole, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })

    const usuarioFood = await localizarUsuarioFoodPorEmail(
      adminFood,
      usuarioCentral.email
    )

    if (!usuarioFood?.id) {
      return responder(req, res, 403, {
        error: 'Sua assinatura Food está ativa, mas a conta do Food ainda não foi provisionada. Fale com o suporte KODVEXA.',
      })
    }

    // A vinculação da unidade é validada pelo próprio painel Food após o login,
    // usando get_meus_estabelecimentos com a sessão do usuário. Evitamos consultar
    // estabelecimento_usuarios diretamente aqui para não depender de grants da tabela.

    const { data: linkData, error: linkError } =
      await adminFood.auth.admin.generateLink({
        type: 'magiclink',
        email: usuarioFood.email,
      })

    if (linkError) throw linkError

    const tokenHash = linkData?.properties?.hashed_token
    if (!tokenHash) {
      throw new Error('O Supabase Food não retornou o token de acesso único.')
    }

    const origem = origemFood(req)
    if (!origem) {
      throw new Error('Não foi possível identificar o endereço do KODVEXA Food.')
    }

    const ssoUrl = `${origem}/auth/sso#token_hash=${encodeURIComponent(
      tokenHash
    )}&type=magiclink`

    return responder(req, res, 200, {
      ok: true,
      url: ssoUrl,
    })
  } catch (error) {
    console.error('Erro no SSO KODVEXA Food:', error)
    return responder(req, res, 500, {
      error: error?.message || 'Não foi possível abrir o KODVEXA Food.',
    })
  }
}
