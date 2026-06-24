'use client';

import { useCallback, useRef, useState } from 'react';

interface Props {
  src: string;
  alt: string;
  imgClassName?: string;
  scale?: number;
}

export function ZoomableNotaImage({ src, alt, imgClassName, scale = 2.5 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });

  const updateOrigin = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    setOrigin({
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
    });
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden touch-none select-none cursor-zoom-in"
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') {
          updateOrigin(e.clientX, e.clientY);
          setActive(true);
        }
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setActive(false);
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== 'mouse') {
          e.currentTarget.setPointerCapture(e.pointerId);
          updateOrigin(e.clientX, e.clientY);
          setActive(true);
        }
      }}
      onPointerMove={(e) => {
        if (!active) return;
        updateOrigin(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        if (e.pointerType !== 'mouse') setActive(false);
      }}
      onPointerCancel={() => setActive(false)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        className={`pointer-events-none select-none transition-transform duration-150 ease-out ${imgClassName ?? 'mx-auto w-full object-contain'}`}
        style={{
          transform: active ? `scale(${scale})` : 'scale(1)',
          transformOrigin: `${origin.x}% ${origin.y}%`,
        }}
      />
    </div>
  );
}
