import { useEffect, useMemo, useRef, useState } from 'react'
import { BrowserRouter, Link, Route, Routes, useParams } from 'react-router-dom'
import { Bell, Bike, CheckCircle2, ChefHat, ChevronRight, Clock3, LogOut, MapPin, Minus, Navigation, Plus, Printer, RefreshCw, Search, ShoppingBag, Store, X } from 'lucide-react'
import { supabase } from './supabase'
import './App.css'

const dinheiro = (valor) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0)

const GEOAPIFY_API_KEY = import.meta.env.VITE_GEOAPIFY_API_KEY

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

function Cardapio() {
  const { slug } = useParams()
  const [loja, setLoja] = useState(null)
  const [categorias, setCategorias] = useState([])
  const [produtos, setProdutos] = useState([])
  const [busca, setBusca] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [produtoAberto, setProdutoAberto] = useState(null)
  const [quantidade, setQuantidade] = useState(1)
  const [carrinho, setCarrinho] = useState([])
  const [carrinhoAberto, setCarrinhoAberto] = useState(false)
  const [checkoutAberto, setCheckoutAberto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erroPedido, setErroPedido] = useState('')
  const [pedidoCriado, setPedidoCriado] = useState(null)
  const [calculandoEntrega, setCalculandoEntrega] = useState(false)
  const [entregaCalculada, setEntregaCalculada] = useState(null)
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
            .eq('disponivel', true)
            .order('ordem'),
        ])

      if (erroCategorias || erroProdutos) {
        setErro('Não foi possível carregar os produtos agora.')
      } else {
        setLoja(estabelecimento)
        setCategorias(dadosCategorias || [])
        setProdutos(dadosProdutos || [])
      }

      setCarregando(false)
    }

    carregar()
  }, [slug])

  const produtosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return produtos
    return produtos.filter((produto) =>
      `${produto.nome} ${produto.descricao || ''}`.toLowerCase().includes(termo),
    )
  }, [busca, produtos])

  const totalItens = carrinho.reduce((soma, item) => soma + item.quantidade, 0)
  const total = carrinho.reduce((soma, item) => soma + item.preco * item.quantidade, 0)

  function abrirProduto(produto) {
    setProdutoAberto(produto)
    setQuantidade(1)
  }

  function adicionarAoCarrinho() {
    setCarrinho((atual) => {
      const existente = atual.find((item) => item.id === produtoAberto.id)
      if (existente) {
        return atual.map((item) =>
          item.id === produtoAberto.id
            ? { ...item, quantidade: item.quantidade + quantidade }
            : item,
        )
      }
      return [...atual, { ...produtoAberto, quantidade, preco: Number(produtoAberto.preco_promocional || produtoAberto.preco) }]
    })
    setProdutoAberto(null)
  }

  function alterarItem(id, diferenca) {
    setCarrinho((atual) =>
      atual
        .map((item) =>
          item.id === id ? { ...item, quantidade: item.quantidade + diferenca } : item,
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
        observacao: formulario.observacao,
        itens: carrinho.map((item) => ({ produto_id: item.id, quantidade: item.quantidade })),
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
      className={`app ${loja.fundo_gif_url ? 'com-gif' : ''}`}
      style={{
        '--cor-loja': loja.cor_principal || '#0b5cff',
        '--fundo-gif': loja.fundo_gif_url ? `url("${loja.fundo_gif_url}")` : 'none',
      }}
    >
      <header className={`hero ${loja.capa_url ? 'com-capa' : ''}`} style={loja.capa_url ? { backgroundImage: `url("${loja.capa_url}")` } : undefined}>
        <div className="hero__overlay" />
        <div className="hero__content limite">
          <div className="logo-loja">
            {loja.logo_url ? <img src={loja.logo_url} alt={loja.nome} /> : <Store size={34} />}
          </div>
          <div>
            <span className={`status ${loja.aberto ? 'aberto' : 'fechado'}`}>
              {loja.aberto ? 'Aberto agora' : 'Fechado'}
            </span>
            <h1>{loja.nome}</h1>
            <p>{loja.descricao}</p>
            <small>Entrega em aproximadamente {loja.tempo_medio_min} min</small>
          </div>
        </div>
      </header>

      <main className="limite conteudo">
        <div className="busca">
          <Search size={20} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no cardápio" />
        </div>

        <nav className="categorias">
          {categorias.map((categoria) => (
            <a key={categoria.id} href={`#categoria-${categoria.id}`}>{categoria.nome}</a>
          ))}
        </nav>

        {categorias.map((categoria) => {
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
                  <button className="produto" key={produto.id} onClick={() => abrirProduto(produto)}>
                    <div className="produto__texto">
                      {produto.destaque && <strong className="destaque">Mais pedido</strong>}
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

      {totalItens > 0 && (
        <button className="barra-carrinho" onClick={() => setCarrinhoAberto(true)}>
          <span className="bolha">{totalItens}</span>
          <strong>Ver carrinho</strong>
          <b>{dinheiro(total)}</b>
        </button>
      )}

      {produtoAberto && (
        <div className="modal-fundo" onMouseDown={() => setProdutoAberto(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <button className="fechar" onClick={() => setProdutoAberto(null)}><X /></button>
            <div className="modal__icone"><ShoppingBag size={42} /></div>
            <h2>{produtoAberto.nome}</h2>
            <p>{produtoAberto.descricao}</p>
            <h3>{dinheiro(produtoAberto.preco_promocional || produtoAberto.preco)}</h3>
            <div className="modal__rodape">
              <div className="quantidade">
                <button onClick={() => setQuantidade((q) => Math.max(1, q - 1))}><Minus /></button>
                <b>{quantidade}</b>
                <button onClick={() => setQuantidade((q) => q + 1)}><Plus /></button>
              </div>
              <button className="primario" onClick={adicionarAoCarrinho}>
                Adicionar · {dinheiro(Number(produtoAberto.preco_promocional || produtoAberto.preco) * quantidade)}
              </button>
            </div>
          </div>
        </div>
      )}

      {carrinhoAberto && (
        <div className="modal-fundo" onMouseDown={() => setCarrinhoAberto(false)}>
          <aside className="carrinho" onMouseDown={(e) => e.stopPropagation()}>
            <div className="carrinho__cabecalho"><h2>Seu carrinho</h2><button onClick={() => setCarrinhoAberto(false)}><X /></button></div>
            <div className="carrinho__itens">
              {carrinho.map((item) => (
                <div className="item-carrinho" key={item.id}>
                  <div><strong>{item.nome}</strong><span>{dinheiro(item.preco * item.quantidade)}</span></div>
                  <div className="quantidade pequena">
                    <button onClick={() => alterarItem(item.id, -1)}><Minus /></button><b>{item.quantidade}</b><button onClick={() => alterarItem(item.id, 1)}><Plus /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="carrinho__total"><span>Total</span><strong>{dinheiro(total)}</strong></div>
            <button className="primario finalizar" onClick={() => { setCarrinhoAberto(false); setCheckoutAberto(true) }}>Continuar pedido</button>
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
            <label className="campo-solto">Observação<textarea value={formulario.observacao} onChange={(e) => atualizarCampo('observacao', e.target.value)} placeholder="Ex.: retirar cebola" /></label>

            <div className="resumo-checkout"><span>Total do pedido</span><strong>{dinheiro(total + (formulario.tipo === 'entrega' && entregaCalculada?.valido ? entregaCalculada.taxa : 0))}</strong></div>
            {formulario.tipo === 'entrega' && entregaCalculada?.valido && <small className="taxa-aviso">Entrega: {entregaCalculada.taxa === 0 ? 'grátis' : dinheiro(entregaCalculada.taxa)} · distância {entregaCalculada.distanciaKm.toFixed(2).replace('.', ',')} km.</small>}
            {erroPedido && <p className="erro-pedido">{erroPedido}</p>}
            <button className="primario enviar-pedido" disabled={enviando || (formulario.tipo === 'entrega' && !entregaCalculada?.valido)}>{enviando ? 'Enviando pedido...' : 'Confirmar pedido'}</button>
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

function LoginPainel({ pagina = 'pedidos' }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [entrando, setEntrando] = useState(false)
  const [sessao, setSessao] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session))
    const { data } = supabase.auth.onAuthStateChange((_evento, novaSessao) => setSessao(novaSessao))
    return () => data.subscription.unsubscribe()
  }, [])

  async function entrar(evento) {
    evento.preventDefault()
    setEntrando(true)
    setErro('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setEntrando(false)
    if (error) setErro('E-mail ou senha inválidos.')
  }

  if (sessao) {
    if (pagina === 'cardapio') return <PainelCardapio sessao={sessao} />
    if (pagina === 'configuracoes') return <PainelConfiguracoes sessao={sessao} />
    if (pagina === 'entregas') return <PainelEntregas sessao={sessao} />
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
      </form>
    </main>
  )
}

function NavegacaoPainel({ loja, ativo }) {
  return (
    <aside className="topo-painel">
      <div className="marca-lateral">
        <div className="marca-lateral__icone">K</div>
        <div><span>KODVEXA FOOD</span><h1>{loja?.nome || 'Painel'}</h1></div>
      </div>
      <div className="rotulo-menu">GESTÃO</div>
      <nav className="menu-painel">
        <Link className={ativo === 'pedidos' ? 'ativo' : ''} to="/painel"><ShoppingBag /><span>Pedidos</span></Link>
        <Link className={ativo === 'cardapio' ? 'ativo' : ''} to="/painel/cardapio"><ChefHat /><span>Cardápio</span></Link>
        <Link className={ativo === 'entregas' ? 'ativo' : ''} to="/painel/entregas"><Bike /><span>Entregas</span></Link>
        <Link className={ativo === 'configuracoes' ? 'ativo' : ''} to="/painel/configuracoes"><Store /><span>Configurações</span></Link>
      </nav>
      <div className="lateral-resumo">
        <span>LINK DA LOJA</span>
        <strong>{loja?.slug || 'carregando...'}</strong>
        <small>Seu cardápio está pronto para receber pedidos.</small>
      </div>
      <div className="acoes-topo acoes-lateral">
        {loja?.slug && (
          <button onClick={() => window.open(`/cardapio/${loja.slug}`, '_blank')}>
            <Store /><span>Ver cardápio</span>
          </button>
        )}
        <button onClick={() => supabase.auth.signOut()}><LogOut /><span>Sair</span></button>
      </div>
    </aside>
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

  async function carregarTudo() {
    setErro('')
    const { data: vinculo, error: erroVinculo } = await supabase
      .from('estabelecimento_usuarios')
      .select('estabelecimento_id, estabelecimentos(*)')
      .eq('usuario_id', sessao.user.id)
      .maybeSingle()
    if (erroVinculo || !vinculo) { setErro('Usuário sem estabelecimento vinculado.'); setCarregando(false); return }
    setLoja(vinculo.estabelecimentos)
    const [{ data: cats, error: erroCats }, { data: prods, error: erroProds }] = await Promise.all([
      supabase.from('categorias').select('*').eq('estabelecimento_id', vinculo.estabelecimento_id).order('ordem'),
      supabase.from('produtos').select('*').eq('estabelecimento_id', vinculo.estabelecimento_id).order('ordem'),
    ])
    if (erroCats || erroProds) setErro(erroCats?.message || erroProds?.message)
    setCategorias(cats || [])
    setProdutos(prods || [])
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

  async function alternarProduto(produto) {
    setProdutos((lista) => lista.map((p) => p.id === produto.id ? { ...p, disponivel: !p.disponivel } : p))
    const { error } = await supabase.from('produtos').update({ disponivel: !produto.disponivel }).eq('id', produto.id)
    if (error) { setErro(error.message); carregarTudo() }
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
                    <button className={`interruptor ${produto.disponivel ? 'ligado' : ''}`} onClick={() => alternarProduto(produto)} title="Ativar ou pausar"><i /></button>
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

      {modalProduto && <div className="modal-fundo"><form className="form-produto" onSubmit={salvarProduto}><button type="button" className="fechar" onClick={() => setModalProduto(false)}><X /></button><span>{produtoForm.id ? 'Editar produto' : 'Novo produto'}</span><h2>{produtoForm.id ? produtoForm.nome : 'Cadastrar produto'}</h2><label className="upload-imagem"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={escolherImagem} /><div className={previewImagem ? 'com-imagem' : ''}>{previewImagem ? <img src={previewImagem} alt="Prévia do produto" /> : <><ShoppingBag /><strong>Adicionar foto</strong><small>JPG, PNG ou WEBP · até 5 MB</small></>}</div></label><label>Nome<input value={produtoForm.nome} onChange={(e) => setProdutoForm({ ...produtoForm, nome: e.target.value })} /></label><label>Descrição<textarea value={produtoForm.descricao || ''} onChange={(e) => setProdutoForm({ ...produtoForm, descricao: e.target.value })} /></label><div className="campos dois"><label>Categoria<select value={produtoForm.categoria_id} onChange={(e) => setProdutoForm({ ...produtoForm, categoria_id: e.target.value })}>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label><label>Preço<input value={produtoForm.preco} onChange={(e) => setProdutoForm({ ...produtoForm, preco: e.target.value })} placeholder="0,00" inputMode="decimal" /></label></div><div className="checks-produto"><label><input type="checkbox" checked={produtoForm.disponivel} onChange={(e) => setProdutoForm({ ...produtoForm, disponivel: e.target.checked })} /> Disponível</label><label><input type="checkbox" checked={produtoForm.destaque} onChange={(e) => setProdutoForm({ ...produtoForm, destaque: e.target.checked })} /> Destacar produto</label></div><button className="primario" disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar produto'}</button></form></div>}
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
      const { data: vinculo, error } = await supabase
        .from('estabelecimento_usuarios')
        .select('estabelecimento_id, estabelecimentos(*)')
        .eq('usuario_id', sessao.user.id)
        .maybeSingle()
      if (error || !vinculo?.estabelecimentos) {
        setErro('Usuário sem estabelecimento vinculado.')
        setCarregando(false)
        return
      }
      const e = vinculo.estabelecimentos
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
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    async function carregarLoja() {
      const { data: vinculo, error } = await supabase
        .from('estabelecimento_usuarios')
        .select('estabelecimento_id, estabelecimentos(*)')
        .eq('usuario_id', sessao.user.id)
        .maybeSingle()

      if (error || !vinculo?.estabelecimentos) {
        setErro('Usuário sem estabelecimento vinculado.')
        setCarregando(false)
        return
      }

      const estabelecimento = vinculo.estabelecimentos
      setLoja(estabelecimento)
      setForm({
        nome: estabelecimento.nome || '',
        descricao: estabelecimento.descricao || '',
        cor_principal: estabelecimento.cor_principal || '#0b5cff',
        tempo_medio_min: estabelecimento.tempo_medio_min ?? 40,
        taxa_entrega_base: String(estabelecimento.taxa_entrega_base ?? 0).replace('.', ','),
        aberto: estabelecimento.aberto ?? true,
      })
      setPreviewLogo(estabelecimento.logo_url || '')
      setPreviewCapa(estabelecimento.capa_url || '')
      setPreviewGif(estabelecimento.fundo_gif_url || '')
      setCarregando(false)
    }
    carregarLoja()
  }, [sessao.user.id])

  function alterar(campo, valor) {
    setForm((atual) => ({ ...atual, [campo]: valor }))
    setMensagem('')
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
      setArquivoGif(arquivo)
      setPreviewGif(preview)
    } else {
      setArquivoCapa(arquivo)
      setPreviewCapa(preview)
    }
  }

  async function salvar(evento) {
    evento.preventDefault()
    setErro('')
    setMensagem('')

    const taxa = Number(String(form.taxa_entrega_base).replace(',', '.'))
    const tempo = Number(form.tempo_medio_min)
    if (!form.nome.trim() || !Number.isFinite(taxa) || taxa < 0 || !Number.isFinite(tempo) || tempo < 1) {
      setErro('Preencha nome, tempo e taxa de entrega corretamente.')
      return
    }

    setSalvando(true)
    let logoUrl = loja.logo_url || null
    let capaUrl = loja.capa_url || null
    let fundoGifUrl = loja.fundo_gif_url || null

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
      if (arquivoCapa) capaUrl = await enviarVisual(arquivoCapa, 'capa')
      if (arquivoGif) fundoGifUrl = await enviarVisual(arquivoGif, 'fundo')
    } catch (erroUpload) {
      setErro(`Erro ao enviar imagem: ${erroUpload.message}`)
      setSalvando(false)
      return
    }

    const dados = {
      nome: form.nome.trim(),
      descricao: form.descricao.trim() || null,
      cor_principal: form.cor_principal,
      tempo_medio_min: tempo,
      taxa_entrega_base: taxa,
      aberto: form.aberto,
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
        <form className="form-config" onSubmit={salvar}>
          <section className="cartao-config identidade-config">
            <div className="titulo-bloco-config"><span>APARÊNCIA</span><h3>Identidade da loja</h3><p>Crie um cardápio com a personalidade do estabelecimento.</p></div>
            <label className="logo-config">
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={escolherLogo} />
              <div>{previewLogo ? <img src={previewLogo} alt="Logo da loja" /> : <Store />}</div>
              <span><strong>Alterar logo</strong><small>JPG, PNG ou WEBP · até 5 MB</small></span>
            </label>
            <div className="midias-config">
              <label className="midia-config">
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => escolherVisual(e, 'capa')} />
                <span>Foto de capa</span>
                <div>{previewCapa ? <img src={previewCapa} alt="Prévia da capa" /> : <><Store /><small>Adicionar capa</small></>}</div>
                <small>JPG, PNG ou WEBP · até 5 MB</small>
              </label>
              <label className="midia-config gif-config">
                <input type="file" accept="image/gif" onChange={(e) => escolherVisual(e, 'gif')} />
                <span>GIF de fundo</span>
                <div>{previewGif ? <img src={previewGif} alt="Prévia do GIF" /> : <><RefreshCw /><small>Adicionar GIF</small></>}</div>
                <small>GIF animado · até 10 MB</small>
              </label>
            </div>
            <label>Nome da loja<input value={form.nome} onChange={(e) => alterar('nome', e.target.value)} /></label>
            <label>Descrição<textarea value={form.descricao} onChange={(e) => alterar('descricao', e.target.value)} placeholder="Ex.: Hambúrgueres artesanais, porções e bebidas." /></label>
            <label>Cor principal<div className="seletor-cor"><input type="color" value={form.cor_principal} onChange={(e) => alterar('cor_principal', e.target.value)} /><input value={form.cor_principal} onChange={(e) => alterar('cor_principal', e.target.value)} /></div></label>
          </section>

          <section className="cartao-config operacao-config">
            <div className="titulo-bloco-config"><span>OPERAÇÃO</span><h3>Entrega e funcionamento</h3><p>Controle as informações usadas durante o pedido.</p></div>
            <label className="linha-interruptor"><span><strong>Loja aberta</strong><small>Permite mostrar “Aberto agora” no cardápio.</small></span><input type="checkbox" checked={form.aberto} onChange={(e) => alterar('aberto', e.target.checked)} /></label>
            <label>Tempo médio de entrega (minutos)<input type="number" min="1" value={form.tempo_medio_min} onChange={(e) => alterar('tempo_medio_min', e.target.value)} /></label>
            <label>Taxa de entrega (R$)<input value={form.taxa_entrega_base} onChange={(e) => alterar('taxa_entrega_base', e.target.value)} inputMode="decimal" placeholder="0,00" /></label>
          </section>

          <aside className="preview-config" style={{ '--preview-cor': form.cor_principal || '#0b5cff' }}>
            <div className="preview-config__topo"><div><span>PRÉVIA AO VIVO</span><strong>Visão do cliente</strong></div><i /></div>
            <div className="celular-preview">
              <div className="celular-preview__barra"><i /><i /><i /></div>
              <div className="celular-preview__capa" style={previewCapa ? { backgroundImage: `url("${previewCapa}")` } : undefined}>
                <div className="celular-preview__sombra" />
                <div className="celular-preview__loja">
                  <div className="celular-preview__logo">{previewLogo ? <img src={previewLogo} alt="" /> : <Store />}</div>
                  <div><span>{form.aberto ? 'ABERTO AGORA' : 'FECHADO'}</span><h3>{form.nome || 'Nome da loja'}</h3><p>{form.descricao || 'Descrição do estabelecimento'}</p></div>
                </div>
              </div>
              <div className="celular-preview__conteudo" style={previewGif ? { backgroundImage: `linear-gradient(rgba(246,248,252,.92), rgba(246,248,252,.94)), url("${previewGif}")` } : undefined}>
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
  const [pedidosChamando, setPedidosChamando] = useState([])
  const [alertasAtivos, setAlertasAtivos] = useState(() => localStorage.getItem('kodvexa_alertas_pedidos') === '1')
  const pedidosConhecidos = useRef(new Set())
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
    if (detectarNovos && pedidosConhecidos.current.size > 0) {
      const novos = lista.filter((pedido) => !pedidosConhecidos.current.has(pedido.id))
      novos.slice().reverse().forEach(registrarNovoPedido)
    }

    pedidosConhecidos.current = new Set(lista.map((pedido) => pedido.id))
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
      const { data: vinculo, error: erroVinculo } = await supabase
        .from('estabelecimento_usuarios')
        .select('estabelecimento_id, estabelecimentos(*)')
        .eq('usuario_id', sessao.user.id)
        .maybeSingle()

      if (erroVinculo || !vinculo) {
        setErro('Este usuário ainda não está vinculado a um estabelecimento.')
        setCarregando(false)
        return
      }

      if (cancelado) return
      setLoja(vinculo.estabelecimentos)
      await carregarPedidos(vinculo.estabelecimento_id, false)

      canal = supabase
        .channel(`pedidos-${vinculo.estabelecimento_id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'pedidos', filter: `estabelecimento_id=eq.${vinculo.estabelecimento_id}` },
          (payload) => {
            if (payload.eventType === 'INSERT') registrarNovoPedido(payload.new)
            carregarPedidos(vinculo.estabelecimento_id, false)
          }
        )
        .subscribe()

      // Plano B confiável: consulta pedidos a cada 3 segundos.
      // Assim o painel atualiza mesmo se o Realtime do Supabase não estiver habilitado para a tabela.
      intervalo = window.setInterval(() => {
        carregarPedidos(vinculo.estabelecimento_id, true)
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
    const anterior = pedidos
    setPedidos((lista) => lista.map((item) => item.id === pedido.id ? { ...item, status } : item))
    const { error } = await supabase.from('pedidos').update({ status }).eq('id', pedido.id)
    if (error) {
      setPedidos(anterior)
      setErro(error.message)
      return
    }

    // O alerta só para quando o dono realmente aceitar/confirmar o pedido.
    if (status !== 'recebido') {
      setPedidosChamando((atuais) => atuais.filter((item) => item.id !== pedido.id))
    }

    // Ao sair para entrega, o cliente recebe automaticamente o aviso pelo WhatsApp.
    if (status === 'saiu_entrega' && pedido.tipo_entrega === 'entrega') {
      const enviado = await enviarAvisoWhatsApp(pedido, 'saiu_entrega')
      if (!enviado) {
        setErro('O pedido saiu para entrega, mas o aviso do WhatsApp não foi enviado. Confira a configuração da API.')
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
  const exibidos = pedidos.filter((pedido) => abaAtual.status.includes(pedido.status))
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

        <section className="resumo-painel">
          <div><Clock3 /><span>Novos</span><strong>{pedidos.filter((p) => p.status === 'recebido').length}</strong></div>
          <div><ChefHat /><span>Em preparo</span><strong>{pedidos.filter((p) => ['confirmado', 'preparando'].includes(p.status)).length}</strong></div>
          <div><Bike /><span>Saiu para entrega</span><strong>{pedidos.filter((p) => p.status === 'saiu_entrega').length}</strong></div>
          <div><CheckCircle2 /><span>Concluídos</span><strong>{pedidos.filter((p) => p.status === 'concluido').length}</strong></div>
        </section>

        <div className="cabecalho-lista">
          <div><h2>Pedidos</h2><p>Atualização automática dos pedidos recebidos.</p></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
          {!exibidosOrdenados.length && <div className="sem-pedidos"><ShoppingBag /><h3>Nenhum pedido aqui</h3><p>Os novos pedidos aparecerão automaticamente.</p></div>}
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
        <Route path="/painel" element={<LoginPainel />} />
        <Route path="/painel/cardapio" element={<LoginPainel pagina="cardapio" />} />
        <Route path="/painel/entregas" element={<LoginPainel pagina="entregas" />} />
        <Route path="/painel/configuracoes" element={<LoginPainel pagina="configuracoes" />} />
        <Route path="*" element={<TelaCentral texto="Página não encontrada." erro />} />
      </Routes>
    </BrowserRouter>
  )
}
