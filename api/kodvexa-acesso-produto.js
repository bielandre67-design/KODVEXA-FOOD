import { createClient } from '@supabase/supabase-js'

function responder(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  return res.status(status).json(body)
}

function bearer(req) {
  return String(req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim()
}

function normalizar(valor = '') {
  return String(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

async function localizarUsuarioPorEmail(admin, email) {
  const alvo = String(email || '').trim().toLowerCase()
  if (!alvo) return null

  for (let pagina = 1; pagina <= 20; pagina += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page: pagina,
      perPage: 1000,
    })
    if (error) throw error

    const usuarios = data?.users || []
    const usuario = usuarios.find(
      (item) => String(item.email || '').trim().toLowerCase() === alvo
    )
    if (usuario) return usuario
    if (usuarios.length < 1000) break
  }

  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return responder(res, 405, { error: 'Método não permitido.' })
  }

  try {
    const foodUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const foodPublicKey =
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY

    const centralUrl = process.env.KODVEXA_CENTRAL_SUPABASE_URL
    const centralServiceRole =
      process.env.KODVEXA_CENTRAL_SUPABASE_SERVICE_ROLE_KEY ||
      process.env.KODVEXA_CENTRAL_SUPABASE_SECRET_KEY

    if (!foodUrl || !foodPublicKey) {
      return responder(res, 500, {
        error: 'Conexão pública do Supabase do Food não está configurada no servidor.',
      })
    }

    if (!centralUrl || !centralServiceRole) {
      return responder(res, 500, {
        error: 'A validação segura da Central KODVEXA ainda não foi configurada.',
      })
    }

    const accessToken = bearer(req)
    if (!accessToken) {
      return responder(res, 401, { error: 'Sessão do Food não encontrada.' })
    }

    // Usa a sessão REAL do usuário do Food. Assim não precisamos consultar
    // estabelecimento_usuarios diretamente com uma chave administrativa.
    const foodUsuario = createClient(foodUrl, foodPublicKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    })

    const { data: usuarioFoodData, error: usuarioFoodError } =
      await foodUsuario.auth.getUser(accessToken)

    const usuarioFood = usuarioFoodData?.user
    if (usuarioFoodError || !usuarioFood?.id || !usuarioFood?.email) {
      return responder(res, 401, {
        error: 'Sua sessão do KODVEXA Food expirou. Entre novamente.',
      })
    }

    const estabelecimentoId = String(req.body?.estabelecimento_id || '').trim()
    const matrizIdInformada = String(req.body?.matriz_id || '').trim()

    if (!estabelecimentoId) {
      return responder(res, 400, { error: 'Estabelecimento não informado.' })
    }

    // A própria função do Food já aplica o vínculo do usuário autenticado.
    const { data: unidades, error: unidadesError } =
      await foodUsuario.rpc('get_meus_estabelecimentos')

    if (unidadesError) {
      console.error('Erro ao carregar unidades do Food:', unidadesError)
      return responder(res, 403, {
        error: 'Não foi possível validar as unidades desta conta no KODVEXA Food.',
      })
    }

    const idsUnidades = [...new Set(
      (unidades || [])
        .map((item) => item?.estabelecimento_id)
        .filter(Boolean)
        .map(String)
    )]

    if (!idsUnidades.includes(estabelecimentoId)) {
      return responder(res, 403, {
        error: 'Esta conta não possui acesso à unidade Food informada.',
      })
    }

    // Lê somente estabelecimentos que o próprio usuário já pode enxergar no Food.
    const { data: lojasFood, error: lojasFoodError } = await foodUsuario
      .from('estabelecimentos')
      .select('id, nome, nome_unidade, matriz_id, tipo_unidade')
      .in('id', idsUnidades)

    if (lojasFoodError) {
      console.error('Erro ao localizar estabelecimentos Food:', lojasFoodError)
      return responder(res, 403, {
        error: 'Não foi possível identificar a unidade Food desta conta.',
      })
    }

    const lojaAtual = (lojasFood || []).find(
      (item) => String(item.id) === estabelecimentoId
    ) || null

    const matrizVisivel = (lojasFood || []).find(
      (item) => String(item.tipo_unidade || '').toLowerCase() === 'matriz'
    ) || null

    const matrizId =
      String(lojaAtual?.matriz_id || '').trim() ||
      (matrizIdInformada && idsUnidades.includes(matrizIdInformada)
        ? matrizIdInformada
        : '') ||
      String(matrizVisivel?.id || '').trim() ||
      estabelecimentoId

    const lojaBase =
      (lojasFood || []).find((item) => String(item.id) === matrizId) ||
      lojaAtual

    const nomeFood = lojaBase?.nome || lojaBase?.nome_unidade || ''

    // Daqui para frente a Central é consultada apenas no servidor.
    const adminCentral = createClient(centralUrl, centralServiceRole, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })

    const usuarioCentral = await localizarUsuarioPorEmail(
      adminCentral,
      usuarioFood.email
    )

    if (!usuarioCentral?.id) {
      return responder(res, 403, {
        error: 'Esta conta ainda não está vinculada à Central KODVEXA.',
      })
    }

    const { data: empresasCentral, error: empresasError } = await adminCentral
      .from('estabelecimentos')
      .select('id, nome, status_financeiro, criado_em')
      .eq('usuario_id', usuarioCentral.id)
      .order('criado_em', { ascending: true })

    if (empresasError) throw empresasError
    if (!empresasCentral?.length) {
      return responder(res, 403, {
        error: 'Nenhum estabelecimento foi encontrado na Central KODVEXA.',
      })
    }

    let empresaCentral = null
    if (empresasCentral.length === 1) {
      empresaCentral = empresasCentral[0]
    } else if (nomeFood) {
      empresaCentral = empresasCentral.find(
        (item) => normalizar(item.nome) === normalizar(nomeFood)
      ) || null
    }

    if (!empresaCentral) {
      return responder(res, 403, {
        error: 'Não foi possível identificar com segurança qual empresa da Central corresponde a este Food.',
      })
    }

    const { data: produtoFood, error: produtoError } = await adminCentral
      .from('produtos_kodvexa')
      .select('id, nome, ativo')
      .ilike('nome', '%Food%')
      .limit(1)
      .maybeSingle()

    if (produtoError) throw produtoError
    if (!produtoFood?.id || produtoFood.ativo === false) {
      return responder(res, 200, {
        ativo: false,
        status_financeiro: 'nao_configurado',
      })
    }

    const { data: vinculo, error: vinculoError } = await adminCentral
      .from('estabelecimento_produtos')
      .select('status, plano_codigo, plano_nome, valor_mensal, data_vencimento, status_financeiro')
      .eq('estabelecimento_id', empresaCentral.id)
      .eq('produto_id', produtoFood.id)
      .maybeSingle()

    if (vinculoError) throw vinculoError

    const ativo = Boolean(
      vinculo && String(vinculo.status || '').toLowerCase() !== 'inativo'
    )

    const statusFinanceiro =
      vinculo?.status_financeiro ||
      empresaCentral.status_financeiro ||
      'nao_configurado'

    return responder(res, 200, {
      ativo,
      status_financeiro: statusFinanceiro,
      plano_codigo: vinculo?.plano_codigo || null,
      plano_nome: vinculo?.plano_nome || null,
      valor_mensal: vinculo?.valor_mensal ?? null,
      data_vencimento: vinculo?.data_vencimento || null,
    })
  } catch (error) {
    console.error('Erro ao validar acesso do KODVEXA Food:', error)
    return responder(res, 500, {
      error: error?.message || 'Não foi possível validar seu acesso ao KODVEXA Food.',
    })
  }
}
