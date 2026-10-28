/* Product Management: read the existing price list instead of duplicating catalog data. */
const products = [];
const quantities = new Map();
let appConfigLoaded = false;
const catalogCards = document.querySelectorAll('#catalog-source .category-card');

catalogCards.forEach((card) => {
  const category = card.querySelector('.category-header')?.textContent.trim() || 'Products';
  card.querySelectorAll('tr').forEach((row) => {
    const id = row.querySelector('.col-sno')?.textContent.trim();
    const name = row.querySelector('.col-eng')?.textContent.trim();
    const tamilName = row.querySelector('.col-tam')?.textContent.trim();
    const priceText = row.querySelector('.col-rate')?.textContent.trim() || '';
    const priceMatch = priceText.match(/[\d,]+(?:\.\d+)?/);
    const unitPrice = priceMatch ? Number(priceMatch[0].replace(/,/g, '')) : Number.NaN;
    const unit = priceText.split('/')[1]?.trim() || 'unit';

    if (!/^\d+$/.test(id) || !name || !tamilName || !Number.isFinite(unitPrice)) return;
    const product = { id, name, tamilName, unitPrice, unit, category };
    products.push(product);
    quantities.set(id, 0);
  });
});

const productRows = document.querySelector('#product-rows');
const reviewRows = document.querySelector('#review-rows');
const searchInput = document.querySelector('#product-search');
const categoryFilter = document.querySelector('#category-filter');
const alertBox = document.querySelector('#app-alert');
const customerForm = document.querySelector('#customer-form');
const placeOrderButton = document.querySelector('#place-order');
const invoiceModal = new bootstrap.Modal(document.querySelector('#invoice-modal'));
const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
});

function formatCurrency(value) {
  return currency.format(value);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function getSelectedProducts() {
  return products
    .filter((product) => quantities.get(product.id) > 0)
    .map((product) => ({
      ...product,
      quantity: quantities.get(product.id),
      lineTotal: product.unitPrice * quantities.get(product.id)
    }));
}

function getDeliveryCharge() {
  const charge = Number(document.querySelector('#delivery-charge').value);
  return Number.isFinite(charge) ? Math.max(0, charge) : 0;
}

/* Order Calculation: one update path keeps row totals, review, and summary in sync. */
function updateOrderSummary() {
  const selected = getSelectedProducts();
  const subtotal = selected.reduce((sum, item) => sum + item.lineTotal, 0);
  const grandTotal = subtotal + getDeliveryCharge();

  products.forEach((product) => {
    const totalCell = productRows.querySelector(`[data-total-for="${product.id}"]`);
    if (totalCell) totalCell.textContent = formatCurrency(product.unitPrice * quantities.get(product.id));
  });

  document.querySelector('#subtotal-value').textContent = formatCurrency(subtotal);
  document.querySelector('#grand-total-value').textContent = formatCurrency(grandTotal);
  document.querySelector('#review-empty').classList.toggle('d-none', selected.length > 0);
  document.querySelector('#review-wrap').classList.toggle('d-none', selected.length === 0);
  reviewRows.innerHTML = selected.map((item) => `
    <tr>
      <td class="review-item-name">${escapeHTML(item.name)}</td>
      <td class="text-center">${item.quantity}</td>
      <td class="text-end">${formatCurrency(item.lineTotal)}</td>
    </tr>`).join('');
  return { selected, subtotal, grandTotal };
}

function renderProducts() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const category = categoryFilter.value;
  const visibleProducts = products.filter((product) => {
    const matchesText = `${product.name} ${product.tamilName} ${product.category}`.toLocaleLowerCase().includes(query);
    return matchesText && (!category || product.category === category);
  });

  productRows.innerHTML = visibleProducts.map((product) => `
    <tr>
      <td><span class="product-name">${escapeHTML(product.name)}</span><span class="product-category">${escapeHTML(product.category)}</span></td>
      <td class="tamil-name">${escapeHTML(product.tamilName)}</td>
      <td class="text-end unit-price">${formatCurrency(product.unitPrice)} <span class="text-muted">/ ${escapeHTML(product.unit)}</span></td>
      <td class="text-center">
        <div class="quantity-control" aria-label="Quantity for ${escapeHTML(product.name)}">
          <button type="button" data-quantity-action="decrease" data-product-id="${product.id}" aria-label="Decrease ${escapeHTML(product.name)} quantity">−</button>
          <input class="quantity-input" type="number" min="0" step="1" inputmode="numeric" value="${quantities.get(product.id)}" data-quantity-input="${product.id}" aria-label="${escapeHTML(product.name)} quantity">
          <button type="button" data-quantity-action="increase" data-product-id="${product.id}" aria-label="Increase ${escapeHTML(product.name)} quantity">+</button>
        </div>
      </td>
      <td class="text-end line-total" data-total-for="${product.id}">${formatCurrency(product.unitPrice * quantities.get(product.id))}</td>
    </tr>`).join('');

  document.querySelector('#product-count').textContent = `${visibleProducts.length} of ${products.length} items`;
  document.querySelector('#empty-products').classList.toggle('d-none', visibleProducts.length > 0);
  updateOrderSummary();
}

