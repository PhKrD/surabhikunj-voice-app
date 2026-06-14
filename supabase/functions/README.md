# Edge Functions

## notify-whatsapp

Sends a WhatsApp message via a provider. **Twilio is implemented**; WATI (or
others) can be added in `notify-whatsapp/index.ts`.

### 1) Prerequisites
- Supabase CLI installed and logged in:
  ```bash
  npm install -g supabase   # or: brew install supabase/tap/supabase
  supabase login
  supabase link --project-ref <your-project-ref>
  ```

### 2) Set provider secrets
```bash
supabase secrets set \
  WHATSAPP_PROVIDER=twilio \
  TWILIO_ACCOUNT_SID=ACxxxxxxxx \
  TWILIO_AUTH_TOKEN=xxxxxxxx \
  TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

### 3) Deploy
```bash
supabase functions deploy notify-whatsapp
```
By default the function requires a valid Supabase JWT to invoke (good — invoke
it from a signed-in client). For unauthenticated/server use, deploy with
`--no-verify-jwt` and protect it another way.

### 4) Invoke from the app
```js
import { sendWhatsApp } from '@/lib/whatsapp'

await sendWhatsApp({ to: '+9198XXXXXXXX', message: 'Hare Krishna Prabhu' })
```

### Automating (optional)
- After posting an announcement, loop over opted-in recipients' `profiles.phone`
  and call `sendWhatsApp` for each.
- Or use a Postgres trigger + `pg_net` (`net.http_post`) to call the function's
  URL on insert, storing the function URL + a service token in DB settings.

### Notes
- Recipients must have opted in to WhatsApp. Twilio's sandbox requires joining;
  production needs an approved sender and message templates.
- Store phone numbers in E.164 format (e.g. `+9198XXXXXXXX`).
- Never commit real provider credentials — they live in Supabase secrets.
