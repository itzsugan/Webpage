require('dotenv').config();
const path = require('node:path');
const fs = require('node:fs');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ALLOW_WEAK_ADMIN_PASSWORD = process.env.ALLOW_WEAK_ADMIN_PASSWORD === 'true';
const DELIVERY_CHARGE = process.env.DELIVERY_CHARGE === undefined ? 0 : Number(process.env.DELIVERY_CHARGE);
const DB_PATH = process.env.DB_PATH ? path.resolve(ROOT, process.env.DB_PATH) : path.join(ROOT, 'data', 'orders.sqlite');
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ORDER_STATUSES = ['unprocessed', 'order accepted', 'Ready to deliver', 'completed'];

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const database = new Database(DB_PATH);
database.pragma('journal_mode = WAL');
database.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    customer_json TEXT NOT NULL,
    address TEXT NOT NULL,
    delivery_date TEXT NOT NULL,
    ordered_items_json TEXT NOT NULL,
    subtotal INTEGER NOT NULL,
    delivery_charge INTEGER NOT NULL,
    grand_total INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'unprocessed'
      CHECK (status IN ('unprocessed', 'order accepted', 'Ready to deliver', 'completed')),
    email_status TEXT NOT NULL DEFAULT 'pending'
      CHECK (email_status IN ('pending', 'sent', 'not_configured', 'failed')),
    email_error TEXT
  )
