const ordersList = document.querySelector('#orders-list');
const searchInput = document.querySelector('#orders-search');
const alertBox = document.querySelector('#admin-alert');
const orderCount = document.querySelector('#orders-count');
const modal = new bootstrap.Modal(document.querySelector('#order-modal'));
const orders = new Map();
const statuses = ['unprocessed', 'order accepted', 'Ready to deliver', 'completed'];
let activeOrderId = '';

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
});

function formatCurrency(amount) {
  return currency.format(amount);
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function statusClass(status) {
  return `status-${status.toLowerCase().replace(/\s+/g, '-')}`;
}

function showAlert(message, type) {
  alertBox.className = `alert alert-${type}`;
  alertBox.textContent = message;
}

function renderOrders() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const visibleOrders = [...orders.values()].filter((order) =>
    `${order.id} ${order.customerDetails.name} ${order.customerDetails.mobile}`.toLocaleLowerCase().includes(query)
  );
  orderCount.textContent = `${orders.size} total · ${visibleOrders.length} shown`;

  if (!visibleOrders.length) {
    ordersList.innerHTML = `<tr><td class="table-message" colspan="4">${orders.size ? 'No orders match your search.' : 'No orders have been placed yet.'}</td></tr>`;
    return;
  }

  ordersList.innerHTML = visibleOrders.map((order) => `
    <tr class="order-row ${order.status === 'completed' ? 'order-completed' : ''}" data-order-id="${escapeHTML(order.id)}" tabindex="0" aria-label="View invoice for order ${escapeHTML(order.id)}">
      <td class="order-id">${escapeHTML(order.id)}</td>
      <td class="order-customer">${escapeHTML(order.customerDetails.name)}</td>
      <td class="order-mobile">${escapeHTML(order.customerDetails.mobile)}</td>
      <td class="status-cell"><select class="status-control ${statusClass(order.status)}" data-status-select="${escapeHTML(order.id)}" aria-label="Status for order ${escapeHTML(order.id)}">${statuses.map((status) => `<option value="${escapeHTML(status)}" ${status === order.status ? 'selected' : ''}>${escapeHTML(status)}</option>`).join('')}</select></td>
    </tr>`).join('');
}

function renderInvoice(order) {
  const customer = order.customerDetails;
  const itemRows = order.orderedItems.map((item) => `
    <tr><td>${escapeHTML(item.name)}<br><span lang="ta">${escapeHTML(item.tamilName)}</span></td><td>${item.quantity}</td><td>${formatCurrency(item.unitPrice)}</td><td>${formatCurrency(item.lineTotal)}</td></tr>`).join('');
  const issuedDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(order.createdAt));
  const requestedDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(`${order.deliveryDate}T00:00:00`));
  const safeAddress = escapeHTML(order.address).replace(/\n/g, '<br>');

  document.querySelector('#order-modal-title').textContent = `Invoice · ${order.id}`;
  document.querySelector('#order-invoice').innerHTML = `
    <div class="invoice-header">
      <div><div class="invoice-brand">NIVAN CRACKERS</div><div>Sivakasi, Tamil Nadu · Door delivery available</div><div>Phone: 81248 10855 / 87545 36443</div></div>
      <div class="invoice-meta"><strong>INVOICE</strong><span>${escapeHTML(order.id)}</span><div>Issued ${escapeHTML(issuedDate)}</div></div>
    </div>
    <div class="invoice-columns">
      <section><h3>BILL TO</h3><p><strong>${escapeHTML(customer.name)}</strong></p><p>${escapeHTML(customer.mobile)}</p><p>${escapeHTML(customer.email)}</p></section>
      <section><h3>DELIVERY ADDRESS</h3><p>${safeAddress}</p><p>${escapeHTML(customer.city)} ${escapeHTML(customer.postalCode)}</p><p><strong>Requested delivery:</strong> ${escapeHTML(requestedDate)}</p></section>
    </div>
    <h3 class="invoice-items-heading">ORDERED ITEMS</h3>
    <table class="invoice-items"><thead><tr><th>Item name</th><th>Quantity</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${itemRows}</tbody></table>
    <div class="invoice-totals"><div><span>Sub total</span><span>${formatCurrency(order.subtotal)}</span></div><div><span>Delivery charge</span><span>${formatCurrency(order.deliveryCharge)}</span></div><div class="invoice-grand-total"><span>Grand total</span><span>${formatCurrency(order.grandTotal)}</span></div></div>
    <div class="invoice-status-note"><strong>Status:</strong> ${escapeHTML(order.status)} · <strong>Email:</strong> ${escapeHTML(order.emailStatus)}${order.emailError ? ` · ${escapeHTML(order.emailError)}` : ''}${customer.instructions ? `<br><strong>Special instructions:</strong> ${escapeHTML(customer.instructions)}` : ''}</div>`;
  modal.show();
}

async function loadOrders() {
  ordersList.innerHTML = '<tr><td class="table-message" colspan="4">Loading orders…</td></tr>';
  try {
    const response = await fetch('/api/admin/orders', { credentials: 'same-origin' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Could not load orders (${response.status}).`);
    orders.clear();
    result.orders.forEach((order) => orders.set(order.id, order));
    renderOrders();
    alertBox.classList.add('d-none');
  } catch (error) {
    orderCount.textContent = 'Unavailable';
    ordersList.innerHTML = '<tr><td class="table-message" colspan="4">Order list unavailable.</td></tr>';
    showAlert(`${error.message} Check the admin login and server configuration.`, 'danger');
  }
}

async function updateStatus(select) {
  const orderId = select.dataset.statusSelect;
  const previous = orders.get(orderId)?.status;
  select.disabled = true;
  try {
    const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: select.value })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Could not update status (${response.status}).`);
    orders.set(orderId, result.order);
    renderOrders();
    showAlert(`Order ${orderId} updated to ${result.order.status}.`, 'success');
    if (activeOrderId === orderId) renderInvoice(result.order);
  } catch (error) {
    select.value = previous;
    showAlert(error.message, 'danger');
  } finally {
    select.disabled = false;
  }
}

ordersList.addEventListener('change', (event) => {
  const select = event.target.closest('[data-status-select]');
  if (select) updateStatus(select);
});

ordersList.addEventListener('click', (event) => {
  if (event.target.closest('[data-status-select]')) return;
  const row = event.target.closest('[data-order-id]');
  if (!row) return;
  activeOrderId = row.dataset.orderId;
  renderInvoice(orders.get(activeOrderId));
});

ordersList.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.target.closest('[data-status-select]')) return;
  const row = event.target.closest('[data-order-id]');
  if (!row) return;
  event.preventDefault();
  activeOrderId = row.dataset.orderId;
  renderInvoice(orders.get(activeOrderId));
});

searchInput.addEventListener('input', renderOrders);
document.querySelector('#refresh-orders').addEventListener('click', loadOrders);
document.querySelector('#print-order').addEventListener('click', () => window.print());

loadOrders();
