let activeRider = null;
let riderOrders = [];
let riderPayouts = [];
let refreshInProgress = false;
let installPrompt = null;

const views = [...document.querySelectorAll('[data-view]')];
const formatNgn = amount => new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 0,
}).format(amount);

function setStatus(selector, message) {
  const element = document.querySelector(selector);
  element.textContent = message;
  element.hidden = !message;
}

function showAccountState(rider) {
  document.querySelector('#sign-in-view').hidden = true;
  document.querySelector('#register-view').hidden = true;
  document.querySelector('#rider-workspace').hidden = true;
  document.querySelector('.desktop-nav').hidden = true;
  document.querySelector('.mobile-nav').hidden = true;
  document.querySelector('#header-sign-out').hidden = false;
  document.querySelector('#account-state').hidden = false;
  document.querySelector('#account-state-title').textContent = rider.status === 'Declined'
    ? 'Application update'
    : 'Application received';
  setStatus('#application-notice', '');
  document.querySelector('#account-state-message').textContent = rider.status === 'Declined'
    ? `Your rider application was not approved at this time. Please contact A&M if you have questions.`
    : `Thanks, ${rider.name.split(' ')[0]}. A&M is reviewing your application. Your rider dashboard will be available if your application is approved.`;
  document.querySelector('#application-reference').textContent = `Application ${rider.reference} · ${rider.status}`;
}

function showAuthView(view) {
  const registering = view === 'register';
  document.querySelector('#sign-in-view').hidden = registering;
  document.querySelector('#register-view').hidden = !registering;
  setStatus('#login-status', '');
  setStatus('#register-status', '');
  window.scrollTo(0, 0);
}

function showSignIn(message = '') {
  activeRider = null;
  document.querySelector('#sign-in-view').hidden = false;
  document.querySelector('#register-view').hidden = true;
  document.querySelector('#account-state').hidden = true;
  document.querySelector('#rider-workspace').hidden = true;
  document.querySelector('.desktop-nav').hidden = true;
  document.querySelector('.mobile-nav').hidden = true;
  document.querySelector('#header-sign-out').hidden = true;
  setStatus('#login-status', message);
}

function showWorkspace(rider) {
  activeRider = rider;
  document.querySelector('#sign-in-view').hidden = true;
  document.querySelector('#account-state').hidden = true;
  document.querySelector('#rider-workspace').hidden = false;
  document.querySelector('.desktop-nav').hidden = false;
  document.querySelector('.mobile-nav').hidden = false;
  document.querySelector('#header-sign-out').hidden = false;
  document.querySelector('#rider-first-name').textContent = rider.name.split(' ')[0];
  document.querySelector('#rider-area').textContent = rider.area;
  document.querySelector('#rider-vehicle').textContent = rider.vehicle;
  showView('home');
}

