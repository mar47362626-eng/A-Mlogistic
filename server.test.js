const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodemailer = require('nodemailer');
const { createDatabase } = require('./db');
const {
  brevoApiFailure,
  createApp,
  createDeliveryRouteCalculator,
  seedAdmin,
  sendBrevoEmail,
} = require('./server');

let database;
let server;
let baseUrl;
let emails;
let failDeliveredEmail;
let failInTransitEmail;
let failNewOrderEmail;
let failRiderApplicationEmail;
let failCustomerWelcomeEmail;

async function request(route, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = response.status === 204 ? null : await response.json();
  const setCookie = response.headers.get('set-cookie');
  return { response, result, cookie: setCookie ? setCookie.split(';')[0] : cookie };
}

before(async () => {
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD = 'test-admin-password-123';
  process.env.ALLOWED_ORIGINS = 'https://mar47362626-eng.github.io';
  process.env.BANK_NAME = 'A&M Test Bank';
  process.env.BANK_ACCOUNT_NAME = 'A&M Logistics';
  process.env.BANK_ACCOUNT_NUMBER = '0123456789';
  process.env.DELIVERY_BASE_FEE_NGN = '2500';
  process.env.DELIVERY_RATE_PER_KM_NGN = '1000';
  delete process.env.GOOGLE_MAPS_API_KEY;
  emails = [];
  failDeliveredEmail = false;
  failInTransitEmail = false;
  failNewOrderEmail = false;
  failRiderApplicationEmail = false;
  failCustomerWelcomeEmail = false;
  database = createDatabase(':memory:');
  await seedAdmin(database);
  server = createApp(database, {
    sendEmail: async email => {
      if (failDeliveredEmail && email.to === 'customer@example.com' && /delivered/i.test(email.subject)) {
        throw new Error('Simulated mail outage.');
      }
      if (failInTransitEmail && /on its way/i.test(email.subject) && email.inlineImage) {
        throw new Error('Simulated status-email outage.');
      }
      if (failNewOrderEmail && /delivery request|new delivery request/i.test(email.subject)) {
        throw new Error('Simulated new-order email outage.');
      }
      if (failRiderApplicationEmail && /rider application received/i.test(email.subject)) {
        throw new Error('Simulated rider application email outage.');
      }
      if (failCustomerWelcomeEmail && /welcome to a&m logistics/i.test(email.subject)) {
        throw new Error('Simulated welcome email outage.');
      }
      emails.push(email);
    },
    calculateRoute: async (pickup, delivery) => ({
      distanceKm: 2.4,
      pickupLabel: `${pickup}, Nigeria`,
      deliveryLabel: `${delivery}, Nigeria`,
    }),
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  database.close();
});

test('separate site pages are served and protected APIs enforce roles', async () => {
  const [home, riderPage, riderAppPage, userAppPage, cleanAdminPage, cleanRiderPage, cleanUserAppPage, cleanRiderAppPage, userAppCss, userAppJs, riderAppCss, riderAppJs, adminData, databaseFile, jsonDatabaseFile, pricing] = await Promise.all([
    fetch(`${baseUrl}/index.html`),
    fetch(`${baseUrl}/rider.html`),
    fetch(`${baseUrl}/rider-app.html`),
    fetch(`${baseUrl}/user-app.html`),
    fetch(`${baseUrl}/admin`),
    fetch(`${baseUrl}/rider`),
    fetch(`${baseUrl}/user-app`),
    fetch(`${baseUrl}/rider-app`),
    fetch(`${baseUrl}/user-app.css`),
    fetch(`${baseUrl}/user-app.js`),
    fetch(`${baseUrl}/rider-app.css`),
    fetch(`${baseUrl}/rider-app.js`),
    request('/api/admin/orders'),
    fetch(`${baseUrl}/data/ao-logistics.sqlite`),
    fetch(`${baseUrl}/data/users.json`),
    request('/api/pricing'),
  ]);
  assert.equal(home.status, 200);
  assert.equal(riderPage.status, 200);
  assert.equal(riderAppPage.status, 200);
  assert.equal(userAppPage.status, 200);
  assert.equal(cleanAdminPage.status, 200);
  assert.equal(cleanRiderPage.status, 200);
  assert.equal(cleanUserAppPage.status, 200);
  assert.equal(cleanRiderAppPage.status, 200);
  assert.equal(userAppCss.status, 200);
  assert.equal(userAppJs.status, 200);
  assert.equal(riderAppCss.status, 200);
  assert.equal(riderAppJs.status, 200);
  assert.match(await home.text(), /We deliver/);
  assert.match(await riderPage.text(), /RIDER APPLICATION/);
  assert.match(await riderAppPage.text(), /A&amp;M RIDER APP/);
  assert.match(await userAppPage.text(), /Your delivery hub/);
  assert.match(await cleanUserAppPage.text(), /data-view="home"/);
  assert.match(await cleanRiderAppPage.text(), /A&amp;M RIDER APP/);
  assert.match(await cleanAdminPage.text(), /A&M Logistics/);
  assert.match(await cleanRiderPage.text(), /RIDER APPLICATION/);
  assert.equal(adminData.response.status, 401);
  const signedOutCustomer = await request('/api/auth/me');
  assert.equal(signedOutCustomer.response.status, 200);
  assert.equal(signedOutCustomer.result.user, null);
  const riderSession = await request('/api/rider/me');
  assert.equal(riderSession.response.status, 200);
  assert.equal(riderSession.result.rider, null);
  assert.equal(databaseFile.status, 404);
  assert.equal(jsonDatabaseFile.status, 404);
  assert.equal(pricing.response.status, 200);
  assert.deepEqual(pricing.result, { baseFeeNgn: 2500, ratePerKmNgn: 1000 });
  const anonymousRouteEstimate = await request('/api/pricing/estimate', {
    method: 'POST',
    body: { pickup: 'Ibadan', delivery: 'Lagos' },
  });
  assert.equal(anonymousRouteEstimate.response.status, 401);
});

test('Netlify proxies API requests through its own origin to keep auth cookies first-party', () => {
  const clientSource = fs.readFileSync(path.join(__dirname, 'api-client.js'), 'utf8');
  const netlifyConfig = fs.readFileSync(path.join(__dirname, 'netlify.toml'), 'utf8');
  assert.match(netlifyConfig, /from\s*=\s*"\/api\/\*"/);
  assert.match(netlifyConfig, /to\s*=\s*"https:\/\/a-mlogistic\.onrender\.com\/api\/:splat"/);

  const netlifyWindow = { location: new URL('https://a-mlogistic.netlify.app') };
  vm.runInNewContext(clientSource, { window: netlifyWindow, fetch: () => {} });
  assert.equal(netlifyWindow.api.url('/api/auth/me'), 'https://a-mlogistic.netlify.app/api/auth/me');

  const pagesWindow = { location: new URL('https://mar47362626-eng.github.io') };
  vm.runInNewContext(clientSource, { window: pagesWindow, fetch: () => {} });
  assert.equal(pagesWindow.api.url('/api/auth/me'), 'https://a-mlogistic.onrender.com/api/auth/me');
});

test('OpenStreetMap geocoding and OSRM driving distances are cached and converted to kilometres', async () => {
  const requests = [];
  const calculateRoute = createDeliveryRouteCalculator(async url => {
    requests.push(String(url));
    if (String(url).includes('nominatim.openstreetmap.org')) {
      const query = new URL(url).searchParams.get('q');
      return new Response(JSON.stringify([{
        lat: query.startsWith('Ibadan') ? '7.3775' : '6.5244',
        lon: query.startsWith('Ibadan') ? '3.9470' : '3.3792',
        display_name: query.startsWith('Ibadan') ? 'Ibadan, Nigeria' : 'Lagos, Nigeria',
      }]), { status: 200 });
    }
    return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 2475 }] }), { status: 200 });
  });

  const first = await calculateRoute('Ibadan', 'Lagos');
  const cached = await calculateRoute('Ibadan', 'Lagos');
  assert.deepEqual(first, {
    distanceKm: 2.5,
    pickupLabel: 'Ibadan, Nigeria',
    deliveryLabel: 'Lagos, Nigeria',
  });
  assert.deepEqual(cached, first);
  assert.equal(requests.length, 3);
  assert.match(requests[0], /countrycodes=ng/);
  assert.match(requests[2], /router\.project-osrm\.org\/route\/v1\/driving/);

  await calculateRoute('Ibadan', 'Abeokuta');
  assert.equal(requests.filter(url => url.includes('nominatim.openstreetmap.org')).length, 3);
  assert.equal(requests.filter(url => url.includes('router.project-osrm.org')).length, 2);
});

