(() => {
  function setup() {
    const login = document.querySelector('.login');
    const box = document.querySelector('.login-box');
    const enterBtn = document.querySelector('[data-login]');
    const cancelBtn = document.querySelector('[data-cancel]');
    const gear = document.querySelector('.gear');
    if (!login || !box || !enterBtn || !cancelBtn) return;

    // Keep the login above every portfolio/editor layer, including the emergency launcher.
    Object.assign(login.style, {
      zIndex: '2147483646',
      pointerEvents: 'auto'
    });
    Object.assign(box.style, {
      position: 'relative',
      zIndex: '2147483647',
      pointerEvents: 'auto'
    });
    [enterBtn, cancelBtn].forEach((b) => {
      b.type = 'button';
      b.style.pointerEvents = 'auto';
      b.style.cursor = 'pointer';
      b.style.position = 'relative';
      b.style.zIndex = '2147483647';
    });
    if (gear) gear.style.zIndex = '90';

    // Hard fallback for cancel, independent of the main editor script.
    cancelBtn.addEventListener('pointerup', (e) => {
      e.preventDefault();
      e.stopPropagation();
      login.classList.remove('open');
      const err = document.querySelector('.login-error');
      if (err) err.textContent = '';
    }, true);

    // Enter key submits; Escape always closes.
    const pass = document.querySelector('#pass');
    const user = document.querySelector('#user');
    [user, pass].filter(Boolean).forEach((input) => input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        enterBtn.click();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        login.classList.remove('open');
      }
    }));

    // Make failures visible instead of feeling like a dead button.
    enterBtn.addEventListener('pointerdown', () => {
      const err = document.querySelector('.login-error');
      if (err) err.textContent = 'Checking credentials…';
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();