function showView(view) {
  const nextView = views.find(section => section.dataset.view === view);
  if (!nextView || !activeRider) return;
  views.forEach(section => { section.hidden = section !== nextView; });
  document.querySelectorAll('[data-rider-view]').forEach(button => {
    const active = button.dataset.riderView === view;
    const inNav = button.closest('nav') || button.closest('.desktop-nav');
    if (inNav) button.classList.toggle('active', active);
    if (button.closest('nav')) button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  window.scrollTo(0, 0);
  if (view === 'deliveries') void loadDeliveries();
  if (view === 'messages') void loadMessages();
  if (view === 'earnings') void loadPayouts();
}

function buildDeliveryCard(order, includeHandoff) {
  const card = document.createElement('article');
  card.className = 'delivery-card';
  const photo = document.createElement('img');
  photo.className = 'delivery-photo';
  photo.crossOrigin = 'use-credentials';
  photo.src = api.url(`/api/orders/${encodeURIComponent(order.id)}/photo`);
  photo.alt = `Package photo for delivery ${order.reference}`;
  photo.addEventListener('error', () => { photo.hidden = true; }, { once: true });

  const heading = document.createElement('h2');
  heading.textContent = `${order.reference} · ${order.quantity} × ${order.item}`;
  const status = document.createElement('span');
  status.className = 'delivery-status';
  status.textContent = order.status;
  const pickup = document.createElement('p');
  pickup.textContent = `Pickup: ${order.pickup}`;
  const pickupContact = document.createElement('p');
  pickupContact.textContent = `Pickup contact: ${order.pickupEmail || 'No contact email'}`;
  const delivery = document.createElement('p');
  delivery.textContent = `Drop-off: ${order.delivery}`;
  const deliveryContact = document.createElement('p');
  deliveryContact.textContent = `Drop-off contact: ${order.deliveryEmail || 'No contact email'}`;
  const pickupDate = document.createElement('p');
  pickupDate.textContent = `Pickup date: ${order.date}`;
  const paymentAmount = order.paymentSubmittedAmountNgn ?? order.deliveryPriceNgn;
  const payment = document.createElement('p');
  if (order.deliveryPriceNgn != null) {
    const paymentState = order.paymentStatus === 'paid'
      ? 'payment confirmed'
      : order.paymentStatus === 'proof_submitted'
        ? 'payment reference sent, waiting for A&M to check'
        : 'waiting for customer payment';
    payment.textContent = `Delivery fee: ${formatNgn(paymentAmount)} · ${paymentState}`;
  } else {
    payment.textContent = 'Delivery fee: A&M will confirm';
  }
  const earnings = document.createElement('p');
  if (order.riderEarningsNgn != null) {
    earnings.textContent = `Your earnings: ${formatNgn(order.riderEarningsNgn)}`;
  } else if (order.paymentStatus === 'paid' && Number.isSafeInteger(paymentAmount)) {
    earnings.textContent = `Expected earnings: ${formatNgn(Math.round(paymentAmount * 0.05))} after delivery`;
  } else {
    earnings.textContent = 'Your earnings are 5% of the payment confirmed by A&M.';
  }
  card.append(photo, heading, status, pickup, pickupContact, delivery, deliveryContact, pickupDate, payment, earnings);

  if (includeHandoff) {
    if (order.status === 'Confirmed' && !order.pickupVerified) {
      if (order.deliveryPriceNgn != null && order.paymentStatus !== 'paid') {
        const note = document.createElement('p');
        note.textContent = order.paymentStatus === 'proof_submitted'
          ? 'The customer sent a payment reference. A&M must confirm payment before pickup.'
          : 'The pickup code will be available after A&M confirms payment.';
        card.append(note);
      } else {
        addHandoffControls(card, order, 'pickup');
      }
    } else if (order.pickupVerified && !order.deliveryVerified
      && ['Collected', 'In transit'].includes(order.status)) {
      addHandoffControls(card, order, 'delivery');
    } else if (order.deliveryVerified) {
      const completed = document.createElement('p');
      completed.textContent = 'The drop-off contact has confirmed receipt.';
      card.append(completed);
    }
  }
  return card;
}

function addHandoffControls(card, order, phase) {
  const section = document.createElement('section');
  section.className = 'handoff';
  const phaseLabel = phase === 'pickup' ? 'pickup' : 'drop-off';
  const message = document.createElement('p');
  message.className = 'app-status';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  const sendButton = document.createElement('button');
  sendButton.className = 'button button-outline';
  sendButton.type = 'button';
  sendButton.textContent = `Email ${phaseLabel} code`;
  const form = document.createElement('form');
  form.className = 'handoff-form';
  form.hidden = true;
  const label = document.createElement('label');
  label.textContent = `6-digit code from the ${phaseLabel} contact`;
  const input = document.createElement('input');
  input.name = 'code';
  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'one-time-code';
  input.pattern = '[0-9]{6}';
  input.maxLength = 6;
  input.required = true;
  input.placeholder = '000000';
  label.append(input);
  const verifyButton = document.createElement('button');
  verifyButton.className = 'button button-dark';
  verifyButton.type = 'submit';
  verifyButton.textContent = `Confirm ${phaseLabel}`;
  const resendButton = document.createElement('button');
  resendButton.className = 'button button-outline';
  resendButton.type = 'button';
  resendButton.textContent = 'Send a new code';
  form.append(label, verifyButton, resendButton);

  async function emailCode() {
    sendButton.disabled = true;
    resendButton.disabled = true;
    setStatus(`#${message.id}`, '');
    try {
      const result = await api.request(`/api/rider/orders/${encodeURIComponent(order.id)}/handoff-code`, {
        method: 'POST',
        body: JSON.stringify({ phase }),
      });
      form.hidden = false;
      sendButton.hidden = true;
      setStatus(`#${message.id}`, result.warning
        ? `${result.message} ${result.warning}`
        : `${result.message} The code expires in 10 minutes.`);
      input.focus();
    } catch (error) {
      setStatus(`#${message.id}`, error.message);
    } finally {
      sendButton.disabled = false;
      resendButton.disabled = false;
    }
  }

  sendButton.addEventListener('click', emailCode);
  resendButton.addEventListener('click', emailCode);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    verifyButton.disabled = true;
    setStatus(`#${message.id}`, '');
    try {
      const result = await api.request(`/api/rider/orders/${encodeURIComponent(order.id)}/verify-code`, {
        method: 'POST',
        body: JSON.stringify({ phase, code: input.value }),
      });
      setStatus(`#${message.id}`, result.warning
        ? `Code accepted. ${result.warning}`
        : `${phaseLabel} confirmed.`);
      await loadAllData();
    } catch (error) {
      setStatus(`#${message.id}`, error.message);
      verifyButton.disabled = false;
      return;
    }
    verifyButton.disabled = false;
  });
  message.id = `handoff-status-${order.id}-${phase}`;
  section.append(sendButton, form, message);
  card.append(section);
}

