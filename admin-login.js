const loginForm = document.querySelector('#admin-login-form');
const loginStatus = document.querySelector('#admin-login-status');

function adminReturnTarget() {
  const value = (new URLSearchParams(window.location.search).get('returnTo') || 'admin.html').replace(/^\/+/, '');
  return /^admin(?:-[a-z]+)?\.html$/.test(value) ? value : 'admin.html';
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const values = new FormData(loginForm);
  const submit = loginForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await api.request('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: values.get('email'), password: values.get('password') }),
    });
    window.location.replace(adminReturnTarget());
  } catch (error) {
    api.setStatus(loginStatus, error.message);
  } finally {
    submit.disabled = false;
  }
});
