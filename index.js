import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const CALENDLY_TOKEN = process.env.CALENDLY_TOKEN;
const API_BASE = 'https://api.calendly.com';

// ──────────────────────────────────────────────
// Auth helpers
// ──────────────────────────────────────────────

// Extrai user_uuid do JWT sem chamar /users/me (evita precisar do scope users:read).
// O endpoint /users/me requer users:read; o UUID fica no payload do próprio PAT.
function getUserUuidFromToken(token) {
  try {
    const payload = token.split('.')[1];
    // Adiciona padding Base64 se necessário
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
    if (!decoded.user_uuid) throw new Error('user_uuid ausente no token JWT');
    return decoded.user_uuid;
  } catch (err) {
    throw new Error(`Falha ao extrair user_uuid do token: ${err.message}`);
  }
}

let _userUri = null;
function getUserUri() {
  if (_userUri) return _userUri;
  const uuid = getUserUuidFromToken(CALENDLY_TOKEN);
  _userUri = `${API_BASE}/users/${uuid}`;
  return _userUri;
}

// ──────────────────────────────────────────────
// HTTP helpers
// ──────────────────────────────────────────────

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${CALENDLY_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `Calendly API ${res.status} GET ${path}: ${err.message || res.statusText}`
    );
  }
  return res.json();
}

async function apiPost(path, body, base = API_BASE) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CALENDLY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `Calendly API ${res.status} POST ${base}${path}: ${err.message || res.statusText} — ${JSON.stringify(err.details || [])}`
    );
  }
  return res.json();
}

// ──────────────────────────────────────────────
// Utilidades
// ──────────────────────────────────────────────

function uuidFromUri(uri) {
  return uri.split('/').pop();
}

// Calendly exige UTC. Converte qualquer string ISO (com offset ou sem) para UTC ISO.
function toUtc(isoStr) {
  return new Date(isoStr).toISOString();
}

function addMinutes(isoStr, minutes) {
  return new Date(new Date(isoStr).getTime() + minutes * 60_000).toISOString();
}

function buildPrefillUrl(schedulingUrl, { name, email, phone, company, notes }) {
  const url = new URL(schedulingUrl);
  if (name) url.searchParams.set('name', name);
  if (email) url.searchParams.set('email', email);
  if (phone) url.searchParams.set('a1', phone);
  if (company) url.searchParams.set('a2', company);
  if (notes) url.searchParams.set('a3', notes);
  return url.toString();
}

// ──────────────────────────────────────────────
// Definição das tools
// ──────────────────────────────────────────────

const TOOLS = [
  {
    name: 'calendly_list_event_types',
    description:
      'Lista os tipos de evento ativos no Calendly (diagnóstico, apresentação, etc.) com URI, slug, duração e URL pública de agendamento.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'calendly_list_available_slots',
    description:
      'Lista os horários disponíveis para um tipo de evento em um intervalo de datas. Máximo 7 dias por chamada. Retorna horários em UTC.',
    inputSchema: {
      type: 'object',
      properties: {
        event_type_uri: {
          type: 'string',
          description: 'URI completa do tipo de evento (obtida via calendly_list_event_types)',
        },
        start_date: {
          type: 'string',
          description: 'Data de início no formato YYYY-MM-DD (fuso horário de Brasília BRT, UTC-3)',
        },
        end_date: {
          type: 'string',
          description:
            'Data de fim no formato YYYY-MM-DD. Máximo 7 dias após start_date.',
        },
      },
      required: ['event_type_uri', 'start_date', 'end_date'],
    },
  },
  {
    name: 'calendly_schedule',
    description:
      'Agenda uma reunião no Calendly para um convidado via Scheduling API. Se o agendamento direto falhar, retorna URL pré-preenchida para confirmação manual.',
    inputSchema: {
      type: 'object',
      properties: {
        event_type_uri: {
          type: 'string',
          description: 'URI do tipo de evento (obtida via calendly_list_event_types)',
        },
        slot_start_iso: {
          type: 'string',
          description:
            'Horário de início do slot. Aceita ISO 8601 com offset (-03:00) ou UTC (Z). Exemplo: 2026-05-28T09:00:00-03:00',
        },
        invitee_name: { type: 'string', description: 'Nome completo do convidado' },
        invitee_email: { type: 'string', description: 'E-mail do convidado' },
        invitee_phone: {
          type: 'string',
          description: 'Telefone/WhatsApp do convidado (campo "WhatsApp" do formulário)',
        },
        invitee_company: {
          type: 'string',
          description: 'Empresa do convidado (campo "Nome da Empresa" do formulário)',
        },
        invitee_notes: {
          type: 'string',
          description: 'Observações adicionais para o host',
        },
      },
      required: ['event_type_uri', 'slot_start_iso', 'invitee_name', 'invitee_email'],
    },
  },
  {
    name: 'calendly_cancel',
    description: 'Cancela um evento agendado. Requer o UUID do evento (não do invitee).',
    inputSchema: {
      type: 'object',
      properties: {
        event_uuid: {
          type: 'string',
          description:
            'UUID do evento agendado (última parte da URI, ex: abc123-...)',
        },
        reason: { type: 'string', description: 'Motivo do cancelamento' },
      },
      required: ['event_uuid'],
    },
  },
  {
    name: 'calendly_get_event',
    description:
      'Retorna detalhes completos de um evento agendado: horário, status, link Zoom e dados do convidado.',
    inputSchema: {
      type: 'object',
      properties: {
        event_uuid: { type: 'string', description: 'UUID do evento agendado' },
      },
      required: ['event_uuid'],
    },
  },
];

