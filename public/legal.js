(function () {
  const name = window.BUSINESS_NAME || 'WiFi Voucher';
  const email = window.BUSINESS_EMAIL || 'support email not configured';
  const phone = window.BUSINESS_PHONE || 'phone not configured';
  const address = window.BUSINESS_ADDRESS || 'business address not configured';
  document.querySelectorAll('[data-business-name]').forEach(el => el.textContent = name);
  document.querySelectorAll('[data-business-email]').forEach(el => el.textContent = email);
  document.querySelectorAll('[data-business-phone]').forEach(el => el.textContent = phone);
  document.querySelectorAll('[data-business-address]').forEach(el => el.textContent = address);
  document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
})();
