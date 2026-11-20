'use client';

import { useLayoutEffect, useRef } from 'react';
import type { Settings } from './config';
import { START_ANGLE, TAU, type WheelPhysics } from './physics';

const INK = '#15243C';
const segmenter = new Intl.Segmenter('th', { granularity: 'grapheme' });

function rimColor(color: string) {
  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(color.slice(offset, offset + 2), 16);
    return Math.round(channel + (255 - channel) * 0.55);
  });
  return `rgb(${channels.join(', ')})`;
}

function fitLabel(context: CanvasRenderingContext2D, label: string, width: number) {
  if (context.measureText(label).width <= width) return label;
  if (context.measureText('…').width > width) return '';
  const groups: string[] = [];
  for (const { segment } of segmenter.segment(label)) {
    if (/^[เแโใไ]$/u.test(groups.at(-1) ?? '') && /^\p{Script=Thai}/u.test(segment)) {
      groups[groups.length - 1] += segment;
    } else {
      groups.push(segment);
    }
  }
  let first = 0;
  let last = groups.length;
  while (first < last) {
    const middle = Math.ceil((first + last) / 2);
    if (context.measureText(groups.slice(0, middle).join('').trimEnd() + '…').width <= width) first = middle;
    else last = middle - 1;
  }
  return groups.slice(0, first).join('').trimEnd() + '…';
}

