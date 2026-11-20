'use client';

import { CircleHelp, Keyboard, List, Mouse, Pointer, RotateCw, SlidersHorizontal, Trophy, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PegAudio } from './audio';
import { appearance, contact, defaultNames, defaults, motion, type Phase, type Settings } from './config';
import { focusedIndex, START_ANGLE, STEP, WheelPhysics } from './physics';
import { SettingsPanel } from './settings-panel';
import { WheelCanvas } from './wheel-canvas';

const STORAGE = 'lucky-wheel-v1';
type Mode = 'auto' | 'hold';
type Saved = { text: string; settings: Settings; mode: Mode; muted: boolean };

function restore(): Partial<Saved> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? '{}');
    const settings = { ...defaults };
    for (const { key, min, max } of [...appearance, ...motion, ...contact]) {
      const value = saved.settings?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) settings[key] = Math.max(min, Math.min(max, value));
    }
    const validColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    if (Array.isArray(saved.settings?.colors) && saved.settings.colors.length === 8 && saved.settings.colors.every(validColor)) {
      settings.colors = saved.settings.colors;
    }
    if (validColor(saved.settings?.pointerColor)) settings.pointerColor = saved.settings.pointerColor;
    return { text: typeof saved.text === 'string' ? saved.text : defaultNames, settings, mode: saved.mode === 'hold' ? 'hold' : 'auto', muted: saved.muted === true };
  } catch {
    return {};
  }
}

