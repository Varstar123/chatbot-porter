import 'dotenv/config';
import express from 'express';
import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const app = express();
const port = Number(process.env.PORT || 8787);
const emptyBooking = { service: 'Moving & delivery', pickup: '', drop: '', date: '', time: '', items: '', vehicle: '', contact: '', notes: '' };
const editableFields = ['pickup', 'drop', 'date', 'time', 'items', 'vehicle', 'contact', 'notes'];
const requiredFields = ['pickup', 'drop', 'date', 'time', 'items', 'contact'];
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabase = supabaseUrl && process.env.SUPABASE_SECRET_KEY
  ? createClient(supabaseUrl, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

app.use(express.json({ limit: '100kb' }));

const responseSchema = {
  name: 'booking_agent_turn', strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      assistantMessage: { type: 'string' },
      bookingPatch: {
        type: 'object', additionalProperties: false,
        properties: Object.fromEntries(editableFields.map(key => [key, { type: 'string' }])),
        required: editableFields
      },
      validationIssues: { type: 'array', items: { type: 'string' } },
      requiresConfirmation: { type: 'boolean' },
      isConfirmed: { type: 'boolean' }
    },
    required: ['assistantMessage', 'bookingPatch', 'validationIssues', 'requiresConfirmation', 'isConfirmed']
  }
};

const systemPrompt = `You are Porter, a warm, concise Indian moving-service booking assistant. Your job is to gather a complete booking: pickup, drop, pickup date, pickup time, items/load, suitable vehicle, and a 10 digit contact number. The user may provide data in any order and may correct an earlier detail.

Use the CURRENT BOOKING as the source of truth, then apply only changes explicitly stated by the user. Never invent an address, date, time, contact number, or items. Ask only for the most useful missing or ambiguous detail. Treat relative dates using today's date supplied in the user message. Never accept a past date. Flag vague location or unclear speech as a validation issue and ask them to repeat it with an area/landmark. If they provide an impossible load or unsupported request, explain it plainly. Recommend a three-wheeler for light parcels and a mini truck for furniture/appliances, but ask if uncertain.

Return only JSON matching the schema. bookingPatch MUST contain every editable field. Put an empty string for a field you are not changing. A booking can only be confirmed when all required fields are present and there are no validation issues. Do not claim a driver has been assigned or a price has been calculated.`;

function cleanPatch(patch, current) {
  const next = { ...emptyBooking, ...current };
  const issues = [];
  for (const field of editableFields) {
    const value = typeof patch[field] === 'string' ? patch[field].trim() : '';
    if (value) next[field] = value;
  }
  if (next.contact && !/^[6-9]\d{9}$/.test(next.contact.replace(/\D/g, ''))) {
    next.contact = current.contact || '';
    issues.push('Please share a valid 10-digit Indian contact number.');
  } else if (next.contact) next.contact = next.contact.replace(/\D/g, '');
  if (next.pickup && next.drop && next.pickup.toLowerCase() === next.drop.toLowerCase()) issues.push('Pickup and drop cannot be the same. Please confirm the destination.');
  if (next.date && /yesterday|last week|past/i.test(next.date)) {
    next.date = current.date || '';
    issues.push('Please choose an upcoming pickup date.');
  }
  return { booking: next, issues };
}

async function saveConfirmedOrder(booking, clientSessionId) {
  if (!supabase) throw new Error('Order storage is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY to .env.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientSessionId || '')) throw new Error('Invalid booking session. Please refresh and try again.');
  const { data, error } = await supabase.from('booking_orders').upsert({
    client_session_id: clientSessionId,
    service: booking.service,
    pickup: booking.pickup,
    drop_location: booking.drop,
    pickup_date: booking.date,
    pickup_time: booking.time,
    items: booking.items,
    vehicle: booking.vehicle || null,
    contact: booking.contact,
    notes: booking.notes || null,
    status: 'confirmed'
  }, { onConflict: 'client_session_id' }).select('id').single();
  if (error) throw new Error(`Could not save order: ${error.message}`);
  return data.id;
}

app.post('/api/conversation', async (req, res) => {
  const { transcript, booking = emptyBooking, history = [], clientSessionId } = req.body || {};
  if (typeof transcript !== 'string' || !transcript.trim()) return res.status(400).json({ error: 'Please provide a message or voice transcript.' });
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'The booking assistant is not configured. Add GROQ_API_KEY to .env and restart the server.' });
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, timeout: 15000, maxRetries: 1 });
    const today = new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeZone: 'Asia/Kolkata' }).format(new Date());
    const safeHistory = Array.isArray(history) ? history.slice(-10).filter(m => m && ['user', 'agent'].includes(m.role) && typeof m.text === 'string').map(m => ({ role: m.role === 'agent' ? 'assistant' : 'user', content: m.text.slice(0, 1000) })) : [];
    const completion = await groq.chat.completions.create({
      model: 'openai/gpt-oss-20b', temperature: 0.2,
      response_format: { type: 'json_schema', json_schema: responseSchema },
      messages: [
        { role: 'system', content: systemPrompt },
        ...safeHistory,
        { role: 'user', content: `TODAY: ${today}\nCURRENT BOOKING: ${JSON.stringify({ ...emptyBooking, ...booking })}\nLATEST USER TRANSCRIPT: ${transcript}` }
      ]
    });
    const data = JSON.parse(completion.choices[0]?.message?.content || '{}');
    const cleaned = cleanPatch(data.bookingPatch || {}, booking);
    const isComplete = requiredFields.every(field => cleaned.booking[field]);
    const canConfirm = Boolean(data.isConfirmed) && isComplete && ![...(data.validationIssues || []), ...cleaned.issues].length;
    let orderId = null;
    if (canConfirm) orderId = await saveConfirmedOrder(cleaned.booking, clientSessionId);
    res.json({
      booking: cleaned.booking,
      assistantMessage: data.assistantMessage || 'Could you say that once more?',
      validationIssues: [...new Set([...(data.validationIssues || []), ...cleaned.issues])],
      requiresConfirmation: Boolean(data.requiresConfirmation),
      isConfirmed: canConfirm,
      orderId
    });
  } catch (error) {
    console.error('Groq conversation error:', error?.message);
    res.status(502).json({ error: 'I could not reach the booking assistant. Please try again in a moment.' });
  }
});

app.get('/api/orders', async (_req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Order storage is not configured.' });
  const { data, error } = await supabase.from('booking_orders')
    .select('id, pickup, drop_location, pickup_date, pickup_time, items, vehicle, contact, status, created_at')
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(25);
  if (error) return res.status(502).json({ error: 'Could not load previous orders.' });
  res.json({ orders: data.map(order => ({ ...order, contact: `******${order.contact.slice(-4)}` })) });
});

const root = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(root, 'dist')));
app.get(/.*/, (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
app.listen(port, () => console.log(`Booking API listening on http://localhost:${port}`));
