'use client';

import { CircleHelp, Keyboard, List, Mouse, Pointer, RotateCcw, RotateCw, Shuffle, SlidersHorizontal, Trophy, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PegAudio } from './audio';
import { appearance, contact, defaultNames, defaults, motion, type Phase, type Settings } from './config';
import { focusedIndex, START_ANGLE, STEP, TAU, wheelSectors, WheelPhysics, type SpinDirection } from './physics';
import { SettingsPanel } from './settings-panel';
import { WheelCanvas } from './wheel-canvas';

const STORAGE = 'lucky-wheel-v1';
const formatChance = new Intl.NumberFormat('th-TH', { style: 'percent', maximumFractionDigits: 2 });
type Mode = 'auto' | 'hold';
const spreads = [
  { label: 'น้อย', ratio: 1.65 },
  { label: 'กลาง', ratio: 4 },
  { label: 'มาก', ratio: 12 },
];
const revealDuration = 1050;
function randomUnit() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

type Saved = { text: string; settings: Settings; mode: Mode; direction: SpinDirection; muted: boolean; weights: number[] | null; spread: number };
const nameLines = (text: string) => text.split(/\r\n?|\n/);
const activeNames = (lines: string[]) => lines.map((entry) => entry.trim()).filter(Boolean);
const percent = (share: number) => share < 0.0001 ? '<0.01%' : formatChance.format(share);

function restore(): Partial<Saved> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? '{}');
    const settings = { ...defaults };
    if (saved.settings?.labelOrientation === 'radial') settings.labelOrientation = 'radial';
    for (const { key, min, max } of [...appearance, ...motion, ...contact]) {
      const value = saved.settings?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) settings[key] = Math.max(min, Math.min(max, value));
    }
    const validColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    if (Array.isArray(saved.settings?.colors) && saved.settings.colors.length === 8 && saved.settings.colors.every(validColor)) {
      settings.colors = saved.settings.colors;
    }
    if (validColor(saved.settings?.pointerColor)) settings.pointerColor = saved.settings.pointerColor;
    const text = typeof saved.text === 'string' ? saved.text : defaultNames;
    const weights = Array.isArray(saved.weights) && saved.weights.length === activeNames(nameLines(text)).length &&
      saved.weights.length > 1 && saved.weights.every((weight: unknown) => typeof weight === 'number' && weight >= 1 && weight <= 12)
      ? saved.weights : null;
    const spread = Number.isInteger(saved.spread) && spreads[saved.spread] ? saved.spread : 1;
    return { text, settings, mode: saved.mode === 'hold' ? 'hold' : 'auto', direction: saved.direction === -1 ? -1 : 1, muted: saved.muted === true, weights, spread };
  } catch {
    return {};
  }
}