function renderDeliveryLists() {
  const fullList = document.querySelector('#delivery-list');
  const homeList = document.querySelector('#home-delivery-list');
  fullList.replaceChildren();
  homeList.replaceChildren();
  if (!riderOrders.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = 'No deliveries have been assigned yet. New work will show here when A&M assigns it to you.';
    fullList.append(empty);
    homeList.append(empty.cloneNode(true));
  } else {
    riderOrders.forEach((order, index) => {
      fullList.append(buildDeliveryCard(order, true));
      if (index < 2) homeList.append(buildDeliveryCard(order, false));
    });
  }
  const completed = riderOrders.filter(order => order.status === 'Delivered');
  const totalEarnings = completed.reduce((sum, order) => sum + (Number.isSafeInteger(order.riderEarningsNgn) ? order.riderEarningsNgn : 0), 0);
  document.querySelector('#assigned-count').textContent = String(riderOrders.filter(order => order.status !== 'Delivered' && order.status !== 'Cancelled').length);
  document.querySelector('#completed-count').textContent = String(completed.length);
  document.querySelector('#earnings-total').textContent = formatNgn(totalEarnings);
}

async function loadDeliveries() {
  setStatus('#deliveries-status', '');
  try {
    const result = await api.request('/api/rider/deliveries');
    riderOrders = result.orders;
    renderDeliveryLists();
    renderPayoutSummary();
  } catch (error) {
    setStatus('#deliveries-status', `Could not load deliveries: ${error.message}`);
  }
}

async function loadMessages() {
  setStatus('#messages-status', '');
  const list = document.querySelector('#message-list');
  list.replaceChildren();
  try {
    const { notifications } = await api.request('/api/rider/notifications');
    if (!notifications.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-message';
      empty.textContent = 'You do not have any messages yet.';
      list.append(empty);
      return;
    }
    notifications.forEach(notification => {
      const card = document.createElement('article');
      card.className = 'message-card';
      const title = document.createElement('h2');
      title.textContent = notification.subject;
      const body = document.createElement('p');
      body.textContent = notification.message;
      const date = document.createElement('time');
      date.dateTime = new Date(notification.created_at).toISOString();
      date.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notification.created_at));
      card.append(title, body, date);
      list.append(card);
    });
  } catch (error) {
    setStatus('#messages-status', `Could not load messages: ${error.message}`);
  }
}

function payoutWeekOptions() {
  const today = new Date();
  const mondayOffset = (today.getUTCDay() + 6) % 7;
  const thisWeekMonday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    - mondayOffset * 24 * 60 * 60 * 1000;
  return Array.from({ length: 12 }, (_, index) => {
    const start = new Date(thisWeekMonday - (index + 1) * 7 * 24 * 60 * 60 * 1000);
    return start.toISOString().slice(0, 10);
  });
}

