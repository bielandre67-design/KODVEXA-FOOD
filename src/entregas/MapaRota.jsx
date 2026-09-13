import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { chaveMapa } from './rotas'

export default function MapaRota({ rota }) {
  const elemento = useRef(null)
  const [erro, setErro] = useState(false)
  useEffect(() => {
    if (!rota || !elemento.current) return
    setErro(false)
    const mapa = L.map(elemento.current, { scrollWheelZoom: false })
    const camada = L.tileLayer(`https://maps.geoapify.com/v1/tile/osm-carto/{z}/{x}/{y}.png?apiKey=${encodeURIComponent(chaveMapa)}`, {
      maxZoom: 19,
      attribution: '<a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">© Geoapify</a> | <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>',
    }).addTo(mapa)
    camada.on('tileerror', () => setErro(true))
    const caminho = L.geoJSON(rota.feature, { style: { color: '#2563eb', weight: 6, opacity: 0.9 } }).addTo(mapa)
    const pontos = [{ ...rota.origem, label: 'Início' }, ...rota.paradas.map((p, i) => ({ ...p, label: String(i + 1) }))]
    pontos.forEach((p, i) => {
      const icone = L.divIcon({ className: 'kv-rota-pin', html: `<span class="${i === 0 ? 'origem' : ''}">${p.label}</span>`, iconSize: [38, 38], iconAnchor: [19, 19] })
      L.marker([p.lat, p.lon], { icon: icone, title: i === 0 ? 'Ponto de partida' : `Parada ${i}` }).addTo(mapa)
    })
    mapa.fitBounds(caminho.getBounds(), { padding: [32, 32], maxZoom: 16 })
    const resize = new ResizeObserver(() => mapa.invalidateSize())
    resize.observe(elemento.current)
    return () => { resize.disconnect(); mapa.remove() }
  }, [rota])
  return <div className="kv-mapa-wrap">
    <div className="kv-mapa" ref={elemento} aria-label="Mapa com o trajeto pelas ruas e as paradas numeradas" />
    {erro && <p role="alert" className="kv-aviso">Não foi possível carregar parte do mapa. Use Abrir navegação se necessário.</p>}
  </div>
}
