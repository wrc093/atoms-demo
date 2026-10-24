/* Shared motion, appearance, and keyboard navigation. No animation dependencies. */
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const easing = 'cubic-bezier(.16,1,.3,1)';
  let observer;
  let modalOpener;
  let dismissAnimation;

  function animate(element, frames, options = {}) {
    if (!element || reduced.matches) return null;
    return element.animate(frames, { duration: 420, easing, ...options });
  }

  function theme(value) {
    document.documentElement.dataset.theme = value;
    localStorage.setItem('forma-theme', value);
    document.querySelectorAll('[data-action="theme"]').forEach(button => {
      button.setAttribute('aria-label', value === 'dark' ? '切换浅色模式' : '切换深色模式');
      button.setAttribute('aria-pressed', String(value === 'dark'));
    });
    document.querySelectorAll('iframe').forEach(frame => frame.contentWindow?.postMessage({ type: 'forma-theme', value }, location.origin));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value === 'dark' ? '#141414' : '#fafafa');
  }

  function mount() {
    observer?.disconnect();
    theme(document.documentElement.dataset.theme || 'light');
    window.FormaSculpture?.mount();
    const items = document.querySelectorAll('.template-card,.project-card,.onboard-option,.journey-step,.section-heading,.preview-stage');
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const element = entry.target;
        animate(element, [{ opacity: 0, transform: 'translateY(18px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' }], { duration: 650, delay: Number(element.dataset.revealDelay || 0) });
        observer.unobserve(element);
      });
    }, { threshold: .08 });
    items.forEach((element, index) => {element.dataset.revealDelay = (index % 4) * 55;observer.observe(element);});
    document.querySelectorAll('.hero-copy > *:not(.hero-title):not(.welcome-intro),.welcome-message>.hero-kicker,.welcome-message>.hero-description,.auth-box > *,.project-intro > *,.onboard-body > .eyebrow,.onboard-body > h1,.onboard-body > p').forEach((element, index) => {
      animate(element, [{ opacity: 0, transform: 'translateY(12px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' }], { duration: 650, delay: Math.min(index * 55, 280) });
    });
    document.querySelectorAll('.hero-title-lead,.hero-title-result').forEach((element, index) => {
      animate(element, [{ opacity: 0, transform: 'translateY(24px)', filter: 'blur(6px)' }, { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' }], { duration: 900, delay: 90 + index * 110 });
    });
    animate(document.querySelector('.hero-display-word'), [{ backgroundPosition: '0% 50%' }, { backgroundPosition: '100% 50%' }], { duration: 1600, delay: 700 });
    document.querySelectorAll('.hero-prompt,.fm-composer').forEach(element => {
      element.addEventListener('pointermove', event => {
        if (reduced.matches || event.pointerType === 'touch') return;
        const box = element.getBoundingClientRect();
        element.style.setProperty('--pointer-x', `${event.clientX - box.left}px`);
        element.style.setProperty('--pointer-y', `${event.clientY - box.top}px`);
      });
    });
  }

  function modalOpen(root) {
    dismissAnimation?.cancel();
    modalOpener = document.activeElement;
    animate(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
    animate(root.querySelector('.dialog'), [{ opacity: 0, transform: 'translateY(16px) scale(.97)', filter: 'blur(3px)' }, { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' }], { duration: 440 });
  }

  function modalClose(root, done) {
    if (root.hidden || reduced.matches) { done(); return; }
    animate(root.querySelector('.dialog'), [{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(7px) scale(.985)' }], { duration: 130 });
    dismissAnimation = animate(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 130 });
    dismissAnimation?.finished.then(() => { done(); if (modalOpener?.isConnected) modalOpener.focus(); }).catch(() => {});
  }

  function grid(container, update) {
    const positions = new Map([...container.querySelectorAll('.project-card')].map(el => [el.querySelector('[data-open]').dataset.open, el.getBoundingClientRect()]));
    update();
    container.querySelectorAll('.project-card').forEach((el, index) => {
      const before = positions.get(el.querySelector('[data-open]').dataset.open);
      const after = el.getBoundingClientRect();
      animate(el, before ? [{ transform: `translate(${before.left - after.left}px,${before.top - after.top}px)`, opacity: .65 }, { transform: 'translate(0,0)', opacity: 1 }] : [{ transform: 'translateY(10px) scale(.98)', opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], { duration: 380, delay: index * 25 });
    });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button,a.btn');
    if (button && !button.disabled) animate(button, [{ scale: '1' }, { scale: '.97' }, { scale: '1' }], { duration: 230 });
    if (button?.dataset.action === 'theme') {
      theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
      animate(button, [{ rotate: '-35deg', opacity: .4 }, { rotate: '0deg', opacity: 1 }], { duration: 400 });
    }
  });
  window.FormaUI = { animate, mount, modalOpen, modalClose, grid, reduced, theme };
})();