`);

// Recipients are configured on the server and never accepted from the browser.
const ORDER_RECIPIENTS = (process.env.ORDER_RECIPIENTS || '')
  .split(',')
  .map((email) => email.trim())
  .filter(Boolean);

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const $ = cheerio.load(html);
const catalog = new Map();

$('#catalog-source .category-card').each((_, card) => {
  const category = $(card).find('.category-header').first().text().trim() || 'Products';
  $(card).find('tr').each((__, row) => {
    const productRow = $(row);
    const id = productRow.find('.col-sno').text().trim();
    const name = productRow.find('.col-eng').text().trim();
    const tamilName = productRow.find('.col-tam').text().trim();
    const priceText = productRow.find('.col-rate').text().trim();
    const priceMatch = priceText.match(/[\d,]+(?:\.\d+)?/);
    const unitPrice = priceMatch ? Number(priceMatch[0].replace(/,/g, '')) : Number.NaN;
    const unit = priceText.split('/')[1]?.trim() || 'unit';
    if (/^\d+$/.test(id) && name && tamilName && Number.isFinite(unitPrice)) {
      catalog.set(id, { id, name, tamilName, unitPrice, unit, category });
    }
  });
});

const csp = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  imgSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  formAction: ["'self'"],
  upgradeInsecureRequests: null
};

app.use(helmet({ contentSecurityPolicy: { directives: csp } }));
app.use(express.json({ limit: '32kb' }));
app.use('/api/send-order', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }));
app.get('/', (_request, response) => response.sendFile(path.join(ROOT, 'index.html')));
app.get('/index.html', (_request, response) => response.sendFile(path.join(ROOT, 'index.html')));
app.get(['/admin', '/admin.html'], requireAdmin, (_request, response) => response.sendFile(path.join(ROOT, 'admin.html')));
app.get(['/styles.css', '/app.js', '/admin.css', '/admin.js', '/header.png'], (request, response, next) => {
  express.static(ROOT, { dotfiles: 'ignore', index: false })(request, response, next);
});

const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
const formatCurrency = (amount) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0
}).format(amount);
const isEmail = (value) => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function configurationError() {
  const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'ORDER_FROM_EMAIL'];
  if (required.some((key) => !process.env[key])) return 'Email service is not configured. Set SMTP settings in .env.';
  if (!ORDER_RECIPIENTS.length || ORDER_RECIPIENTS.some((email) => email.endsWith('@example.com'))) return 'Configure ORDER_RECIPIENTS in .env before sending order notifications.';
  return '';
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function requireAdmin(request, response, next) {
  if (!ADMIN_USER || !ADMIN_PASSWORD || (ADMIN_PASSWORD.length < 16 && (IS_PRODUCTION || !ALLOW_WEAK_ADMIN_PASSWORD))) {
    return response.status(503).send('Admin access is not configured. Set ADMIN_USER and ADMIN_PASSWORD in .env.');
  }

  const authorization = request.get('authorization') || '';
  const match = authorization.match(/^Basic ([A-Za-z0-9+/]+=*)$/);
  let username = '';
  let password = '';
  if (match) {
    const credentials = Buffer.from(match[1], 'base64').toString('utf8');
    const separator = credentials.indexOf(':');
    if (separator >= 0) {
      username = credentials.slice(0, separator);
      password = credentials.slice(separator + 1);
    }
  }

  if (!safeEqual(username, ADMIN_USER) || !safeEqual(password, ADMIN_PASSWORD)) {
    response.set('WWW-Authenticate', 'Basic realm="Nivan order admin", charset="UTF-8"');
    return response.status(401).send('Admin authentication required.');
  }
  return next();
}

function serializeOrder(row) {
  return {
    id: row.id,
    invoiceNumber: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customerDetails: JSON.parse(row.customer_json),
    address: row.address,
    deliveryDate: row.delivery_date,
    orderedItems: JSON.parse(row.ordered_items_json),
    subtotal: row.subtotal,
    deliveryCharge: row.delivery_charge,
    grandTotal: row.grand_total,
    status: row.status,
    emailStatus: row.email_status,
    emailError: row.email_error
  };
}

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', catalogItems: catalog.size, emailConfigured: !configurationError() });
});

app.get('/api/config', (_request, response) => {
  if (!Number.isInteger(DELIVERY_CHARGE) || DELIVERY_CHARGE < 0 || DELIVERY_CHARGE > 100000) {
    return response.status(503).json({ error: 'Delivery charge is not configured correctly.' });
  }
  return response.json({ deliveryCharge: DELIVERY_CHARGE });
});

app.use('/api/admin', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false }));

app.get('/api/admin/orders', requireAdmin, (_request, response) => {
  const rows = database.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  return response.json({ orders: rows.map(serializeOrder), statuses: ORDER_STATUSES });
});

app.patch('/api/admin/orders/:orderId/status', requireAdmin, (request, response) => {
  const { status } = request.body || {};
  if (!ORDER_STATUSES.includes(status)) {
    return response.status(400).json({ error: 'Choose a valid order status.' });
  }

  const updatedAt = new Date().toISOString();
  const result = database.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, updatedAt, request.params.orderId);
  if (result.changes === 0) return response.status(404).json({ error: 'Order not found.' });

  const row = database.prepare('SELECT * FROM orders WHERE id = ?').get(request.params.orderId);
  return response.json({ order: serializeOrder(row) });
});

app.post('/api/send-order', async (request, response) => {
  const body = request.body || {};
  const customer = body.customerDetails || {};
  const items = Array.isArray(body.orderedItems) ? body.orderedItems : [];
  const deliveryCharge = DELIVERY_CHARGE;
  const deliveryDate = body.deliveryDate;

  const validCustomer = typeof customer.name === 'string' && customer.name.trim().length > 0 && customer.name.length <= 120
    && typeof customer.mobile === 'string' && /^(?:\+?91[\s-]?)?[6-9][0-9]{9}$/.test(customer.mobile.trim())
    && isEmail(customer.email)
    && typeof customer.city === 'string' && customer.city.trim().length > 0 && customer.city.length <= 100
    && typeof customer.postalCode === 'string' && /^[0-9]{6}$/.test(customer.postalCode)
    && typeof body.address === 'string' && body.address.trim().length > 0 && body.address.length <= 1000;
  const parsedDeliveryDate = typeof deliveryDate === 'string' ? new Date(`${deliveryDate}T00:00:00.000Z`) : null;
  const todayInIndia = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const validDate = typeof deliveryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)
    && parsedDeliveryDate && !Number.isNaN(parsedDeliveryDate.getTime())
    && parsedDeliveryDate.toISOString().slice(0, 10) === deliveryDate
    && deliveryDate >= todayInIndia;
  if (!Number.isInteger(deliveryCharge) || deliveryCharge < 0 || deliveryCharge > 100000) {
    return response.status(503).json({ error: 'Delivery charge is not configured correctly.' });
  }
  if (!validCustomer || !validDate || items.length === 0 || items.length > 200) {
    return response.status(400).json({ error: 'Order details are incomplete or invalid.' });
  }

  const orderedItems = [];
  const seenIds = new Set();
  for (const item of items) {
    const product = catalog.get(String(item.id));
    const quantity = Number(item.quantity);
    if (!product || seenIds.has(product.id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
      return response.status(400).json({ error: 'One or more ordered items are invalid.' });
    }
    seenIds.add(product.id);
    orderedItems.push({ ...product, quantity, lineTotal: product.unitPrice * quantity });
  }

  const subtotal = orderedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const grandTotal = subtotal + deliveryCharge;
  const createdAt = new Date().toISOString();
  const orderId = `NV-${createdAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex').toUpperCase()}`;
  const invoiceNumber = orderId;
  const customerDetails = {
    name: customer.name.trim(),
    mobile: customer.mobile.trim(),
    email: customer.email.trim(),
    city: customer.city.trim(),
    postalCode: customer.postalCode.trim(),
    instructions: typeof customer.instructions === 'string' ? customer.instructions.trim().slice(0, 1000) : ''
  };
  const address = body.address.trim();

  try {
    database.prepare(`
      INSERT INTO orders (
        id, created_at, updated_at, customer_json, address, delivery_date,
        ordered_items_json, subtotal, delivery_charge, grand_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderId, createdAt, createdAt, JSON.stringify(customerDetails), address,
      deliveryDate, JSON.stringify(orderedItems), subtotal, deliveryCharge, grandTotal
    );
  } catch (error) {
    console.error('Order could not be stored:', error.message);
    return response.status(500).json({ error: 'The order could not be saved. Please try again or contact the store.' });
  }

  const emailError = configurationError();

  const transporter = emailError ? null : nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  const itemRows = orderedItems.map((item) => `<tr><td>${escapeHTML(item.name)} <span lang="ta">${escapeHTML(item.tamilName)}</span></td><td>${item.quantity}</td><td>${formatCurrency(item.unitPrice)}</td><td>${formatCurrency(item.lineTotal)}</td></tr>`).join('');
  const textItems = orderedItems.map((item) => `${item.name} (${item.tamilName}) x ${item.quantity} @ ${formatCurrency(item.unitPrice)} = ${formatCurrency(item.lineTotal)}`).join('\n');
  const instructions = typeof customer.instructions === 'string' ? customer.instructions.trim().slice(0, 1000) : '';
  const text = [
    `New order ${invoiceNumber}`,
    `Customer: ${customer.name}`,
    `Mobile: ${customer.mobile}`,
    `Email: ${customer.email}`,
    `Delivery address: ${body.address}`,
    `Delivery date: ${deliveryDate}`,
    '', 'Items:', textItems,
    '', `Sub total: ${formatCurrency(subtotal)}`,
    `Delivery charge: ${formatCurrency(deliveryCharge)}`,
    `Grand total: ${formatCurrency(grandTotal)}`,
    instructions ? `Special instructions: ${instructions}` : ''
  ].filter(Boolean).join('\n');
  const mailHTML = `<!doctype html><html><body style="font:14px Arial,sans-serif;color:#271f1a"><h1 style="color:#781d24">New order ${escapeHTML(invoiceNumber)}</h1><h2>Customer details</h2><p><strong>${escapeHTML(customer.name)}</strong><br>${escapeHTML(customer.mobile)}<br>${escapeHTML(customer.email)}</p><h2>Delivery</h2><p>${escapeHTML(body.address).replace(/\n/g, '<br>')}<br>Requested date: ${escapeHTML(deliveryDate)}</p><h2>Ordered items</h2><table style="width:100%;border-collapse:collapse" border="1" cellpadding="8"><thead><tr><th align="left">Item</th><th>Quantity</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${itemRows}</tbody></table><p>Sub total: ${formatCurrency(subtotal)}<br>Delivery charge: ${formatCurrency(deliveryCharge)}<br><strong>Grand total: ${formatCurrency(grandTotal)}</strong></p>${instructions ? `<p>Special instructions: ${escapeHTML(instructions)}</p>` : ''}</body></html>`;

  let emailStatus = emailError ? 'not_configured' : 'sent';
  let emailMessage = emailError;
  if (transporter) {
    try {
      await transporter.sendMail({
        from: process.env.ORDER_FROM_EMAIL,
        to: ORDER_RECIPIENTS,
        replyTo: customer.email,
        subject: `New order ${invoiceNumber} from ${customer.name}`,
        text,
        html: mailHTML
      });
      emailMessage = '';
    } catch (error) {
      emailStatus = 'failed';
      emailMessage = 'The order was saved, but the notification email could not be delivered.';
      console.error('Order email delivery failed:', error.message);
    }
  }

  database.prepare('UPDATE orders SET email_status = ?, email_error = ? WHERE id = ?')
    .run(emailStatus, emailMessage || null, orderId);
  const savedOrder = database.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  return response.status(201).json({
    success: true,
    orderId,
    invoiceNumber,
    emailSent: emailStatus === 'sent',
    emailMessage,
    order: serializeOrder(savedOrder)
  });
});

app.use((error, _request, response, _next) => {
  if (error instanceof SyntaxError && 'body' in error) return response.status(400).json({ error: 'Request must contain valid JSON.' });
  console.error('Request failed:', error.message);
  return response.status(500).json({ error: 'An unexpected server error occurred.' });
});

app.listen(PORT, () => {
  console.log(`Nivan order app listening on http://localhost:${PORT}`);
  if (catalog.size === 0) console.warn('Product catalog is empty; check the catalog table in index.html.');
  if (configurationError()) console.warn(configurationError());
});
