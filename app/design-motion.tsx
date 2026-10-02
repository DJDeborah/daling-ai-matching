"use client";

import { motion, MotionConfig, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export function MotionScope({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return <motion.div className={className} initial={reduce ? false : { opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }} transition={{ duration: .5, delay, ease: [.22, 1, .36, 1] }}>{children}</motion.div>;
}

export function ConnectionVisual({ compact = false }: { compact?: boolean }) {
  return <div className={`connection-visual${compact ? " compact" : ""}`} aria-hidden="true">
    <div className="connection-orbits"><i/><i/><i/><i/><span className="connection-center">d.</span></div>
    {!compact && <><span className="connection-label label-one">UNDERSTAND</span><span className="connection-label label-two">CONNECT</span></>}
  </div>;
}