const categories = [...new Set(products.map((product) => product.category))];
categories.forEach((category) => {
  const option = document.createElement('option');
  option.value = category;
  option.textContent = category;
  categoryFilter.append(option);
});

function setQuantity(productId, value) {
  const nextQuantity = Number(value);
  quantities.set(productId, Number.isInteger(nextQuantity) ? Math.min(10000, Math.max(0, nextQuantity)) : 0);
  const input = productRows.querySelector(`[data-quantity-input="${productId}"]`);
  if (input) input.value = quantities.get(productId);
  updateOrderSummary();
}

productRows.addEventListener('input', (event) => {
  const input = event.target.closest('[data-quantity-input]');
  if (!input) return;
  if (input.value === '') {
    quantities.set(input.dataset.quantityInput, 0);
    updateOrderSummary();
    return;
  }
  setQuantity(input.dataset.quantityInput, input.value);
});

productRows.addEventListener('click', (event) => {
  const button = event.target.closest('[data-quantity-action]');
  if (!button) return;
  const current = quantities.get(button.dataset.productId) || 0;
  const change = button.dataset.quantityAction === 'increase' ? 1 : -1;
  setQuantity(button.dataset.productId, current + change);
});

searchInput.addEventListener('input', renderProducts);
categoryFilter.addEventListener('change', renderProducts);
document.querySelector('#delivery-charge').addEventListener('input', updateOrderSummary);

/* Customer Form: browser constraints and explicit feedback are used together. */
function readCustomerDetails() {
  const formData = new FormData(customerForm);
  return {
    name: String(formData.get('name')).trim(),
    mobile: String(formData.get('mobile')).trim(),
    email: String(formData.get('email')).trim(),
    address: String(formData.get('address')).trim(),
    city: String(formData.get('city')).trim(),
    postalCode: String(formData.get('postalCode')).trim(),
    deliveryDate: String(formData.get('deliveryDate')),
    instructions: String(formData.get('instructions')).trim()
  };
}

function showAlert(message, type) {
  alertBox.className = `alert alert-${type}`;
  alertBox.textContent = message;
  alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setLoading(isLoading) {
  placeOrderButton.disabled = isLoading || !appConfigLoaded;
  placeOrderButton.querySelector('.spinner-border').classList.toggle('d-none', !isLoading);
  placeOrderButton.querySelector('.button-label').textContent = isLoading ? 'Submitting order...' : 'Place order →';
}

function formatDate(value, options = { dateStyle: 'medium' }) {
  return new Intl.DateTimeFormat('en-IN', options).format(new Date(value));
}

function makeInvoiceNumber() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `NV-${stamp}-${suffix}`;
}

/* Invoice Generation: create a printable invoice from a frozen order snapshot. */
function renderInvoice({ customer, address, selected, subtotal, deliveryCharge, grandTotal, invoiceNumber, deliveryDate, createdAt }) {
  const itemRows = selected.map((item) => `
    <tr>
      <td>${escapeHTML(item.name)}<br><span lang="ta">${escapeHTML(item.tamilName)}</span></td>
      <td>${item.quantity}</td>
      <td>${formatCurrency(item.unitPrice)}</td>
      <td>${formatCurrency(item.lineTotal)}</td>
    </tr>`).join('');
  const safeAddress = escapeHTML(address).replace(/\n/g, '<br>');

  document.querySelector('#invoice-content').innerHTML = `
    <div class="invoice-top">
      <div><div class="invoice-brand">NIVAN CRACKERS</div><div class="invoice-brand-sub">Sivakasi, Tamil Nadu · Door delivery available</div><div class="invoice-brand-sub">Phone: 81248 10855 / 87545 36443</div></div>
      <div class="invoice-meta"><strong>INVOICE</strong><span>${escapeHTML(invoiceNumber)}</span><div>Issued ${escapeHTML(formatDate(createdAt, { dateStyle: 'medium', timeStyle: 'short' }))}</div></div>
    </div>
    <div class="invoice-customer-grid invoice-section">
      <div><h3>BILL TO</h3><p><strong>${escapeHTML(customer.name)}</strong></p><p>${escapeHTML(customer.mobile)}</p><p>${escapeHTML(customer.email)}</p></div>
      <div><h3>DELIVERY ADDRESS</h3><p>${safeAddress}</p><p>${escapeHTML(customer.city)} ${escapeHTML(customer.postalCode)}</p><p><strong>Requested delivery:</strong> ${escapeHTML(formatDate(deliveryDate))}</p></div>
    </div>
    <div class="invoice-section"><h3>ORDERED ITEMS</h3><table class="invoice-items"><thead><tr><th>Item name</th><th>Quantity</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${itemRows}</tbody></table></div>
    <div class="invoice-pricing"><div><span>Sub total</span><span>${formatCurrency(subtotal)}</span></div><div><span>Delivery charge</span><span>${formatCurrency(deliveryCharge)}</span></div><div class="invoice-total"><span>Grand total</span><span>${formatCurrency(grandTotal)}</span></div></div>
    <div class="invoice-notes"><strong>Terms and notes</strong><p>Thank you for ordering from Nivan Crackers. Please retain this invoice for your records. Delivery timing is subject to confirmation.</p>${customer.instructions ? `<p><strong>Special instructions:</strong> ${escapeHTML(customer.instructions)}</p>` : ''}</div>`;
}

