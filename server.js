// AgendaJá — Backend (Node.js + Express)
// Instalar dependências: npm install express twilio dotenv cors

require('dotenv').config();
const express = require('express');
const twilio  = require('twilio');
const cors    = require('cors');

const app    = express();
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // serve o index.html

// ── Base de dados em memória (substituir por PostgreSQL/MongoDB em produção) ──
const agendamentos = [];
let nextId = 1;

// ── ROTAS ──

// GET /api/agendamentos — listar todos
app.get('/api/agendamentos', (req, res) => {
  res.json(agendamentos);
});

// POST /api/agendamentos — criar novo
app.post('/api/agendamentos', async (req, res) => {
  try {
    const { nome, telefone, servico, data, hora, preco } = req.body;

    if (!nome || !telefone || !servico || !data || !hora) {
      return res.status(400).json({ erro: 'Campos obrigatórios em falta' });
    }

    const ag = {
      id: nextId++,
      nome, telefone, servico, data, hora, preco,
      status: 'confirmado',
      criadoEm: new Date().toISOString()
    };

    agendamentos.push(ag);

    // Enviar WhatsApp de confirmação
    await enviarWhatsApp(
      telefone,
      `Olá ${nome}! ✅\n` +
      `O teu agendamento está confirmado:\n` +
      `📋 ${servico}\n` +
      `📅 ${formatarData(data)} às ${hora}\n` +
      `💰 ${preco}\n\n` +
      `Para cancelar, responde CANCELAR.\n` +
      `— AgendaJá`
    );

    res.status(201).json({ mensagem: 'Agendamento criado!', agendamento: ag });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar agendamento' });
  }
});

// PUT /api/agendamentos/:id/cancelar
app.put('/api/agendamentos/:id/cancelar', async (req, res) => {
  const ag = agendamentos.find(a => a.id === parseInt(req.params.id));
  if (!ag) return res.status(404).json({ erro: 'Não encontrado' });

  ag.status = 'cancelado';

  await enviarWhatsApp(
    ag.telefone,
    `Olá ${ag.nome},\n` +
    `O teu agendamento de ${formatarData(ag.data)} às ${ag.hora} foi cancelado. ❌\n` +
    `Para reagendar: ${process.env.APP_URL}/agendar\n` +
    `— AgendaJá`
  );

  res.json({ mensagem: 'Cancelado com sucesso', agendamento: ag });
});

// GET /api/horarios — horários disponíveis para uma data
app.get('/api/horarios', (req, res) => {
  const { data } = req.query;
  const todos = ['08:00','09:00','10:00','11:00','13:00','14:00','15:00','16:00','17:00'];
  const ocupados = agendamentos
    .filter(a => a.data === data && a.status !== 'cancelado')
    .map(a => a.hora);

  const disponiveis = todos.map(h => ({
    hora: h,
    disponivel: !ocupados.includes(h)
  }));

  res.json(disponiveis);
});

// ── LEMBRETES (chamar com cron job às 9h todos os dias) ──
app.post('/api/lembretes/enviar', async (req, res) => {
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  const dataAmanha = amanha.toISOString().split('T')[0];

  const paraLembrar = agendamentos.filter(
    a => a.data === dataAmanha && a.status === 'confirmado'
  );

  const resultados = await Promise.allSettled(
    paraLembrar.map(ag =>
      enviarWhatsApp(
        ag.telefone,
        `Lembrete 🔔\n` +
        `Olá ${ag.nome}, tens agendamento amanhã:\n` +
        `📋 ${ag.servico} às ${ag.hora}\n\n` +
        `Confirma respondendo SIM ou cancela com CANCELAR.\n` +
        `— AgendaJá`
      )
    )
  );

  res.json({
    enviados: resultados.filter(r => r.status === 'fulfilled').length,
    erros: resultados.filter(r => r.status === 'rejected').length
  });
});

// ── WEBHOOK WhatsApp (receber respostas dos clientes) ──
app.post('/api/whatsapp/webhook', async (req, res) => {
  const mensagem = (req.body.Body || '').toUpperCase().trim();
  const de = req.body.From?.replace('whatsapp:', '');

  if (mensagem === 'CANCELAR') {
    const ag = agendamentos.find(
      a => a.telefone === de && a.status === 'confirmado'
    );
    if (ag) {
      ag.status = 'cancelado';
      await enviarWhatsApp(de, `Agendamento cancelado com sucesso. Obrigado! 👋`);
    } else {
      await enviarWhatsApp(de, `Não encontrámos agendamento activo. Liga para remarcar.`);
    }
  } else if (mensagem === 'SIM') {
    await enviarWhatsApp(de, `Perfeito! Até amanhã. 👍`);
  } else {
    await enviarWhatsApp(de, `Olá! Para agendar: ${process.env.APP_URL}\nPara cancelar, responde CANCELAR.`);
  }

  res.sendStatus(200);
});

// ── HELPERS ──

async function enviarWhatsApp(telefone, mensagem) {
  return client.messages.create({
    from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
    to:   `whatsapp:${telefone}`,
    body: mensagem
  });
}

function formatarData(data) {
  return new Date(data + 'T12:00:00').toLocaleDateString('pt-MZ', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
}

// ── INICIAR SERVIDOR ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AgendaJá a correr em http://localhost:${PORT}`);
});
