let currentUser = null;
let calculatedRoute = null;
let bankAvailable = false;
let photoUrl = '';
const supportedPhotoTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/tiff',
]);

const appViews = [...document.querySelectorAll('[data-view]')];
const orderForm = document.querySelector('#app-order-form');
const photoInput = document.querySelector('#app-order-photo');
const pickupInput = orderForm.elements.pickup;
const deliveryInput = orderForm.elements.delivery;
const calculateButton = document.querySelector('#app-calculate-route');
const pricePreview = document.querySelector('#app-delivery-price');
const routeDistance = document.querySelector('#app-route-distance');

function setStatus(selector, message) {
  const status = document.querySelector(selector);
  status.textContent = message;
  status.hidden = !message;
}

function setAuthView(view) {
  const register = view === 'register';
  document.querySelector('#app-login-form').hidden = register;
  document.querySelector('#app-register-form').hidden = !register;
  document.querySelectorAll('.auth-tab').forEach(tab => {
    const active = tab.dataset.authView === view;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  setStatus('#login-status', '');
  setStatus('#register-status', '');
}

function updateAccountView() {
  document.querySelector('#app-auth-panel').hidden = Boolean(currentUser);
  document.querySelector('#account-summary').hidden = !currentUser;
  document.querySelector('#deliveries-gate').hidden = Boolean(currentUser);
  document.querySelector('#order-gate').hidden = Boolean(currentUser);
  orderForm.hidden = !currentUser;

  const accountButton = document.querySelector('.header-account');
  accountButton.textContent = currentUser ? currentUser.name.split(' ')[0] : 'Sign in';
  const arrow = document.createElement('span');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '↗';
  accountButton.append(arrow);

  if (currentUser) {
    document.querySelector('#app-customer-name').textContent = currentUser.name.split(' ')[0];
    document.querySelector('#app-customer-email').textContent = currentUser.email;
    orderForm.elements.phone.value = currentUser.phone;
    orderForm.elements.pickupEmail.value = currentUser.email;
  }
}

function showView(view) {
  const nextView = appViews.find(section => section.dataset.view === view);
  if (!nextView) return;
  appViews.forEach(section => { section.hidden = section !== nextView; });
  document.querySelectorAll('[data-app-view]').forEach(control => {
    const active = control.dataset.appView === view;
    control.classList.toggle('active', active && (control.closest('.desktop-nav') || control.closest('.mobile-nav')));
    if (control.closest('nav')) control.setAttribute('aria-current', active ? 'page' : 'false');
  });
  window.scrollTo(0, 0);

  if (view === 'deliveries' && currentUser) void loadOrders();
  if (view === 'order' && currentUser) {
    loadBankDetails();
    orderForm.querySelector('[name="item"]').focus({ preventScroll: true });
  }
}

async function loadCurrentUser() {
  try {
    const result = await api.request('/api/auth/me');
    currentUser = result.user;
    updateAccountView();
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      currentUser = null;
      updateAccountView();
      return;
    }
    setStatus('#account-status', `Could not connect to your account: ${error.message}`);
  }
}

function formatNgn(amount) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(amount);
}

async function loadOrders() {
  if (!currentUser) return;
  const list = document.querySelector('#app-order-list');
  list.replaceChildren();
  setStatus('#deliveries-status', '');
  try {
    const { orders } = await api.request('/api/customer/orders');
    if (!orders.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-orders';
      empty.textContent = 'You have no delivery requests yet. Your requests will appear here after you book a delivery.';
      list.append(empty);
      return;
    }
    orders.forEach(order => {
      const card = document.createElement('article');
      card.className = 'app-order-card';
      const image = document.createElement('img');
      image.crossOrigin = 'use-credentials';
      image.src = api.url(`/api/orders/${encodeURIComponent(order.id)}/photo`);
      image.alt = `Photo of ${order.item}`;
      image.addEventListener('error', () => { image.hidden = true; }, { once: true });

      const details = document.createElement('div');
      const title = document.createElement('h2');
      title.textContent = `${order.quantity} × ${order.item}`;
      const route = document.createElement('p');
      route.textContent = `${order.pickup} → ${order.delivery}`;
      const pickupDate = document.createElement('p');
      pickupDate.textContent = `Pickup date: ${order.date}`;
      const reference = document.createElement('p');
      reference.textContent = `Request ${order.reference}`;
      details.append(title, route, pickupDate, reference);

      const orderStatus = document.createElement('span');
      orderStatus.className = 'order-status';
      orderStatus.textContent = order.status;
      const payment = document.createElement('div');
      payment.className = 'payment-info';
      const fee = document.createElement('p');
      fee.textContent = order.deliveryPriceNgn == null
        ? 'A&M will confirm your delivery fee after reviewing the route.'
        : `${order.deliveryPriceConfirmed ? 'Confirmed delivery fee' : 'Estimated delivery fee'}: ${formatNgn(order.deliveryPriceNgn)}${order.deliveryDistanceKm != null ? ` · approximately ${order.deliveryDistanceKm} km` : ''}`;
      const paymentStatus = document.createElement('p');
      const paymentMessages = {
        unpaid: 'Payment has not been verified yet.',
        proof_submitted: 'Transfer reference submitted. Waiting for A&M to verify payment.',
        paid: 'Payment verified by A&M.',
      };
      paymentStatus.textContent = paymentMessages[order.paymentStatus] || 'Payment status pending.';
      payment.append(fee, paymentStatus);
      card.append(image, details, orderStatus, payment);
      list.append(card);
    });
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      currentUser = null;
      updateAccountView();
      setAuthView('login');
      showView('account');
      setStatus('#login-status', 'A&M could not keep your sign-in session. Open the app from the A&M website or use the local app server, then sign in again.');
      return;
    }
    setStatus('#deliveries-status', `Could not load your deliveries: ${error.message}`);
  }
}

