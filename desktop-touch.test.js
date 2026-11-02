import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('touch input turns a swipe into scrolling and a tap into a remote click', () => {
  const listeners = new Map();
  const events = [];
  class Element {
    closest() { return this; }
    dispatchEvent(event) { events.push(event); }
  }
  class HTMLElement extends Element {
    constructor(id) { super(); this.id = id; this.focused = false; }
    focus() { this.focused = true; }
    blur() { this.focused = false; }
  }
  class WheelEvent { constructor(type, options) { Object.assign(this, options, { type }); } }
  class MouseEvent { constructor(type, options) { Object.assign(this, options, { type }); } }
  const overlay = new HTMLElement('overlayInput');
  const window = {
    ontouchstart: null,
    addEventListener(name, handler) { listeners.set(name, handler); },
    dispatchEvent(event) { events.push(event); }
  };
  const document = {
    activeElement: overlay,
    addEventListener() {},
    getElementById(id) { return id === 'overlayInput' ? overlay : null; }
  };
  vm.runInNewContext(fs.readFileSync(new URL('./public/desktop-touch.js', import.meta.url), 'utf8'), {
    window, document, navigator: { maxTouchPoints: 1 }, Element, HTMLElement, WheelEvent, MouseEvent,
    Date, Math
  });
  overlay.focus();
  assert.equal(overlay.focused, false, 'the stream should not pop up the Tesla keyboard');
  const touchEvent = (name, x, y) => {
    const event = {
      target: overlay, touches: name === 'touchend' ? [] : [{ clientX: x, clientY: y }],
      preventDefault() {}, stopImmediatePropagation() {}
    };
    listeners.get(name)(event);
  };
  touchEvent('touchstart', 100, 200);
  touchEvent('touchmove', 100, 160);
  touchEvent('touchend', 100, 160);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'wheel');
  assert.equal(events[0].deltaY, 60);
  events.length = 0;
  touchEvent('touchstart', 100, 200);
  touchEvent('touchend', 100, 200);
  assert.deepEqual(events.map(event => event.type), ['mousedown', 'mouseup']);
});

test('Tesla-sized browsers with mouse-style touch get scroll and keyboard controls', () => {
  const listeners = new Map();
  const events = [];
  let controls;
  class Element {
    closest() { return this; }
    dispatchEvent(event) { events.push(event); }
  }
  class HTMLElement extends Element {
    constructor(id) { super(); this.id = id; this.focused = false; }
    focus() { this.focused = true; }
    blur() { this.focused = false; }
  }
  class WheelEvent { constructor(type, options) { Object.assign(this, options, { type }); } }
  class MouseEvent { constructor(type, options) { Object.assign(this, options, { type }); } }
  const overlay = new HTMLElement('overlayInput');
  const window = {
    innerWidth: 773, screen: { width: 773 },
    addEventListener(name, handler) { listeners.set(name, handler); },
    dispatchEvent(event) { events.push(event); }
  };
  const document = {
    activeElement: overlay,
    addEventListener(name, handler) { listeners.set(name, handler); },
    getElementById(id) { return id === 'overlayInput' ? overlay : null; },
    createElement() { return { style: {}, children: [], append(child) { this.children.push(child); },
      addEventListener(name, handler) { this[name] = handler; } }; },
    body: { append(element) { controls = element; } }
  };
  vm.runInNewContext(fs.readFileSync(new URL('./public/desktop-touch.js', import.meta.url), 'utf8'), {
    window, document, navigator: { maxTouchPoints: 0 }, Element, HTMLElement, WheelEvent, MouseEvent,
    Date, Math
  });
  listeners.get('DOMContentLoaded')();
  assert.deepEqual(controls.children.map(button => button.textContent), ['⌨ Keyboard', 'Hide keyboard']);
  overlay.focus();
  assert.equal(overlay.focused, false);
  controls.children[0].click();
  assert.equal(overlay.focused, true);
  controls.children[1].click();
  assert.equal(overlay.focused, false);
  const mouse = (name, x, y) => listeners.get(name)({ target: overlay, isTrusted: true,
    button: 0, clientX: x, clientY: y, preventDefault() {}, stopImmediatePropagation() {} });
  mouse('mousedown', 100, 200);
  mouse('mousemove', 100, 160);
  mouse('mouseup', 100, 160);
  assert.deepEqual(events.map(event => event.type), ['wheel']);
  assert.equal(events[0].deltaY, 60);
  events.length = 0;
  mouse('mousedown', 100, 200);
  mouse('mouseup', 100, 200);
  assert.deepEqual(events.map(event => event.type), ['mousedown', 'mouseup']);
});
