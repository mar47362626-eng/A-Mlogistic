# A&M Logistics website

The customer site (`index.html`), rider portal (`rider.html`), and admin pages remain separate. Express serves them and provides a shared API so accounts, delivery requests, rider reviews, assignments, and notifications work across browsers and devices.

The production web app is served from Render at `https://a-mlogistic.onrender.com`. The frontend API client uses that URL; the server also hosts the frontend, so use the Render URL for the public site. Admin and rider pages are available at `/admin` and `/rider`; old `/admin.html` and `/rider.html` links redirect to these clean paths.

## Run locally on Windows

1. Install Node.js 22.13 or newer.
2. In PowerShell, run `npm.cmd install`.
3. Copy `.env.example` to `.env`, set a private admin email and a unique password of at least 12 characters, and configure the Brevo API key and a verified sender email.
4. Run `npm.cmd start`.
5. Open `http://localhost:3000` in a browser. Do not open the HTML files directly or use a static-only preview server; the API must be running.

In development, the server creates and updates `data\users.json`, `data\riders.json`, `data\orders.json`, `data\notifications.json`, and `data\sessions.json`. The first server startup imports existing records from `data\ao-logistics.sqlite` when that database exists; the SQLite file is left in place as a backup. Customer and rider passwords are hashed on the server, and package photos are stored with their orders.

## Supabase production database

Production, including the app running on Render, uses Supabase PostgreSQL. The app will not silently fall back to local JSON files on Render, even if `NODE_ENV` is missing. In Supabase, open **SQL Editor**, paste and run [`supabase-schema.sql`](./supabase-schema.sql), then set these values in the server host's private environment settings:

- `SUPABASE_URL`: the project's URL from Supabase **Project Settings → API**.
- `SUPABASE_SERVICE_ROLE_KEY`: the project's service-role (secret) key from Supabase **Project Settings → API Keys**. Keep this server-side only; never put it in browser code or commit it.
- `NODE_ENV=production`.
- `ALLOWED_ORIGINS=https://mar47362626-eng.github.io` so the Pages frontend is permitted to call the backend. The deployed Pages origin is also included in the app's defaults; same-host Render requests are allowed automatically.
- The public Render service URL is configured in `api-client.js` as `window.API_BASE_URL` before publishing the static GitHub Pages frontend; this is public configuration, not a secret.
- Bank transfer details can be entered and saved from the **Customer transfer account** form at the top of the admin Orders page. Customers see the saved bank name, account name, account number, confirmed amount, and order reference in their payment instructions. `BANK_NAME`, `BANK_ACCOUNT_NAME`, and `BANK_ACCOUNT_NUMBER` remain optional Render environment fallbacks.
- `DELIVERY_BASE_FEE_NGN` and `DELIVERY_RATE_PER_KM_NGN`: optional estimate settings; defaults are `2500` and `1000`.
- `RIDER_RATE_PER_KM_NGN`: rider earnings per started kilometre; defaults to `1500`. Earnings are recorded only when delivery is completed, using the server-calculated route distance.

The server requires valid Supabase credentials in production and does not silently fall back to local JSON files. Local development can continue using JSON storage without Supabase credentials. Existing local JSON/SQLite data is not copied automatically; migrate existing records before switching production traffic if you need to retain them. Do not put `.env` or any service-role key in GitHub.

If Render reports `permission denied for table app_records`, rerun `supabase-schema.sql` in the matching Supabase project's SQL Editor and confirm that Render's `SUPABASE_SERVICE_ROLE_KEY` is that same project's service-role secret key, not its anon/publishable key. The schema grants table access to `service_role`.

## Configure admin-set delivery fees and bank transfer

Set the business receiving account in the admin **Customer transfer account** form before confirming orders. The settings are stored with the admin account records and are available to customers across devices; the matching environment variables remain an optional fallback. Google Maps, a Maps API key, and a Google billing account are not needed.

