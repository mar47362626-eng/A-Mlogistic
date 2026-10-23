const menuToggle = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.primary-nav');
const authView = document.querySelector('#auth-view');
const dashboard = document.querySelector('#customer-dashboard');
let currentUser = null;
let selectedPhotoUrl = '';
let selectedPhotoDataUrl = '';
let photoReadPromise = Promise.resolve();
let calculatedRoute = null;
let routeQuoteToken = '';
let orderBankAvailable = false;
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
const pickupAddressInput = document.querySelector('#order-form [name="pickup"]');
const deliveryAddressInput = document.querySelector('#order-form [name="delivery"]');
const deliveryPricePreview = document.querySelector('#delivery-price-preview');
const routeDistance = document.querySelector('#route-distance');
const calculateRouteButton = document.querySelector('#calculate-route');

menuToggle.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Open navigation' : 'Close navigation');
  navigation.classList.toggle('is-open', !isOpen);
});

navigation.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (link) {
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation');
    navigation.classList.remove('is-open');
  }
});

document.querySelector('#year').textContent = new Date().getFullYear();

function showMessage(selector, message) {
  api.setStatus(document.querySelector(selector), message);
}

function updateNavigationForSession() {
  const loginLink = document.querySelector('#nav-login');
  const accountLink = document.querySelector('#nav-account');
  loginLink.textContent = currentUser ? 'My account' : 'Sign in';
  if (currentUser) {
    accountLink.removeAttribute('data-auth-view');
    accountLink.dataset.signOut = 'true';
    accountLink.textContent = 'Log out';
  } else {
    accountLink.removeAttribute('data-sign-out');
    accountLink.dataset.authView = 'register';
    accountLink.innerHTML = 'Create account <span aria-hidden="true">↗</span>';
  }
}

function setAuthView(view) {
  const registerSelected = view === 'register';
  document.querySelector('#login-form').hidden = registerSelected;
  document.querySelector('#register-form').hidden = !registerSelected;
  document.querySelectorAll('.portal-tab').forEach(tab => {
    const active = tab.dataset.authView === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  showMessage('#login-status', '');
  showMessage('#register-status', '');
}

function closeAuthScreen() {
  document.body.classList.remove('auth-screen-active');
  history.replaceState(null, '', window.location.pathname + window.location.search);
  window.scrollTo(0, 0);
}

async function loadCurrentUser() {
  try {
    currentUser = (await api.request('/api/auth/me')).user;
  } catch (error) {
    if (error.status !== 401 && error.status !== 403) throw error;
    currentUser = null;
  }
  updateNavigationForSession();
  return currentUser;
}

async function openAuthScreen(view) {
  document.body.classList.add('auth-screen-active');
  window.scrollTo(0, 0);
  try {
    await loadCurrentUser();
    if (currentUser) {
      await showDashboard();
      return;
    }
  } catch {
    showMessage('#login-status', 'The account service is unavailable right now. Please try again shortly.');
  }
  dashboard.hidden = true;
  authView.hidden = false;
  setAuthView(view);
  document.querySelector(`#${view}-form input`)?.focus();
}

async function loadOrders() {
  return (await api.request('/api/customer/orders')).orders;
}

function formatNgn(amount) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount);
}

async function loadOrderBankDetails() {
  const panel = document.querySelector('#order-bank-details');
  orderBankAvailable = false;
  panel.replaceChildren();
  const loading = document.createElement('p');
  loading.textContent = 'Loading the bank account saved by A&M...';
  panel.append(loading);
  try {
    const { bank } = await api.request('/api/customer/payment-account');
    [
      `Bank: ${bank.bankName}`,
      `Account name: ${bank.accountName}`,
      `Account number: ${bank.accountNumber}`,
    ].forEach(line => {
      const detail = document.createElement('p');
      detail.textContent = line;
      panel.append(detail);
    });
    orderBankAvailable = true;
    return true;
  } catch (error) {
    const message = document.createElement('p');
    message.className = 'bank-transfer-error';
    message.textContent = error.message;
    panel.replaceChildren(message);
    return false;
  }
}

function invalidateCalculatedRoute() {
  calculatedRoute = null;
  routeQuoteToken = '';
  deliveryPricePreview.textContent = 'Addresses changed. Calculate the route again to see the estimate.';
  routeDistance.textContent = 'Enter both addresses to see the driving distance and estimated fee.';
}

