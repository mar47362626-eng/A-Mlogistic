const isNetlifySite = window.location.hostname.endsWith('.netlify.app');
window.API_BASE_URL = isNetlifySite
  ? window.location.origin
  : window.API_BASE_URL || 'https://a-mlogistic.onrender.com';
const apiBaseUrl = window.API_BASE_URL.replace(/\/+$/, '');

window.api = {
  url(path) {
    if (/^https?:\/\//i.test(path)) return path;
    return `${apiBaseUrl}${path}`;
  },
  setStatus(element, message, state = 'error') {
    element.textContent = message;
    if (!message) {
      element.classList.remove('feedback-message');
      delete element.dataset.state;
      return;
    }
    element.classList.add('feedback-message');
    element.dataset.state = state;
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
  },
  async request(url, options = {}) {
    const response = await fetch(window.api.url(url), {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    if (response.status === 204) return null;
    let result;
    try {
      result = await response.json();
    } catch {
      const error = new Error(
        `The service returned an unexpected response (HTTP ${response.status}). Please try again. If this continues, contact A&M Logistics.`,
      );
      error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(result.error || 'The request could not be completed.');
      error.status = response.status;
      throw error;
    }
    return result;
  },
};
