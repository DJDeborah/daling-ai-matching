"use client";

import { motion, MotionConfig, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Link2, Search } from "lucide-react";

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

export function MatchSearchTransition() {
  const reduce = useReducedMotion();
  return <section className="match-search" role="status" aria-live="polite"><img className="search-doodle" src="/illustrations/korean-connect-doodle.png" alt=""/><div className="search-symbol" aria-hidden="true"><motion.div className="search-orbit" animate={reduce ? undefined : { rotate: 360 }} transition={{ duration: 5, repeat: Infinity, ease: "linear" }}><span/><span/></motion.div><motion.div animate={reduce ? undefined : { scale: [1, 1.08, 1] }} transition={{ duration: 1.8, repeat: Infinity }}><Search size={30}/></motion.div></div><p className="section-kicker">FINDING YOUR CONNECTIONS</p><h2>把相符的细节，连接起来。</h2><p>正在比较已聊到的兴趣、相处方式和期待。</p><div className="search-steps"><span>整理你的回答</span><Link2 size={16}/><span>寻找相符档案</span></div></section>;
}