async function loadBankDetails() {
  const panel = document.querySelector('#app-bank-details');
  panel.replaceChildren();
  bankAvailable = false;
  const loading = document.createElement('p');
  loading.textContent = 'Loading the bank account saved by A&M...';
  panel.append(loading);
  try {
    const { bank } = await api.request('/api/customer/payment-account');
    [`Bank: ${bank.bankName}`, `Account name: ${bank.accountName}`, `Account number: ${bank.accountNumber}`]
      .forEach(line => {
        const detail = document.createElement('p');
        detail.textContent = line;
        panel.append(detail);
      });
    bankAvailable = true;
  } catch (error) {
    const message = document.createElement('p');
    message.className = 'app-status';
    message.textContent = `Could not load A&M’s bank details: ${error.message}`;
    panel.replaceChildren(message);
  }
}

function invalidateRoute() {
  calculatedRoute = null;
  pricePreview.textContent = 'Addresses changed. Calculate the route again to see the estimate.';
  routeDistance.textContent = 'Your route estimate needs to be refreshed.';
}

async function calculateRoute() {
  const pickup = pickupInput.value.trim();
  const delivery = deliveryInput.value.trim();
  if (!pickup || !delivery) {
    setStatus('#order-status', 'Enter both the pickup and delivery addresses before calculating the route.');
    (pickup ? deliveryInput : pickupInput).focus();
    return;
  }
  calculateButton.disabled = true;
  calculateButton.textContent = 'Calculating route…';
  setStatus('#order-status', '');
  pricePreview.textContent = 'Finding the addresses and calculating the driving route…';
  routeDistance.textContent = 'This may take a few seconds.';
  try {
    const estimate = await api.request('/api/pricing/estimate', {
      method: 'POST',
      body: JSON.stringify({ pickup, delivery }),
    });
    if (pickup !== pickupInput.value.trim() || delivery !== deliveryInput.value.trim()) {
      invalidateRoute();
      return;
    }
    calculatedRoute = { pickup, delivery };
    pricePreview.textContent = formatNgn(estimate.estimatedFeeNgn);
    routeDistance.textContent = `Driving distance: ${estimate.distanceKm} km · ${estimate.pickupLabel} → ${estimate.deliveryLabel}. A&M will review the final fee after receiving your request.`;
  } catch (error) {
    calculatedRoute = null;
    pricePreview.textContent = 'We could not calculate this route.';
    routeDistance.textContent = error.message;
  } finally {
    calculateButton.disabled = false;
    calculateButton.textContent = 'Calculate route and fee';
  }
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read the selected photo.'));
    reader.readAsDataURL(file);
  });
}

function clearPhotoPreview() {
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = '';
  photoInput.value = '';
  document.querySelector('#app-photo-preview').hidden = true;
}

document.addEventListener('click', event => {
  const control = event.target.closest('[data-app-view]');
  if (control) {
    event.preventDefault();
    showView(control.dataset.appView);
  }
  const authTab = event.target.closest('[data-auth-view]');
  if (authTab) setAuthView(authTab.dataset.authView);
});