test('route estimates retry temporary provider failures and log upstream status', async () => {
  const requests = [];
  const calculateRoute = createDeliveryRouteCalculator(async url => {
    requests.push(String(url));
    if (String(url).includes('nominatim.openstreetmap.org')) {
      return new Response(JSON.stringify([{
        lat: '7.3775',
        lon: '3.9470',
        display_name: 'Ibadan, Nigeria',
      }]), { status: 200 });
    }
    if (requests.filter(requestUrl => requestUrl.includes('router.project-osrm.org')).length === 1) {
      return new Response('Service temporarily unavailable', {
        status: 503,
        headers: { 'Retry-After': '0' },
      });
    }
    return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 2475 }] }), { status: 200 });
  });

  const route = await calculateRoute('Ibadan', 'Ibadan');
  assert.equal(route.distanceKm, 2.5);
  assert.equal(requests.filter(requestUrl => requestUrl.includes('router.project-osrm.org')).length, 2);
});

test('favicon requests redirect to the branded SVG icon', async () => {
  const legacyIcon = await fetch(`${baseUrl}/favicon.ico`, { redirect: 'manual' });
  assert.equal(legacyIcon.status, 302);
  assert.equal(legacyIcon.headers.get('location'), '/favicon.svg');

  const icon = await fetch(`${baseUrl}/favicon.svg`);
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await icon.text(), /<svg/);
});

test('clean app URLs normalize trailing slashes and old file URLs redirect', async () => {
  const [admin, rider, userApp, riderApp, oldAdmin, oldRider, oldUserApp, oldRiderApp] = await Promise.all([
    fetch(`${baseUrl}/admin/`, { redirect: 'manual' }),
    fetch(`${baseUrl}/rider/`, { redirect: 'manual' }),
    fetch(`${baseUrl}/user-app/`, { redirect: 'manual' }),
    fetch(`${baseUrl}/rider-app/`, { redirect: 'manual' }),
    fetch(`${baseUrl}/admin.html`, { redirect: 'manual' }),
    fetch(`${baseUrl}/rider.html`, { redirect: 'manual' }),
    fetch(`${baseUrl}/user-app.html`, { redirect: 'manual' }),
    fetch(`${baseUrl}/rider-app.html`, { redirect: 'manual' }),
  ]);
  assert.equal(admin.status, 301);
  assert.equal(admin.headers.get('location'), '/admin');
  assert.equal(rider.status, 301);
  assert.equal(rider.headers.get('location'), '/rider');
  assert.equal(userApp.status, 301);
  assert.equal(userApp.headers.get('location'), '/user-app');
  assert.equal(riderApp.status, 301);
  assert.equal(riderApp.headers.get('location'), '/rider-app');
  assert.equal(oldAdmin.status, 301);
  assert.equal(oldAdmin.headers.get('location'), '/admin');
  assert.equal(oldRider.status, 301);
  assert.equal(oldRider.headers.get('location'), '/rider');
  assert.equal(oldUserApp.status, 301);
  assert.equal(oldUserApp.headers.get('location'), '/user-app');
  assert.equal(oldRiderApp.status, 301);
  assert.equal(oldRiderApp.headers.get('location'), '/rider-app');
});

