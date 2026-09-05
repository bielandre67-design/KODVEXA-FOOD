function somenteDigitos(valor = '') {
  return String(valor).replace(/\D/g, '')
}

function telefoneBrasil(valor = '') {
  let numero = somenteDigitos(valor)
  if (!numero) return ''
  if (!numero.startsWith('55') && (numero.length === 10 || numero.length === 11)) {
    numero = `55${numero}`
  }
  return numero
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' })
  }

  const token = process.env.META_WHATSAPP_TOKEN
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID
  const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0'
  const templateSaiuEntrega = process.env.WHATSAPP_TEMPLATE_SAIU_ENTREGA

  if (!token || !phoneNumberId || !templateSaiuEntrega) {
    return res.status(500).json({
      error: 'WhatsApp não configurado. Defina META_WHATSAPP_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_TEMPLATE_SAIU_ENTREGA.'
    })
  }

  const {
    evento,
    numero,
    cliente_nome,
    cliente_telefone,
    total
  } = req.body || {}

  if (evento !== 'saiu_entrega') {
    return res.status(400).json({ error: 'Evento não suportado.' })
  }

  const destino = telefoneBrasil(cliente_telefone)
  if (!destino) {
    return res.status(400).json({ error: 'Telefone do cliente inválido.' })
  }

  const valor = Number(total || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })

  const payload = {
    messaging_product: 'whatsapp',
    to: destino,
    type: 'template',
    template: {
      name: templateSaiuEntrega,
      language: { code: 'pt_BR' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: String(cliente_nome || 'Cliente') },
            { type: 'text', text: String(numero || '') },
            { type: 'text', text: valor }
          ]
        }
      ]
    }
  }

  try {
    const resposta = await fetch(
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    )

    const dados = await resposta.json().catch(() => ({}))

    if (!resposta.ok) {
      console.error('Erro Meta WhatsApp:', dados)
      return res.status(resposta.status).json({
        error: dados?.error?.message || 'A Meta recusou o envio da mensagem.'
      })
    }

    return res.status(200).json({ ok: true, message_id: dados?.messages?.[0]?.id || null })
  } catch (e) {
    console.error('Falha ao enviar WhatsApp:', e)
    return res.status(500).json({ error: 'Falha ao conectar com a API do WhatsApp.' })
  }
}