async function renderOrders() {
  const list = document.querySelector('#order-list');
  list.replaceChildren();
  const orders = await loadOrders();
  document.querySelector('#order-count').textContent = `${orders.length} ${orders.length === 1 ? 'request' : 'requests'}`;
  if (!orders.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-orders';
    empty.textContent = 'Your delivery requests will appear here.';
    list.append(empty);
    return;
  }
  orders.forEach(order => {
    const card = document.createElement('article');
    card.className = 'order-card';
    const image = document.createElement('img');
    image.crossOrigin = 'use-credentials';
    image.src = api.url(`/api/orders/${encodeURIComponent(order.id)}/photo`);
    image.alt = `Photo of ${order.item}`;
    const info = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = `${order.quantity} × ${order.item}`;
    const route = document.createElement('p');
    route.textContent = `${order.pickup} → ${order.delivery}`;
    const pickupDate = document.createElement('p');
    pickupDate.textContent = `Pickup date: ${order.date}`;
    const status = document.createElement('span');
    status.className = 'order-status';
    status.textContent = order.status;
    const reference = document.createElement('span');
    reference.className = 'order-reference';
    reference.textContent = order.reference;
    info.append(title, route, pickupDate, status);
    card.append(image, info, reference);
    const payment = document.createElement('section');
    payment.className = 'payment-summary';
    const deliveryFeeConfirmed = order.deliveryPriceConfirmed === true;
    const quote = document.createElement('p');
    quote.textContent = order.deliveryPriceNgn !== null && order.deliveryPriceNgn !== undefined
      ? `${deliveryFeeConfirmed ? 'Delivery fee confirmed' : 'Estimated delivery fee'}: ${formatNgn(order.deliveryPriceNgn)}${order.deliveryDistanceKm != null ? ` · approximately ${order.deliveryDistanceKm} km` : ''}${deliveryFeeConfirmed ? '.' : '. A&M will confirm the final fee after reviewing the route.'}`
      : 'A&M Logistics will confirm your delivery fee after reviewing the route.';
    const paymentStatus = document.createElement('p');
    paymentStatus.className = 'payment-status';
    const statusMessages = {
      unpaid: deliveryFeeConfirmed
        ? 'Your final fee is saved. Bank details are shown below; order confirmation is not required to pay.'
        : 'Bank details will appear after A&M saves your final delivery fee.',
      proof_submitted: 'Transfer reference submitted. Waiting for A&M to verify payment.',
      paid: 'Payment verified by A&M.',
    };
    paymentStatus.textContent = statusMessages[order.paymentStatus] || 'Payment status pending.';
    payment.append(quote, paymentStatus);

    if (order.status !== 'Cancelled' && deliveryFeeConfirmed && order.deliveryPriceNgn != null && order.paymentStatus !== 'paid') {
      const instructionsButton = document.createElement('button');
      instructionsButton.type = 'button';
      instructionsButton.className = 'payment-details-button';
      instructionsButton.textContent = 'Loading bank transfer details...';
      const details = document.createElement('div');
      details.className = 'payment-details';
      details.hidden = true;
      instructionsButton.addEventListener('click', async () => {
          if (!details.hidden) {
            details.hidden = true;
            instructionsButton.textContent = 'Show bank transfer details';
            return;
          }
          if (details.dataset.loaded === 'true') {
            details.hidden = false;
            instructionsButton.textContent = 'Hide bank transfer details';
            return;
          }
          details.replaceChildren();
          instructionsButton.disabled = true;
          try {
            const instructions = await api.request(`/api/customer/orders/${encodeURIComponent(order.id)}/payment-instructions`);
            [
              `Bank: ${instructions.bank.bankName}`,
              `Account name: ${instructions.bank.accountName}`,
              `Account number: ${instructions.bank.accountNumber}`,
              `Amount: ${formatNgn(instructions.amountNgn)}`,
              `Transfer narration/reference: ${instructions.paymentReference}`,
            ].forEach(line => {
              const detail = document.createElement('p');
              detail.textContent = line;
              details.append(detail);
            });
            const form = document.createElement('form');
            form.className = 'payment-reference-form';
            const label = document.createElement('label');
            label.textContent = 'Bank transaction reference';
            const input = document.createElement('input');
            input.name = 'transferReference';
            input.required = true;
            input.minLength = 3;
            input.maxLength = 100;
            input.autocomplete = 'off';
            input.placeholder = 'Enter the reference shown by your bank';
            input.value = instructions.transferReference || '';
            label.append(input);
            const paidLabel = document.createElement('label');
            paidLabel.className = 'payment-paid-confirmation';
            const paidCheckbox = document.createElement('input');
            paidCheckbox.name = 'paidConfirmation';
            paidCheckbox.type = 'checkbox';
            paidCheckbox.required = true;
            const paidText = document.createElement('span');
            paidText.textContent = 'I have completed the bank transfer to the account above.';
            paidLabel.append(paidCheckbox, paidText);
            const submit = document.createElement('button');
            submit.type = 'submit';
            submit.className = 'payment-details-button';
            submit.textContent = order.paymentStatus === 'proof_submitted'
              ? 'I have paid — update my reference'
              : 'I have paid — notify A&M';
            const message = document.createElement('p');
            message.className = 'payment-status';
            message.setAttribute('role', 'status');
            form.append(label, paidLabel, submit, message);
            form.addEventListener('submit', async event => {
              event.preventDefault();
              submit.disabled = true;
              try {
                const submitted = await api.request(`/api/customer/orders/${encodeURIComponent(order.id)}/payment-reference`, {
                  method: 'POST',
                  body: JSON.stringify({
                    transferReference: input.value,
                    paidConfirmation: paidCheckbox.checked,
                  }),
                });
                order.paymentStatus = submitted.order.paymentStatus;
                order.transferReference = submitted.order.transferReference;
                paymentStatus.textContent = 'Transfer reference submitted. Waiting for A&M to verify payment.';
                message.textContent = submitted.warning || 'Reference submitted. A&M will verify the transfer before pickup.';
                if (submitted.warning) message.dataset.state = 'error';
                else delete message.dataset.state;
                submit.textContent = 'I have paid — update my reference';
              } catch (error) {
                message.textContent = error.message;
                message.dataset.state = 'error';
                submit.disabled = false;
              }
            });
            details.append(form);
            details.dataset.loaded = 'true';
            details.hidden = false;
            instructionsButton.textContent = 'Hide bank transfer details';
          } catch (error) {
            const message = document.createElement('p');
            message.className = 'payment-status';
            message.textContent = error.message;
            details.replaceChildren(message);
            details.hidden = false;
            instructionsButton.textContent = 'Retry loading bank details';
          } finally {
            instructionsButton.disabled = false;
          }
      });
      payment.append(instructionsButton, details);
      instructionsButton.click();
    }
    card.append(payment);
    list.append(card);
  });
}

