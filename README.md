# Saturday Finds

A Polish-language neighborhood sale site. Supabase stores shared items and reservations. Visitors can browse and reserve without payment or an account. The admin panel uses a PIN that is checked by a Supabase Edge Function; reservation contact details are never available through the public database API.

## Local development

Requires Node.js 18 or newer. Run `npm start` and open <http://localhost:3000>. With the empty `supabase-config.js`, the app uses browser storage for local testing only.

## Supabase setup

The project is `zqllbflaxblvytxlihci`. Install/use the Supabase CLI, sign in, link this project, and apply the schema:

```sh
npx supabase login
npx supabase link --project-ref zqllbflaxblvytxlihci
npx supabase db push
```

In Supabase **Project Settings → API Keys**, copy the `service_role` secret key into **Edge Functions → Secrets** as `SUPABASE_SERVICE_ROLE_KEY`. Add `ADMIN_PIN` there too; choose at least 12 random characters. Never put either value in GitHub, source files, or the browser bundle. Then deploy the admin function:

```sh
npx supabase functions deploy garage-admin
```

The migration enables row-level security, allows public visitors to read listed items and create reservations, and denies public access to reservation contact details and inventory changes. A database trigger and unique index prevent duplicate active reservations. PIN failures are throttled to five attempts per 15 minutes per client.