export default function Home() {
  const [raw, setRaw] = useState(defaultNames);
  const [settings, setSettings] = useState(defaults);
  const [mode, setMode] = useState<Mode>('auto');
  const [direction, setDirection] = useState<SpinDirection>(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [current, setCurrent] = useState(2);
  const [winner, setWinner] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [edit, setEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [weights, setWeights] = useState<number[] | null>(null);
  const [spread, setSpread] = useState(1);
  const [revealing, setRevealing] = useState(false);
  const [chanceStatus, setChanceStatus] = useState('');

  const physics = useRef<WheelPhysics | null>(null);
  const audio = useRef<PegAudio | null>(null);
  const redraw = useRef<() => void>(() => {});
  const radius = useRef(250);
  const lineDetails = useRef<HTMLDivElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const power = useRef<HTMLDivElement>(null);
  const mutedRef = useRef(muted);
  const button = useRef<HTMLButtonElement>(null);
  const directionButton = useRef<HTMLButtonElement>(null);
  const inputs = useMemo(() => nameLines(raw), [raw]);
  const names = useMemo(() => activeNames(inputs), [inputs]);
  const sectors = useMemo(() => wheelSectors(names.length, weights), [names.length, weights]);
  const liveNames = useRef(names);
  const liveSectors = useRef(sectors);
  const revealTimer = useRef<number | null>(null);
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
    setWeights(saved.weights ?? null);
    setSpread(saved.spread ?? 1);
    setSettings(saved.settings ?? defaults);
    setMode(saved.mode ?? 'auto');
    setDirection(saved.direction ?? 1);
    mutedRef.current = saved.muted ?? false;
    setMuted(mutedRef.current);
    setLoaded(true);
    return () => {
      cancelAnimationFrame(frame.current);
      if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
      audio.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(STORAGE, JSON.stringify({ text: raw, settings, mode, direction, muted, weights, spread })); } catch {}
  }, [raw, settings, mode, direction, muted, weights, spread, loaded]);

  useEffect(() => {
    liveNames.current = names;
    liveSectors.current = sectors;
    liveIndex.current = focusedIndex(physics.current?.angle ?? START_ANGLE, sectors);
    setCurrent(liveIndex.current);
    setWinner(null);
  }, [names, sectors]);

  useEffect(() => { liveSettings.current = settings; }, [settings]);

  const animate = useCallback(function tick(now: number) {
    const wheel = physics.current;
    if (!wheel) return;
    const entries = liveNames.current;
    const config = liveSettings.current;
    accumulator.current += Math.min(0.065, (now - lastTime.current) / 1000);
    lastTime.current = now;
    while (accumulator.current >= STEP && wheel.phase !== 'idle') {
      wheel.step(liveSectors.current, radius.current, config, (strength) => {
        if (!mutedRef.current) audio.current?.tick(strength, config.volume / 100);
      });
      accumulator.current -= STEP;
    }
    redraw.current();
    const index = focusedIndex(wheel.angle, liveSectors.current);
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
    if (!wheel || wheel.phase !== 'idle' || !liveNames.current.length || revealTimer.current !== null) return false;
    if (!mutedRef.current) audio.current?.unlock();
    let target = null;
    const sectors = liveSectors.current;
    if (weights && sectors.length > 1) {
      const sector = sectors[focusedIndex(randomUnit() * TAU, sectors)];
      target = -(sector.center + (randomUnit() - 0.5) * (sector.end - sector.start) * 0.4);
    }
    wheel.start(hold, liveSettings.current, target, direction);
    setWinner(null);
    setPhase(wheel.phase);
    lastTime.current = performance.now();
    accumulator.current = 0;
    frame.current = requestAnimationFrame(animate);
    return true;
  }, [animate, direction, weights]);

  const release = useCallback(() => {
    holdSource.current = null;
    const wheel = physics.current;
    if (wheel?.phase !== 'charging') return;
    wheel.release();
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
  const chanceDisabled = locked || revealing || names.length < 2;
  let colorIndex = 0;
  function changeNames(text: string) {
    const next = activeNames(nameLines(text));
    if (weights && (next.length !== names.length || next.some((name, index) => name !== names[index]))) {
      if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
      setRevealing(false);
      setWeights(null);
      setChanceStatus('รายชื่อเปลี่ยนแล้ว โอกาสกลับมาเท่ากัน');
    }
    setRaw(text);
  }

  function shuffleChances() {
    if (chanceDisabled || revealTimer.current !== null || physics.current?.phase !== 'idle') return;
    const ratio = spreads[spread].ratio;
    const next = names.map((_, index) => ratio ** ((index + randomUnit() * 0.55) / (names.length - 0.45)));
    for (let index = next.length - 1; index > 0; index--) {
      const other = Math.floor(randomUnit() * (index + 1));
      [next[index], next[other]] = [next[other], next[index]];
    }
    setWeights(next);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setChanceStatus('สุ่มโอกาสใหม่แล้ว');
      return;
    }
    setChanceStatus('กำลังเผยเปอร์เซ็นต์');
    setRevealing(true);
    revealTimer.current = window.setTimeout(() => {
      revealTimer.current = null;
      setRevealing(false);
      setChanceStatus('สุ่มโอกาสใหม่แล้ว');
    }, revealDuration + 260);
  }
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
              <WheelCanvas names={names} sectors={sectors} settings={settings} physics={physics} redraw={redraw} radiusRef={radius} directionButton={directionButton}/>
              <button ref={directionButton} type="button" className="direction-button" disabled={locked}
                aria-label="หมุนทวนเข็มนาฬิกา" aria-pressed={direction === -1}
                title={direction === 1 ? 'หมุนตามเข็มนาฬิกา · กดเพื่อสลับทิศ' : 'หมุนทวนเข็มนาฬิกา · กดเพื่อสลับทิศ'}
                onClick={() => setDirection((previous) => previous === 1 ? -1 : 1)}>
                {direction === 1 ? <RotateCw size={24} aria-hidden="true"/> : <RotateCcw size={24} aria-hidden="true"/>}
              </button>
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
              <div className="editor-caption">
                <p id="name-hint">พิมพ์หรือวางชื่อ บรรทัดละหนึ่งชื่อ</p>
                <span aria-hidden="true">โอกาส</span>
              </div>
              <div className={`editor${revealing ? ' is-revealing' : ''}`}>
                <div className="editor-details" aria-hidden="true">
                  <div className="editor-detail-lines" ref={lineDetails}>
                    {inputs.map((entry, index) => {
                      const slot = entry.trim() ? colorIndex++ : -1;
                      return <div className="editor-detail-line" key={index}>
                        {slot >= 0 && <>
                          <i style={{ background: settings.colors[slot % settings.colors.length] }}/>
                          <span className="chance-value" style={revealing ? {
                            animationDelay: `${80 + slot * Math.min(125, (revealDuration - 80) / Math.max(1, names.length - 1))}ms`,
                          } : undefined}>{percent(sectors[slot].share)}</span>
                        </>}
                      </div>;
                    })}
                  </div>
                </div>
                <textarea id="names" aria-describedby="name-hint" wrap="off" spellCheck={false} readOnly={locked} value={raw}
                  placeholder="ใส่รายชื่อที่นี่" onChange={(event) => changeNames(event.target.value)}
                  onScroll={(event) => {
                    if (lineDetails.current) {
                      lineDetails.current.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`;
                    }
                  }}/>
              </div>
              {names.length > 0 && <ul className="live-result" aria-label="โอกาสออกของแต่ละชื่อ">
                {names.map((name, index) => <li key={index}>{name} {percent(sectors[index].share)}</li>)}
              </ul>}
              <div className="chance-controls">
                <div className="chance-heading">
                  <span id="chance-spread">ความต่างของโอกาส</span>
                  {weights && <button className="chance-reset" disabled={locked || revealing} onClick={() => {
                    setWeights(null);
                    setChanceStatus('คืนค่าโอกาสให้เท่ากันแล้ว');
                  }}>คืนค่าเท่ากัน</button>}
                </div>
                <div className="chance-spread" role="group" aria-labelledby="chance-spread">
                  {spreads.map(({ label }, index) => <button key={label} aria-pressed={spread === index} disabled={chanceDisabled}
                    onClick={() => setSpread(index)}>{label}</button>)}
                </div>
                <button className="chance-shuffle" disabled={chanceDisabled} onClick={shuffleChances}>
                  <Shuffle size={17} aria-hidden="true"/>{revealing ? 'กำลังเผยโอกาส…' : 'สุ่มเปอร์เซ็นต์'}
                </button>
                <span className="live-result" role="status">{chanceStatus}</span>
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
              <button ref={button} className="spin" disabled={phase === 'coasting' || noNames || revealing} aria-label={mode === 'hold' ? 'กดค้างเพื่อเร่งวงล้อ' : 'หมุนวงล้อ'}
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
