# Nivan Crackers Order App

A responsive Bootstrap 5 ordering page built from the product price-list tables in `index.html`. The browser reads the catalog for display; the Express API independently reads the same tables and calculates prices again before sending an order email.

## Run locally

Requires Node.js 20.18.1 or later.

```sh
npm install
cp .env.example .env
npm start
```

Open <http://localhost:3000>. Do not open `index.html` directly from the filesystem: orders are submitted to the same-origin API at `POST /api/send-order`.

## Publish externally

The app requires a Node.js host and persistent storage; GitHub Pages cannot run its order API or SQLite database. The included `render.yaml` configures a Render web service and persistent disk. Push this repository, create a new Render Blueprint from it, then enter the requested admin and SMTP environment values in Render. Choose a unique admin password of at least 16 characters and the business recipient list. The Blueprint uses a paid Starter service because SQLite order data must persist across deploys. After deployment, use the HTTPS URL provided by Render.

## Configure order email

1. Set `ORDER_RECIPIENTS` in `.env` to the fixed business recipient list, comma-separated if there are multiple recipients. Addresses are controlled on the server and cannot be supplied by a browser request.
2. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `ORDER_FROM_EMAIL` in `.env`. Use the SMTP credentials from your mail provider. For Gmail, use `smtp.gmail.com`, port `587`, `SMTP_SECURE=false`, and an app password; do not use your normal account password.
3. Set `DELIVERY_CHARGE` in `.env` to the fixed whole-rupee delivery charge (defaults to `0`). It is served to the page for display and independently applied by the API; browser requests cannot change it.
	Set `TRUST_PROXY_HOPS` to the exact number of trusted reverse proxies in front of the app; the included Render config uses `1`.
4. For local testing only, set `ADMIN_USER=admin`, `ADMIN_PASSWORD=admin@123`, and `ALLOW_WEAK_ADMIN_PASSWORD=true` in the ignored `.env`. Never commit these values. In production, set `NODE_ENV=production`, use a unique password with at least 16 characters, configure `ADMIN_SESSION_SECRET` with at least 32 random characters, and serve the admin page over HTTPS. Production mode rejects weak passwords even if the local-only flag is set.
5. Restart the server. `GET /api/health` reports whether SMTP and recipients are configured without revealing credentials or recipient addresses.

Never commit `.env` or put SMTP credentials in `app.js`. In production, use your host's secret manager, serve the app over HTTPS, and configure the SMTP sender address for your domain.

## Catalog and settings

The existing catalog in `index.html` is the sample product data (98 listed items). Keep each product row's `.col-sno`, `.col-eng`, `.col-tam`, and `.col-rate` cells and its surrounding `.category-card` / `.category-header` when adding or editing products. Prices are read from the rupee amount in `.col-rate`; the text after `/` is used as the unit label. The delivery charge is set by the business through `DELIVERY_CHARGE` in `.env` and is read-only during ordering.

## Admin orders and backup

Open `/admin` and sign in using the page's username/password form. A signed, HttpOnly session cookie keeps the admin signed in for up to 12 hours; order APIs do not use browser-cached Basic Auth. New orders are assigned an order ID and saved to SQLite at `DB_PATH` (default `data/orders.sqlite`) before the server attempts email. Email failure does not discard an order; the customer sees that it was saved and the admin list records the email status. Admins can update status to `unprocessed`, `order accepted`, `Ready to deliver`, or `completed`; completed orders are highlighted. Select an order row to open its saved invoice.

Back up the SQLite database regularly. For a live backup, use SQLite's backup API or stop the app before copying the database file; do not copy the database while its `-wal` file is active. The database and WAL files are excluded from Git.

## Orders and invoice

Customer data and selected products are validated in the browser and revalidated by the API. Product prices and item totals are recalculated from the catalog on the server. The server sends an HTML and plain-text order email to `ORDER_RECIPIENTS`; customer email is used only as reply-to. SMTP delivery failures are reported clearly and leave an invoice preview available, but are not reported as successfully placed orders.

Use **Print invoice** to print. **Save as PDF** opens the browser print dialog; select **Save to PDF** (wording varies by browser) to download a PDF while retaining Tamil product names. The invoice is also shown on screen after a successful email send.

The order endpoint has a basic per-IP rate limit. `TRUST_PROXY_HOPS` controls which forwarding headers Express trusts; set it to match the actual deployment proxy topology. Validate delivery, tax, and applicable fireworks-sale regulations for your business before production use.
