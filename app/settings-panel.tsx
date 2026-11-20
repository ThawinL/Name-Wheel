'use client';

import { RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import { appearance, contact, defaults, motion, type Settings } from './config';

export function SettingsPanel({ values, onChange, onClose, locked }: {
  values: Settings;
  onChange: (settings: Settings) => void;
  onClose: () => void;
  locked: boolean;
}) {
  const [tab, setTab] = useState<'appearance' | 'motion' | 'contact'>('appearance');
  const sliders = { appearance, motion, contact }[tab];
  return (
    <section className="settings-popover" id="wheel-settings" aria-label="ตั้งค่าต้นแบบ"
      onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <div className="settings-heading">
        <div className="heading-icon"><SlidersHorizontal size={19}/></div>
        <div><h2>ตั้งค่าวงล้อ</h2><p>ปรับค่าแล้วลองหมุนได้ทันที</p></div>
        <button className="icon-btn close-settings" onClick={onClose} aria-label="ปิดการตั้งค่า"><X size={20}/></button>
      </div>
      <fieldset disabled={locked}>
        <div className="settings-tabs" aria-label="หมวดการตั้งค่า">
          <button aria-pressed={tab === 'appearance'} onClick={() => setTab('appearance')}>รูปลักษณ์</button>
          <button aria-pressed={tab === 'motion'} onClick={() => setTab('motion')}>การหมุน</button>
          <button aria-pressed={tab === 'contact'} onClick={() => setTab('contact')}>เข็มและเสียง</button>
        </div>
        <div className="sliders">
          {tab === 'appearance' && <label className="slider">
            <span>ทิศทางตัวอักษร</span>
            <select value={values.labelOrientation} onChange={(event) => onChange({
              ...values,
              labelOrientation: event.target.value === 'radial' ? 'radial' : 'upright',
            })}>
              <option value="upright">อ่านจากด้านบนเสมอ</option>
              <option value="radial">หมุนตามวงล้อ</option>
            </select>
          </label>}
          {sliders.map(({ key, label, min, max, step, unit }) =>
            <label className="slider" key={key}>
              <span>{label}<output>{values[key]}{unit}</output></span>
              <input type="range" min={min} max={max} step={step} value={values[key]}
                onChange={(event) => onChange({ ...values, [key]: event.target.valueAsNumber })}/>
            </label>
          )}
        </div>
        {tab === 'appearance' && <div className="colors">
          <span>สีช่องรายชื่อ</span>
          <div className="swatches">{values.colors.map((color, index) =>
            <input key={index} type="color" value={color} aria-label={`สีช่องที่ ${index + 1}`}
              onChange={(event) => onChange({ ...values, colors: values.colors.map((value, i) => i === index ? event.target.value : value) })}/>
          )}</div>
          <label className="pointer-color">สีเข็ม<input type="color" value={values.pointerColor}
            onChange={(event) => onChange({ ...values, pointerColor: event.target.value })}/></label>
        </div>}
        <button className="reset-settings" onClick={() => onChange(defaults)}><RotateCcw size={15}/> คืนค่าเริ่มต้น</button>
      </fieldset>
      {locked && <p className="settings-lock">ปรับค่าได้เมื่อวงล้อหยุด</p>}
    </section>
  );
}
