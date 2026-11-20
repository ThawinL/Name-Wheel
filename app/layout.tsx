import type { Metadata } from 'next';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/noto-sans-thai';
import './styles.css';

export const metadata: Metadata = {
  title: 'Lucky Wheel — วงล้อสุ่มชื่อ',
  description: 'วงล้อสุ่มชื่อที่หมุนได้สองแบบ พร้อมฟิสิกส์หมุดและเข็มดีดที่ปรับได้',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="th"><body>{children}</body></html>;
}