async function renderCustomerNotifications() {
  const messages = (await api.request('/api/customer/notifications')).notifications;
  const list = document.querySelector('#customer-notifications');
  list.replaceChildren();
  document.querySelector('#notification-count').textContent = `${messages.length} ${messages.length === 1 ? 'message' : 'messages'}`;
  if (!messages.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-orders';
    empty.textContent = 'No messages yet.';
    list.append(empty);
    return;
  }
  messages.forEach(message => {
    const card = document.createElement('article');
    card.className = 'customer-notification';
    const subject = document.createElement('h4');
    subject.textContent = message.subject;
    const body = document.createElement('p');
    body.textContent = message.message;
    const date = document.createElement('time');
    date.dateTime = new Date(message.created_at).toISOString();
    date.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(message.created_at));
    card.append(subject, body, date);
    list.append(card);
  });
}

async function showDashboard() {
  if (!currentUser) return;
  authView.hidden = true;
  dashboard.hidden = false;
  document.querySelector('#customer-name').textContent = currentUser.name.split(' ')[0];
  const orderForm = document.querySelector('#order-form');
  orderForm.hidden = true;
  document.querySelector('#show-order-form').setAttribute('aria-expanded', 'false');
  orderForm.elements.phone.value = currentUser.phone;
  orderForm.elements.pickupEmail.value = currentUser.email;
  const today = new Date();
  orderForm.elements.date.min = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  showMessage('#order-status', '');
  try {
    await Promise.all([renderOrders(), renderCustomerNotifications(), loadOrderBankDetails()]);
  } catch {
    showMessage('#order-status', 'We could not load your account details. Refresh the page to try again.');
  }
}

document.querySelectorAll('.portal-tab').forEach(tab => {
  tab.addEventListener('click', () => setAuthView(tab.dataset.authView));
});

