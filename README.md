# Saturday Finds

A Polish-language neighborhood sale site. Supabase stores shared items and reservations. Visitors can browse and reserve without payment or an account. The admin panel uses a PIN that is checked by a Supabase Edge Function; reservation contact details are never available through the public database API.

## Local development

Requires Node.js 18 or newer. Run `npm start` and open <http://localhost:3000>. The app always uses Supabase; with an empty `supabase-config.js`, it shows a setup error and does not save data locally.

## Supabase setup

The project is `zqllbflaxblvytxlihci`. To create the database tables from the Supabase website:

1. Open the project in the Supabase Dashboard.
2. Go to **SQL Editor** and create a new query.
3. Copy the complete contents of [`supabase/migrations/20261015000000_garage_sale.sql`](./supabase/migrations/20261015000000_garage_sale.sql) into the query editor and click **Run**.
4. Open **Table Editor** and confirm that `items`, `reservations`, and `admin_pin_failures` exist in the `public` schema.

This migration also configures the access policies, indexes, triggers, and database functions required by the app. Run it once on a new project; do not rerun it if the tables already exist.

Next, deploy the admin Edge Function. In **Edge Functions**, deploy a function named `garage-admin` using the code in [`supabase/functions/garage-admin/index.ts`](./supabase/functions/garage-admin/index.ts). In **Edge Functions → Secrets**, set `SUPABASE_SERVICE_ROLE_KEY` to the project's service-role secret key and set `ADMIN_PIN` to a private value of at least 12 characters. Never put either value in GitHub, source files, or the browser bundle.

In **Project Settings → API Keys**, copy the project's publishable key (starts with `sb_publishable_`) for the website configuration. Do not use the service-role key as the website's publishable key.

In the GitHub repository, open **Settings → Secrets and variables → Actions** and add these repository secrets:

- `SUPABASE_URL`: `https://zqllbflaxblvytxlihci.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY`: the project's publishable key

The Pages workflow deploys the site when changes are pushed to `main`. It requires both secrets and generates `supabase-config.js` during deployment. Publishable keys are meant for browser use; never expose the `service_role` key.

The migration enables row-level security, allows public visitors to read listed items and create reservations, and denies public access to reservation contact details and inventory changes. A database trigger and unique index prevent duplicate active reservations. PIN failures are throttled to five attempts per 15 minutes per client.