test('deployed frontend origins are allowed for credentialed API calls and untrusted origins are rejected', async () => {
  for (const allowedOrigin of [
    'https://mar47362626-eng.github.io',
    'https://a-mlogistic.netlify.app',
  ]) {
    const preflight = await fetch(`${baseUrl}/api/auth/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: allowedOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), allowedOrigin);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  }

  const sameOrigin = await fetch(`${baseUrl}/api/auth/me`, {
    method: 'OPTIONS',
    headers: { Origin: baseUrl },
  });
  assert.equal(sameOrigin.status, 204);
  assert.equal(sameOrigin.headers.get('access-control-allow-origin'), baseUrl);

  const blocked = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Origin: 'https://untrusted.example' },
  });
  assert.equal(blocked.status, 403);
});

test('admin accounts can be created through the registration endpoint', async () => {
  const unauthenticatedRegistration = await request('/api/auth/admin/register', {
    method: 'POST',
    body: {
      name: 'Unauthorized Admin',
      email: 'unauthorized-admin@example.com',
      password: 'new-admin-password-123',
    },
  });

  test('Brevo authorization errors explain whether the API key or server IP needs attention', () => {
    assert.match(brevoApiFailure(401, 'Key not found'), /transactional API key/i);
    assert.match(brevoApiFailure(403, 'IP address not authorized'), /Render outbound IP/i);
    assert.match(brevoApiFailure(500), /could not send the email/i);
  });

  test('order email uses the Brevo API with the package photo attached without SMTP credentials', async () => {
    const environmentNames = ['BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'BREVO_SENDER_NAME', 'BREVO_SMTP_LOGIN', 'BREVO_SMTP_KEY', 'BREVO_SMTP_PORT'];
    const previousEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]));
    const originalFetch = global.fetch;
    let apiRequest;
    process.env.BREVO_API_KEY = 'test-transactional-key';
    process.env.BREVO_SENDER_EMAIL = 'sender@example.com';
    process.env.BREVO_SENDER_NAME = 'A&M Logistics';
    for (const name of environmentNames.slice(3)) delete process.env[name];
    global.fetch = async (url, options) => {
      apiRequest = { url, options, body: JSON.parse(options.body) };
      return new Response('{}', { status: 201 });
    };

    try {
      await sendBrevoEmail({
        to: 'customer@example.com',
        subject: 'Delivery request received',
        text: 'Your delivery is in.',
        html: '<p>Your delivery is in.</p><img src="cid:package-photo" alt="Package photo" width="500">',
        inlineImage: {
          name: 'package-AO-TEST-01.jpg',
          content: 'dGVzdC1pbWFnZQ==',
          contentType: 'image/jpeg',
          cid: 'package-photo',
        },
      });

      assert.equal(apiRequest.url, 'https://api.brevo.com/v3/smtp/email');
      assert.equal(apiRequest.options.headers['api-key'], 'test-transactional-key');
      assert.deepEqual(apiRequest.body.attachment, [{
        name: 'package-AO-TEST-01.jpg',
        content: 'dGVzdC1pbWFnZQ==',
      }]);
      assert.doesNotMatch(apiRequest.body.htmlContent, /cid:package-photo/);
      assert.match(apiRequest.body.htmlContent, /photo is attached to this email/i);
      assert.match(apiRequest.body.textContent, /photo is attached to this email/i);
    } finally {
      global.fetch = originalFetch;
      for (const name of environmentNames) {
        if (previousEnvironment[name] === undefined) delete process.env[name];
        else process.env[name] = previousEnvironment[name];
      }
    }
  });

  test('order email embeds the package photo inline when SMTP is configured', async () => {
    const environmentNames = ['BREVO_SENDER_EMAIL', 'BREVO_SENDER_NAME', 'BREVO_SMTP_LOGIN', 'BREVO_SMTP_KEY', 'BREVO_SMTP_PORT'];
    const previousEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]));
    const originalCreateTransport = nodemailer.createTransport;
    let transportOptions;
    let sentMessage;
    process.env.BREVO_SENDER_EMAIL = 'sender@example.com';
    process.env.BREVO_SENDER_NAME = 'A&M Logistics';
    process.env.BREVO_SMTP_LOGIN = 'test-smtp-login';
    process.env.BREVO_SMTP_KEY = 'test-smtp-key';
    process.env.BREVO_SMTP_PORT = '2525';
    nodemailer.createTransport = options => {
      transportOptions = options;
      return {
        sendMail: async message => {
          sentMessage = message;
        },
      };
    };

    try {
      await sendBrevoEmail({
        to: 'customer@example.com',
        subject: 'Delivery request received',
        text: 'Your delivery is in.',
        html: '<p>Your delivery is in.</p><img src="cid:package-photo" alt="Package photo" width="500">',
        inlineImage: {
          name: 'package-AO-TEST-01.jpg',
          content: 'dGVzdC1pbWFnZQ==',
          contentType: 'image/jpeg',
          cid: 'package-photo',
        },
      });

      assert.equal(transportOptions.host, 'smtp-relay.brevo.com');
      assert.equal(transportOptions.port, 2525);
      assert.equal(transportOptions.auth.user, 'test-smtp-login');
      assert.equal(sentMessage.from.address, 'sender@example.com');
      assert.match(sentMessage.html, /src="cid:package-photo"/);
      assert.equal(sentMessage.attachments[0].cid, 'package-photo');
      assert.equal(sentMessage.attachments[0].contentType, 'image/jpeg');
      assert.deepEqual(sentMessage.attachments[0].content, Buffer.from('test-image'));
    } finally {
      nodemailer.createTransport = originalCreateTransport;
      for (const name of environmentNames) {
        if (previousEnvironment[name] === undefined) delete process.env[name];
        else process.env[name] = previousEnvironment[name];
      }
    }
  });

  test('customer account creation succeeds if the welcome email service is unavailable', async () => {
    failCustomerWelcomeEmail = true;
    const registration = await request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Email Outage Customer',
        phone: '555-0144',
        email: 'email-outage-customer@example.com',
        password: 'email-outage-password-123',
      },
    });
    failCustomerWelcomeEmail = false;
    assert.equal(registration.response.status, 201);
    assert.match(registration.cookie, /^ao_customer_session=/);
    assert.equal(registration.result.user.email, 'email-outage-customer@example.com');
    assert.match(registration.result.warning, /account was created/i);
    const profile = await request('/api/auth/me', { cookie: registration.cookie });
    assert.equal(profile.response.status, 200);
    assert.equal(profile.result.user.email, 'email-outage-customer@example.com');
  });
  assert.equal(unauthenticatedRegistration.response.status, 401);

  const existingAdminLogin = await request('/api/auth/admin/login', {
    method: 'POST',
    body: { email: 'admin@example.com', password: 'test-admin-password-123' },
  });
  assert.equal(existingAdminLogin.response.status, 200);

  const registeredAdmin = await request('/api/auth/admin/register', {
    method: 'POST',
    cookie: existingAdminLogin.cookie,
    body: {
      name: 'Admin Two',
      email: 'admin2@example.com',
      phone: '555-0199',
      password: 'new-admin-password-123',
    },
  });
  assert.equal(registeredAdmin.response.status, 201);
  assert.match(registeredAdmin.cookie, /^ao_admin_session=/);

  const login = await request('/api/auth/admin/login', {
    method: 'POST',
    body: { email: 'admin2@example.com', password: 'new-admin-password-123' },
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.result.user.email, 'admin2@example.com');
});

test('an unauthenticated caller cannot bootstrap the first admin', async () => {
  const bootstrapDatabase = createDatabase(':memory:');
  const bootstrapServer = createApp(bootstrapDatabase, { sendEmail: async () => {} }).listen(0, '127.0.0.1');
  await new Promise(resolve => bootstrapServer.once('listening', resolve));
  const bootstrapUrl = `http://127.0.0.1:${bootstrapServer.address().port}`;

  try {
    const response = await fetch(`${bootstrapUrl}/api/auth/admin/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'First Admin',
        email: 'first-admin@example.com',
        password: 'first-admin-password-123',
      }),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await bootstrapDatabase.list('users', user => user.role === 'admin'), []);
  } finally {
    await new Promise((resolve, reject) => bootstrapServer.close(error => error ? reject(error) : resolve()));
    bootstrapDatabase.close();
  }
});

test('production requires a provisioned admin before the server can start', async () => {
  const originalEnvironment = {
    nodeEnv: process.env.NODE_ENV,
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD,
  };
  const emptyDatabase = createDatabase(':memory:');
  process.env.NODE_ENV = 'production';
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;

  try {
    await assert.rejects(seedAdmin(emptyDatabase), /Production requires a provisioned admin/);
    assert.deepEqual(await emptyDatabase.list('users', user => user.role === 'admin'), []);
    await emptyDatabase.insert('users', {
      id: 'existing-admin',
      email: 'existing-admin@example.com',
      name: 'Existing Admin',
      phone: '',
      password_salt: 'salt',
      password_hash: 'hash',
      role: 'admin',
      registered_at: Date.now(),
    });
    await seedAdmin(emptyDatabase);
    assert.equal((await emptyDatabase.find('users', user => user.role === 'admin')).email, 'existing-admin@example.com');
  } finally {
    if (originalEnvironment.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment.nodeEnv;
    if (originalEnvironment.adminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = originalEnvironment.adminEmail;
    if (originalEnvironment.adminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = originalEnvironment.adminPassword;
    emptyDatabase.close();
  }
});

test('customer and rider workflows share orders, assignment, and notifications', async () => {
  const registeredRider = await request('/api/rider/applications', {
    method: 'POST',
    body: {
      name: 'Riley Rider',
      phone: '555-0100',
      email: 'rider@example.com',
      vehicle: 'Bicycle',
      license: 'RIDER-001',
      area: 'Central',
      password: 'rider-password-123',
    },
  });
  assert.equal(registeredRider.response.status, 201);
  assert.ok(emails.some(email => email.to === 'rider@example.com' && /application received/i.test(email.subject)));
  assert.ok(emails.some(email => email.to === 'admin@example.com' && /new rider registration/i.test(email.subject)));
  assert.equal(registeredRider.result.rider.status, 'Pending review');
  assert.equal('password_hash' in registeredRider.result.rider, false);

  failRiderApplicationEmail = true;
  const savedRiderApplication = await request('/api/rider/applications', {
    method: 'POST',
    body: {
      name: 'Jordan Rider',
      phone: '555-0101',
      email: 'jordan.rider@example.com',
      vehicle: 'Bicycle',
      license: 'RIDER-002',
      area: 'Central',
      password: 'jordan-rider-password-123',
    },
  });
  failRiderApplicationEmail = false;
  assert.equal(savedRiderApplication.response.status, 201);
  assert.equal(savedRiderApplication.result.rider.status, 'Pending review');
  assert.match(savedRiderApplication.result.warning, /application was saved/i);
  const riderLoginAfterEmailFailure = await request('/api/rider/login', {
    method: 'POST',
    body: { email: 'jordan.rider@example.com', password: 'jordan-rider-password-123' },
  });
  assert.equal(riderLoginAfterEmailFailure.response.status, 200);

  const adminLogin = await request('/api/auth/admin/login', {
    method: 'POST',
    body: { email: 'admin@example.com', password: 'test-admin-password-123' },
  });
  assert.equal(adminLogin.response.status, 200);
  const adminCookie = adminLogin.cookie;
  assert.equal((await request('/api/admin/payment-settings', { cookie: adminCookie })).response.status, 200);
  const savedBankDetails = await request('/api/admin/payment-settings', {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      bankName: 'A&M Admin Bank',
      accountName: 'A&M Logistics',
      accountNumber: '0123456789',
    },
  });
  assert.equal(savedBankDetails.response.status, 200);
  assert.equal(savedBankDetails.result.settings.bankName, 'A&M Admin Bank');
  await seedAdmin(database);
  const bankDetailsAfterAdminSeed = await request('/api/admin/payment-settings', { cookie: adminCookie });
  assert.equal(bankDetailsAfterAdminSeed.result.settings.accountNumber, '0123456789');
  const invalidBankDetails = await request('/api/admin/payment-settings', {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      bankName: 'A&M Admin Bank',
      accountName: 'A&M Logistics',
      accountNumber: '123',
    },
  });
  assert.equal(invalidBankDetails.response.status, 400);
  const adminOnCustomerPage = await request('/api/auth/me', { cookie: adminCookie });
  assert.equal(adminOnCustomerPage.response.status, 200);
  assert.equal(adminOnCustomerPage.result.user, null);
  const adminOnRiderPage = await request('/api/rider/me', { cookie: adminCookie });
  assert.equal(adminOnRiderPage.response.status, 200);
  assert.equal(adminOnRiderPage.result.rider, null);
  const riderRegistrations = await request('/api/admin/registrations', { cookie: adminCookie });
  assert.equal(riderRegistrations.response.status, 200);
  assert.equal(riderRegistrations.result.registrations[0].type, 'Rider');
  assert.ok(riderRegistrations.result.registrations.some(registration => registration.license === 'RIDER-001'));
  const riderAdminList = await request('/api/admin/riders', { cookie: adminCookie });
  assert.ok(riderAdminList.result.riders.some(rider => rider.license === 'RIDER-001'));

  const review = await request(`/api/admin/riders/${registeredRider.result.rider.id}/status`, {
    method: 'PATCH',
    body: { status: 'Approved' },
    cookie: adminCookie,
  });
  assert.equal(review.response.status, 200);
  assert.equal(emails.at(-1).to, 'rider@example.com');
  assert.match(emails.at(-1).subject, /approved/i);

  const customer = await request('/api/auth/register', {
    method: 'POST',
    body: { name: 'Casey Customer', phone: '555-0110', email: 'customer@example.com', password: 'customer-password-123' },
  });
  assert.equal(customer.response.status, 201);
  assert.equal(emails.at(-1).to, 'customer@example.com');
  assert.match(emails.at(-1).subject, /welcome/i);
  assert.match(emails.at(-1).html, /<table role="presentation"/);
  assert.match(emails.at(-1).html, /background:#263b32/);
  assert.match(emails.at(-1).text, /A&M LOGISTICS[\s\S]*Welcome to A&M Logistics/);
  const customerPaymentAccount = await request('/api/customer/payment-account', { cookie: customer.cookie });
  assert.equal(customerPaymentAccount.response.status, 200);
  assert.deepEqual(customerPaymentAccount.result.bank, {
    bankName: 'A&M Admin Bank',
    accountName: 'A&M Logistics',
    accountNumber: '0123456789',
  });
  const signedOutCustomer = await request('/api/auth/logout', {
    method: 'POST',
    cookie: customer.cookie,
    body: { role: 'customer' },
  });
  assert.equal(signedOutCustomer.response.status, 204);
  const wrongCustomerPassword = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'CUSTOMER@example.com', password: 'incorrect-password' },
  });
  assert.equal(wrongCustomerPassword.response.status, 401);
  const returningCustomer = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'CUSTOMER@example.com', password: 'customer-password-123' },
  });
  assert.equal(returningCustomer.response.status, 200);
  assert.match(returningCustomer.cookie, /^ao_customer_session=/);
  customer.cookie = returningCustomer.cookie;
  const customerCannotChangeBankDetails = await request('/api/admin/payment-settings', {
    method: 'PUT',
    cookie: customer.cookie,
    body: {
      bankName: 'Wrong Bank',
      accountName: 'Wrong Account',
      accountNumber: '0123456789',
    },
  });
  assert.equal(customerCannotChangeBankDetails.response.status, 403);
  const customerProfile = await request('/api/auth/me', { cookie: customer.cookie });
  assert.equal(customerProfile.response.status, 200);
  assert.equal(customerProfile.result.user.email, 'customer@example.com');
  const forbidden = await request('/api/admin/orders', { cookie: customer.cookie });
  assert.equal(forbidden.response.status, 403);
  const routeEstimate = await request('/api/pricing/estimate', {
    method: 'POST',
    cookie: customer.cookie,
    body: { pickup: 'Ibadan', delivery: 'Lagos' },
  });
  assert.equal(routeEstimate.response.status, 200);
  assert.equal(routeEstimate.result.distanceKm, 2.4);
  assert.equal(routeEstimate.result.estimatedFeeNgn, 5500);
  const customerRegistration = await request('/api/admin/registrations', { cookie: adminCookie });
  assert.deepEqual(
    customerRegistration.result.registrations.map(registration => registration.type).sort(),
    ['Customer', 'Customer', 'Rider', 'Rider'],
  );

  const estimateWithoutAddress = await request('/api/pricing/estimate', {
    method: 'POST',
    cookie: customer.cookie,
    body: { pickup: 'One Street' },
  });
  assert.equal(estimateWithoutAddress.response.status, 400);
  assert.match(estimateWithoutAddress.result.error, /delivery/i);

  const orderWithoutPaidConfirmation = await request('/api/customer/orders', {
    method: 'POST',
    cookie: customer.cookie,
    body: { paidConfirmation: false },
  });
  assert.equal(orderWithoutPaidConfirmation.response.status, 400);
  assert.match(orderWithoutPaidConfirmation.result.error, /confirm that you have completed/i);

  const order = await request('/api/customer/orders', {
    method: 'POST',
    cookie: customer.cookie,
    body: {
      item: 'Small box',
      quantity: 2,
      description: 'Fragile',
      pickup: 'One Street',
      delivery: 'Two Street',
      pickupEmail: 'pickup@example.com',
      deliveryEmail: 'delivery@example.com',
      date: '2026-10-20',
      phone: '555-0110',
      notes: '',
      transferReference: 'BANK-TXN-2026-0042',
      paidConfirmation: true,
      deliveryPriceNgn: 1,
      deliveryDistanceKm: 1,
      photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    },
  });
  assert.equal(order.response.status, 201);
  assert.equal(order.result.order.status, 'Received');
  assert.equal(order.result.order.deliveryDistanceKm, 2.4);
  assert.equal(order.result.order.deliveryPriceNgn, 5500);
  assert.equal(order.result.order.deliveryPriceConfirmed, false);
  assert.equal(order.result.order.paymentStatus, 'proof_submitted');
  assert.equal(order.result.order.transferReference, 'BANK-TXN-2026-0042');
  assert.equal(order.result.order.paymentSubmittedAmountNgn, 5500);
  assert.equal(order.result.order.riderEarningsNgn, null);
  assert.ok(emails.slice(-3).every(email => /Estimated delivery fee: NGN 5,500/.test(email.text)));
  assert.deepEqual(
    emails.slice(-3).map(email => email.to).sort(),
    ['admin2@example.com', 'admin@example.com', 'customer@example.com'],
  );
  for (const orderEmail of emails.slice(-3)) {
    assert.equal(orderEmail.inlineImage.name, `package-${order.result.order.reference}.png`);
    assert.match(orderEmail.html, /<img[^>]+src="cid:package-photo"/);
  }
  assert.equal(order.result.order.pickupEmail, 'pickup@example.com');
  assert.equal(order.result.order.deliveryEmail, 'delivery@example.com');

  const confirmationWithoutFee = await request(`/api/admin/orders/${order.result.order.id}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { status: 'Confirmed', riderId: registeredRider.result.rider.id },
  });
  assert.equal(confirmationWithoutFee.response.status, 400);
  assert.match(confirmationWithoutFee.result.error, /save the final delivery fee/i);
  const quoteSaved = await request(`/api/admin/orders/${order.result.order.id}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: {
      status: 'Received',
      riderId: '',
      deliveryPriceNgn: 5500,
      deliveryDistanceKm: 2.4,
    },
  });
  assert.equal(quoteSaved.response.status, 200);
  assert.equal(quoteSaved.result.order.deliveryPriceNgn, 5500);
  assert.equal(quoteSaved.result.order.deliveryDistanceKm, 2.4);
  assert.equal(quoteSaved.result.order.deliveryPriceConfirmed, true);
  const missingPaidConfirmation = await request(
    `/api/customer/orders/${order.result.order.id}/payment-reference`,
    {
      method: 'POST',
      cookie: customer.cookie,
      body: { transferReference: 'BANK-TXN-2026-0042' },
    },
  );
  assert.equal(missingPaidConfirmation.response.status, 400);
  assert.match(missingPaidConfirmation.result.error, /confirm that you have completed/i);
  const preConfirmationInstructions = await request(
    `/api/customer/orders/${order.result.order.id}/payment-instructions`,
    { cookie: customer.cookie },
  );
  assert.equal(preConfirmationInstructions.response.status, 200);
  assert.equal(preConfirmationInstructions.result.amountNgn, 5500);
  assert.equal(preConfirmationInstructions.result.bank.accountNumber, '0123456789');
  const paymentVerified = await request(`/api/admin/orders/${order.result.order.id}/payment`, {
    method: 'PATCH',
    cookie: adminCookie,
  });
  assert.equal(paymentVerified.response.status, 200);
  assert.equal(paymentVerified.result.order.status, 'Received');
  assert.equal(paymentVerified.result.order.paymentStatus, 'paid');
  const assignment = await request(`/api/admin/orders/${order.result.order.id}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { status: 'Confirmed', riderId: registeredRider.result.rider.id },
  });
  assert.equal(assignment.response.status, 200);
  assert.equal(assignment.result.order.riderName, 'Riley Rider');
  assert.equal(assignment.result.order.deliveryPriceNgn, 5500);
  assert.equal(assignment.result.order.deliveryDistanceKm, 2.4);
  const feeChangeAfterConfirmation = await request(`/api/admin/orders/${order.result.order.id}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: {
      status: 'Confirmed',
      riderId: registeredRider.result.rider.id,
      deliveryPriceNgn: 6000,
      deliveryDistanceKm: 3,
    },
  });
  assert.equal(feeChangeAfterConfirmation.response.status, 409);
  assert.ok(emails.some(email => email.to === 'customer@example.com' && /confirmed/i.test(email.subject)));
  assert.ok(emails.some(email => email.to === 'customer@example.com' && /5,?500/.test(email.text)));
  const confirmationEmail = emails.find(email => email.to === 'customer@example.com' && /delivery is confirmed/i.test(email.subject));
  assert.match(confirmationEmail.text, /already been verified/i);
  assert.doesNotMatch(confirmationEmail.text, /submit your bank transaction reference/i);
  assert.equal(emails.at(-1).to, 'rider@example.com');
  assert.match(emails.at(-1).subject, /assigned/i);
  assert.equal(emails.at(-1).inlineImage.name, `package-${order.result.order.reference}.png`);
  assert.match(emails.at(-1).html, /<img[^>]+src="cid:package-photo"/);

  const riderLogin = await request('/api/rider/login', {
    method: 'POST',
    body: { email: 'rider@example.com', password: 'rider-password-123' },
  });
  assert.equal(riderLogin.response.status, 200);
  assert.match(riderLogin.cookie, /^ao_rider_session=/);
  assert.match(customer.cookie, /^ao_customer_session=/);
  assert.match(adminCookie, /^ao_admin_session=/);
  const combinedCookies = `${customer.cookie}; ${adminCookie}; ${riderLogin.cookie}`;
  const riderSession = await request('/api/rider/me', { cookie: riderLogin.cookie });
  assert.equal(riderSession.response.status, 200);
  assert.equal(riderSession.result.rider.email, 'rider@example.com');
  assert.equal((await request('/api/auth/me', { cookie: combinedCookies })).response.status, 200);
  assert.equal((await request('/api/auth/admin/me', { cookie: combinedCookies })).response.status, 200);
  const deliveries = await request('/api/rider/deliveries', { cookie: riderLogin.cookie });
  assert.equal(deliveries.response.status, 200);
  assert.equal(deliveries.result.orders[0].id, order.result.order.id);
  assert.equal('transferReference' in deliveries.result.orders[0], false);
  const paymentInstructions = await request(
    `/api/customer/orders/${order.result.order.id}/payment-instructions`,
    { cookie: customer.cookie },
  );
  assert.equal(paymentInstructions.response.status, 200);
  assert.equal(paymentInstructions.result.amountNgn, 5500);
  assert.equal(paymentInstructions.result.paymentReference, order.result.order.reference);
  assert.equal(paymentInstructions.result.bank.bankName, 'A&M Admin Bank');
  assert.equal(paymentInstructions.result.bank.accountName, 'A&M Logistics');
  assert.equal(paymentInstructions.result.bank.accountNumber, '0123456789');
  const riderCannotViewInstructions = await request(
    `/api/customer/orders/${order.result.order.id}/payment-instructions`,
    { cookie: riderLogin.cookie },
  );
  assert.equal(riderCannotViewInstructions.response.status, 403);
  assert.ok(emails.some(email => email.to === 'admin@example.com' && /new delivery request/i.test(email.subject)
    && /BANK-TXN-2026-0042/.test(email.text)));
  const adminOrdersWithPaymentReference = await request('/api/admin/orders', { cookie: adminCookie });
  assert.equal(
    adminOrdersWithPaymentReference.result.orders.find(candidate => candidate.id === order.result.order.id).transferReference,
    'BANK-TXN-2026-0042',
  );
  assert.ok(emails.some(email => email.to === 'customer@example.com' && /payment confirmed/i.test(email.subject)));
  const riderOrdersAfterPayment = await request('/api/rider/deliveries', { cookie: riderLogin.cookie });
  const riderPaidOrder = riderOrdersAfterPayment.result.orders.find(candidate => candidate.id === order.result.order.id);
  assert.equal(riderPaidOrder.paymentStatus, 'paid');
  assert.equal(riderPaidOrder.deliveryPriceNgn, 5500);
  assert.equal(riderPaidOrder.paymentSubmittedAmountNgn, 5500);
  const riderPhoto = await fetch(`${baseUrl}/api/orders/${order.result.order.id}/photo`, {
    headers: { Cookie: riderLogin.cookie },
  });
  assert.equal(riderPhoto.status, 200);
  assert.equal(riderPhoto.headers.get('content-type'), 'image/png');
  assert.deepEqual(
    Buffer.from(await riderPhoto.arrayBuffer()).subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const pickupCodeSent = await request(`/api/rider/orders/${order.result.order.id}/handoff-code`, {
    method: 'POST',
    cookie: riderLogin.cookie,
    body: { phase: 'pickup' },
  });
  assert.equal(pickupCodeSent.response.status, 200);
  assert.equal(emails.at(-1).to, 'pickup@example.com');
  assert.equal(emails.at(-1).inlineImage.name, `package-${order.result.order.reference}.png`);
  assert.match(emails.at(-1).html, /<img[^>]+src="cid:package-photo"/);
  const pickupCode = emails.at(-1).text.match(/is (\d{6})/)[1];
  assert.match(emails.at(-1).html, new RegExp(`<strong[^>]*>${pickupCode}</strong>`));
  assert.equal(
    (await request(`/api/admin/orders/${order.result.order.id}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { status: 'Delivered', riderId: registeredRider.result.rider.id },
    })).response.status,
    409,
  );
  const wrongPickupCode = await request(`/api/rider/orders/${order.result.order.id}/verify-code`, {
    method: 'POST',
    cookie: riderLogin.cookie,
    body: { phase: 'pickup', code: String((Number(pickupCode) + 1) % 1_000_000).padStart(6, '0') },
  });
  assert.equal(wrongPickupCode.response.status, 400);
  assert.match(wrongPickupCode.result.error, /incorrect/i);
  const pickupVerified = await request(`/api/rider/orders/${order.result.order.id}/verify-code`, {
    method: 'POST',
    cookie: riderLogin.cookie,
    body: { phase: 'pickup', code: pickupCode },
  });
  assert.equal(pickupVerified.response.status, 200);
  assert.equal(pickupVerified.result.order.status, 'Collected');
  const collectedNotice = emails.find(email => email.to === 'customer@example.com' && /collected/i.test(email.subject));
  assert.ok(collectedNotice);
  assert.equal(collectedNotice.inlineImage.name, `package-${order.result.order.reference}.png`);
  assert.equal(collectedNotice.inlineImage.contentType, 'image/png');
  assert.equal(collectedNotice.inlineImage.cid, 'package-photo');
  assert.deepEqual(
    Buffer.from(collectedNotice.inlineImage.content, 'base64').subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  assert.match(collectedNotice.text, /package photo is shown below/i);
  assert.match(collectedNotice.html, /<img[^>]+src="cid:package-photo"/);
  assert.match(collectedNotice.html, /alt="Package photo"/);
  const recipientPickupNotice = emails.find(email => email.to === 'delivery@example.com' && /on its way/i.test(email.subject));
  assert.ok(recipientPickupNotice);
  assert.match(recipientPickupNotice.text, /picked up a package addressed to you/i);
  assert.match(recipientPickupNotice.html, /alt="Package photo"/);
  assert.deepEqual(recipientPickupNotice.inlineImage, collectedNotice.inlineImage);
  failInTransitEmail = true;
  const deliveryCodeSent = await request(`/api/rider/orders/${order.result.order.id}/handoff-code`, {
    method: 'POST',
    cookie: riderLogin.cookie,
    body: { phase: 'delivery' },
  });
  failInTransitEmail = false;
  assert.equal(deliveryCodeSent.response.status, 200);
  assert.match(deliveryCodeSent.result.warning, /code was sent and saved/i);
  const deliveryCodeEmail = emails.findLast(email => email.to === 'delivery@example.com' && /delivery code/i.test(email.subject));
  assert.ok(deliveryCodeEmail);
  const deliveryCode = deliveryCodeEmail.text.match(/is (\d{6})/)[1];
  assert.ok(!emails.some(email => email.to === 'customer@example.com' && /on its way/i.test(email.subject)));
  failDeliveredEmail = true;
  const deliveryVerified = await request(`/api/rider/orders/${order.result.order.id}/verify-code`, {
    method: 'POST',
    cookie: riderLogin.cookie,
    body: { phase: 'delivery', code: deliveryCode },
  });
  failDeliveredEmail = false;
  assert.equal(deliveryVerified.response.status, 200);
  assert.equal(deliveryVerified.result.order.status, 'Delivered');
  assert.equal(deliveryVerified.result.order.pickupVerified, true);
  assert.equal(deliveryVerified.result.order.deliveryVerified, true);
  assert.equal(deliveryVerified.result.order.riderEarningsNgn, 275);
  assert.equal(deliveryVerified.result.order.riderEarningsNgn, Math.round(riderPaidOrder.paymentSubmittedAmountNgn * 0.05));
  assert.match(deliveryVerified.result.warning, /status email could not be sent/i);
  const repeatedDeliveryVerification = await request(`/api/rider/orders/${order.result.order.id}/verify-code`, {
    method: 'POST',
    cookie: riderLogin.cookie,
    body: { phase: 'delivery', code: deliveryCode },
  });
  assert.equal(repeatedDeliveryVerification.response.status, 409);
  assert.match(repeatedDeliveryVerification.result.error, /not available/i);
  assert.ok(!emails.some(email => email.to === 'customer@example.com' && /delivered/i.test(email.subject)));
  assert.ok(emails.some(email => email.to === 'rider@example.com' && /delivery completed/i.test(email.subject)
    && /NGN 275/.test(email.text)));
  assert.ok(emails.some(email => email.to === 'admin@example.com' && /delivery completed/i.test(email.subject)
    && /Riley Rider/.test(email.text)
    && /NGN 275/.test(email.text)));

  const deliveredOrder = database.find('orders', record => record.id === order.result.order.id);
  const currentUtcMonday = new Date();
  currentUtcMonday.setUTCHours(0, 0, 0, 0);
  currentUtcMonday.setUTCDate(currentUtcMonday.getUTCDate() - ((currentUtcMonday.getUTCDay() + 6) % 7));
  const previousWeekStart = new Date(currentUtcMonday.getTime() - 7 * 24 * 60 * 60 * 1000);
  const previousWeekLabel = previousWeekStart.toISOString().slice(0, 10);
  await database.update('orders', record => record.id === deliveredOrder.id, record => ({
    ...record,
    delivered_at: previousWeekStart.getTime() + 2 * 24 * 60 * 60 * 1000,
  }));
  const payoutRequest = await request('/api/rider/payouts', {
    method: 'POST',
    cookie: riderLogin.cookie,
    body: { weekStart: previousWeekLabel },
  });
  assert.equal(payoutRequest.response.status, 201);
  assert.equal(payoutRequest.result.payout.amount_ngn, 275);
  assert.deepEqual(payoutRequest.result.payout.order_ids, [deliveredOrder.id]);
  assert.ok(emails.some(email => email.to === 'rider@example.com' && /payout request was received/i.test(email.subject)));
  assert.ok(emails.some(email => email.to === 'admin@example.com' && /weekly payout requested/i.test(email.subject)
    && /275/.test(email.text)));
  const duplicatePayoutRequest = await request('/api/rider/payouts', {
    method: 'POST',
    cookie: riderLogin.cookie,
    body: { weekStart: previousWeekLabel },
  });
  assert.equal(duplicatePayoutRequest.response.status, 409);
  const riderPayouts = await request('/api/rider/payouts', { cookie: riderLogin.cookie });
  assert.equal(riderPayouts.result.payouts[0].status, 'Pending');
  const adminPayouts = await request('/api/admin/payouts', { cookie: adminCookie });
  assert.equal(adminPayouts.response.status, 200);
  assert.equal(adminPayouts.result.payouts[0].orders[0].reference, order.result.order.reference);
  assert.equal(adminPayouts.result.payouts[0].riderName, 'Riley Rider');
  const payoutPaid = await request(`/api/admin/payouts/${payoutRequest.result.payout.id}/status`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { status: 'Paid' },
  });
  assert.equal(payoutPaid.response.status, 200);
  assert.equal(payoutPaid.result.payout.status, 'Paid');
  assert.ok(emails.some(email => email.to === 'rider@example.com' && /payout paid/i.test(email.subject)));

  const sent = await request('/api/admin/notifications', {
    method: 'POST',
    cookie: adminCookie,
    body: { subject: 'Route update', message: 'Please check the route.', audience: 'everyone' },
  });
  assert.equal(sent.response.status, 201);
  const customerEmailNotification = emails.find(email => email.to === 'customer@example.com' && email.subject === 'Route update');
  const riderEmailNotification = emails.find(email => email.to === 'rider@example.com' && email.subject === 'Route update');
  assert.ok(customerEmailNotification);
  assert.ok(riderEmailNotification);
  assert.match(customerEmailNotification.text, /Please check the route\./);
  assert.match(customerEmailNotification.html, /Please check the route\./);
  const customerMessages = await request('/api/customer/notifications', { cookie: customer.cookie });
  const riderMessages = await request('/api/rider/notifications', { cookie: riderLogin.cookie });
  assert.equal(customerMessages.result.notifications[0].subject, 'Route update');
  assert.equal(riderMessages.result.notifications[0].subject, 'Route update');

  const customerOnlyEmailStart = emails.length;
  const customerOnlyNotification = await request('/api/admin/notifications', {
    method: 'POST',
    cookie: adminCookie,
    body: { subject: 'Customer-only update', message: 'For customers only.', audience: 'customers' },
  });
  assert.equal(customerOnlyNotification.response.status, 201);
  assert.equal(customerOnlyNotification.result.notification.recipientCount, 2);
  assert.deepEqual(
    emails.slice(customerOnlyEmailStart).map(email => email.to).sort(),
    ['customer@example.com', 'email-outage-customer@example.com'],
  );
  const customerOnlySaved = database.find('notifications', notification => notification.id === customerOnlyNotification.result.notification.id);
  assert.deepEqual(customerOnlySaved.recipients.sort(), ['customer@example.com', 'email-outage-customer@example.com']);
  const customerNotificationsAfterTargetedSend = await request('/api/customer/notifications', { cookie: customer.cookie });
  const riderNotificationsAfterCustomerSend = await request('/api/rider/notifications', { cookie: riderLogin.cookie });
  assert.ok(customerNotificationsAfterTargetedSend.result.notifications.some(notification => notification.subject === 'Customer-only update'));
  assert.ok(!riderNotificationsAfterCustomerSend.result.notifications.some(notification => notification.subject === 'Customer-only update'));

  const riderOnlyEmailStart = emails.length;
  const riderOnlyNotification = await request('/api/admin/notifications', {
    method: 'POST',
    cookie: adminCookie,
    body: { subject: 'Rider-only update', message: 'For riders only.', audience: 'riders' },
  });
  assert.equal(riderOnlyNotification.response.status, 201);
  assert.equal(riderOnlyNotification.result.notification.recipientCount, 2);
  assert.deepEqual(
    emails.slice(riderOnlyEmailStart).map(email => email.to).sort(),
    ['jordan.rider@example.com', 'rider@example.com'],
  );
  const riderOnlySaved = database.find('notifications', notification => notification.id === riderOnlyNotification.result.notification.id);
  assert.deepEqual(riderOnlySaved.recipients.sort(), ['jordan.rider@example.com', 'rider@example.com']);
  const customerNotificationsAfterRiderSend = await request('/api/customer/notifications', { cookie: customer.cookie });
  const riderNotificationsAfterTargetedSend = await request('/api/rider/notifications', { cookie: riderLogin.cookie });
  assert.ok(!customerNotificationsAfterRiderSend.result.notifications.some(notification => notification.subject === 'Rider-only update'));
  assert.ok(riderNotificationsAfterTargetedSend.result.notifications.some(notification => notification.subject === 'Rider-only update'));

  failNewOrderEmail = true;
  const savedDespiteEmailFailure = await request('/api/customer/orders', {
    method: 'POST',
    cookie: customer.cookie,
    body: {
      item: 'Another box',
      quantity: 1,
      description: 'Order email outage case',
      pickup: 'Three Street',
      delivery: 'Four Street',
      deliveryDistanceKm: 2,
      pickupEmail: 'pickup@example.com',
      deliveryEmail: 'delivery@example.com',
      date: '2026-10-20',
      phone: '555-0110',
      notes: '',
      transferReference: 'OUTAGE-TXN-2026',
      paidConfirmation: true,
      photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    },
  });
  failNewOrderEmail = false;
  assert.equal(savedDespiteEmailFailure.response.status, 201);
  assert.match(savedDespiteEmailFailure.result.warning, /request was saved/i);
  const customerOrdersAfterNotificationFailure = await request('/api/customer/orders', { cookie: customer.cookie });
  assert.ok(customerOrdersAfterNotificationFailure.result.orders.some(
    savedOrder => savedOrder.id === savedDespiteEmailFailure.result.order.id,
  ));

  const riderLogout = await request('/api/auth/logout', {
    method: 'POST',
    cookie: combinedCookies,
    body: { role: 'rider' },
  });
  assert.equal(riderLogout.response.status, 204);
  const signedOutRider = await request('/api/rider/me', { cookie: riderLogin.cookie });
  assert.equal(signedOutRider.response.status, 200);
  assert.equal(signedOutRider.result.rider, null);
  assert.equal((await request('/api/auth/me', { cookie: combinedCookies })).response.status, 200);
  assert.equal((await request('/api/auth/admin/me', { cookie: combinedCookies })).response.status, 200);

  const photo = await fetch(`${baseUrl}/api/orders/${order.result.order.id}/photo`, {
    headers: { Cookie: customer.cookie },
  });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/png');

  const heicPhoto = Buffer.from('000000186674797068656963000000006865696300000000', 'hex');
  const additionalPhotoOrder = await request('/api/customer/orders', {
    method: 'POST',
    cookie: customer.cookie,
    body: {
      item: 'Photo format test',
      quantity: 1,
      description: 'HEIC photo upload',
      pickup: 'Five Street',
      delivery: 'Six Street',
      pickupEmail: 'pickup@example.com',
      deliveryEmail: 'delivery@example.com',
      date: '2026-10-20',
      phone: '555-0110',
      notes: '',
      transferReference: 'HEIC-TXN-2026',
      paidConfirmation: true,
      photo: `data:image/heic;base64,${heicPhoto.toString('base64')}`,
    },
  });
  assert.equal(additionalPhotoOrder.response.status, 201);
  assert.equal(emails.at(-1).inlineImage.name, `package-${additionalPhotoOrder.result.order.reference}.heic`);
  const heicPhotoResponse = await fetch(`${baseUrl}/api/orders/${additionalPhotoOrder.result.order.id}/photo`, {
    headers: { Cookie: customer.cookie },
  });
  assert.equal(heicPhotoResponse.status, 200);
  assert.equal(heicPhotoResponse.headers.get('content-type'), 'image/heic');
  assert.deepEqual(Buffer.from(await heicPhotoResponse.arrayBuffer()), heicPhoto);

  const unsupportedPhotoOrder = await request('/api/customer/orders', {
    method: 'POST',
    cookie: customer.cookie,
    body: {
      item: 'Unsupported photo format test',
      quantity: 1,
      description: 'SVG must not be accepted as a package photo',
      pickup: 'Five Street',
      delivery: 'Six Street',
      pickupEmail: 'pickup@example.com',
      deliveryEmail: 'delivery@example.com',
      date: '2026-10-20',
      phone: '555-0110',
      notes: '',
      transferReference: 'SVG-TXN-2026',
      paidConfirmation: true,
      photo: 'data:image/svg+xml;base64,PHN2Zy8+',
    },
  });
  assert.equal(unsupportedPhotoOrder.response.status, 400);
});
