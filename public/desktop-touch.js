// Loaded before Selkies so touch input can behave like a phone on the car screen.
(() => {
  if (!('ontouchstart' in window) && navigator.maxTouchPoints < 1) return;

  let keyboardRequested = false;
  const nativeFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (...args) {
    if (this.id === 'overlayInput' && !keyboardRequested) return;
    return nativeFocus.apply(this, args);
  };

  function hideKeyboard() {
    keyboardRequested = false;
    for (const id of ['overlayInput', 'keyboard-input-assist']) {
      document.getElementById(id)?.blur();
    }
    document.activeElement?.blur?.();
    navigator.virtualKeyboard?.hide?.();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const controls = document.createElement('div');
    controls.id = 'ridepane-touch-controls';
    controls.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;display:flex;gap:6px;pointer-events:auto';
    for (const [label, action] of [
      ['⌨ Keyboard', () => {
        keyboardRequested = true;
        const field = document.getElementById('overlayInput') || document.getElementById('keyboard-input-assist');
        field?.focus();
      }],
      ['Hide keyboard', hideKeyboard]
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.cssText = 'background:#142b36;color:#fff;border:1px solid #76bfc4;border-radius:8px;padding:7px 9px;font:600 13px system-ui;box-shadow:0 2px 8px #0009';
      button.addEventListener('click', action);
      controls.append(button);
    }
    document.body.append(controls);
  });

  const isStream = target => target instanceof Element &&
    !!target.closest('#overlayInput, canvas, video');
  let gesture = null;
  let ignoreMouseUntil = 0;
  const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); };

  window.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' && isStream(event.target)) stop(event);
  }, { capture: true, passive: false });
  for (const name of ['pointermove', 'pointerup', 'pointercancel']) {
    window.addEventListener(name, event => {
      if (event.pointerType === 'touch' && gesture) stop(event);
    }, { capture: true, passive: false });
  }

  window.addEventListener('touchstart', event => {
    if (!isStream(event.target)) return;
    stop(event);
    hideKeyboard();
    if (event.touches.length !== 1) { gesture = null; return; }
    const touch = event.touches[0];
    gesture = { target: document.getElementById('overlayInput') || event.target, x: touch.clientX, y: touch.clientY,
      lastX: touch.clientX, lastY: touch.clientY, moved: false };
  }, { capture: true, passive: false });

  window.addEventListener('touchmove', event => {
    if (!gesture) return;
    stop(event);
    if (event.touches.length !== 1) { gesture = null; return; }
    const touch = event.touches[0];
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    if (Math.hypot(dx, dy) > 9) gesture.moved = true;
    if (gesture.moved) {
      gesture.target.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaMode: 0,
        deltaX: (gesture.lastX - touch.clientX) * 1.5,
        deltaY: (gesture.lastY - touch.clientY) * 1.5,
        clientX: touch.clientX, clientY: touch.clientY
      }));
    }
    gesture.lastX = touch.clientX;
    gesture.lastY = touch.clientY;
  }, { capture: true, passive: false });

  window.addEventListener('touchend', event => {
    if (!gesture) return;
    stop(event);
    const finished = gesture;
    gesture = null;
    ignoreMouseUntil = Date.now() + 500;
    if (finished.moved) return;
    const target = finished.target;
    const options = { bubbles: true, cancelable: true, button: 0,
      clientX: finished.x, clientY: finished.y };
    target.dispatchEvent(new MouseEvent('mousedown', { ...options, buttons: 1 }));
    window.dispatchEvent(new MouseEvent('mouseup', { ...options, buttons: 0 }));
  }, { capture: true, passive: false });

  window.addEventListener('touchcancel', event => {
    if (!gesture) return;
    stop(event);
    gesture = null;
  }, { capture: true, passive: false });

  // Some touch browsers emit a mouse click after touchend despite preventDefault.
  for (const name of ['mousedown', 'mouseup', 'click']) {
    window.addEventListener(name, event => {
      if (event.isTrusted && Date.now() < ignoreMouseUntil && isStream(event.target)) stop(event);
    }, { capture: true });
  }
})();