export default function Home() {
  const [raw, setRaw] = useState(defaultNames);
  const [settings, setSettings] = useState(defaults);
  const [mode, setMode] = useState<Mode>('auto');
  const [phase, setPhase] = useState<Phase>('idle');
  const [current, setCurrent] = useState(2);
  const [winner, setWinner] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [edit, setEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const physics = useRef<WheelPhysics | null>(null);
  const audio = useRef<PegAudio | null>(null);
  const redraw = useRef<() => void>(() => {});
  const radius = useRef(250);
  const dots = useRef<HTMLDivElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const power = useRef<HTMLDivElement>(null);
  const mutedRef = useRef(muted);
  const button = useRef<HTMLButtonElement>(null);
  const inputs = useMemo(() => raw.split(/\r\n?|\n/), [raw]);
  const names = useMemo(() => inputs.map((entry) => entry.trim()).filter(Boolean), [inputs]);
  const liveNames = useRef(names);
  const liveSettings = useRef(settings);
  const liveIndex = useRef(2);
  const frame = useRef(0);
  const lastTime = useRef(0);
  const accumulator = useRef(0);
  const holdSource = useRef<'pointer' | 'keyboard' | null>(null);

  useEffect(() => {
    physics.current = new WheelPhysics();
    audio.current = new PegAudio();
    const saved = restore();
    setRaw(saved.text ?? defaultNames);
    setSettings(saved.settings ?? defaults);
    setMode(saved.mode ?? 'auto');
    mutedRef.current = saved.muted ?? false;
    setMuted(mutedRef.current);
    setLoaded(true);
    return () => {
      cancelAnimationFrame(frame.current);
      audio.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(STORAGE, JSON.stringify({ text: raw, settings, mode, muted })); } catch {}
  }, [raw, settings, mode, muted, loaded]);

  useEffect(() => {
    liveNames.current = names;
    liveIndex.current = focusedIndex(physics.current?.angle ?? START_ANGLE, names.length);
    setCurrent(liveIndex.current);
    setWinner(null);
  }, [names]);

  useEffect(() => { liveSettings.current = settings; }, [settings]);

  const animate = useCallback(function tick(now: number) {
    const wheel = physics.current;
    if (!wheel) return;
    const entries = liveNames.current;
    const config = liveSettings.current;
    accumulator.current += Math.min(0.065, (now - lastTime.current) / 1000);
    lastTime.current = now;
    while (accumulator.current >= STEP && wheel.phase !== 'idle') {
      wheel.step(entries.length, radius.current, config, (strength) => {
        if (!mutedRef.current) audio.current?.tick(strength, config.volume / 100);
      });
      accumulator.current -= STEP;
    }
    redraw.current();
    const index = focusedIndex(wheel.angle, entries.length);
    if (index !== liveIndex.current) {
      liveIndex.current = index;
      setCurrent(index);
    }
    power.current?.style.setProperty('--power', String(Math.min(1, Math.abs(wheel.velocity) / config.maxSpeed)));
    if (wheel.phase === 'idle') {
      setWinner(entries[index] ?? null);
      setPhase('idle');
    } else {
      frame.current = requestAnimationFrame(tick);
    }
  }, []);

  const start = useCallback((hold: boolean) => {
    const wheel = physics.current;
    if (!wheel || wheel.phase !== 'idle' || !liveNames.current.length) return false;
    if (!mutedRef.current) audio.current?.unlock();
    wheel.start(hold, liveSettings.current);
    setWinner(null);
    setPhase(wheel.phase);
    lastTime.current = performance.now();
    accumulator.current = 0;
    frame.current = requestAnimationFrame(animate);
    return true;
  }, [animate]);

  const release = useCallback(() => {
    holdSource.current = null;
    const wheel = physics.current;
    if (wheel?.phase !== 'charging') return;
    wheel.release(liveSettings.current);
    setPhase('coasting');
  }, []);

  useEffect(() => {
    function down(event: KeyboardEvent) {
      if (event.code !== 'Space' || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      const spinFocused = target === button.current;
      if (!spinFocused && target instanceof HTMLElement && target.closest('input,textarea,button,select,a,[contenteditable]')) return;
      if (edit && !spinFocused) return;
      event.preventDefault();
      if (event.repeat) return;
      if (mode === 'hold' && start(true)) holdSource.current = 'keyboard';
      if (mode === 'auto') start(false);
    }
    function up(event: KeyboardEvent) {
      if (event.code === 'Space' && holdSource.current === 'keyboard') {
        event.preventDefault();
        release();
      }
    }
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
    };
  }, [mode, edit, start, release]);

  const locked = phase !== 'idle';
  const noNames = names.length === 0;
  let colorIndex = 0;
  function closeEdit() {
    setEdit(false);
    editButton.current?.focus();
  }

  return (
    <div className="shell">
      <header className="site-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-icon" aria-hidden="true"><i/><i/><i/><i/></span>
            <span>Lucky Wheel</span>
          </div>
          <div className="head-actions">
            <button className="icon-btn sound" aria-label={muted ? 'เปิดเสียง' : 'ปิดเสียง'} title={muted ? 'เปิดเสียง' : 'ปิดเสียง'} onClick={() => {
              const value = !mutedRef.current;
              mutedRef.current = value;
              setMuted(value);
              if (!value && locked) audio.current?.unlock();
            }}>{muted ? <VolumeX size={20}/> : <Volume2 size={20}/>}</button>
            <button ref={editButton} className="edit-btn" aria-expanded={edit} aria-controls={edit ? 'wheel-settings' : undefined}
              onClick={() => setEdit(!edit)}><SlidersHorizontal size={17}/> <span>Edit</span></button>
          </div>
          {edit && <SettingsPanel values={settings} onChange={setSettings} onClose={closeEdit} locked={locked}/>}
        </div>
      </header>

      <main className="main">
        <div className="intro">
          <h1>วงล้อสุ่มชื่อ</h1>
          <p>ใส่รายชื่อ เลือกวิธีหมุน แล้วมาลุ้นกันว่าเข็มจะหยุดที่ใคร</p>
        </div>

        <div className="workspace">
          <section className="stage" aria-label="วงล้อและผลการสุ่ม">
            <div className="wheel-space">
              <WheelCanvas names={names} settings={settings} physics={physics} redraw={redraw} radiusRef={radius}/>
            </div>
            <div className={`focus-panel ${winner !== null ? 'winner' : ''}`}>
              <div className="focus-icon">{winner !== null ? <Trophy size={22}/> : <Pointer size={22}/>}</div>
              <div className="focus-copy">
                <span>{winner !== null ? 'ผู้ชนะ' : 'ชื่อใต้เข็ม'}</span>
                <strong>{winner ?? names[current] ?? '—'}</strong>
              </div>
              <span className="live-result" aria-live="polite" aria-atomic="true">{winner !== null ? `ผู้ชนะคือ ${winner}` : ''}</span>
            </div>
          </section>

          <aside className="controls" aria-label="รายชื่อและตัวควบคุมการหมุน">
            <section className="card names-card">
              <div className="card-title">
                <div className="title-text"><div className="card-icon"><List size={19}/></div><h2><label htmlFor="names">รายชื่อ</label></h2></div>
                <span className="count">{names.length} ชื่อ</span>
              </div>
              <p className="card-description" id="name-hint">พิมพ์หรือวางชื่อ บรรทัดละหนึ่งชื่อ</p>
              <div className="editor">
                <div className="dot-rail" ref={dots} aria-hidden="true">
                  {inputs.map((entry, index) => <div key={index}>{entry.trim() && <i style={{ background: settings.colors[colorIndex++ % settings.colors.length] }}/>}</div>)}
                </div>
                <textarea id="names" aria-describedby="name-hint" wrap="off" spellCheck={false} readOnly={locked} value={raw}
                  placeholder="ใส่รายชื่อที่นี่" onChange={(event) => setRaw(event.target.value)}
                  onScroll={(event) => { if (dots.current) dots.current.scrollTop = event.currentTarget.scrollTop; }}/>
              </div>
            </section>

            <section className="card spin-card">
              <div className="card-title">
                <div className="title-text"><div className="card-icon"><Mouse size={18}/></div><h2>วิธีหมุน</h2></div>
              </div>
              <div className="mode-switch" role="group" aria-label="วิธีหมุน">
                <button aria-pressed={mode === 'auto'} disabled={locked} onClick={() => setMode('auto')}><RotateCw size={16}/> กดครั้งเดียว</button>
                <button aria-pressed={mode === 'hold'} disabled={locked} onClick={() => setMode('hold')}><Pointer size={16}/> กดค้าง</button>
              </div>
              <button ref={button} className="spin" disabled={phase === 'coasting' || noNames} aria-label={mode === 'hold' ? 'กดค้างเพื่อเร่งวงล้อ' : 'หมุนวงล้อ'}
                onClick={(event) => {
                  if (mode === 'auto') start(false);
                  else if (event.detail === 0 && start(true)) release();
                }}
                onPointerDown={(event) => {
                  if (mode !== 'hold' || event.button !== 0 || !event.isPrimary || !start(true)) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  holdSource.current = 'pointer';
                }}
                onPointerUp={() => { if (holdSource.current === 'pointer') release(); }}
                onPointerCancel={() => { if (holdSource.current === 'pointer') release(); }}
                onLostPointerCapture={() => { if (holdSource.current === 'pointer') release(); }}>
                <div ref={power} className={`power ${phase === 'charging' ? 'active' : ''}`} aria-hidden="true"/>
                <span><RotateCw size={23} strokeWidth={2.45}/>{phase === 'coasting' ? 'กำลังหมุน…' : phase === 'charging' ? 'ปล่อยเพื่อหมุน' : 'SPIN'}</span>
              </button>
              <p className="spin-hint"><CircleHelp size={16}/>
                {noNames ? 'ใส่อย่างน้อยหนึ่งชื่อเพื่อเริ่มหมุน' : mode === 'hold' ? 'กดค้างเพื่อเร่ง แล้วปล่อยให้วงล้อหมุนต่อ' : 'กด SPIN แล้วรอจนวงล้อหยุด'}
              </p>
            </section>
            <div className="keyboard-hint"><Keyboard size={18}/> <kbd>Space</kbd><span>{mode === 'auto' ? 'เพื่อหมุน' : 'กดค้างเพื่อเร่ง'}</span></div>
          </aside>
        </div>
      </main>
    </div>
  );
}
