export const palette = ['#F45B69', '#FF9F43', '#FFD93D', '#62C96B', '#35C9C1', '#4D96FF', '#9675FA', '#FF82BD'];

export const defaultNames = ['มะลิ', 'ภูผา', 'ใบเตย', 'ออมสิน', 'ต้นกล้า', 'น้ำใส', 'ตะวัน', 'ข้าวหอม'].join('\n');

export type LabelOrientation = 'upright' | 'radial';

export const defaults = {
  wheelSize: 92,
  fontSize: 19,
  labelOrientation: 'upright' as LabelOrientation,
  pegSize: 4,
  pointerSize: 100,
  launch: 28,
  acceleration: 16,
  maxSpeed: 36,
  friction: 1.35,
  drag: 0.38,
  impact: 1,
  stiffness: 14,
  damping: 13,
  volume: 35,
  colors: palette,
  pointerColor: '#246BFD',
};

export type Settings = typeof defaults;
export type Phase = 'idle' | 'charging' | 'coasting';

type Slider = { key: Exclude<keyof Settings, 'colors' | 'pointerColor' | 'labelOrientation'>; label: string; min: number; max: number; step: number; unit?: string };
export const appearance: Slider[] = [
  { key: 'wheelSize', label: 'ขนาดวงล้อ', min: 60, max: 100, step: 1, unit: '%' },
  { key: 'fontSize', label: 'ขนาดตัวอักษร', min: 12, max: 30, step: 1, unit: ' px' },
  { key: 'pegSize', label: 'ขนาดหมุด', min: 2, max: 9, step: 0.5, unit: ' px' },
  { key: 'pointerSize', label: 'ขนาดเข็ม', min: 65, max: 135, step: 1, unit: '%' },
];
export const motion: Slider[] = [
  { key: 'launch', label: 'ความเร็วเริ่มต้น', min: 10, max: 48, step: 1, unit: ' rad/s' },
  { key: 'acceleration', label: 'แรงเร่งเมื่อกดค้าง', min: 4, max: 34, step: 1, unit: ' rad/s²' },
  { key: 'maxSpeed', label: 'ความเร็วสูงสุดเมื่อกดค้าง', min: 15, max: 56, step: 1, unit: ' rad/s' },
  { key: 'friction', label: 'แรงเสียดทานแกน', min: 0.45, max: 4, step: 0.05, unit: ' rad/s²' },
  { key: 'drag', label: 'แรงหน่วงตามความเร็ว', min: 0.1, max: 0.85, step: 0.01, unit: ' s⁻¹' },
];
export const contact: Slider[] = [
  { key: 'impact', label: 'แรงกระทบหมุด', min: 0.25, max: 2, step: 0.05, unit: '×' },
  { key: 'stiffness', label: 'ความแข็งของเข็ม', min: 8, max: 23, step: 1, unit: ' Hz' },
  { key: 'damping', label: 'การซับแรงสั่น', min: 6, max: 32, step: 1, unit: ' s⁻¹' },
  { key: 'volume', label: 'ระดับเสียง', min: 0, max: 100, step: 1, unit: '%' },
];
