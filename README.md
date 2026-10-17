# A&M Logistics website

The customer site (`index.html`), rider portal (`rider.html`), and admin pages remain separate. Express serves them and provides a shared JSON-backed API so accounts, delivery requests, rider reviews, assignments, and notifications work across browsers and devices.

## Run locally on Windows

1. Install Node.js 22.13 or newer.
2. In PowerShell, run `npm.cmd install`.
3. Copy `.env.example` to `.env`, set a private admin email and a unique password of at least 12 characters, and configure the Brevo API key and a verified sender email.
4. Run `npm.cmd start`.
5. Open `http://localhost:3000` in a browser. Do not open the HTML files directly or use a static-only preview server; the API must be running.

The server creates and updates `data\users.json`, `data\riders.json`, `data\orders.json`, `data\notifications.json`, and `data\sessions.json`. The first server startup imports existing records from `data\ao-logistics.sqlite` when that database exists; the SQLite file is left in place as a backup. Keep `.env` and the `data` folder private and include them in backups. Customer and rider passwords are hashed on the server, and delivery photos are stored as base64 data in the orders file. Administrators can also create their own account through `admin-register.html` if no seeded admin is configured. Run only one server instance against a data folder at a time.

## Main workflows

- Customers register and receive a welcome email, then sign in and create delivery requests with pickup and delivery contact email addresses. The customer and configured admin accounts receive an email when a request is placed.
- Riders apply with an account password and receive an application email. When an administrator confirms an order with an approved rider assigned, the rider receives the assignment by email.
- Order emails to customers, configured admins, the assigned rider, and pickup/delivery contacts embed the uploaded package photo directly in the message body as a CID inline image. This includes new-request, rider-assignment, handoff-code, and status-update emails.
- Riders request a short-lived pickup code for the pickup email and a separate delivery code for the delivery email. The rider must verify both codes to advance the order through collection and delivery. Customers receive an email when an order status changes; when the rider verifies pickup, the delivery contact also receives a pickup/on-the-way update.
- Administrators sign in at `admin-login.html`, see recent customer and rider registrations in Notifications, approve or decline rider applications, review driving licence IDs, confirm orders with a rider assigned, review customers and completed deliveries, and send account notifications.

Brevo mail uses its transactional email API. Set `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (a sender verified in Brevo), and optionally `BREVO_SENDER_NAME` in `.env`; `ADMIN_EMAIL` receives new order notices. To embed package photos inside all order emails, also set `BREVO_SMTP_LOGIN` and `BREVO_SMTP_KEY` using the SMTP credentials from Brevo's SMTP & API settings. Order emails are sent through Brevo's SMTP relay so the image can be attached with a Content-ID and displayed inline; non-order emails continue using the transactional API. `BREVO_SMTP_PORT` accepts 465, 587, or 2525 (default 587); use another supported relay port if the network blocks the selected port. Handoff codes are sent and saved separately from the subsequent status-photo email, so a failure to send a status email does not invalidate a handoff code. The app reports notification failures separately. Never put credentials in browser code or commit a populated `.env` file.

For production, run the server behind HTTPS, set `NODE_ENV=production`, use a strong private admin password, and persist the JSON data directory on durable storage.
