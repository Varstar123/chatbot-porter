import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Mic, MicOff, Send, RotateCcw, CheckCircle2, Volume2, AlertCircle, MapPin, CalendarDays, Package, Truck, ShieldCheck, ChevronRight } from 'lucide-react';
import './styles.css';
import './orders.css';

const initialBooking = { service: 'Moving & delivery', pickup: '', drop: '', date: '', time: '', items: '', vehicle: '', contact: '', notes: '' };
const fields = [['pickup', 'Pickup location', MapPin], ['drop', 'Drop location', MapPin], ['date', 'Pickup date', CalendarDays], ['time', 'Pickup time', CalendarDays], ['items', 'What are you moving?', Package], ['vehicle', 'Recommended vehicle', Truck], ['contact', 'Contact number', ShieldCheck]];
const missing = booking => ['pickup', 'drop', 'date', 'time', 'items', 'contact'].filter(key => !booking[key]);
const prettyTime = time => time && /^\d{2}:\d{2}$/.test(time) ? new Date(`2000-01-01T${time}`).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : time;

function App() {
  const [booking, setBooking] = useState(initialBooking);
  const [messages, setMessages] = useState([{ role: 'agent', text: 'Hi, I’m Porter’s booking assistant. Tell me what you need moved, and I’ll take care of the details.' }]);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [issues, setIssues] = useState([]);
  const [orderId, setOrderId] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [orders, setOrders] = useState([]);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const recognition = useRef(null);
  const clientSessionId = useRef(crypto.randomUUID());
  const complete = !missing(booking).length;
  const progress = ((7 - missing(booking).length) / 7) * 100;

  async function sendTurn(text) {
    if (!text.trim() || waiting) return;
    const userMessage = { role: 'user', text: text.trim() };
    setMessages(previous => [...previous, userMessage]);
    setInput(''); setWaiting(true); setIssues([]);
    try {
      const response = await fetch('/api/conversation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: userMessage.text, booking, history: messages, clientSessionId: clientSessionId.current }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The booking assistant could not respond.');
      setBooking(result.booking); setConfirmed(result.isConfirmed); setOrderId(result.orderId || ''); setIssues(result.validationIssues || []);
      setMessages(previous => [...previous, { role: 'agent', text: result.assistantMessage }]);
      if (audioEnabled) speakText(result.assistantMessage);
    } catch (error) {
      const message = error.message || 'I could not process that. Please try again.';
      setMessages(previous => [...previous, { role: 'agent', text: message }]);
      if (audioEnabled) speakText(message);
    }
    finally { setWaiting(false); }
  }

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const instance = new SpeechRecognition(); instance.lang = 'en-IN'; instance.interimResults = false;
    instance.onresult = event => { setListening(false); sendTurn(event.results[0][0].transcript); };
    instance.onerror = () => setListening(false); instance.onend = () => setListening(false); recognition.current = instance;
  }, [booking, messages, waiting]);
  function speakText(text) {
    if (!text || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-IN'; utterance.rate = 1;
    speechSynthesis.speak(utterance);
  }
  function reset() { setBooking(initialBooking); setMessages([{ role: 'agent', text: 'Fresh start. Where would you like to move something?' }]); setConfirmed(false); setOrderId(''); setIssues([]); clientSessionId.current = crypto.randomUUID(); }
  async function loadOrders() {
    setOrdersOpen(true); setOrdersLoading(true); setOrdersError('');
    try { const response = await fetch('/api/orders'); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not load previous orders.'); setOrders(result.orders || []); }
    catch (error) { setOrdersError(error.message); }
    finally { setOrdersLoading(false); }
  }

  return <main>
    <section className="hero"><div className="brand"><div className="logo">P</div><span>porter</span><small>VOICE ASSISTANT</small></div><button className="orders-link" onClick={loadOrders}>Previous orders</button><div className="hero-copy"><p className="eyebrow">BOOK A MOVE BY VOICE</p><h1>Say where. We’ll<br/><em>move the rest.</em></h1><p>Talk naturally — your booking is built as you speak.</p></div><div className="trust"><ShieldCheck size={18}/><span>Safe, simple, on time</span></div></section>
    <section className="workspace"><div className="conversation"><div className="section-head"><div><p className="eyebrow">CONVERSATION</p><h2>Your booking assistant</h2></div><button className={`sound ${audioEnabled ? '' : 'muted'}`} onClick={() => { setAudioEnabled(value => !value); if (audioEnabled && 'speechSynthesis' in window) speechSynthesis.cancel(); }} aria-label={audioEnabled ? 'Mute automatic replies' : 'Enable automatic replies'}>{audioEnabled ? <Volume2 size={18}/> : <MicOff size={18}/>}</button></div><div className="messages">{messages.map((message, index) => <div className={`message ${message.role}`} key={index}>{message.role === 'agent' && <div className="avatar">P</div>}<div>{message.text}</div></div>)}{waiting && <div className="message agent"><div className="avatar">P</div><div>Thinking…</div></div>}</div><div className="quick"><button disabled={waiting} onClick={() => sendTurn('I need to move a sofa and 4 boxes from Koramangala to Whitefield tomorrow at 6 pm')}>Try an example <ChevronRight size={14}/></button></div><form className="composer" onSubmit={event => { event.preventDefault(); sendTurn(input); }}><button type="button" disabled={waiting} className={`mic ${listening ? 'active' : ''}`} onClick={() => { if ('speechSynthesis' in window) speechSynthesis.cancel(); if (recognition.current && !listening) { setListening(true); recognition.current.start(); } }} aria-label="Stop reply and speak">{listening ? <MicOff size={20}/> : <Mic size={20}/>}</button><input disabled={waiting} value={input} onChange={event => setInput(event.target.value)} placeholder={listening ? 'Listening…' : waiting ? 'Processing your request…' : 'Type or use the microphone'} /><button disabled={waiting} className="send" aria-label="Send"><Send size={18}/></button></form><p className="tip">{recognition.current ? 'Tap the microphone to interrupt the reply and start speaking.' : 'Voice input is not supported in this browser. You can still type your request.'}</p></div>
    <aside className="summary"><div className="summary-top"><div><p className="eyebrow">LIVE REQUIREMENTS</p><h2>Booking details</h2></div><button className="reset" onClick={reset}><RotateCcw size={16}/> Reset</button></div><div className="progress"><span style={{ width: `${progress}%` }}/></div><p className="progress-label">{complete ? 'Ready for your review' : 'Still gathering a few details'}</p><div className="fields">{fields.map(([key, label, Icon]) => <div className={`field ${booking[key] ? 'filled' : ''}`} key={key}><Icon size={17}/><div><span>{label}</span><strong>{key === 'time' ? prettyTime(booking[key]) || 'Not provided yet' : booking[key] || 'Not provided yet'}</strong></div>{booking[key] && <CheckCircle2 size={17}/>}</div>)}</div>{issues.length > 0 && <div className="issues"><AlertCircle size={17}/><span>{issues[0]}</span></div>}{complete && <div className={`review ${confirmed ? 'confirmed' : ''}`}><CheckCircle2 size={20}/><div><strong>{confirmed ? 'Booking confirmed' : 'Ready to confirm'}</strong><p>{confirmed ? `Order saved • ${orderId.slice(0, 8)}` : 'Review the details, then tell the assistant “confirm”.'}</p></div></div>}<div className="assistant-note"><AlertCircle size={15}/><span>Groq understands the conversation; the server validates every booking update before it is shown.</span></div></aside></section>
    {ordersOpen && <div className="orders-panel" role="dialog" aria-modal="true" aria-label="Previous orders"><div className="orders-drawer"><div className="orders-title"><div><p className="eyebrow">CONFIRMED BOOKINGS</p><h2>Previous orders</h2></div><button className="orders-close" onClick={() => setOrdersOpen(false)} aria-label="Close previous orders">Close</button></div>{ordersLoading && <p className="orders-empty">Loading orders…</p>}{ordersError && <p className="orders-error">{ordersError}</p>}{!ordersLoading && !ordersError && orders.length === 0 && <p className="orders-empty">No confirmed orders yet.</p>}{orders.map(order => <article className="order-card" key={order.id}><div className="order-route">{order.pickup}<span>→</span>{order.drop_location}</div><div className="order-meta"><span>{order.pickup_date} · {order.pickup_time}</span><span>{order.items}</span>{order.vehicle && <span>{order.vehicle}</span>}<span>{order.contact}</span></div><p className="order-date">Confirmed {new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p></article>)}</div></div>}
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