function setMinimumDeliveryDate() {
  const now = new Date();
  const localToday = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const dateInput = document.querySelector('#delivery-date');
  dateInput.min = localToday;
  dateInput.addEventListener('change', () => {
    dateInput.setCustomValidity(dateInput.value && dateInput.value < localToday ? 'Choose today or a later date.' : '');
  });
}

/* Email Sending: the same-origin server keeps fixed recipients and SMTP secrets private. */
customerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  customerForm.classList.add('was-validated');
  alertBox.classList.add('d-none');

  if (!customerForm.checkValidity()) {
    customerForm.querySelector(':invalid')?.focus();
    return;
  }

  if (!appConfigLoaded) {
    showAlert('Order settings are unavailable. Refresh the page before placing your order.', 'danger');
    return;
  }

  const { selected, grandTotal } = updateOrderSummary();
  if (!selected.length) {
    showAlert('Add at least one product before placing your order.', 'warning');
    document.querySelector('#products-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  const customer = readCustomerDetails();
  const address = `${customer.address}\n${customer.city}, ${customer.postalCode}`;
  const invoiceNumber = makeInvoiceNumber();
  const createdAt = new Date();
  const deliveryCharge = getDeliveryCharge();
  const invoiceData = { customer, address, selected, subtotal: grandTotal - deliveryCharge, deliveryCharge, grandTotal, invoiceNumber, deliveryDate: customer.deliveryDate, createdAt };
  const payload = {
    customerDetails: customer,
    address,
    deliveryDate: customer.deliveryDate,
    orderedItems: selected.map(({ id, name, tamilName, quantity, unitPrice, lineTotal, unit }) => ({ id, name, tamilName, quantity, unitPrice, lineTotal, unit })),
    subtotal: grandTotal - deliveryCharge,
    deliveryCharge,
    grandTotal
  };

  setLoading(true);
  try {
    const response = await fetch('/api/send-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || 'The order could not be saved.');
    }
    const savedOrder = result.order;
    invoiceData.customer = savedOrder.customerDetails;
    invoiceData.address = savedOrder.address;
    invoiceData.selected = savedOrder.orderedItems;
    invoiceData.subtotal = savedOrder.subtotal;
    invoiceData.deliveryCharge = savedOrder.deliveryCharge;
    invoiceData.grandTotal = savedOrder.grandTotal;
    invoiceData.invoiceNumber = savedOrder.id;
    invoiceData.deliveryDate = savedOrder.deliveryDate;
    invoiceData.createdAt = new Date(savedOrder.createdAt);
    if (result.emailSent) {
      showAlert(`Order ${invoiceData.invoiceNumber} saved and confirmation email sent.`, 'success');
      document.querySelector('#invoice-modal-title').textContent = 'Your invoice';
      document.querySelector('#invoice-status').textContent = 'ORDER CONFIRMED';
    } else {
      showAlert(`Order ${invoiceData.invoiceNumber} saved. ${result.emailMessage || 'Email notification is unavailable.'}`, 'warning');
      document.querySelector('#invoice-modal-title').textContent = 'Order saved · invoice';
      document.querySelector('#invoice-status').textContent = 'EMAIL NOT SENT';
    }
    renderInvoice(invoiceData);
    invoiceModal.show();
  } catch (error) {
    document.querySelector('#invoice-modal-title').textContent = 'Invoice preview';
    document.querySelector('#invoice-status').textContent = 'EMAIL NOT SENT';
    renderInvoice(invoiceData);
    showAlert(`Invoice ${invoiceNumber} is ready, but the order email could not be sent. ${error.message} Please contact us to confirm your order.`, 'warning');
    invoiceModal.show();
  } finally {
    setLoading(false);
  }
});

document.querySelector('#print-invoice').addEventListener('click', () => window.print());
document.querySelector('#download-pdf').addEventListener('click', () => window.print());

setMinimumDeliveryDate();
renderProducts();
async function loadAppConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Order settings could not be loaded.');
    const config = await response.json();
    if (!Number.isInteger(config.deliveryCharge) || config.deliveryCharge < 0) {
      throw new Error('The configured delivery charge is invalid.');
    }
    document.querySelector('#delivery-charge').value = String(config.deliveryCharge);
    appConfigLoaded = true;
    updateOrderSummary();
    placeOrderButton.disabled = false;
  } catch (error) {
    showAlert(`${error.message} Refresh the page before placing an order.`, 'danger');
  }
}

loadAppConfig();
if (!products.length) showAlert('The product catalog could not be loaded from the price list.', 'danger');
