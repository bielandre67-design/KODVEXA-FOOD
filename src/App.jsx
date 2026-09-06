import { useEffect, useMemo, useRef, useState } from 'react'
import { BrowserRouter, Link, Route, Routes, useParams } from 'react-router-dom'
import { Bell, Bike, CheckCircle2, ChefHat, ChevronRight, Clock3, Home, LayoutGrid, LogOut, MapPin, Menu, Minus, Navigation, Plus, Printer, RefreshCw, Search, ShieldCheck, ShoppingBag, Sparkles, Store, Trash2, UserPlus, Users, X } from 'lucide-react'
import { supabase } from './supabase'
import './App.css'

const dinheiro = (valor) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0)

const GEOAPIFY_API_KEY = import.meta.env.VITE_GEOAPIFY_API_KEY

// =====================================================
// KODVEXA FOOD - MATRIZ / FILIAIS
// =====================================================
async function obterUnidadesUsuario() {
  const { data, error } = await supabase.rpc('get_meus_estabelecimentos')
  if (error) throw error
  return data || []
}

async function obterUnidadeAtualCompleta() {
  const unidades = await obterUnidadesUsuario()
  if (!unidades.length) return { unidade: null, estabelecimento: null, unidades: [] }

  const salva = localStorage.getItem('kodvexa_unidade_atual')
  let unidade = unidades.find((item) => item.estabelecimento_id === salva)

  if (!unidade) {
    unidade = unidades.find((item) => item.tipo_unidade === 'matriz') || unidades[0]
  }

  localStorage.setItem('kodvexa_unidade_atual', unidade.estabelecimento_id)

  const { data: estabelecimento, error } = await supabase
    .from('estabelecimentos')
    .select('*')
    .eq('id', unidade.estabelecimento_id)
    .single()

  if (error) throw error
  return { unidade, estabelecimento, unidades }
}

function normalizarFuncaoAcesso(unidade, unidades = []) {
  const bruta = String(unidade?.funcao || '').trim().toLowerCase()

  if (['dono', 'admin', 'administrador', 'owner', 'proprietario', 'proprietário'].includes(bruta)) {
    return 'dono'
  }

  if (bruta === 'gerente') return 'gerente'
  if (bruta === 'atendente') return 'atendente'

  // Compatibilidade com contas antigas do KODVEXA:
  // se o usuário já possui acesso à Matriz e a função veio vazia/antiga,
  // tratamos como dono para não bloquear o proprietário existente.
  const temMatriz = (unidades || []).some((item) => item.tipo_unidade === 'matriz')
  if (!bruta && temMatriz) return 'dono'

  return bruta || 'atendente'
}

function selecionarUnidadePainel(estabelecimentoId) {
  localStorage.setItem('kodvexa_unidade_atual', estabelecimentoId)
  window.location.reload()
}

async function buscarCoordenadasGeoapify(endereco, cepEsperado = '') {
  if (!GEOAPIFY_API_KEY) throw new Error('Chave do Geoapify não configurada no .env.')
  const cepLimpo = String(cepEsperado || '').replace(/\D/g, '')
  const filtroCep = cepLimpo ? `&filter=countrycode:br&bias=countrycode:br` : '&filter=countrycode:br'
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(endereco)}&format=json&limit=5${filtroCep}&apiKey=${encodeURIComponent(GEOAPIFY_API_KEY)}`
  const resposta = await fetch(url)
  if (!resposta.ok) throw new Error('Não foi possível localizar o endereço agora.')
  const dados = await resposta.json()
  const resultados = dados?.results || []
  if (!resultados.length) throw new Error(`Endereço não encontrado: ${endereco}`)

  const resultado = cepLimpo
    ? resultados.find((r) => String(r.postcode || '').replace(/\D/g, '') === cepLimpo) || resultados[0]
    : resultados[0]

  if (cepLimpo && String(resultado.postcode || '').replace(/\D/g, '') !== cepLimpo) {
    throw new Error(`O mapa não confirmou o CEP ${cepEsperado}. Confira o CEP e tente novamente.`)
  }

  return { lat: resultado.lat, lon: resultado.lon, endereco: resultado.formatted || endereco, postcode: resultado.postcode || '' }
}


async function buscarEnderecoPorCep(cep) {
  const somenteNumeros = String(cep || '').replace(/\D/g, '')
  if (somenteNumeros.length !== 8) throw new Error('Digite um CEP válido com 8 números.')

  const resposta = await fetch(`https://viacep.com.br/ws/${somenteNumeros}/json/`)
  if (!resposta.ok) throw new Error('Não foi possível consultar o CEP agora.')

  const dados = await resposta.json()
  if (dados?.erro) throw new Error('CEP não encontrado.')

  return dados
}

async function calcularRotaGeoapify(origem, destino, cepOrigem = '', cepDestino = '') {
  const [pontoOrigem, pontoDestino] = await Promise.all([
    buscarCoordenadasGeoapify(origem, cepOrigem),
    buscarCoordenadasGeoapify(destino, cepDestino),
  ])
  const waypoints = `${pontoOrigem.lat},${pontoOrigem.lon}|${pontoDestino.lat},${pontoDestino.lon}`
  const url = `https://api.geoapify.com/v1/routing?waypoints=${encodeURIComponent(waypoints)}&mode=drive&details=instruction_details&apiKey=${encodeURIComponent(GEOAPIFY_API_KEY)}`
  const resposta = await fetch(url)
  if (!resposta.ok) throw new Error('Não foi possível calcular a rota agora.')
  const dados = await resposta.json()
  const rota = dados?.features?.[0]?.properties
  if (!rota?.distance) throw new Error('O Geoapify não retornou uma rota válida para esses endereços.')
  return {
    distanciaKm: rota.distance / 1000,
    duracaoMin: rota.time ? rota.time / 60 : null,
    origem: pontoOrigem,
    destino: pontoDestino,
  }
}

function minutosDoHorario(valor = '') {
  const [hora, minuto] = String(valor || '').slice(0, 5).split(':').map(Number)
  if (!Number.isFinite(hora) || !Number.isFinite(minuto)) return null
  return hora * 60 + minuto
}

function agoraSaoPaulo() {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())

  const mapa = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]))
  const dias = {
    'dom.': 0, 'seg.': 1, 'ter.': 2, 'qua.': 3,
    'qui.': 4, 'sex.': 5, 'sáb.': 6,
  }

  return {
    diaSemana: dias[mapa.weekday] ?? new Date().getDay(),
    minutos: Number(mapa.hour || 0) * 60 + Number(mapa.minute || 0),
  }
}

function lojaEstaAbertaAgora(horarios = [], abertoManual = true) {
  if (!Array.isArray(horarios) || !horarios.length) {
    return Boolean(abertoManual)
  }

  const { diaSemana, minutos } = agoraSaoPaulo()
  const hoje = horarios.find((item) => Number(item.dia_semana) === diaSemana)

  if (!hoje || hoje.fechado) return false

  const abre = minutosDoHorario(hoje.abre)
  const fecha = minutosDoHorario(hoje.fecha)

  if (abre == null || fecha == null) return false

  // Mesmo dia, ex.: 11:00 às 23:00
  if (fecha > abre) {
    return minutos >= abre && minutos < fecha
  }

  // Vira a madrugada, ex.: 18:00 às 02:00
  if (fecha < abre) {
    return minutos >= abre || minutos < fecha
  }

  // Mesmo horário de abertura e fechamento = fechado por segurança
  return false
}


function Cardapio() {
  const { slug } = useParams()
  const [loja, setLoja] = useState(null)
  const [categorias, setCategorias] = useState([])
  const [produtos, setProdutos] = useState([])
  const [busca, setBusca] = useState('')
  const [categoriaSelecionada, setCategoriaSelecionada] = useState('todos')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [produtoAberto, setProdutoAberto] = useState(null)
  const [quantidade, setQuantidade] = useState(1)
  const [observacaoItem, setObservacaoItem] = useState('')
  const [gruposAdicionais, setGruposAdicionais] = useState([])
  const [adicionais, setAdicionais] = useState([])
  const [produtoGrupos, setProdutoGrupos] = useState([])
  const [escolhasAdicionais, setEscolhasAdicionais] = useState({})
  const [carrinho, setCarrinho] = useState([])
  const [carrinhoAberto, setCarrinhoAberto] = useState(false)
  const [checkoutAberto, setCheckoutAberto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erroPedido, setErroPedido] = useState('')
  const [pedidoCriado, setPedidoCriado] = useState(null)
  const [calculandoEntrega, setCalculandoEntrega] = useState(false)
  const [entregaCalculada, setEntregaCalculada] = useState(null)
  const [horariosLoja, setHorariosLoja] = useState([])
  const [formulario, setFormulario] = useState({
    nome: '', telefone: '', tipo: 'entrega', cep: '', numero: '', endereco: '', complemento: '',
    referencia: '', pagamento: 'pix', troco: '', observacao: '',
  })

  useEffect(() => {
    async function carregar() {
      setCarregando(true)
      setErro('')

      const { data: estabelecimento, error: erroLoja } = await supabase
        .from('estabelecimentos')
        .select('*')
        .eq('slug', slug)
        .eq('ativo', true)
        .maybeSingle()

      if (erroLoja || !estabelecimento) {
        setErro('Cardápio não encontrado.')
        setCarregando(false)
        return
      }

      const [{ data: dadosCategorias, error: erroCategorias }, { data: dadosProdutos, error: erroProdutos }] =
        await Promise.all([
          supabase
            .from('categorias')
            .select('*')
            .eq('estabelecimento_id', estabelecimento.id)
            .eq('ativo', true)
            .order('ordem'),
          supabase
            .from('produtos')
            .select('*')
            .eq('estabelecimento_id', estabelecimento.id)
            .order('ordem'),
        ])

      if (erroCategorias || erroProdutos) {
        setErro('Não foi possível carregar os produtos agora.')
      } else {
        setLoja(estabelecimento)
        setCategorias(dadosCategorias || [])
        setProdutos(dadosProdutos || [])
        const [{ data: grupos }, { data: ops }, { data: horariosPublicos }] = await Promise.all([
          supabase.from('grupos_adicionais').select('*').eq('estabelecimento_id', estabelecimento.id).eq('ativo', true).order('ordem'),
          supabase.from('adicionais').select('*').eq('estabelecimento_id', estabelecimento.id).eq('disponivel', true).order('ordem'),
          supabase
            .from('horarios_funcionamento')
            .select('dia_semana, abre, fecha, fechado')
            .eq('estabelecimento_id', estabelecimento.id)
            .order('dia_semana'),
        ])
        const idsProdutos = (dadosProdutos || []).map((p) => p.id)
        const { data: vinculos } = idsProdutos.length
          ? await supabase.from('produto_grupos_adicionais').select('*').in('produto_id', idsProdutos)
          : { data: [] }
        setGruposAdicionais(grupos || [])
        setAdicionais(ops || [])
        setProdutoGrupos(vinculos || [])
        setHorariosLoja(horariosPublicos || [])
      }

      setCarregando(false)
    }

    carregar()
  }, [slug])

  const abertoAgora = useMemo(
    () => lojaEstaAbertaAgora(horariosLoja, loja?.aberto ?? true),
    [horariosLoja, loja?.aberto],
  )

  useEffect(() => {
    if (!abertoAgora) {
      setProdutoAberto(null)
      setCarrinhoAberto(false)
      setCheckoutAberto(false)
    }
  }, [abertoAgora])

  const produtosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return produtos
    return produtos.filter((produto) =>
      `${produto.nome} ${produto.descricao || ''}`.toLowerCase().includes(termo),
    )
  }, [busca, produtos])


  const produtosDestaque = useMemo(
    () => produtos
      .filter((produto) => produto.destaque)
      .slice(0, 6),
    [produtos],
  )


  function iconeCategoria(nome = '') {
    const inicial = String(nome || '').trim().charAt(0).toUpperCase() || '•'
    return <span className="categoria-led__letra">{inicial}</span>
  }

  const totalItens = carrinho.reduce((soma, item) => soma + item.quantidade, 0)
  const total = carrinho.reduce((soma, item) => soma + item.preco * item.quantidade, 0)

  function abrirProduto(produto) {
    if (!abertoAgora) {
      setErroPedido('Loja fechada no momento. Você pode consultar o cardápio, mas os pedidos estão pausados.')
      return
    }

    if (produto?.disponivel === false) {
      setErroPedido(`${produto.nome || 'Este produto'} está esgotado no momento.`)
      return
    }

    setProdutoAberto(produto)
    setQuantidade(1)
    setObservacaoItem('')
    setEscolhasAdicionais({})
  }

  const gruposDoProduto = produtoAberto
    ? gruposAdicionais.filter((grupo) => produtoGrupos.some((v) => v.produto_id === produtoAberto.id && v.grupo_id === grupo.id))
    : []

  function adicionaisDoGrupo(grupoId) { return adicionais.filter((a) => a.grupo_id === grupoId) }

  function alternarAdicional(grupo, adicional) {
    setEscolhasAdicionais((atual) => {
      const atuais = atual[grupo.id] || []
      if (atuais.includes(adicional.id)) return { ...atual, [grupo.id]: atuais.filter((id) => id !== adicional.id) }
      const maximo = Number(grupo.maximo || 0)
      if (maximo === 1) return { ...atual, [grupo.id]: [adicional.id] }
      if (maximo > 0 && atuais.length >= maximo) return atual
      return { ...atual, [grupo.id]: [...atuais, adicional.id] }
    })
  }

  const adicionaisSelecionados = gruposDoProduto.flatMap((grupo) => {
    const ids = escolhasAdicionais[grupo.id] || []
    return adicionaisDoGrupo(grupo.id).filter((a) => ids.includes(a.id))
  })
  const totalAdicionaisUnitario = adicionaisSelecionados.reduce((soma, a) => soma + Number(a.preco || 0), 0)
  const precoBaseProduto = produtoAberto ? Number(produtoAberto.preco_promocional || produtoAberto.preco || 0) : 0
  const precoUnitarioConfigurado = precoBaseProduto + totalAdicionaisUnitario
  const categoriaProdutoAberto = produtoAberto
    ? categorias.find((categoria) => categoria.id === produtoAberto.categoria_id)
    : null

  const nomeCategoriaProduto = String(categoriaProdutoAberto?.nome || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  const produtoEhBebida = ['bebida', 'bebidas'].includes(nomeCategoriaProduto)

  const produtoEhDoce = [
    'doce', 'doces', 'sobremesa', 'sobremesas', 'acai', 'sorvetes', 'sorvete'
  ].some((termo) => nomeCategoriaProduto.includes(termo))

  const produtoEhRefeicao = [
    'almoco', 'almocos', 'refeicao', 'refeicoes', 'prato', 'pratos',
    'marmita', 'marmitas', 'frango assado', 'frango'
  ].some((termo) => nomeCategoriaProduto.includes(termo))

  const observacaoTituloProduto = produtoEhDoce
    ? 'Observação especial'
    : produtoEhRefeicao
      ? 'Alguma observação do prato?'
      : 'Alguma observação?'

  const observacaoExemploProduto = produtoEhDoce
    ? 'Ex.: sem cobertura, embalar separado'
    : produtoEhRefeicao
      ? 'Ex.: sem cebola, pouco sal, molho separado'
      : 'Ex.: sem cebola, molho separado, cortar ao meio'

  const observacaoPlaceholderProduto = produtoEhDoce
    ? 'Ex.: sem cobertura, embalar separado...'
    : produtoEhRefeicao
      ? 'Ex.: sem cebola, pouco sal, molho separado...'
      : 'Digite aqui como você quer este item...'

  function adicionaisValidos() {
    return gruposDoProduto.every((grupo) => {
      const qtd = (escolhasAdicionais[grupo.id] || []).length
      const minimo = grupo.obrigatorio ? Math.max(Number(grupo.minimo || 0), 1) : Number(grupo.minimo || 0)
      return qtd >= minimo && !(grupo.maximo != null && Number(grupo.maximo) > 0 && qtd > Number(grupo.maximo))
    })
  }

  function adicionarAoCarrinho() {
    if (!abertoAgora) {
      setErroPedido('Loja fechada no momento. Você pode consultar o cardápio, mas não adicionar itens.')
      return
    }

    if (!adicionaisValidos()) { setErroPedido('Confira as opções obrigatórias deste produto.'); return }
    const observacaoLimpa = observacaoItem.trim()
    const idsSelecionados = adicionaisSelecionados.map((a) => a.id).sort()
    const chaveItem = `${produtoAberto.id}::${idsSelecionados.join(',')}::${observacaoLimpa.toLowerCase()}`
    setCarrinho((atual) => {
      const existente = atual.find((item) => item.chaveItem === chaveItem)
      if (existente) return atual.map((item) => item.chaveItem === chaveItem ? { ...item, quantidade: item.quantidade + quantidade } : item)
      return [...atual, { ...produtoAberto, chaveItem, observacaoItem: observacaoLimpa, quantidade, precoBase: precoBaseProduto, preco: precoUnitarioConfigurado, adicionaisEscolhidos: adicionaisSelecionados.map((a) => ({ id: a.id, nome: a.nome, preco: Number(a.preco || 0), grupo_id: a.grupo_id })) }]
    })
    setProdutoAberto(null)
    setObservacaoItem('')
    setEscolhasAdicionais({})
  }

  function alterarItem(chaveItem, diferenca) {
    if (!abertoAgora) return

    setCarrinho((atual) =>
      atual
        .map((item) =>
          item.chaveItem === chaveItem ? { ...item, quantidade: item.quantidade + diferenca } : item,
        )
        .filter((item) => item.quantidade > 0),
    )
  }

  function atualizarCampo(campo, valor) {
    setFormulario((atual) => ({ ...atual, [campo]: valor }))
    if (['cep', 'numero', 'tipo'].includes(campo)) {
      setEntregaCalculada(null)
      setErroPedido('')
    }
  }

  async function calcularEntregaCliente() {
    setErroPedido('')
    setEntregaCalculada(null)

    if (formulario.tipo !== 'entrega') return
    if (loja.faz_entrega === false) {
      setErroPedido('Este estabelecimento não está fazendo entregas no momento.')
      return
    }

    const cepCliente = formulario.cep.replace(/\D/g, '')
    if (cepCliente.length !== 8) {
      setErroPedido('Digite um CEP válido com 8 números.')
      return
    }
    if (!formulario.numero.trim()) {
      setErroPedido('Digite o número do endereço de entrega.')
      return
    }

    const pedidoMinimo = Number(loja.pedido_minimo_entrega || 0)
    if (total < pedidoMinimo) {
      setErroPedido(`O pedido mínimo para entrega é ${dinheiro(pedidoMinimo)}.`)
      return
    }

    const cepOrigem = String(loja.cep || '').replace(/\D/g, '')
    const numeroOrigem = String(loja.endereco_saida || '').match(/,\s*(\d+[A-Za-z-]*)/)?.[1] || ''
    if (cepOrigem.length !== 8 || !numeroOrigem) {
      setErroPedido('A loja ainda não configurou corretamente o CEP e o número de saída das entregas.')
      return
    }

    setCalculandoEntrega(true)
    try {
      const [origemCep, destinoCep] = await Promise.all([
        buscarEnderecoPorCep(cepOrigem),
        buscarEnderecoPorCep(cepCliente),
      ])

      const origemCompleta = `${origemCep.logradouro}, ${numeroOrigem}, ${origemCep.bairro}, ${origemCep.localidade} - ${origemCep.uf}, ${origemCep.cep}, Brasil`
      const destinoCompleto = `${destinoCep.logradouro}, ${formulario.numero.trim()}, ${destinoCep.bairro}, ${destinoCep.localidade} - ${destinoCep.uf}, ${destinoCep.cep}, Brasil`
      const rota = await calcularRotaGeoapify(origemCompleta, destinoCompleto, origemCep.cep, destinoCep.cep)
      const distanciaKm = Math.round(rota.distanciaKm * 100) / 100
      const raioMaximo = Number(loja.raio_maximo_km || 0)

      if (raioMaximo > 0 && distanciaKm > raioMaximo) {
        setEntregaCalculada({ valido: false, distanciaKm, endereco: destinoCompleto })
        setErroPedido(`Esse endereço fica a ${distanciaKm.toFixed(2).replace('.', ',')} km e está fora do raio de entrega de ${raioMaximo} km.`)
        return
      }

      const gratisAcima = Number(loja.entrega_gratis_acima || 0)
      let taxa = 0
      if (!(gratisAcima > 0 && total >= gratisAcima)) {
        const taxaMinima = Number(loja.taxa_minima_entrega ?? loja.taxa_entrega_base ?? 0)
        taxa = loja.modo_taxa_entrega === 'por_km'
          ? Math.max(taxaMinima, Number(loja.taxa_por_km || 0) * distanciaKm)
          : taxaMinima
      }
      taxa = Math.round(taxa * 100) / 100

      setFormulario((atual) => ({ ...atual, endereco: destinoCompleto }))
      setEntregaCalculada({
        valido: true,
        endereco: destinoCompleto,
        distanciaKm,
        duracaoMin: rota.duracaoMin ? Math.round(rota.duracaoMin) : null,
        taxa,
      })
    } catch (e) {
      setErroPedido(e.message || 'Não foi possível calcular a entrega agora.')
    } finally {
      setCalculandoEntrega(false)
    }
  }

  async function finalizarPedido(evento) {
    evento.preventDefault()
    setErroPedido('')

    if (!abertoAgora) {
      setErroPedido('Esta unidade está fechada no momento. Volte durante o horário de funcionamento.')
      return
    }

    if (!formulario.nome.trim() || formulario.telefone.replace(/\D/g, '').length < 10) {
      setErroPedido('Informe seu nome e um telefone válido com DDD.')
      return
    }
    if (formulario.tipo === 'entrega' && !entregaCalculada?.valido) {
      setErroPedido('Calcule a entrega pelo CEP antes de confirmar o pedido.')
      return
    }

    setEnviando(true)
    const { data, error } = await supabase.rpc('criar_pedido_publico', {
      dados: {
        estabelecimento_id: loja.id,
        cliente_nome: formulario.nome,
        cliente_telefone: formulario.telefone,
        tipo_entrega: formulario.tipo,
        endereco_entrega: formulario.endereco,
        cep_entrega: formulario.cep.replace(/\D/g, ''),
        numero_entrega: formulario.numero,
        taxa_entrega: formulario.tipo === 'entrega' ? (entregaCalculada?.taxa || 0) : 0,
        distancia_entrega_km: formulario.tipo === 'entrega' ? (entregaCalculada?.distanciaKm || null) : null,
        complemento: formulario.complemento,
        referencia: formulario.referencia,
        forma_pagamento: formulario.pagamento,
        troco_para: formulario.troco,
        observacao: carrinho
          .filter((item) => item.observacaoItem)
          .map((item) => `${item.quantidade}x ${item.nome}: ${item.observacaoItem}`)
          .join(' | '),
        itens: carrinho.map((item) => ({ produto_id: item.id, quantidade: item.quantidade, observacao: item.observacaoItem || '', adicionais: (item.adicionaisEscolhidos || []).map((a) => ({ id: a.id })) })),
      },
    })
    setEnviando(false)

    if (error) {
      setErroPedido(error.message || 'Não foi possível enviar o pedido.')
      return
    }

    setPedidoCriado(data)
    setCarrinho([])
  }

  if (carregando) return <TelaCentral texto="Carregando cardápio..." />
  if (erro) return <TelaCentral texto={erro} erro />

  return (
    <div
      className={`app modelo-${loja.modelo_visual || 'kodvexa'}`}
      style={{
        '--cor-loja': loja.cor_principal || '#3109d3',
      }}
    >
      <header
        className={`hero ${(loja.capa_url || loja.fundo_gif_url) ? 'com-capa' : ''}`}
        style={(loja.capa_url || loja.fundo_gif_url)
          ? { backgroundImage: `url("${loja.capa_url || loja.fundo_gif_url}")` }
          : undefined}
      >
        <div className="hero__overlay" />      </header>

      <main className="limite conteudo">
        <style>{"          .categorias-filtro {\n            display: flex;\n            gap: 9px;\n            overflow-x: auto;\n            padding: 2px 0 6px;\n            scrollbar-width: none;\n          }\n\n          .categorias-filtro::-webkit-scrollbar {\n            display: none;\n          }\n\n          .loja-mobile-nav {\n            display: none;\n          }\n\n\n          .hero {\n            position: relative;\n            overflow: hidden;\n          }\n\n          .hero__overlay {\n            background:\n              linear-gradient(180deg, rgba(7,12,20,.00) 38%, rgba(7,12,20,.10) 66%, rgba(7,12,20,.48) 100%) !important;\n          }\n\n          .loja-identidade {\n            display: grid;\n            grid-template-columns: 58px minmax(0,1fr);\n            gap: 12px;\n            align-items: center;\n            margin: 0 0 12px;\n            padding: 12px 14px;\n            border: 1px solid #e1e7ef;\n            border-radius: 18px;\n            background: rgba(255,255,255,.98);\n            box-shadow: 0 10px 24px rgba(20,34,51,.07);\n          }\n\n          .loja-identidade__logo {\n            width: 58px;\n            height: 58px;\n            display: grid;\n            place-items: center;\n            overflow: hidden;\n            border: 1px solid #e5eaf0;\n            border-radius: 16px;\n            background: #0b1420;\n          }\n\n          .loja-identidade__logo img {\n            width: 100%;\n            height: 100%;\n            object-fit: cover;\n          }\n\n          .loja-identidade__texto {\n            min-width: 0;\n          }\n\n          .loja-identidade__texto > span {\n            display: block;\n            margin-bottom: 3px;\n            color: #8b98a9;\n            font-size: .58rem;\n            font-weight: 900;\n            letter-spacing: .10em;\n            text-transform: uppercase;\n          }\n\n          .loja-identidade__texto h1 {\n            margin: 0 0 7px;\n            overflow: hidden;\n            color: #152033;\n            font-size: 1.08rem;\n            line-height: 1.1;\n            text-overflow: ellipsis;\n            white-space: nowrap;\n          }\n\n          .loja-identidade__meta {\n            display: flex;\n            align-items: center;\n            gap: 7px;\n            flex-wrap: wrap;\n          }\n\n          .loja-identidade__meta span {\n            min-height: 25px;\n            display: inline-flex;\n            align-items: center;\n            gap: 5px;\n            padding: 0 8px;\n            border-radius: 999px;\n            background: #f3f6f9;\n            color: #6a788b;\n            font-size: .65rem;\n            font-weight: 800;\n          }\n\n          .loja-identidade__meta span.aberto {\n            background: #eefbf3;\n            color: #15803d;\n          }\n\n          .loja-identidade__meta span.fechado {\n            background: #fff0f1;\n            color: #c24145;\n          }\n\n          .loja-identidade__meta i {\n            width: 7px;\n            height: 7px;\n            border-radius: 50%;\n            background: currentColor;\n          }\n\n          .categorias-clean {\n            gap: 8px !important;\n          }\n\n          .categorias-clean button {\n            min-height: 38px !important;\n            padding: 0 15px !important;\n            border: 1px solid #dce4ee !important;\n            border-radius: 999px !important;\n            background: rgba(255,255,255,.97) !important;\n            color: #1b2638 !important;\n            box-shadow: 0 4px 12px rgba(20,34,51,.05) !important;\n          }\n\n          .categorias-clean button::before,\n          .categorias-clean button::after {\n            display: none !important;\n          }\n\n          .categorias-clean button.ativo {\n            border-color: color-mix(in srgb, var(--cor-loja) 44%, #dce4ee) !important;\n            background: color-mix(in srgb, var(--cor-loja) 9%, #fff) !important;\n            color: var(--cor-loja) !important;\n            box-shadow: 0 6px 14px color-mix(in srgb, var(--cor-loja) 10%, transparent) !important;\n          }\n\n\n          @property --led-angle {\n            syntax: '<angle>';\n            initial-value: 0deg;\n            inherits: false;\n          }\n\n          .vitrine-destaques {\n            position: relative;\n            margin: 12px 0 26px;\n            padding: 15px 14px 14px;\n            border: 1px solid rgba(225,231,239,.95);\n            border-radius: 22px;\n            background:\n              radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--cor-loja) 9%, transparent), transparent 38%),\n              linear-gradient(180deg, rgba(255,255,255,.98), rgba(248,250,253,.96));\n            box-shadow: 0 12px 30px rgba(20,34,51,.07);\n            overflow: hidden;\n          }\n\n          .vitrine-destaques::after {\n            content: '';\n            position: absolute;\n            inset: 0;\n            pointer-events: none;\n            border-radius: inherit;\n            box-shadow: inset 0 1px 0 rgba(255,255,255,.8);\n          }\n\n          .vitrine-destaques__topo {\n            position: relative;\n            z-index: 2;\n            display: flex;\n            align-items: flex-end;\n            justify-content: space-between;\n            gap: 12px;\n            margin-bottom: 13px;\n          }\n\n          .vitrine-destaques__selo {\n            display: inline-flex;\n            align-items: center;\n            gap: 6px;\n            min-height: 27px;\n            padding: 0 10px;\n            border: 1px solid color-mix(in srgb, var(--cor-loja) 20%, #dfe6ef);\n            border-radius: 999px;\n            background: color-mix(in srgb, var(--cor-loja) 8%, #fff);\n            color: var(--cor-loja);\n            font-size: .68rem;\n            font-weight: 900;\n            letter-spacing: .02em;\n          }\n\n          .vitrine-destaques h2 {\n            margin: 7px 0 3px;\n            color: #111827;\n            font-size: 1.22rem;\n            line-height: 1.15;\n            letter-spacing: -.02em;\n          }\n\n          .vitrine-destaques p {\n            margin: 0;\n            color: #7d899b;\n            font-size: .79rem;\n          }\n\n          .vitrine-destaques__lista {\n            position: relative;\n            z-index: 2;\n            display: grid;\n            grid-auto-flow: column;\n            grid-auto-columns: minmax(220px, 260px);\n            gap: 13px;\n            overflow-x: auto;\n            padding: 2px 2px 9px;\n            scroll-snap-type: x proximity;\n            scrollbar-width: none;\n          }\n\n          .vitrine-destaques__lista::-webkit-scrollbar {\n            display: none;\n          }\n\n          .vitrine-destaques__card {\n            --led-angle: 0deg;\n            position: relative;\n            isolation: isolate;\n            overflow: hidden;\n            display: grid;\n            grid-template-rows: 134px auto;\n            min-width: 0;\n            padding: 2px;\n            border: 0;\n            border-radius: 20px;\n            background:\n              conic-gradient(\n                from var(--led-angle),\n                transparent 0deg 250deg,\n                color-mix(in srgb, var(--cor-loja) 80%, #7c3aed) 280deg,\n                #8fb8ff 305deg,\n                transparent 335deg 360deg\n              );\n            box-shadow:\n              0 12px 28px rgba(20,34,51,.09),\n              0 0 0 1px rgba(215,224,235,.65);\n            text-align: left;\n            scroll-snap-align: start;\n            cursor: pointer;\n            animation: ledCardRound 4.2s linear infinite;\n          }\n\n          .vitrine-destaques__card::before {\n            content: '';\n            position: absolute;\n            z-index: -1;\n            inset: 2px;\n            border-radius: 18px;\n            background: #fff;\n          }\n\n          .vitrine-destaques__card::after {\n            content: '';\n            position: absolute;\n            z-index: 3;\n            inset: 0;\n            pointer-events: none;\n            border-radius: inherit;\n            box-shadow:\n              inset 0 0 0 1px rgba(255,255,255,.5),\n              0 0 18px color-mix(in srgb, var(--cor-loja) 10%, transparent);\n          }\n\n          @keyframes ledCardRound {\n            to { --led-angle: 360deg; }\n          }\n\n          .vitrine-destaques__imagem {\n            position: relative;\n            overflow: hidden;\n            display: grid;\n            place-items: center;\n            margin: 2px 2px 0;\n            border-radius: 16px 16px 10px 10px;\n            background: #f4f6f9;\n          }\n\n          .vitrine-destaques__imagem img {\n            width: 100%;\n            height: 100%;\n            object-fit: cover;\n            transition: transform .28s ease;\n          }\n\n          .vitrine-destaques__card:active .vitrine-destaques__imagem img {\n            transform: scale(1.025);\n          }\n\n          .vitrine-destaques__badge {\n            position: absolute;\n            top: 10px;\n            left: 10px;\n            min-height: 25px;\n            display: inline-flex;\n            align-items: center;\n            padding: 0 9px;\n            border: 1px solid rgba(255,255,255,.45);\n            border-radius: 999px;\n            background: rgba(19,31,49,.88);\n            color: #fff;\n            font-size: .6rem;\n            font-weight: 950;\n            letter-spacing: .07em;\n            box-shadow: 0 7px 18px rgba(10,19,31,.18);\n            backdrop-filter: blur(8px);\n          }\n\n          .vitrine-destaques__conteudo {\n            position: relative;\n            z-index: 1;\n            display: grid;\n            gap: 5px;\n            margin: 0 2px 2px;\n            padding: 12px 13px 13px;\n            border-radius: 10px 10px 16px 16px;\n            background: #fff;\n          }\n\n          .vitrine-destaques__conteudo > strong {\n            overflow: hidden;\n            color: #131d2e;\n            font-size: .94rem;\n            text-overflow: ellipsis;\n            white-space: nowrap;\n          }\n\n          .vitrine-destaques__conteudo > small {\n            min-height: 34px;\n            display: -webkit-box;\n            overflow: hidden;\n            color: #7c8ba0;\n            font-size: .72rem;\n            line-height: 1.35;\n            -webkit-line-clamp: 2;\n            -webkit-box-orient: vertical;\n          }\n\n          .vitrine-destaques__precos {\n            display: flex;\n            align-items: baseline;\n            gap: 8px;\n            margin-top: 4px;\n          }\n\n          .vitrine-destaques__precos del {\n            color: #9aa6b7;\n            font-size: .69rem;\n          }\n\n          .vitrine-destaques__precos b {\n            color: var(--cor-loja);\n            font-size: .96rem;\n            font-weight: 900;\n          }\n\n          .loja-mobile-nav.oculto-modal {\n            display: none !important;\n          }\n\n          .categorias-filtro button {\n            flex: 0 0 auto;\n            min-height: 40px;\n            padding: 0 16px;\n            border: 1px solid #dbe3ee;\n            border-radius: 999px;\n            background: #fff;\n            color: #192235;\n            font: inherit;\n            font-size: .88rem;\n            font-weight: 800;\n            cursor: pointer;\n            transition: .18s ease;\n          }\n\n          .categorias-filtro button.ativo {\n            border-color: var(--cor-loja);\n            background: var(--cor-loja);\n            color: #fff;\n            box-shadow: 0 7px 18px color-mix(in srgb, var(--cor-loja) 24%, transparent);\n          }\n\n\n          .categorias-led {\n            gap: 10px;\n          }\n\n          .categorias-led button {\n            position: relative;\n            isolation: isolate;\n            display: inline-flex;\n            align-items: center;\n            gap: 8px;\n            overflow: hidden;\n          }\n\n          .categorias-led button::before {\n            content: '';\n            position: absolute;\n            z-index: -2;\n            inset: -1px;\n            border-radius: inherit;\n            background:\n              linear-gradient(\n                110deg,\n                transparent 0 22%,\n                color-mix(in srgb, var(--cor-loja) 55%, #7c3aed) 32%,\n                transparent 42% 100%\n              );\n            background-size: 220% 100%;\n            background-position: 140% 0;\n            opacity: 0;\n            transition: opacity .18s ease;\n          }\n\n          .categorias-led button::after {\n            content: '';\n            position: absolute;\n            z-index: -1;\n            inset: 1px;\n            border-radius: inherit;\n            background: rgba(255,255,255,.98);\n          }\n\n          .categorias-led button.ativo::before {\n            opacity: 1;\n            animation: categoriaLedMove 3.2s linear infinite;\n          }\n\n          .categorias-led button.ativo::after {\n            background:\n              linear-gradient(\n                135deg,\n                color-mix(in srgb, var(--cor-loja) 88%, #2f2bff),\n                color-mix(in srgb, var(--cor-loja) 70%, #7c3aed)\n              );\n          }\n\n          .categorias-led button.ativo {\n            border-color: transparent !important;\n            background: transparent !important;\n            color: #fff !important;\n            box-shadow:\n              0 8px 18px color-mix(in srgb, var(--cor-loja) 22%, transparent),\n              0 0 0 1px color-mix(in srgb, var(--cor-loja) 14%, transparent) !important;\n          }\n\n          .categoria-led__icone {\n            width: 25px;\n            height: 25px;\n            display: grid;\n            place-items: center;\n            flex: 0 0 25px;\n            border-radius: 9px;\n            background: #f4f7fb;\n            color: #50637b;\n          }\n\n          .categorias-led button.ativo .categoria-led__icone {\n            background: rgba(255,255,255,.14);\n            color: #fff;\n            box-shadow: inset 0 0 0 1px rgba(255,255,255,.15);\n          }\n\n          .categoria-led__letra {\n            font-size: .72rem;\n            line-height: 1;\n            font-weight: 950;\n            letter-spacing: .01em;\n          }\n\n          @keyframes categoriaLedMove {\n            from { background-position: 140% 0; }\n            to { background-position: -120% 0; }\n          }\n\n          @media (prefers-reduced-motion: reduce) {\n            .categorias-led button.ativo::before {\n              animation: none !important;\n            }\n          }\n\n          @media (max-width: 600px) {\n            .conteudo {\n              padding-top: 0 !important;\n            }\n\n            .hero {\n              min-height: 215px !important;\n              max-height: 215px !important;\n              margin-bottom: 42px !important;\n            }\n\n            .hero-store-card {\n              right: 10px !important;\n              bottom: -36px !important;\n              left: 10px !important;\n              min-height: 74px !important;\n              padding: 10px 12px !important;\n              border-radius: 17px !important;\n            }\n\n            .hero-store-card__logo {\n              width: 50px !important;\n              height: 50px !important;\n              flex-basis: 50px !important;\n            }\n\n            .hero-store-card__texto h1 {\n              font-size: 1rem !important;\n            }\n\n            .hero-clean__status,\n            .hero-clean__tempo {\n              min-height: 25px !important;\n              padding: 0 8px !important;\n              font-size: .65rem !important;\n            }\n\n            .modal-produto .modal-produto__midia {\n              max-height: 260px !important;\n            }\n\n            .modal-produto .modal-produto__midia img {\n              object-fit: contain !important;\n              background: #fff !important;\n            }\n\n            .modal-produto {\n              max-height: 92dvh !important;\n              display: flex !important;\n              flex-direction: column !important;\n              overflow: hidden !important;\n              padding-bottom: 0 !important;\n            }\n\n            .modal-produto__midia {\n              flex: 0 0 auto !important;\n            }\n\n            .modal-produto__conteudo {\n              flex: 1 1 auto !important;\n              min-height: 0 !important;\n              overflow-y: auto !important;\n              padding-bottom: 0 !important;\n              overscroll-behavior: contain;\n            }\n\n            .modal-produto__rodape {\n              position: sticky !important;\n              z-index: 30 !important;\n              bottom: 0 !important;\n              display: grid !important;\n              grid-template-columns: 108px minmax(0, 1fr) !important;\n              gap: 8px !important;\n              margin: 18px -16px 0 !important;\n              padding: 10px 12px calc(10px + env(safe-area-inset-bottom)) !important;\n              border-top: 1px solid #e7ebf2 !important;\n              background: rgba(255,255,255,.99) !important;\n              box-shadow: 0 -8px 22px rgba(20,34,51,.08) !important;\n              backdrop-filter: blur(12px);\n            }\n\n            .adicionar-produto {\n              min-height: 52px !important;\n              border-radius: 14px !important;\n            }\n\n            .quantidade-produto {\n              min-height: 52px !important;\n              border-radius: 14px !important;\n            }\n\n            .busca {\n              position: relative;\n              z-index: 5;\n              margin-top: 0 !important;\n              margin-bottom: 12px !important;\n              min-height: 52px !important;\n              border: 1px solid rgba(205,214,226,.82) !important;\n              border-radius: 16px !important;\n              background: rgba(255,255,255,.96) !important;\n              box-shadow: 0 10px 30px rgba(24,35,52,.12) !important;\n              backdrop-filter: blur(12px);\n            }\n\n            .busca input {\n              font-size: .93rem !important;\n            }\n\n            .categorias-filtro {\n              margin: 0 -6px 24px !important;\n              padding: 4px 6px 8px !important;\n              gap: 8px !important;\n              overflow-x: auto;\n              scroll-snap-type: x proximity;\n            }\n\n            .categorias-filtro button {\n              min-height: 46px;\n              padding: 0 13px 0 10px;\n              border-color: #d7dfeb !important;\n              background: rgba(255,255,255,.94) !important;\n              color: #182235 !important;\n              font-size: .8rem;\n              font-weight: 850;\n              box-shadow: 0 5px 14px rgba(17,31,48,.06);\n              scroll-snap-align: start;\n            }\n\n            .categorias-filtro button.ativo {\n              border-color: var(--cor-loja) !important;\n              background: linear-gradient(135deg, var(--cor-loja), color-mix(in srgb, var(--cor-loja) 78%, #7b3cff)) !important;\n              color: #fff !important;\n              box-shadow: 0 8px 18px color-mix(in srgb, var(--cor-loja) 24%, transparent) !important;\n              transform: translateY(-1px);\n            }\n\n            .secao {\n              margin-top: 0 !important;\n              padding-top: 0 !important;\n            }\n\n            .secao__titulo {\n              margin-bottom: 14px !important;\n              padding: 0 2px !important;\n              align-items: flex-end !important;\n            }\n\n            .secao__titulo h2 {\n              margin: 0 !important;\n              color: #121a2a !important;\n              font-size: 1.28rem !important;\n              line-height: 1.1 !important;\n            }\n\n            .secao__titulo p {\n              margin-top: 5px !important;\n              color: #7b8aa2 !important;\n              font-size: .82rem !important;\n            }\n\n            .secao__titulo > span {\n              display: none !important;\n            }\n\n            .produtos {\n              display: grid !important;\n              gap: 12px !important;\n            }\n\n            .produto {\n              min-height: 126px !important;\n              grid-template-columns: minmax(0,1fr) 104px !important;\n              gap: 12px !important;\n              padding: 14px !important;\n              border: 1px solid #e1e7ef !important;\n              border-radius: 20px !important;\n              background:\n                linear-gradient(145deg, rgba(255,255,255,.99), rgba(248,250,253,.98)) !important;\n              box-shadow:\n                0 8px 20px rgba(20,34,51,.07),\n                inset 0 1px 0 rgba(255,255,255,.9) !important;\n              overflow: hidden;\n            }\n\n            .produto:active {\n              transform: scale(.992);\n            }\n\n            .produto__texto {\n              align-self: stretch !important;\n              display: flex !important;\n              flex-direction: column !important;\n              min-width: 0;\n            }\n\n            .produto__texto .destaque {\n              width: max-content;\n              margin-bottom: 7px !important;\n              padding: 4px 8px !important;\n              border-radius: 999px !important;\n              background: color-mix(in srgb, var(--cor-loja) 10%, #fff) !important;\n              color: var(--cor-loja) !important;\n              font-size: .62rem !important;\n              letter-spacing: .05em;\n            }\n\n            .produto__texto h3 {\n              margin: 0 0 5px !important;\n              color: #111a2a !important;\n              font-size: .98rem !important;\n              line-height: 1.15 !important;\n            }\n\n            .produto__texto p {\n              display: -webkit-box !important;\n              margin: 0 0 8px !important;\n              overflow: hidden !important;\n              color: #7d8ba1 !important;\n              font-size: .78rem !important;\n              line-height: 1.35 !important;\n              -webkit-box-orient: vertical;\n              -webkit-line-clamp: 2;\n            }\n\n            .produto__texto b {\n              margin-top: auto !important;\n              color: #111a2a !important;\n              font-size: .92rem !important;\n            }\n\n            .produto__imagem {\n              width: 104px !important;\n              height: 98px !important;\n              align-self: center !important;\n              border: 1px solid #eef1f5 !important;\n              border-radius: 16px !important;\n              background: #f8fafc !important;\n              box-shadow: inset 0 1px 0 rgba(255,255,255,.8);\n              overflow: hidden;\n            }\n\n            .produto__imagem img {\n              width: 100% !important;\n              height: 100% !important;\n              object-fit: cover !important;\n            }\n\n            .produto__seta {\n              right: 8px !important;\n              bottom: 8px !important;\n              width: 17px !important;\n              color: #9ba9ba !important;\n            }\n\n            .barra-carrinho {\n              right: 12px !important;\n              bottom: 12px !important;\n              left: 12px !important;\n              width: auto !important;\n              min-height: 58px !important;\n              border-radius: 18px !important;\n              box-shadow: 0 16px 35px color-mix(in srgb, var(--cor-loja) 28%, rgba(0,0,0,.22)) !important;\n            }\n\n            .barra-carrinho .bolha {\n              width: 34px !important;\n              height: 34px !important;\n              border-radius: 10px !important;\n              background: rgba(255,255,255,.16) !important;\n            }\n\n\n            .conteudo {\n              padding-bottom: 98px !important;\n            }\n\n\n            .vitrine-destaques {\n              margin: 0 -2px 24px !important;\n              padding: 14px 10px 12px !important;\n              border-radius: 20px !important;\n            }\n\n            .vitrine-destaques__topo {\n              margin-bottom: 11px !important;\n            }\n\n            .vitrine-destaques h2 {\n              font-size: 1.17rem !important;\n            }\n\n            .vitrine-destaques__lista {\n              grid-auto-columns: minmax(205px, 74vw) !important;\n              margin-right: -12px;\n              padding-right: 12px;\n            }\n\n            .vitrine-destaques__card {\n              grid-template-rows: 128px auto !important;\n              border-radius: 18px !important;\n            }\n\n            .secao + .secao {\n              margin-top: 22px !important;\n            }\n\n            .secao {\n              position: relative;\n              margin-right: -10px !important;\n              margin-left: -10px !important;\n              padding: 16px 10px 18px !important;\n              border-top: 1px solid #e4eaf1 !important;\n              border-bottom: 1px solid #e4eaf1 !important;\n              background:\n                linear-gradient(180deg, rgba(244,247,251,.98), rgba(239,244,249,.92)) !important;\n            }\n\n            .secao:first-of-type {\n              border-top: 0 !important;\n              border-radius: 18px 18px 0 0;\n            }\n\n            .secao__titulo {\n              position: relative;\n              margin-bottom: 13px !important;\n              padding: 0 2px 0 10px !important;\n            }\n\n            .secao__titulo::before {\n              content: '';\n              position: absolute;\n              top: 1px;\n              bottom: 1px;\n              left: 0;\n              width: 4px;\n              border-radius: 999px;\n              background: var(--cor-loja);\n            }\n\n            .secao__titulo h2 {\n              font-size: 1.18rem !important;\n              letter-spacing: -.02em;\n            }\n\n            .secao__titulo p {\n              margin-top: 4px !important;\n            }\n\n            .produto {\n              border: 1px solid rgba(217,225,235,.96) !important;\n              border-radius: 18px !important;\n              background: rgba(255,255,255,.98) !important;\n              box-shadow: 0 7px 18px rgba(20,34,51,.065) !important;\n            }\n\n            .produto__imagem {\n              border-radius: 17px !important;\n            }\n\n            .loja-mobile-nav {\n              position: fixed;\n              z-index: 90;\n              right: 8px;\n              bottom: 8px;\n              left: 8px;\n              display: grid;\n              grid-template-columns: repeat(4, 1fr);\n              min-height: 66px;\n              padding: 6px 5px max(6px, env(safe-area-inset-bottom));\n              border: 1px solid rgba(216,224,234,.96);\n              border-radius: 21px;\n              background: rgba(255,255,255,.97);\n              box-shadow: 0 16px 42px rgba(20,34,51,.20);\n              backdrop-filter: blur(16px);\n            }\n\n            .loja-mobile-nav button {\n              position: relative;\n              display: flex;\n              flex-direction: column;\n              align-items: center;\n              justify-content: center;\n              gap: 4px;\n              min-width: 0;\n              border: 0;\n              border-radius: 15px;\n              background: transparent;\n              color: #7a8798;\n              font: inherit;\n            }\n\n            .loja-mobile-nav button span {\n              font-size: .66rem;\n              font-weight: 800;\n            }\n\n            .loja-mobile-nav button.ativo,\n            .loja-mobile-nav button.tem-itens {\n              color: var(--cor-loja);\n            }\n\n            .loja-mobile-nav button.ativo {\n              background: color-mix(in srgb, var(--cor-loja) 9%, #fff);\n            }\n\n            .loja-mobile-nav button b {\n              position: absolute;\n              top: 3px;\n              left: calc(50% + 7px);\n              display: grid;\n              place-items: center;\n              min-width: 18px;\n              height: 18px;\n              padding: 0 4px;\n              border: 2px solid #fff;\n              border-radius: 999px;\n              background: var(--cor-loja);\n              color: #fff;\n              font-size: .58rem;\n            }\n\n            .barra-carrinho {\n              display: none !important;\n            }\n          }\n\n          @media (prefers-reduced-motion: reduce) {\n            .vitrine-destaques__card {\n              animation: none !important;\n            }\n          }\n\n          .vitrine-destaques {\n            margin: 8px 0 26px !important;\n            padding: 0 !important;\n            border: 0 !important;\n            border-radius: 0 !important;\n            background: transparent !important;\n            box-shadow: none !important;\n            overflow: visible !important;\n          }\n\n          .vitrine-destaques::after {\n            display: none !important;\n          }\n\n          .vitrine-destaques__topo {\n            margin-bottom: 12px !important;\n            padding: 0 2px !important;\n          }\n\n          .vitrine-destaques__selo {\n            min-height: 24px !important;\n            padding: 0 9px !important;\n            border: 1px solid #e0e7f1 !important;\n            background: #f5f7fb !important;\n            color: #52647d !important;\n            box-shadow: none !important;\n          }\n\n          .vitrine-destaques h2 {\n            margin-top: 6px !important;\n            font-size: 1.17rem !important;\n          }\n\n          .vitrine-destaques p {\n            max-width: 320px;\n            font-size: .76rem !important;\n          }\n\n          .vitrine-destaques__lista {\n            grid-auto-columns: minmax(270px, 82vw) !important;\n            gap: 12px !important;\n            padding: 0 10px 8px 2px !important;\n          }\n\n          .vitrine-destaques__card {\n            grid-template-rows: 150px auto !important;\n            padding: 0 !important;\n            border: 1px solid #e1e7ef !important;\n            border-radius: 22px !important;\n            background: #fff !important;\n            box-shadow: 0 12px 26px rgba(20,34,51,.08) !important;\n            animation: none !important;\n          }\n\n          .vitrine-destaques__card::before,\n          .vitrine-destaques__card::after {\n            display: none !important;\n          }\n\n          .vitrine-destaques__imagem {\n            margin: 0 !important;\n            border-radius: 21px 21px 0 0 !important;\n          }\n\n          .vitrine-destaques__imagem::after {\n            content: '';\n            position: absolute;\n            inset: auto 0 0 0;\n            height: 42%;\n            pointer-events: none;\n            background: linear-gradient(180deg, transparent, rgba(9,16,27,.30));\n          }\n\n          .vitrine-destaques__badge {\n            top: 11px !important;\n            left: 11px !important;\n            min-height: 24px !important;\n            padding: 0 9px !important;\n            border: 0 !important;\n            background: rgba(10,18,29,.78) !important;\n            font-size: .58rem !important;\n            backdrop-filter: blur(10px);\n          }\n\n          .vitrine-destaques__conteudo {\n            margin: 0 !important;\n            padding: 12px 14px 14px !important;\n            border-radius: 0 0 21px 21px !important;\n          }\n\n          .vitrine-destaques__conteudo > strong {\n            font-size: .98rem !important;\n          }\n\n          .vitrine-destaques__conteudo > small {\n            min-height: 30px !important;\n            font-size: .71rem !important;\n          }\n\n          .vitrine-destaques__precos {\n            justify-content: space-between;\n            align-items: center;\n            margin-top: 4px !important;\n          }\n\n          .vitrine-destaques__precos b {\n            font-size: 1rem !important;\n          }\n\n          .vitrine-destaques__precos::after {\n            content: '+';\n            width: 30px;\n            height: 30px;\n            display: grid;\n            place-items: center;\n            border-radius: 10px;\n            background: color-mix(in srgb, var(--cor-loja) 10%, #fff);\n            color: var(--cor-loja);\n            font-size: 1.1rem;\n            font-weight: 900;\n          }\n\n          .categorias-clean {\n            position: relative;\n            padding-bottom: 8px !important;\n          }\n\n          .categorias-clean::after {\n            content: '';\n            position: absolute;\n            right: 0;\n            bottom: 0;\n            left: 0;\n            height: 1px;\n            background: linear-gradient(90deg, transparent, #e7edf4 15%, #e7edf4 85%, transparent);\n          }\n\n          @media (max-width: 600px) {\n            .hero {\n              min-height: 215px !important;\n              max-height: 215px !important;\n              margin-bottom: 0 !important;\n            }\n\n            .hero-signature {\n              right: 12px !important;\n              bottom: 12px !important;\n              left: 12px !important;\n              grid-template-columns: 48px minmax(0,1fr) !important;\n              padding: 9px 10px !important;\n              border-radius: 16px !important;\n            }\n\n            .hero-signature__logo {\n              width: 48px !important;\n              height: 48px !important;\n            }\n\n            .hero-signature__texto h1 {\n              font-size: 1rem !important;\n            }\n\n            .hero-signature__meta {\n              font-size: .62rem !important;\n            }\n\n            .loja-identidade {\n              grid-template-columns: 52px minmax(0,1fr) !important;\n              margin: 10px 0 10px !important;\n              padding: 10px 11px !important;\n              border-radius: 16px !important;\n            }\n\n            .loja-identidade__logo {\n              width: 52px !important;\n              height: 52px !important;\n            }\n\n            .loja-identidade__texto h1 {\n              font-size: 1rem !important;\n            }\n\n            .busca {\n              margin-top: 0 !important;\n              margin-bottom: 12px !important;\n              border-radius: 15px !important;\n            }\n\n            .categorias-filtro {\n              margin-bottom: 22px !important;\n            }\n\n            .vitrine-destaques {\n              margin-top: 0 !important;\n            }\n          }\n\n          /* LED dos cards de destaque: mantém o layout atual e restaura a luz correndo na borda */\n          .vitrine-destaques__card {\n            --led-angle: 0deg;\n            padding: 2px !important;\n            border: 0 !important;\n            background:\n              conic-gradient(\n                from var(--led-angle),\n                transparent 0deg 238deg,\n                color-mix(in srgb, var(--cor-loja) 88%, #5b5cff) 270deg,\n                #a8c7ff 296deg,\n                color-mix(in srgb, var(--cor-loja) 78%, #8b5cf6) 314deg,\n                transparent 342deg 360deg\n              ) !important;\n            box-shadow:\n              0 12px 26px rgba(20,34,51,.08),\n              0 0 15px color-mix(in srgb, var(--cor-loja) 10%, transparent) !important;\n            animation: ledCardRound 3.8s linear infinite !important;\n          }\n\n          .vitrine-destaques__imagem {\n            margin: 0 !important;\n            border-radius: 20px 20px 0 0 !important;\n          }\n\n          .vitrine-destaques__conteudo {\n            margin: 0 !important;\n            border-radius: 0 0 20px 20px !important;\n            background: #fff !important;\n          }\n\n          @media (prefers-reduced-motion: reduce) {\n            .vitrine-destaques__card {\n              animation: none !important;\n            }\n          }\n\n\n          /* RESTAURA APENAS O LED DAS CATEGORIAS */\n          .categorias-clean button {\n            position: relative !important;\n            isolation: isolate !important;\n            overflow: hidden !important;\n            border: 1px solid #dce4ee !important;\n            background: rgba(255,255,255,.97) !important;\n            color: #1b2638 !important;\n          }\n\n          .categorias-clean button::before {\n            content: '' !important;\n            display: block !important;\n            position: absolute !important;\n            z-index: -2 !important;\n            inset: -1px !important;\n            border-radius: inherit !important;\n            background:\n              conic-gradient(\n                from var(--cat-led-angle, 0deg),\n                transparent 0deg 245deg,\n                color-mix(in srgb, var(--cor-loja) 90%, #536dff) 272deg,\n                #a9c7ff 298deg,\n                color-mix(in srgb, var(--cor-loja) 78%, #8b5cf6) 318deg,\n                transparent 345deg 360deg\n              ) !important;\n            opacity: 0 !important;\n          }\n\n          .categorias-clean button::after {\n            content: '' !important;\n            display: block !important;\n            position: absolute !important;\n            z-index: -1 !important;\n            inset: 2px !important;\n            border-radius: calc(999px - 2px) !important;\n            background: rgba(255,255,255,.98) !important;\n          }\n\n          .categorias-clean button.ativo {\n            border-color: transparent !important;\n            background: transparent !important;\n            color: var(--cor-loja) !important;\n            box-shadow:\n              0 6px 14px color-mix(in srgb, var(--cor-loja) 12%, transparent),\n              0 0 12px color-mix(in srgb, var(--cor-loja) 8%, transparent) !important;\n          }\n\n          .categorias-clean button.ativo::before {\n            opacity: 1 !important;\n            animation: categoriaLedVolta 3.2s linear infinite !important;\n          }\n\n          .categorias-clean button.ativo::after {\n            background: color-mix(in srgb, var(--cor-loja) 7%, #fff) !important;\n          }\n\n          @keyframes categoriaLedVolta {\n            from { --cat-led-angle: 0deg; }\n            to { --cat-led-angle: 360deg; }\n          }\n\n          @media (prefers-reduced-motion: reduce) {\n            .categorias-clean button.ativo::before {\n              animation: none !important;\n            }\n          }\n\n\n          /* CARD DE VIDRO DA LOJA: sobrepõe levemente o GIF sem esconder o fundo */\n          .loja-identidade {\n            position: relative !important;\n            z-index: 12 !important;\n            grid-template-columns: 58px minmax(0, 1fr) !important;\n            gap: 12px !important;\n            margin: -44px 10px 14px !important;\n            padding: 12px 14px !important;\n            border: 1px solid rgba(255,255,255,.28) !important;\n            border-radius: 20px !important;\n            background:\n              linear-gradient(\n                135deg,\n                rgba(31, 22, 22, .54),\n                rgba(43, 31, 30, .38)\n              ) !important;\n            box-shadow:\n              0 14px 34px rgba(20, 12, 12, .22),\n              inset 0 1px 0 rgba(255,255,255,.18) !important;\n            backdrop-filter: blur(13px) saturate(125%) !important;\n            -webkit-backdrop-filter: blur(13px) saturate(125%) !important;\n            overflow: hidden !important;\n          }\n\n          .loja-identidade::before {\n            content: '' !important;\n            position: absolute !important;\n            inset: 0 !important;\n            pointer-events: none !important;\n            border-radius: inherit !important;\n            background:\n              radial-gradient(circle at 18% 20%, rgba(255,255,255,.12), transparent 34%),\n              linear-gradient(115deg, rgba(255,255,255,.07), transparent 42%) !important;\n          }\n\n          .loja-identidade__logo,\n          .loja-identidade__texto {\n            position: relative !important;\n            z-index: 2 !important;\n          }\n\n          .loja-identidade__logo {\n            width: 58px !important;\n            height: 58px !important;\n            border: 1px solid rgba(255,255,255,.32) !important;\n            border-radius: 16px !important;\n            background: rgba(8,12,18,.62) !important;\n            box-shadow:\n              0 8px 18px rgba(0,0,0,.18),\n              0 0 0 3px rgba(255,255,255,.04) !important;\n          }\n\n          .loja-identidade__texto > span {\n            color: rgba(255,255,255,.66) !important;\n          }\n\n          .loja-identidade__texto h1 {\n            color: #fff !important;\n            text-shadow: 0 2px 10px rgba(0,0,0,.28) !important;\n          }\n\n          .loja-identidade__meta span {\n            border: 1px solid rgba(255,255,255,.14) !important;\n            background: rgba(255,255,255,.10) !important;\n            color: rgba(255,255,255,.88) !important;\n            backdrop-filter: blur(8px) !important;\n          }\n\n          .loja-identidade__meta span.aberto {\n            border-color: rgba(59, 220, 128, .20) !important;\n            background: rgba(20, 120, 62, .34) !important;\n            color: #d8ffe7 !important;\n          }\n\n          .loja-identidade__meta span.fechado {\n            border-color: rgba(255, 107, 107, .22) !important;\n            background: rgba(140, 38, 45, .34) !important;\n            color: #ffe1e3 !important;\n          }\n\n          @media (max-width: 600px) {\n            .loja-identidade {\n              grid-template-columns: 52px minmax(0,1fr) !important;\n              margin: -42px 8px 13px !important;\n              padding: 10px 11px !important;\n              border-radius: 18px !important;\n            }\n\n            .loja-identidade__logo {\n              width: 52px !important;\n              height: 52px !important;\n            }\n\n            .loja-identidade__texto h1 {\n              font-size: 1rem !important;\n            }\n\n            .loja-identidade__texto > span {\n              font-size: .54rem !important;\n            }\n\n            .loja-identidade__meta span {\n              min-height: 24px !important;\n              padding: 0 7px !important;\n              font-size: .63rem !important;\n            }\n\n            .busca {\n              margin-top: 0 !important;\n            }\n          }\n\n\n          /* VIDRO DE PONTA A PONTA */\n          .loja-identidade {\n            width: 100% !important;\n            max-width: none !important;\n            box-sizing: border-box !important;\n            margin: -44px 0 14px !important;\n            border-left: 0 !important;\n            border-right: 0 !important;\n            border-radius: 18px 18px 0 0 !important;\n          }\n\n          @media (max-width: 600px) {\n            .loja-identidade {\n              width: 100% !important;\n              margin: -42px 0 13px !important;\n              padding-left: 14px !important;\n              padding-right: 14px !important;\n              border-radius: 18px 18px 0 0 !important;\n            }\n          }\n\n\n          /* FORÇA O VIDRO A ENCOSTAR NAS DUAS BORDAS DO CARDÁPIO */\n          .loja-identidade {\n            width: calc(100% + 24px) !important;\n            max-width: none !important;\n            margin-left: -12px !important;\n            margin-right: -12px !important;\n            box-sizing: border-box !important;\n            border-left: 0 !important;\n            border-right: 0 !important;\n            border-radius: 0 0 18px 18px !important;\n          }\n\n          @media (max-width: 600px) {\n            .loja-identidade {\n              width: calc(100% + 24px) !important;\n              margin-left: -12px !important;\n              margin-right: -12px !important;\n              padding-left: 16px !important;\n              padding-right: 16px !important;\n              border-radius: 0 0 18px 18px !important;\n            }\n          }\n\n\n          /* MODELOS VISUAIS PRONTOS KODVEXA FOOD */\n\n          .app.modelo-vitrine .conteudo {\n            background:\n              linear-gradient(180deg, #fffaf5 0%, #f6efe8 100%) !important;\n          }\n\n          .app.modelo-vitrine .produto,\n          .app.modelo-vitrine .vitrine-destaques__card {\n            border-color: #efd9c8 !important;\n            border-radius: 22px !important;\n            box-shadow: 0 10px 24px rgba(92,50,22,.08) !important;\n          }\n\n          .app.modelo-vitrine .secao {\n            background:\n              linear-gradient(180deg, rgba(255,250,245,.98), rgba(247,239,232,.94)) !important;\n            border-color: #eadbce !important;\n          }\n\n          .app.modelo-vitrine .secao__titulo::before {\n            background: #d9611c !important;\n          }\n\n          .app.modelo-vitrine .categorias-clean button.ativo,\n          .app.modelo-vitrine .categorias-filtro button.ativo {\n            color: #b94813 !important;\n            border-color: #f0b18d !important;\n            background: #fff0e5 !important;\n          }\n\n          .app.modelo-vitrine .vitrine-destaques__precos b {\n            color: #c64e16 !important;\n          }\n\n          .app.modelo-glass .conteudo {\n            background:\n              radial-gradient(circle at 50% 0%, rgba(88,129,190,.12), transparent 34%),\n              linear-gradient(180deg, #eef4fb, #e8eff7) !important;\n          }\n\n          .app.modelo-glass .busca,\n          .app.modelo-glass .produto,\n          .app.modelo-glass .vitrine-destaques__card,\n          .app.modelo-glass .loja-identidade {\n            border-color: rgba(139,162,190,.34) !important;\n            background: rgba(255,255,255,.74) !important;\n            box-shadow:\n              0 10px 28px rgba(36,57,82,.09),\n              inset 0 1px 0 rgba(255,255,255,.75) !important;\n            backdrop-filter: blur(14px) saturate(120%) !important;\n            -webkit-backdrop-filter: blur(14px) saturate(120%) !important;\n          }\n\n          .app.modelo-glass .secao {\n            background:\n              linear-gradient(180deg, rgba(240,246,252,.74), rgba(231,239,248,.70)) !important;\n            border-color: rgba(137,160,188,.26) !important;\n          }\n\n          .app.modelo-glass .categorias-clean button,\n          .app.modelo-glass .categorias-filtro button {\n            border-color: rgba(139,162,190,.34) !important;\n            background: rgba(255,255,255,.68) !important;\n            backdrop-filter: blur(10px) !important;\n          }\n\n          .app.modelo-glass .categorias-clean button.ativo,\n          .app.modelo-glass .categorias-filtro button.ativo {\n            border-color: color-mix(in srgb, var(--cor-loja) 40%, #9db0c6) !important;\n            background: color-mix(in srgb, var(--cor-loja) 8%, rgba(255,255,255,.72)) !important;\n          }\n\n\n          /* ===== MODELOS FOOD REAIS ===== */\n\n          .app.modelo-burger-house .conteudo {\n            background:\n              radial-gradient(circle at 50% 0%, rgba(255,99,26,.08), transparent 24%),\n              linear-gradient(180deg, #17110e 0%, #21150f 100%) !important;\n          }\n\n          .app.modelo-burger-house .busca,\n          .app.modelo-burger-house .produto,\n          .app.modelo-burger-house .vitrine-destaques__card,\n          .app.modelo-burger-house .secao {\n            border-color: rgba(255,129,55,.17) !important;\n            background: #251813 !important;\n            color: #fff !important;\n            box-shadow: 0 10px 26px rgba(0,0,0,.16) !important;\n          }\n\n          .app.modelo-burger-house .produto__texto h3,\n          .app.modelo-burger-house .produto__texto b,\n          .app.modelo-burger-house .secao__titulo h2,\n          .app.modelo-burger-house .vitrine-destaques h2,\n          .app.modelo-burger-house .vitrine-destaques__conteudo > strong {\n            color: #fff5ee !important;\n          }\n\n          .app.modelo-burger-house .produto__texto p,\n          .app.modelo-burger-house .secao__titulo p,\n          .app.modelo-burger-house .vitrine-destaques p,\n          .app.modelo-burger-house .vitrine-destaques__conteudo > small {\n            color: #b99f91 !important;\n          }\n\n          .app.modelo-burger-house .categorias-filtro button {\n            border-color: rgba(255,129,55,.22) !important;\n            background: #291a14 !important;\n            color: #e8d3c8 !important;\n          }\n\n          .app.modelo-burger-house .categorias-filtro button.ativo {\n            border-color: #ff6a1a !important;\n            background: #ff6a1a !important;\n            color: #fff !important;\n            box-shadow: 0 8px 18px rgba(255,106,26,.23) !important;\n          }\n\n          .app.modelo-burger-house .vitrine-destaques__precos b,\n          .app.modelo-burger-house .secao__titulo::before {\n            color: #ff7a2a !important;\n            background: #ff7a2a !important;\n          }\n\n          .app.modelo-gourmet .conteudo {\n            background:\n              linear-gradient(180deg, #fbf7f1 0%, #f3ece3 100%) !important;\n          }\n\n          .app.modelo-gourmet .produto,\n          .app.modelo-gourmet .vitrine-destaques__card {\n            border-color: #e8dccd !important;\n            border-radius: 16px !important;\n            background: #fffdf9 !important;\n            box-shadow: 0 9px 22px rgba(76,58,38,.07) !important;\n          }\n\n          .app.modelo-gourmet .secao {\n            border-color: #eadfd2 !important;\n            background: rgba(250,246,239,.90) !important;\n          }\n\n          .app.modelo-gourmet .secao__titulo::before {\n            background: #8c6c49 !important;\n          }\n\n          .app.modelo-gourmet .categorias-filtro button {\n            background: #fffdf9 !important;\n            border-color: #e6dacb !important;\n          }\n\n          .app.modelo-gourmet .categorias-filtro button.ativo {\n            background: #8c6c49 !important;\n            border-color: #8c6c49 !important;\n            color: #fff !important;\n          }\n\n          .app.modelo-gourmet .vitrine-destaques__precos b {\n            color: #7a5c3d !important;\n          }\n\n          .app.modelo-fast-food .conteudo {\n            background:\n              radial-gradient(circle at 12% 0%, rgba(255,96,40,.10), transparent 22%),\n              linear-gradient(180deg, #fffaf5 0%, #fff2e7 100%) !important;\n          }\n\n          .app.modelo-fast-food .produto,\n          .app.modelo-fast-food .vitrine-destaques__card {\n            border-color: #ffe0ce !important;\n            border-radius: 24px !important;\n            background: #fff !important;\n            box-shadow: 0 10px 24px rgba(255,91,38,.09) !important;\n          }\n\n          .app.modelo-fast-food .secao {\n            background: rgba(255,248,242,.95) !important;\n            border-color: #f8ddd0 !important;\n          }\n\n          .app.modelo-fast-food .secao__titulo::before {\n            background: #ff5426 !important;\n          }\n\n          .app.modelo-fast-food .categorias-filtro button.ativo {\n            background: linear-gradient(135deg, #ff4928, #ff8a1d) !important;\n            border-color: transparent !important;\n            color: #fff !important;\n            box-shadow: 0 8px 18px rgba(255,80,35,.20) !important;\n          }\n\n          .app.modelo-fast-food .vitrine-destaques__precos b {\n            color: #ef421e !important;\n          }\n\n          .app.modelo-night-food .conteudo {\n            background:\n              radial-gradient(circle at 50% 0%, rgba(68,93,172,.16), transparent 28%),\n              linear-gradient(180deg, #0b1220 0%, #111a2b 100%) !important;\n          }\n\n          .app.modelo-night-food .busca,\n          .app.modelo-night-food .produto,\n          .app.modelo-night-food .vitrine-destaques__card,\n          .app.modelo-night-food .loja-identidade {\n            border-color: rgba(123,145,211,.20) !important;\n            background: rgba(19,29,49,.76) !important;\n            box-shadow:\n              0 12px 28px rgba(0,0,0,.20),\n              inset 0 1px 0 rgba(255,255,255,.05) !important;\n            backdrop-filter: blur(14px) !important;\n          }\n\n          .app.modelo-night-food .produto__texto h3,\n          .app.modelo-night-food .produto__texto b,\n          .app.modelo-night-food .secao__titulo h2,\n          .app.modelo-night-food .vitrine-destaques h2,\n          .app.modelo-night-food .vitrine-destaques__conteudo > strong {\n            color: #f4f7ff !important;\n          }\n\n          .app.modelo-night-food .produto__texto p,\n          .app.modelo-night-food .secao__titulo p,\n          .app.modelo-night-food .vitrine-destaques p,\n          .app.modelo-night-food .vitrine-destaques__conteudo > small {\n            color: #91a0bd !important;\n          }\n\n          .app.modelo-night-food .secao {\n            border-color: rgba(122,145,211,.15) !important;\n            background: rgba(14,23,39,.72) !important;\n          }\n\n          .app.modelo-night-food .categorias-filtro button {\n            border-color: rgba(123,145,211,.20) !important;\n            background: rgba(255,255,255,.07) !important;\n            color: #cbd5ea !important;\n          }\n\n          .app.modelo-night-food .categorias-filtro button.ativo {\n            border-color: #6672ff !important;\n            background: #5966f2 !important;\n            color: #fff !important;\n            box-shadow: 0 0 18px rgba(89,102,242,.24) !important;\n          }\n\n          .app.modelo-clean-food .conteudo {\n            background: #f6f8fb !important;\n          }\n\n          .app.modelo-clean-food .produto,\n          .app.modelo-clean-food .vitrine-destaques__card {\n            border-color: #e5eaf0 !important;\n            border-radius: 18px !important;\n            background: #fff !important;\n            box-shadow: none !important;\n          }\n\n          .app.modelo-clean-food .secao {\n            background: #f6f8fb !important;\n            border-color: #e8edf2 !important;\n          }\n\n          .app.modelo-clean-food .secao__titulo::before {\n            background: #94a3b8 !important;\n          }\n\n          .app.modelo-clean-food .categorias-filtro button {\n            box-shadow: none !important;\n          }\n\n          .app.modelo-clean-food .categorias-filtro button.ativo {\n            background: #111827 !important;\n            border-color: #111827 !important;\n            color: #fff !important;\n            box-shadow: none !important;\n          }\n\n\n\n          /* Marmitaria & Frango: visual quente e claro para almoço */\n          .app.modelo-marmitaria .conteudo {\n            background:\n              linear-gradient(180deg, #fff9f2 0%, #f7eee5 100%) !important;\n          }\n\n          .app.modelo-marmitaria .produto,\n          .app.modelo-marmitaria .vitrine-destaques__card {\n            border-color: #ead8c7 !important;\n            background: #fffdf9 !important;\n            border-radius: 18px !important;\n            box-shadow: 0 7px 20px rgba(105,54,29,.07) !important;\n          }\n\n          .app.modelo-marmitaria .categoria-titulo::before {\n            background: #b94d25 !important;\n          }\n\n          .app.modelo-marmitaria .categorias button.ativo {\n            background: #b94d25 !important;\n            color: #fff !important;\n            border-color: #b94d25 !important;\n          }\n\n          .app.modelo-marmitaria .vitrine-destaques {\n            background: linear-gradient(145deg, #fff7ed, #fffdf9) !important;\n            border-color: #ead8c7 !important;\n          }\n\n          /* Padrão oficial KODVEXA: mantém o layout principal aprovado */\n          .app.modelo-kodvexa .conteudo {\n            background:\n              linear-gradient(180deg, #f3f6fa 0%, #edf2f7 100%) !important;\n          }\n\n          .app.modelo-kodvexa .produto,\n          .app.modelo-kodvexa .vitrine-destaques__card {\n            border-color: #e1e7ef !important;\n            background: #fff !important;\n          }\n\n\n          .loja-identidade__descricao {\n            margin: 0 0 7px !important;\n            display: -webkit-box;\n            overflow: hidden;\n            color: rgba(255,255,255,.72) !important;\n            font-size: .68rem !important;\n            line-height: 1.35 !important;\n            -webkit-line-clamp: 2;\n            -webkit-box-orient: vertical;\n          }\n\n          @media (max-width: 600px) {\n            .loja-identidade__descricao {\n              margin-bottom: 6px !important;\n              font-size: .64rem !important;\n              -webkit-line-clamp: 1;\n            }\n          }\n\n\n          /* Card da loja em vidro, deixando o GIF/capa aparecer por trás */\n          .loja-identidade {\n            background:\n              linear-gradient(135deg,\n                rgba(15, 18, 24, .58),\n                rgba(28, 30, 36, .36)\n              ) !important;\n            border: 1px solid rgba(255,255,255,.18) !important;\n            box-shadow:\n              0 12px 28px rgba(0,0,0,.18),\n              inset 0 1px 0 rgba(255,255,255,.12) !important;\n            backdrop-filter: blur(13px) saturate(135%) !important;\n            -webkit-backdrop-filter: blur(13px) saturate(135%) !important;\n          }\n\n          .loja-identidade::before {\n            content: \"\";\n            position: absolute;\n            inset: 0;\n            pointer-events: none;\n            border-radius: inherit;\n            background:\n              linear-gradient(180deg,\n                rgba(255,255,255,.10),\n                rgba(255,255,255,.015) 46%,\n                rgba(0,0,0,.06)\n              );\n          }\n\n          .loja-identidade > * {\n            position: relative;\n            z-index: 1;\n          }\n\n          .loja-identidade__texto > span,\n          .loja-identidade__texto h1,\n          .loja-identidade__descricao {\n            text-shadow: 0 1px 5px rgba(0,0,0,.45);\n          }\n\n\n          /* RESTAURA LED DOS CARDS DE DESTAQUE */\n          .vitrine-destaques__card {\n            --led-angle: 0deg !important;\n            position: relative !important;\n            isolation: isolate !important;\n            padding: 2px !important;\n            border: 0 !important;\n            background:\n              conic-gradient(\n                from var(--led-angle),\n                transparent 0deg 238deg,\n                color-mix(in srgb, var(--cor-loja) 88%, #5b5cff) 270deg,\n                #a8c7ff 296deg,\n                color-mix(in srgb, var(--cor-loja) 78%, #8b5cf6) 316deg,\n                transparent 344deg 360deg\n              ) !important;\n            box-shadow:\n              0 12px 26px rgba(20,34,51,.08),\n              0 0 16px color-mix(in srgb, var(--cor-loja) 11%, transparent) !important;\n            animation: ledCardRound 3.8s linear infinite !important;\n          }\n\n          .vitrine-destaques__card::before {\n            content: '' !important;\n            display: block !important;\n            position: absolute !important;\n            inset: 2px !important;\n            z-index: -1 !important;\n            border-radius: 20px !important;\n            background: #fff !important;\n          }\n\n          .vitrine-destaques__card::after {\n            content: '' !important;\n            display: block !important;\n            position: absolute !important;\n            inset: 0 !important;\n            pointer-events: none !important;\n            border-radius: inherit !important;\n            box-shadow:\n              inset 0 0 0 1px rgba(255,255,255,.45),\n              0 0 18px color-mix(in srgb, var(--cor-loja) 10%, transparent) !important;\n          }\n\n          .vitrine-destaques__imagem {\n            position: relative !important;\n            z-index: 1 !important;\n            margin: 0 !important;\n            border-radius: 20px 20px 0 0 !important;\n          }\n\n          .vitrine-destaques__conteudo {\n            position: relative !important;\n            z-index: 1 !important;\n            margin: 0 !important;\n            border-radius: 0 0 20px 20px !important;\n            background: #fff !important;\n          }\n\n          @keyframes ledCardRound {\n            to { --led-angle: 360deg; }\n          }\n\n          @media (prefers-reduced-motion: reduce) {\n            .vitrine-destaques__card {\n              animation: none !important;\n            }\n          }\n\n\n          /* LED ROBUSTO DOS DESTAQUES: gira a luz de verdade, sem depender de @property */\n          .vitrine-destaques__card {\n            position: relative !important;\n            isolation: isolate !important;\n            overflow: hidden !important;\n            padding: 2px !important;\n            border: 0 !important;\n            border-radius: 22px !important;\n            background: #ffffff !important;\n            box-shadow:\n              0 12px 26px rgba(20,34,51,.08),\n              0 0 18px color-mix(in srgb, var(--cor-loja) 14%, transparent) !important;\n            animation: none !important;\n          }\n\n          .vitrine-destaques__card::before {\n            content: \"\" !important;\n            display: block !important;\n            position: absolute !important;\n            z-index: 0 !important;\n            top: -55% !important;\n            left: -35% !important;\n            width: 170% !important;\n            height: 210% !important;\n            border-radius: 50% !important;\n            background:\n              conic-gradient(\n                from 0deg,\n                transparent 0deg 245deg,\n                #4f46e5 268deg,\n                #67a8ff 286deg,\n                #c084fc 304deg,\n                transparent 326deg 360deg\n              ) !important;\n            transform-origin: 50% 50% !important;\n            animation: kodvexaLedGirar 2.7s linear infinite !important;\n            pointer-events: none !important;\n          }\n\n          .vitrine-destaques__card::after {\n            content: \"\" !important;\n            display: block !important;\n            position: absolute !important;\n            z-index: 1 !important;\n            inset: 2px !important;\n            border-radius: 20px !important;\n            background: #fff !important;\n            box-shadow: inset 0 0 0 1px rgba(255,255,255,.45) !important;\n            pointer-events: none !important;\n          }\n\n          .vitrine-destaques__imagem,\n          .vitrine-destaques__conteudo {\n            position: relative !important;\n            z-index: 2 !important;\n          }\n\n          .vitrine-destaques__imagem {\n            margin: 0 !important;\n            border-radius: 20px 20px 0 0 !important;\n            overflow: hidden !important;\n          }\n\n          .vitrine-destaques__conteudo {\n            margin: 0 !important;\n            border-radius: 0 0 20px 20px !important;\n            background: #fff !important;\n          }\n\n          @keyframes kodvexaLedGirar {\n            from { transform: rotate(0deg); }\n            to { transform: rotate(360deg); }\n          }\n\n          @media (prefers-reduced-motion: reduce) {\n            .vitrine-destaques__card::before {\n              animation: none !important;\n            }\n          }\n\n  "}</style>

        <section className="loja-identidade">
          <div className="loja-identidade__logo">
            {loja.logo_url ? <img src={loja.logo_url} alt={loja.nome} /> : <Store size={26} />}
          </div>

          <div className="loja-identidade__texto">
            <span>Loja oficial</span>
            <h1>{loja.nome}</h1>

            {loja.descricao && (
              <p className="loja-identidade__descricao">{loja.descricao}</p>
            )}

            <div className="loja-identidade__meta">
              <span className={abertoAgora ? 'aberto' : 'fechado'}>
                <i />
                {abertoAgora ? 'Aberto agora' : 'Fechado'}
              </span>
              <span><Clock3 size={13} /> {loja.tempo_medio_min || 40} min</span>
            </div>
          </div>
        </section>

        <div className="busca">
          <Search size={20} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no cardápio" />
        </div>

        <nav className="categorias categorias-filtro categorias-clean">
          <button
            type="button"
            className={categoriaSelecionada === 'todos' ? 'ativo' : ''}
            onClick={() => setCategoriaSelecionada('todos')}
          >
            Todos
          </button>

          {categorias.map((categoria) => (
            <button
              type="button"
              key={categoria.id}
              className={categoriaSelecionada === categoria.id ? 'ativo' : ''}
              onClick={() => setCategoriaSelecionada(categoria.id)}
            >
              {categoria.nome}
            </button>
          ))}
        </nav>

        {categoriaSelecionada === 'todos' && !busca.trim() && produtosDestaque.length > 0 && (
          <section className="vitrine-destaques">
            <div className="vitrine-destaques__topo">
              <div>
                <span className="vitrine-destaques__selo"><Sparkles size={13} /> Em destaque</span>
                <h2>Escolhas da casa</h2>
                <p>Uma seleção para pedir sem pensar duas vezes.</p>
              </div>
            </div>

            <div className="vitrine-destaques__lista">
              {produtosDestaque.map((produto) => {
                const precoNormal = Number(produto.preco || 0)
                const precoPromo = Number(produto.preco_promocional || 0)
                const temPromo = precoPromo > 0 && precoPromo < precoNormal

                return (
                  <button
                    type="button"
                    key={produto.id}
                    className="vitrine-destaques__card"
                    onClick={() => abrirProduto(produto)}
                    disabled={!abertoAgora || produto.disponivel === false}
                    style={produto.disponivel === false ? { opacity: .62, cursor: 'not-allowed', position: 'relative' } : undefined}
                  >
                    <div className="vitrine-destaques__imagem">
                      {produto.imagem_url
                        ? <img src={produto.imagem_url} alt={produto.nome} />
                        : <ShoppingBag size={30} />}

                      <span
                        className="vitrine-destaques__badge"
                        style={produto.disponivel === false ? {
                          background: '#991b1b',
                          color: '#fff',
                          borderColor: 'rgba(255,255,255,.22)',
                        } : undefined}
                      >
                        {produto.disponivel === false ? 'ESGOTADO' : temPromo ? 'OFERTA' : 'DESTAQUE'}
                      </span>
                    </div>

                    <div className="vitrine-destaques__conteudo">
                      <strong>{produto.nome}</strong>
                      <small>{produto.descricao || 'Uma boa escolha para o seu pedido.'}</small>

                      <div className="vitrine-destaques__precos">
                        {temPromo && <del>{dinheiro(precoNormal)}</del>}
                        <b>{dinheiro(temPromo ? precoPromo : precoNormal)}</b>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {categorias
          .filter((categoria) => categoriaSelecionada === 'todos' || categoria.id === categoriaSelecionada)
          .map((categoria) => {
          const lista = produtosFiltrados.filter((produto) => produto.categoria_id === categoria.id)
          if (!lista.length) return null
          return (
            <section id={`categoria-${categoria.id}`} className="secao" key={categoria.id}>
              <div className="secao__titulo">
                <div><h2>{categoria.nome}</h2><p>{categoria.descricao}</p></div>
                <span>{lista.length} {lista.length === 1 ? 'item' : 'itens'}</span>
              </div>
              <div className="produtos">
                {lista.map((produto) => (
                  <button
                    className="produto"
                    key={produto.id}
                    onClick={() => abrirProduto(produto)}
                    disabled={!abertoAgora || produto.disponivel === false}
                    style={produto.disponivel === false ? { opacity: .62, cursor: 'not-allowed' } : undefined}
                  >
                    <div className="produto__texto">
                      {produto.disponivel === false
                        ? <strong className="destaque" style={{ background: '#fee2e2', color: '#b91c1c' }}>ESGOTADO</strong>
                        : produto.destaque && <strong className="destaque">Mais pedido</strong>}
                      <h3>{produto.nome}</h3>
                      <p>{produto.descricao}</p>
                      <b>{dinheiro(produto.preco_promocional || produto.preco)}</b>
                    </div>
                    <div className="produto__imagem">
                      {produto.imagem_url ? <img src={produto.imagem_url} alt="" /> : <ShoppingBag size={29} />}
                    </div>
                    <ChevronRight className="produto__seta" size={20} />
                  </button>
                ))}
              </div>
            </section>
          )
        })}

        {!produtosFiltrados.length && <p className="vazio">Nenhum produto encontrado.</p>}
      </main>

      <nav className={`loja-mobile-nav ${(produtoAberto || carrinhoAberto || checkoutAberto || pedidoCriado) ? 'oculto-modal' : ''}`} aria-label="Navegação da loja">
        <button type="button" className="ativo" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <Home size={19} />
          <span>Início</span>
        </button>
        <button type="button" onClick={() => document.querySelector('.categorias-filtro')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <Search size={19} />
          <span>Cardápio</span>
        </button>
        <button
          type="button"
          className={carrinho.length && abertoAgora ? 'tem-itens' : ''}
          disabled={!abertoAgora}
          onClick={() => abertoAgora && setCarrinhoAberto(true)}
          title={!abertoAgora ? 'Loja fechada' : 'Abrir carrinho'}
          style={!abertoAgora ? { opacity: .45, cursor: 'not-allowed' } : undefined}
        >
          <ShoppingBag size={19} />
          <span>{abertoAgora ? 'Carrinho' : 'Fechado'}</span>
          {abertoAgora && carrinho.length > 0 && <b>{carrinho.reduce((soma, item) => soma + item.quantidade, 0)}</b>}
        </button>
        <button type="button" onClick={() => alert('Acompanhamento de pedidos será a próxima etapa.')}>
          <Clock3 size={19} />
          <span>Pedidos</span>
        </button>
      </nav>

      {abertoAgora && totalItens > 0 && (
        <button className="barra-carrinho" onClick={() => setCarrinhoAberto(true)}>
          <span className="bolha">{totalItens}</span>
          <strong>Ver carrinho</strong>
          <b>{dinheiro(total)}</b>
        </button>
      )}

      {produtoAberto && (
        <div className="modal-fundo modal-produto-fundo" onMouseDown={() => setProdutoAberto(null)}>
          <div className="modal modal-produto" onMouseDown={(e) => e.stopPropagation()}>
            <button className="fechar fechar-produto" onClick={() => setProdutoAberto(null)} aria-label="Fechar produto"><X /></button>

            <div className="modal-produto__midia">
              {produtoAberto.imagem_url ? (
                <img src={produtoAberto.imagem_url} alt={produtoAberto.nome} />
              ) : (
                <div className="modal-produto__sem-foto"><ShoppingBag size={48} /></div>
              )}
              {produtoAberto.destaque && <span className="modal-produto__destaque">Mais pedido</span>}
            </div>

            <div className="modal-produto__conteudo">
              <div className="modal-produto__categoria">
                {categoriaProdutoAberto?.nome || 'Produto'}
              </div>
              <h2>{produtoAberto.nome}</h2>
              <p>{produtoAberto.descricao || 'Confira os detalhes deste item e adicione ao seu pedido.'}</p>

              <div className="modal-produto__preco">
                {produtoAberto.preco_promocional && Number(produtoAberto.preco_promocional) < Number(produtoAberto.preco) && (
                  <small>{dinheiro(produtoAberto.preco)}</small>
                )}
                <strong>{dinheiro(produtoAberto.preco_promocional || produtoAberto.preco)}</strong>
              </div>

              {!produtoEhBebida && gruposDoProduto.map((grupo) => {
                const selecionados = escolhasAdicionais[grupo.id] || []
                const minimo = grupo.obrigatorio ? Math.max(Number(grupo.minimo || 0), 1) : Number(grupo.minimo || 0)
                return <section key={grupo.id} style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #e7ebf2' }}>
                  <div className="modal-produto__titulo-opcao"><div><strong>{grupo.nome}</strong><span>{grupo.maximo ? `Escolha até ${grupo.maximo}` : 'Escolha as opções desejadas'}</span></div><span className={grupo.obrigatorio ? '' : 'opcional'}>{grupo.obrigatorio ? 'Obrigatório' : 'Opcional'}</span></div>
                  <div style={{ display: 'grid', gap: 9, marginTop: 10 }}>{adicionaisDoGrupo(grupo.id).map((adicional) => { const marcado = selecionados.includes(adicional.id); return <button key={adicional.id} type="button" onClick={() => alternarAdicional(grupo, adicional)} style={{ minHeight: 52, display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 10, padding: '10px 12px', border: marcado ? '1px solid #4f46e5' : '1px solid #e0e6ef', borderRadius: 13, background: marcado ? '#f3f1ff' : '#fff', color: '#172033', textAlign: 'left' }}><strong>{adicional.nome}</strong><span style={{ color: '#596579', fontWeight: 700 }}>{Number(adicional.preco || 0) > 0 ? `+ ${dinheiro(adicional.preco)}` : 'Grátis'}</span><span style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: Number(grupo.maximo) === 1 ? '50%' : 7, border: marcado ? '1px solid #4f46e5' : '1px solid #cfd7e3', background: marcado ? '#4f46e5' : '#fff', color: '#fff' }}>{marcado ? '✓' : ''}</span></button> })}</div>
                  {minimo > 0 && selecionados.length < minimo && <small style={{ display: 'block', marginTop: 8, color: '#b54708' }}>Escolha pelo menos {minimo} opção(ões).</small>}
                </section>
              })}

              {produtoEhBebida && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginTop: 12,
                  padding: '12px 14px',
                  border: '1px solid #e6eaf0',
                  borderRadius: 14,
                  background: '#f8fafc'
                }}>
                  <div>
                    <strong style={{ display: 'block', color: '#172033', fontSize: 14 }}>Bebida</strong>
                    <span style={{ display: 'block', marginTop: 3, color: '#7a8799', fontSize: 12 }}>
                      {produtoAberto.descricao || 'Adicione a quantidade desejada ao pedido.'}
                    </span>
                  </div>
                  <span style={{
                    flex: '0 0 auto',
                    padding: '6px 9px',
                    borderRadius: 999,
                    background: '#eef2ff',
                    color: '#4338ca',
                    fontSize: 11,
                    fontWeight: 850
                  }}>Gelada</span>
                </div>
              )}


              {(produtoEhDoce || produtoEhRefeicao) && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginTop: 12,
                  padding: '11px 13px',
                  border: '1px solid #e6eaf0',
                  borderRadius: 14,
                  background: '#fafbfc'
                }}>
                  <div>
                    <strong style={{ display: 'block', color: '#172033', fontSize: 13 }}>
                      {produtoEhDoce ? 'Doce / sobremesa' : 'Refeição'}
                    </strong>
                    <span style={{ display: 'block', marginTop: 3, color: '#7a8799', fontSize: 12 }}>
                      {produtoEhDoce
                        ? 'Escolha a quantidade e personalize se precisar.'
                        : 'Confira os adicionais e personalize seu prato.'}
                    </span>
                  </div>
                  <span style={{
                    flex: '0 0 auto',
                    padding: '6px 9px',
                    borderRadius: 999,
                    background: produtoEhDoce ? '#fff4e8' : '#eef7ff',
                    color: produtoEhDoce ? '#b45309' : '#2563eb',
                    fontSize: 11,
                    fontWeight: 850
                  }}>
                    {produtoEhDoce ? 'Sobremesa' : 'Prato'}
                  </span>
                </div>
              )}

              <div className="modal-produto__separador" />
              <div className="modal-produto__titulo-opcao">
                <div>
                  <strong>Quantidade</strong>
                  <span>{
                    produtoEhBebida
                      ? 'Quantas unidades você quer?'
                      : produtoEhDoce
                        ? 'Quantas unidades deseja adicionar?'
                        : produtoEhRefeicao
                          ? 'Quantos pratos deseja adicionar?'
                          : 'Escolha quantos você quer adicionar'
                  }</span>
                </div>
                <span>Obrigatório</span>
              </div>

              {!produtoEhBebida && (
                <div className="modal-produto__personalizar">
                  <div className="modal-produto__titulo-opcao">
                    <div>
                      <strong>{observacaoTituloProduto}</strong>
                      <span>{observacaoExemploProduto}</span>
                    </div>
                    <span className="opcional">Opcional</span>
                  </div>
                  <textarea
                    value={observacaoItem}
                    onChange={(e) => setObservacaoItem(e.target.value.slice(0, 180))}
                    placeholder={observacaoPlaceholderProduto}
                    rows={produtoEhDoce ? 2 : 3}
                  />
                  <small>{observacaoItem.length}/180</small>
                </div>
              )}

              <div className="modal__rodape modal-produto__rodape">
                <div className="quantidade quantidade-produto">
                  <button type="button" onClick={() => setQuantidade((q) => Math.max(1, q - 1))} aria-label="Diminuir quantidade"><Minus /></button>
                  <b>{quantidade}</b>
                  <button type="button" onClick={() => setQuantidade((q) => q + 1)} aria-label="Aumentar quantidade"><Plus /></button>
                </div>
                <button className="primario adicionar-produto" onClick={adicionarAoCarrinho}>
                  <span>Adicionar</span>
                  <strong>{dinheiro(precoUnitarioConfigurado * quantidade)}</strong>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {carrinhoAberto && (
        <div className="modal-fundo carrinho-fundo-premium" onMouseDown={() => setCarrinhoAberto(false)}>
          <style>{"            @media (max-width: 600px) {\n              .loja-mobile-nav.oculto-modal {\n                display: none !important;\n              }\n\n              .carrinho-fundo-premium {\n                position: fixed !important;\n                inset: 0 !important;\n                display: block !important;\n                padding: 0 !important;\n                background: #f7f9fc !important;\n                backdrop-filter: none !important;\n              }\n\n              .carrinho-premium {\n                position: fixed !important;\n                inset: 0 !important;\n                width: 100% !important;\n                max-width: none !important;\n                height: 100dvh !important;\n                max-height: 100dvh !important;\n                margin: 0 !important;\n                padding: 0 !important;\n                display: flex !important;\n                flex-direction: column !important;\n                overflow: hidden !important;\n                border-radius: 0 !important;\n                background: #f7f9fc !important;\n                box-shadow: none !important;\n              }\n\n              .carrinho-premium__cabecalho {\n                flex: 0 0 auto;\n                min-height: 76px;\n                display: flex;\n                align-items: center;\n                justify-content: space-between;\n                gap: 12px;\n                padding: 16px 18px 13px;\n                border-bottom: 1px solid #e9eef4;\n                background: #fff;\n              }\n\n              .carrinho-premium__titulo {\n                display: flex;\n                align-items: center;\n                gap: 11px;\n              }\n\n              .carrinho-premium__icone {\n                width: 44px;\n                height: 44px;\n                display: grid;\n                place-items: center;\n                flex: 0 0 44px;\n                border-radius: 14px;\n                background: color-mix(in srgb, var(--cor-loja) 10%, #fff);\n                color: var(--cor-loja);\n              }\n\n              .carrinho-premium__titulo h2 {\n                margin: 0;\n                color: #162033;\n                font-size: 1.13rem;\n              }\n\n              .carrinho-premium__titulo span {\n                display: block;\n                margin-top: 2px;\n                color: #8794a7;\n                font-size: .72rem;\n              }\n\n              .carrinho-premium__fechar {\n                width: 40px;\n                height: 40px;\n                display: grid;\n                place-items: center;\n                flex: 0 0 40px;\n                border: 1px solid #e7ecf2;\n                border-radius: 50%;\n                background: #f8fafc;\n                color: #65758a;\n              }\n\n              .carrinho-premium__scroll {\n                flex: 1 1 auto;\n                min-height: 0;\n                overflow-y: auto;\n                padding: 12px 14px 18px;\n                overscroll-behavior: contain;\n              }\n\n              .carrinho-premium__entrega {\n                display: grid;\n                gap: 10px;\n                margin-bottom: 12px;\n                padding: 14px;\n                border: 1px solid #e4eaf1;\n                border-radius: 18px;\n                background: linear-gradient(145deg, #fff, #fbfcff);\n                box-shadow: 0 7px 18px rgba(20, 34, 51, .05);\n              }\n\n              .carrinho-premium__entrega-topo {\n                display: flex;\n                align-items: center;\n                justify-content: space-between;\n                gap: 10px;\n              }\n\n              .carrinho-premium__entrega-topo strong {\n                color: #172033;\n                font-size: .88rem;\n              }\n\n              .carrinho-premium__entrega-topo small {\n                color: #7e8da1;\n                font-size: .7rem;\n              }\n\n              .carrinho-premium__tipos {\n                display: grid;\n                grid-template-columns: 1fr 1fr;\n                gap: 8px;\n              }\n\n              .carrinho-premium__tipos button {\n                min-height: 54px;\n                display: flex;\n                align-items: center;\n                justify-content: center;\n                gap: 8px;\n                border: 1px solid #dfe6ee;\n                border-radius: 14px;\n                background: #fff;\n                color: #56677d;\n                font: inherit;\n                font-size: .78rem;\n                font-weight: 850;\n              }\n\n              .carrinho-premium__tipos button.ativo {\n                border-color: var(--cor-loja);\n                background: color-mix(in srgb, var(--cor-loja) 8%, #fff);\n                color: var(--cor-loja);\n                box-shadow: 0 6px 16px color-mix(in srgb, var(--cor-loja) 13%, transparent);\n              }\n\n              .carrinho-premium__item {\n                display: grid;\n                grid-template-columns: 84px minmax(0, 1fr);\n                gap: 12px;\n                margin-bottom: 10px;\n                padding: 12px;\n                border: 1px solid #e3e9f0;\n                border-radius: 18px;\n                background: #fff;\n                box-shadow: 0 7px 18px rgba(20, 34, 51, .05);\n              }\n\n              .carrinho-premium__foto {\n                width: 84px;\n                height: 84px;\n                overflow: hidden;\n                border: 1px solid #edf1f5;\n                border-radius: 15px;\n                background: #f5f7fa;\n              }\n\n              .carrinho-premium__foto img {\n                width: 100%;\n                height: 100%;\n                object-fit: cover;\n              }\n\n              .carrinho-premium__sem-foto {\n                width: 100%;\n                height: 100%;\n                display: grid;\n                place-items: center;\n                color: #92a0b2;\n              }\n\n              .carrinho-premium__item-conteudo {\n                min-width: 0;\n                display: grid;\n                gap: 7px;\n              }\n\n              .carrinho-premium__item-topo {\n                display: flex;\n                align-items: flex-start;\n                justify-content: space-between;\n                gap: 9px;\n              }\n\n              .carrinho-premium__item-topo strong {\n                color: #172033;\n                font-size: .9rem;\n              }\n\n              .carrinho-premium__excluir {\n                width: 32px;\n                height: 32px;\n                display: grid;\n                place-items: center;\n                flex: 0 0 32px;\n                border: 1px solid #ffd9dc;\n                border-radius: 10px;\n                background: #fff5f6;\n                color: #e5484d;\n              }\n\n              .carrinho-premium__extras {\n                display: grid;\n                gap: 3px;\n              }\n\n              .carrinho-premium__extras small {\n                color: #718198;\n                font-size: .7rem;\n                line-height: 1.35;\n              }\n\n              .carrinho-premium__item-rodape {\n                display: flex;\n                align-items: center;\n                justify-content: space-between;\n                gap: 8px;\n              }\n\n              .carrinho-premium__item-rodape > strong {\n                color: #162033;\n                font-size: .9rem;\n              }\n\n              .carrinho-premium__item-rodape .quantidade {\n                min-height: 38px !important;\n              }\n\n              .carrinho-premium__mais {\n                width: 100%;\n                min-height: 52px;\n                display: flex;\n                align-items: center;\n                justify-content: space-between;\n                gap: 10px;\n                margin: 4px 0 12px;\n                padding: 0 14px;\n                border: 1px dashed #cfd9e6;\n                border-radius: 16px;\n                background: #fff;\n                color: #33445b;\n                font: inherit;\n              }\n\n              .carrinho-premium__mais span {\n                display: flex;\n                align-items: center;\n                gap: 9px;\n                font-size: .8rem;\n                font-weight: 850;\n              }\n\n              .carrinho-premium__resumo {\n                display: grid;\n                gap: 8px;\n                padding: 15px;\n                border: 1px solid #e3e9f0;\n                border-radius: 18px;\n                background: #fff;\n              }\n\n              .carrinho-premium__linha {\n                display: flex;\n                align-items: center;\n                justify-content: space-between;\n                gap: 12px;\n                color: #718198;\n                font-size: .78rem;\n              }\n\n              .carrinho-premium__linha strong {\n                color: #25344a;\n              }\n\n              .carrinho-premium__linha.total {\n                margin-top: 3px;\n                padding-top: 10px;\n                border-top: 1px solid #edf1f5;\n                color: #172033;\n                font-size: .9rem;\n                font-weight: 850;\n              }\n\n              .carrinho-premium__linha.total strong {\n                color: #101a29;\n                font-size: 1.08rem;\n              }\n\n              .carrinho-premium__rodape {\n                flex: 0 0 auto;\n                width: 100%;\n                padding: 12px 14px calc(14px + env(safe-area-inset-bottom));\n                border-top: 1px solid #e6ebf1;\n                background: rgba(255,255,255,.99);\n                box-shadow: 0 -8px 22px rgba(20,34,51,.07);\n                backdrop-filter: blur(12px);\n              }\n\n              .carrinho-premium__continuar {\n                width: 100%;\n                min-height: 56px;\n                display: flex;\n                align-items: center;\n                justify-content: space-between;\n                gap: 12px;\n                padding: 0 16px;\n                border: 0;\n                border-radius: 16px;\n                background: linear-gradient(135deg, var(--cor-loja), color-mix(in srgb, var(--cor-loja) 76%, #6d36ff));\n                color: #fff;\n                font: inherit;\n                box-shadow: 0 12px 26px color-mix(in srgb, var(--cor-loja) 25%, transparent);\n              }\n\n              .carrinho-premium__continuar span {\n                display: grid;\n                gap: 1px;\n                text-align: left;\n              }\n\n              .carrinho-premium__continuar span strong {\n                font-size: .9rem;\n              }\n\n              .carrinho-premium__continuar span small {\n                color: rgba(255,255,255,.75);\n                font-size: .65rem;\n              }\n\n              .carrinho-premium__continuar > strong {\n                font-size: .92rem;\n              }\n\n              .carrinho-premium__vazio {\n                min-height: 55dvh;\n                display: flex;\n                flex-direction: column;\n                align-items: center;\n                justify-content: center;\n                gap: 9px;\n                padding: 30px;\n                text-align: center;\n              }\n\n              .carrinho-premium__vazio div {\n                width: 74px;\n                height: 74px;\n                display: grid;\n                place-items: center;\n                border-radius: 22px;\n                background: color-mix(in srgb, var(--cor-loja) 10%, #fff);\n                color: var(--cor-loja);\n              }\n\n              .carrinho-premium__vazio h3 {\n                margin: 0;\n                color: #172033;\n              }\n\n              .carrinho-premium__vazio p {\n                max-width: 260px;\n                margin: 0;\n                color: #8290a4;\n                font-size: .8rem;\n                line-height: 1.45;\n              }\n            }\n  "}</style>

          <aside className="carrinho carrinho-premium" onMouseDown={(e) => e.stopPropagation()}>
            <header className="carrinho-premium__cabecalho">
              <div className="carrinho-premium__titulo">
                <div className="carrinho-premium__icone"><ShoppingBag size={22} /></div>
                <div>
                  <h2>Seu carrinho</h2>
                  <span>{totalItens ? `${totalItens} ${totalItens === 1 ? 'item' : 'itens'} no pedido` : 'Seu pedido começa aqui'}</span>
                </div>
              </div>
              <button className="carrinho-premium__fechar" onClick={() => setCarrinhoAberto(false)} aria-label="Fechar carrinho"><X size={20} /></button>
            </header>

            {carrinho.length === 0 ? (
              <div className="carrinho-premium__vazio">
                <div><ShoppingBag size={31} /></div>
                <h3>Seu carrinho está vazio</h3>
                <p>Escolha seus favoritos no cardápio e monte seu pedido.</p>
                <button
                  type="button"
                  className="primario"
                  onClick={() => {
                    setCarrinhoAberto(false)
                    setTimeout(() => document.querySelector('.categorias-filtro')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
                  }}
                >
                  Explorar cardápio
                </button>
              </div>
            ) : (
              <>
                <div className="carrinho-premium__scroll">
                  <section className="carrinho-premium__entrega">
                    <div className="carrinho-premium__entrega-topo">
                      <div>
                        <strong>Como você quer receber?</strong>
                        <small style={{ display: 'block', marginTop: 3 }}>
                          {formulario.tipo === 'entrega'
                            ? `Entrega em aproximadamente ${loja.tempo_medio_min || 40} min`
                            : 'Retire seu pedido no estabelecimento'}
                        </small>
                      </div>
                    </div>

                    <div className="carrinho-premium__tipos">
                      {loja.faz_entrega !== false && (
                        <button
                          type="button"
                          className={formulario.tipo === 'entrega' ? 'ativo' : ''}
                          onClick={() => atualizarCampo('tipo', 'entrega')}
                        >
                          <Bike size={18} /> Entrega
                        </button>
                      )}

                      {loja.permite_retirada !== false && (
                        <button
                          type="button"
                          className={formulario.tipo === 'retirada' ? 'ativo' : ''}
                          onClick={() => atualizarCampo('tipo', 'retirada')}
                        >
                          <Store size={18} /> Retirada
                        </button>
                      )}
                    </div>
                  </section>

                  {carrinho.map((item) => (
                    <article className="carrinho-premium__item" key={item.chaveItem || item.id}>
                      <div className="carrinho-premium__foto">
                        {item.imagem_url
                          ? <img src={item.imagem_url} alt={item.nome} />
                          : <div className="carrinho-premium__sem-foto"><ShoppingBag size={25} /></div>}
                      </div>

                      <div className="carrinho-premium__item-conteudo">
                        <div className="carrinho-premium__item-topo">
                          <strong>{item.nome}</strong>
                          <button
                            type="button"
                            className="carrinho-premium__excluir"
                            onClick={() => setCarrinho((atual) => atual.filter((produto) => produto.chaveItem !== item.chaveItem))}
                            aria-label={`Remover ${item.nome}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>

                        <div className="carrinho-premium__extras">
                          {(item.adicionaisEscolhidos || []).map((a) => (
                            <small key={a.id}>
                              + {a.nome}{Number(a.preco || 0) > 0 ? ` • ${dinheiro(a.preco)}` : ''}
                            </small>
                          ))}
                          {item.observacaoItem && <small>Obs.: {item.observacaoItem}</small>}
                        </div>

                        <div className="carrinho-premium__item-rodape">
                          <strong>{dinheiro(item.preco * item.quantidade)}</strong>
                          <div className="quantidade pequena">
                            <button type="button" onClick={() => alterarItem(item.chaveItem || item.id, -1)}><Minus size={16} /></button>
                            <b>{item.quantidade}</b>
                            <button type="button" onClick={() => alterarItem(item.chaveItem || item.id, 1)}><Plus size={16} /></button>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}

                  <button
                    type="button"
                    className="carrinho-premium__mais"
                    onClick={() => {
                      setCarrinhoAberto(false)
                      setTimeout(() => document.querySelector('.categorias-filtro')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
                    }}
                  >
                    <span><Plus size={18} /> Adicionar mais itens</span>
                    <ChevronRight size={18} />
                  </button>

                  <section className="carrinho-premium__resumo">
                    <div className="carrinho-premium__linha">
                      <span>Subtotal</span>
                      <strong>{dinheiro(total)}</strong>
                    </div>

                    <div className="carrinho-premium__linha">
                      <span>{formulario.tipo === 'entrega' ? 'Taxa de entrega' : 'Retirada'}</span>
                      <strong>{formulario.tipo === 'entrega' ? 'Calculada pelo CEP' : 'Grátis'}</strong>
                    </div>

                    <div className="carrinho-premium__linha total">
                      <span>Total por enquanto</span>
                      <strong>{dinheiro(total)}</strong>
                    </div>
                  </section>
                </div>

                <footer className="carrinho-premium__rodape">
                  <button
                    className="carrinho-premium__continuar"
                    disabled={!abertoAgora}
                    onClick={() => {
                      if (!abertoAgora) return
                      setCarrinhoAberto(false)
                      setCheckoutAberto(true)
                    }}
                  >
                    <span>
                      <strong>Continuar pedido</strong>
                      <small>{formulario.tipo === 'entrega' ? 'Informe endereço e pagamento' : 'Informe seus dados e pagamento'}</small>
                    </span>
                    <strong>{dinheiro(total)}</strong>
                  </button>
                </footer>
              </>
            )}
          </aside>
        </div>
      )}

      {checkoutAberto && !pedidoCriado && (
        <div className="modal-fundo checkout-fundo">
          <form className="checkout" onSubmit={finalizarPedido}>
            <div className="checkout__cabecalho">
              <div><span>Finalizar compra</span><h2>Dados do pedido</h2></div>
              <button type="button" onClick={() => setCheckoutAberto(false)}><X /></button>
            </div>

            <div className="opcoes-entrega">
              <button type="button" className={formulario.tipo === 'entrega' ? 'selecionado' : ''} onClick={() => atualizarCampo('tipo', 'entrega')}>Entrega</button>
              <button type="button" className={formulario.tipo === 'retirada' ? 'selecionado' : ''} onClick={() => atualizarCampo('tipo', 'retirada')}>Retirada no local</button>
            </div>

            <div className="campos dois">
              <label>Seu nome<input value={formulario.nome} onChange={(e) => atualizarCampo('nome', e.target.value)} placeholder="Nome completo" /></label>
              <label>WhatsApp<input value={formulario.telefone} onChange={(e) => atualizarCampo('telefone', e.target.value)} placeholder="(51) 99999-9999" inputMode="tel" /></label>
            </div>

            {formulario.tipo === 'entrega' && (
              <div className="campos">
                <div className="campos dois">
                  <label>CEP<input value={formulario.cep} onChange={(e) => { const digitos = e.target.value.replace(/\D/g, '').slice(0, 8); const cepFormatado = digitos.length > 5 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : digitos; atualizarCampo('cep', cepFormatado) }} placeholder="00000-000" inputMode="numeric" /></label>
                  <label>Número<input value={formulario.numero} onChange={(e) => atualizarCampo('numero', e.target.value)} placeholder="Ex.: 55" /></label>
                </div>
                <button type="button" className="primario" onClick={calcularEntregaCliente} disabled={calculandoEntrega}>
                  {calculandoEntrega ? 'Calculando entrega...' : 'Calcular entrega'}
                </button>
                {entregaCalculada?.valido && (
                  <div className="resumo-checkout">
                    <span>{entregaCalculada.endereco}<small style={{ display: 'block', marginTop: 4 }}>{entregaCalculada.distanciaKm.toFixed(2).replace('.', ',')} km{entregaCalculada.duracaoMin ? ` · cerca de ${entregaCalculada.duracaoMin} min` : ''}</small></span>
                    <strong>{entregaCalculada.taxa === 0 ? 'Grátis' : dinheiro(entregaCalculada.taxa)}</strong>
                  </div>
                )}
                <div className="campos dois">
                  <label>Complemento<input value={formulario.complemento} onChange={(e) => atualizarCampo('complemento', e.target.value)} placeholder="Apartamento, bloco..." /></label>
                  <label>Referência<input value={formulario.referencia} onChange={(e) => atualizarCampo('referencia', e.target.value)} placeholder="Próximo a..." /></label>
                </div>
              </div>
            )}

            <label className="titulo-campo">Forma de pagamento</label>
            <div className="pagamentos">
              {[['pix', 'PIX'], ['cartao_entrega', 'Cartão na entrega'], ['dinheiro', 'Dinheiro']].map(([valor, titulo]) => (
                <button type="button" key={valor} className={formulario.pagamento === valor ? 'selecionado' : ''} onClick={() => atualizarCampo('pagamento', valor)}>{titulo}</button>
              ))}
            </div>

            {formulario.pagamento === 'dinheiro' && <label className="campo-solto">Troco para<input value={formulario.troco} onChange={(e) => atualizarCampo('troco', e.target.value)} placeholder="Ex.: 100,00" inputMode="decimal" /></label>}

            <div className="resumo-checkout"><span>Total do pedido</span><strong>{dinheiro(total + (formulario.tipo === 'entrega' && entregaCalculada?.valido ? entregaCalculada.taxa : 0))}</strong></div>
            {formulario.tipo === 'entrega' && entregaCalculada?.valido && <small className="taxa-aviso">Entrega: {entregaCalculada.taxa === 0 ? 'grátis' : dinheiro(entregaCalculada.taxa)} · distância {entregaCalculada.distanciaKm.toFixed(2).replace('.', ',')} km.</small>}
            {erroPedido && <p className="erro-pedido">{erroPedido}</p>}
            <button
              className="primario enviar-pedido"
              disabled={!abertoAgora || enviando || (formulario.tipo === 'entrega' && !entregaCalculada?.valido)}
            >
              {!abertoAgora ? 'Loja fechada' : enviando ? 'Enviando pedido...' : 'Confirmar pedido'}
            </button>
          </form>
        </div>
      )}

      {pedidoCriado && (
        <div className="modal-fundo">
          <div className="pedido-sucesso">
            <div className="sucesso-icone">✓</div>
            <span>Pedido recebido!</span>
            <h2>Pedido #{pedidoCriado.numero}</h2>
            <p>O estabelecimento recebeu o pedido e já pode iniciar o preparo.</p>
            <div><span>Total</span><strong>{dinheiro(pedidoCriado.total)}</strong></div>
            <button className="primario" onClick={() => { setPedidoCriado(null); setCheckoutAberto(false) }}>Voltar ao cardápio</button>
          </div>
        </div>
      )}
    </div>
  )
}

function TelaCentral({ texto, erro = false }) {
  return <main className={`tela-central ${erro ? 'texto-erro' : ''}`}><h1>KODVEXA FOOD</h1><p>{texto}</p></main>
}

function Inicio() {
  return <TelaCentral texto="Abra o link do cardápio de um estabelecimento." />
}

const etapasPedido = [
  ['recebido', 'Recebido'], ['confirmado', 'Confirmado'], ['preparando', 'Preparando'],
  ['pronto', 'Pronto'], ['saiu_entrega', 'Saiu para entrega'], ['concluido', 'Concluído'],
]



function ConviteEquipe() {
  const [sessao, setSessao] = useState(null)
  const [senha, setSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [pronto, setPronto] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessao(data.session)
    })

    const { data } = supabase.auth.onAuthStateChange((_evento, novaSessao) => {
      setSessao(novaSessao)
    })

    return () => {
      data.subscription.unsubscribe()
    }
  }, [])

  async function concluirConvite(evento) {
    evento.preventDefault()
    setErro('')

    if (!sessao || !sessao.user) {
      setErro('Este convite não está mais válido. Peça ao dono para reenviar.')
      return
    }

    if (senha.length < 6) {
      setErro('A senha precisa ter pelo menos 6 caracteres.')
      return
    }

    if (senha !== confirmarSenha) {
      setErro('As senhas não conferem.')
      return
    }

    setSalvando(true)

    const { error: erroSenha } = await supabase.auth.updateUser({
      password: senha,
    })

    if (erroSenha) {
      setSalvando(false)
      setErro(erroSenha.message || 'Não foi possível definir sua senha.')
      return
    }

    const { data: estabelecimentoId, error: erroAceite } =
      await supabase.rpc('aceitar_convite_equipe')

    if (erroAceite) {
      setSalvando(false)
      setErro(erroAceite.message || 'Não foi possível concluir o convite.')
      return
    }

    if (estabelecimentoId) {
      localStorage.setItem('kodvexa_unidade_atual', estabelecimentoId)
    }

    setSalvando(false)
    setPronto(true)

    window.setTimeout(function () {
      window.location.href = '/painel'
    }, 1200)
  }

  if (pronto) {
    return (
      <main className="login-painel">
        <form>
          <div className="marca-painel">
            <Store />
            <span>KODVEXA FOOD</span>
          </div>

          <h1>Acesso liberado</h1>
          <p>Seu acesso à equipe foi ativado. Abrindo o painel...</p>

          <div
            style={{
              padding: 13,
              border: '1px solid rgba(16,185,129,.35)',
              borderRadius: 12,
              background: 'rgba(6,78,59,.12)',
              color: '#6ee7b7',
              textAlign: 'center',
              fontWeight: 850,
            }}
          >
            Convite aceito
          </div>
        </form>
      </main>
    )
  }

  return (
    <main className="login-painel">
      <form onSubmit={concluirConvite}>
        <div className="marca-painel">
          <Store />
          <span>KODVEXA FOOD</span>
        </div>

        <h1>Ativar meu acesso</h1>
        <p>
          Você foi convidado para uma equipe KODVEXA.
          Defina sua senha para concluir.
        </p>

        {!sessao && (
          <div className="erro-pedido">
            Validando o link do convite...
          </div>
        )}

        <label>
          Nova senha
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            minLength={6}
            required
          />
        </label>

        <label>
          Confirmar senha
          <input
            type="password"
            value={confirmarSenha}
            onChange={(e) => setConfirmarSenha(e.target.value)}
            minLength={6}
            required
          />
        </label>

        {erro && (
          <div className="erro-pedido">
            {erro}
          </div>
        )}

        <button
          type="submit"
          className="primario"
          disabled={salvando || !sessao}
        >
          {salvando ? 'Abrindo pagamento...' : 'Ativar acesso'}
        </button>
      </form>
    </main>
  )
}

function CadastroFuncionario() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')

  async function cadastrar(evento) {
    evento.preventDefault()
    setErro('')
    setSucesso('')

    if (senha.length < 6) {
      setErro('A senha precisa ter pelo menos 6 caracteres.')
      return
    }

    if (senha !== confirmarSenha) {
      setErro('As senhas não conferem.')
      return
    }

    setSalvando(true)

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password: senha,
    })

    if (data?.session) {
      await supabase.auth.signOut()
    }

    setSalvando(false)

    if (error) {
      setErro(error.message || 'Não foi possível criar o acesso.')
      return
    }

    setSucesso(
      'Acesso criado. Agora o dono da loja pode adicionar este e-mail na equipe da unidade.'
    )
    setSenha('')
    setConfirmarSenha('')
  }

  return (
    <main className="login-painel">
      <form onSubmit={cadastrar}>
        <div className="marca-painel"><UserPlus /><span>KODVEXA FOOD</span></div>
        <h1>Criar acesso de funcionário</h1>
        <p>Crie seu login. Depois o dono libera a unidade e a função para este e-mail.</p>

        <label>
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label>
          Senha
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            minLength={6}
            required
          />
        </label>

        <label>
          Confirmar senha
          <input
            type="password"
            value={confirmarSenha}
            onChange={(e) => setConfirmarSenha(e.target.value)}
            minLength={6}
            required
          />
        </label>

        {erro && <div className="erro-pedido">{erro}</div>}
        {sucesso && (
          <div
            style={{
              padding: 12,
              border: '1px solid rgba(16,185,129,.35)',
              borderRadius: 12,
              background: 'rgba(6,78,59,.12)',
              color: '#6ee7b7',
              fontSize: '.8rem',
              lineHeight: 1.45,
            }}
          >
            {sucesso}
          </div>
        )}

        <button className="primario" disabled={salvando}>
          {salvando ? 'Criando acesso...' : 'Criar acesso'}
        </button>

        <Link
          to="/painel"
          style={{
            display: 'block',
            marginTop: 4,
            color: '#7faeff',
            textAlign: 'center',
            fontSize: '.78rem',
            fontWeight: 800,
          }}
        >
          Já tenho acesso
        </Link>
      </form>
    </main>
  )
}

function LoginPainel({ pagina = 'pedidos' }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [entrando, setEntrando] = useState(false)
  const [sessao, setSessao] = useState(null)
  const [funcaoAtual, setFuncaoAtual] = useState('')
  const [checandoAcesso, setChecandoAcesso] = useState(false)
  const [erroAcesso, setErroAcesso] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session))
    const { data } = supabase.auth.onAuthStateChange((_evento, novaSessao) => setSessao(novaSessao))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let cancelado = false

    async function carregarAcesso() {
      if (!sessao?.user?.id) {
        setFuncaoAtual('')
        setErroAcesso('')
        return
      }

      setChecandoAcesso(true)
      setErroAcesso('')

      try {
        const contexto = await obterUnidadeAtualCompleta()
        if (cancelado) return

        const funcao = normalizarFuncaoAcesso(contexto?.unidade, contexto?.unidades)
        setFuncaoAtual(funcao)

        if (!contexto?.estabelecimento) {
          setErroAcesso('Este usuário ainda não possui acesso a nenhuma unidade.')
        }
      } catch (e) {
        if (!cancelado) {
          setErroAcesso(e.message || 'Não foi possível verificar seu acesso.')
        }
      } finally {
        if (!cancelado) setChecandoAcesso(false)
      }
    }

    carregarAcesso()
    return () => { cancelado = true }
  }, [sessao?.user?.id])

  async function entrar(evento) {
    evento.preventDefault()
    setEntrando(true)
    setErro('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setEntrando(false)
    if (error) setErro('E-mail ou senha inválidos.')
  }

  if (sessao) {
    if (checandoAcesso) return <TelaCentral texto="Verificando acesso..." />
    if (erroAcesso) return <TelaCentral texto={erroAcesso} erro />

    const permissoes = {
      dono: ['pedidos', 'cardapio', 'entregas', 'configuracoes', 'unidades', 'equipe'],
      gerente: ['pedidos', 'cardapio', 'entregas'],
      atendente: ['pedidos'],
    }

    const permitidas = permissoes[funcaoAtual] || ['pedidos']

    if (!permitidas.includes(pagina)) {
      return (
        <TelaCentral
          texto="Você não possui permissão para acessar esta área."
          erro
        />
      )
    }

    if (pagina === 'cardapio') return <PainelCardapio sessao={sessao} />
    if (pagina === 'configuracoes') return <PainelConfiguracoes sessao={sessao} />
    if (pagina === 'entregas') return <PainelEntregas sessao={sessao} />
    if (pagina === 'unidades') return <PainelUnidades sessao={sessao} />
    if (pagina === 'equipe') return <PainelEquipe sessao={sessao} />
    return <PainelRestaurante sessao={sessao} />
  }

  return (
    <main className="login-painel">
      <form onSubmit={entrar}>
        <div className="marca-painel"><Store /><span>KODVEXA FOOD</span></div>
        <h1>Entrar no painel</h1>
        <p>Acompanhe e atualize os pedidos do seu estabelecimento.</p>
        <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Senha<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required /></label>
        {erro && <div className="erro-pedido">{erro}</div>}
        <button className="primario" disabled={entrando}>{entrando ? 'Entrando...' : 'Entrar'}</button>

        <Link
          to="/painel/cadastro"
          style={{
            display: 'block',
            marginTop: 4,
            color: '#7faeff',
            textAlign: 'center',
            fontSize: '.76rem',
            fontWeight: 800,
          }}
        >
          Funcionário novo? Criar acesso
        </Link>
      </form>
    </main>
  )
}

const estilosMenuDesktop = `
@media (min-width: 721px) {
  .menu-mobile-topo,
  .menu-mobile-overlay,
  .menu-mobile-fechar {
    display: none !important;
  }
}
`

function NavegacaoPainel({ loja, ativo }) {
  const [menuMobileAberto, setMenuMobileAberto] = useState(false)
  const [unidades, setUnidades] = useState([])
  const [modalUnidadeAberto, setModalUnidadeAberto] = useState(false)
  const [etapaFilial, setEtapaFilial] = useState('assinatura')
  const [criandoUnidade, setCriandoUnidade] = useState(false)
  const [erroUnidade, setErroUnidade] = useState('')
  const [funcaoAtual, setFuncaoAtual] = useState('')
  const [licencasDisponiveis, setLicencasDisponiveis] = useState(0)
  const [carregandoLicencas, setCarregandoLicencas] = useState(false)
  const [ativandoLicencaTeste, setAtivandoLicencaTeste] = useState(false)
  const [matrizLicencaId, setMatrizLicencaId] = useState('')
  const [formUnidade, setFormUnidade] = useState({
    nome_unidade: '',
    endereco: '',
    cidade: '',
    estado: '',
    cep: '',
    whatsapp: '',
    copiar_cardapio: true,
  })

  const fecharMenu = () => setMenuMobileAberto(false)
  // O SQL já remove filiais excluídas da lista.
  // Assim o limite considera somente Matriz + filiais ainda existentes.
  const totalUnidadesAtivasNaRede = unidades.length
  const limiteUnidadesAtingido = totalUnidadesAtivasNaRede >= 6
  const ehDono = funcaoAtual === 'dono'
  const ehGerente = funcaoAtual === 'gerente'
  const podeOperarCardapio = ehDono || ehGerente

  async function carregarUnidadesPainel() {
    try {
      const lista = await obterUnidadesUsuario()
      setUnidades(lista)

      const selecionada = lista.find((item) => item.estabelecimento_id === loja?.id)
        || lista.find((item) => item.estabelecimento_id === localStorage.getItem('kodvexa_unidade_atual'))
        || lista[0]

      setFuncaoAtual(normalizarFuncaoAcesso(selecionada, lista))
      return lista
    } catch (erro) {
      console.error('Erro ao carregar unidades:', erro)
      return []
    }
  }

  useEffect(() => {
    carregarUnidadesPainel()
  }, [])

  async function carregarLicencasDisponiveis(matrizId) {
    if (!matrizId) {
      setLicencasDisponiveis(0)
      return 0
    }

    setCarregandoLicencas(true)

    const { data, error } = await supabase.rpc(
      'get_licencas_filiais_disponiveis',
      { p_matriz_id: matrizId }
    )

    setCarregandoLicencas(false)

    if (error) {
      console.warn('Não foi possível consultar licenças de filial:', error)
      setLicencasDisponiveis(0)
      return 0
    }

    const total = Number(data || 0)
    setLicencasDisponiveis(total)
    return total
  }

  async function iniciarPagamentoFilial() {
    if (!matrizLicencaId) {
      setErroUnidade('Não foi possível identificar a Matriz.')
      return
    }

    setAtivandoLicencaTeste(true)
    setErroUnidade('')

    try {
      const { data: sessaoData } = await supabase.auth.getSession()
      const accessToken = sessaoData?.session?.access_token

      if (!accessToken) {
        throw new Error('Sua sessão expirou. Entre novamente no painel.')
      }

      const resposta = await fetch('/api/mercadopago-criar-filial', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ matriz_id: matrizLicencaId }),
      })

      const dados = await resposta.json().catch(() => ({}))

      if (!resposta.ok) {
        throw new Error(dados?.error || 'Não foi possível iniciar o pagamento da filial.')
      }

      if (!dados?.checkout_url) {
        throw new Error('O Mercado Pago não retornou o link de pagamento.')
      }

      window.location.href = dados.checkout_url
    } catch (erro) {
      setAtivandoLicencaTeste(false)
      setErroUnidade(erro?.message || 'Não foi possível iniciar o pagamento da filial.')
    }
  }

  async function abrirModalNovaUnidade() {
    if (limiteUnidadesAtingido) return

    setErroUnidade('')
    setEtapaFilial('assinatura')

    const matriz = unidades.find((unidade) => unidade.tipo_unidade === 'matriz')
    const matrizId =
      matriz?.estabelecimento_id ||
      (loja?.tipo_unidade === 'matriz' ? loja?.id : loja?.matriz_id)

    setMatrizLicencaId(matrizId || '')
    await carregarLicencasDisponiveis(matrizId)

    setFormUnidade({
      nome_unidade: '',
      endereco: '',
      cidade: loja?.cidade || '',
      estado: loja?.estado || '',
      cep: '',
      whatsapp: '',
      copiar_cardapio: true,
    })
    setModalUnidadeAberto(true)
  }

  function alterarCampoUnidade(campo, valor) {
    setFormUnidade((atual) => ({ ...atual, [campo]: valor }))
  }

  async function criarNovaUnidade(evento) {
    evento.preventDefault()
    setErroUnidade('')

    if (limiteUnidadesAtingido) {
      setErroUnidade('Limite de 6 unidades atingido: 1 Matriz + até 5 filiais.')
      return
    }

    if (licencasDisponiveis <= 0) {
      setErroUnidade('Esta filial precisa de uma licença adicional ativa antes de ser criada.')
      return
    }

    if (!formUnidade.nome_unidade.trim()) {
      setErroUnidade('Digite o nome da unidade.')
      return
    }

    const matriz = unidades.find((unidade) => unidade.tipo_unidade === 'matriz')
    const matrizId = matriz?.estabelecimento_id || (loja?.tipo_unidade === 'matriz' ? loja?.id : loja?.matriz_id)

    if (!matrizId) {
      setErroUnidade('Não foi possível identificar a matriz desta empresa.')
      return
    }

    setCriandoUnidade(true)

    try {
      const { data: novaFilialId, error: erroCriar } = await supabase.rpc('criar_filial', {
        p_matriz_id: matrizId,
        p_nome_unidade: formUnidade.nome_unidade.trim(),
        p_endereco: formUnidade.endereco.trim() || null,
        p_cidade: formUnidade.cidade.trim() || null,
        p_estado: formUnidade.estado.trim() || null,
        p_cep: formUnidade.cep.trim() || null,
        p_whatsapp: formUnidade.whatsapp.trim() || null,
      })

      if (erroCriar) throw erroCriar
      if (!novaFilialId) throw new Error('A filial foi criada, mas o sistema não recebeu o ID da nova unidade.')

      if (formUnidade.copiar_cardapio) {
        const { error: erroCopiar } = await supabase.rpc('copiar_cardapio_para_filial', {
          p_matriz_id: matrizId,
          p_filial_id: novaFilialId,
        })
        if (erroCopiar) throw new Error(`A unidade foi criada, mas não foi possível copiar o cardápio: ${erroCopiar.message}`)
      }

      localStorage.setItem('kodvexa_unidade_atual', novaFilialId)
      await carregarUnidadesPainel()
      setModalUnidadeAberto(false)
      window.location.reload()
    } catch (erro) {
      setErroUnidade(erro?.message || 'Não foi possível criar a unidade agora.')
    } finally {
      setCriandoUnidade(false)
    }
  }

  return (
    <>
      <style>{estilosMenuDesktop}</style>
      <style>{`
        .menu-mobile-topo {
          display: none;
        }

        .seletor-unidade {
          margin: 14px 0 4px;
          padding: 12px;
          border: 1px solid #24364d;
          border-radius: 14px;
          background: rgba(255,255,255,.045);
        }

        .seletor-unidade > span {
          display: block;
          margin-bottom: 7px;
          color: #6f89aa;
          font-size: .59rem;
          font-weight: 900;
          letter-spacing: .08em;
        }

        .seletor-unidade__campo {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .seletor-unidade__campo svg {
          flex: 0 0 auto;
          color: #6fa2ff;
        }

        .seletor-unidade select {
          width: 100%;
          min-width: 0;
          min-height: 42px;
          padding: 0 10px;
          border: 1px solid #304660;
          border-radius: 11px;
          outline: none;
          background: #0d1c2e;
          color: #edf5ff;
          font: inherit;
          font-size: .78rem;
          font-weight: 800;
          cursor: pointer;
        }

        .seletor-unidade small {
          display: block;
          margin-top: 7px;
          color: #70839b;
          font-size: .65rem;
          line-height: 1.35;
        }

        .seletor-unidade__adicionar {
          width: 100%;
          min-height: 38px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          margin-top: 10px;
          border: 1px dashed #355579;
          border-radius: 10px;
          background: rgba(65,129,255,.08);
          color: #8eb6ff;
          font: inherit;
          font-size: .72rem;
          font-weight: 900;
          cursor: pointer;
          transition: .18s ease;
        }

        .seletor-unidade__adicionar:hover {
          border-color: #5b8fe7;
          background: rgba(65,129,255,.15);
          color: #fff;
        }

        .modal-unidade-overlay {
          position: fixed;
          z-index: 5000;
          inset: 0;
          display: grid;
          place-items: center;
          padding: 18px;
          background: rgba(2,8,17,.72);
          backdrop-filter: blur(8px);
        }

        .modal-unidade {
          width: min(620px, 100%);
          max-height: 92dvh;
          overflow-y: auto;
          border: 1px solid #29415f;
          border-radius: 22px;
          background: linear-gradient(180deg, #0d1b2d, #091522);
          box-shadow: 0 28px 80px rgba(0,0,0,.48);
          color: #eef5ff;
        }

        .modal-unidade__topo {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 20px 20px 15px;
          border-bottom: 1px solid #223750;
        }

        .modal-unidade__topo span {
          display: block;
          margin-bottom: 5px;
          color: #72a5ff;
          font-size: .62rem;
          font-weight: 950;
          letter-spacing: .1em;
        }

        .modal-unidade__topo h2 {
          margin: 0;
          font-size: 1.25rem;
        }

        .modal-unidade__topo p {
          margin: 6px 0 0;
          color: #8ba0ba;
          font-size: .78rem;
        }

        .modal-unidade__fechar {
          width: 38px;
          height: 38px;
          display: grid;
          place-items: center;
          flex: 0 0 38px;
          border: 1px solid #304761;
          border-radius: 11px;
          background: #12243a;
          color: #dceaff;
          cursor: pointer;
        }

        .modal-unidade form {
          padding: 18px 20px 20px;
        }

        .modal-unidade__grade {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 13px;
        }

        .modal-unidade label {
          display: grid;
          gap: 6px;
          color: #a9bad0;
          font-size: .72rem;
          font-weight: 800;
        }

        .modal-unidade label.campo-largo {
          grid-column: 1 / -1;
        }

        .modal-unidade input {
          width: 100%;
          min-height: 44px;
          padding: 0 12px;
          border: 1px solid #2c435d;
          border-radius: 11px;
          outline: none;
          background: #0a1727;
          color: #f4f8ff;
          font: inherit;
        }

        .modal-unidade input:focus {
          border-color: #4f87e7;
          box-shadow: 0 0 0 3px rgba(79,135,231,.12);
        }

        .modal-unidade__copiar {
          grid-column: 1 / -1;
          display: flex !important;
          grid-template-columns: none !important;
          flex-direction: row;
          align-items: center;
          gap: 10px !important;
          margin-top: 3px;
          padding: 13px 14px;
          border: 1px solid #2c4562;
          border-radius: 13px;
          background: rgba(70,126,217,.08);
          cursor: pointer;
        }

        .modal-unidade__copiar input {
          width: 18px;
          min-height: 18px;
          height: 18px;
          flex: 0 0 18px;
          accent-color: #4d86ee;
        }

        .modal-unidade__copiar strong {
          display: block;
          color: #edf5ff;
          font-size: .77rem;
        }

        .modal-unidade__copiar small {
          display: block;
          margin-top: 2px;
          color: #8298b5;
          font-size: .67rem;
          font-weight: 600;
        }

        .modal-unidade__erro {
          margin-top: 13px;
          padding: 10px 12px;
          border: 1px solid rgba(248,113,113,.28);
          border-radius: 11px;
          background: rgba(248,113,113,.08);
          color: #ffb6b6;
          font-size: .73rem;
          font-weight: 750;
        }

        .modal-unidade__acoes {
          display: flex;
          justify-content: flex-end;
          gap: 9px;
          margin-top: 17px;
          padding-top: 15px;
          border-top: 1px solid #20344b;
        }

        .modal-unidade__acoes button {
          min-height: 42px;
          padding: 0 16px;
          border-radius: 11px;
          font: inherit;
          font-size: .75rem;
          font-weight: 900;
          cursor: pointer;
        }

        .modal-unidade__cancelar {
          border: 1px solid #30465f;
          background: #101f31;
          color: #b9c9dc;
        }

        .modal-unidade__criar {
          border: 1px solid #3978e8;
          background: linear-gradient(135deg, #1763ee, #4b8dff);
          color: #fff;
          box-shadow: 0 10px 24px rgba(23,99,238,.22);
        }

        .modal-unidade__acoes button:disabled {
          opacity: .58;
          cursor: wait;
        }

        @media (max-width: 720px) {
          .modal-unidade-overlay {
            align-items: end;
            padding: 8px;
          }

          .modal-unidade {
            width: 100%;
            max-height: 94dvh;
            border-radius: 20px 20px 14px 14px;
          }

          .modal-unidade__grade {
            grid-template-columns: 1fr;
          }

          .modal-unidade label.campo-largo,
          .modal-unidade__copiar {
            grid-column: 1;
          }

          .modal-unidade__acoes {
            display: grid;
            grid-template-columns: 1fr 1.25fr;
          }

          .painel-food {
            padding-bottom: 20px !important;
          }

          .painel-food > .topo-painel {
            position: fixed !important;
            z-index: 1200 !important;
            top: 0 !important;
            bottom: 0 !important;
            left: 0 !important;
            width: min(300px, 84vw) !important;
            min-height: 100dvh !important;
            height: 100dvh !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 0 !important;
            padding: 18px 15px calc(18px + env(safe-area-inset-bottom)) !important;
            border-right: 1px solid #26364d !important;
            background: linear-gradient(180deg, #0b1727, #07111f) !important;
            box-shadow: 22px 0 50px rgba(0,0,0,.38) !important;
            transform: translateX(-105%) !important;
            transition: transform .22s ease !important;
            overflow-y: auto !important;
          }

          .painel-food > .topo-painel.menu-mobile-aberto {
            transform: translateX(0) !important;
          }

          .painel-food > .topo-painel .marca-lateral {
            display: grid !important;
            grid-template-columns: auto 1fr auto !important;
            align-items: center !important;
            gap: 10px !important;
            padding: 0 2px 16px !important;
            border-bottom: 1px solid #1f3046 !important;
          }

          .painel-food > .topo-painel .marca-lateral h1 {
            max-width: 150px !important;
            font-size: .92rem !important;
          }

          .painel-food > .topo-painel .rotulo-menu {
            order: 0 !important;
            display: block !important;
            margin: 18px 8px 8px !important;
          }

          .painel-food > .topo-painel .menu-painel {
            position: static !important;
            order: 0 !important;
            width: 100% !important;
            height: auto !important;
            display: grid !important;
            grid-template-columns: 1fr !important;
            gap: 6px !important;
            padding: 0 !important;
            border: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
          }

          .painel-food > .topo-painel .menu-painel a {
            min-height: 48px !important;
            display: flex !important;
            flex-direction: row !important;
            justify-content: flex-start !important;
            gap: 11px !important;
            padding: 0 12px !important;
            border-radius: 12px !important;
          }

          .painel-food > .topo-painel .menu-painel a span {
            width: auto !important;
            font-size: .82rem !important;
            text-align: left !important;
          }

          .painel-food > .topo-painel .lateral-resumo {
            order: 2 !important;
            display: grid !important;
            margin-top: auto !important;
          }

          .painel-food > .topo-painel .acoes-lateral {
            order: 3 !important;
            width: 100% !important;
            display: grid !important;
            grid-template-columns: 1fr !important;
            gap: 7px !important;
            margin-top: 10px !important;
          }

          .painel-food > .topo-painel .acoes-lateral button {
            width: 100% !important;
            min-height: 44px !important;
          }

          .painel-food > .topo-painel .acoes-lateral button span {
            display: inline !important;
          }

          .menu-mobile-topo {
            position: sticky;
            z-index: 1050;
            top: 0;
            min-height: 60px;
            display: flex;
            align-items: center;
            justify-content: flex-start;
            gap: 10px;
            padding: 8px 12px;
            border-bottom: 1px solid #203149;
            background: rgba(8,19,33,.97);
            backdrop-filter: blur(14px);
          }

          .menu-mobile-topo__marca {
            min-width: 0;
            flex: 1;
            display: flex;
            align-items: center;
            gap: 9px;
          }

          .menu-mobile-topo__icone {
            width: 37px;
            height: 37px;
            display: grid;
            place-items: center;
            flex: 0 0 37px;
            border-radius: 10px;
            color: white;
            background: linear-gradient(145deg, #0b5cff, #4987ff);
            font-weight: 950;
          }

          .menu-mobile-topo__texto {
            min-width: 0;
            display: grid;
            gap: 2px;
          }

          .menu-mobile-topo__texto span {
            color: #6d86a7;
            font-size: .57rem;
            font-weight: 900;
            letter-spacing: .09em;
          }

          .menu-mobile-topo__texto strong {
            overflow: hidden;
            color: #f3f7fc;
            font-size: .83rem;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .menu-mobile-topo__botao {
            width: 42px;
            height: 42px;
            display: grid;
            place-items: center;
            flex: 0 0 42px;
            border: 1px solid #2a3e59;
            border-radius: 11px;
            color: #e5eef9;
            background: #101f32;
          }

          .menu-mobile-fechar {
            width: 36px;
            height: 36px;
            display: grid;
            place-items: center;
            flex: 0 0 36px;
            border: 1px solid #2a3e59;
            border-radius: 11px;
            color: #e5eef9;
            background: #101f32;
          }

          .menu-mobile-overlay {
            position: fixed;
            z-index: 1150;
            inset: 0;
            background: rgba(0,0,0,.58);
            backdrop-filter: blur(2px);
          }

          .conteudo-painel {
            padding-top: 16px !important;
          }
        }
      `}</style>

      <div className="menu-mobile-topo">
        <button
          type="button"
          className="menu-mobile-topo__botao"
          onClick={() => setMenuMobileAberto(true)}
          aria-label="Abrir menu"
        >
          <Menu size={22} />
        </button>

        <div className="menu-mobile-topo__marca">
          <div className="menu-mobile-topo__icone">K</div>
          <div className="menu-mobile-topo__texto">
            <span>KODVEXA FOOD</span>
            <strong>{loja?.nome || 'Painel'}</strong>
          </div>
        </div>
      </div>

      {menuMobileAberto && <div className="menu-mobile-overlay" onClick={fecharMenu} />}

      <aside className={`topo-painel ${menuMobileAberto ? 'menu-mobile-aberto' : ''}`}>
        <div className="marca-lateral">
          <div className="marca-lateral__icone">K</div>
          <div>
            <span>KODVEXA FOOD</span>
            <h1>{loja?.nome || 'Painel'}</h1>
          </div>
          <button type="button" className="menu-mobile-fechar" onClick={fecharMenu} aria-label="Fechar menu">
            <X size={19} />
          </button>
        </div>

        {unidades.length > 0 && ehDono && (
          <div className="seletor-unidade">
            <span>UNIDADE ATUAL</span>
            <div className="seletor-unidade__campo">
              <MapPin size={17} />
              <select
                value={loja?.id || localStorage.getItem('kodvexa_unidade_atual') || ''}
                onChange={(e) => selecionarUnidadePainel(e.target.value)}
              >
                {unidades.map((unidade) => (
                  <option key={unidade.estabelecimento_id} value={unidade.estabelecimento_id}>
                    {unidade.nome_unidade || unidade.nome || (unidade.tipo_unidade === 'matriz' ? 'Matriz' : 'Filial')}
                  </option>
                ))}
              </select>
            </div>
            <small>{loja?.tipo_unidade === 'filial' ? 'Filial selecionada' : 'Matriz selecionada'}</small>
            <button
              type="button"
              className="seletor-unidade__adicionar"
              onClick={abrirModalNovaUnidade}
              disabled={limiteUnidadesAtingido}
              title={limiteUnidadesAtingido ? 'Máximo de 3 unidades: 1 Matriz + 2 filiais' : 'Adicionar unidade'}
              style={limiteUnidadesAtingido ? { opacity: .5, cursor: 'not-allowed' } : undefined}
            >
              <Plus size={15} />
              <span>{limiteUnidadesAtingido ? 'Limite de 3 unidades' : 'Adicionar unidade'}</span>
            </button>
          </div>
        )}

        <div className="rotulo-menu">GESTÃO</div>

        <nav className="menu-painel">
          <Link onClick={fecharMenu} className={ativo === 'pedidos' ? 'ativo' : ''} to="/painel">
            <ShoppingBag /><span>Pedidos</span>
          </Link>

          {podeOperarCardapio && (
            <>
              <Link onClick={fecharMenu} className={ativo === 'cardapio' ? 'ativo' : ''} to="/painel/cardapio">
                <ChefHat /><span>Cardápio</span>
              </Link>
              <Link onClick={fecharMenu} className={ativo === 'entregas' ? 'ativo' : ''} to="/painel/entregas">
                <Bike /><span>Entregas</span>
              </Link>
            </>
          )}

          {ehDono && (
            <>
              <Link onClick={fecharMenu} className={ativo === 'configuracoes' ? 'ativo' : ''} to="/painel/configuracoes">
                <Store /><span>Configurações</span>
              </Link>
              <Link onClick={fecharMenu} className={ativo === 'unidades' ? 'ativo' : ''} to="/painel/unidades">
                <LayoutGrid /><span>Unidades</span>
              </Link>
              <Link onClick={fecharMenu} className={ativo === 'equipe' ? 'ativo' : ''} to="/painel/equipe">
                <Users /><span>Equipe</span>
              </Link>
            </>
          )}
        </nav>

        <div className="lateral-resumo">
          <span>LINK DA LOJA</span>
          <strong>{loja?.slug || 'carregando...'}</strong>
          <small>Seu cardápio está pronto para receber pedidos.</small>
        </div>

        <div className="acoes-topo acoes-lateral">
          {loja?.slug && (
            <button onClick={() => { window.open(`/cardapio/${loja.slug}`, '_blank'); fecharMenu() }}>
              <Store /><span>Ver cardápio</span>
            </button>
          )}
          <button onClick={() => supabase.auth.signOut()}>
            <LogOut /><span>Sair</span>
          </button>
        </div>
      </aside>

      {modalUnidadeAberto && (
        <div className="modal-unidade-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !criandoUnidade) setModalUnidadeAberto(false) }}>
          <div className="modal-unidade">
            <div className="modal-unidade__topo">
              <div>
                <span>NOVA UNIDADE</span>
                <h2>Adicionar filial</h2>
                <p>Conheça a assinatura da filial antes de cadastrar a nova unidade.</p>
              </div>
              <button type="button" className="modal-unidade__fechar" onClick={() => !criandoUnidade && setModalUnidadeAberto(false)}>
                <X size={19} />
              </button>
            </div>

            {etapaFilial === 'assinatura' ? (
              <div style={{ padding: '6px 0 2px' }}>
                <div
                  style={{
                    overflow: 'hidden',
                    border: '1px solid rgba(74,116,165,.28)',
                    borderRadius: 18,
                    background: '#0c1d31',
                    boxShadow: '0 22px 55px rgba(0,0,0,.22)',
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0,1fr) 265px',
                      gap: 0,
                    }}
                  >
                    <div style={{ padding: '26px 28px 24px' }}>
                      <span
                        style={{
                          color: '#6ea8ff',
                          fontSize: '.66rem',
                          fontWeight: 950,
                          letterSpacing: '.11em',
                        }}
                      >
                        EXPANSÃO DA REDE
                      </span>

                      <h3
                        style={{
                          margin: '9px 0 8px',
                          maxWidth: 420,
                          color: '#f5f8fc',
                          fontSize: '1.55rem',
                          lineHeight: 1.15,
                          letterSpacing: '-.025em',
                        }}
                      >
                        Sua próxima unidade, no mesmo KODVEXA
                      </h3>

                      <p
                        style={{
                          maxWidth: 450,
                          margin: 0,
                          color: '#8fa4bb',
                          fontSize: '.78rem',
                          lineHeight: 1.55,
                        }}
                      >
                        Adicione uma filial sem criar outra conta. A operação continua organizada por unidade.
                      </p>

                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 18,
                          marginTop: 24,
                          paddingTop: 18,
                          borderTop: '1px solid rgba(148,163,184,.12)',
                        }}
                      >
                        <div>
                          <strong style={{ display: 'block', color: '#e3ebf5', fontSize: '.73rem' }}>
                            Até 5 filiais
                          </strong>
                          <span style={{ color: '#70869e', fontSize: '.65rem' }}>
                            além da Matriz
                          </span>
                        </div>

                        <div>
                          <strong style={{ display: 'block', color: '#e3ebf5', fontSize: '.73rem' }}>
                            Gestão centralizada
                          </strong>
                          <span style={{ color: '#70869e', fontSize: '.65rem' }}>
                            uma única conta
                          </span>
                        </div>

                        <div>
                          <strong style={{ display: 'block', color: '#e3ebf5', fontSize: '.73rem' }}>
                            Operação por unidade
                          </strong>
                          <span style={{ color: '#70869e', fontSize: '.65rem' }}>
                            pedidos e equipe separados
                          </span>
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        padding: '24px 22px',
                        borderLeft: '1px solid rgba(148,163,184,.13)',
                        background: 'rgba(15,38,64,.72)',
                      }}
                    >
                      <span
                        style={{
                          color: '#8299b2',
                          fontSize: '.64rem',
                          fontWeight: 900,
                          letterSpacing: '.08em',
                        }}
                      >
                        POR FILIAL
                      </span>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: 5,
                          margin: '9px 0 4px',
                        }}
                      >
                        <strong
                          style={{
                            color: '#fff',
                            fontSize: '2.05rem',
                            lineHeight: 1,
                            letterSpacing: '-.045em',
                          }}
                        >
                          R$ 29,90
                        </strong>
                        <span style={{ color: '#8299b2', fontSize: '.7rem' }}>/mês</span>
                      </div>

                      <span style={{ color: '#6f869e', fontSize: '.66rem', lineHeight: 1.4 }}>
                        valor adicional ao seu plano
                      </span>

                      <button
                        type="button"
                        onClick={
                          licencasDisponiveis > 0
                            ? () => setEtapaFilial('cadastro')
                            : iniciarPagamentoFilial
                        }
                        disabled={ativandoLicencaTeste || carregandoLicencas}
                        style={{
                          width: '100%',
                          minHeight: 46,
                          marginTop: 20,
                          border: '1px solid #4d8df7',
                          borderRadius: 10,
                          background: '#3478e5',
                          color: '#fff',
                          fontWeight: 950,
                          cursor: ativandoLicencaTeste ? 'wait' : 'pointer',
                          opacity: ativandoLicencaTeste ? .65 : 1,
                          boxShadow: '0 8px 22px rgba(52,120,229,.18)',
                        }}
                      >
                        {ativandoLicencaTeste
                          ? 'Abrindo pagamento...'
                          : licencasDisponiveis > 0
                            ? 'Cadastrar filial'
                            : 'Adicionar filial'}
                      </button>

                      <span
                        style={{
                          display: 'block',
                          marginTop: 10,
                          color: '#687f97',
                          fontSize: '.62rem',
                          textAlign: 'center',
                        }}
                      >
                        Cadastro liberado após a ativação
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                      padding: '11px 28px',
                      borderTop: '1px solid rgba(148,163,184,.12)',
                      background: 'rgba(5,15,27,.28)',
                      color: '#71879f',
                      fontSize: '.65rem',
                    }}
                  >
                    <span>
                      Plano atual <strong style={{ color: '#bac8d7' }}>R$ 79,90/mês</strong>
                    </span>
                    <span>
                      5 filiais <strong style={{ color: '#dbe6f2' }}>R$ 229,40/mês no total</strong>
                    </span>
                  </div>
                </div>

                {erroUnidade && (
                  <div className="modal-unidade__erro" style={{ marginTop: 12 }}>
                    {erroUnidade}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 15,
                    padding: '11px 13px',
                    border: '1px solid rgba(16,185,129,.25)',
                    borderRadius: 13,
                    background: 'rgba(6,78,59,.10)',
                  }}
                >
                  <div>
                    <strong style={{ display: 'block', color: '#6ee7b7', fontSize: '.74rem' }}>
                      ✓ Assinatura ativa
                    </strong>
                    <span style={{ display: 'block', marginTop: 2, color: '#8299b2', fontSize: '.66rem' }}>
                      Agora cadastre os dados da nova filial.
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setEtapaFilial('assinatura')}
                    style={{
                      border: 0,
                      background: 'transparent',
                      color: '#8aa2bd',
                      fontSize: '.68rem',
                      fontWeight: 850,
                      cursor: 'pointer',
                    }}
                  >
                    Voltar
                  </button>
                </div>

            <form onSubmit={criarNovaUnidade}>
              <div className="modal-unidade__grade">
                <label className="campo-largo">
                  Nome da unidade
                  <input
                    value={formUnidade.nome_unidade}
                    onChange={(e) => alterarCampoUnidade('nome_unidade', e.target.value)}
                    placeholder="Ex.: Zona Norte, Viamão, Centro"
                    autoFocus
                  />
                </label>

                <label className="campo-largo">
                  Endereço
                  <input
                    value={formUnidade.endereco}
                    onChange={(e) => alterarCampoUnidade('endereco', e.target.value)}
                    placeholder="Rua, número e bairro"
                  />
                </label>

                <label>
                  Cidade
                  <input
                    value={formUnidade.cidade}
                    onChange={(e) => alterarCampoUnidade('cidade', e.target.value)}
                    placeholder="Porto Alegre"
                  />
                </label>

                <label>
                  Estado
                  <input
                    value={formUnidade.estado}
                    onChange={(e) => alterarCampoUnidade('estado', e.target.value.toUpperCase().slice(0, 2))}
                    placeholder="RS"
                    maxLength={2}
                  />
                </label>

                <label>
                  CEP
                  <input
                    value={formUnidade.cep}
                    onChange={(e) => alterarCampoUnidade('cep', e.target.value)}
                    placeholder="00000-000"
                  />
                </label>

                <label>
                  WhatsApp
                  <input
                    value={formUnidade.whatsapp}
                    onChange={(e) => alterarCampoUnidade('whatsapp', e.target.value)}
                    placeholder="(51) 99999-9999"
                  />
                </label>

                <label className="modal-unidade__copiar">
                  <input
                    type="checkbox"
                    checked={formUnidade.copiar_cardapio}
                    onChange={(e) => alterarCampoUnidade('copiar_cardapio', e.target.checked)}
                  />
                  <span>
                    <strong>Copiar cardápio da Matriz</strong>
                    <small>Cria a filial já com categorias, produtos e adicionais cadastrados.</small>
                  </span>
                </label>
              </div>

              {erroUnidade && <div className="modal-unidade__erro">{erroUnidade}</div>}

              <div className="modal-unidade__acoes">
                <button type="button" className="modal-unidade__cancelar" disabled={criandoUnidade} onClick={() => setModalUnidadeAberto(false)}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="modal-unidade__criar"
                  disabled={criandoUnidade || carregandoLicencas || licencasDisponiveis <= 0}
                >
                  {carregandoLicencas
                    ? 'Verificando licença...'
                    : criandoUnidade
                      ? 'Criando unidade...'
                      : licencasDisponiveis > 0
                        ? 'Criar unidade'
                        : 'Licença necessária'}
                </button>
              </div>
            </form>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}



function PainelEquipe({ sessao }) {
  const [loja, setLoja] = useState(null)
  const [membros, setMembros] = useState([])
  const [convites, setConvites] = useState([])
  const [email, setEmail] = useState('')
  const [funcao, setFuncao] = useState('atendente')
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [processandoConviteId, setProcessandoConviteId] = useState('')
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')

  async function carregarEquipe(estabelecimentoId) {
    const [{ data: equipe, error: erroEquipe }, { data: pendentes, error: erroConvites }] =
      await Promise.all([
        supabase.rpc('get_equipe_unidade', {
          p_estabelecimento_id: estabelecimentoId,
        }),
        supabase.rpc('get_convites_equipe_unidade', {
          p_estabelecimento_id: estabelecimentoId,
        }),
      ])

    if (erroEquipe || erroConvites) {
      setErro(
        erroEquipe?.message ||
        erroConvites?.message ||
        'Não foi possível carregar a equipe.'
      )
      return
    }

    setMembros(equipe || [])
    setConvites(pendentes || [])
  }

  useEffect(() => {
    let cancelado = false

    async function carregar() {
      setCarregando(true)
      setErro('')

      try {
        const contexto = await obterUnidadeAtualCompleta()
        if (cancelado) return

        if (!contexto?.estabelecimento) {
          setErro('Unidade não encontrada.')
          setCarregando(false)
          return
        }

        if (normalizarFuncaoAcesso(contexto?.unidade, contexto?.unidades) !== 'dono') {
          setErro('Somente o dono pode gerenciar a equipe.')
          setCarregando(false)
          return
        }

        setLoja(contexto.estabelecimento)
        await carregarEquipe(contexto.estabelecimento.id)
      } catch (e) {
        if (!cancelado) setErro(e.message || 'Não foi possível abrir a equipe.')
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }

    carregar()
    return () => { cancelado = true }
  }, [sessao.user.id])

  async function enviarEmailConvite(emailDestino) {
    const { error } = await supabase.auth.signInWithOtp({
      email: emailDestino,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/painel/convite`,
      },
    })

    if (error) throw error
  }

  async function adicionar(evento) {
    evento.preventDefault()
    if (!loja?.id) return

    const emailLimpo = email.trim().toLowerCase()

    setSalvando(true)
    setErro('')
    setMensagem('')

    const { data: conviteId, error: erroBanco } = await supabase.rpc(
      'criar_convite_equipe',
      {
        p_estabelecimento_id: loja.id,
        p_email: emailLimpo,
        p_funcao: funcao,
      }
    )

    if (erroBanco) {
      setSalvando(false)
      setErro(erroBanco.message || 'Não foi possível criar o convite.')
      return
    }

    try {
      await enviarEmailConvite(emailLimpo)
    } catch (e) {
      if (conviteId) {
        await supabase.rpc('cancelar_convite_equipe', {
          p_convite_id: conviteId,
        })
      }

      setSalvando(false)
      setErro(
        e.message ||
        'O convite foi preparado, mas o Supabase não conseguiu enviar o e-mail.'
      )
      return
    }

    setSalvando(false)
    setEmail('')
    setFuncao('atendente')
    setMensagem(`Convite enviado para ${emailLimpo}.`)
    await carregarEquipe(loja.id)
  }

  async function reenviarConvite(convite) {
    if (!convite?.id) return

    setProcessandoConviteId(convite.id)
    setErro('')
    setMensagem('')

    try {
      await enviarEmailConvite(convite.email)
      setMensagem(`Convite reenviado para ${convite.email}.`)
    } catch (e) {
      setErro(e.message || 'Não foi possível reenviar o convite.')
    } finally {
      setProcessandoConviteId('')
    }
  }

  async function cancelarConvite(conviteId) {
    if (!loja?.id || !conviteId) return
    if (!window.confirm('Cancelar este convite?')) return

    setProcessandoConviteId(conviteId)
    setErro('')
    setMensagem('')

    const { error } = await supabase.rpc('cancelar_convite_equipe', {
      p_convite_id: conviteId,
    })

    setProcessandoConviteId('')

    if (error) {
      setErro(error.message || 'Não foi possível cancelar o convite.')
      return
    }

    setMensagem('Convite cancelado.')
    await carregarEquipe(loja.id)
  }

  async function alterarFuncao(usuarioId, novaFuncao) {
    if (!loja?.id) return

    setErro('')
    setMensagem('')

    const { error } = await supabase.rpc('alterar_funcao_equipe', {
      p_estabelecimento_id: loja.id,
      p_usuario_id: usuarioId,
      p_funcao: novaFuncao,
    })

    if (error) {
      setErro(error.message || 'Não foi possível alterar a função.')
      return
    }

    setMensagem('Função atualizada.')
    await carregarEquipe(loja.id)
  }

  async function remover(usuarioId) {
    if (!loja?.id) return
    if (!window.confirm('Remover o acesso deste funcionário desta unidade?')) return

    setErro('')
    setMensagem('')

    const { error } = await supabase.rpc('remover_membro_equipe', {
      p_estabelecimento_id: loja.id,
      p_usuario_id: usuarioId,
    })

    if (error) {
      setErro(error.message || 'Não foi possível remover este acesso.')
      return
    }

    setMensagem('Acesso removido.')
    await carregarEquipe(loja.id)
  }

  if (carregando) return <TelaCentral texto="Carregando equipe..." />
  if (!loja) return <TelaCentral texto={erro || 'Não foi possível abrir a equipe.'} erro />

  const nomeUnidade =
    loja.nome_unidade ||
    (loja.tipo_unidade === 'matriz' ? 'Matriz' : loja.nome)

  return (
    <div className="painel-food">
      <NavegacaoPainel loja={loja} ativo="equipe" />

      <main className="conteudo-painel">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 18,
            padding: '20px 22px',
            border: '1px solid #20354d',
            borderRadius: 18,
            background: 'linear-gradient(145deg,#0e1f32,#091726)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
            <div
              style={{
                width: 46,
                height: 46,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 14,
                background: '#102c4f',
                color: '#75a9ff',
              }}
            >
              <Users size={22} />
            </div>

            <div>
              <span
                style={{
                  color: '#6e9fff',
                  fontSize: '.65rem',
                  fontWeight: 950,
                  letterSpacing: '.08em',
                }}
              >
                EQUIPE DA UNIDADE
              </span>
              <h2 style={{ margin: '3px 0 4px', color: '#f4f8ff' }}>
                {nomeUnidade}
              </h2>
              <p style={{ margin: 0, color: '#8192aa', fontSize: '.82rem' }}>
                Convide pessoas sem compartilhar sua senha.
              </p>
            </div>
          </div>

          <div
            style={{
              padding: '7px 10px',
              border: '1px solid rgba(16,185,129,.28)',
              borderRadius: 999,
              background: 'rgba(6,78,59,.16)',
              color: '#6ee7b7',
              fontSize: '.68rem',
              fontWeight: 900,
            }}
          >
            {membros.length} {membros.length === 1 ? 'ACESSO' : 'ACESSOS'}
          </div>
        </div>

        <section
          style={{
            marginBottom: 18,
            padding: 18,
            border: '1px solid #20354d',
            borderRadius: 17,
            background: '#0c1b2c',
          }}
        >
          <div style={{ marginBottom: 14 }}>
            <span
              style={{
                color: '#6e9fff',
                fontSize: '.63rem',
                fontWeight: 950,
                letterSpacing: '.08em',
              }}
            >
              NOVO ACESSO
            </span>
            <h3 style={{ margin: '5px 0 4px', color: '#fff' }}>
              Convidar funcionário
            </h3>
            <p style={{ margin: 0, color: '#8192aa', fontSize: '.78rem' }}>
              Digite o e-mail e o KODVEXA envia o link de acesso automaticamente.
            </p>
          </div>

          <form
            onSubmit={adicionar}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px,1fr) 180px auto',
              gap: 10,
              alignItems: 'end',
            }}
          >
            <label
              style={{
                display: 'grid',
                gap: 6,
                color: '#9eb0c7',
                fontSize: '.72rem',
                fontWeight: 850,
              }}
            >
              E-mail do funcionário
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="funcionario@email.com"
                required
                style={{
                  minHeight: 44,
                  padding: '0 12px',
                  border: '1px solid #29405b',
                  borderRadius: 11,
                  outline: 'none',
                  background: '#091522',
                  color: '#edf5ff',
                }}
              />
            </label>

            <label
              style={{
                display: 'grid',
                gap: 6,
                color: '#9eb0c7',
                fontSize: '.72rem',
                fontWeight: 850,
              }}
            >
              Função
              <select
                value={funcao}
                onChange={(e) => setFuncao(e.target.value)}
                style={{
                  minHeight: 44,
                  padding: '0 10px',
                  border: '1px solid #29405b',
                  borderRadius: 11,
                  background: '#091522',
                  color: '#edf5ff',
                }}
              >
                <option value="gerente">Gerente</option>
                <option value="atendente">Atendente</option>
              </select>
            </label>

            <button
              type="submit"
              disabled={salvando}
              style={{
                minHeight: 44,
                padding: '0 16px',
                border: '1px solid #2d79ff',
                borderRadius: 11,
                background: '#1769ff',
                color: '#fff',
                fontWeight: 900,
                cursor: salvando ? 'wait' : 'pointer',
              }}
            >
              {salvando ? 'Enviando...' : 'Enviar convite'}
            </button>
          </form>

          <div
            style={{
              marginTop: 13,
              paddingTop: 13,
              borderTop: '1px solid #1f344c',
              color: '#7f94ae',
              fontSize: '.72rem',
              lineHeight: 1.45,
            }}
          >
            <b style={{ color: '#d9e6f5' }}>Gerente:</b> Pedidos, Cardápio e Entregas.
            {' · '}
            <b style={{ color: '#d9e6f5' }}>Atendente:</b> operação completa de Pedidos.
          </div>
        </section>

        {erro && <p className="erro-pedido">{erro}</p>}

        {mensagem && (
          <p
            style={{
              padding: 11,
              border: '1px solid rgba(16,185,129,.3)',
              borderRadius: 11,
              background: 'rgba(6,78,59,.12)',
              color: '#6ee7b7',
              fontSize: '.78rem',
            }}
          >
            {mensagem}
          </p>
        )}

        {convites.length > 0 && (
          <section
            style={{
              overflow: 'hidden',
              marginBottom: 18,
              border: '1px solid #20354d',
              borderRadius: 17,
              background: '#0c1b2c',
            }}
          >
            <div
              style={{
                padding: '15px 17px',
                borderBottom: '1px solid #20354d',
                color: '#f4f8ff',
                fontWeight: 900,
              }}
            >
              Convites pendentes
            </div>

            {convites.map((convite) => (
              <div
                key={convite.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '44px minmax(0,1fr) 120px 110px 90px',
                  gap: 10,
                  alignItems: 'center',
                  padding: '13px 16px',
                  borderBottom: '1px solid #1c3046',
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 11,
                    background: 'rgba(245,158,11,.10)',
                    color: '#fbbf24',
                  }}
                >
                  <Bell size={17} />
                </div>

                <div style={{ minWidth: 0 }}>
                  <strong
                    style={{
                      display: 'block',
                      overflow: 'hidden',
                      color: '#edf5ff',
                      fontSize: '.82rem',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {convite.email}
                  </strong>
                  <small style={{ color: '#9a7b42', fontSize: '.67rem' }}>
                    Aguardando aceite
                  </small>
                </div>

                <div
                  style={{
                    color: '#a9bdd6',
                    fontSize: '.7rem',
                    fontWeight: 850,
                    textTransform: 'capitalize',
                  }}
                >
                  {convite.funcao}
                </div>

                <button
                  type="button"
                  disabled={processandoConviteId === convite.id}
                  onClick={() => reenviarConvite(convite)}
                  style={{
                    minHeight: 36,
                    border: '1px solid #315b91',
                    borderRadius: 9,
                    background: '#10233d',
                    color: '#a9c8f7',
                    fontWeight: 850,
                    cursor: 'pointer',
                  }}
                >
                  Reenviar
                </button>

                <button
                  type="button"
                  disabled={processandoConviteId === convite.id}
                  onClick={() => cancelarConvite(convite.id)}
                  style={{
                    minHeight: 36,
                    border: '1px solid rgba(239,68,68,.28)',
                    borderRadius: 9,
                    background: 'rgba(127,29,29,.13)',
                    color: '#f6a7a7',
                    fontWeight: 850,
                    cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
              </div>
            ))}
          </section>
        )}

        <section
          style={{
            overflow: 'hidden',
            border: '1px solid #20354d',
            borderRadius: 17,
            background: '#0c1b2c',
          }}
        >
          <div
            style={{
              padding: '15px 17px',
              borderBottom: '1px solid #20354d',
              color: '#f4f8ff',
              fontWeight: 900,
            }}
          >
            Acessos desta unidade
          </div>

          {!membros.length && (
            <div style={{ padding: 28, color: '#8192aa', textAlign: 'center' }}>
              Nenhum acesso encontrado.
            </div>
          )}

          {membros.map((membro) => {
            const ehDono = membro.funcao === 'dono'

            return (
              <div
                key={membro.usuario_id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '44px minmax(0,1fr) 170px 90px',
                  gap: 12,
                  alignItems: 'center',
                  padding: '14px 16px',
                  borderBottom: '1px solid #1c3046',
                }}
              >
                <div
                  style={{
                    width: 42,
                    height: 42,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 12,
                    background: ehDono ? 'rgba(45,121,255,.14)' : '#10243a',
                    color: ehDono ? '#75a9ff' : '#9db4cf',
                  }}
                >
                  {ehDono ? <ShieldCheck size={19} /> : <Users size={18} />}
                </div>

                <div style={{ minWidth: 0 }}>
                  <strong
                    style={{
                      display: 'block',
                      overflow: 'hidden',
                      color: '#edf5ff',
                      fontSize: '.84rem',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {membro.email}
                  </strong>
                  <small style={{ color: '#7890ad', fontSize: '.68rem' }}>
                    {ehDono ? 'Proprietário da unidade' : 'Acesso individual'}
                  </small>
                </div>

                {ehDono ? (
                  <div
                    style={{
                      minHeight: 38,
                      display: 'grid',
                      placeItems: 'center',
                      border: '1px solid #315b91',
                      borderRadius: 10,
                      background: '#10233d',
                      color: '#7eb0ff',
                      fontSize: '.7rem',
                      fontWeight: 900,
                    }}
                  >
                    DONO
                  </div>
                ) : (
                  <select
                    value={membro.funcao}
                    onChange={(e) => alterarFuncao(membro.usuario_id, e.target.value)}
                    style={{
                      minHeight: 38,
                      padding: '0 9px',
                      border: '1px solid #29405b',
                      borderRadius: 10,
                      background: '#091522',
                      color: '#edf5ff',
                      fontSize: '.72rem',
                      fontWeight: 800,
                    }}
                  >
                    <option value="gerente">Gerente</option>
                    <option value="atendente">Atendente</option>
                  </select>
                )}

                <button
                  type="button"
                  disabled={ehDono}
                  onClick={() => remover(membro.usuario_id)}
                  style={{
                    minHeight: 38,
                    border: '1px solid rgba(239,68,68,.28)',
                    borderRadius: 10,
                    background: ehDono ? '#102034' : 'rgba(127,29,29,.13)',
                    color: ehDono ? '#52677f' : '#f6a7a7',
                    fontWeight: 850,
                    cursor: ehDono ? 'not-allowed' : 'pointer',
                  }}
                >
                  Remover
                </button>
              </div>
            )
          })}
        </section>
      </main>
    </div>
  )
}

function PainelUnidades({ sessao }) {
  const [loja, setLoja] = useState(null)
  const [unidades, setUnidades] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [salvandoId, setSalvandoId] = useState('')
  const [excluindoId, setExcluindoId] = useState('')
  const [sincronizandoId, setSincronizandoId] = useState('')

  async function carregarUnidades() {
    setCarregando(true)
    setErro('')

    const { data: vinculos, error } = await supabase
      .from('estabelecimento_usuarios')
      .select('estabelecimento_id, funcao, estabelecimentos(*)')
      .eq('usuario_id', sessao.user.id)

    if (error) {
      setErro(error.message || 'Não foi possível carregar as unidades.')
      setCarregando(false)
      return
    }

    const lista = (vinculos || [])
      .map((item) => ({ ...item.estabelecimentos, funcao: item.funcao }))
      .filter(Boolean)
      .sort((a, b) => {
        if (a.tipo_unidade === 'matriz' && b.tipo_unidade !== 'matriz') return -1
        if (a.tipo_unidade !== 'matriz' && b.tipo_unidade === 'matriz') return 1
        return String(a.nome_unidade || a.nome || '').localeCompare(String(b.nome_unidade || b.nome || ''))
      })

    setUnidades(lista)

    const unidadeAtualId = localStorage.getItem('kodvexa_unidade_atual')
    const atual = lista.find((u) => u.id === unidadeAtualId)
      || lista.find((u) => u.tipo_unidade === 'matriz')
      || lista[0]
      || null

    setLoja(atual)
    setCarregando(false)
  }

  useEffect(() => {
    carregarUnidades()
  }, [sessao.user.id])

  function usarUnidade(id) {
    localStorage.setItem('kodvexa_unidade_atual', id)
    window.location.href = '/painel'
  }

  function editarUnidade(id) {
    localStorage.setItem('kodvexa_unidade_atual', id)
    window.location.href = '/painel/configuracoes'
  }

  async function alternarUnidade(unidade) {
    if (unidade.tipo_unidade === 'matriz') return

    const novoStatus = !Boolean(unidade.unidade_ativa)
    setSalvandoId(unidade.id)
    setErro('')

    const { error } = await supabase
      .from('estabelecimentos')
      .update({ unidade_ativa: novoStatus })
      .eq('id', unidade.id)

    if (error) {
      setErro(error.message || 'Não foi possível alterar o status da unidade.')
      setSalvandoId('')
      return
    }

    if (!novoStatus && localStorage.getItem('kodvexa_unidade_atual') === unidade.id) {
      const matriz = unidades.find((item) => item.tipo_unidade === 'matriz')
      if (matriz?.id) localStorage.setItem('kodvexa_unidade_atual', matriz.id)
    }

    await carregarUnidades()
    setSalvandoId('')
  }

  async function sincronizarCardapio(unidade) {
    if (!unidade?.id || unidade.tipo_unidade !== 'filial') return

    setSincronizandoId(unidade.id)
    setErro('')

    const matrizId =
      unidade.matriz_id ||
      unidades.find((item) => item.tipo_unidade === 'matriz')?.id

    if (!matrizId) {
      setErro('Não foi possível localizar a Matriz desta filial.')
      setSincronizandoId('')
      return
    }

    const { error } = await supabase.rpc('sincronizar_cardapio_filial', {
      p_matriz_id: matrizId,
      p_filial_id: unidade.id,
    })

    setSincronizandoId('')

    if (error) {
      setErro(error.message || 'Não foi possível sincronizar o cardápio.')
      return
    }

    window.alert(`Cardápio de ${unidade.nome_unidade || 'filial'} sincronizado com sucesso.`)
  }

  async function excluirFilial(unidade) {
    if (!unidade?.id || unidade.tipo_unidade !== 'filial') return

    const nome = unidade.nome_unidade || unidade.nome || 'esta filial'

    const confirmou = window.confirm(
      `Excluir a filial "${nome}"?\n\n` +
      'Os pedidos e o histórico serão preservados.\n' +
      'A licença usada por esta filial NÃO poderá ser reutilizada em outra loja.'
    )

    if (!confirmou) return

    setExcluindoId(unidade.id)
    setErro('')

    const { error } = await supabase.rpc('excluir_filial_seguro', {
      p_filial_id: unidade.id,
    })

    setExcluindoId('')

    if (error) {
      setErro(error.message || 'Não foi possível excluir a filial.')
      return
    }

    if (localStorage.getItem('kodvexa_unidade_atual') === unidade.id) {
      const matriz = unidades.find((item) => item.tipo_unidade === 'matriz')
      if (matriz?.id) {
        localStorage.setItem('kodvexa_unidade_atual', matriz.id)
      }
    }

    await carregarUnidades()
  }

  if (carregando) return <TelaCentral texto="Carregando unidades..." />

  return (
    <div className="painel-shell">
      <NavegacaoPainel loja={loja} ativo="unidades" />
      <main className="painel-conteudo painel-unidades">
        <style>{`
          .painel-shell:has(.painel-unidades) {
            min-height: 100vh !important;
            background: #07111f !important;
          }

          .painel-shell:has(.painel-unidades) {
            display: block !important;
            width: 100% !important;
            min-width: 0 !important;
          }

          .painel-unidades {
            position: relative !important;
            inset: auto !important;
            transform: none !important;
            width: calc(100vw - 226px) !important;
            max-width: calc(100vw - 226px) !important;
            min-width: 0 !important;
            min-height: 100vh !important;
            margin: 0 0 0 226px !important;
            padding: 28px 30px 40px !important;
            box-sizing: border-box !important;
            overflow-x: hidden !important;
            background:
              radial-gradient(circle at 92% 0%, rgba(38,112,255,.10), transparent 28%),
              linear-gradient(180deg, #081421 0%, #07111f 100%) !important;
            color: #f4f8ff !important;
          }

          .painel-unidades *,
          .painel-unidades *::before,
          .painel-unidades *::after {
            box-sizing: border-box;
          }

          .unidades-topo {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 18px;
            margin: 0 0 20px;
            padding: 22px 24px;
            border: 1px solid #20354d;
            border-radius: 18px;
            background: linear-gradient(145deg, rgba(14,31,50,.96), rgba(9,23,38,.96));
            box-shadow: 0 12px 30px rgba(0,0,0,.12);
          }

          .unidades-topo span {
            display: block;
            margin-bottom: 6px;
            color: #6e9fff;
            font-size: .68rem;
            font-weight: 950;
            letter-spacing: .1em;
          }

          .unidades-topo h1 {
            margin: 0;
            color: #f3f7ff;
            font-size: 1.75rem;
            line-height: 1.05;
            letter-spacing: -.03em;
          }

          .unidades-topo p {
            margin: 7px 0 0;
            color: #8192aa;
            font-size: .86rem;
          }

          .unidades-resumo {
            width: 100%;
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 12px;
            margin: 0 0 18px;
          }

          .unidades-resumo article {
            min-width: 0;
            padding: 16px 18px;
            border: 1px solid #20354d;
            border-radius: 16px;
            background: linear-gradient(180deg, #0d1e30, #0a1929);
          }

          .unidades-resumo small {
            display: block;
            color: #7287a1;
            font-size: .66rem;
            font-weight: 900;
            letter-spacing: .07em;
          }

          .unidades-resumo strong {
            display: block;
            margin-top: 5px;
            color: #fff;
            font-size: 1.45rem;
          }

          .unidades-grade {
            width: 100%;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            align-items: stretch;
            gap: 14px;
          }

          .unidade-card {
            position: relative;
            min-width: 0;
            overflow: hidden;
            padding: 18px;
            border: 1px solid #223750;
            border-radius: 18px;
            background: linear-gradient(180deg, #0e1e31, #0a1726);
            box-shadow: 0 14px 28px rgba(0,0,0,.12);
          }

          .unidade-card.atual {
            border-color: #2d79ff;
            box-shadow: 0 0 0 1px rgba(45,121,255,.22), 0 18px 34px rgba(0,0,0,.16);
          }

          .unidade-card.desativada { opacity: .62; }

          .unidade-card__topo {
            display: flex;
            justify-content: space-between;
            gap: 14px;
            align-items: flex-start;
          }

          .unidade-card__icone {
            width: 44px;
            height: 44px;
            display: grid;
            place-items: center;
            flex: 0 0 44px;
            border-radius: 13px;
            background: #102c4f;
            color: #75a9ff;
          }

          .unidade-card__titulo {
            display: flex;
            gap: 12px;
            min-width: 0;
          }

          .unidade-card__titulo > div:last-child { min-width: 0; }

          .unidade-card__titulo h3 {
            margin: 0;
            overflow: hidden;
            color: #f5f8ff;
            font-size: 1.04rem;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .unidade-card__titulo p {
            margin: 5px 0 0;
            color: #7f91a9;
            font-size: .76rem;
          }

          .unidade-selo {
            flex: 0 0 auto;
            padding: 5px 8px;
            border-radius: 999px;
            background: rgba(54,211,153,.1);
            color: #60dfa9;
            font-size: .62rem;
            font-weight: 950;
            white-space: nowrap;
          }

          .unidade-selo.off {
            background: rgba(248,113,113,.1);
            color: #f59b9b;
          }

          .unidade-card__dados {
            display: grid;
            gap: 8px;
            margin: 17px 0;
            padding: 14px 0;
            border-top: 1px solid #1d3045;
            border-bottom: 1px solid #1d3045;
          }

          .unidade-card__dados span {
            display: grid;
            grid-template-columns: 18px minmax(0, 1fr);
            align-items: center;
            gap: 8px;
            min-width: 0;
            color: #9aabc0;
            font-size: .76rem;
          }

          .unidade-card__dados b {
            min-width: 0;
            overflow: hidden;
            color: #dbe6f5;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .unidade-card__acoes {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }

          .unidade-card__acoes button {
            min-width: 0;
            min-height: 40px;
            padding: 0 14px;
            border: 1px solid #2b425d;
            border-radius: 11px;
            background: #102034;
            color: #c8d7ea;
            font: inherit;
            font-size: .72rem;
            font-weight: 900;
            cursor: pointer;
          }

          .unidade-card__acoes button.primario-unidade {
            border-color: #2d79ff;
            background: linear-gradient(135deg, #1769ff, #287dff);
            color: #fff;
          }

          .unidade-card__acoes button.perigo {
            min-width: 72px;
            padding: 0 11px;
            color: #f6a7a7;
          }

          .unidade-card__acoes button:disabled {
            opacity: .45;
            cursor: not-allowed;
          }

          .unidade-vazia {
            width: 100%;
            padding: 34px;
            border: 1px dashed #29405c;
            border-radius: 18px;
            color: #8396ae;
            text-align: center;
          }

          @media (max-width: 1180px) {
            .unidades-grade { grid-template-columns: 1fr; }
          }

          @media (max-width: 720px) {
            .painel-unidades {
              width: 100vw !important;
              max-width: 100vw !important;
              margin-left: 0 !important;
              padding: 86px 14px 28px !important;
            }

            .unidades-topo {
              align-items: flex-start;
              flex-direction: column;
              padding: 18px;
            }

            .unidades-topo h1 { font-size: 1.45rem; }

            .unidades-resumo {
              grid-template-columns: 1fr 1fr;
            }

            .unidades-resumo article:first-child {
              grid-column: 1 / -1;
            }

            .unidade-card {
              padding: 15px;
            }

            .unidade-card__acoes {
              grid-template-columns: 1fr 1fr;
            }

            .unidade-card__acoes button.perigo {
              grid-column: 1 / -1;
            }
          }
        `}</style>

        <section className="unidades-topo">
          <div>
            <span>ESTRUTURA DA EMPRESA</span>
            <h1>Gerenciar unidades</h1>
            <p>Veja a matriz e todas as filiais em um só lugar.</p>
          </div>
        </section>

        <section className="unidades-resumo">
          <article><small>TOTAL DE UNIDADES</small><strong>{unidades.length}</strong></article>
          <article><small>ATIVAS</small><strong>{unidades.filter((u) => u.unidade_ativa !== false).length}</strong></article>
          <article><small>FILIAIS</small><strong>{unidades.filter((u) => u.tipo_unidade === 'filial').length}</strong></article>
        </section>

        {erro && <div className="erro-pedido" style={{ marginBottom: 14 }}>{erro}</div>}

        <section className="unidades-grade">
          {unidades.map((unidade) => {
            const atual = localStorage.getItem('kodvexa_unidade_atual') === unidade.id
            const ativa = unidade.unidade_ativa !== false
            return (
              <article key={unidade.id} className={`unidade-card ${atual ? 'atual' : ''} ${!ativa ? 'desativada' : ''}`}>
                <div className="unidade-card__topo">
                  <div className="unidade-card__titulo">
                    <div className="unidade-card__icone"><Store size={21} /></div>
                    <div>
                      <h3>{unidade.nome_unidade || unidade.nome || 'Unidade'}</h3>
                      <p>{unidade.tipo_unidade === 'matriz' ? 'Matriz principal' : 'Filial'}{atual ? ' • Unidade atual' : ''}</p>
                    </div>
                  </div>
                  <span className={`unidade-selo ${ativa ? '' : 'off'}`}>{ativa ? 'ATIVA' : 'PAUSADA'}</span>
                </div>

                <div className="unidade-card__dados">
                  <span><MapPin size={15} /><b>{[unidade.endereco, unidade.cidade, unidade.estado].filter(Boolean).join(' • ') || 'Endereço não informado'}</b></span>
                  <span><Home size={15} /><b>{unidade.slug || 'Sem link configurado'}</b></span>
                  <span><Bell size={15} /><b>{unidade.whatsapp || unidade.telefone || 'WhatsApp não informado'}</b></span>
                </div>

                <div className="unidade-card__acoes">
                  <button type="button" className="primario-unidade" disabled={!ativa} onClick={() => usarUnidade(unidade.id)}>Usar unidade</button>

                  {(unidade.tipo_unidade === 'filial' || unidade.matriz_id) && (
                    <button
                      type="button"
                      disabled={sincronizandoId === unidade.id}
                      onClick={() => sincronizarCardapio(unidade)}
                      title="Trazer novidades da Matriz sem alterar preço ou disponibilidade desta filial"
                      style={{
                        borderColor: '#2d79ff',
                        color: '#cfe1ff',
                        background: 'rgba(45,121,255,.10)',
                      }}
                    >
                      {sincronizandoId === unidade.id ? 'Sincronizando...' : 'Sincronizar cardápio'}
                    </button>
                  )}

                  <button type="button" onClick={() => editarUnidade(unidade.id)}>Editar</button>
                  <button
                    type="button"
                    className="perigo"
                    disabled={unidade.tipo_unidade === 'matriz' || salvandoId === unidade.id}
                    onClick={() => alternarUnidade(unidade)}
                    title={unidade.tipo_unidade === 'matriz' ? 'A matriz não pode ser desativada' : ativa ? 'Pausar unidade' : 'Reativar unidade'}
                  >
                    {salvandoId === unidade.id ? '...' : ativa ? 'Pausar' : 'Ativar'}
                  </button>

                  {unidade.tipo_unidade === 'filial' && (
                    <button
                      type="button"
                      disabled={excluindoId === unidade.id}
                      onClick={() => excluirFilial(unidade)}
                      title="Excluir filial preservando o histórico"
                      style={{
                        minHeight: 40,
                        border: '1px solid rgba(239,68,68,.45)',
                        borderRadius: 10,
                        background: 'rgba(127,29,29,.16)',
                        color: '#fca5a5',
                        fontWeight: 900,
                        cursor: excluindoId === unidade.id ? 'wait' : 'pointer',
                      }}
                    >
                      {excluindoId === unidade.id ? 'Excluindo...' : 'Excluir filial'}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </section>

        {!unidades.length && <div className="unidade-vazia">Nenhuma unidade encontrada para este acesso.</div>}
      </main>
    </div>
  )
}

function PainelCardapio({ sessao }) {
  const vazioProduto = { id: '', nome: '', descricao: '', preco: '', categoria_id: '', destaque: false, disponivel: true }
  const [loja, setLoja] = useState(null)
  const [categorias, setCategorias] = useState([])
  const [produtos, setProdutos] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [categoriaNova, setCategoriaNova] = useState('')
  const [produtoForm, setProdutoForm] = useState(vazioProduto)
  const [modalProduto, setModalProduto] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [arquivoImagem, setArquivoImagem] = useState(null)
  const [previewImagem, setPreviewImagem] = useState('')
  const [gruposAdicionaisPainel, setGruposAdicionaisPainel] = useState([])
  const [adicionaisPainel, setAdicionaisPainel] = useState([])
  const [vinculosAdicionais, setVinculosAdicionais] = useState([])
  const [grupoForm, setGrupoForm] = useState({ nome: '', obrigatorio: false, minimo: 0, maximo: 1 })
  const [adicionalForm, setAdicionalForm] = useState({ grupo_id: '', nome: '', preco: '' })

  async function carregarTudo() {
    setErro('')
    let contexto
    try {
      contexto = await obterUnidadeAtualCompleta()
    } catch (e) {
      setErro(e.message || 'Não foi possível carregar a unidade.')
      setCarregando(false)
      return
    }
    if (!contexto?.estabelecimento) { setErro('Usuário sem estabelecimento vinculado.'); setCarregando(false); return }
    const estabelecimentoId = contexto.estabelecimento.id
    setLoja(contexto.estabelecimento)
    const [{ data: cats, error: erroCats }, { data: prods, error: erroProds }, { data: grupos, error: erroGrupos }, { data: ops, error: erroOps }] = await Promise.all([
      supabase.from('categorias').select('*').eq('estabelecimento_id', estabelecimentoId).order('ordem'),
      supabase.from('produtos').select('*').eq('estabelecimento_id', estabelecimentoId).order('ordem'),
      supabase.from('grupos_adicionais').select('*').eq('estabelecimento_id', estabelecimentoId).order('ordem'),
      supabase.from('adicionais').select('*').eq('estabelecimento_id', estabelecimentoId).order('ordem'),
    ])
    const idsProdutos = (prods || []).map((p) => p.id)
    const { data: vinculos } = idsProdutos.length ? await supabase.from('produto_grupos_adicionais').select('*').in('produto_id', idsProdutos) : { data: [] }
    if (erroCats || erroProds || erroGrupos || erroOps) setErro(erroCats?.message || erroProds?.message || erroGrupos?.message || erroOps?.message)
    setCategorias(cats || [])
    setProdutos(prods || [])
    setGruposAdicionaisPainel(grupos || [])
    setAdicionaisPainel(ops || [])
    setVinculosAdicionais(vinculos || [])
    if (!adicionalForm.grupo_id && grupos?.[0]?.id) setAdicionalForm((atual) => ({ ...atual, grupo_id: grupos[0].id }))
    setCarregando(false)
  }

  useEffect(() => { carregarTudo() }, [sessao.user.id])

  async function criarCategoria(evento) {
    evento.preventDefault()
    if (!categoriaNova.trim()) return
    const { error } = await supabase.from('categorias').insert({ estabelecimento_id: loja.id, nome: categoriaNova.trim(), ordem: categorias.length + 1 })
    if (error) setErro(error.message); else { setCategoriaNova(''); carregarTudo() }
  }

  async function alternarCategoria(categoria) {
    const { error } = await supabase.from('categorias').update({ ativo: !categoria.ativo }).eq('id', categoria.id)
    if (error) setErro(error.message); else carregarTudo()
  }

  function novoProduto(categoriaId = '') {
    setProdutoForm({ ...vazioProduto, categoria_id: categoriaId || categorias[0]?.id || '' })
    setArquivoImagem(null)
    setPreviewImagem('')
    setModalProduto(true)
  }

  function editarProduto(produto) {
    setProdutoForm({ ...produto, preco: String(produto.preco).replace('.', ',') })
    setArquivoImagem(null)
    setPreviewImagem(produto.imagem_url || '')
    setModalProduto(true)
  }

  function escolherImagem(evento) {
    const arquivo = evento.target.files?.[0]
    if (!arquivo) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(arquivo.type)) { setErro('Use uma imagem JPG, PNG ou WEBP.'); return }
    if (arquivo.size > 5 * 1024 * 1024) { setErro('A imagem deve ter no máximo 5 MB.'); return }
    setArquivoImagem(arquivo)
    setPreviewImagem(URL.createObjectURL(arquivo))
  }

  async function salvarProduto(evento) {
    evento.preventDefault()
    const preco = Number(String(produtoForm.preco).replace(',', '.'))
    if (!produtoForm.nome.trim() || !produtoForm.categoria_id || !Number.isFinite(preco) || preco < 0) { setErro('Preencha nome, categoria e preço corretamente.'); return }
    setSalvando(true)
    let imagemUrl = produtoForm.imagem_url || null
    if (arquivoImagem) {
      const extensao = arquivoImagem.name.split('.').pop().toLowerCase()
      const caminho = `${loja.id}/${crypto.randomUUID()}.${extensao}`
      const { error: erroUpload } = await supabase.storage.from('produtos').upload(caminho, arquivoImagem, { cacheControl: '3600', upsert: false })
      if (erroUpload) { setErro(`Erro ao enviar imagem: ${erroUpload.message}`); setSalvando(false); return }
      imagemUrl = supabase.storage.from('produtos').getPublicUrl(caminho).data.publicUrl
    }
    const dados = { estabelecimento_id: loja.id, categoria_id: produtoForm.categoria_id, nome: produtoForm.nome.trim(), descricao: produtoForm.descricao.trim() || null, preco, imagem_url: imagemUrl, destaque: produtoForm.destaque, disponivel: produtoForm.disponivel }
    const resultado = produtoForm.id
      ? await supabase.from('produtos').update(dados).eq('id', produtoForm.id)
      : await supabase.from('produtos').insert(dados)
    setSalvando(false)
    if (resultado.error) setErro(resultado.error.message)
    else { setModalProduto(false); setProdutoForm(vazioProduto); setArquivoImagem(null); setPreviewImagem(''); carregarTudo() }
  }

  async function criarGrupoAdicional(evento) {
    evento.preventDefault(); setErro(''); if (!grupoForm.nome.trim()) return
    const { error } = await supabase.from('grupos_adicionais').insert({ estabelecimento_id: loja.id, nome: grupoForm.nome.trim(), obrigatorio: grupoForm.obrigatorio, minimo: grupoForm.obrigatorio ? 1 : 0, maximo: Math.max(1, Number(grupoForm.maximo || 1)), ordem: gruposAdicionaisPainel.length + 1, ativo: true })
    if (error) setErro(error.message); else { setGrupoForm({ nome: '', obrigatorio: false, minimo: 0, maximo: 1 }); carregarTudo() }
  }

  async function criarGrupoNoProduto(evento) {
    evento.preventDefault()
    setErro('')
    if (!produtoForm.id) {
      setErro('Salve o produto primeiro para cadastrar adicionais.')
      return
    }
    if (!grupoForm.nome.trim()) return

    const { data: grupo, error } = await supabase
      .from('grupos_adicionais')
      .insert({
        estabelecimento_id: loja.id,
        nome: grupoForm.nome.trim(),
        obrigatorio: grupoForm.obrigatorio,
        minimo: grupoForm.obrigatorio ? 1 : 0,
        maximo: Math.max(1, Number(grupoForm.maximo || 1)),
        ordem: gruposAdicionaisPainel.length + 1,
        ativo: true
      })
      .select()
      .single()

    if (error) {
      setErro(error.message)
      return
    }

    const { error: erroVinculo } = await supabase
      .from('produto_grupos_adicionais')
      .insert({ produto_id: produtoForm.id, grupo_id: grupo.id })

    if (erroVinculo) {
      setErro(erroVinculo.message)
      return
    }

    setGrupoForm({ nome: '', obrigatorio: false, minimo: 0, maximo: 1 })
    await carregarTudo()
  }

  async function criarAdicional(evento, grupoId) {
    evento.preventDefault()
    setErro('')
    const preco = Number(String(adicionalForm.preco || '0').replace(',', '.'))
    if (!grupoId || !adicionalForm.nome.trim() || !Number.isFinite(preco) || preco < 0) return

    const { error } = await supabase.from('adicionais').insert({
      estabelecimento_id: loja.id,
      grupo_id: grupoId,
      nome: adicionalForm.nome.trim(),
      preco,
      disponivel: true,
      ordem: adicionaisPainel.filter((a) => a.grupo_id === grupoId).length + 1
    })

    if (error) {
      setErro(error.message)
    } else {
      setAdicionalForm({ grupo_id: '', nome: '', preco: '' })
      carregarTudo()
    }
  }

  async function alternarAdicionalDisponivel(adicional) { const { error } = await supabase.from('adicionais').update({ disponivel: !adicional.disponivel }).eq('id', adicional.id); if (error) setErro(error.message); else carregarTudo() }
  async function alternarGrupoProduto(produtoId, grupoId) { const existe = vinculosAdicionais.some((v) => v.produto_id === produtoId && v.grupo_id === grupoId); const r = existe ? await supabase.from('produto_grupos_adicionais').delete().eq('produto_id', produtoId).eq('grupo_id', grupoId) : await supabase.from('produto_grupos_adicionais').insert({ produto_id: produtoId, grupo_id: grupoId }); if (r.error) setErro(r.error.message); else carregarTudo() }


  async function alternarProduto(produto) {
    if (!loja?.id) return

    const novoStatus = !produto.disponivel
    setProdutos((lista) => lista.map((p) => p.id === produto.id ? { ...p, disponivel: novoStatus } : p))

    const { error } = await supabase
      .from('produtos')
      .update({ disponivel: novoStatus })
      .eq('id', produto.id)
      .eq('estabelecimento_id', loja.id)

    if (error) {
      setErro(error.message)
      carregarTudo()
    }
  }

  if (carregando) return <TelaCentral texto="Carregando cardápio..." />

  return (
    <div className="painel-food">
      <NavegacaoPainel loja={loja} ativo="cardapio" />
      <main className="conteudo-painel">
        <div className="titulo-cardapio-painel"><div><h2>Seu cardápio</h2><p>Cadastre categorias e produtos que aparecerão para seus clientes.</p></div><button className="botao-novo" onClick={() => novoProduto()}><Plus /> Novo produto</button></div>
        {erro && <p className="erro-pedido">{erro}</p>}
        <form className="nova-categoria" onSubmit={criarCategoria}><input value={categoriaNova} onChange={(e) => setCategoriaNova(e.target.value)} placeholder="Nome da nova categoria" /><button><Plus /> Criar categoria</button></form>

        <section className="categorias-painel">
          {categorias.map((categoria) => (
            <article className="categoria-painel" key={categoria.id}>
              <div className="categoria-painel__topo"><div><h3>{categoria.nome}</h3><span>{categoria.ativo ? 'Visível no cardápio' : 'Categoria pausada'}</span></div><div><button className="botao-link" onClick={() => novoProduto(categoria.id)}><Plus /> Produto</button><button className={`interruptor ${categoria.ativo ? 'ligado' : ''}`} onClick={() => alternarCategoria(categoria)}><i /></button></div></div>
              <div className="lista-produtos-painel">
                {produtos.filter((p) => p.categoria_id === categoria.id).map((produto) => (
                  <div className={`produto-painel ${!produto.disponivel ? 'pausado' : ''}`} key={produto.id}>
                    <div className="miniatura-produto">{produto.imagem_url ? <img src={produto.imagem_url} alt="" /> : <ShoppingBag />}</div>
                    <div className="produto-painel__texto"><strong>{produto.nome}</strong><span>{produto.descricao || 'Sem descrição'}</span><b>{dinheiro(produto.preco)}</b></div>
                    <button
                      type="button"
                      onClick={() => alternarProduto(produto)}
                      title={produto.disponivel ? 'Marcar produto como esgotado' : 'Disponibilizar produto'}
                      style={{
                        minWidth: 118,
                        minHeight: 38,
                        padding: '0 12px',
                        borderRadius: 10,
                        border: produto.disponivel ? '1px solid rgba(16,185,129,.34)' : '1px solid rgba(239,68,68,.34)',
                        background: produto.disponivel ? 'rgba(6,78,59,.18)' : 'rgba(127,29,29,.16)',
                        color: produto.disponivel ? '#6ee7b7' : '#fca5a5',
                        fontWeight: 900,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {produto.disponivel ? 'Disponível' : 'Esgotado'}
                    </button>
                    <button className="editar-produto" onClick={() => editarProduto(produto)}>Editar</button>
                  </div>
                ))}
                {!produtos.some((p) => p.categoria_id === categoria.id) && <div className="categoria-vazia">Nenhum produto nesta categoria.</div>}
              </div>
            </article>
          ))}
          {!categorias.length && <div className="sem-pedidos"><ShoppingBag /><h3>Crie a primeira categoria</h3><p>Depois você poderá adicionar os produtos.</p></div>}
        </section>

      </main>

      {modalProduto && (
        <div className="modal-fundo">
          <style>{`
            @media (min-width: 900px) {
              .form-produto.editor-produto-desktop {
                width: min(1120px, calc(100vw - 80px)) !important;
                max-width: 1120px !important;
                max-height: calc(100vh - 60px) !important;
                padding: 28px 30px !important;
                overflow-y: auto !important;
              }

              .editor-produto-desktop .produto-editor-grid {
                display: grid;
                grid-template-columns: minmax(0, .92fr) minmax(440px, 1.08fr);
                gap: 26px;
                align-items: start;
              }

              .editor-produto-desktop .produto-editor-principal,
              .editor-produto-desktop .produto-editor-adicionais {
                min-width: 0;
                display: grid;
                gap: 14px;
              }

              .editor-produto-desktop .produto-editor-principal {
                position: sticky;
                top: 0;
              }

              .editor-produto-desktop .upload-imagem > div {
                height: 220px !important;
              }

              .editor-produto-desktop .produto-editor-adicionais {
                padding: 18px;
                border: 1px solid #243750;
                border-radius: 18px;
                background: linear-gradient(145deg, #0d1928, #091522);
              }

              .editor-produto-desktop > .primario {
                margin-top: 18px !important;
                min-height: 54px !important;
              }
            }

            @media (max-width: 899px) {
              .modal-fundo:has(.editor-produto-desktop) {
                align-items: flex-end !important;
                padding: 0 !important;
                background: rgba(3, 9, 18, .72) !important;
              }

              .form-produto.editor-produto-desktop {
                width: 100% !important;
                max-width: none !important;
                height: 94dvh !important;
                max-height: 94dvh !important;
                margin: 0 !important;
                padding: 18px 16px calc(86px + env(safe-area-inset-bottom)) !important;
                border-radius: 22px 22px 0 0 !important;
                overflow-x: hidden !important;
                overflow-y: auto !important;
              }

              .editor-produto-desktop > span {
                margin-top: 2px !important;
                font-size: .67rem !important;
                letter-spacing: .08em !important;
              }

              .editor-produto-desktop > h2 {
                margin: 4px 42px 14px 0 !important;
                font-size: 1.35rem !important;
                line-height: 1.15 !important;
              }

              .editor-produto-desktop .fechar {
                position: absolute !important;
                top: 14px !important;
                right: 14px !important;
                z-index: 20 !important;
                width: 40px !important;
                height: 40px !important;
                border-radius: 50% !important;
                background: #f5f7fb !important;
                box-shadow: 0 4px 16px rgba(0,0,0,.12) !important;
              }

              .editor-produto-desktop .produto-editor-grid {
                display: grid;
                grid-template-columns: 1fr !important;
                gap: 18px;
              }

              .editor-produto-desktop .produto-editor-principal,
              .editor-produto-desktop .produto-editor-adicionais {
                min-width: 0 !important;
                display: grid;
                gap: 12px;
              }

              .editor-produto-desktop .produto-editor-principal {
                position: static !important;
              }

              .editor-produto-desktop .upload-imagem > div {
                height: 170px !important;
                border-radius: 15px !important;
              }

              .editor-produto-desktop label {
                min-width: 0 !important;
              }

              .editor-produto-desktop input,
              .editor-produto-desktop textarea,
              .editor-produto-desktop select {
                width: 100% !important;
                min-width: 0 !important;
                box-sizing: border-box !important;
                font-size: 16px !important;
              }

              .editor-produto-desktop textarea {
                min-height: 92px !important;
                resize: vertical !important;
              }

              .editor-produto-desktop .campos.dois {
                grid-template-columns: 1fr !important;
                gap: 12px !important;
              }

              .editor-produto-desktop .checks-produto {
                display: grid !important;
                grid-template-columns: 1fr 1fr !important;
                gap: 8px !important;
              }

              .editor-produto-desktop .checks-produto label {
                min-height: 44px !important;
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                padding: 0 10px !important;
                border: 1px solid #dce3ed !important;
                border-radius: 11px !important;
                background: #f7f9fc !important;
              }

              .editor-produto-desktop .produto-editor-adicionais {
                padding: 14px !important;
                border: 1px solid #243750 !important;
                border-radius: 16px !important;
                background: #0b1726 !important;
              }

              .editor-produto-desktop .produto-editor-adicionais > div:first-child strong {
                font-size: 1rem !important;
              }

              .editor-produto-desktop .produto-editor-adicionais > div:first-child small {
                display: block !important;
                margin-top: 4px !important;
                line-height: 1.35 !important;
              }

              .editor-produto-desktop .produto-editor-adicionais button[style*="justify-content: space-between"] {
                min-height: 56px !important;
                padding: 10px 11px !important;
              }

              .editor-produto-desktop .produto-editor-adicionais div[style*="grid-template-columns: 1fr auto auto"] {
                grid-template-columns: minmax(0,1fr) auto auto !important;
                gap: 8px !important;
              }

              .editor-produto-desktop .produto-editor-adicionais div[style*="grid-template-columns: minmax(0,1fr) 120px auto"] {
                grid-template-columns: 1fr !important;
              }

              .editor-produto-desktop .produto-editor-adicionais div[style*="grid-template-columns: minmax(160px,1fr) auto 90px auto"] {
                grid-template-columns: 1fr !important;
              }

              .editor-produto-desktop .produto-editor-adicionais .botao-novo {
                width: 100% !important;
                justify-content: center !important;
              }

              .editor-produto-desktop > .primario {
                position: fixed !important;
                z-index: 1001 !important;
                right: 12px !important;
                bottom: calc(12px + env(safe-area-inset-bottom)) !important;
                left: 12px !important;
                width: auto !important;
                min-height: 56px !important;
                margin: 0 !important;
                border-radius: 14px !important;
                box-shadow: 0 14px 35px rgba(11,92,255,.38) !important;
              }
            }

            @media (max-width: 430px) {
              .form-produto.editor-produto-desktop {
                height: 96dvh !important;
                max-height: 96dvh !important;
                padding-right: 13px !important;
                padding-left: 13px !important;
              }

              .editor-produto-desktop .upload-imagem > div {
                height: 150px !important;
              }

              .editor-produto-desktop .checks-produto {
                grid-template-columns: 1fr !important;
              }

              .editor-produto-desktop .produto-editor-adicionais {
                padding: 12px !important;
              }
            }
          `}</style>

          <form className="form-produto editor-produto-desktop" onSubmit={salvarProduto}>
            <button type="button" className="fechar" onClick={() => setModalProduto(false)}><X /></button>

            <span>{produtoForm.id ? 'Editar produto' : 'Novo produto'}</span>
            <h2>{produtoForm.id ? produtoForm.nome : 'Cadastrar produto'}</h2>

            <div className="produto-editor-grid">
              <section className="produto-editor-principal">
                <label className="upload-imagem">
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={escolherImagem} />
                  <div className={previewImagem ? 'com-imagem' : ''}>
                    {previewImagem
                      ? <img src={previewImagem} alt="Prévia do produto" />
                      : <><ShoppingBag /><strong>Adicionar foto</strong><small>JPG, PNG ou WEBP · até 5 MB</small></>}
                  </div>
                </label>

                <label>Nome
                  <input value={produtoForm.nome} onChange={(e) => setProdutoForm({ ...produtoForm, nome: e.target.value })} />
                </label>

                <label>Descrição
                  <textarea value={produtoForm.descricao || ''} onChange={(e) => setProdutoForm({ ...produtoForm, descricao: e.target.value })} />
                </label>

                <div className="campos dois">
                  <label>Categoria
                    <select value={produtoForm.categoria_id} onChange={(e) => setProdutoForm({ ...produtoForm, categoria_id: e.target.value })}>
                      {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </label>

                  <label>Preço
                    <input value={produtoForm.preco} onChange={(e) => setProdutoForm({ ...produtoForm, preco: e.target.value })} placeholder="0,00" inputMode="decimal" />
                  </label>
                </div>

                <div className="checks-produto">
                  <label><input type="checkbox" checked={produtoForm.disponivel} onChange={(e) => setProdutoForm({ ...produtoForm, disponivel: e.target.checked })} /> Disponível</label>
                  <label><input type="checkbox" checked={produtoForm.destaque} onChange={(e) => setProdutoForm({ ...produtoForm, destaque: e.target.checked })} /> Destacar produto</label>
                </div>
              </section>

              <section className="produto-editor-adicionais">
                <div>
                  <strong style={{ display: 'block', color: '#f4f7fb', fontSize: 17 }}>Adicionais deste produto</strong>
                  <small style={{ color: '#8295af' }}>
                    {produtoForm.id
                      ? 'Escolha os grupos usados neste produto e cadastre as opções aqui mesmo.'
                      : 'Salve o produto primeiro. Depois abra Editar para cadastrar os adicionais.'}
                  </small>
                </div>

                {produtoForm.id && (
                  <>
                    {gruposAdicionaisPainel.map((grupo) => {
                      const marcado = vinculosAdicionais.some((v) => v.produto_id === produtoForm.id && v.grupo_id === grupo.id)
                      const opcoes = adicionaisPainel.filter((a) => a.grupo_id === grupo.id)

                      return (
                        <div
                          key={grupo.id}
                          style={{
                            border: marcado ? '1px solid #316fdd' : '1px solid #263a54',
                            borderRadius: 13,
                            overflow: 'hidden',
                            background: marcado ? '#102442' : '#0a1421'
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => alternarGrupoProduto(produtoForm.id, grupo.id)}
                            style={{
                              width: '100%',
                              minHeight: 52,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 10,
                              padding: '0 13px',
                              border: 0,
                              background: 'transparent',
                              color: '#edf4ff',
                              cursor: 'pointer'
                            }}
                          >
                            <span style={{ textAlign: 'left' }}>
                              <strong style={{ display: 'block' }}>{grupo.nome}</strong>
                              <small style={{ color: '#8095b2' }}>
                                {opcoes.length} opções · {grupo.obrigatorio ? 'obrigatório' : 'opcional'} · máx. {grupo.maximo || 'livre'}
                              </small>
                            </span>
                            <span style={{ color: marcado ? '#76a7ff' : '#7f91a9', fontWeight: 800 }}>
                              {marcado ? '✓ Usar' : '+ Usar'}
                            </span>
                          </button>

                          {marcado && (
                            <div style={{ padding: '0 12px 12px', display: 'grid', gap: 8 }}>
                              {opcoes.map((a) => (
                                <div
                                  key={a.id}
                                  style={{
                                    minHeight: 42,
                                    display: 'grid',
                                    gridTemplateColumns: '1fr auto auto',
                                    alignItems: 'center',
                                    gap: 10,
                                    padding: '7px 10px',
                                    borderRadius: 10,
                                    background: '#101e30'
                                  }}
                                >
                                  <span style={{ color: '#dfe8f5', fontWeight: 700 }}>{a.nome}</span>
                                  <span style={{ color: '#8eb4ff', fontWeight: 800 }}>
                                    {Number(a.preco || 0) === 0 ? 'Grátis' : `+ ${dinheiro(a.preco)}`}
                                  </span>
                                  <button
                                    type="button"
                                    className={`interruptor ${a.disponivel ? 'ligado' : ''}`}
                                    onClick={() => alternarAdicionalDisponivel(a)}
                                    title={a.disponivel ? 'Pausar adicional' : 'Ativar adicional'}
                                  >
                                    <i />
                                  </button>
                                </div>
                              ))}

                              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 120px auto', gap: 8 }}>
                                <input
                                  value={adicionalForm.grupo_id === grupo.id ? adicionalForm.nome : ''}
                                  onChange={(e) => setAdicionalForm({
                                    grupo_id: grupo.id,
                                    nome: e.target.value,
                                    preco: adicionalForm.grupo_id === grupo.id ? adicionalForm.preco : ''
                                  })}
                                  placeholder="Ex.: Bacon extra"
                                />
                                <input
                                  value={adicionalForm.grupo_id === grupo.id ? adicionalForm.preco : ''}
                                  onChange={(e) => setAdicionalForm({
                                    grupo_id: grupo.id,
                                    nome: adicionalForm.grupo_id === grupo.id ? adicionalForm.nome : '',
                                    preco: e.target.value
                                  })}
                                  placeholder="R$ 0,00"
                                  inputMode="decimal"
                                />
                                <button type="button" className="botao-novo" onClick={(e) => criarAdicional(e, grupo.id)}>
                                  <Plus size={15} /> Adicionar
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}

                    <div style={{ borderTop: '1px solid #243750', paddingTop: 14 }}>
                      <strong style={{ display: 'block', marginBottom: 8, color: '#dfe8f5' }}>
                        Criar novo grupo
                      </strong>

                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px,1fr) auto 90px auto', gap: 8, alignItems: 'center' }}>
                        <input
                          value={grupoForm.nome}
                          onChange={(e) => setGrupoForm({ ...grupoForm, nome: e.target.value })}
                          placeholder="Ex.: Adicionais"
                        />
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#c9d5e5', whiteSpace: 'nowrap' }}>
                          <input
                            type="checkbox"
                            checked={grupoForm.obrigatorio}
                            onChange={(e) => setGrupoForm({ ...grupoForm, obrigatorio: e.target.checked })}
                          />
                          Obrigatório
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={grupoForm.maximo}
                          onChange={(e) => setGrupoForm({ ...grupoForm, maximo: e.target.value })}
                          title="Máximo de escolhas"
                        />
                        <button type="button" className="botao-novo" onClick={criarGrupoNoProduto}>
                          <Plus size={15} /> Criar
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </section>
            </div>

            <button className="primario" disabled={salvando}>
              {salvando ? 'Salvando...' : 'Salvar produto'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

function PainelEntregas({ sessao }) {
  const [loja, setLoja] = useState(null)
  const [form, setForm] = useState(null)
  const [distanciaTeste, setDistanciaTeste] = useState(0)
  const [valorTeste, setValorTeste] = useState(50)
  const [cepTeste, setCepTeste] = useState('')
  const [numeroTeste, setNumeroTeste] = useState('')
  const [enderecoEncontrado, setEnderecoEncontrado] = useState('')
  const [rotaTeste, setRotaTeste] = useState(null)
  const [calculandoRota, setCalculandoRota] = useState(false)
  const [abaEntrega, setAbaEntrega] = useState('geral')
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')

  useEffect(() => {
    async function carregar() {
      let contexto
      try {
        contexto = await obterUnidadeAtualCompleta()
      } catch (e) {
        setErro(e.message || 'Não foi possível carregar a unidade.')
        setCarregando(false)
        return
      }
      if (!contexto?.estabelecimento) {
        setErro('Usuário sem estabelecimento vinculado.')
        setCarregando(false)
        return
      }
      const e = contexto.estabelecimento
      setLoja(e)
      setForm({
        faz_entrega: e.faz_entrega ?? true,
        permite_retirada: e.permite_retirada ?? true,
        modo_taxa_entrega: e.modo_taxa_entrega || 'fixa',
        endereco_saida: e.endereco_saida || '',
        cep_saida: e.cep || '',
        numero_saida: (e.endereco_saida || '').match(/,\s*(\d+[A-Za-z-]*)/)?.[1] || '',
        taxa_minima_entrega: String(e.taxa_minima_entrega ?? e.taxa_entrega_base ?? 5).replace('.', ','),
        taxa_por_km: String(e.taxa_por_km ?? 2).replace('.', ','),
        raio_maximo_km: String(e.raio_maximo_km ?? 10).replace('.', ','),
        pedido_minimo_entrega: String(e.pedido_minimo_entrega ?? 0).replace('.', ','),
        entrega_gratis_acima: e.entrega_gratis_acima == null ? '' : String(e.entrega_gratis_acima).replace('.', ','),
        tempo_base_entrega_min: e.tempo_base_entrega_min ?? e.tempo_medio_min ?? 40,
      })
      setCarregando(false)
    }
    carregar()
  }, [sessao.user.id])

  function alterar(campo, valor) {
    setForm((atual) => ({ ...atual, [campo]: valor }))
    setMensagem('')
    if (['endereco_saida', 'cep_saida', 'numero_saida'].includes(campo)) {
      setRotaTeste(null)
      setDistanciaTeste(0)
    }
  }

  const numero = (valor) => Number(String(valor || 0).replace(',', '.')) || 0
  const entregaGratis = numero(form?.entrega_gratis_acima) > 0 && valorTeste >= numero(form?.entrega_gratis_acima)
  const taxaSimulada = entregaGratis
    ? 0
    : form?.modo_taxa_entrega === 'por_km'
      ? Math.max(numero(form?.taxa_minima_entrega), numero(form?.taxa_por_km) * distanciaTeste)
      : numero(form?.taxa_minima_entrega)
  const foraDoRaio = distanciaTeste > 0 && distanciaTeste > numero(form?.raio_maximo_km)
  const abaixoMinimo = valorTeste < numero(form?.pedido_minimo_entrega)

  async function testarEnderecoEntrega() {
    setErro('')
    setMensagem('')
    setRotaTeste(null)
    setDistanciaTeste(0)

    if (!form.endereco_saida.trim()) {
      setErro('Informe primeiro o endereço de saída da loja na aba Área.')
      return
    }
    const cepLimpo = cepTeste.replace(/\D/g, '')
    if (cepLimpo.length !== 8) {
      setErro('Digite um CEP válido do cliente.')
      return
    }
    if (!numeroTeste.trim()) {
      setErro('Digite o número do endereço do cliente.')
      return
    }

    setCalculandoRota(true)
    try {
      const cepOrigemLimpo = String(form.cep_saida || '').replace(/\D/g, '')
      if (cepOrigemLimpo.length !== 8) throw new Error('Na aba Área, informe o CEP de saída da loja.')
      if (!String(form.numero_saida || '').trim()) throw new Error('Na aba Área, informe o número da loja.')

      const [enderecoOrigemCep, enderecoDestinoCep] = await Promise.all([
        buscarEnderecoPorCep(cepOrigemLimpo),
        buscarEnderecoPorCep(cepLimpo),
      ])

      const origemCompleta = `${enderecoOrigemCep.logradouro}, ${form.numero_saida}, ${enderecoOrigemCep.bairro}, ${enderecoOrigemCep.localidade} - ${enderecoOrigemCep.uf}, ${enderecoOrigemCep.cep}, Brasil`
      const destinoCompleto = `${enderecoDestinoCep.logradouro}, ${numeroTeste}, ${enderecoDestinoCep.bairro}, ${enderecoDestinoCep.localidade} - ${enderecoDestinoCep.uf}, ${enderecoDestinoCep.cep}, Brasil`

      setEnderecoEncontrado(destinoCompleto)
      const rota = await calcularRotaGeoapify(origemCompleta, destinoCompleto, enderecoOrigemCep.cep, enderecoDestinoCep.cep)
      const distancia = Math.round(rota.distanciaKm * 100) / 100
      setDistanciaTeste(distancia)
      setRotaTeste({ ...rota, distanciaKm: distancia })
    } catch (e) {
      setErro(e.message || 'Não foi possível calcular a distância.')
    } finally {
      setCalculandoRota(false)
    }
  }

  async function salvar(evento) {
    evento.preventDefault()
    setErro('')
    setMensagem('')
    if (form.faz_entrega) {
      const cepOrigemLimpo = String(form.cep_saida || '').replace(/\D/g, '')
      if (cepOrigemLimpo.length !== 8) { setErro('Informe um CEP de saída válido na aba Área.'); return }
      if (!String(form.numero_saida || '').trim()) { setErro('Informe o número da loja na aba Área.'); return }
    }
    let enderecoSaidaResolvido = form.endereco_saida.trim() || null
    let cepSaidaResolvido = String(form.cep_saida || '').replace(/\D/g, '') || null
    if (form.faz_entrega) {
      try {
        const enderecoCep = await buscarEnderecoPorCep(cepSaidaResolvido)
        enderecoSaidaResolvido = `${enderecoCep.logradouro}, ${form.numero_saida}, ${enderecoCep.bairro}, ${enderecoCep.localidade} - ${enderecoCep.uf}, ${enderecoCep.cep}, Brasil`
      } catch (e) {
        setErro(e.message || 'Não foi possível validar o CEP de saída.')
        return
      }
    }

    const dados = {
      faz_entrega: form.faz_entrega,
      permite_retirada: form.permite_retirada,
      modo_taxa_entrega: form.modo_taxa_entrega,
      endereco_saida: enderecoSaidaResolvido,
      cep: cepSaidaResolvido,
      taxa_minima_entrega: numero(form.taxa_minima_entrega),
      taxa_por_km: numero(form.taxa_por_km),
      raio_maximo_km: numero(form.raio_maximo_km),
      pedido_minimo_entrega: numero(form.pedido_minimo_entrega),
      entrega_gratis_acima: form.entrega_gratis_acima === '' ? null : numero(form.entrega_gratis_acima),
      tempo_base_entrega_min: Number(form.tempo_base_entrega_min) || 40,
      taxa_entrega_base: numero(form.taxa_minima_entrega),
      tempo_medio_min: Number(form.tempo_base_entrega_min) || 40,
    }
    setSalvando(true)
    const { data, error } = await supabase.from('estabelecimentos').update(dados).eq('id', loja.id).select().single()
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setLoja(data)
    setMensagem('Configurações de entrega salvas com sucesso!')
  }

  function abrirMapa() {
    const busca = form.endereco_saida?.trim() || `${form.cep_saida || ''} ${form.numero_saida || ''}`.trim()
    if (!busca) { setErro('Informe o CEP e o número de saída primeiro.'); return }
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(busca)}`, '_blank')
  }

  if (carregando) return <TelaCentral texto="Carregando entregas..." />
  if (!form) return <TelaCentral texto={erro || 'Não foi possível abrir as entregas.'} erro />

  return (
    <div className="painel-food">
      <NavegacaoPainel loja={loja} ativo="entregas" />
      <main className="conteudo-painel entregas-painel">
        <div className="cabecalho-entregas"><div className="cabecalho-entregas__icone"><Bike /></div><div><span>LOGÍSTICA</span><h2>Configuração de entregas</h2><p>Defina onde entregar e como calcular cada taxa.</p></div><div className={`status-config ${form.faz_entrega ? 'online' : ''}`}><i />{form.faz_entrega ? 'Entregas ativas' : 'Entregas pausadas'}</div></div>
        <form className="form-entregas" onSubmit={salvar}>
          <section className="entrega-coluna">
            <nav className="abas-config-entrega">
              <button type="button" className={abaEntrega === 'geral' ? 'ativo' : ''} onClick={() => setAbaEntrega('geral')}>Geral</button>
              <button type="button" className={abaEntrega === 'area' ? 'ativo' : ''} onClick={() => setAbaEntrega('area')}>Área</button>
              <button type="button" className={abaEntrega === 'taxas' ? 'ativo' : ''} onClick={() => setAbaEntrega('taxas')}>Taxas</button>
            </nav>

            {abaEntrega === 'geral' && <article className="cartao-entrega-config">
              <div className="titulo-bloco-config"><span>MODALIDADES</span><h3>Como o cliente recebe</h3><p>Ative somente as opções oferecidas pela loja.</p></div>
              <label className="opcao-entrega-switch"><span><Bike /><span><strong>Fazer entrega</strong><small>Levar o pedido até o endereço do cliente.</small></span></span><input type="checkbox" checked={form.faz_entrega} onChange={(e) => alterar('faz_entrega', e.target.checked)} /></label>
              <label className="opcao-entrega-switch"><span><Store /><span><strong>Retirada no local</strong><small>Cliente busca o pedido no estabelecimento.</small></span></span><input type="checkbox" checked={form.permite_retirada} onChange={(e) => alterar('permite_retirada', e.target.checked)} /></label>
            </article>}

            {form.faz_entrega && <>
              {abaEntrega === 'area' && <article className="cartao-entrega-config">
                <div className="titulo-bloco-config"><span>ORIGEM E COBERTURA</span><h3>Área atendida</h3><p>Use CEP + número da loja. Assim o ponto de saída fica exato e evita rotas para outra cidade.</p></div>
                <div className="campos-entrega-dois"><label>CEP de saída<input value={form.cep_saida} onChange={(e) => alterar('cep_saida', e.target.value)} placeholder="00000-000" inputMode="numeric" maxLength={9} /></label><label>Número da loja<input value={form.numero_saida} onChange={(e) => alterar('numero_saida', e.target.value)} placeholder="Ex.: 841" inputMode="numeric" /></label></div>
                {form.endereco_saida && <small className="taxa-aviso">Último endereço salvo: {form.endereco_saida}</small>}
                <div className="campos-entrega-dois"><label>Raio máximo (km)<input value={form.raio_maximo_km} onChange={(e) => alterar('raio_maximo_km', e.target.value)} inputMode="decimal" /></label><label>Tempo estimado (min)<input type="number" min="1" value={form.tempo_base_entrega_min} onChange={(e) => alterar('tempo_base_entrega_min', e.target.value)} /></label></div>
              </article>}

              {abaEntrega === 'taxas' && <article className="cartao-entrega-config">
                <div className="titulo-bloco-config"><span>PREÇOS</span><h3>Regra da taxa</h3><p>Escolha cobrança fixa ou proporcional à distância real da rota.</p></div>
                <div className="seletor-modo-taxa"><button type="button" className={form.modo_taxa_entrega === 'fixa' ? 'ativo' : ''} onClick={() => alterar('modo_taxa_entrega', 'fixa')}>Taxa fixa</button><button type="button" className={form.modo_taxa_entrega === 'por_km' ? 'ativo' : ''} onClick={() => alterar('modo_taxa_entrega', 'por_km')}>Por quilômetro</button></div>
                <div className="campos-entrega-dois"><label>{form.modo_taxa_entrega === 'fixa' ? 'Taxa da entrega (R$)' : 'Taxa mínima (R$)'}<input value={form.taxa_minima_entrega} onChange={(e) => alterar('taxa_minima_entrega', e.target.value)} inputMode="decimal" /></label>{form.modo_taxa_entrega === 'por_km' && <label>Valor por km (R$)<input value={form.taxa_por_km} onChange={(e) => alterar('taxa_por_km', e.target.value)} inputMode="decimal" /></label>}</div>
                <div className="campos-entrega-dois"><label>Pedido mínimo (R$)<input value={form.pedido_minimo_entrega} onChange={(e) => alterar('pedido_minimo_entrega', e.target.value)} inputMode="decimal" /></label><label>Grátis acima de (R$)<input value={form.entrega_gratis_acima} onChange={(e) => alterar('entrega_gratis_acima', e.target.value)} inputMode="decimal" placeholder="Opcional" /></label></div>
              </article>}
            </>}
          </section>

          <aside className="simulador-entrega">
            <div className="simulador-entrega__topo"><span>RESUMO</span><h3>Sua entrega</h3><p>Visão rápida da configuração atual.</p></div>
            <div className="resumo-entrega-compacto">
              <div><span>Modalidade</span><strong>{form.faz_entrega ? 'Entrega ativa' : 'Pausada'}</strong></div>
              <div><span>Cobrança</span><strong>{form.modo_taxa_entrega === 'por_km' ? 'Por km' : 'Taxa fixa'}</strong></div>
              <div><span>Alcance</span><strong>{form.raio_maximo_km} km</strong></div>
              <div><span>Previsão</span><strong>{form.tempo_base_entrega_min} min</strong></div>
            </div>
            {abaEntrega === 'taxas' && <div className="teste-taxa-compacto">
              <div className="simulador-entrega__topo"><span>TESTE REAL</span><p>Digite CEP + número do cliente. A origem também usa CEP + número da loja.</p></div>
              <div className="campos-entrega-dois">
                <label>CEP do cliente<input value={cepTeste} onChange={(e) => { setCepTeste(e.target.value); setEnderecoEncontrado(''); setRotaTeste(null); setDistanciaTeste(0) }} placeholder="00000-000" inputMode="numeric" maxLength={9} /></label>
                <label>Número<input value={numeroTeste} onChange={(e) => { setNumeroTeste(e.target.value); setEnderecoEncontrado(''); setRotaTeste(null); setDistanciaTeste(0) }} placeholder="Ex.: 55" inputMode="numeric" /></label>
              </div>
              <button type="button" className="primario" onClick={testarEnderecoEntrega} disabled={calculandoRota}>{calculandoRota ? 'Consultando CEP e rota...' : 'Calcular distância'}</button>
              {enderecoEncontrado && <small className="taxa-aviso">Endereço encontrado: {enderecoEncontrado}</small>}
              {rotaTeste && <div className="resumo-entrega-compacto">
                <div><span>Distância pela rota</span><strong>{rotaTeste.distanciaKm.toFixed(2).replace('.', ',')} km</strong></div>
                {rotaTeste.duracaoMin && <div><span>Tempo de trajeto</span><strong>{Math.round(rotaTeste.duracaoMin)} min</strong></div>}
              </div>}
              <label>Pedido: <strong>{dinheiro(valorTeste)}</strong><input type="range" min="10" max="200" step="5" value={valorTeste} onChange={(e) => setValorTeste(Number(e.target.value))} /></label>
              <div className="resultado-simulador"><span>Taxa calculada</span><strong>{!rotaTeste ? 'Calcule a rota' : foraDoRaio || abaixoMinimo ? 'Indisponível' : dinheiro(taxaSimulada)}</strong>{!rotaTeste ? <small>Informe um endereço de cliente para testar.</small> : foraDoRaio ? <small>Fora do raio permitido.</small> : abaixoMinimo ? <small>Pedido abaixo do mínimo.</small> : entregaGratis ? <small>Entrega grátis.</small> : <small>Valor calculado com a distância real da rota.</small>}</div>
            </div>}
          </aside>

          {erro && <p className="erro-pedido mensagem-entrega">{erro}</p>}
          {mensagem && <p className="sucesso-config mensagem-entrega">{mensagem}</p>}
          <div className="acoes-entrega"><button type="button" onClick={abrirMapa}>Conferir endereço</button><button className="primario" disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar entregas'}</button></div>
        </form>
      </main>
    </div>
  )
}

function PainelConfiguracoes({ sessao }) {
  const [loja, setLoja] = useState(null)
  const [form, setForm] = useState(null)
  const [arquivoLogo, setArquivoLogo] = useState(null)
  const [arquivoCapa, setArquivoCapa] = useState(null)
  const [arquivoGif, setArquivoGif] = useState(null)
  const [previewLogo, setPreviewLogo] = useState('')
  const [previewCapa, setPreviewCapa] = useState('')
  const [previewGif, setPreviewGif] = useState('')
  const [tipoVisual, setTipoVisual] = useState('capa')
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [alterandoStatusLoja, setAlterandoStatusLoja] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [erro, setErro] = useState('')
  const [modelosAbertos, setModelosAbertos] = useState(false)
  const [abaConfig, setAbaConfig] = useState('informacoes')
  const [horarios, setHorarios] = useState([
    { dia_semana: 0, nome: 'Domingo', abre: '11:00', fecha: '22:00', fechado: true },
    { dia_semana: 1, nome: 'Segunda-feira', abre: '11:00', fecha: '22:00', fechado: false },
    { dia_semana: 2, nome: 'Terça-feira', abre: '11:00', fecha: '22:00', fechado: false },
    { dia_semana: 3, nome: 'Quarta-feira', abre: '11:00', fecha: '22:00', fechado: false },
    { dia_semana: 4, nome: 'Quinta-feira', abre: '11:00', fecha: '22:00', fechado: false },
    { dia_semana: 5, nome: 'Sexta-feira', abre: '11:00', fecha: '23:00', fechado: false },
    { dia_semana: 6, nome: 'Sábado', abre: '11:00', fecha: '23:00', fechado: false },
  ])
  const [salvandoHorarios, setSalvandoHorarios] = useState(false)
  const [mensagemHorarios, setMensagemHorarios] = useState('')
  const [erroHorarios, setErroHorarios] = useState('')

  useEffect(() => {
    async function carregarLoja() {
      let contexto
      try {
        contexto = await obterUnidadeAtualCompleta()
      } catch (e) {
        setErro(e.message || 'Não foi possível carregar a unidade.')
        setCarregando(false)
        return
      }

      if (!contexto?.estabelecimento) {
        setErro('Usuário sem estabelecimento vinculado.')
        setCarregando(false)
        return
      }

      const estabelecimento = contexto.estabelecimento
      setLoja(estabelecimento)
      setForm({
        nome: estabelecimento.nome || '',
        nome_unidade: estabelecimento.nome_unidade || (estabelecimento.tipo_unidade === 'matriz' ? 'Matriz' : ''),
        endereco: estabelecimento.endereco || '',
        cidade: estabelecimento.cidade || '',
        estado: estabelecimento.estado || '',
        cep: estabelecimento.cep || '',
        whatsapp: estabelecimento.whatsapp || estabelecimento.telefone || '',
        descricao: estabelecimento.descricao || '',
        cor_principal: estabelecimento.cor_principal || '#0b5cff',
        modelo_visual: estabelecimento.modelo_visual || 'kodvexa',
        tempo_medio_min: estabelecimento.tempo_medio_min ?? 40,
        taxa_entrega_base: String(estabelecimento.taxa_entrega_base ?? 0).replace('.', ','),
        aberto: estabelecimento.aberto ?? true,
      })
      setPreviewLogo(estabelecimento.logo_url || '')
      setPreviewCapa(estabelecimento.capa_url || '')
      setPreviewGif(estabelecimento.fundo_gif_url || '')
      setTipoVisual(estabelecimento.fundo_gif_url && !estabelecimento.capa_url ? 'gif' : 'capa')

      const { data: horariosSalvos, error: erroHorariosBanco } = await supabase
        .from('horarios_funcionamento')
        .select('dia_semana, abre, fecha, fechado')
        .eq('estabelecimento_id', estabelecimento.id)
        .order('dia_semana')

      if (!erroHorariosBanco && horariosSalvos?.length) {
        const nomesDias = {
          0: 'Domingo',
          1: 'Segunda-feira',
          2: 'Terça-feira',
          3: 'Quarta-feira',
          4: 'Quinta-feira',
          5: 'Sexta-feira',
          6: 'Sábado',
        }

        const base = [0, 1, 2, 3, 4, 5, 6].map((dia) => {
          const salvo = horariosSalvos.find((item) => Number(item.dia_semana) === dia)
          return {
            dia_semana: dia,
            nome: nomesDias[dia],
            abre: String(salvo?.abre || '11:00').slice(0, 5),
            fecha: String(salvo?.fecha || '22:00').slice(0, 5),
            fechado: salvo ? Boolean(salvo.fechado) : dia === 0,
          }
        })
        setHorarios(base)
      }

      setCarregando(false)
    }
    carregarLoja()
  }, [sessao.user.id])

  function alterar(campo, valor) {
    setForm((atual) => ({ ...atual, [campo]: valor }))
    setMensagem('')
  }

  function alterarHorario(diaSemana, campo, valor) {
    setHorarios((atual) =>
      atual.map((dia) =>
        dia.dia_semana === diaSemana ? { ...dia, [campo]: valor } : dia
      )
    )
    setMensagemHorarios('')
    setErroHorarios('')
  }

  async function salvarHorarios() {
    if (!loja?.id) return

    const invalido = horarios.some((dia) =>
      !dia.fechado && (!dia.abre || !dia.fecha)
    )

    if (invalido) {
      setErroHorarios('Preencha o horário de abertura e fechamento dos dias abertos.')
      return
    }

    setSalvandoHorarios(true)
    setMensagemHorarios('')
    setErroHorarios('')

    const { error: erroExcluir } = await supabase
      .from('horarios_funcionamento')
      .delete()
      .eq('estabelecimento_id', loja.id)

    if (erroExcluir) {
      setErroHorarios(erroExcluir.message || 'Não foi possível atualizar os horários.')
      setSalvandoHorarios(false)
      return
    }

    const linhas = horarios.map((dia) => ({
      estabelecimento_id: loja.id,
      dia_semana: dia.dia_semana,
      abre: dia.fechado ? null : dia.abre,
      fecha: dia.fechado ? null : dia.fecha,
      fechado: dia.fechado,
    }))

    const { error: erroInserir } = await supabase
      .from('horarios_funcionamento')
      .insert(linhas)

    if (erroInserir) {
      setErroHorarios(erroInserir.message || 'Não foi possível salvar os horários.')
    } else {
      setMensagemHorarios(`Horários de ${form.nome_unidade || 'esta unidade'} salvos com sucesso.`)
    }

    setSalvandoHorarios(false)
  }

  function escolherLogo(evento) {
    const arquivo = evento.target.files?.[0]
    if (!arquivo) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(arquivo.type)) {
      setErro('Use uma logo JPG, PNG ou WEBP.')
      return
    }
    if (arquivo.size > 5 * 1024 * 1024) {
      setErro('A logo deve ter no máximo 5 MB.')
      return
    }
    setErro('')
    setArquivoLogo(arquivo)
    setPreviewLogo(URL.createObjectURL(arquivo))
  }

  function escolherVisual(evento, tipo) {
    const arquivo = evento.target.files?.[0]
    if (!arquivo) return
    const ehGif = tipo === 'gif'
    const tiposPermitidos = ehGif ? ['image/gif'] : ['image/jpeg', 'image/png', 'image/webp']
    if (!tiposPermitidos.includes(arquivo.type)) {
      setErro(ehGif ? 'Escolha um arquivo GIF.' : 'Use uma capa JPG, PNG ou WEBP.')
      return
    }
    const limite = ehGif ? 10 * 1024 * 1024 : 5 * 1024 * 1024
    if (arquivo.size > limite) {
      setErro(ehGif ? 'O GIF deve ter no máximo 10 MB.' : 'A capa deve ter no máximo 5 MB.')
      return
    }
    setErro('')
    const preview = URL.createObjectURL(arquivo)

    if (ehGif) {
      setTipoVisual('gif')
      setArquivoGif(arquivo)
      setPreviewGif(preview)
      setArquivoCapa(null)
      setPreviewCapa('')
    } else {
      setTipoVisual('capa')
      setArquivoCapa(arquivo)
      setPreviewCapa(preview)
      setArquivoGif(null)
      setPreviewGif('')
    }
  }

  function removerVisualTopo() {
    setArquivoCapa(null)
    setArquivoGif(null)
    setPreviewCapa('')
    setPreviewGif('')
    setMensagem('')
    setErro('')
  }

  async function alternarRecebimentoPedidos() {
    if (!loja?.id || alterandoStatusLoja) return

    const novoStatus = !form.aberto

    setAlterandoStatusLoja(true)
    setErro('')
    setMensagem('')

    const { data, error } = await supabase
      .from('estabelecimentos')
      .update({ aberto: novoStatus })
      .eq('id', loja.id)
      .select()
      .single()

    setAlterandoStatusLoja(false)

    if (error) {
      setErro(error.message || 'Não foi possível alterar o status da unidade.')
      return
    }

    setLoja(data)
    setForm((atual) => ({ ...atual, aberto: Boolean(data.aberto) }))
    setMensagem(
      data.aberto
        ? `Pedidos reativados em ${form.nome_unidade || 'esta unidade'}.`
        : `Pedidos pausados em ${form.nome_unidade || 'esta unidade'}.`
    )
  }

  async function salvar(evento) {
    evento.preventDefault()
    setErro('')
    setMensagem('')

    const taxa = Number(String(form.taxa_entrega_base).replace(',', '.'))
    const tempo = Number(form.tempo_medio_min)
    if (!form.nome.trim() || !form.nome_unidade.trim() || !Number.isFinite(taxa) || taxa < 0 || !Number.isFinite(tempo) || tempo < 1) {
      setErro('Preencha nome da loja, nome da unidade, tempo e taxa de entrega corretamente.')
      return
    }

    setSalvando(true)
    let logoUrl = loja.logo_url || null
    let capaUrl = tipoVisual === 'capa' ? (previewCapa ? loja.capa_url || null : null) : null
    let fundoGifUrl = tipoVisual === 'gif' ? (previewGif ? loja.fundo_gif_url || null : null) : null

    if (arquivoLogo) {
      const extensao = arquivoLogo.name.split('.').pop().toLowerCase()
      const caminho = `${loja.id}/logo-${crypto.randomUUID()}.${extensao}`
      const { error: erroUpload } = await supabase.storage
        .from('produtos')
        .upload(caminho, arquivoLogo, { cacheControl: '3600', upsert: false })
      if (erroUpload) {
        setErro(`Erro ao enviar logo: ${erroUpload.message}`)
        setSalvando(false)
        return
      }
      logoUrl = supabase.storage.from('produtos').getPublicUrl(caminho).data.publicUrl
    }

    async function enviarVisual(arquivo, prefixo) {
      if (!arquivo) return null
      const extensao = arquivo.name.split('.').pop().toLowerCase()
      const caminho = `${loja.id}/${prefixo}-${crypto.randomUUID()}.${extensao}`
      const { error: erroUpload } = await supabase.storage
        .from('produtos')
        .upload(caminho, arquivo, { cacheControl: '3600', upsert: false })
      if (erroUpload) throw erroUpload
      return supabase.storage.from('produtos').getPublicUrl(caminho).data.publicUrl
    }

    try {
      if (tipoVisual === 'capa' && arquivoCapa) {
        capaUrl = await enviarVisual(arquivoCapa, 'capa')
        fundoGifUrl = null
      }

      if (tipoVisual === 'gif' && arquivoGif) {
        fundoGifUrl = await enviarVisual(arquivoGif, 'fundo')
        capaUrl = null
      }

      if (!previewCapa && !previewGif) {
        capaUrl = null
        fundoGifUrl = null
      }
    } catch (erroUpload) {
      setErro(`Erro ao enviar imagem: ${erroUpload.message}`)
      setSalvando(false)
      return
    }

    const dados = {
      nome: form.nome.trim(),
      nome_unidade: form.nome_unidade.trim(),
      endereco: form.endereco.trim() || null,
      cidade: form.cidade.trim() || null,
      estado: form.estado.trim().toUpperCase() || null,
      cep: form.cep.trim() || null,
      whatsapp: form.whatsapp.trim() || null,
      descricao: form.descricao.trim() || null,
      tempo_medio_min: tempo,
      taxa_entrega_base: taxa,
      aberto: form.aberto,
      modelo_visual: form.modelo_visual || 'kodvexa',
      logo_url: logoUrl,
      capa_url: capaUrl,
      fundo_gif_url: fundoGifUrl,
    }
    const { data, error } = await supabase
      .from('estabelecimentos')
      .update(dados)
      .eq('id', loja.id)
      .select()
      .single()

    setSalvando(false)
    if (error) {
      setErro(error.message)
      return
    }
    setLoja(data)
    setArquivoLogo(null)
    setArquivoCapa(null)
    setArquivoGif(null)
    setPreviewLogo(data.logo_url || '')
    setPreviewCapa(data.capa_url || '')
    setPreviewGif(data.fundo_gif_url || '')
    setTipoVisual(data.fundo_gif_url && !data.capa_url ? 'gif' : 'capa')
    setMensagem('Configurações salvas com sucesso!')
  }

  if (carregando) return <TelaCentral texto="Carregando configurações..." />
  if (!form) return <TelaCentral texto={erro || 'Não foi possível abrir as configurações.'} erro />

  return (
    <div className="painel-food">
      <NavegacaoPainel loja={loja} ativo="configuracoes" />
      <main className="conteudo-painel configuracoes-painel">
        <div className="cabecalho-config">
          <div className="cabecalho-config__icone"><Store /></div>
          <div><span>CENTRAL DA LOJA</span><h2>Personalização e operação</h2><p>Gerencie a identidade e as informações públicas do seu estabelecimento.</p></div>
          <div className={`status-config ${form.aberto ? 'online' : ''}`}><i />{form.aberto ? 'Loja online' : 'Loja fechada'}</div>
        </div>
        <style>{`
          .config-pro {
            gap: 22px !important;
          }

          .unidade-config-pro {
            grid-column: 1 / -1;
          }

          .unidade-config-pro__selo {
            display: grid;
            grid-template-columns: 38px minmax(0,1fr) auto;
            align-items: center;
            gap: 12px;
            padding: 13px 14px;
            border: 1px solid #2b4564;
            border-radius: 15px;
            background: #0b1828;
            color: #7daeff;
          }

          .unidade-config-pro__selo > div {
            display: grid;
            gap: 2px;
          }

          .unidade-config-pro__selo small {
            color: #7890ad;
            font-size: .62rem;
            font-weight: 900;
            letter-spacing: .08em;
          }

          .unidade-config-pro__selo strong {
            color: #eef6ff;
            font-size: .92rem;
          }

          .unidade-config-pro__selo > span {
            padding: 6px 9px;
            border: 1px solid #315b91;
            border-radius: 999px;
            background: #10233d;
            color: #7eb0ff;
            font-size: .62rem;
            font-weight: 900;
          }

          .unidade-config-pro__grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0,1fr));
            gap: 13px;
          }

          .unidade-config-pro__grid label {
            display: grid;
            gap: 7px;
            color: #8fa5bf;
            font-size: .72rem;
            font-weight: 850;
          }

          .unidade-config-pro__grid input {
            width: 100%;
            min-height: 45px;
            padding: 0 13px;
            border: 1px solid #29405b;
            border-radius: 12px;
            outline: none;
            background: #091522;
            color: #edf5ff;
            font: inherit;
          }

          .unidade-config-pro__grid input:focus {
            border-color: #4382ff;
            box-shadow: 0 0 0 3px rgba(67,130,255,.10);
          }

          .unidade-config-pro__largo {
            grid-column: 1 / -1;
          }

          .unidade-config-pro__aviso {
            display: block;
            color: #7f94ae;
            font-size: .7rem;
            line-height: 1.45;
          }

          @media (max-width: 720px) {
            .unidade-config-pro__grid { grid-template-columns: 1fr; }
            .unidade-config-pro__largo { grid-column: auto; }
            .unidade-config-pro__selo { grid-template-columns: 34px minmax(0,1fr); }
            .unidade-config-pro__selo > span { grid-column: 1 / -1; width: max-content; }
          }

          .config-pro__titulo {
            margin-bottom: 0 !important;
          }

          .config-pro__logo-linha {
            display: grid;
            grid-template-columns: 66px minmax(0,1fr) auto;
            align-items: center;
            gap: 14px;
            padding: 14px;
            border: 1px solid #233750;
            border-radius: 16px;
            background: #0b1726;
          }

          .config-pro__logo-preview {
            width: 66px;
            height: 66px;
            display: grid;
            place-items: center;
            overflow: hidden;
            border: 1px solid #304760;
            border-radius: 17px;
            background: #07111d;
            color: #7e95b3;
          }

          .config-pro__logo-preview img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          .config-pro__logo-texto {
            min-width: 0;
            display: grid;
            gap: 4px;
          }

          .config-pro__logo-texto strong,
          .config-pro__subtitulo strong {
            color: #edf5ff;
            font-size: .9rem;
          }

          .config-pro__logo-texto small,
          .config-pro__subtitulo small {
            color: #7f94ae;
            font-size: .72rem;
            line-height: 1.4;
          }

          .config-pro__acao {
            min-height: 42px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0 14px;
            border: 1px solid #315a92;
            border-radius: 11px;
            background: #10233c;
            color: #80adff;
            font-size: .75rem;
            font-weight: 900;
            cursor: pointer;
          }

          .config-pro__acao input,
          .config-pro__tipo-visual input {
            display: none;
          }

          .config-pro__divisor {
            height: 1px;
            background: #20334b;
          }

          .config-pro__visual-topo {
            display: grid;
            gap: 12px;
          }

          .config-pro__subtitulo {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 12px;
          }

          .config-pro__subtitulo > div {
            display: grid;
            gap: 3px;
          }

          .config-pro__badge {
            flex: 0 0 auto;
            min-height: 27px;
            display: inline-flex;
            align-items: center;
            padding: 0 9px;
            border: 1px solid #2c4665;
            border-radius: 999px;
            background: #0c1b2d;
            color: #83a7d6;
            font-size: .64rem;
            font-weight: 900;
          }

          .config-pro__tipo-visual {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
          }

          .config-pro__tipo-visual label {
            min-height: 66px;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 11px 13px;
            border: 1px solid #263a54;
            border-radius: 14px;
            background: #0a1523;
            color: #7590b2;
            cursor: pointer;
            transition: .18s ease;
          }

          .config-pro__tipo-visual label.ativo {
            border-color: #3f7cff;
            background: linear-gradient(145deg, #102644, #0c1d33);
            color: #75a6ff;
            box-shadow: 0 0 0 2px rgba(63,124,255,.10);
          }

          .config-pro__tipo-visual label > span {
            display: grid;
            gap: 2px;
          }

          .config-pro__tipo-visual strong {
            color: #e6eef9;
            font-size: .79rem;
          }

          .config-pro__tipo-visual small {
            color: #748aa5;
            font-size: .66rem;
          }

          .config-pro__visual-preview {
            position: relative;
            height: 220px;
            overflow: hidden;
            border: 1px solid #2a405c;
            border-radius: 16px;
            background:
              linear-gradient(145deg, #081421, #0d1d30);
          }

          .config-pro__visual-preview > img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          .config-pro__visual-vazio {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 7px;
            color: #6581a5;
          }

          .config-pro__visual-vazio strong {
            color: #cdd9e8;
            font-size: .82rem;
          }

          .config-pro__visual-vazio small {
            color: #7188a5;
            font-size: .68rem;
          }

          .config-pro__remover {
            position: absolute;
            top: 10px;
            right: 10px;
            min-height: 34px;
            padding: 0 10px;
            border: 1px solid rgba(255,255,255,.18);
            border-radius: 10px;
            background: rgba(8,15,25,.72);
            color: #d7e1ee;
            font-size: .68rem;
            font-weight: 850;
            backdrop-filter: blur(8px);
          }

          .config-pro__modelo {
            display: grid;
            grid-template-columns: 42px minmax(0,1fr) auto;
            align-items: center;
            gap: 11px;
            padding: 12px 13px;
            border: 1px solid #22364e;
            border-radius: 14px;
            background: linear-gradient(145deg, #0a1725, #0d1c2e);
          }

          .config-pro__modelo-icone {
            width: 42px;
            height: 42px;
            display: grid;
            place-items: center;
            border-radius: 12px;
            background: #112845;
            color: #79aaff;
          }

          .config-pro__modelo > div:nth-child(2) {
            min-width: 0;
            display: grid;
            gap: 3px;
          }

          .config-pro__modelo strong {
            color: #e8f0fb;
            font-size: .78rem;
          }

          .config-pro__modelo small {
            color: #748ba8;
            font-size: .67rem;
            line-height: 1.35;
          }

          .config-pro__modelo > span {
            min-height: 25px;
            display: inline-flex;
            align-items: center;
            padding: 0 8px;
            border-radius: 999px;
            background: #102b22;
            color: #56d89b;
            font-size: .6rem;
            font-weight: 950;
          }

          .config-pro__campos {
            display: grid;
            gap: 14px;
          }

          .config-pro__campos textarea {
            min-height: 86px !important;
          }

          .operacao-status-mestre {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            gap: 16px;
            margin-bottom: 16px;
            padding: 16px 17px;
            border: 1px solid #29425f;
            border-radius: 16px;
            background:
              linear-gradient(145deg, rgba(17,36,58,.96), rgba(9,23,38,.96));
          }

          .operacao-status-mestre.online {
            border-color: rgba(16,185,129,.34);
            box-shadow: inset 0 0 0 1px rgba(16,185,129,.05);
          }

          .operacao-status-mestre.pausado {
            border-color: rgba(239,68,68,.34);
            box-shadow: inset 0 0 0 1px rgba(239,68,68,.05);
          }

          .operacao-status-mestre__info {
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 0;
          }

          .operacao-status-mestre__icone {
            width: 42px;
            height: 42px;
            display: grid;
            place-items: center;
            flex: 0 0 42px;
            border-radius: 13px;
            background: rgba(16,185,129,.12);
            color: #55d8a5;
          }

          .operacao-status-mestre.pausado .operacao-status-mestre__icone {
            background: rgba(239,68,68,.12);
            color: #f78b8b;
          }

          .operacao-status-mestre__texto {
            min-width: 0;
          }

          .operacao-status-mestre__texto small {
            display: block;
            margin-bottom: 3px;
            color: #7f94ae;
            font-size: .62rem;
            font-weight: 900;
            letter-spacing: .07em;
          }

          .operacao-status-mestre__texto strong {
            display: block;
            color: #f3f8ff;
            font-size: .94rem;
          }

          .operacao-status-mestre__texto p {
            margin: 4px 0 0;
            color: #8fa5bf;
            font-size: .72rem;
            line-height: 1.4;
          }

          .operacao-status-mestre__botao {
            min-height: 42px;
            padding: 0 16px;
            border: 1px solid rgba(239,68,68,.45);
            border-radius: 12px;
            background: rgba(127,29,29,.18);
            color: #fca5a5;
            font: inherit;
            font-size: .74rem;
            font-weight: 950;
            cursor: pointer;
            white-space: nowrap;
          }

          .operacao-status-mestre.online .operacao-status-mestre__botao:hover {
            background: rgba(127,29,29,.28);
          }

          .operacao-status-mestre.pausado .operacao-status-mestre__botao {
            border-color: rgba(16,185,129,.42);
            background: rgba(6,78,59,.22);
            color: #6ee7b7;
          }

          .operacao-status-mestre__botao:disabled {
            opacity: .55;
            cursor: wait;
          }

          @media (max-width: 650px) {
            .operacao-status-mestre {
              grid-template-columns: 1fr;
            }

            .operacao-status-mestre__botao {
              width: 100%;
            }
          }

          .operacao-pro__grid {
            display: grid;
            grid-template-columns: 1.35fr .8fr .9fr;
            gap: 10px;
          }

          .operacao-pro__status,
          .operacao-pro__campo {
            min-height: 88px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 13px;
            border: 1px solid #253a54;
            border-radius: 14px;
            background: #0a1624;
          }

          .operacao-pro__status > span {
            display: grid;
            gap: 4px;
          }

          .operacao-pro__status strong {
            color: #e8f0fb;
            font-size: .79rem;
          }

          .operacao-pro__status small {
            color: #758ba7;
            font-size: .66rem;
          }

          .operacao-pro__campo {
            display: grid;
            align-content: center;
            justify-content: stretch;
            gap: 7px;
          }

          .operacao-pro__campo > span {
            color: #8da0b8;
            font-size: .68rem;
            font-weight: 800;
          }

          .operacao-pro__campo > div {
            display: flex;
            align-items: center;
            gap: 7px;
          }

          .operacao-pro__campo input {
            min-width: 0;
            height: 42px !important;
            padding: 0 10px !important;
            border-radius: 10px !important;
          }

          .operacao-pro__campo b {
            color: #7691b0;
            font-size: .72rem;
          }

          .preview-config {
            position: sticky;
            top: 18px;
            align-self: start;
          }

          @media (max-width: 900px) {
            .config-pro__logo-linha {
              grid-template-columns: 58px minmax(0,1fr);
            }

            .config-pro__acao {
              grid-column: 1 / -1;
              width: 100%;
            }

            .config-pro__tipo-visual,
            .operacao-pro__grid {
              grid-template-columns: 1fr;
            }

            .config-pro__visual-preview {
              height: 180px;
            }

            .config-pro__modelo {
              grid-template-columns: 40px minmax(0,1fr);
            }

            .config-pro__modelo > span {
              grid-column: 2;
              width: max-content;
            }

            .preview-config {
              position: static;
            }
          }

          .modelos-kodvexa {
            display: grid;
            gap: 12px;
          }

          .modelos-kodvexa__topo {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 12px;
          }

          .modelos-kodvexa__topo > div {
            display: grid;
            gap: 4px;
          }

          .modelos-kodvexa__topo strong {
            color: #eaf2fd;
            font-size: .9rem;
          }

          .modelos-kodvexa__topo small {
            color: #7d92ad;
            font-size: .7rem;
          }

          .modelos-kodvexa__topo > span {
            flex: 0 0 auto;
            min-height: 25px;
            display: inline-flex;
            align-items: center;
            padding: 0 8px;
            border-radius: 999px;
            background: #10243c;
            color: #77a9ff;
            font-size: .58rem;
            font-weight: 950;
          }

          .modelos-kodvexa__grade {
            display: grid;
            grid-template-columns: repeat(3, minmax(0,1fr));
            gap: 10px;
          }

          .modelo-opcao {
            position: relative;
            display: grid;
            gap: 10px;
            min-width: 0;
            padding: 9px;
            border: 1px solid #273c56;
            border-radius: 15px;
            background: #091522;
            color: inherit;
            text-align: left;
            cursor: pointer;
            transition: .18s ease;
          }

          .modelo-opcao:hover {
            transform: translateY(-1px);
            border-color: #38577c;
          }

          .modelo-opcao.ativo {
            border-color: #3f7cff;
            background: linear-gradient(145deg, #0d2038, #0a1828);
            box-shadow: 0 0 0 2px rgba(63,124,255,.11);
          }

          .modelo-opcao__texto {
            min-width: 0;
            display: grid;
            gap: 2px;
          }

          .modelo-opcao__texto strong {
            color: #e8f1fc;
            font-size: .75rem;
          }

          .modelo-opcao__texto small {
            min-height: 30px;
            color: #7288a4;
            font-size: .62rem;
            line-height: 1.35;
          }

          .modelo-opcao__check {
            position: absolute;
            top: 8px;
            right: 8px;
            width: 22px;
            height: 22px;
            display: grid;
            place-items: center;
            border-radius: 50%;
            background: #0d1b2b;
            color: #fff;
            font-size: .72rem;
            font-weight: 950;
          }

          .modelo-opcao.ativo .modelo-opcao__check {
            background: #2870ff;
          }

          .modelo-mini {
            position: relative;
            height: 92px;
            overflow: hidden;
            border-radius: 11px;
            background: #eef2f7;
          }

          .modelo-mini i,
          .modelo-mini b,
          .modelo-mini span {
            position: absolute;
            display: block;
          }

          .modelo-mini i:first-child {
            top: 0;
            right: 0;
            left: 0;
            height: 34px;
            background: linear-gradient(135deg, #26384d, #0d1622);
          }

          .modelo-mini i:nth-child(2) {
            top: 28px;
            left: 9px;
            width: 25px;
            height: 25px;
            border-radius: 8px;
            background: #fff;
            box-shadow: 0 3px 8px rgba(0,0,0,.12);
          }

          .modelo-mini b {
            top: 42px;
            right: 9px;
            left: 9px;
            height: 13px;
            border-radius: 7px;
            background: #fff;
          }

          .modelo-mini span:nth-of-type(1),
          .modelo-mini span:nth-of-type(2) {
            top: 63px;
            width: calc(50% - 14px);
            height: 20px;
            border-radius: 7px;
            background: #fff;
          }

          .modelo-mini span:nth-of-type(1) { left: 9px; }
          .modelo-mini span:nth-of-type(2) { right: 9px; }

          .modelo-mini.vitrine {
            background: #f4f6fb;
          }

          .modelo-mini.vitrine i:first-child {
            background: linear-gradient(135deg, #3a140b, #ce5b17);
          }

          .modelo-mini.vitrine span:nth-of-type(1),
          .modelo-mini.vitrine span:nth-of-type(2) {
            height: 24px;
            background: linear-gradient(145deg, #fff, #f7e9df);
          }

          .modelo-mini.glass {
            background: linear-gradient(145deg, #111a2b, #1a2940);
          }

          .modelo-mini.glass i:first-child {
            background: linear-gradient(135deg, #0a1526, #263b59);
          }

          .modelo-mini.glass b,
          .modelo-mini.glass span:nth-of-type(1),
          .modelo-mini.glass span:nth-of-type(2) {
            border: 1px solid rgba(255,255,255,.16);
            background: rgba(255,255,255,.13);
            backdrop-filter: blur(5px);
          }

          .preview-modelo-vitrine .celular-preview__conteudo {
            background: linear-gradient(180deg, #fff8f2, #f7f1eb) !important;
          }

          .preview-modelo-vitrine .celular-preview__produto {
            border-color: #efd8c5 !important;
            border-radius: 15px !important;
            box-shadow: 0 7px 18px rgba(88,47,21,.07) !important;
          }

          .preview-modelo-glass .celular-preview__conteudo {
            background: linear-gradient(180deg, #eef4fb, #e7eef7) !important;
          }

          .preview-modelo-glass .celular-preview__produto {
            border-color: rgba(140,162,190,.32) !important;
            background: rgba(255,255,255,.78) !important;
            box-shadow: 0 8px 20px rgba(38,58,83,.09) !important;
            backdrop-filter: blur(8px);
          }

          @media (max-width: 900px) {
            .modelos-kodvexa__grade {
              grid-template-columns: 1fr;
            }

            .modelo-opcao {
              grid-template-columns: 118px minmax(0,1fr);
              align-items: center;
            }

            .modelo-mini {
              height: 78px;
            }

            .modelo-opcao__texto small {
              min-height: 0;
            }
          }


          /* MODELOS FOOD - seletor visual grande */
          .modelos-food {
            margin-top: 2px;
          }

          .modelos-food__grade {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
          }

          .food-modelo-card {
            position: relative;
            overflow: hidden;
            display: grid;
            gap: 0;
            padding: 0;
            border: 1px solid #263d59;
            border-radius: 17px;
            background: #081421;
            color: inherit;
            text-align: left;
            cursor: pointer;
            transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
          }

          .food-modelo-card:hover {
            transform: translateY(-2px);
            border-color: #3b5d85;
          }

          .food-modelo-card.ativo {
            border-color: #3f7cff;
            box-shadow:
              0 0 0 2px rgba(63,124,255,.12),
              0 14px 28px rgba(3,12,24,.20);
          }

          .food-mini {
            position: relative;
            height: 172px;
            overflow: hidden;
            background: #eef3f8;
          }

          .food-mini__hero {
            position: relative;
            height: 68px;
            overflow: hidden;
          }

          .food-mini__logo {
            position: absolute;
            left: 10px;
            bottom: 9px;
            width: 28px;
            height: 28px;
            border-radius: 8px;
            background: rgba(255,255,255,.92);
            box-shadow: 0 4px 9px rgba(0,0,0,.12);
          }

          .food-mini__nome {
            position: absolute;
            left: 46px;
            bottom: 27px;
            width: 84px;
            height: 8px;
            border-radius: 999px;
            background: rgba(255,255,255,.90);
          }

          .food-mini__status {
            position: absolute;
            left: 46px;
            bottom: 10px;
            width: 48px;
            height: 9px;
            border-radius: 999px;
            background: rgba(93,225,150,.92);
          }

          .food-mini__search {
            height: 24px;
            margin: 8px 10px 6px;
            border-radius: 8px;
            background: #fff;
            box-shadow: 0 2px 7px rgba(20,34,51,.06);
          }

          .food-mini__cats {
            display: flex;
            gap: 5px;
            margin: 0 10px 7px;
          }

          .food-mini__cats i {
            width: 42px;
            height: 13px;
            border-radius: 999px;
            background: #fff;
          }

          .food-mini__cards {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 7px;
            margin: 0 10px;
          }

          .food-mini__cards span {
            height: 45px;
            border-radius: 9px;
            background: #fff;
            box-shadow: 0 3px 9px rgba(20,34,51,.06);
          }

          .food-mini.burger-house {
            background: #17100d;
          }

          .food-mini.burger-house .food-mini__hero {
            background:
              radial-gradient(circle at 72% 40%, rgba(255,118,39,.45), transparent 28%),
              linear-gradient(135deg, #160a07, #5b1f0b 58%, #17100d);
          }

          .food-mini.burger-house .food-mini__search,
          .food-mini.burger-house .food-mini__cats i,
          .food-mini.burger-house .food-mini__cards span {
            background: #241813;
            border: 1px solid rgba(255,124,44,.18);
          }

          .food-mini.burger-house .food-mini__cats i:first-child {
            background: #ff6a1a;
          }

          .food-mini.gourmet {
            background: #f5efe6;
          }

          .food-mini.gourmet .food-mini__hero {
            background:
              linear-gradient(90deg, rgba(62,48,35,.58), rgba(62,48,35,.08)),
              linear-gradient(135deg, #d7c2a2, #7a6248);
          }

          .food-mini.gourmet .food-mini__search,
          .food-mini.gourmet .food-mini__cats i,
          .food-mini.gourmet .food-mini__cards span {
            background: #fffdf9;
            border: 1px solid #e6d8c8;
          }

          .food-mini.gourmet .food-mini__cats i:first-child {
            background: #8a6b46;
          }

          .food-mini.fast-food {
            background: #fff7ef;
          }

          .food-mini.fast-food .food-mini__hero {
            background:
              radial-gradient(circle at 75% 30%, rgba(255,221,92,.55), transparent 25%),
              linear-gradient(135deg, #ff4928, #ff8b1f);
          }

          .food-mini.fast-food .food-mini__cats i:first-child {
            background: #ff4d24;
          }

          .food-mini.fast-food .food-mini__cards span {
            box-shadow: 0 5px 12px rgba(255,84,33,.10);
          }

          .food-mini.night-food {
            background:
              radial-gradient(circle at 50% 0%, rgba(61,90,160,.20), transparent 46%),
              #0b1120;
          }

          .food-mini.night-food .food-mini__hero {
            background:
              linear-gradient(135deg, rgba(36,57,100,.80), rgba(12,18,33,.92));
          }

          .food-mini.night-food .food-mini__search,
          .food-mini.night-food .food-mini__cats i,
          .food-mini.night-food .food-mini__cards span {
            border: 1px solid rgba(111,139,206,.20);
            background: rgba(255,255,255,.09);
            backdrop-filter: blur(6px);
          }

          .food-mini.night-food .food-mini__cats i:first-child {
            background: #5c6cff;
            box-shadow: 0 0 10px rgba(92,108,255,.35);
          }

          .food-mini.clean-food {
            background: #f7f9fc;
          }

          .food-mini.clean-food .food-mini__hero {
            background: linear-gradient(135deg, #dce4ee, #aebdcd);
          }

          .food-mini.clean-food .food-mini__cards span {
            border: 1px solid #e5eaf0;
            box-shadow: none;
          }

          .food-modelo-card__info {
            display: grid;
            gap: 6px;
            padding: 12px 13px 10px;
            border-top: 1px solid #20344c;
          }

          .food-modelo-card__info > div {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
          }

          .food-modelo-card__info strong {
            color: #edf5ff;
            font-size: .82rem;
          }

          .food-modelo-card__info span {
            min-height: 22px;
            display: inline-flex;
            align-items: center;
            padding: 0 7px;
            border-radius: 999px;
            background: #10243c;
            color: #78a9ff;
            font-size: .52rem;
            font-weight: 950;
            letter-spacing: .03em;
          }

          .food-modelo-card__info small {
            min-height: 34px;
            color: #7188a4;
            font-size: .65rem;
            line-height: 1.4;
          }

          .food-modelo-card__rodape {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            min-height: 42px;
            padding: 0 13px;
            border-top: 1px solid #20344c;
            background: #0a1725;
            color: #8ba0ba;
            font-size: .66rem;
            font-weight: 850;
          }

          .food-modelo-card__rodape b {
            width: 25px;
            height: 25px;
            display: grid;
            place-items: center;
            border-radius: 8px;
            background: #112640;
            color: #7ba9f8;
          }

          .food-modelo-card.ativo .food-modelo-card__rodape {
            color: #83aeff;
          }

          .food-modelo-card.ativo .food-modelo-card__rodape b {
            background: #2870ff;
            color: #fff;
          }

          @media (max-width: 900px) {
            .modelos-food__grade {
              grid-template-columns: 1fr;
            }

            .food-modelo-card {
              grid-template-columns: 126px minmax(0,1fr);
              grid-template-rows: auto auto;
            }

            .food-mini {
              grid-row: 1 / 3;
              height: 136px;
              border-right: 1px solid #20344c;
            }

            .food-modelo-card__info {
              border-top: 0;
            }
          }


          .modelos-accordion {
            overflow: hidden;
            border: 1px solid #253a54;
            border-radius: 16px;
            background: #091522;
          }

          .modelos-accordion__cabecalho {
            width: 100%;
            min-height: 82px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 14px 16px;
            border: 0;
            background: linear-gradient(145deg, #0b1827, #0d1d30);
            color: inherit;
            text-align: left;
            cursor: pointer;
          }

          .modelos-accordion__cabecalho.aberto {
            border-bottom: 1px solid #253a54;
          }

          .modelos-accordion__cabecalho > div:first-child {
            min-width: 0;
            display: grid;
            gap: 3px;
          }

          .modelos-accordion__cabecalho span {
            color: #6f9ce5;
            font-size: .58rem;
            font-weight: 950;
            letter-spacing: .11em;
          }

          .modelos-accordion__cabecalho strong {
            color: #edf5ff;
            font-size: .92rem;
          }

          .modelos-accordion__cabecalho small {
            color: #768ca7;
            font-size: .68rem;
          }

          .modelos-accordion__acao {
            display: flex;
            align-items: center;
            gap: 9px;
            flex: 0 0 auto;
          }

          .modelos-accordion__acao b {
            color: #83aef6;
            font-size: .7rem;
          }

          .modelos-accordion__acao i {
            width: 34px;
            height: 34px;
            display: grid;
            place-items: center;
            border: 1px solid #2b4564;
            border-radius: 10px;
            background: #10223a;
            color: #8bb4ff;
            font-size: 1.1rem;
            font-style: normal;
          }

          .modelos-accordion__conteudo {
            display: grid;
            gap: 13px;
            padding: 14px;
            background: #07121e;
          }

          .modelos-accordion__aviso {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 11px 12px;
            border: 1px solid #203750;
            border-radius: 13px;
            background: #0a1827;
          }

          .modelos-accordion__aviso > div {
            display: grid;
            gap: 3px;
          }

          .modelos-accordion__aviso strong {
            color: #dfeaf8;
            font-size: .76rem;
          }

          .modelos-accordion__aviso small {
            color: #748aa5;
            font-size: .64rem;
            line-height: 1.35;
          }

          .modelos-accordion__aviso button {
            flex: 0 0 auto;
            min-height: 36px;
            padding: 0 10px;
            border: 1px solid #315989;
            border-radius: 10px;
            background: #10243b;
            color: #82adf4;
            font-size: .64rem;
            font-weight: 900;
          }

          .food-mini.kodvexa {
            background: linear-gradient(180deg, #edf3fa, #f7f9fc);
          }

          .food-mini.kodvexa .food-mini__hero {
            background:
              radial-gradient(circle at 82% 22%, rgba(61,106,180,.32), transparent 28%),
              linear-gradient(135deg, #0d1a2c, #314a6d);
          }

          .food-mini.kodvexa .food-mini__search,
          .food-mini.kodvexa .food-mini__cats i,
          .food-mini.kodvexa .food-mini__cards span {
            border: 1px solid #dde5ef;
            background: #fff;
          }

          .food-mini.kodvexa .food-mini__cats i:first-child {
            background: #4c35f3;
          }

          .food-mini.marmitaria {
            background: linear-gradient(180deg, #fff8ef, #fffdf9);
          }

          .food-mini.marmitaria .food-mini__hero {
            background:
              radial-gradient(circle at 78% 28%, rgba(255,196,109,.34), transparent 27%),
              linear-gradient(135deg, #7b2f18, #d46a2e);
          }

          .food-mini.marmitaria .food-mini__search,
          .food-mini.marmitaria .food-mini__cats i,
          .food-mini.marmitaria .food-mini__cards span {
            border: 1px solid #f0dfcf;
            background: #fff;
          }

          .food-mini.marmitaria .food-mini__cats i:first-child {
            background: #c95526;
          }

          .preview-modelo-marmitaria .celular-preview__conteudo {
            background: linear-gradient(180deg, #fff9f2, #f8f0e7) !important;
          }

          .preview-modelo-marmitaria .preview-busca,
          .preview-modelo-marmitaria .preview-produto,
          .preview-modelo-marmitaria .preview-categorias span {
            border-color: #ead8c7 !important;
            background: #fffdf9 !important;
          }

          .preview-modelo-marmitaria .preview-categorias span:first-child {
            background: #b94d25 !important;
            color: #fff !important;
            border-color: #b94d25 !important;
          }

          .preview-modelo-marmitaria .preview-produto {
            border-radius: 15px !important;
            box-shadow: 0 5px 14px rgba(108,55,29,.08) !important;
          }

          .preview-modelo-marmitaria .preview-produto strong {
            color: #a94320 !important;
          }

          /* Prévia ao vivo: muda imediatamente ao selecionar o modelo */
          .preview-modelo-kodvexa .celular-preview__conteudo {
            background: linear-gradient(180deg, #f4f7fb, #edf2f7) !important;
          }

          .preview-modelo-kodvexa .preview-produto {
            border-radius: 13px !important;
            background: #fff !important;
            border-color: #dfe6ef !important;
          }

          .preview-modelo-burger-house .celular-preview__conteudo {
            background: linear-gradient(180deg, #17110e, #21150f) !important;
            color: #fff !important;
          }

          .preview-modelo-burger-house .preview-busca,
          .preview-modelo-burger-house .preview-produto,
          .preview-modelo-burger-house .preview-categorias span {
            border-color: rgba(255,124,44,.18) !important;
            background: #281a14 !important;
            color: #f5e8df !important;
          }

          .preview-modelo-burger-house .preview-produto span {
            color: #b69b8d !important;
          }

          .preview-modelo-burger-house .preview-produto strong {
            color: #ff7a2a !important;
          }

          .preview-modelo-gourmet .celular-preview__conteudo {
            background: linear-gradient(180deg, #fbf7f1, #f3ece3) !important;
          }

          .preview-modelo-gourmet .preview-busca,
          .preview-modelo-gourmet .preview-produto,
          .preview-modelo-gourmet .preview-categorias span {
            border-color: #e6dacb !important;
            background: #fffdf9 !important;
          }

          .preview-modelo-gourmet .preview-produto strong {
            color: #7b5d3d !important;
          }

          .preview-modelo-fast-food .celular-preview__conteudo {
            background: linear-gradient(180deg, #fffaf5, #fff1e5) !important;
          }

          .preview-modelo-fast-food .preview-busca,
          .preview-modelo-fast-food .preview-produto {
            border-color: #ffdfcc !important;
            border-radius: 15px !important;
            background: #fff !important;
            box-shadow: 0 5px 12px rgba(255,80,35,.08) !important;
          }

          .preview-modelo-fast-food .preview-categorias span:first-child {
            background: #ff5426 !important;
            color: #fff !important;
            border-color: #ff5426 !important;
          }

          .preview-modelo-fast-food .preview-produto strong {
            color: #ef421e !important;
          }

          .preview-modelo-night-food .celular-preview__conteudo {
            background:
              radial-gradient(circle at 50% 0%, rgba(76,98,170,.16), transparent 30%),
              #0d1524 !important;
            color: #f4f7ff !important;
          }

          .preview-modelo-night-food .preview-busca,
          .preview-modelo-night-food .preview-produto,
          .preview-modelo-night-food .preview-categorias span {
            border-color: rgba(122,145,211,.20) !important;
            background: rgba(255,255,255,.08) !important;
            color: #d5ddef !important;
            backdrop-filter: blur(8px);
          }

          .preview-modelo-night-food .preview-produto span {
            color: #8e9ebb !important;
          }

          .preview-modelo-night-food .preview-produto strong {
            color: #8d97ff !important;
          }

          .preview-modelo-clean-food .celular-preview__conteudo {
            background: #f7f9fc !important;
          }

          .preview-modelo-clean-food .preview-busca,
          .preview-modelo-clean-food .preview-produto,
          .preview-modelo-clean-food .preview-categorias span {
            border-color: #e5eaf0 !important;
            background: #fff !important;
            box-shadow: none !important;
          }

          .preview-modelo-clean-food .preview-produto strong {
            color: #111827 !important;
          }

          .config-abas {
            grid-column: 1 / -1;
            display: flex;
            gap: 9px;
            padding: 7px;
            border: 1px solid #243b58;
            border-radius: 17px;
            background: rgba(8,20,33,.78);
            box-shadow: inset 0 1px 0 rgba(255,255,255,.025);
          }

          .config-abas button {
            min-height: 46px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            flex: 1;
            padding: 0 16px;
            border: 1px solid transparent;
            border-radius: 12px;
            background: transparent;
            color: #8299b5;
            font: inherit;
            font-size: .78rem;
            font-weight: 900;
            cursor: pointer;
            transition: .18s ease;
          }

          .config-abas button:hover {
            color: #dceaff;
            background: #0d1d30;
          }

          .config-abas button.ativo {
            border-color: #397cff;
            background: linear-gradient(135deg, #0d58df, #2478ff);
            color: #fff;
            box-shadow: 0 8px 22px rgba(36,120,255,.22);
          }

          .config-abas button svg {
            width: 17px;
            height: 17px;
          }

          .config-horarios {
            display: grid;
            gap: 10px;
          }

          .config-horario-linha {
            display: grid;
            grid-template-columns: minmax(150px, 1fr) 132px 24px 132px 112px;
            align-items: center;
            gap: 10px;
            min-height: 64px;
            padding: 10px 12px;
            border: 1px solid #223a55;
            border-radius: 14px;
            background: #0b1929;
          }

          .config-horario-dia {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
          }

          .config-horario-dia__icone {
            width: 34px;
            height: 34px;
            display: grid;
            place-items: center;
            flex: 0 0 34px;
            border-radius: 10px;
            background: #102b49;
            color: #75a9ff;
          }

          .config-horario-dia strong {
            color: #edf5ff;
            font-size: .82rem;
          }

          .config-horario-linha input[type="time"] {
            width: 100%;
            min-height: 42px;
            padding: 0 10px;
            border: 1px solid #29435f;
            border-radius: 11px;
            outline: none;
            background: #091522;
            color: #f4f8ff;
            font: inherit;
            font-size: .78rem;
          }

          .config-horario-linha input[type="time"]:disabled {
            opacity: .35;
          }

          .config-horario-separador {
            color: #627b99;
            text-align: center;
            font-size: .72rem;
            font-weight: 900;
          }

          .config-horario-status {
            min-height: 40px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 7px;
            padding: 0 10px;
            border: 1px solid #29435f;
            border-radius: 11px;
            background: #0d2034;
            color: #a9bdd6;
            cursor: pointer;
            font-size: .72rem;
            font-weight: 900;
          }

          .config-horario-status input {
            accent-color: #2478ff;
          }

          .config-horarios-acoes {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-top: 14px;
            padding-top: 14px;
            border-top: 1px solid #223a55;
          }

          .config-horarios-acoes__msg {
            min-width: 0;
          }

          .config-horarios-acoes__msg p {
            margin: 0;
            font-size: .75rem;
          }

          .config-horarios-acoes__msg .ok {
            color: #6ee7b7;
          }

          .config-horarios-acoes__msg .erro {
            color: #fda4af;
          }

          .config-horarios-salvar {
            min-height: 44px;
            padding: 0 18px;
            border: 1px solid #3b80ff;
            border-radius: 12px;
            background: linear-gradient(135deg, #1769ff, #287dff);
            color: #fff;
            font: inherit;
            font-size: .76rem;
            font-weight: 950;
            cursor: pointer;
          }

          .config-horarios-salvar:disabled {
            opacity: .55;
            cursor: wait;
          }

          @media (max-width: 900px) {
            .config-horario-linha {
              grid-template-columns: minmax(140px, 1fr) 1fr 20px 1fr;
            }

            .config-horario-status {
              grid-column: 1 / -1;
            }
          }

          @media (max-width: 620px) {
            .config-horario-linha {
              grid-template-columns: 1fr 1fr;
            }

            .config-horario-dia,
            .config-horario-status {
              grid-column: 1 / -1;
            }

            .config-horario-separador {
              display: none;
            }

            .config-horarios-acoes {
              align-items: stretch;
              flex-direction: column;
            }

            .config-horarios-salvar {
              width: 100%;
            }
          }

          .config-conteudo-aba {
            grid-column: 1;
            min-width: 0;
          }

          .config-conteudo-aba > .cartao-config {
            margin: 0;
          }

          .config-unidade-resumo {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 14px;
            margin-bottom: 14px;
            padding: 16px 17px;
            border: 1px solid #2b4c73;
            border-left: 4px solid #2478ff;
            border-radius: 16px;
            background:
              radial-gradient(circle at 12% 0%, rgba(36,120,255,.12), transparent 38%),
              #0a1828;
          }

          .config-unidade-resumo__principal {
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 0;
          }

          .config-unidade-resumo__icone {
            width: 44px;
            height: 44px;
            display: grid;
            place-items: center;
            flex: 0 0 44px;
            border: 1px solid #3265a5;
            border-radius: 13px;
            background: #102a49;
            color: #76aaff;
          }

          .config-unidade-resumo small {
            display: block;
            margin-bottom: 3px;
            color: #7896bb;
            font-size: .61rem;
            font-weight: 950;
            letter-spacing: .08em;
          }

          .config-unidade-resumo strong {
            display: block;
            overflow: hidden;
            color: #eef6ff;
            font-size: 1rem;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .config-unidade-resumo__tipo {
            min-height: 27px;
            display: inline-flex;
            align-items: center;
            padding: 0 10px;
            border: 1px solid #2f609b;
            border-radius: 999px;
            background: #102641;
            color: #73a9ff;
            font-size: .61rem;
            font-weight: 950;
          }

          .config-simples .titulo-bloco-config {
            margin-bottom: 18px;
          }

          .config-simples .unidade-config-pro__grid {
            gap: 15px;
          }

          .config-simples .unidade-config-pro__grid label {
            gap: 8px;
            color: #a7bad1;
            font-size: .72rem;
          }

          .config-simples .unidade-config-pro__grid input,
          .config-simples .config-pro__campos input,
          .config-simples .config-pro__campos textarea {
            border-color: #2a4564;
            background: #081522;
          }

          @media (max-width: 900px) {
            .config-abas {
              overflow-x: auto;
              justify-content: flex-start;
            }

            .config-abas button {
              min-width: 140px;
              flex: 0 0 auto;
            }

            .config-unidade-resumo {
              align-items: flex-start;
              flex-direction: column;
            }
          }

          /* LAYOUT FINAL DAS CONFIGURAÇÕES */
          .form-config {
            display: grid !important;
            grid-template-columns: minmax(0, 1fr) 380px !important;
            gap: 16px 18px !important;
            align-items: start !important;
          }

          .config-abas {
            grid-column: 1 / -1 !important;
            grid-row: 1 !important;
            margin: 0 !important;
          }

          .config-conteudo-aba {
            grid-column: 1 !important;
            grid-row: 2 !important;
            min-width: 0 !important;
          }

          .preview-config {
            grid-column: 2 !important;
            grid-row: 2 !important;
            position: sticky !important;
            top: 16px !important;
            width: 100% !important;
            max-width: 380px !important;
            margin: 0 !important;
            justify-self: end !important;
          }

          .mensagem-config,
          .acoes-config {
            grid-column: 1 / -1 !important;
          }

          .acoes-config {
            display: flex !important;
            justify-content: flex-end !important;
            gap: 10px !important;
            margin-top: 0 !important;
          }

          .config-unidade-resumo {
            margin-bottom: 12px !important;
            padding: 13px 15px !important;
          }

          .config-unidade-resumo__icone {
            width: 38px !important;
            height: 38px !important;
            flex-basis: 38px !important;
          }

          .config-conteudo-aba > .cartao-config {
            padding: 18px !important;
          }

          .config-simples .titulo-bloco-config {
            margin-bottom: 14px !important;
          }

          .unidade-config-pro__grid {
            grid-template-columns: minmax(0, 1.4fr) minmax(220px, .8fr) !important;
            gap: 12px !important;
          }

          .unidade-config-pro__grid input {
            min-height: 43px !important;
          }

          @media (max-width: 1180px) {
            .form-config {
              grid-template-columns: minmax(0, 1fr) 330px !important;
            }
            .preview-config {
              max-width: 330px !important;
            }
          }

          @media (max-width: 900px) {
            .form-config {
              grid-template-columns: 1fr !important;
            }
            .config-abas {
              grid-column: 1 !important;
              grid-row: auto !important;
            }
            .config-conteudo-aba {
              grid-column: 1 !important;
              grid-row: auto !important;
            }
            .preview-config {
              grid-column: 1 !important;
              grid-row: auto !important;
              position: static !important;
              max-width: 100% !important;
              justify-self: stretch !important;
            }
            .unidade-config-pro__grid {
              grid-template-columns: 1fr !important;
            }
          }

          @media (max-width: 900px) {
            .modelos-accordion__cabecalho {
              align-items: flex-start;
            }

            .modelos-accordion__acao b {
              display: none;
            }

            .modelos-accordion__aviso {
              align-items: stretch;
              flex-direction: column;
            }

            .modelos-accordion__aviso button {
              width: 100%;
            }
          }

        `}</style>
        <form className="form-config" onSubmit={salvar}>
          <div className="config-abas">
            <button type="button" className={abaConfig === 'informacoes' ? 'ativo' : ''} onClick={() => setAbaConfig('informacoes')}>
              <Store /> Informações
            </button>
            <button type="button" className={abaConfig === 'operacao' ? 'ativo' : ''} onClick={() => setAbaConfig('operacao')}>
              <Clock3 /> Operação
            </button>
            <button type="button" className={abaConfig === 'horarios' ? 'ativo' : ''} onClick={() => setAbaConfig('horarios')}>
              <Clock3 /> Horários
            </button>
            <button type="button" className={abaConfig === 'aparencia' ? 'ativo' : ''} onClick={() => setAbaConfig('aparencia')}>
              <Sparkles /> Aparência
            </button>
          </div>

          <div className="config-conteudo-aba">
            <div className="config-unidade-resumo">
              <div className="config-unidade-resumo__principal">
                <div className="config-unidade-resumo__icone"><Store size={20} /></div>
                <div>
                  <small>VOCÊ ESTÁ EDITANDO A UNIDADE</small>
                  <strong>{form.nome_unidade || (loja.tipo_unidade === 'matriz' ? 'Matriz' : 'Filial')}</strong>
                </div>
              </div>
              <span className="config-unidade-resumo__tipo">{loja.tipo_unidade === 'matriz' ? 'MATRIZ' : 'FILIAL'}</span>
            </div>

            {abaConfig === 'informacoes' && (
          <section className="cartao-config config-pro unidade-config-pro config-simples">
            <div className="titulo-bloco-config config-pro__titulo">
              <span>INFORMAÇÕES</span>
              <h3>Dados da unidade</h3>
              <p>Edite apenas os dados principais desta unidade.</p>
            </div>

            <div className="unidade-config-pro__grid">
              <label>Nome da unidade
                <input value={form.nome_unidade} onChange={(e) => alterar('nome_unidade', e.target.value)} placeholder="Ex.: Zona Norte" />
              </label>
              <label>WhatsApp da unidade
                <input value={form.whatsapp} onChange={(e) => alterar('whatsapp', e.target.value)} placeholder="(51) 99999-9999" inputMode="tel" />
              </label>
              <label className="unidade-config-pro__largo">Endereço
                <input value={form.endereco} onChange={(e) => alterar('endereco', e.target.value)} placeholder="Rua, avenida..." />
              </label>
              <label>Cidade
                <input value={form.cidade} onChange={(e) => alterar('cidade', e.target.value)} placeholder="Porto Alegre" />
              </label>
              <label>Estado
                <input value={form.estado} onChange={(e) => alterar('estado', e.target.value)} placeholder="RS" maxLength={2} />
              </label>
              <label>CEP
                <input value={form.cep} onChange={(e) => alterar('cep', e.target.value)} placeholder="00000-000" inputMode="numeric" />
              </label>
            </div>

            <small className="unidade-config-pro__aviso">As configurações de entrega continuam na aba <b>Entregas</b>.</small>
          </section>
            )}

            {abaConfig === 'horarios' && (
              <section className="cartao-config config-pro config-simples">
                <div className="titulo-bloco-config config-pro__titulo">
                  <span>HORÁRIOS</span>
                  <h3>Funcionamento da unidade</h3>
                  <p>Defina os horários exclusivos de {form.nome_unidade || 'esta unidade'}.</p>
                </div>

                <div className="config-horarios">
                  {horarios.map((dia) => (
                    <div className="config-horario-linha" key={dia.dia_semana}>
                      <div className="config-horario-dia">
                        <div className="config-horario-dia__icone"><Clock3 size={16} /></div>
                        <strong>{dia.nome}</strong>
                      </div>

                      <input
                        type="time"
                        value={dia.abre}
                        disabled={dia.fechado}
                        onChange={(e) => alterarHorario(dia.dia_semana, 'abre', e.target.value)}
                      />

                      <span className="config-horario-separador">até</span>

                      <input
                        type="time"
                        value={dia.fecha}
                        disabled={dia.fechado}
                        onChange={(e) => alterarHorario(dia.dia_semana, 'fecha', e.target.value)}
                      />

                      <label className="config-horario-status">
                        <input
                          type="checkbox"
                          checked={!dia.fechado}
                          onChange={(e) => alterarHorario(dia.dia_semana, 'fechado', !e.target.checked)}
                        />
                        {dia.fechado ? 'Fechado' : 'Aberto'}
                      </label>
                    </div>
                  ))}
                </div>

                <div className="config-horarios-acoes">
                  <div className="config-horarios-acoes__msg">
                    {erroHorarios && <p className="erro">{erroHorarios}</p>}
                    {mensagemHorarios && <p className="ok">{mensagemHorarios}</p>}
                  </div>

                  <button
                    type="button"
                    className="config-horarios-salvar"
                    disabled={salvandoHorarios}
                    onClick={salvarHorarios}
                  >
                    {salvandoHorarios ? 'Salvando...' : 'Salvar horários'}
                  </button>
                </div>
              </section>
            )}

            {abaConfig === 'aparencia' && (
          <section className="cartao-config identidade-config config-pro config-simples">
            <div className="titulo-bloco-config config-pro__titulo">
              <span>APARÊNCIA</span>
              <h3>Identidade da loja</h3>
              <p>Atualize a marca e o visual que o cliente vê no cardápio.</p>
            </div>

            <div className="config-pro__logo-linha">
              <div className="config-pro__logo-preview">
                {previewLogo ? <img src={previewLogo} alt="Logo da loja" /> : <Store size={28} />}
              </div>

              <div className="config-pro__logo-texto">
                <strong>Logo da loja</strong>
                <small>Use uma imagem quadrada para ficar melhor no cardápio.</small>
              </div>

              <label className="config-pro__acao">
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={escolherLogo} />
                Alterar logo
              </label>
            </div>

            <div className="config-pro__divisor" />

            <div className="config-pro__visual-topo">
              <div className="config-pro__subtitulo">
                <div>
                  <strong>Visual do topo</strong>
                  <small>Escolha foto ou GIF. Apenas um fica ativo por vez.</small>
                </div>

                <span className="config-pro__badge">
                  {tipoVisual === 'gif' && previewGif ? 'GIF ativo' : tipoVisual === 'capa' && previewCapa ? 'Foto ativa' : 'Sem visual'}
                </span>
              </div>

              <div className="config-pro__tipo-visual">
                <label className={tipoVisual === 'capa' ? 'ativo' : ''}>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => escolherVisual(e, 'capa')} />
                  <Store size={18} />
                  <span><strong>Foto de capa</strong><small>JPG, PNG ou WEBP</small></span>
                </label>

                <label className={tipoVisual === 'gif' ? 'ativo' : ''}>
                  <input type="file" accept="image/gif" onChange={(e) => escolherVisual(e, 'gif')} />
                  <RefreshCw size={18} />
                  <span><strong>GIF animado</strong><small>Até 10 MB</small></span>
                </label>
              </div>

              <div className="config-pro__visual-preview">
                {(tipoVisual === 'gif' ? previewGif : previewCapa) ? (
                  <img
                    src={tipoVisual === 'gif' ? previewGif : previewCapa}
                    alt={tipoVisual === 'gif' ? 'Prévia do GIF' : 'Prévia da capa'}
                  />
                ) : (
                  <div className="config-pro__visual-vazio">
                    {tipoVisual === 'gif' ? <RefreshCw size={28} /> : <Store size={28} />}
                    <strong>Nenhum visual selecionado</strong>
                    <small>Escolha uma opção acima para visualizar aqui.</small>
                  </div>
                )}

                {(previewCapa || previewGif) && (
                  <button type="button" className="config-pro__remover" onClick={removerVisualTopo}>
                    Remover
                  </button>
                )}
              </div>
            </div>

            <div className="modelos-accordion">
              <button
                type="button"
                className={`modelos-accordion__cabecalho ${modelosAbertos ? 'aberto' : ''}`}
                onClick={() => setModelosAbertos((valor) => !valor)}
              >
                <div>
                  <span>MODELOS VISUAIS</span>
                  <strong>
                    {form.modelo_visual === 'burger-house' ? 'Burger House' :
                     form.modelo_visual === 'gourmet' ? 'Gourmet' :
                     form.modelo_visual === 'fast-food' ? 'Fast Food' :
                     form.modelo_visual === 'night-food' ? 'Night Food' :
                     form.modelo_visual === 'clean-food' ? 'Clean Food' :
                     form.modelo_visual === 'marmitaria' ? 'Marmitaria & Frango' :
                     'Padrão KODVEXA'}
                  </strong>
                  <small>Escolha um modelo pronto ou volte ao visual original da KODVEXA.</small>
                </div>

                <div className="modelos-accordion__acao">
                  <b>{modelosAbertos ? 'Fechar' : 'Ver modelos'}</b>
                  <i>{modelosAbertos ? '−' : '+'}</i>
                </div>
              </button>

              {modelosAbertos && (
                <div className="modelos-accordion__conteudo">
                  <div className="modelos-accordion__aviso">
                    <div>
                      <strong>Modelos KODVEXA Food</strong>
                      <small>A escolha muda o visual imediatamente na prévia ao lado. Só será aplicada para os clientes depois de salvar.</small>
                    </div>

                    {form.modelo_visual !== 'kodvexa' && (
                      <button type="button" onClick={() => alterar('modelo_visual', 'kodvexa')}>
                        Voltar ao padrão KODVEXA
                      </button>
                    )}
                  </div>

                  <div className="modelos-food__grade">
                    {[
                      {
                        id: 'kodvexa',
                        nome: 'Padrão KODVEXA',
                        descricao: 'O visual oficial do Food. Equilibrado, moderno e pensado para funcionar em qualquer loja.',
                        tag: 'RECOMENDADO',
                        classe: 'food-mini kodvexa',
                      },
                      {
                        id: 'burger-house',
                        nome: 'Burger House',
                        descricao: 'Escuro, quente e forte para lanches, combos e hamburguerias.',
                        tag: 'MAIS IMPACTO',
                        classe: 'food-mini burger-house',
                      },
                      {
                        id: 'gourmet',
                        nome: 'Gourmet',
                        descricao: 'Elegante e claro para almoço, massas, carnes e restaurantes.',
                        tag: 'ELEGANTE',
                        classe: 'food-mini gourmet',
                      },
                      {
                        id: 'fast-food',
                        nome: 'Fast Food',
                        descricao: 'Claro, energético e comercial para vender rápido no mobile.',
                        tag: 'VENDE RÁPIDO',
                        classe: 'food-mini fast-food',
                      },
                      {
                        id: 'night-food',
                        nome: 'Night Food',
                        descricao: 'Grafite, vidro e luz para delivery noturno e combos.',
                        tag: 'NOTURNO',
                        classe: 'food-mini night-food',
                      },
                      {
                        id: 'clean-food',
                        nome: 'Clean Food',
                        descricao: 'Minimalista, leve e premium para destacar fotos e produtos.',
                        tag: 'CLEAN',
                        classe: 'food-mini clean-food',
                      },
                      {
                        id: 'marmitaria',
                        nome: 'Marmitaria & Frango',
                        descricao: 'Feito para marmitas, frango assado, almoço do dia e acompanhamentos.',
                        tag: 'ALMOÇO',
                        classe: 'food-mini marmitaria',
                      },
                    ].map((modelo) => (
                      <button
                        type="button"
                        key={modelo.id}
                        className={`food-modelo-card ${form.modelo_visual === modelo.id ? 'ativo' : ''}`}
                        onClick={() => alterar('modelo_visual', modelo.id)}
                      >
                        <div className={modelo.classe}>
                          <div className="food-mini__hero">
                            <i className="food-mini__logo" />
                            <div className="food-mini__nome" />
                            <div className="food-mini__status" />
                          </div>
                          <div className="food-mini__search" />
                          <div className="food-mini__cats"><i /><i /><i /></div>
                          <div className="food-mini__cards"><span /><span /></div>
                        </div>

                        <div className="food-modelo-card__info">
                          <div>
                            <strong>{modelo.nome}</strong>
                            <span>{modelo.tag}</span>
                          </div>
                          <small>{modelo.descricao}</small>
                        </div>

                        <div className="food-modelo-card__rodape">
                          <span>{form.modelo_visual === modelo.id ? 'Selecionado' : 'Usar este modelo'}</span>
                          <b>{form.modelo_visual === modelo.id ? '✓' : '→'}</b>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="config-pro__campos">
              <label>Nome da loja
                <input value={form.nome} onChange={(e) => alterar('nome', e.target.value)} />
              </label>

              <label>Descrição
                <textarea
                  value={form.descricao}
                  onChange={(e) => alterar('descricao', e.target.value)}
                  placeholder="Ex.: Hambúrgueres artesanais, porções e bebidas."
                />
              </label>
            </div>
          </section>
            )}

            {abaConfig === 'operacao' && (
          <section className="cartao-config operacao-config config-pro operacao-pro config-simples">
            <div className="titulo-bloco-config config-pro__titulo">
              <span>OPERAÇÃO</span>
              <h3>Entrega e funcionamento</h3>
              <p>Defina as informações que aparecem durante o pedido.</p>
            </div>

            <div className={`operacao-status-mestre ${form.aberto ? 'online' : 'pausado'}`}>
              <div className="operacao-status-mestre__info">
                <div className="operacao-status-mestre__icone">
                  {form.aberto ? <CheckCircle2 size={20} /> : <X size={20} />}
                </div>
                <div className="operacao-status-mestre__texto">
                  <small>STATUS DOS PEDIDOS</small>
                  <strong>{form.aberto ? 'Recebendo pedidos' : 'Pedidos pausados'}</strong>
                  <p>
                    {form.aberto
                      ? 'A unidade segue os horários cadastrados e recebe pedidos quando estiver dentro do expediente.'
                      : 'O cardápio continua visível, mas os clientes não conseguem adicionar itens nem fazer pedidos.'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="operacao-status-mestre__botao"
                disabled={alterandoStatusLoja}
                onClick={alternarRecebimentoPedidos}
              >
                {alterandoStatusLoja
                  ? 'Atualizando...'
                  : form.aberto
                    ? 'Pausar pedidos'
                    : 'Voltar a receber pedidos'}
              </button>
            </div>

            <div className="operacao-pro__grid">
              <label className="operacao-pro__campo">
                <span>Tempo médio</span>
                <div><input type="number" min="1" value={form.tempo_medio_min} onChange={(e) => alterar('tempo_medio_min', e.target.value)} /><b>min</b></div>
              </label>

              <label className="operacao-pro__campo">
                <span>Taxa base de entrega</span>
                <div><b>R$</b><input value={form.taxa_entrega_base} onChange={(e) => alterar('taxa_entrega_base', e.target.value)} inputMode="decimal" placeholder="0,00" /></div>
              </label>
            </div>
          </section>
            )}
          </div>

          <aside className="preview-config" style={{ '--preview-cor': form.cor_principal || '#0b5cff' }}>
            <div className="preview-config__topo">
              <div>
                <span>PRÉVIA AO VIVO</span>
                <strong>
                  {form.modelo_visual === 'burger-house' ? 'Burger House' :
                   form.modelo_visual === 'gourmet' ? 'Gourmet' :
                   form.modelo_visual === 'fast-food' ? 'Fast Food' :
                   form.modelo_visual === 'night-food' ? 'Night Food' :
                   form.modelo_visual === 'clean-food' ? 'Clean Food' :
                   form.modelo_visual === 'marmitaria' ? 'Marmitaria & Frango' :
                   'Padrão KODVEXA'}
                </strong>
              </div>
              <i />
            </div>
            <div className={`celular-preview preview-modelo-${form.modelo_visual || 'kodvexa'}`}>
              <div className="celular-preview__barra"><i /><i /><i /></div>
              <div
                className="celular-preview__capa"
                style={tipoVisual === 'capa' && previewCapa ? { backgroundImage: `url("${previewCapa}")` } : undefined}
              >
                {tipoVisual === 'gif' && previewGif && (
                  <img
                    src={previewGif}
                    alt=""
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                )}
                <div className="celular-preview__sombra" />
                <div className="celular-preview__loja">
                  <div className="celular-preview__logo">{previewLogo ? <img src={previewLogo} alt="" /> : <Store />}</div>
                  <div><span>{form.aberto ? 'ABERTO AGORA' : 'FECHADO'}</span><h3>{form.nome || 'Nome da loja'}</h3><p>{form.descricao || 'Descrição do estabelecimento'}</p></div>
                </div>
              </div>
              <div className="celular-preview__conteudo">
                <div className="preview-busca"><Search /><span>Buscar no cardápio</span></div>
                <div className="preview-categorias"><span>Lanches</span><span>Bebidas</span></div>
                <strong>Mais pedidos</strong>
                <div className="preview-produto"><div><b>Produto em destaque</b><span>Descrição do produto</span><strong>R$ 24,90</strong></div><ShoppingBag /></div>
                <div className="preview-produto"><div><b>Segundo produto</b><span>Descrição do produto</span><strong>R$ 19,90</strong></div><ShoppingBag /></div>
              </div>
            </div>
            <p>As alterações aparecem aqui antes de você salvar.</p>
          </aside>

          {erro && <p className="erro-pedido mensagem-config">{erro}</p>}
          {mensagem && <p className="sucesso-config mensagem-config">{mensagem}</p>}
          <div className="acoes-config"><button type="button" onClick={() => window.open(`/cardapio/${loja.slug}`, '_blank')}>Visualizar cardápio</button><button className="primario" disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar configurações'}</button></div>
        </form>
      </main>
    </div>
  )
}

function PainelRestaurante({ sessao }) {
  const [loja, setLoja] = useState(null)
  const [pedidos, setPedidos] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [filtro, setFiltro] = useState('novos')
  const [buscaPedidos, setBuscaPedidos] = useState('')
  const [pedidosChamando, setPedidosChamando] = useState([])
  const [alertasAtivos, setAlertasAtivos] = useState(() => localStorage.getItem('kodvexa_alertas_pedidos') === '1')
  const pedidosConhecidos = useRef(new Set())
  const pedidosInicializados = useRef(false)
  const audioAlertaRef = useRef(null)

  function obterAudioAlerta() {
    if (audioAlertaRef.current) return audioAlertaRef.current

    const audio = new Audio('data:audio/wav;base64,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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
    audio.preload = 'auto'
    audio.loop = true
    audio.volume = 1
    audioAlertaRef.current = audio
    return audio
  }

  async function garantirAudioLiberado() {
    try {
      const audio = obterAudioAlerta()
      audio.loop = false
      audio.currentTime = 0
      await audio.play()

      // Toca um teste curto no clique de ativação e deixa o navegador autorizar
      // futuras reproduções automáticas deste mesmo elemento de áudio.
      window.setTimeout(() => {
        if (!pedidosChamando.length) {
          audio.pause()
          audio.currentTime = 0
        }
        audio.loop = true
      }, 900)

      return true
    } catch (e) {
      console.warn('O navegador ainda não liberou o áudio:', e)
      return false
    }
  }

  async function iniciarSomContinuo() {
    try {
      const audio = obterAudioAlerta()
      audio.loop = true
      audio.volume = 1
      if (audio.paused) {
        audio.currentTime = 0
        await audio.play()
      }
      return true
    } catch (e) {
      console.warn('Não foi possível iniciar o som do novo pedido:', e)
      return false
    }
  }

  function pararSomContinuo() {
    const audio = audioAlertaRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
  }

  function notificarNovoPedido(pedido) {
    if ('Notification' in window && Notification.permission === 'granted') {
      const notificacao = new Notification(`Novo pedido #${pedido?.numero || ''}`, {
        body: `${pedido?.cliente_nome || 'Cliente'} · ${dinheiro(pedido?.total || 0)}`,
        tag: `pedido-${pedido?.id || Date.now()}`,
        requireInteraction: true,
      })
      notificacao.onclick = () => {
        window.focus()
        notificacao.close()
      }
    }
  }

  function registrarNovoPedido(pedido) {
    if (!pedido?.id) return
    let realmenteNovo = false
    setPedidosChamando((atuais) => {
      if (atuais.some((item) => item.id === pedido.id)) return atuais
      realmenteNovo = true
      return [pedido, ...atuais]
    })
    setFiltro('novos')
    if (realmenteNovo && localStorage.getItem('kodvexa_alertas_pedidos') === '1') {
      notificarNovoPedido(pedido)
    }
  }

  async function alternarAlertas() {
    if (alertasAtivos) {
      localStorage.setItem('kodvexa_alertas_pedidos', '0')
      setAlertasAtivos(false)
      return
    }

    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission()
    }

    const audioOk = await garantirAudioLiberado()
    localStorage.setItem('kodvexa_alertas_pedidos', '1')
    setAlertasAtivos(true)
  }

  async function carregarPedidos(estabelecimentoId, detectarNovos = false) {
    const { data, error } = await supabase
      .from('pedidos')
      .select('*, itens_pedido(*)')
      .eq('estabelecimento_id', estabelecimentoId)
      .order('criado_em', { ascending: false })
      .limit(100)

    if (error) {
      setErro(error.message)
      return
    }

    const lista = data || []

    if (detectarNovos && pedidosInicializados.current) {
      const novos = lista.filter((pedido) => !pedidosConhecidos.current.has(pedido.id))
      novos.slice().reverse().forEach(registrarNovoPedido)
    }

    pedidosConhecidos.current = new Set(lista.map((pedido) => pedido.id))
    pedidosInicializados.current = true
    setPedidos(lista)
  }

  useEffect(() => {
    if (localStorage.getItem('kodvexa_alertas_pedidos') !== '1') return

    // Após um F5 o navegador pode exigir uma interação nova para reautorizar áudio.
    // Qualquer clique/tecla no painel prepara novamente o mesmo elemento de áudio.
    const desbloquearNoPrimeiroClique = async () => {
      try {
        const audio = obterAudioAlerta()
        audio.loop = false
        audio.volume = 0.001
        await audio.play()
        audio.pause()
        audio.currentTime = 0
        audio.volume = 1
        audio.loop = true
      } catch {}
    }

    document.addEventListener('pointerdown', desbloquearNoPrimeiroClique, { once: true })
    document.addEventListener('keydown', desbloquearNoPrimeiroClique, { once: true })
    return () => {
      document.removeEventListener('pointerdown', desbloquearNoPrimeiroClique)
      document.removeEventListener('keydown', desbloquearNoPrimeiroClique)
    }
  }, [])

  useEffect(() => {
    if (!alertasAtivos || !pedidosChamando.length) {
      pararSomContinuo()
      return
    }

    // Começa no mesmo instante em que o primeiro pedido novo entra.
    // O mesmo áudio fica em loop até todos os pedidos novos serem aceitos.
    iniciarSomContinuo()

    const garantirReproducao = () => {
      if (pedidosChamando.length && alertasAtivos && audioAlertaRef.current?.paused) {
        iniciarSomContinuo()
      }
    }

    document.addEventListener('visibilitychange', garantirReproducao)
    window.addEventListener('focus', garantirReproducao)

    return () => {
      document.removeEventListener('visibilitychange', garantirReproducao)
      window.removeEventListener('focus', garantirReproducao)
      if (pedidosChamando.length <= 1) pararSomContinuo()
    }
  }, [pedidosChamando.length, alertasAtivos])

  useEffect(() => {
    let canal
    let intervalo
    let cancelado = false

    async function carregarPainel() {
      let contexto
      try {
        contexto = await obterUnidadeAtualCompleta()
      } catch (e) {
        setErro(e.message || 'Não foi possível carregar a unidade.')
        setCarregando(false)
        return
      }

      if (!contexto?.estabelecimento) {
        setErro('Este usuário ainda não está vinculado a um estabelecimento.')
        setCarregando(false)
        return
      }

      const estabelecimentoId = contexto.estabelecimento.id
      if (cancelado) return

      // Cada unidade precisa ter seu próprio ponto de partida para detectar pedidos novos.
      pedidosConhecidos.current = new Set()
      pedidosInicializados.current = false
      setPedidosChamando([])
      pararSomContinuo()

      setLoja(contexto.estabelecimento)
      await carregarPedidos(estabelecimentoId, false)

      canal = supabase
        .channel(`pedidos-${estabelecimentoId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'pedidos', filter: `estabelecimento_id=eq.${estabelecimentoId}` },
          (payload) => {
            if (payload.eventType === 'INSERT') registrarNovoPedido(payload.new)
            carregarPedidos(estabelecimentoId, false)
          }
        )
        .subscribe()

      // Plano B confiável: consulta pedidos a cada 3 segundos.
      // Assim o painel atualiza mesmo se o Realtime do Supabase não estiver habilitado para a tabela.
      intervalo = window.setInterval(() => {
        carregarPedidos(estabelecimentoId, true)
      }, 3000)

      setCarregando(false)
    }

    carregarPainel()
    return () => {
      cancelado = true
      if (intervalo) window.clearInterval(intervalo)
      if (canal) supabase.removeChannel(canal)
    }
  }, [sessao.user.id])

  function abrirPedidoChamando(id = pedidosChamando[0]?.id) {
    setFiltro('ativos')
    if (!id) return
    setTimeout(() => {
      document.getElementById(`pedido-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
  }

  async function enviarAvisoWhatsApp(pedido, evento) {
    try {
      const resposta = await fetch('/api/whatsapp-pedido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evento,
          pedido_id: pedido.id,
          numero: pedido.numero,
          cliente_nome: pedido.cliente_nome,
          cliente_telefone: pedido.cliente_telefone,
          total: Number(pedido.total || 0),
          tipo_entrega: pedido.tipo_entrega,
          endereco_entrega: pedido.endereco_entrega || ''
        })
      })

      const dados = await resposta.json().catch(() => ({}))
      if (!resposta.ok) {
        throw new Error(dados?.error || 'Não foi possível enviar o WhatsApp.')
      }
      return true
    } catch (e) {
      console.warn('Aviso WhatsApp não enviado:', e)
      return false
    }
  }

  async function mudarStatus(pedido, status) {
    if (!loja?.id || !pedido?.id) return

    const anterior = pedidos
    setPedidos((lista) =>
      lista.map((item) => item.id === pedido.id ? { ...item, status } : item)
    )

    const { error } = await supabase.rpc('atualizar_status_pedido_equipe', {
      p_pedido_id: pedido.id,
      p_estabelecimento_id: loja.id,
      p_status: status,
    })

    if (error) {
      setPedidos(anterior)
      setErro(error.message || 'Não foi possível atualizar o pedido.')
      return
    }

    // O alerta para quando o pedido sai de "recebido".
    if (status !== 'recebido') {
      setPedidosChamando((atuais) =>
        atuais.filter((item) => item.id !== pedido.id)
      )
    }

    // Ao sair para entrega, o cliente recebe automaticamente o aviso pelo WhatsApp.
    if (status === 'saiu_entrega' && pedido.tipo_entrega === 'entrega') {
      const enviado = await enviarAvisoWhatsApp(pedido, 'saiu_entrega')
      if (!enviado) {
        setErro(
          'O pedido saiu para entrega, mas o aviso do WhatsApp não foi enviado. Confira a configuração da API.'
        )
      }
    }
  }


  function formatarDataPedido(data) {
    if (!data) return 'Horário não informado'
    const d = new Date(data)
    if (Number.isNaN(d.getTime())) return 'Horário não informado'
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(d)
  }

  function imprimirPedido(pedido) {
    const itens = (pedido.itens_pedido || []).map((item) => `
      <tr>
        <td>${item.quantidade}x ${item.produto_nome}</td>
        <td style="text-align:right">${dinheiro(item.total)}</td>
      </tr>`).join('')

    const subtotalItens = (pedido.itens_pedido || []).reduce((soma, item) => soma + Number(item.total || 0), 0)
    const taxaEntrega = Number(pedido.taxa_entrega || Math.max(0, Number(pedido.total || 0) - subtotalItens))
    const janela = window.open('', '_blank', 'width=420,height=720')
    if (!janela) return

    janela.document.write(`<!doctype html>
      <html><head><meta charset="utf-8"><title>Pedido #${pedido.numero}</title>
      <style>
        body{font-family:Arial,sans-serif;color:#111;margin:0;padding:18px;width:320px}h1,h2,p{margin:0}.centro{text-align:center}.linha{border-top:1px dashed #777;margin:12px 0}.meta{font-size:12px;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:4px 0;vertical-align:top}.total{font-size:18px;font-weight:700}.bloco{font-size:12px;line-height:1.45}.acao{margin-top:16px;width:100%;padding:10px}@media print{.acao{display:none}body{padding:0}}
      </style></head><body>
      <div class="centro"><h2>${loja?.nome || 'KODVEXA FOOD'}</h2><p class="meta">Pedido #${pedido.numero}</p><p class="meta">${formatarDataPedido(pedido.criado_em)}</p></div>
      <div class="linha"></div>
      <div class="bloco"><b>Cliente:</b> ${pedido.cliente_nome || ''}<br><b>Telefone:</b> ${pedido.cliente_telefone || ''}</div>
      <div class="linha"></div>
      <table>${itens}</table>
      <div class="linha"></div>
      ${pedido.tipo_entrega === 'entrega' ? `<div class="bloco"><b>Entrega:</b> ${pedido.endereco_entrega || ''}${pedido.complemento ? `<br><b>Complemento:</b> ${pedido.complemento}` : ''}${pedido.referencia ? `<br><b>Referência:</b> ${pedido.referencia}` : ''}<br><b>Taxa:</b> ${dinheiro(taxaEntrega)}</div>` : '<div class="bloco"><b>Retirada no local</b></div>'}
      <div class="linha"></div>
      <div class="bloco"><b>Pagamento:</b> ${(pedido.forma_pagamento || '').replaceAll('_',' ')}${pedido.troco_para ? `<br><b>Troco para:</b> ${pedido.troco_para}` : ''}${pedido.observacao ? `<br><b>Observação:</b> ${pedido.observacao}` : ''}</div>
      <div class="linha"></div>
      <table><tr><td>Produtos</td><td style="text-align:right">${dinheiro(subtotalItens)}</td></tr>${pedido.tipo_entrega === 'entrega' ? `<tr><td>Entrega</td><td style="text-align:right">${dinheiro(taxaEntrega)}</td></tr>` : ''}<tr><td class="total">TOTAL</td><td class="total" style="text-align:right">${dinheiro(pedido.total)}</td></tr></table>
      <button class="acao" onclick="window.print()">Imprimir pedido</button>
      </body></html>`)
    janela.document.close()
  }

  const abasFluxo = [
    { id: 'novos', titulo: 'Novos', status: ['recebido'] },
    { id: 'confirmados', titulo: 'Confirmados', status: ['confirmado'] },
    { id: 'preparo', titulo: 'Em preparo', status: ['preparando'] },
    { id: 'prontos', titulo: 'Prontos', status: ['pronto'] },
    { id: 'entrega', titulo: 'Saiu para entrega', status: ['saiu_entrega'] },
    { id: 'finalizados', titulo: 'Finalizados', status: ['concluido', 'cancelado'] },
  ]

  const abaAtual = abasFluxo.find((aba) => aba.id === filtro) || abasFluxo[0]
  const termoBuscaPedidos = buscaPedidos.trim().toLowerCase()
  const exibidos = pedidos.filter((pedido) => {
    if (!abaAtual.status.includes(pedido.status)) return false
    if (!termoBuscaPedidos) return true
    const textoPedido = `${pedido.numero || ''} ${pedido.cliente_nome || ''} ${pedido.cliente_telefone || ''}`.toLowerCase()
    return textoPedido.includes(termoBuscaPedidos)
  })
  const exibidosOrdenados = filtro === 'prontos'
    ? [...exibidos].sort((a, b) => {
        const tipoA = a.tipo_entrega === 'entrega' ? 0 : 1
        const tipoB = b.tipo_entrega === 'entrega' ? 0 : 1
        if (tipoA !== tipoB) return tipoA - tipoB
        return new Date(a.criado_em || 0) - new Date(b.criado_em || 0)
      })
    : exibidos
  const prontosEntrega = filtro === 'prontos' ? exibidos.filter((pedido) => pedido.tipo_entrega === 'entrega').length : 0
  const prontosRetirada = filtro === 'prontos' ? exibidos.filter((pedido) => pedido.tipo_entrega !== 'entrega').length : 0
  const quantidadeAba = (aba) => pedidos.filter((pedido) => aba.status.includes(pedido.status)).length

  const hoje = new Date()
  const chaveHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`
  const pedidosHoje = pedidos.filter((pedido) => {
    if (!pedido.criado_em || pedido.status === 'cancelado') return false
    const data = new Date(pedido.criado_em)
    if (Number.isNaN(data.getTime())) return false
    const chavePedido = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
    return chavePedido === chaveHoje
  })
  const faturamentoHoje = pedidosHoje.reduce((soma, pedido) => soma + Number(pedido.total || 0), 0)
  const entregasHoje = pedidosHoje.filter((pedido) => pedido.tipo_entrega === 'entrega').length
  const retiradasHoje = pedidosHoje.filter((pedido) => pedido.tipo_entrega !== 'entrega').length
  const ticketMedioHoje = pedidosHoje.length ? faturamentoHoje / pedidosHoje.length : 0

  if (carregando) return <TelaCentral texto="Abrindo painel..." />

  return (
    <div className="painel-food">
      <NavegacaoPainel loja={loja} ativo="pedidos" />
      <main className="conteudo-painel">
        {pedidosChamando.length > 0 && (
          <>
            <style>{`
              @keyframes kodvexaPedidoLed {
                0%, 100% { border-color: rgba(239,68,68,.42); box-shadow: 0 0 0 1px rgba(239,68,68,.08), 0 12px 32px rgba(0,0,0,.18); }
                50% { border-color: rgba(255,70,82,1); box-shadow: 0 0 0 2px rgba(239,68,68,.32), 0 0 24px rgba(239,68,68,.30), 0 16px 38px rgba(0,0,0,.25); }
              }
              @keyframes kodvexaAlertaRespira {
                0%, 100% { box-shadow: 0 18px 55px rgba(0,0,0,.42), 0 0 0 1px rgba(239,68,68,.16); }
                50% { box-shadow: 0 18px 55px rgba(0,0,0,.48), 0 0 28px rgba(239,68,68,.24); }
              }
            `}</style>
            <div
              role="alert"
              style={{
                position: 'sticky', top: 12, zIndex: 9999, margin: '0 auto 18px',
                width: 'min(760px, calc(100% - 8px))', borderRadius: 16, padding: '14px 16px',
                background: 'linear-gradient(135deg, rgba(25,19,25,.98), rgba(14,27,44,.98))', color: '#fff',
                border: '1px solid rgba(239,68,68,.55)', animation: 'kodvexaAlertaRespira 1.7s ease-in-out infinite',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div style={{ width: 44, height: 44, borderRadius: 13, background: 'rgba(239,68,68,.10)', color: '#ff6670', border: '1px solid rgba(239,68,68,.34)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                  <Bell size={23} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.1, opacity: .9 }}>
                    {pedidosChamando.length === 1 ? 'NOVO PEDIDO AGUARDANDO' : `${pedidosChamando.length} NOVOS PEDIDOS AGUARDANDO`}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 950, lineHeight: 1.15 }}>
                    {pedidosChamando.length === 1 ? `Pedido #${pedidosChamando[0]?.numero || ''}` : 'Há pedidos novos para confirmar'}
                  </div>
                  <div style={{ marginTop: 3, opacity: .78, fontSize: 13 }}>
                    O alerta termina somente quando todos os pedidos novos forem confirmados.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => abrirPedidoChamando()}
                style={{ border: '1px solid rgba(239,68,68,.45)', borderRadius: 10, padding: '10px 14px', background: 'rgba(239,68,68,.14)', color: '#fff', fontWeight: 900, cursor: 'pointer', flex: '0 0 auto' }}
              >
                VER {pedidosChamando.length > 1 ? 'PEDIDOS' : 'PEDIDO'}
              </button>
            </div>
          </>
        )}

        <section className="resumo-painel resumo-painel-operacional">
          <div><Clock3 /><span>Novos</span><strong>{pedidos.filter((p) => p.status === 'recebido').length}</strong></div>
          <div><ChefHat /><span>Em preparo</span><strong>{pedidos.filter((p) => ['confirmado', 'preparando'].includes(p.status)).length}</strong></div>
          <div><CheckCircle2 /><span>Prontos</span><strong>{pedidos.filter((p) => p.status === 'pronto').length}</strong></div>
          <div><Bike /><span>Saiu para entrega</span><strong>{pedidos.filter((p) => p.status === 'saiu_entrega').length}</strong></div>
        </section>

        <div className="cabecalho-lista">
          <div><h2>Pedidos</h2><p>Atualização automática dos pedidos recebidos.</p></div>
          <div className="acoes-pedidos-topo">
            <label className="busca-pedidos">
              <Search size={17} />
              <input
                value={buscaPedidos}
                onChange={(e) => setBuscaPedidos(e.target.value)}
                placeholder="Buscar pedido, cliente ou telefone"
              />
              {buscaPedidos && (
                <button type="button" onClick={() => setBuscaPedidos('')} aria-label="Limpar busca"><X size={15} /></button>
              )}
            </label>
            <button
              type="button"
              onClick={alternarAlertas}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '9px 12px', borderRadius: 10,
                border: alertasAtivos ? '1px solid rgba(34,197,94,.45)' : '1px solid rgba(148,163,184,.25)',
                background: alertasAtivos ? 'rgba(34,197,94,.12)' : 'rgba(15,34,58,.75)',
                color: 'inherit', cursor: 'pointer', fontWeight: 800
              }}
              title="Tocar som e mostrar notificação quando entrar pedido novo"
            >
              <Bell size={16} /> {alertasAtivos ? 'Alertas ligados' : 'Ativar alertas'}
            </button>
          </div>
        </div>

        <div style={{
          display: 'flex', gap: 8, overflowX: 'auto', padding: '4px 2px 12px', marginBottom: 8,
          scrollbarWidth: 'thin'
        }}>
          {abasFluxo.map((aba) => {
            const ativa = filtro === aba.id
            const qtd = quantidadeAba(aba)
            return (
              <button
                type="button"
                key={aba.id}
                onClick={() => setFiltro(aba.id)}
                style={{
                  minHeight: 46, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 9,
                  padding: '10px 14px', borderRadius: 12, cursor: 'pointer', fontWeight: 850,
                  border: ativa ? '1px solid rgba(96,165,250,.62)' : '1px solid rgba(148,163,184,.18)',
                  background: ativa ? 'rgba(37,99,235,.16)' : 'rgba(15,34,58,.56)',
                  color: 'inherit', boxShadow: ativa ? 'inset 0 0 0 1px rgba(59,130,246,.08)' : 'none'
                }}
              >
                <span>{aba.titulo}</span>
                <span style={{
                  minWidth: 24, height: 24, padding: '0 7px', borderRadius: 999, display: 'grid', placeItems: 'center',
                  fontSize: 12, fontWeight: 950,
                  background: ativa ? 'rgba(59,130,246,.26)' : 'rgba(148,163,184,.12)',
                  border: '1px solid rgba(148,163,184,.16)'
                }}>{qtd}</span>
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, margin: '2px 2px 14px' }}>
          <div>
            <strong style={{ fontSize: 15 }}>{abaAtual.titulo}</strong>
            <span style={{ marginLeft: 8, opacity: .58, fontSize: 13 }}>Cada pedido avança para a próxima aba conforme o status.</span>
          </div>
          <small style={{ opacity: .58 }}>{exibidos.length} {exibidos.length === 1 ? 'pedido' : 'pedidos'}</small>
        </div>
        {erro && <p className="erro-pedido">{erro}</p>}
        <section className="grade-pedidos">
          {exibidosOrdenados.map((pedido, index) => {
            const subtotalItens = (pedido.itens_pedido || []).reduce((soma, item) => soma + Number(item.total || 0), 0)
            const taxaEntrega = Number(pedido.taxa_entrega || Math.max(0, Number(pedido.total || 0) - subtotalItens))
            const distancia = Number(pedido.distancia_entrega_km || 0)
            const enderecoMaps = pedido.endereco_entrega ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pedido.endereco_entrega)}` : ''
            const grupoAtual = pedido.tipo_entrega === 'entrega' ? 'entrega' : 'retirada'
            const grupoAnterior = index > 0 ? (exibidosOrdenados[index - 1].tipo_entrega === 'entrega' ? 'entrega' : 'retirada') : null
            const mostrarCabecalhoGrupo = filtro === 'prontos' && grupoAtual !== grupoAnterior

            return (
              <div key={pedido.id} style={{ display: 'contents' }}>
                {mostrarCabecalhoGrupo && (
                  <div style={{
                    gridColumn: '1 / -1', marginTop: index === 0 ? 0 : 16, padding: '14px 16px',
                    borderRadius: 14, border: grupoAtual === 'entrega' ? '1px solid rgba(96,165,250,.30)' : '1px solid rgba(74,222,128,.26)',
                    background: grupoAtual === 'entrega' ? 'linear-gradient(135deg, rgba(37,99,235,.12), rgba(15,34,58,.82))' : 'linear-gradient(135deg, rgba(34,197,94,.10), rgba(15,34,58,.82))',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center',
                        background: grupoAtual === 'entrega' ? 'rgba(59,130,246,.15)' : 'rgba(34,197,94,.13)'
                      }}>
                        {grupoAtual === 'entrega' ? <Bike size={20} /> : <Store size={20} />}
                      </div>
                      <div>
                        <strong style={{ display: 'block', fontSize: 15 }}>
                          {grupoAtual === 'entrega' ? 'Aguardando motoboy' : 'Aguardando retirada'}
                        </strong>
                        <small style={{ opacity: .62 }}>
                          {grupoAtual === 'entrega' ? 'Pedidos prontos esperando sair para entrega.' : 'Pedidos prontos esperando o cliente retirar.'}
                        </small>
                      </div>
                    </div>
                    <span style={{
                      minWidth: 34, height: 28, padding: '0 10px', borderRadius: 999, display: 'grid', placeItems: 'center',
                      fontSize: 12, fontWeight: 950, background: 'rgba(148,163,184,.12)', border: '1px solid rgba(148,163,184,.16)'
                    }}>
                      {grupoAtual === 'entrega' ? prontosEntrega : prontosRetirada}
                    </span>
                  </div>
                )}
              <article
                id={`pedido-${pedido.id}`}
                className="cartao-pedido"
                style={pedidosChamando.some((novo) => novo.id === pedido.id)
                  ? { border: '1px solid rgba(239,68,68,.65)', background: 'linear-gradient(180deg, rgba(39,31,45,.98), rgba(12,29,51,.98))', animation: 'kodvexaPedidoLed 1.05s ease-in-out infinite' }
                  : pedido.status === 'recebido'
                    ? { border: '1px solid rgba(59,130,246,.55)', background: 'linear-gradient(180deg, rgba(20,42,72,.96), rgba(12,29,51,.96))' }
                    : undefined}
              >
                <div className="pedido-topo">
                  <div>
                    <span>Pedido</span>
                    <h3>#{pedido.numero}</h3>
                    <small style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, opacity: .72 }}><Clock3 size={13} /> {formatarDataPedido(pedido.criado_em)}</small>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {pedido.status === 'recebido' && <span style={{ fontSize: 11, fontWeight: 800, padding: '5px 8px', borderRadius: 999, background: 'rgba(37,99,235,.18)', border: '1px solid rgba(96,165,250,.35)' }}>NOVO</span>}
                    <b className={`status-pedido ${pedido.status}`}>{etapasPedido.find(([id]) => id === pedido.status)?.[1] || pedido.status}</b>
                  </div>
                </div>

                <div className="cliente-pedido">
                  <strong>{pedido.cliente_nome}</strong>
                  <span>{pedido.cliente_telefone}</span>
                </div>

                {pedido.status === 'pronto' && (
                  <div style={{
                    marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 7,
                    padding: '7px 10px', borderRadius: 999, fontSize: 12, fontWeight: 900,
                    background: pedido.tipo_entrega === 'entrega' ? 'rgba(59,130,246,.14)' : 'rgba(34,197,94,.12)',
                    border: pedido.tipo_entrega === 'entrega' ? '1px solid rgba(96,165,250,.28)' : '1px solid rgba(74,222,128,.24)'
                  }}>
                    {pedido.tipo_entrega === 'entrega' ? <Bike size={15} /> : <Store size={15} />}
                    {pedido.tipo_entrega === 'entrega' ? 'Aguardando saída do entregador' : 'Aguardando retirada do cliente'}
                  </div>
                )}

                <div className="lista-itens">
                  {pedido.itens_pedido?.map((item) => (
                    <div key={item.id}>
                      <span><b>{item.quantidade}×</b> {item.produto_nome}</span>
                      <strong>{dinheiro(item.total)}</strong>
                    </div>
                  ))}
                </div>

                {pedido.tipo_entrega === 'entrega' ? (
                  <div style={{ marginTop: 12, border: '1px solid rgba(96,165,250,.22)', borderRadius: 14, padding: 13, background: 'rgba(8,23,43,.42)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <MapPin size={19} style={{ flex: '0 0 auto', marginTop: 2 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <strong style={{ display: 'block', marginBottom: 4 }}>Entrega</strong>
                        <span style={{ display: 'block', lineHeight: 1.45, opacity: .88 }}>{pedido.endereco_entrega || 'Endereço não informado'}</span>
                        {pedido.complemento && <small style={{ display: 'block', marginTop: 5, opacity: .72 }}>Complemento: {pedido.complemento}</small>}
                        {pedido.referencia && <small style={{ display: 'block', marginTop: 3, opacity: .72 }}>Referência: {pedido.referencia}</small>}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: distancia > 0 ? '1fr 1fr' : '1fr', gap: 8, marginTop: 12 }}>
                      <div style={{ padding: '9px 10px', borderRadius: 10, background: 'rgba(37,99,235,.10)' }}>
                        <small style={{ display: 'block', opacity: .7 }}>Taxa de entrega</small>
                        <strong>{dinheiro(taxaEntrega)}</strong>
                      </div>
                      {distancia > 0 && (
                        <div style={{ padding: '9px 10px', borderRadius: 10, background: 'rgba(37,99,235,.10)' }}>
                          <small style={{ display: 'block', opacity: .7 }}>Distância da rota</small>
                          <strong>{distancia.toFixed(2).replace('.', ',')} km</strong>
                        </div>
                      )}
                    </div>

                  </div>
                ) : (
                  <div className="detalhes-pedido"><p><b>Retirada no local</b></p></div>
                )}

                <div className="detalhes-pedido" style={{ marginTop: 11 }}>
                  <p><b>Pagamento:</b> {pedido.forma_pagamento?.replaceAll('_', ' ')}</p>
                  {pedido.troco_para && <p><b>Troco para:</b> {pedido.troco_para}</p>}
                  {pedido.observacao && <p><b>Observação:</b> {pedido.observacao}</p>}
                </div>

                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(148,163,184,.18)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6, opacity: .75 }}>
                    <span>Produtos</span><span>{dinheiro(subtotalItens)}</span>
                  </div>
                  {pedido.tipo_entrega === 'entrega' && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8, opacity: .75 }}>
                      <span>Entrega</span><span>{dinheiro(taxaEntrega)}</span>
                    </div>
                  )}
                  <div className="total-pedido" style={{ marginTop: 0 }}>
                    <span>Total do pedido</span><strong>{dinheiro(pedido.total)}</strong>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: pedido.tipo_entrega === 'entrega' && enderecoMaps ? '1fr 1fr' : '1fr', gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => imprimirPedido(pedido)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(148,163,184,.25)', background: 'rgba(15,34,58,.75)', color: 'inherit', cursor: 'pointer', fontWeight: 700 }}
                  >
                    <Printer size={16} /> Imprimir pedido
                  </button>
                  {pedido.tipo_entrega === 'entrega' && enderecoMaps && (
                    <button
                      type="button"
                      onClick={() => window.open(enderecoMaps, '_blank')}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(96,165,250,.28)', background: 'rgba(37,99,235,.10)', color: 'inherit', cursor: 'pointer', fontWeight: 700 }}
                    >
                      <Navigation size={16} /> Abrir rota
                    </button>
                  )}
                </div>

                {!['concluido', 'cancelado'].includes(pedido.status) && (() => {
                  const proximaEtapa = pedido.status === 'recebido'
                    ? { status: 'confirmado', texto: 'Confirmar pedido', icone: <CheckCircle2 size={19} /> }
                    : pedido.status === 'confirmado'
                      ? { status: 'preparando', texto: 'Iniciar preparo', icone: <ChefHat size={19} /> }
                      : pedido.status === 'preparando'
                        ? { status: 'pronto', texto: 'Marcar como pronto', icone: <CheckCircle2 size={19} /> }
                        : pedido.status === 'pronto'
                          ? pedido.tipo_entrega === 'entrega'
                            ? { status: 'saiu_entrega', texto: 'Saiu para entrega', icone: <Bike size={19} /> }
                            : { status: 'concluido', texto: 'Concluir retirada', icone: <CheckCircle2 size={19} /> }
                          : pedido.status === 'saiu_entrega'
                            ? { status: 'concluido', texto: 'Concluir entrega', icone: <CheckCircle2 size={19} /> }
                            : null

                  return (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(148,163,184,.18)' }}>
                      <small style={{ display: 'block', marginBottom: 8, opacity: .65, fontWeight: 800, letterSpacing: '.04em' }}>ATUALIZAR PEDIDO</small>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8 }}>
                        {proximaEtapa && (
                          <button
                            type="button"
                            onClick={() => mudarStatus(pedido, proximaEtapa.status)}
                            style={{
                              minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                              border: 0, borderRadius: 12, padding: '11px 16px', cursor: 'pointer',
                              background: '#1769ff', color: '#fff', fontWeight: 900, fontSize: 15,
                              boxShadow: '0 8px 22px rgba(23,105,255,.22)'
                            }}
                          >
                            {proximaEtapa.icone} {proximaEtapa.texto}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Cancelar o pedido #${pedido.numero}?`)) mudarStatus(pedido, 'cancelado')
                          }}
                          style={{
                            minHeight: 48, borderRadius: 12, padding: '11px 14px', cursor: 'pointer',
                            border: '1px solid rgba(248,113,113,.35)', background: 'rgba(127,29,29,.12)',
                            color: '#fca5a5', fontWeight: 800
                          }}
                        >
                          Cancelar
                        </button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 9, opacity: .65, fontSize: 12 }}>
                        <span>Status atual:</span>
                        <strong>{etapasPedido.find(([id]) => id === pedido.status)?.[1] || pedido.status}</strong>
                      </div>
                    </div>
                  )
                })()}
              </article>
              </div>
            )
          })}
          {!exibidosOrdenados.length && <div className="sem-pedidos"><ShoppingBag /><h3>{buscaPedidos ? 'Nenhum pedido encontrado' : 'Nenhum pedido aqui'}</h3><p>{buscaPedidos ? 'Tente buscar por outro número, nome ou telefone.' : 'Os novos pedidos aparecerão automaticamente.'}</p></div>}
        </section>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Inicio />} />
        <Route path="/cardapio/:slug" element={<Cardapio />} />
        <Route path="/painel/convite" element={<ConviteEquipe />} />
        <Route path="/painel/cadastro" element={<CadastroFuncionario />} />
        <Route path="/painel" element={<LoginPainel />} />
        <Route path="/painel/cardapio" element={<LoginPainel pagina="cardapio" />} />
        <Route path="/painel/entregas" element={<LoginPainel pagina="entregas" />} />
        <Route path="/painel/configuracoes" element={<LoginPainel pagina="configuracoes" />} />
        <Route path="/painel/unidades" element={<LoginPainel pagina="unidades" />} />
        <Route path="/painel/equipe" element={<LoginPainel pagina="equipe" />} />
        <Route path="*" element={<TelaCentral texto="Página não encontrada." erro />} />
      </Routes>
    </BrowserRouter>
  )
}
