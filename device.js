// Phone hardware glue: sound and vibration cues, wake lock, battery and a
// low-power mode. Everything degrades silently where an API is missing
// (no vibration on iOS, no Battery API on Safari, no Wake Lock in old browsers).
window.MHDevice = (() => {
  const { store } = window.MHUI;

  // ---- cues: vibration + a short beep ----------------------------------------
  // Browsers block audio until the user has touched the page, so the context is
  // created/resumed on the first pointerdown and beeps are skipped until then.
  let audio = null, gestured = false;
  const unlockAudio = () => { gestured = true; try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); } catch {} };
  addEventListener("pointerdown", unlockAudio, { passive: true });
  const soundOn = () => store.get("manhunt:sound", true);
  const audioReady = () => !!audio && audio.state === "running";
  const beep = (notes) => {
    if (!soundOn() || !audioReady()) return;
    try {
      let t = audio.currentTime;
      for (const [freq, dur] of notes) {
        const o = audio.createOscillator(), gnode = audio.createGain();
        o.type = "square"; o.frequency.value = freq;
        gnode.gain.setValueAtTime(0.0001, t); gnode.gain.exponentialRampToValueAtTime(0.25, t + 0.02); gnode.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(gnode).connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
        t += dur + 0.06;
      }
    } catch {}
  };
  const canVibrate = () => typeof navigator.vibrate === "function";
  // Chrome ignores (and logs) vibrate() before the first touch, so wait for one.
  const vibrate = (p) => { try { gestured && canVibrate() && navigator.vibrate(p); } catch {} };
  const CUES = {
    head: () => { vibrate([300, 100, 300]); beep([[660, 0.12], [880, 0.2]]); },
    hunt: () => { vibrate([200, 80, 200, 80, 600]); beep([[523, 0.1], [659, 0.1], [784, 0.1], [1046, 0.35]]); },
    over: () => { vibrate([800]); beep([[784, 0.15], [523, 0.15], [392, 0.4]]); },
    soon: () => { vibrate([120]); beep([[988, 0.08]]); },
    warn: () => { vibrate([250, 100, 250]); beep([[220, 0.25], [220, 0.25]]); },
    tap: () => { vibrate([80, 40, 80]); },
  };

  // ---- wake lock -------------------------------------------------------------------
  // The lock is dropped by the OS whenever the screen locks or the app goes to
  // the background; it is re-requested every time the page becomes visible.
  let wake = null, wantWake = false;
  const notifyWake = () => document.dispatchEvent(new Event("mh:wake"));
  const requestWake = async () => {
    if (!wantWake || !("wakeLock" in navigator) || document.visibilityState !== "visible" || lowPower()) return;
    try { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => { wake = null; notifyWake(); }); } catch { wake = null; }
    notifyWake();
  };
  const keepAwake = (on) => { wantWake = on; if (on) requestWake(); else { try { wake && wake.release(); } catch {} wake = null; notifyWake(); } };
  const awake = () => !!wake;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") requestWake(); });

  // ---- battery ------------------------------------------------------------------------
  // Chrome on Android exposes navigator.getBattery; iOS Safari does not, so the
  // warning simply never fires there and low-power mode stays a manual switch.
  const battery = { level: null, charging: null };
  const notifyBattery = () => document.dispatchEvent(new Event("mh:battery"));
  try {
    if (navigator.getBattery) navigator.getBattery().then((b) => {
      const upd = () => { battery.level = b.level; battery.charging = b.charging; notifyBattery(); };
      b.addEventListener("levelchange", upd); b.addEventListener("chargingchange", upd); upd();
    }).catch(() => {});
  } catch {}

  // ---- low-power mode -------------------------------------------------------------------
  // Longer polls, no animations, GPS off, screen allowed to sleep. Saved on the
  // phone so it survives a reload.
  const lowPower = () => store.get("manhunt:lowpower", false) === true;
  const applyLowPower = () => document.documentElement.classList.toggle("lowpower", lowPower());
  const setLowPower = (on) => {
    store.set("manhunt:lowpower", !!on); applyLowPower();
    if (on) { try { wake && wake.release(); } catch {} wake = null; notifyWake(); } else requestWake();
    document.dispatchEvent(new Event("mh:lowpower"));
  };
  applyLowPower();

  return { unlockAudio, soundOn, audioReady, beep, vibrate, canVibrate, CUES, keepAwake, awake, battery, lowPower, setLowPower };
})();
