window.api = {
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
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    if (response.status === 204) return null;
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || 'The request could not be completed.');
      error.status = response.status;
      throw error;
    }
    return result;
  },
};
