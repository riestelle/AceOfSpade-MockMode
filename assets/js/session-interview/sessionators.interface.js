(function () {
  const mobileQuery = window.matchMedia('(max-width: 900px)');
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isMobileUA = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  const isMobile = mobileQuery.matches || isMobileUA;

  window.sessionPlatform = isMobile ? 'mobile' : 'desktop';
  window.isMobileSession = isMobile;
  window.isDesktopSession = !isMobile;

  document.documentElement.classList.add(isMobile ? 'mm-platform-mobile' : 'mm-platform-desktop');
  document.body.classList.add(isMobile ? 'mm-platform-mobile' : 'mm-platform-desktop');

  function initSessionUI() {
    const stage = document.getElementById('interviewer-lottie-stage');
    if (stage) {
      if (isMobile) {
        stage.style.maxWidth = '420px';
        stage.style.minHeight = '380px';
        stage.style.padding = '18px';
      } else {
        stage.style.maxWidth = '700px';
        stage.style.minHeight = '560px';
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSessionUI);
  } else {
    initSessionUI();
  }
})();