Customers enter pickup and delivery addresses, then choose **Calculate route and fee**. The server geocodes both addresses with OpenStreetMap Nominatim and calculates driving distance with the public OSRM routing service; customers do not enter kilometres, and no Google Maps key or card is needed. The matched places and distance are shown with the estimate. Address lookup sends the entered addresses to OpenStreetMap. These public services have usage limits and no uptime guarantee; if an address cannot be matched or routing is unavailable, the customer must try a more complete address or try again later. By default, the estimate is NGN 2,500 plus NGN 1,000 for each started kilometre (for example, 2.4 km is estimated as NGN 5,500). Configure `DELIVERY_BASE_FEE_NGN` and `DELIVERY_RATE_PER_KM_NGN` in Render to change the estimate formula. This is advisory: an administrator reviews the pickup and delivery addresses and may adjust and save the final delivery fee before confirming the order. Set the receiving account in the admin **Customer transfer account** form, assign an approved rider, then confirm the order. The customer can then see the bank name, account name and number, exact confirmed amount, and order reference for transfer narration. After transferring, the customer checks **I have paid** and submits the transaction reference. The admin must compare that reference with the bank statement before choosing **Verify payment**. Submitting a reference does not itself prove that funds arrived; rider pickup verification remains unavailable until the admin confirms payment.

After creating the Render service, set its build command to `npm ci`, start command to `npm start`, and leave **Root Directory** empty. Configure the server environment variables above in Render's dashboard. Once Render gives you the service URL, update the public `window.API_BASE_URL` value at the top of `api-client.js` to that URL and push the frontend change to GitHub Pages. Use the matching Pages origin in `ALLOWED_ORIGINS`; do not include the repository path. Production auth cookies require HTTPS and cross-site cookies must be allowed by the user's browser.

## Main workflows

- Customers register and receive a welcome email, then sign in and create delivery requests with pickup and delivery contact email addresses. The customer and configured admin accounts receive an email when a request is placed.
- Riders apply with an account password and receive an application email. When an administrator confirms an order with an approved rider assigned, the rider receives the assignment by email.
- Order emails to customers, configured admins, the assigned rider, and pickup/delivery contacts embed the uploaded package photo directly in the message body as a CID inline image. This includes new-request, rider-assignment, handoff-code, and status-update emails.
- Riders request a short-lived pickup code for the pickup email and a separate delivery code for the delivery email. The rider must verify both codes to advance the order through collection and delivery. Customers receive an email when an order status changes; when the rider verifies pickup, the delivery contact also receives a pickup/on-the-way update.
- Administrators sign in at `admin-login.html`, see recent customer and rider registrations in Notifications, approve or decline rider applications, review driving licence IDs, confirm orders with a rider assigned, review customers and completed deliveries, and send account notifications by email and to recipient dashboards.
- New customer orders show an estimate based on the driving route calculated from the pickup and delivery addresses. An admin reviews the addresses, saves the final fee (which may differ from the estimate), assigns an approved rider, and confirms the order. After confirmation, the customer sees bank-transfer instructions and uses the order reference as the transfer narration. The customer submits the bank transaction reference (not a receipt upload); an admin checks the transfer and marks it verified. Riders cannot request a pickup code until payment is verified.

Brevo mail uses its transactional email API. Set `BREVO_API_KEY` to a current **transactional API key** (not an SMTP key), `BREVO_SENDER_EMAIL` to a sender verified in Brevo, and optionally `BREVO_SENDER_NAME`; `ADMIN_EMAIL` receives new order notices. For Render, add secrets in the Render service's **Environment** settings, not in frontend code. If Brevo IP authorization is enabled, allow the outbound IP addresses for this Render service (from Render service settings); a local computer IP is not the Render IP. On an API `401`/`403`, check the API key and Brevo's response detail in the Render logs to distinguish a rejected key from an unauthorized server IP. Order emails can embed package photos inline when `BREVO_SMTP_LOGIN` and `BREVO_SMTP_KEY` are set to the separate SMTP credentials from Brevo; `BREVO_SMTP_PORT` accepts 465, 587, or 2525 (default 587). If SMTP is not configured or fails, the app sends through the transactional API and includes the photo as a regular attachment instead. Non-order emails use the transactional API directly. Handoff codes are sent and saved separately from the subsequent status-photo email, so a failure to send a status email does not invalidate a handoff code. The app reports notification failures separately. Never put credentials in browser code or commit a populated `.env` file.

For production, run the server behind HTTPS, set `NODE_ENV=production`, use a strong private admin password, and configure Supabase. Package photo bytes are saved with order records in the database.