function populatePayoutWeeks() {
  const select = document.querySelector('#payout-week');
  if (select.options.length) return;
  payoutWeekOptions().forEach(start => {
    const end = new Date(Date.parse(`${start}T00:00:00.000Z`) + 6 * 24 * 60 * 60 * 1000);
    const option = document.createElement('option');
    option.value = start;
    option.textContent = `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${start}T00:00:00.000Z`))} – ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(end)}`;
    select.append(option);
  });
}

function renderPayoutSummary() {
  const selectedWeek = document.querySelector('#payout-week').value;
  if (!selectedWeek) return;
  const start = Date.parse(`${selectedWeek}T00:00:00.000Z`);
  const end = start + 7 * 24 * 60 * 60 * 1000;
  const completed = riderOrders.filter(order => order.status === 'Delivered'
    && order.deliveredAt >= start
    && order.deliveredAt < end
    && Number.isSafeInteger(order.riderEarningsNgn));
  const payout = riderPayouts.find(item => item.week_start === selectedWeek);
  const claimed = new Set(riderPayouts
    .filter(item => item.status !== 'Declined')
    .flatMap(item => item.order_ids || []));
  const available = completed.filter(order => !claimed.has(order.id));
  const total = completed.reduce((sum, order) => sum + order.riderEarningsNgn, 0);
  const availableAmount = available.reduce((sum, order) => sum + order.riderEarningsNgn, 0);
  document.querySelector('#payout-summary').textContent = `${completed.length} completed ${completed.length === 1 ? 'delivery' : 'deliveries'} · ${formatNgn(total)} earned · ${formatNgn(availableAmount)} available to request`;
  const rows = document.querySelector('#payout-deliveries');
  rows.replaceChildren();
  if (!completed.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No completed deliveries for this week.';
    rows.append(empty);
  } else {
    completed.forEach(order => {
      const row = document.createElement('p');
      row.textContent = `${order.reference} · ${order.quantity} × ${order.item} · ${formatNgn(order.riderEarningsNgn)}`;
      rows.append(row);
    });
  }
  const history = document.querySelector('#payout-history');
  history.replaceChildren();
  if (payout) {
    const status = document.createElement('p');
    status.className = 'payout-history-item';
    status.textContent = `Payout request: ${payout.status} · ${formatNgn(payout.amount_ngn)}`;
    history.append(status);
  }
  document.querySelector('#request-payout').disabled = !available.length || Boolean(payout && payout.status !== 'Declined');
}

async function loadPayouts() {
  setStatus('#payout-status', '');
  populatePayoutWeeks();
  try {
    const { payouts } = await api.request('/api/rider/payouts');
    riderPayouts = payouts;
    renderPayoutSummary();
  } catch (error) {
    setStatus('#payout-status', `Could not load payout requests: ${error.message}`);
    document.querySelector('#request-payout').disabled = true;
  }
}

async function loadAllData() {
  if (refreshInProgress || !activeRider) return;
  refreshInProgress = true;
  try {
    const results = await Promise.allSettled([
      api.request('/api/rider/deliveries'),
      api.request('/api/rider/notifications'),
      api.request('/api/rider/payouts'),
    ]);
    const [deliveries, messages, payouts] = results;
    if (deliveries.status === 'fulfilled') {
      riderOrders = deliveries.value.orders;
      renderDeliveryLists();
      setStatus('#deliveries-status', '');
    } else {
      setStatus('#deliveries-status', `Could not load deliveries: ${deliveries.reason.message}`);
    }
    if (messages.status === 'fulfilled') {
      const list = document.querySelector('#message-list');
      list.replaceChildren();
      if (!messages.value.notifications.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-message';
        empty.textContent = 'You do not have any messages yet.';
        list.append(empty);
      } else {
        messages.value.notifications.forEach(notification => {
          const card = document.createElement('article');
          card.className = 'message-card';
          const title = document.createElement('h2');
          title.textContent = notification.subject;
          const body = document.createElement('p');
          body.textContent = notification.message;
          const date = document.createElement('time');
          date.dateTime = new Date(notification.created_at).toISOString();
          date.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notification.created_at));
          card.append(title, body, date);
          list.append(card);
        });
      }
      setStatus('#messages-status', '');
    } else {
      setStatus('#messages-status', `Could not load messages: ${messages.reason.message}`);
    }
    if (payouts.status === 'fulfilled') {
      riderPayouts = payouts.value.payouts;
      renderPayoutSummary();
      setStatus('#payout-status', '');
    } else {
      setStatus('#payout-status', `Could not load payout requests: ${payouts.reason.message}`);
    }
  } finally {
    refreshInProgress = false;
  }
}

async function checkRiderSession() {
  try {
    const result = await api.request('/api/rider/me');
    if (!result.rider) {
      showSignIn();
    } else if (result.rider.status === 'Approved') {
      showWorkspace(result.rider);
      await loadAllData();
    } else {
      activeRider = result.rider;
      showAccountState(result.rider);
    }
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      showSignIn();
      return;
    }
    showSignIn(`Could not connect to your rider account: ${error.message}`);
  }
}

document.addEventListener('click', event => {
  const control = event.target.closest('[data-rider-view]');
  if (control) {
    event.preventDefault();
    showView(control.dataset.riderView);
  }
});

document.querySelector('#rider-app-login').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const values = new FormData(form);
  submit.disabled = true;
  setStatus('#login-status', '');
  try {
    await api.request('/api/rider/login', {
      method: 'POST',
      body: JSON.stringify({ email: values.get('email'), password: values.get('password') }),
    });
    const session = await api.request('/api/rider/me');
    if (!session.rider) {
      showSignIn('Sign-in could not be saved. Open this app from the A&M website or sign in again after the app is deployed.');
      return;
    }
    form.reset();
    if (session.rider.status === 'Approved') {
      showWorkspace(session.rider);
      await loadAllData();
    } else {
      activeRider = session.rider;
      showAccountState(session.rider);
    }
  } catch (error) {
    setStatus('#login-status', error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll('[data-auth-view]').forEach(button => {
  button.addEventListener('click', () => showAuthView(button.dataset.authView));
});

document.querySelector('#rider-app-register').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const values = new FormData(form);
  setStatus('#register-status', '');
  if (values.get('password') !== values.get('confirmPassword')) {
    setStatus('#register-status', 'Those passwords do not match. Please check and try again.');
    return;
  }
  submit.disabled = true;
  try {
    const result = await api.request('/api/rider/applications', {
      method: 'POST',
      body: JSON.stringify({
        name: values.get('name'),
        phone: values.get('phone'),
        email: values.get('email'),
        vehicle: values.get('vehicle'),
        license: values.get('license'),
        area: values.get('area'),
        password: values.get('password'),
      }),
    });
    form.reset();
    activeRider = result.rider;
    showAccountState(result.rider);
    setStatus('#application-notice', result.warning || 'Your application is saved. A&M must approve it before you can access the rider dashboard.');
  } catch (error) {
    setStatus('#register-status', error.message);
  } finally {
    submit.disabled = false;
  }
});

async function signOut() {
  const button = document.querySelector('#header-sign-out');
  button.disabled = true;
  setStatus('#account-state-status', '');
  try {
    await api.request('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ role: 'rider' }),
    });
    document.querySelector('#rider-app-login').reset();
    showSignIn();
  } catch (error) {
    setStatus('#account-state-status', `Could not sign out: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}
