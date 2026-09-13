const chaveMapa = import.meta.env.VITE_GEOAPIFY_API_KEY
export { chaveMapa }
export const ativo = (p) => p.ativo === true
export const dinheiro = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function telefoneBrasil(valor) {
  const n = String(valor || '').replace(/\D/g, '')
  if (/^\d{10,11}$/.test(n)) return `55${n}`
  return /^55\d{10,11}$/.test(n) ? n : ''
}

export function enderecoPedido(p) {
  const endereco = String(p.endereco_entrega || '').trim()
  const numero = String(p.numero_entrega || '').trim()
  // O checkout atual já grava rua, número, bairro, cidade e CEP no endereço.
  const jaTemNumero = numero && endereco.split(',').some((parte) => parte.trim() === numero)
  return [endereco, !jaTemNumero ? numero : '', p.cep_entrega && !endereco.replace(/\D/g, '').includes(String(p.cep_entrega).replace(/\D/g, '')) ? p.cep_entrega : ''].filter(Boolean).join(', ')
}

export function linkNavegacao(p) {
  const parametros = new URLSearchParams({ api: '1', destination: enderecoPedido(p), travelmode: 'driving', dir_action: 'navigate' })
  return `https://www.google.com/maps/dir/?${parametros}`
}

async function lerMapa(url, signal) {
  const res = await fetch(url, { signal, cache: 'no-store', referrerPolicy: 'strict-origin-when-cross-origin' })
  if (!res.ok) throw new Error(res.status === 429
    ? 'O serviço de mapas atingiu o limite de consultas. Tente novamente mais tarde ou use Abrir navegação.'
    : 'O serviço de mapas não respondeu. Confira a chave e as permissões do Geoapify.')
  return res.json()
}

export async function localizar(endereco, cep, signal) {
  if (!chaveMapa) throw new Error('O mapa ainda não foi configurado pela loja.')
  if (!endereco?.trim()) throw new Error('Falta o endereço de saída da loja.')
  const query = new URLSearchParams({ text: endereco, format: 'json', limit: '5', filter: 'countrycode:br', apiKey: chaveMapa })
  const dados = await lerMapa(`https://api.geoapify.com/v1/geocode/search?${query}`, signal)
  const esperado = String(cep || '').replace(/\D/g, '')
  const candidato = (dados.results || []).find((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon)
    && (!esperado || String(r.postcode || '').replace(/\D/g, '') === esperado)
    && ['building', 'amenity', 'street'].includes(r.result_type)
    && (r.rank?.confidence_street_level ?? r.rank?.confidence ?? 0) >= 0.7)
  if (!candidato) throw new Error(`Não foi possível confirmar este endereço no mapa: ${endereco}. Confira com a loja antes de sair.`)
  return { lat: candidato.lat, lon: candidato.lon, aproximado: candidato.result_type !== 'building', endereco: candidato.formatted }
}

export async function calcularMapa(origem, paradas, signal) {
  const pontos = [origem, ...paradas]
  const query = new URLSearchParams({ waypoints: pontos.map((p) => `${p.lat},${p.lon}`).join('|'), mode: 'motorcycle', lang: 'pt-BR', units: 'metric', apiKey: chaveMapa })
  const dados = await lerMapa(`https://api.geoapify.com/v1/routing?${query}`, signal)
  const feature = dados.features?.[0]
  if (!feature?.geometry?.coordinates?.length || !['MultiLineString','LineString'].includes(feature.geometry.type)
    || !Number.isFinite(feature.properties?.distance) || !Number.isFinite(feature.properties?.time)) {
    throw new Error('O mapa não encontrou um trajeto pelas ruas. Confira os endereços ou use Abrir navegação.')
  }
  return { feature, distancia: feature.properties.distance, tempo: feature.properties.time, origem, paradas }
}
