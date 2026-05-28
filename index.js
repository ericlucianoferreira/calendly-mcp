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

// Garante formato internacional +55 para o Calendly pré-selecionar Brasil.
// Sem o +55, o campo phone assume US (+1) e falha na validação.
function normalizeBrPhone(phone) {
  if (!phone) return phone;
  const digits = phone.replace(/\D/g, '');
  if (phone.startsWith('+')) return phone; // já tem código de país
  if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`;
  return `+55${digits}`;
}

function buildPrefillUrl(schedulingUrl, { name, email, phone, company, notes }) {
  const url = new URL(schedulingUrl);
  if (name) url.searchParams.set('name', name);
  if (email) url.searchParams.set('email', email);
  if (phone) url.searchParams.set('a1', normalizeBrPhone(phone));
  if (company) url.searchParams.set('a2', company);
  if (notes) url.searchParams.set('a3', notes);
  return url.toString();
}

// ──────────────────────────────────────────────
// Definição das tools
// ──────────────────────────────────────────────

const TOOLS = [
  {
    name: 'calendly_create_one_off_link',
    description:
      'Cria um link de agendamento personalizado e single-use com nome, duração e restrição de datas customizados. O convidado escolhe entre os horários disponíveis de Eric dentro do intervalo de datas definido. Use quando quiser oferecer um link com título ou duração diferentes do padrão, ou restringir a data.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Nome/título da reunião (ex: "Diagnóstico — João Silva | Empresa XYZ")',
        },
        duration_minutes: {
          type: 'number',
          description: 'Duração em minutos. Valores aceitos: 15, 30, 60, 90.',
        },
        start_date: {
          type: 'string',
          description: 'Data de início do período disponível (YYYY-MM-DD)',
        },
        end_date: {
          type: 'string',
          description: 'Data de fim do período disponível (YYYY-MM-DD). Igual ao start_date para restringir a um único dia.',
        },
        location_label: {
          type: 'string',
          description: 'Texto do local (ex: "Zoom — link enviado na confirmação"). Padrão: "Zoom — link enviado após confirmação."',
        },
        max_uses: {
          type: 'number',
          description: 'Máximo de usos do link. Padrão: 1 (single-use).',
        },
      },
      required: ['name', 'duration_minutes', 'start_date', 'end_date'],
    },
  },
  {
    name: 'calendly_create_scheduling_link',
    description:
      'Cria um link de agendamento único (single-use) para um tipo de evento existente. O convidado escolhe o próprio horário disponível. Após um agendamento, o link expira automaticamente. Ideal para disparar via WhatsApp ou e-mail para leads.',
    inputSchema: {
      type: 'object',
      properties: {
        event_type_uri: {
          type: 'string',
          description: 'URI do tipo de evento (obtida via calendly_list_event_types)',
        },
        max_uses: {
          type: 'number',
          description: 'Número máximo de usos antes de expirar. Padrão: 1 (single-use).',
        },
      },
      required: ['event_type_uri'],
    },
  },
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

async function handleCreateOneOffLink({
  name,
  duration_minutes,
  start_date,
  end_date,
  location_label = 'Zoom — link enviado após confirmação.',
  max_uses = 1,
}) {
  const userUri = getUserUri();

  // Validação: Calendly só aceita 15, 30, 60, 90 (não aceita 45 nem outros)
  const validDurations = [15, 30, 60, 90];
  if (!validDurations.includes(duration_minutes)) {
    throw new Error(
      `Duração ${duration_minutes}min não é suportada pela Calendly API. Use: ${validDurations.join(', ')}.`
    );
  }

  // Cria o one_off_event_type com configurações customizadas
  const eventType = await apiPost('/one_off_event_types', {
    name,
    host: userUri,
    duration: duration_minutes,
    timezone: 'America/Sao_Paulo',
    date_setting: {
      type: 'date_range',
      start_date,
      end_date,
    },
    location: {
      kind: 'custom',
      location: location_label,
    },
  });

  const eventTypeUri = eventType.resource?.uri;
  if (!eventTypeUri) {
    throw new Error(`Falha ao criar one_off_event_type: ${JSON.stringify(eventType)}`);
  }

  // Cria scheduling_link single-use a partir do one_off_event_type
  const link = await apiPost('/scheduling_links', {
    max_event_count: max_uses,
    owner: eventTypeUri,
    owner_type: 'EventType',
  });

  const bookingUrl = link.resource?.booking_url;

  // Busca os slots disponíveis no período para informar ao agente
  const startUtc = new Date(`${start_date}T00:00:00-03:00`).toISOString();
  const endUtc = new Date(`${end_date}T23:59:59-03:00`).toISOString();
  const params = new URLSearchParams({ event_type: eventTypeUri, start_time: startUtc, end_time: endUtc });
  const slotsData = await apiGet(`/event_type_available_times?${params}`);
  const slots = (slotsData.collection || []).map((s) => ({
    start_time_utc: s.start_time,
    start_time_brt: new Date(s.start_time).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
    }),
    status: s.status,
  }));

  return {
    booking_url: bookingUrl,
    max_uses,
    event_name: name,
    duration_minutes,
    date_range: { start_date, end_date },
    available_slots: slots,
    slots_count: slots.length,
    instructions: `Link single-use gerado. ${slots.length} horários disponíveis no período. Após ${max_uses} agendamento(s), o link expira.`,
  };
}

async function handleCreateSchedulingLink({ event_type_uri, max_uses = 1 }) {
  const data = await apiPost('/scheduling_links', {
    max_event_count: max_uses,
    owner: event_type_uri,
    owner_type: 'EventType',
  });

  const link = data.resource;
  return {
    booking_url: link.booking_url,
    max_event_count: link.max_event_count,
    owner_uri: link.owner,
    expires_at: link.expires_at || null,
    instructions: `Envie este link ao convidado via WhatsApp ou e-mail. Após ${max_uses} agendamento(s) o link expira automaticamente.`,
  };
}

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
      case 'calendly_create_one_off_link':
        result = await handleCreateOneOffLink(args);
        break;
      case 'calendly_create_scheduling_link':
        result = await handleCreateSchedulingLink(args);
        break;
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
