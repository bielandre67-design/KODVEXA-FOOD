import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Bell, Bike, CheckCircle2, ChevronDown, Clock3, LocateFixed, MapPin, Navigation, Phone, RefreshCw, ShieldCheck } from 'lucide-react'
import MapaRota from './MapaRota'
import { ativo, calcularMapa, dinheiro, enderecoPedido, linkNavegacao, localizar, telefoneBrasil } from './rotas'
import './entregas.css'

// Não reutiliza a sessão administrativa, mesmo que o dono confira o link no seu PC.
const acessoEntrega = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'kv-entrega-sem-sessao' },
  global: { fetch: (url, options) => fetch(url, { ...options, cache: 'no-store' }) },
})
const lerToken = () => new URLSearchParams(window.location.hash.slice(1)).get('acesso') || ''


function tocarAvisoNovoPedido() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (AudioCtx) {
      const ctx = new AudioCtx()
      const ganho = ctx.createGain()
      ganho.gain.setValueAtTime(0.0001, ctx.currentTime)
      ganho.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02)
      ganho.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.42)

      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(1180, ctx.currentTime + 0.17)
      osc.connect(ganho)
      ganho.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.45)
    }
  } catch {}

  try {
    navigator.vibrate?.([180, 70, 180])
  } catch {}
}

