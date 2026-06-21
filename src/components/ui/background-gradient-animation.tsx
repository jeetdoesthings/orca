'use client';

import React, { useEffect, useRef, useState } from 'react';

const cn = (...classes: (string | undefined | null | boolean)[]) => classes.filter(Boolean).join(' ');

interface BackgroundGradientAnimationProps {
  children?: React.ReactNode;
  className?: string;
  containerClassName?: string;
  gradientBackgroundStart?: string;
  gradientBackgroundEnd?: string;
  firstColor?: string;
  secondColor?: string;
  thirdColor?: string;
  fourthColor?: string;
  fifthColor?: string;
  pointerColor?: string;
  size?: string;
  blendingValue?: string;
  interactive?: boolean;
}

export const BackgroundGradientAnimation = ({
  children,
  className,
  containerClassName,
  gradientBackgroundStart = 'rgb(255, 255, 255)',
  gradientBackgroundEnd = 'rgb(243, 244, 246)',
  firstColor = '220, 225, 230',
  secondColor = '200, 205, 210',
  thirdColor = '235, 238, 240',
  fourthColor = '215, 218, 222',
  fifthColor = '225, 228, 230',
  pointerColor = '200, 200, 200',
  size = '80%',
  blendingValue = 'multiply',
  interactive = true,
}: BackgroundGradientAnimationProps) => {
  const interactiveRef = useRef<HTMLDivElement>(null);

  const [curX, setCurX] = useState(0);
  const [curY, setCurY] = useState(0);
  const [tgX, setTgX] = useState(0);
  const [tgY, setTgY] = useState(0);

  useEffect(() => {
    document.body.style.setProperty('--gradient-background-start', gradientBackgroundStart);
    document.body.style.setProperty('--gradient-background-end', gradientBackgroundEnd);
    document.body.style.setProperty('--first-color', firstColor);
    document.body.style.setProperty('--second-color', secondColor);
    document.body.style.setProperty('--third-color', thirdColor);
    document.body.style.setProperty('--fourth-color', fourthColor);
    document.body.style.setProperty('--fifth-color', fifthColor);
    document.body.style.setProperty('--pointer-color', pointerColor);
    document.body.style.setProperty('--size', size);
    document.body.style.setProperty('--blending-value', blendingValue);
  }, [
    gradientBackgroundStart,
    gradientBackgroundEnd,
    firstColor,
    secondColor,
    thirdColor,
    fourthColor,
    fifthColor,
    pointerColor,
    size,
    blendingValue,
  ]);
  useEffect(() => {
    const handleGlobalMouseMove = (event: MouseEvent) => {
      setTgX(event.clientX);
      setTgY(event.clientY);
    };
    window.addEventListener('mousemove', handleGlobalMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    function move() {
      if (!interactiveRef.current || cancelled) {
        return;
      }
      setCurX((prevX) => prevX + (tgX - prevX) / 20);
      setCurY((prevY) => prevY + (tgY - prevY) / 20);
      interactiveRef.current.style.transform = `translate(${Math.round(curX)}px, ${Math.round(curY)}px)`;
    }

    let animationFrameId = requestAnimationFrame(function loop() {
      move();
      if (!cancelled) {
        animationFrameId = requestAnimationFrame(loop);
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrameId);
    };
  }, [tgX, tgY, curX, curY]);

  const [isSafari, setIsSafari] = useState(false);
  useEffect(() => {
    setIsSafari(/^((?!chrome|android).)*safari/i.test(navigator.userAgent));
  }, []);

  return (
    <div
      className={cn(
        'absolute inset-0 -z-10 overflow-hidden bg-[radial-gradient(circle_at_top_left,var(--gradient-background-start),var(--gradient-background-end))] pointer-events-none select-none',
        containerClassName
      )}
    >
      <svg className="hidden">
        <defs>
          <filter id="blurMini">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8"
              result="goo"
            />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
      </svg>
      <div className={cn('absolute inset-0 [filter:blur(40px)_none] pointer-events-none', isSafari ? 'blur-2xl' : '[filter:url(#blurMini)_blur(40px)]')}>
        <div
          className="absolute [background:radial-gradient(circle_at_center,rgba(var(--first-color),0.45)_0,rgba(var(--first-color),0)_50%)_no-repeat] [mix-blend-mode:var(--blending-value)] left-[calc(50%-var(--size)/2)] top-[calc(50%-var(--size)/2)] h-[var(--size)] w-[var(--size)] [transform-origin:center_center] animate-first"
        ></div>
        <div
          className="absolute [background:radial-gradient(circle_at_center,rgba(var(--second-color),0.45)_0,rgba(var(--second-color),0)_50%)_no-repeat] [mix-blend-mode:var(--blending-value)] left-[calc(50%-var(--size)/2)] top-[calc(50%-var(--size)/2)] h-[var(--size)] w-[var(--size)] [transform-origin:center_center] animate-second"
        ></div>
        <div
          className="absolute [background:radial-gradient(circle_at_center,rgba(var(--third-color),0.45)_0,rgba(var(--third-color),0)_50%)_no-repeat] [mix-blend-mode:var(--blending-value)] left-[calc(50%-var(--size)/2)] top-[calc(50%-var(--size)/2)] h-[var(--size)] w-[var(--size)] [transform-origin:center_center] animate-third"
        ></div>
        <div
          className="absolute [background:radial-gradient(circle_at_center,rgba(var(--fourth-color),0.45)_0,rgba(var(--fourth-color),0)_50%)_no-repeat] [mix-blend-mode:var(--blending-value)] left-[calc(50%-var(--size)/2)] top-[calc(50%-var(--size)/2)] h-[var(--size)] w-[var(--size)] [transform-origin:center_center] animate-fourth"
        ></div>
        <div
          className="absolute [background:radial-gradient(circle_at_center,rgba(var(--fifth-color),0.45)_0,rgba(var(--fifth-color),0)_50%)_no-repeat] [mix-blend-mode:var(--blending-value)] left-[calc(50%-var(--size)/2)] top-[calc(50%-var(--size)/2)] h-[var(--size)] w-[var(--size)] [transform-origin:center_center] animate-fifth"
        ></div>

        {interactive && (
          <div
            ref={interactiveRef}
            className="absolute [background:radial-gradient(circle_at_center,rgba(var(--pointer-color),0.5)_0,rgba(var(--pointer-color),0)_50%)_no-repeat] [mix-blend-mode:var(--blending-value)] left-[-250px] top-[-250px] h-[500px] w-[500px] opacity-70"
          ></div>
        )}
      </div>
      {children && <div className={cn('pointer-events-auto', className)}>{children}</div>}
    </div>
  );
};
