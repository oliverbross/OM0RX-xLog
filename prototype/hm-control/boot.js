// Keep a failed GPU/module load visible and recoverable in its own window.
try {
  await import('./dashboard.js');
} catch (error) {
  const status = document.getElementById('xlog-link');
  status.textContent = 'HM Control could not start. Check graphics support and reload this window.';
  status.classList.add('failed');
  const retry = document.getElementById('xlog-retry');
  retry.hidden = false; retry.textContent = 'Reload HM Control';
  retry.addEventListener('click', () => location.reload());
  console.error('HM Control initialization failed', error);
}