const ENTREGADOR_APP_CSS = `
:root{color-scheme:light}
body:has(.kv-driver-app){
  margin:0!important;
  background:#e9edf2!important;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased;
}
.kv-driver-app{
  --brand:#2563eb;
  --brand-dark:#1749bb;
  --ink:#111827;
  --muted:#667085;
  --soft:#f4f6f8;
  --line:#e7e9ee;
  --danger:#e5484d;
  --success:#12a36e;
  --warning:#f59e0b;
  width:100%;
  max-width:430px;
  min-height:100dvh;
  margin:0 auto;
  padding:0 14px 94px;
  background:#f7f8fa;
  color:var(--ink);
  box-sizing:border-box;
  box-shadow:0 0 0 1px rgba(17,24,39,.03),0 24px 70px rgba(17,24,39,.08);
}
.kv-driver-app *{box-sizing:border-box}
button{font:inherit}
.driver-topbar{
  position:sticky;top:0;z-index:50;
  margin:0 -14px 14px;
  padding:12px 14px;
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  background:rgba(255,255,255,.96);
  border-bottom:1px solid var(--line);
  backdrop-filter:blur(18px);
}
.driver-brand{display:flex;align-items:center;gap:10px;min-width:0}
.driver-brand-icon{
  width:40px;height:40px;border-radius:12px;display:grid;place-items:center;
  background:var(--brand);color:#fff;flex:0 0 auto;
  box-shadow:0 7px 18px rgba(37,99,235,.18)
}
.driver-brand small{
  display:block;font-size:9px;line-height:1;color:#98a2b3;font-weight:800;letter-spacing:.12em
}
.driver-brand strong{
  display:block;margin-top:4px;font-size:15px;line-height:1.1;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:225px;
  letter-spacing:-.015em
}
.driver-top-actions{display:flex;gap:7px}
.driver-icon-btn{
  width:40px;height:40px;border:1px solid var(--line);border-radius:12px;background:#fff;
  color:#344054;display:grid;place-items:center;transition:.18s ease
}
.driver-icon-btn:active{transform:scale(.96)}
.driver-icon-btn.alerta-on{color:#fff;background:#111827;border-color:#111827}

.driver-toast{
  margin-bottom:10px;padding:10px 12px;border-radius:12px;
  font-size:11px;line-height:1.4;border:1px solid #fecaca;background:#fff5f5;color:#b42318
}
.driver-toast.info{border-color:#fed7aa;background:#fff8ed;color:#9a3412}

.driver-hero{
  position:relative;overflow:hidden;
  display:flex;align-items:center;justify-content:space-between;gap:14px;
  margin-bottom:10px;padding:16px;
  border-radius:20px;background:#111827;color:#fff;
}
.driver-hero::after{
  content:"";position:absolute;right:-28px;top:-34px;width:110px;height:110px;border-radius:50%;
  background:rgba(37,99,235,.22)
}
.driver-hero-copy{position:relative;z-index:1;min-width:0}
.driver-hero-copy small{display:block;font-size:9px;color:#9ca3af;font-weight:800;letter-spacing:.1em}
.driver-hero-copy h1{margin:5px 0 3px;font-size:19px;line-height:1.1;letter-spacing:-.03em}
.driver-hero-copy p{margin:0;font-size:11px;color:#cbd5e1}
.driver-hero-count{
  position:relative;z-index:1;min-width:68px;text-align:center;padding-left:14px;
  border-left:1px solid rgba(255,255,255,.13)
}
.driver-hero-count strong{display:block;font-size:30px;line-height:1}
.driver-hero-count span{display:block;margin-top:5px;font-size:9px;color:#cbd5e1}

.driver-route{
  margin-bottom:12px;padding:12px;border-radius:18px;background:#fff;border:1px solid var(--line);
  box-shadow:0 5px 18px rgba(17,24,39,.035)
}
.driver-route-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}
.driver-route-head small{display:block;font-size:9px;color:#98a2b3;font-weight:800;letter-spacing:.1em}
.driver-route-head strong{display:block;margin-top:2px;font-size:14px}
.driver-route-head-right{display:flex;align-items:center;gap:7px}
.driver-gps{
  display:inline-flex;align-items:center;gap:6px;border:0;border-radius:10px;
  background:#eff6ff;color:#1d4ed8;padding:9px 10px;font-size:10px;font-weight:800
}
.driver-route .leaflet-container{height:205px!important;border-radius:14px;overflow:hidden}
.driver-route-meta{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}
.driver-route-meta span{
  display:flex;align-items:center;justify-content:center;gap:5px;
  text-align:center;padding:8px;border-radius:10px;background:#f8fafc;
  color:#475467;font-size:11px;font-weight:800
}
.driver-route-msg{padding:10px;border-radius:10px;background:#f8fafc;color:#667085;font-size:11px}
.driver-route-msg.erro{background:#fff1f1;color:#b42318}

.driver-section-label{
  display:flex;align-items:end;justify-content:space-between;gap:8px;padding:2px 2px 9px
}
.driver-section-label div strong{display:block;font-size:15px;letter-spacing:-.02em}
.driver-section-label div span{display:block;margin-top:2px;font-size:10px;color:#98a2b3}
.driver-section-label>b{
  min-width:24px;height:24px;padding:0 7px;border-radius:999px;display:grid;place-items:center;
  background:#eef2f6;color:#475467;font-size:10px
}

.driver-list{display:grid;gap:10px}
.driver-order{
  position:relative;overflow:hidden;padding:0;
  border-radius:20px;background:#fff;border:1px solid var(--line);
  box-shadow:0 7px 20px rgba(17,24,39,.045)
}
.driver-order.novo{
  border-color:rgba(229,72,77,.84);
  box-shadow:0 0 0 2px rgba(229,72,77,.07),0 8px 25px rgba(229,72,77,.10);
  animation:driver-led 1.45s ease-in-out infinite
}
.driver-order.novo::before{
  content:"";position:absolute;inset:0;pointer-events:none;border-radius:20px;
  box-shadow:inset 0 0 0 1px rgba(229,72,77,.55)
}
@keyframes driver-led{
  0%,100%{box-shadow:0 0 0 1px rgba(229,72,77,.08),0 8px 22px rgba(17,24,39,.045)}
  50%{box-shadow:0 0 0 3px rgba(229,72,77,.10),0 0 24px rgba(229,72,77,.20),0 8px 22px rgba(17,24,39,.05)}
}
.driver-order-head{
  display:grid;grid-template-columns:42px 1fr auto;align-items:center;gap:10px;
  padding:14px 14px 12px
}
.driver-stop{
  width:42px;height:42px;border-radius:13px;display:grid;place-items:center;
  background:#eff6ff;color:#1d4ed8;font-size:14px;font-weight:900
}
.driver-order.novo .driver-stop{background:#fff1f2;color:#dc2626}
.driver-order-title small{display:block;font-size:8px;color:#98a2b3;font-weight:800;letter-spacing:.1em}
.driver-order-title strong{display:block;margin-top:3px;font-size:16px;line-height:1.15;letter-spacing:-.02em}
.driver-badge{padding:5px 8px;border-radius:999px;font-size:9px;font-weight:900}
.driver-badge.pronto{background:#fff1f2;color:#dc2626}
.driver-badge.rota{background:#fff7ed;color:#c2410c}

.driver-address{
  display:grid;grid-template-columns:20px 1fr;gap:9px;align-items:start;
  margin:0 14px;padding:12px 0;border-top:1px solid #eef0f3
}
.driver-address svg{color:var(--brand);margin-top:1px}
.driver-address strong{display:block;font-size:14px;line-height:1.42}
.driver-address span{display:block;margin-top:4px;color:#667085;font-size:10px}

.driver-action-row{
  display:grid;grid-template-columns:1fr 1fr;gap:8px;
  padding:0 14px 10px
}
.driver-action-row.single{grid-template-columns:1fr}
.driver-btn{
  min-height:46px;border:0;border-radius:12px;display:flex;align-items:center;justify-content:center;
  gap:7px;font-size:12px;font-weight:900;transition:.16s ease
}
.driver-btn:active{transform:translateY(1px)}
.driver-btn.route{background:#111827;color:#fff}
.driver-btn.call{background:#f8fafc;color:#344054;border:1px solid #e4e7ec}
.driver-btn.start{background:var(--brand);color:#fff}
.driver-btn.done{background:var(--success);color:#fff}
.driver-btn:disabled{opacity:.5}
.driver-primary-wrap{padding:0 14px 14px}
.driver-new-note{
  padding:0 14px 12px;text-align:center;color:#c62828;font-size:9px;font-weight:800;letter-spacing:.03em
}

.driver-empty{
  min-height:300px;display:grid;place-items:center;text-align:center;padding:32px 22px;color:#667085
}
.driver-empty-icon{
  width:56px;height:56px;border-radius:18px;display:grid;place-items:center;
  background:#eff6ff;color:#1d4ed8;margin:0 auto 10px
}
.driver-empty h2{margin:0 0 4px;color:#344054;font-size:17px}
.driver-empty p{margin:0;max-width:280px;font-size:11px;line-height:1.45}

.driver-done{
  margin-top:12px;border:1px solid var(--line);border-radius:16px;background:#fff;overflow:hidden
}
.driver-done summary{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  list-style:none;padding:12px 14px;font-size:11px;font-weight:800;color:#475467;cursor:pointer
}
.driver-done summary::-webkit-details-marker{display:none}
.driver-done-list{border-top:1px solid #eef0f3}
.driver-done-item{
  display:flex;align-items:center;gap:7px;padding:10px 14px;border-bottom:1px solid #f2f4f7;
  font-size:10px;color:#667085
}
.driver-done-item svg{color:var(--success)}

.driver-bottom{
  position:fixed;left:50%;bottom:0;transform:translateX(-50%);
  width:min(430px,100%);z-index:40;
  padding:9px 14px max(9px,env(safe-area-inset-bottom));
  background:rgba(255,255,255,.97);backdrop-filter:blur(18px);border-top:1px solid var(--line)
}
.driver-bottom-inner{
  display:grid;grid-template-columns:repeat(3,1fr);gap:5px;padding:4px;border-radius:14px;background:#f2f4f7
}
.driver-bottom-item{
  min-height:42px;border:0;border-radius:10px;background:transparent;color:#98a2b3;
  font-size:10px;font-weight:800
}
.driver-bottom-item.active{background:#fff;color:#111827;box-shadow:0 2px 9px rgba(17,24,39,.07)}

@media(max-width:390px){
  .kv-driver-app{padding-left:10px;padding-right:10px}
  .driver-topbar{margin-left:-10px;margin-right:-10px}
  .driver-brand strong{max-width:190px}
  .driver-route .leaflet-container{height:185px!important}
}
`