export function WheelCanvas({ names, settings, physics, redraw, radiusRef }: {
  names: string[];
  settings: Settings;
  physics: React.RefObject<WheelPhysics | null>;
  redraw: React.RefObject<() => void>;
  radiusRef: React.RefObject<number>;
}) {
  const element = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLCanvasElement | null>(null);

  useLayoutEffect(() => {
    const canvas = element.current!;
    const context = canvas.getContext('2d')!;
    const face = layer.current ??= document.createElement('canvas');
    const disk = face.getContext('2d')!;
    let size = 0;
    let margin = 0;
    let center = 0;
    let centerY = 0;
    let radius = 0;
    let labels: string[] = [];
    let labelRadius = 0;
    let scale = 1;
    let disposed = false;
    const radialLabels = settings.labelOrientation === 'radial';
    const pointerScale = settings.pointerSize / 100;

    const paint = () => {
      if (!size) return;
      context.clearRect(0, 0, canvas.width / scale, canvas.height / scale);
      context.save();
      context.translate(center, centerY);
      const rotation = physics.current?.angle ?? START_ANGLE;
      context.rotate(rotation);
      context.drawImage(face, -size / 2, -size / 2, size, size);
      context.restore();

      context.font = `700 ${settings.fontSize}px "DM Sans Variable", "Noto Sans Thai Variable", sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = INK;
      labels.forEach((label, index) => {
        if (!label) return;
        const angle = rotation + index * TAU / labels.length;
        const x = center + labelRadius * Math.cos(angle);
        const y = centerY + labelRadius * Math.sin(angle);
        if (radialLabels) {
          context.save();
          context.translate(x, y);
          context.rotate(angle);
          context.fillText(label, 0, 0);
          context.restore();
        } else {
          context.fillText(label, x, y);
        }
      });

      const circle = (x: number, y: number, r: number, color: string) => {
        context.beginPath();
        context.arc(x, y, r, 0, TAU);
        context.fillStyle = color;
        context.fill();
      };
      circle(center, centerY, radius * 0.112, INK);
      circle(center, centerY, radius * 0.098, '#FFFFFF');
      circle(center, centerY, radius * 0.029, '#D0D9E7');

      context.save();
      context.translate(center + radius + 10, centerY);
      context.scale(pointerScale, pointerScale);
      const flex = Math.max(-0.68, Math.min(0.68, physics.current?.flex ?? 0));
      const length = 23 + (13 + settings.pegSize) / pointerScale;
      const tipX = -length + Math.abs(flex) * 12;
      const tipY = length * Math.sin(flex);
      context.beginPath();
      context.moveTo(2, -12);
      context.quadraticCurveTo(-14, -10, tipX, tipY);
      context.quadraticCurveTo(-17, tipY * 0.5 + 15, 2, 12);
      context.closePath();
      context.lineJoin = 'round';
      context.lineWidth = 4 / pointerScale;
      context.strokeStyle = '#FFFFFF';
      context.stroke();
      context.fillStyle = settings.pointerColor;
      context.fill();
      circle(1, 0, 10, INK);
      circle(1, 0, 3.1, '#FFFFFF');
      context.restore();
    };

    function build() {
      if (disposed) return;
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      scale = Math.min(2, window.devicePixelRatio || 1);
      const width = bounds.width;
      const height = bounds.height;
      margin = width < 450 ? 28 : 42;
      const available = Math.min(width - margin - 10, height - 8);
      size = Math.max(100, Math.min(available, 590) * settings.wheelSize / 100);
      center = width / 2 - margin / 3;
      centerY = height / 2;
      radius = size / 2 - 2;
      radiusRef.current = radius;
      labels = [];

      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      face.width = Math.round(size * scale);
      face.height = Math.round(size * scale);
      disk.setTransform(face.width / size, 0, 0, face.height / size, 0, 0);
      disk.translate(size / 2, size / 2);

      disk.beginPath();
      disk.arc(0, 0, radius, 0, TAU);
      disk.fillStyle = '#E9EDF4';
      disk.fill();

      if (names.length) {
        const sector = TAU / names.length;
        const pegRing = radius - 11;
        const outer = radius - Math.max(5, radius * 0.048);
        labelRadius = radius * 0.63;
        const pegSize = Math.min(settings.pegSize, 0.34 * sector * pegRing);
        disk.font = `700 ${settings.fontSize}px "DM Sans Variable", "Noto Sans Thai Variable", sans-serif`;
        const halfSector = Math.min(sector / 2, Math.PI / 2);
        const halfHeight = settings.fontSize * 0.7;
        const padding = 5;
        let labelWidth = 0;
        if (radialLabels) {
          // Fit the label rectangle between the sector edges and the outer rim.
          const inner = Math.max(radius * 0.2, (halfHeight * Math.cos(halfSector) + padding) / Math.sin(halfSector));
          const outerEdge = Math.sqrt(Math.max(0, (outer - padding) ** 2 - halfHeight ** 2));
          labelRadius = (inner + outerEdge) / 2;
          labelWidth = Math.max(0, outerEdge - inner);
        } else {
          // Fit a horizontal label inside the sector through a full revolution.
          const sectorClearance = labelRadius * Math.sin(halfSector);
          const clearance = Math.min(sectorClearance, outer - labelRadius) - padding;
          labelWidth = clearance > halfHeight ? 2 * Math.sqrt(clearance ** 2 - halfHeight ** 2) : 0;
        }

        const drawSector = (index: number, edge: number, color: string) => {
          const angle = index * sector - sector / 2;
          const overlap = Math.min(sector * 0.025, 0.6 / edge);
          disk.beginPath();
          if (names.length > 1) disk.moveTo(0, 0);
          disk.arc(0, 0, edge, angle, angle + sector + overlap);
          disk.closePath();
          disk.fillStyle = color;
          disk.fill();
        };
        names.forEach((_, index) => {
          drawSector(index, radius, rimColor(settings.colors[index % settings.colors.length]));
        });
        names.forEach((name, index) => {
          labels.push(fitLabel(disk, name, labelWidth));
          drawSector(index, outer, settings.colors[index % settings.colors.length]);
        });

        for (let index = 0; index < names.length; index++) {
          const boundary = (index - 0.5) * sector;
          disk.beginPath();
          disk.arc(pegRing * Math.cos(boundary), pegRing * Math.sin(boundary), pegSize, 0, TAU);
          disk.fillStyle = INK;
          disk.fill();
          if (pegSize >= 2.8) {
            disk.lineWidth = 1.2;
            disk.strokeStyle = '#FFFFFF';
            disk.stroke();
          }
        }
      }

      paint();
    }

    redraw.current = paint;
    build();
    const observer = new ResizeObserver(build);
    observer.observe(canvas);
    window.addEventListener('resize', build);
    void document.fonts.ready.then(build);
    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener('resize', build);
      if (redraw.current === paint) redraw.current = () => {};
    };
  }, [names, settings, physics, redraw, radiusRef]);

  return <canvas ref={element} className="wheel-canvas" role="img" aria-label={`วงล้อสุ่มชื่อ ${names.length} ช่อง เข็มชี้อยู่ด้านขวา`}/>;
}
