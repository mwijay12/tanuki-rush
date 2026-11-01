// Keyboard + gamepad + touch input, merged into one simple state object.
// Edge-triggered presses are latched until consumed with take(name).

const KEYMAP = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'KeyJ', 'KeyZ'],
  boost: ['ShiftLeft', 'ShiftRight', 'KeyK', 'KeyX'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter'],
  retry: ['KeyR'],
};

export class Input {
  constructor() {
    this.down = new Set();
    this.latched = new Set();
    this.steer = 0;
    this.brake = false;
    this.jumpHeld = false;
    this.boostHeld = false;
    this.touch = { steer: 0, jump: false, boost: false, brake: false };
    this.lastDevice = 'keyboard';
    this._padPrev = {};
    this.enabled = true;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (this._isGameKey(e.code)) e.preventDefault(); return; }
      this.down.add(e.code);
      this.lastDevice = 'keyboard';
      for (const [name, codes] of Object.entries(KEYMAP)) if (codes.includes(e.code)) this.latched.add(name);
      if (this._isGameKey(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.down.delete(e.code); });
    window.addEventListener('blur', () => { this.down.clear(); });
  }

  _isGameKey(code) {
    return Object.values(KEYMAP).some((c) => c.includes(code));
  }

  held(name) {
    const codes = KEYMAP[name];
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** Consume an edge-triggered press. */
  take(name) {
    if (this.latched.has(name)) { this.latched.delete(name); return true; }
    return false;
  }

  peek(name) { return this.latched.has(name); }

  /** Gamepad rumble (no-op on keyboard / unsupported pads). */
  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    if (this.lastDevice !== 'gamepad' || !navigator.getGamepads) return;
    for (const gp of navigator.getGamepads()) {
      const act = gp && gp.vibrationActuator;
      if (act && act.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
    }
  }

  press(name) { this.latched.add(name); }

  clearLatched() { this.latched.clear(); }

  update() {
    let steer = 0;
    if (this.held('left')) steer -= 1;
    if (this.held('right')) steer += 1;
    let brake = this.held('down');
    let jump = this.held('jump');
    let boost = this.held('boost');

    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const ax = gp.axes[0] || 0;
      const dead = 0.18;
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const edge = (i, name) => {
        const p = b(i);
        const key = gp.index + ':' + i;
        if (p && !this._padPrev[key]) { this.latched.add(name); this.lastDevice = 'gamepad'; }
        this._padPrev[key] = p;
        return p;
      };
      if (Math.abs(ax) > dead) { steer = Math.sign(ax) * (Math.abs(ax) - dead) / (1 - dead); this.lastDevice = 'gamepad'; }
      if (b(14)) steer = -1;
      if (b(15)) steer = 1;
      jump = edge(0, 'jump') || jump;
      const bst = edge(2, 'boost') | edge(1, 'boost') | edge(7, 'boost') | edge(5, 'boost');
      boost = boost || !!bst;
      brake = brake || b(6) || (gp.axes[1] || 0) > 0.6 || b(13);
      edge(9, 'pause');
      edge(12, 'up'); edge(13, 'down'); edge(14, 'left'); edge(15, 'right');
      if (b(0) && !this._padPrev['c' + gp.index]) this.latched.add('confirm');
      this._padPrev['c' + gp.index] = b(0);
      if (b(3) && !this._padPrev['r' + gp.index]) this.latched.add('retry');
      this._padPrev['r' + gp.index] = b(3);
      const ay = gp.axes[1] || 0;
      const stickUp = ay < -0.6, stickDown = ay > 0.6;
      const kU = 'su' + gp.index, kD = 'sd' + gp.index, kL = 'sl' + gp.index, kR = 'sr' + gp.index;
      if (stickUp && !this._padPrev[kU]) this.latched.add('up');
      if (stickDown && !this._padPrev[kD]) this.latched.add('down');
      if (ax < -0.6 && !this._padPrev[kL]) this.latched.add('left');
      if (ax > 0.6 && !this._padPrev[kR]) this.latched.add('right');
      this._padPrev[kU] = stickUp; this._padPrev[kD] = stickDown; this._padPrev[kL] = ax < -0.6; this._padPrev[kR] = ax > 0.6;
    }

    // touch
    if (this.touch.steer) steer = this.touch.steer;
    jump = jump || this.touch.jump;
    boost = boost || this.touch.boost;
    brake = brake || this.touch.brake;

    this.steer = Math.max(-1, Math.min(1, steer));
    this.brake = brake;
    this.jumpHeld = jump;
    this.boostHeld = boost;
  }
}