document.querySelector('#show-order-form').addEventListener('click', async event => {
  const button = event.currentTarget;
  const orderForm = document.querySelector('#order-form');
  orderForm.hidden = !orderForm.hidden;
  button.setAttribute('aria-expanded', String(!orderForm.hidden));
  button.textContent = orderForm.hidden ? 'Place an order' : 'Close order form';
  if (!orderForm.hidden) {
    await loadOrderBankDetails();
    orderForm.querySelector('input[name="item"]').focus();
  }
});

async function calculateDeliveryRoute() {
  const pickup = pickupAddressInput.value.trim();
  const delivery = deliveryAddressInput.value.trim();
  if (!pickup || !delivery) {
    showMessage('#order-status', 'Enter both the pickup and delivery addresses before calculating the route.');
    (pickup ? deliveryAddressInput : pickupAddressInput).focus();
    return;
  }
  calculateRouteButton.disabled = true;
  calculateRouteButton.textContent = 'Calculating route…';
  showMessage('#order-status', '');
  deliveryPricePreview.textContent = 'Finding the addresses and calculating the driving route…';
  routeDistance.textContent = 'This may take a few seconds.';
  try {
    const estimate = await api.request('/api/pricing/estimate', {
      method: 'POST',
      body: JSON.stringify({ pickup, delivery }),
    });
    if (pickup !== pickupAddressInput.value.trim() || delivery !== deliveryAddressInput.value.trim()) {
      invalidateCalculatedRoute();
      return;
    }
    calculatedRoute = { pickup, delivery };
    routeQuoteToken = estimate.routeQuoteToken;
    deliveryPricePreview.textContent = formatNgn(estimate.estimatedFeeNgn);
    routeDistance.textContent = `Driving distance: ${estimate.distanceKm} km · ${estimate.pickupLabel} → ${estimate.deliveryLabel}. Pay this estimate; A&M will review the final fee after receiving your request.`;
  } catch (error) {
    calculatedRoute = null;
    deliveryPricePreview.textContent = 'We could not calculate this route.';
    routeDistance.textContent = error.message;
  } finally {
    calculateRouteButton.disabled = false;
    calculateRouteButton.textContent = 'Calculate route and fee';
  }
}

calculateRouteButton.addEventListener('click', calculateDeliveryRoute);
pickupAddressInput.addEventListener('input', invalidateCalculatedRoute);
deliveryAddressInput.addEventListener('input', invalidateCalculatedRoute);

document.querySelector('#register-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  if (values.get('password') !== values.get('confirmPassword')) {
    showMessage('#register-status', 'Those passwords do not match. Please check and try again.');
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
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
    currentUser = result.user;
    form.reset();
    updateNavigationForSession();
    const welcomeNotice = document.querySelector('#account-welcome-notice');
    welcomeNotice.textContent = result.warning
      ? `Your account is ready, but we could not send a welcome email to ${result.user.email}. You can continue using your account.`
      : `Your account is ready. We asked our email service to send a welcome message to ${result.user.email}. If it does not arrive in a few minutes, check your Spam or Junk folder.`;
    welcomeNotice.hidden = false;
    closeAuthScreen();
    await showDashboard();
  } catch (error) {
    showMessage('#register-status', error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await api.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: values.get('email'), password: values.get('password') }),
    });
    currentUser = result.user;
    document.querySelector('#account-welcome-notice').hidden = true;
    updateNavigationForSession();
    await showDashboard();
  } catch (error) {
    showMessage('#login-status', error.message);
  } finally {
    submit.disabled = false;
  }
});

const photoInput = document.querySelector('#order-photo');
photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl);
  selectedPhotoUrl = '';
  selectedPhotoDataUrl = '';
  photoReadPromise = Promise.resolve();
  if (!file) {
    document.querySelector('#photo-preview').hidden = true;
    return;
  }
  if (!supportedPhotoTypes.has(file.type.toLowerCase()) || file.size > 5 * 1024 * 1024) {
    photoInput.value = '';
    document.querySelector('#photo-preview').hidden = true;
    showMessage('#order-status', 'Choose a JPG, PNG, WebP, GIF, BMP, AVIF, HEIC/HEIF, or TIFF image under 5 MB.');
    return;
  }
  showMessage('#order-status', '');
  selectedPhotoUrl = URL.createObjectURL(file);
  document.querySelector('#photo-preview-image').src = selectedPhotoUrl;
  document.querySelector('#photo-file-name').textContent = file.name;
  document.querySelector('#photo-preview').hidden = false;
  showMessage('#order-status', 'Preparing your photo...');
  photoReadPromise = fileAsDataUrl(file).then(dataUrl => {
    if (photoInput.files[0] === file) {
      selectedPhotoDataUrl = dataUrl;
      showMessage('#order-status', '');
    }
  }).catch(() => {
    if (photoInput.files[0] === file) {
      if (selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl);
      selectedPhotoUrl = '';
      selectedPhotoDataUrl = '';
      photoInput.value = '';
      document.querySelector('#photo-preview').hidden = true;
      showMessage('#order-status', 'Your phone could not read that photo. Please select a photo saved on your device and try again.');
    }
  });
});

