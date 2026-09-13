import { useCallback, useEffect, useRef, useState } from 'react'
import { Bike, Copy, Link2, RefreshCw, ShieldOff } from 'lucide-react'
import { supabase } from '../supabase'
import './entregas.css'

export default function RotasPainel({ loja }) {
  const [aberto, setAberto] = useState(false)
  const [nome, setNome] = useState('')
  const [status, setStatus] = useState(null)
  const [novoLink, setNovoLink] = useState(null)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const linkInput = useRef(null)
  const lojaId = loja?.id

  const carregar = useCallback(async () => {
    if (!lojaId) return
    const { data, error } = await supabase.rpc('kv_entregador_acesso_status', {
      p_estabelecimento_id: lojaId,
    })
    if (error) {
      setErro(error.message || 'Não foi possível carregar o acesso do entregador.')
      return
    }
    setStatus(data || { ativo: false })
    if (data?.entregador && !nome) setNome(data.entregador)
    setErro('')
  }, [lojaId, nome])

  useEffect(() => {
    if (!lojaId) return
    carregar()
  }, [lojaId, carregar])

  async function gerar(e) {
    e.preventDefault()
    if (!nome.trim()) return
    if (status?.ativo && !window.confirm('Gerar um novo link? O link antigo vai parar de funcionar.')) return

    setOcupado(true)
    setErro('')
    setCopiado(false)
    try {
      const { data, error } = await supabase.rpc('kv_entregador_link_criar', {
        p_estabelecimento_id: lojaId,
        p_entregador: nome.trim(),
      })
      if (error) throw error

      const base = import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin
      const url = new URL('/entregador', base)
      url.hash = `acesso=${data.token}`
      setNovoLink({ ...data, url: url.toString() })
      await carregar()
    } catch (e) {
      setErro(e.message || 'Não foi possível gerar o link.')
    } finally {
      setOcupado(false)
    }
  }

  async function copiar() {
    if (!novoLink?.url) return
    try {
      await navigator.clipboard.writeText(novoLink.url)
      setCopiado(true)
    } catch {
      linkInput.current?.focus()
      linkInput.current?.select()
      setErro('O link ficou selecionado. Use Ctrl+C para copiar.')
    }
  }

  async function revogar() {
    if (!window.confirm('Encerrar o acesso do entregador? O link atual vai parar de funcionar.')) return
    setOcupado(true)
    try {
      const { error } = await supabase.rpc('kv_entregador_acesso_revogar', {
        p_estabelecimento_id: lojaId,
      })
      if (error) throw error
      setNovoLink(null)
      await carregar()
    } catch (e) {
      setErro(e.message || 'Não foi possível encerrar o acesso.')
    } finally {
      setOcupado(false)
    }
  }

  if (!lojaId) return null

  return (
    <section className="kv-rotas kv-rotas-painel">
      <button
        type="button"
        className="kv-botao kv-abrir"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
      >
        <Bike size={20} />
        <span>Entregador</span>
        <Link2 size={18} />
      </button>

      {aberto && (
        <div className="kv-gerenciar">
          <header className="kv-cabecalho">
            <div>
              <h2>Link fixo do entregador</h2>
              <p>
                Envie uma vez. Depois, todo pedido de entrega que ficar <b>Pronto</b>
                aparece automaticamente no celular do motoboy.
              </p>
            </div>
            <button type="button" className="kv-botao" onClick={carregar} disabled={ocupado}>
              <RefreshCw size={18} />
            </button>
          </header>

          {erro && <p className="kv-erro" role="alert">{erro}</p>}

          {status?.ativo && (
            <div className="kv-aviso">
              <strong>Acesso ativo para {status.entregador}.</strong>
              <br />
              Não precisa gerar link a cada pedido. Pedidos prontos entram automaticamente.
            </div>
          )}

          <form onSubmit={gerar} className="kv-form-rota">
            <label>
              Nome do entregador
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={80}
                placeholder="Ex.: João"
                required
              />
            </label>

            <button className="kv-botao kv-primario" disabled={ocupado}>
              {ocupado
                ? 'Aguarde...'
                : status?.ativo
                  ? 'Gerar novo link e substituir o antigo'
                  : 'Gerar link fixo do entregador'}
            </button>
          </form>

          {novoLink && (
            <div className="kv-link-gerado">
              <strong>Link fixo pronto</strong>
              <p>
                Envie este link uma vez para {novoLink.entregador}. A partir daí,
                os pedidos prontos aparecerão sozinhos.
              </p>
              <input ref={linkInput} readOnly value={novoLink.url} onFocus={(e) => e.target.select()} />
              <div className="kv-acoes">
                <button type="button" className="kv-botao kv-primario" onClick={copiar}>
                  <Copy size={17} />
                  {copiado ? 'Copiado!' : 'Copiar link'}
                </button>
                <a className="kv-botao" href={novoLink.url} target="_blank" rel="noreferrer">
                  Conferir tela
                </a>
              </div>
              {['localhost', '127.0.0.1'].includes(new URL(novoLink.url).hostname) && (
                <p className="kv-aviso">
                  Este link é local. Para usar no celular, publique o Food na Vercel
                  e configure VITE_PUBLIC_APP_URL com o endereço publicado.
                </p>
              )}
            </div>
          )}

          {status?.ativo && (
            <button type="button" className="kv-botao" onClick={revogar} disabled={ocupado}>
              <ShieldOff size={17} />
              Encerrar acesso atual
            </button>
          )}
        </div>
      )}
    </section>
  )
}