document.querySelector('#header-sign-out').addEventListener('click', signOut);
document.querySelector('#account-state-sign-out').addEventListener('click', signOut);
document.querySelector('#refresh-deliveries').addEventListener('click', loadDeliveries);
document.querySelector('#refresh-messages').addEventListener('click', loadMessages);
document.querySelector('#refresh-earnings').addEventListener('click', loadPayouts);
document.querySelector('#payout-week').addEventListener('change', renderPayoutSummary);
document.querySelector('#request-payout').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  setStatus('#payout-status', '');
  try {
    const result = await api.request('/api/rider/payouts', {
      method: 'POST',
      body: JSON.stringify({ weekStart: document.querySelector('#payout-week').value }),
    });
    const { payouts } = await api.request('/api/rider/payouts');
    riderPayouts = payouts;
    renderPayoutSummary();
    setStatus('#payout-status', result.warning || `Payout request sent for ${formatNgn(result.payout.amount_ngn)}.`);
  } catch (error) {
    setStatus('#payout-status', error.message);
    button.disabled = false;
  }
});

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  document.querySelector('#install-app').hidden = false;
});

document.querySelector('#install-app').addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  document.querySelector('#install-app').hidden = true;
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  document.querySelector('#install-app').hidden = true;
});

checkRiderSession();
