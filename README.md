# Porter-style voice booking agent

A browser-based voice assistant that turns an unstructured moving request into a confirmed booking brief.

## Run locally

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env`, set `GROQ_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY`, then run the app. Open the Vite URL shown in the terminal. Use Chrome or Edge for browser speech recognition; typed input works everywhere.

## Approach

The browser transcribes a final spoken turn with the Web Speech API and sends the transcript, prior conversation, and canonical booking state to `POST /api/conversation`. The Express server calls Groq with a strict JSON schema, merges only structured booking updates, validates fields, then returns the natural-language reply plus the cleaned requirements to the website. This makes details order-independent and lets corrections overwrite prior values without exposing the Groq secret to the client.

The default model is `openai/gpt-oss-20b` using Groq Structured Outputs. Change the model in `server.mjs` if your Groq account uses a different supported model.

## Order storage

Run [the included migration](supabase/migrations/001_create_orders.sql) in the Supabase SQL Editor once. A confirmed, complete booking is then saved to `booking_orders` through the Express server. The database secret is server-only; it must never be placed in the browser or a Vite `VITE_*` variable. The client sends a booking session UUID, so a repeat confirmation updates the same order rather than creating a duplicate.

The **Previous orders** button loads the latest 25 confirmed orders and masks their contact numbers. This assessment app has no authentication, so it is intended for a trusted operator dashboard. Add Supabase Auth and filter by the signed-in account before exposing order history to end users.

## Assumptions and limits

- The prototype covers Bengaluru area names and supports future/today schedule language.
- Browser speech recognition quality depends on the installed browser/service.
- Phone, route and address validation are lightweight checks; production should use geocoding, availability and pricing APIs.
- Deploy with Vercel, Netlify, or any static host after `npm run build`; add the public demo URL here before submission.