// ──────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────

async function handleListEventTypes() {
  const userUri = getUserUri();
  const data = await apiGet(
    `/event_types?user=${encodeURIComponent(userUri)}&active=true&count=100`
  );
  return {
    event_types: data.collection.map((et) => ({
      uri: et.uri,
      uuid: uuidFromUri(et.uri),
      name: et.name,
      slug: et.slug,
      duration_minutes: et.duration,
      scheduling_url: et.scheduling_url,
      description: et.description_plain || null,
      locations: et.locations,
      custom_questions: et.custom_questions?.map((q) => ({
        position: q.position,
        name: q.name,
        required: q.required,
        type: q.type,
      })),
    })),
  };
}

async function handleListAvailableSlots({ event_type_uri, start_date, end_date }) {
  // Converte datas BRT → início e fim do dia em UTC
  // BRT = UTC-3, então meia-noite BRT = 03:00 UTC
  const startUtc = toUtc(`${start_date}T00:00:00-03:00`);
  const endUtc = toUtc(`${end_date}T23:59:59-03:00`);

  const params = new URLSearchParams({
    event_type: event_type_uri,
    start_time: startUtc,
    end_time: endUtc,
  });

  const data = await apiGet(`/event_type_available_times?${params}`);
  const slots = (data.collection || []).map((s) => ({
    start_time_utc: s.start_time,
    start_time_brt: new Date(s.start_time).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
    }),
    status: s.status,
    invitees_remaining: s.invitees_remaining,
  }));

  return { slots, count: slots.length };
}