document.querySelector('#app-login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  setStatus('#login-status', '');
  try {
    await api.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: values.get('email'), password: values.get('password') }),
    });
    const session = await api.request('/api/auth/me');
    if (!session.user) {
      throw new Error('A&M could not keep your sign-in session. Open the app from the A&M website or use the local app server, then sign in again.');
    }
    currentUser = session.user;
    updateAccountView();
    showView('deliveries');
  } catch (error) {
    setStatus('#login-status', error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector('#app-register-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  if (values.get('password') !== values.get('confirmPassword')) {
    setStatus('#register-status', 'Those passwords do not match. Please check and try again.');
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  setStatus('#register-status', '');
  try {
    const result = await api.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: values.get('name'),
        phone: values.get('phone'),
        email: values.get('email'),
        password: values.get('password'),
      }),
    });
    const session = await api.request('/api/auth/me');
    if (!session.user) {
      currentUser = null;
      form.reset();
      updateAccountView();
      setAuthView('login');
      showView('account');
      setStatus('#login-status', 'Your account was created, but A&M could not keep your sign-in session. Open the app from the A&M website or use the local app server, then sign in.');
      return;
    }
    currentUser = session.user;
    form.reset();
    updateAccountView();
    showView('order');
    if (result.warning) setStatus('#account-status', 'Your account is ready, but A&M could not send the welcome email.');
  } catch (error) {
    setStatus('#register-status', error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector('#app-sign-out').addEventListener('click', async () => {
  const button = document.querySelector('#app-sign-out');
  button.disabled = true;
  setStatus('#account-status', '');
  try {
    await api.request('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ role: 'customer' }),
    });
    currentUser = null;
    updateAccountView();
    setAuthView('login');
  } catch (error) {
    setStatus('#account-status', `Could not sign out: ${error.message}`);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#app-order-photo').addEventListener('change', () => {
  const file = photoInput.files[0];
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = '';
  if (!file) {
    document.querySelector('#app-photo-preview').hidden = true;
    return;
  }
  if (!supportedPhotoTypes.has(file.type.toLowerCase()) || file.size > 5 * 1024 * 1024) {
    clearPhotoPreview();
    setStatus('#order-status', 'Choose a JPG, PNG, WebP, GIF, BMP, AVIF, HEIC/HEIF, or TIFF image under 5 MB.');
    return;
  }
  setStatus('#order-status', '');
  photoUrl = URL.createObjectURL(file);
  document.querySelector('#app-photo-preview-image').src = photoUrl;
  document.querySelector('#app-photo-file-name').textContent = file.name;
  document.querySelector('#app-photo-preview').hidden = false;
});

document.querySelector('#app-remove-photo').addEventListener('click', clearPhotoPreview);
calculateButton.addEventListener('click', calculateRoute);
pickupInput.addEventListener('input', invalidateRoute);
deliveryInput.addEventListener('input', invalidateRoute);

orderForm.elements.date.min = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
orderForm.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const photo = photoInput.files[0];
  if (!photo || !supportedPhotoTypes.has(photo.type.toLowerCase()) || photo.size > 5 * 1024 * 1024) {
    setStatus('#order-status', 'Add a JPG, PNG, WebP, GIF, BMP, AVIF, HEIC/HEIF, or TIFF item photo under 5 MB before submitting your request.');
    return;
  }
  if (!calculatedRoute || calculatedRoute.pickup !== pickupInput.value.trim() || calculatedRoute.delivery !== deliveryInput.value.trim()) {
    setStatus('#order-status', 'Calculate the route and estimated fee before submitting your request.');
    calculateButton.focus();
    return;
  }
  if (!bankAvailable) {
    setStatus('#order-status', 'Load A&M’s saved bank details before submitting your payment and delivery request.');
    await loadBankDetails();
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  setStatus('#order-status', '');
  try {
    const result = await api.request('/api/customer/orders', {
      method: 'POST',
      body: JSON.stringify({
        item: values.get('item'),
        quantity: values.get('quantity'),
        description: values.get('description'),
        pickup: values.get('pickup'),
        delivery: values.get('delivery'),
        pickupEmail: values.get('pickupEmail'),
        deliveryEmail: values.get('deliveryEmail'),
        date: values.get('date'),
        phone: values.get('phone'),
        notes: values.get('notes'),
        transferReference: values.get('transferReference'),
        paidConfirmation: values.get('paidConfirmation') === 'on',
        photo: await fileAsDataUrl(photo),
      }),
    });
    form.reset();
    calculatedRoute = null;
    pricePreview.textContent = 'Enter both addresses, then calculate your route.';
    routeDistance.textContent = 'Your route estimate will appear here.';
    clearPhotoPreview();
    form.elements.phone.value = currentUser.phone;
    form.elements.pickupEmail.value = currentUser.email;
    const completionMessage = result.warning
      ? `Request ${result.order.reference} was saved, but some emails could not be sent.`
      : `Request ${result.order.reference} was submitted. Payment is waiting for A&M to verify it.`;
    const feedback = document.querySelector('#app-feedback');
    feedback.textContent = completionMessage;
    feedback.hidden = false;
    await loadOrders();
    showView('deliveries');
  } catch (error) {
    setStatus('#order-status', error.message);
  } finally {
    submit.disabled = false;
  }
});

updateAccountView();
setAuthView('login');
loadCurrentUser();