export default function Entregador() {
  const [token, setToken] = useState(lerToken)
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState('')
  const [aba, setAba] = useState('prontos')
  const [rota, setRota] = useState(null)
  const [erroMapa, setErroMapa] = useState('')
  const [calculando, setCalculando] = useState(false)
  const [posicao, setPosicao] = useState(null)
  const [tentativa, setTentativa] = useState(0)
  const sequencia = useRef(0)
  const trava = useRef(false)
  const prontosConhecidos = useRef(null)
  const [alertaNovo, setAlertaNovo] = useState('')
  const [alertasAtivos, setAlertasAtivos] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission === 'granted' : false
  )

  const limpar = useCallback(() => { sequencia.current++; setDados(null); setRota(null); setPosicao(null) }, [])
  const atualizar = useCallback(async () => {
    const seq = ++sequencia.current
    try {
      if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Abra o link fixo que a loja enviou para você.')
      if (!navigator.onLine) throw new Error('Sem internet. Reconecte para consultar suas entregas.')
      const { data, error } = await acessoEntrega.rpc('kv_entregador_obter', { p_token: token })
      if (error) throw error
      if (seq !== sequencia.current) return null
      if (document.hidden) return null
      const idsProntos = new Set(
        (data?.pedidos || []).filter((p) => p.status === 'pronto').map((p) => p.id)
      )

      if (prontosConhecidos.current) {
        const novos = [...idsProntos].filter((id) => !prontosConhecidos.current.has(id))
        if (novos.length) {
          tocarAvisoNovoPedido()
          setAlertaNovo(novos.length === 1 ? 'Nova entrega pronta!' : `${novos.length} novas entregas prontas!`)
          setTimeout(() => setAlertaNovo(''), 7000)

          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              new Notification('KODVEXA FOOD', {
                body: novos.length === 1
                  ? 'Nova entrega pronta para sair.'
                  : `${novos.length} novas entregas prontas para sair.`,
              })
            } catch {}
          }
        }
      }

      prontosConhecidos.current = idsProntos
      setDados(data); setErro(''); return data
    } catch (e) {
      if (seq === sequencia.current) { setDados(null); setRota(null); setErro(e.message || 'Não foi possível confirmar o acesso. Atualize a tela.') }
      return null
    } finally { if (seq === sequencia.current) setCarregando(false) }
  }, [token])

  useEffect(() => {
    const mudarHash = () => { limpar(); setToken(lerToken()) }
    window.addEventListener('hashchange', mudarHash)
    return () => window.removeEventListener('hashchange', mudarHash)
  }, [limpar])
  useEffect(() => {
    atualizar()
    const timer = setInterval(() => { if (!document.hidden && !trava.current) atualizar() }, 15000)
    const visibilidade = () => {
      if (document.hidden) limpar()
      else { setCarregando(true); atualizar() }
    }
    const offline = () => { limpar(); setErro('Sem internet. Reconecte para consultar suas entregas.') }
    const online = () => atualizar()
    document.addEventListener('visibilitychange', visibilidade)
    window.addEventListener('pagehide', limpar)
    window.addEventListener('pageshow', online)
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => {
      sequencia.current++; clearInterval(timer)
      document.removeEventListener('visibilitychange', visibilidade)
      window.removeEventListener('pagehide', limpar); window.removeEventListener('pageshow', online)
      window.removeEventListener('offline', offline); window.removeEventListener('online', online)
    }
  }, [atualizar, limpar])
  const pendentes = (dados?.pedidos || []).filter(ativo)
  const encerrados = (dados?.pedidos || []).filter((p) => !ativo(p))
  // Polling de status não consulta novamente o Geoapify se as paradas não mudaram.
  const descricaoMapa = JSON.stringify(dados && pendentes.length ? {
    loja: dados.loja,
    paradas: pendentes.map((p) => ({ id: p.id, endereco: enderecoPedido(p), cep: p.cep_entrega })),
  } : null)
  useEffect(() => {
    const plano = JSON.parse(descricaoMapa)
    const abort = new AbortController()
    setRota(null); setErroMapa(''); setCalculando(false)
    if (!plano) return () => abort.abort()
    setCalculando(true)
    async function montar() {
      try {
        const enderecoLoja = [plano.loja.endereco, plano.loja.cidade, plano.loja.estado, plano.loja.cep, 'Brasil'].filter(Boolean).join(', ')
        const origem = posicao || await localizar(enderecoLoja, plano.loja.cep, abort.signal)
        const paradas = []
        for (const p of plano.paradas) paradas.push({ ...await localizar(p.endereco, p.cep, abort.signal), id: p.id })
        const resultado = await calcularMapa(origem, paradas, abort.signal)
        if (!abort.signal.aborted) setRota(resultado)
      } catch (e) { if (!abort.signal.aborted) setErroMapa(e.message || 'Não foi possível montar o mapa.') }
      finally { if (!abort.signal.aborted) setCalculando(false) }
    }
    montar()
    return () => abort.abort()
  }, [descricaoMapa, posicao, tentativa])

  async function ativarAlertas() {
    tocarAvisoNovoPedido()

    if (typeof Notification === 'undefined') {
      setAlertasAtivos(true)
      setAlertaNovo('Alertas por som e vibração ativados.')
      setTimeout(() => setAlertaNovo(''), 3500)
      return
    }

    try {
      const permissao = await Notification.requestPermission()
      setAlertasAtivos(permissao === 'granted')
      setAlertaNovo(
        permissao === 'granted'
          ? 'Alertas ativados.'
          : 'Som e vibração continuam disponíveis enquanto esta tela estiver aberta.'
      )
      setTimeout(() => setAlertaNovo(''), 3500)
    } catch {
      setAlertasAtivos(true)
    }
  }

  async function usarGPS() {
    if (!navigator.geolocation) { setAviso('Este navegador não oferece localização. A rota parte da loja.'); return }
    const seq = sequencia.current
    setAviso('Buscando sua localização...')
    navigator.geolocation.getCurrentPosition((p) => {
      if (document.hidden || seq !== sequencia.current) { setAviso('Toque em Minha localização para tentar novamente.'); return }
      if (p.coords.accuracy > 250) { setAviso('O GPS está impreciso. Tente novamente em um local aberto.'); return }
      setPosicao({ lat: p.coords.latitude, lon: p.coords.longitude }); setAviso('Rota calculada a partir da sua localização neste momento.')
    }, () => setAviso('Localização indisponível ou não autorizada. A rota continua partindo da loja.'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 })
  }

  async function alterar(p, status) {
    if (trava.current) return
    if (status === 'concluido' && !window.confirm(`Confirmar a entrega do pedido #${p.numero}? O contato e o endereço serão retirados deste link.`)) return
    trava.current = true; setOcupado(p.id); setAviso(''); limpar()
    try {
      const { data, error } = await acessoEntrega.rpc('kv_entregador_status', { p_token: token, p_pedido_id: p.id, p_status: status })
      if (error) throw error
      if (status === 'saiu_entrega' && data?.alterado) {
        try {
          const res = await fetch('/api/whatsapp-pedido', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ evento: 'saiu_entrega', pedido_id: p.id, entrega_token: token }), signal: AbortSignal.timeout(20000) })
          const resposta = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(resposta.error || 'Aviso indisponível')
        } catch { setAviso('Pedido em rota. O aviso automático de WhatsApp não foi confirmado; avise a loja.') }
      }
      if (status === 'concluido') setAviso(`Pedido #${p.numero} entregue. Contato e endereço removidos deste acesso.`)
    } catch (e) { setAviso(e.message || 'Não foi possível atualizar. Confira o status antes de tentar novamente.') }
    finally { await atualizar(); trava.current = false; setOcupado('') }
  }

  async function abrirAcao(p, tipo) {
    // Confirma o acesso antes de abrir uma informação que pode ter sido encerrada pelo dono.
    const janela = tipo === 'rota' ? window.open('about:blank', '_blank') : null
    if (janela) janela.opener = null
    const atual = await atualizar()
    const pedido = atual?.pedidos.find((item) => item.id === p.id && ativo(item))
    if (!pedido) { janela?.close(); setAviso('O acesso a esse pedido foi encerrado ou não pôde ser confirmado.'); return }
    if (tipo === 'rota') {
      if (janela) janela.location.replace(linkNavegacao(pedido))
      else setAviso('Permita abrir uma nova aba para iniciar a navegação.')
    } else {
      const telefone = telefoneBrasil(pedido.cliente_telefone)
      if (telefone) window.location.href = `tel:+${telefone}`
    }
  }

  const prontos = (dados?.pedidos || []).filter((p) => p.status === 'pronto')
  const caminho = (dados?.pedidos || []).filter((p) => p.status === 'saiu_entrega')
  const entregues = (dados?.pedidos || []).filter((p) => p.status === 'concluido')
  const ativosRota = [...caminho, ...prontos]

  function PedidoCard({ p, index }) {
    const emRota = p.status === 'saiu_entrega'
    const novo = p.status === 'pronto'

    return (
      <article className={`driver-order ${novo ? 'novo' : ''}`}>
        <div className="driver-order-head">
          <span className="driver-stop">{index + 1}</span>

          <div className="driver-order-title">
            <small>PEDIDO #{p.numero}</small>
            <strong>{p.cliente_nome}</strong>
          </div>

          <span className={`driver-badge ${emRota ? 'rota' : 'pronto'}`}>
            {emRota ? 'A caminho' : 'Novo'}
          </span>
        </div>

        <div className="driver-address">
          <MapPin size={19}/>
          <div>
            <strong>{enderecoPedido(p)}</strong>
            {p.complemento && <span>Complemento: {p.complemento}</span>}
            {p.referencia && <span>Referência: {p.referencia}</span>}
          </div>
        </div>

        <div className={`driver-action-row ${emRota ? '' : 'single'}`}>
          <button type="button" className="driver-btn route" onClick={() => abrirAcao(p, 'rota')}>
            <Navigation size={18}/>
            Navegar
          </button>

          {emRota && (
            <button
              type="button"
              className="driver-btn call"
              onClick={() => abrirAcao(p, 'telefone')}
              disabled={!telefoneBrasil(p.cliente_telefone)}
            >
              <Phone size={17}/>
              Ligar
            </button>
          )}
        </div>

        <div className="driver-primary-wrap">
          <button
            type="button"
            className={`driver-btn ${emRota ? 'done' : 'start'}`}
            onClick={() => alterar(p, emRota ? 'concluido' : 'saiu_entrega')}
            disabled={!!ocupado}
            style={{ width: '100%' }}
          >
            {emRota ? <CheckCircle2 size={19}/> : <Bike size={19}/>}
            {emRota ? 'Confirmar entrega' : 'Iniciar entrega'}
          </button>
        </div>

        {novo && <div className="driver-new-note">Novo pedido aguardando saída</div>}
      </article>
    )
  }

  return (
    <>
      <style>{ENTREGADOR_APP_CSS}</style>

      <main className="kv-driver-app">
        <header className="driver-topbar">
          <div className="driver-brand">
            <span className="driver-brand-icon"><Bike size={20}/></span>
            <div>
              <small>KODVEXA FOOD</small>
              <strong>{dados?.loja?.nome || 'Entregas'}</strong>
            </div>
          </div>

          <div className="driver-top-actions">
            <button
              type="button"
              className={`driver-icon-btn ${alertasAtivos ? 'alerta-on' : ''}`}
              onClick={ativarAlertas}
              aria-label="Ativar alertas"
            >
              <Bell size={18}/>
            </button>

            <button
              type="button"
              className="driver-icon-btn"
              onClick={atualizar}
              disabled={!!ocupado}
              aria-label="Atualizar"
            >
              <RefreshCw size={18}/>
            </button>
          </div>
        </header>

        {alertaNovo && <div className="driver-toast">{alertaNovo}</div>}
        {erro && <div className="driver-toast">{erro}</div>}
        {aviso && <div className="driver-toast info">{aviso}</div>}

        {!dados ? (
          <section className="driver-empty">
            <div>
              <div className="driver-empty-icon"><ShieldCheck size={28}/></div>
              <h2>{carregando ? 'Carregando entregas...' : 'Acesso às entregas'}</h2>
              <p>Abra o link fixo enviado pela loja.</p>
            </div>
          </section>
        ) : (
          <>
            <section className="driver-hero">
              <div className="driver-hero-copy">
                <small>ENTREGADOR</small>
                <h1>{dados.entregador}</h1>
                <p>{caminho.length ? `${caminho.length} entrega(s) em andamento` : 'Pronto para iniciar as entregas'}</p>
              </div>

              <div className="driver-hero-count">
                <strong>{ativosRota.length}</strong>
                <span>pendentes</span>
              </div>
            </section>

            {!!ativosRota.length && (
              <section className="driver-route">
                <div className="driver-route-head">
                  <div>
                    <small>ROTA ATUAL</small>
                    <strong>{ativosRota.length} parada(s)</strong>
                  </div>

                  <div className="driver-route-head-right">
                    <button type="button" className="driver-gps" onClick={usarGPS}>
                      <LocateFixed size={16}/>
                      Usar GPS
                    </button>
                  </div>
                </div>

                {calculando && <div className="driver-route-msg">Calculando o melhor trajeto...</div>}

                {erroMapa && (
                  <div className="driver-route-msg erro">
                    {erroMapa}
                    <button type="button" onClick={() => setTentativa((n) => n + 1)}>
                      Tentar novamente
                    </button>
                  </div>
                )}

                {rota && (
                  <>
                    <MapaRota rota={rota}/>
                    <div className="driver-route-meta">
                      <span><Navigation size={15}/>{(rota.distancia / 1000).toFixed(1).replace('.', ',')} km</span>
                      <span><Clock3 size={15}/>{Math.max(1, Math.round(rota.tempo / 60))} min</span>
                    </div>
                  </>
                )}
              </section>
            )}

            <div className="driver-section-label">
              <div>
                <strong>Entregas de agora</strong>
                <span>Novos pedidos entram automaticamente</span>
              </div>
              <b>{ativosRota.length}</b>
            </div>

            <section className="driver-list">
              {ativosRota.map((p, i) => <PedidoCard key={p.id} p={p} index={i}/>)}

              {!ativosRota.length && (
                <div className="driver-empty">
                  <div>
                    <div className="driver-empty-icon"><CheckCircle2 size={28}/></div>
                    <h2>Tudo certo por aqui</h2>
                    <p>Quando um novo pedido ficar pronto, você recebe um aviso e ele aparece nesta tela.</p>
                  </div>
                </div>
              )}
            </section>

            {!!entregues.length && (
              <details className="driver-done">
                <summary>
                  <span>Entregues hoje · {entregues.length}</span>
                  <ChevronDown size={16}/>
                </summary>

                <div className="driver-done-list">
                  {entregues.map((p) => (
                    <div className="driver-done-item" key={p.id}>
                      <CheckCircle2 size={16}/>
                      Pedido #{p.numero}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}

        <nav className="driver-bottom" aria-label="Resumo das entregas">
          <div className="driver-bottom-inner">
            <button className="driver-bottom-item active" type="button">
              Pendentes {ativosRota.length}
            </button>
            <button className="driver-bottom-item" type="button">
              Em rota {caminho.length}
            </button>
            <button className="driver-bottom-item" type="button">
              Hoje {entregues.length}
            </button>
          </div>
        </nav>
      </main>
    </>
  )
}