async function handleSchedule({
  event_type_uri,
  slot_start_iso,
  invitee_name,
  invitee_email,
  invitee_phone = '',
  invitee_company = '',
  invitee_notes = '',
}) {
  const etUuid = uuidFromUri(event_type_uri);

  // Busca detalhes do event type (duração, URL pública, locations, perguntas)
  const etData = await apiGet(`/event_types/${etUuid}`);
  const { duration, scheduling_url, locations, custom_questions } = etData.resource;

  const startUtc = toUtc(slot_start_iso);
  const endUtc = addMinutes(startUtc, duration);

  // Monta custom_answers mapeando pelos campos reais do formulário
  const customAnswers = buildCustomAnswers(custom_questions || [], {
    phone: invitee_phone,
    company: invitee_company,
    notes: invitee_notes,
  });

  // ── Estratégia primária: Scheduling API (POST /invitees) ──
  let directResult = null;
  let directError = null;

  try {
    const locationKind = locations?.[0]?.kind ?? null;
    const payload = {
      invitee: {
        name: invitee_name,
        email: invitee_email,
        timezone: 'America/Sao_Paulo',
        custom_answers: customAnswers,
      },
      event_type: event_type_uri,
      start_time: startUtc,
    };

    // Inclui location_configuration somente para tipos que não são Zoom integrado.
    // Para zoom_conference, o Calendly resolve automaticamente via integração do usuário.
    if (locationKind && !locationKind.includes('zoom') && !locationKind.includes('conference')) {
      payload.event = {
        location_configuration: { kind: locationKind },
      };
    }

    directResult = await apiPost('/invitees', payload);
  } catch (err) {
    directError = err.message;
  }

  if (directResult) {
    const inviteeUri = directResult?.resource?.uri || null;
    const eventUri = directResult?.resource?.event || null;
    return {
      success: true,
      method: 'direct_api',
      event_type_uri,
      start_time_utc: startUtc,
      end_time_utc: endUtc,
      invitee: { name: invitee_name, email: invitee_email },
      invitee_uri: inviteeUri,
      event_uri: eventUri,
      raw: directResult,
    };
  }

  // ── Fallback: URL pré-preenchida ──
  const prefillUrl = buildPrefillUrl(scheduling_url, {
    name: invitee_name,
    email: invitee_email,
    phone: invitee_phone,
    company: invitee_company,
    notes: invitee_notes,
  });

  return {
    success: false,
    method: 'prefill_url',
    reason: directError,
    prefill_url: prefillUrl,
    slot_start_utc: startUtc,
    slot_end_utc: endUtc,
    invitee: { name: invitee_name, email: invitee_email },
    instructions:
      'Agendamento direto via API falhou. Abra o link no Chrome (ou envie ao convidado). Todos os campos já estão preenchidos.',
  };
}

// Mapeia os campos do formulário pelos nomes canônicos do event type
function buildCustomAnswers(questions, { phone, company, notes }) {
  const answers = [];
  for (const q of questions) {
    const name = q.name?.toLowerCase() || '';
    let value = '';
    if (name.includes('whatsapp') || name.includes('phone') || name.includes('telefone')) {
      value = phone;
    } else if (name.includes('empresa') || name.includes('company')) {
      value = company;
    } else if (name.includes('compartilhe') || name.includes('preparação') || name.includes('nota')) {
      value = notes;
    }
    if (value) answers.push({ position: q.position, value });
  }
  return answers;
}

async function handleCancel({ event_uuid, reason = 'Cancelado pelo agente' }) {
  await apiPost(`/scheduled_events/${event_uuid}/cancellation`, { reason });
  return { success: true, cancelled_event_uuid: event_uuid };
}

async function handleGetEvent({ event_uuid }) {
  const data = await apiGet(`/scheduled_events/${event_uuid}`);
  const ev = data.resource;

  // Busca invitees do evento
  let invitees = [];
  try {
    const inv = await apiGet(`/scheduled_events/${event_uuid}/invitees?count=10`);
    invitees = (inv.collection || []).map((i) => ({
      uuid: uuidFromUri(i.uri),
      uri: i.uri,
      name: i.name,
      email: i.email,
      status: i.status,
      timezone: i.timezone,
      cancel_url: i.cancel_url,
      reschedule_url: i.reschedule_url,
    }));
  } catch (_) {
    // Não falha o get_event se invitees der erro
  }

  return {
    uuid: event_uuid,
    uri: ev.uri,
    name: ev.name,
    status: ev.status,
    start_time_utc: ev.start_time,
    end_time_utc: ev.end_time,
    start_time_brt: new Date(ev.start_time).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
    }),
    location: ev.location,
    event_type: ev.event_type,
    invitees_counter: ev.invitees_counter,
    invitees,
  };
}

// ──────────────────────────────────────────────
// Servidor MCP
// ──────────────────────────────────────────────

const server = new Server(
  { name: 'calendly-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!CALENDLY_TOKEN) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error:
              'CALENDLY_TOKEN não configurado. Defina a variável de ambiente com o Personal Access Token do Calendly.',
          }),
        },
      ],
      isError: true,
    };
  }

  try {
    let result;
    switch (name) {
      case 'calendly_list_event_types':
        result = await handleListEventTypes();
        break;
      case 'calendly_list_available_slots':
        result = await handleListAvailableSlots(args);
        break;
      case 'calendly_schedule':
        result = await handleSchedule(args);
        break;
      case 'calendly_cancel':
        result = await handleCancel(args);
        break;
      case 'calendly_get_event':
        result = await handleGetEvent(args);
        break;
      default:
        throw new Error(`Tool desconhecida: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