document.querySelector('#remove-photo').addEventListener('click', () => {
  if (selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl);
  selectedPhotoUrl = '';
  selectedPhotoDataUrl = '';
  photoReadPromise = Promise.resolve();
  photoInput.value = '';
  document.querySelector('#photo-preview').hidden = true;
});

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read the selected photo.'));
    reader.readAsDataURL(file);
  });
}

document.querySelector('#order-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const photo = photoInput.files[0];
  if (!photo || !supportedPhotoTypes.has(photo.type.toLowerCase()) || photo.size > 5 * 1024 * 1024) {
    showMessage('#order-status', 'Add a JPG, PNG, WebP, GIF, BMP, AVIF, HEIC/HEIF, or TIFF item photo under 5 MB before submitting your request.');
    return;
  }
  if (!calculatedRoute
    || calculatedRoute.pickup !== pickupAddressInput.value.trim()
    || calculatedRoute.delivery !== deliveryAddressInput.value.trim()) {
    showMessage('#order-status', 'Calculate the route and estimated fee before submitting your request.');
    calculateRouteButton.focus();
    return;
  }
  if (!orderBankAvailable) {
    showMessage('#order-status', 'Load A&M’s saved bank details before submitting your payment and delivery request.');
    await loadOrderBankDetails();
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await photoReadPromise;
    if (photoInput.files[0] !== photo || !selectedPhotoDataUrl) {
      throw new Error('Your phone could not read the selected photo. Please select it again from a folder saved on your device.');
    }
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
        routeQuoteToken,
        photo: selectedPhotoDataUrl,
      }),
    });
    form.reset();
    calculatedRoute = null;
    routeQuoteToken = '';
    deliveryPricePreview.textContent = 'Enter both addresses, then calculate your route.';
    routeDistance.textContent = 'The website calculates driving distance from your addresses. Address lookup is sent to OpenStreetMap; driving routes use OSRM.';
    document.querySelector('#photo-preview').hidden = true;
    if (selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl);
    selectedPhotoUrl = '';
    selectedPhotoDataUrl = '';
    photoReadPromise = Promise.resolve();
    form.elements.phone.value = currentUser.phone;
    form.elements.pickupEmail.value = currentUser.email;
    showMessage('#order-status', '');
    showMessage(
      '#order-confirmation-message',
      result.warning
          ? `Request ${result.order.reference} and payment reference were saved, but one or more emails could not be sent. A&M can review the payment in the admin orders.`
          : `Request ${result.order.reference} and your payment reference were saved. A&M will review the request; email confirmations are processed separately.`,
    );
    document.querySelector('#order-confirmation').hidden = false;
    closeAuthScreen();
    await renderOrders();
  } catch (error) {
    showMessage('#order-status', error.message);
  } finally {
    submit.disabled = false;
  }
});

async function signOut() {
  try {
    await api.request('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ role: 'customer' }),
    });
    currentUser = null;
    updateNavigationForSession();
    dashboard.hidden = true;
    authView.hidden = false;
    setAuthView('login');
  } catch {
    showMessage('#order-status', 'Could not sign out right now. Please try again.');
  }
}

document.querySelector('#sign-out').addEventListener('click', signOut);

document.addEventListener('click', event => {
  const signOutLink = event.target.closest('a[data-sign-out]');
  if (signOutLink) {
    event.preventDefault();
    signOut();
    closeAuthScreen();
    return;
  }
  const authLink = event.target.closest('a[data-auth-view]');
  if (authLink) {
    event.preventDefault();
    openAuthScreen(authLink.dataset.authView);
  }
});

document.querySelector('#portal-back').addEventListener('click', closeAuthScreen);
updateNavigationForSession();
loadCurrentUser().then(user => {
  if (user) {
    document.body.classList.add('auth-screen-active');
    return showDashboard();
  }
}).catch(() => {
  showMessage('#login-status', 'The account service is unavailable right now. Please try again shortly.');
});
