'use client';

import { useRef } from 'react';
import {
  motion,
  useScroll,
  useTransform,
  useMotionTemplate,
  useReducedMotion,
  type Variants,
} from 'motion/react';

/* ------------------------------------------------------------------ */
/*  ORCA landing — static hero visual system                          */
/*  Fixed orca layer · content scrolls over · glass → solid release   */
/* ------------------------------------------------------------------ */

/* Hero headline — fade up 16px, staggered by line */
const heroLine: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, delay: 0.1 + i * 0.12, ease: [0.22, 1, 0.36, 1] },
  }),
};

const revealUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

const BASE = '#FBFCFE';

export default function LandingPage() {
  const reduce = useReducedMotion();
  const disableAnim = !!reduce;

  /* Fixed orca layer opacity 100% → 40% over first 1.5 viewport heights */
  const mainRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: mainRef,
    offset: ['start start', '150vh end'],
  });
  const orcaOpacity = useTransform(scrollYProgress, [0, 1], [1, 0.4]);
  const blurPx = useTransform(scrollYProgress, [0, 1], [0, 6]);
  const orcaFilter = useMotionTemplate`blur(${blurPx}px)`;

  return (
    <main ref={mainRef} className="orca-landing" aria-label="ORCA landing page">
      {/* ───────────────────────── Hero ───────────────────────── */}
      <section className="hero">
        {/* Fixed orca backdrop */}
        <motion.div
          className="orca-fixed-layer"
          aria-hidden
          style={
            disableAnim ? undefined : { opacity: orcaOpacity, filter: orcaFilter }
          }
        >
          <div className="orca-image-preload" />
        </motion.div>

        {/* Hero copy */}
        <div className="hero-copy">
          <motion.span
            className="hero-eyebrow"
            custom={0}
            variants={heroLine}
            initial={disableAnim ? false : 'hidden'}
            animate="visible"
          >
            ORCA · MUSIC INTELLIGENCE
          </motion.span>

          <h1 className="hero-headline">
            {['The shape of', 'your taste.'].map((line, i) => (
              <motion.span
                key={line}
                custom={i + 1}
                variants={heroLine}
                initial={disableAnim ? false : 'hidden'}
                animate="visible"
                className="hero-headline-line"
              >
                {line}
              </motion.span>
            ))}
          </h1>

          <motion.p
            className="hero-sub"
            custom={3}
            variants={heroLine}
            initial={disableAnim ? false : 'hidden'}
            animate="visible"
          >
            A living procedural music galaxy, built from canonical metadata —
            your listening mapped as a single orca.
          </motion.p>

          <motion.div
            className="hero-cta-wrap"
            custom={4}
            variants={heroLine}
            initial={disableAnim ? false : 'hidden'}
            animate="visible"
          >
            <SpringButton href="/auth/connect">Enter the universe</SpringButton>
          </motion.div>
        </div>
      </section>

      {/* ───────────────────── Content scrolling over the orca ───────────────────── */}
      <Panel
        title="One galaxy. Every artist you've ever loved."
        body="ORCA reads canonical music metadata and arranges the whole of recorded music as a single spatial structure. Your taste places you somewhere in it — and that somewhere is a whale, swimming through the catalog."
      />
      <Panel
        title="Taste as position, not playlist."
        body="No top-40 list can tell you what you are. A map can. Related artists cluster near you; the frontier opens where your listening hasn't gone yet — visible as open water ahead of the whale."
      />
      <Panel
        title="Where the water breaks."
        body="Each artist is one point. Genres are currents. The orca rises through the catalog along the line of your own listening — head toward where you've been, dorsal fin at the depth you know best, tail fading into what you've forgotten."
      />

      {/* ───────────────────────── Final CTA — true white ───────────────────────── */}
      <section className="panel panel-final">
        <motion.h2 initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.4 }} variants={revealUp} className="final-title">
          Find your orca.
        </motion.h2>
        <motion.p initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.4 }} variants={revealUp} className="final-body">
          Connect your library. The whale surfaces where your listening lives.
        </motion.p>
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.4 }} variants={revealUp} className="final-cta-wrap">
          <SpringButton href="/auth/connect">Begin</SpringButton>
        </motion.div>
      </section>

      <footer className="landing-footer">
        <span className="footer-mark">ORCA</span>
        <span className="footer-meta">Music intelligence · Reykjavík</span>
      </footer>
    </main>
  );
}

/* ───────────────────────── Panel with glass → solid release ───────────────────────── */
function Panel({ title, body }: { title: string; body: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);

  /* Background: transparent (revealing orca beneath) → solid base at ~30% into viewport */
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'start 70%'],
  });
  const bgAlpha = useTransform(scrollYProgress, [0, 1], [0, 1]);
  const bgColor = useOpacityBackground(bgAlpha);
  const panelStyle = reduce ? undefined : { backgroundColor: bgColor };

  const revealGroup: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.08 } },
  };

  return (
    <motion.section
      ref={ref}
      className="panel"
      style={panelStyle}
      variants={revealGroup}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.3 }}
    >
      <motion.h2 variants={revealUp} className="section-title">
        {title}
      </motion.h2>
      <motion.p variants={revealUp} className="section-body">
        {body}
      </motion.p>
    </motion.section>
  );
}

/* CTA with spring physics on hover/active */
function SpringButton({
  href,
  children,
}: Readonly<{ href: string; children: React.ReactNode }>) {
  const reduce = useReducedMotion();
  const disable = !!reduce;
  return (
    <motion.a
      href={href}
      className="cta-primary"
      whileHover={disable ? undefined : { scale: 1.04, y: -1 }}
      whileTap={disable ? undefined : { scale: 0.98, y: 1 }}
      transition={disable ? undefined : { type: 'spring', stiffness: 300, damping: 20 }}
    >
      {children}
    </motion.a>
  );
}

/* Build an rgba string from base hex + a MotionValue alpha.
   Declared as a hook (use*) so it satisfies rules-of-hooks. */
function useOpacityBackground(
  alpha: ReturnType<typeof useTransform<number, number>>,
) {
  const r = parseInt(BASE.slice(1, 3), 16);
  const g = parseInt(BASE.slice(3, 5), 16);
  const b = parseInt(BASE.slice(5, 7), 16);
  return useMotionTemplate`rgba(${r}, ${g}, ${b}, ${alpha})`;
}
