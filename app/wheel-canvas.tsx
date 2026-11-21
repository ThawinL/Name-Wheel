'use client';

import { useLayoutEffect, useRef } from 'react';
import type { Settings } from './config';
import { focusedIndex, START_ANGLE, TAU, type Sector, type WheelPhysics } from './physics';
import {
  PEG_STROKE, PEG_STROKE_THRESHOLD, POINTER_OFFSET, POINTER_STROKE,
  pointerContact, pointerTipAzimuth, pointerTriangle, wheelPegs, type Peg,
} from './pointer-contact';

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

export function WheelCanvas({ names, sectors, settings, physics, redraw, radiusRef, directionButton, onPointedIndex }: {
  names: string[];
  sectors: Sector[];
  settings: Settings;
  physics: React.RefObject<WheelPhysics | null>;
  redraw: React.RefObject<() => void>;
  radiusRef: React.RefObject<number>;
  directionButton: React.RefObject<HTMLButtonElement | null>;
  onPointedIndex: (index: number) => void;
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
    let labelRadii: number[] = [];
    let scale = 1;
    let disposed = false;
    const radialLabels = settings.labelOrientation === 'radial';
    const pointerScale = settings.pointerSize / 100;
    const triangle = pointerTriangle(pointerScale, settings.pegSize);
    let pegs: Peg[] = [];
    let contactSwing = 0;

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
        const angle = rotation + sectors[index].center;
        const x = center + labelRadii[index] * Math.cos(angle);
        const y = centerY + labelRadii[index] * Math.sin(angle);
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
      const pivot = radius + POINTER_OFFSET;
      const springAngle = physics.current?.pointerAngle ?? 0;
      const swing = physics.current?.pointerContactSwing || contactSwing || -Math.sign(physics.current?.velocity ?? 0) || Math.sign(springAngle) || 1;
      const contact = pointerContact(rotation, pivot, pegs, triangle, springAngle, swing);
      contactSwing = contact.touching ? swing : 0;
      onPointedIndex(focusedIndex(rotation - pointerTipAzimuth(pivot, triangle[1], contact.angle), sectors));
      context.translate(center + pivot, centerY);
      context.save();
      context.rotate(contact.angle);
      context.beginPath();
      context.moveTo(triangle[0].x, triangle[0].y);
      context.lineTo(triangle[1].x, triangle[1].y);
      context.lineTo(triangle[2].x, triangle[2].y);
      context.closePath();
      context.lineJoin = 'round';
      context.lineWidth = POINTER_STROKE;
      context.strokeStyle = '#FFFFFF';
      context.stroke();
      context.fillStyle = settings.pointerColor;
      context.fill();
      context.restore();
      circle(0, 0, 10 * pointerScale, INK);
      circle(0, 0, 3.1 * pointerScale, '#FFFFFF');
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
      const available = Math.min(width - margin - 18, height - 8);
      size = Math.max(100, Math.min(available, 590) * settings.wheelSize / 100);
      center = width / 2 - margin / 3;
      centerY = height / 2;
      radius = size / 2 - 2;
      radiusRef.current = radius;
      directionButton.current?.style.setProperty('--direction-x', `${center - (radius + 27) * Math.SQRT1_2}px`);
      directionButton.current?.style.setProperty('--direction-y', `${centerY - (radius + 27) * Math.SQRT1_2}px`);
      pegs = wheelPegs(sectors, radius, settings.pegSize);
      labels = [];
      labelRadii = [];

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
        const outer = radius - Math.max(5, radius * 0.048);
        disk.font = `700 ${settings.fontSize}px "DM Sans Variable", "Noto Sans Thai Variable", sans-serif`;
        const halfHeight = settings.fontSize * 0.7;
        const padding = 5;

        const drawSector = ({ start, end }: Sector, edge: number, color: string) => {
          const overlap = Math.min((end - start) * 0.025, 0.6 / edge);
          disk.beginPath();
          if (names.length > 1) disk.moveTo(0, 0);
          disk.arc(0, 0, edge, start, end + overlap);
          disk.closePath();
          disk.fillStyle = color;
          disk.fill();
        };
        sectors.forEach((sector, index) => {
          drawSector(sector, radius, rimColor(settings.colors[index % settings.colors.length]));
        });
        sectors.forEach((sector, index) => {
          const halfSector = Math.min((sector.end - sector.start) / 2, Math.PI / 2);
          let labelRadius = radius * 0.63;
          let labelWidth = 0;
          if (radialLabels) {
            const inner = Math.max(radius * 0.2, (halfHeight * Math.cos(halfSector) + padding) / Math.sin(halfSector));
            const outerEdge = Math.sqrt(Math.max(0, (outer - padding) ** 2 - halfHeight ** 2));
            labelRadius = (inner + outerEdge) / 2;
            labelWidth = Math.max(0, outerEdge - inner);
          } else {
            const clearance = Math.min(labelRadius * Math.sin(halfSector), outer - labelRadius) - padding;
            labelWidth = clearance > halfHeight ? 2 * Math.sqrt(clearance ** 2 - halfHeight ** 2) : 0;
          }
          labels.push(fitLabel(disk, names[index], labelWidth));
          labelRadii.push(labelRadius);
          drawSector(sector, outer, settings.colors[index % settings.colors.length]);
        });

        for (const { x, y, radius: pegSize } of pegs) {
          const outlined = pegSize >= PEG_STROKE_THRESHOLD;
          disk.beginPath();
          disk.arc(x, y, pegSize, 0, TAU);
          disk.fillStyle = INK;
          disk.fill();
          if (outlined) {
            disk.lineWidth = PEG_STROKE;
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
  }, [names, sectors, settings, physics, redraw, radiusRef, directionButton, onPointedIndex]);

  return <canvas ref={element} className="wheel-canvas" role="img" aria-label={`วงล้อสุ่มชื่อ ${names.length} ช่อง เข็มชี้อยู่ด้านขวา`}/>;
}
