import { motion, type HTMLMotionProps } from 'framer-motion';

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Subtle entrance for pages and panels: 6px rise + fade, fast enough not to slow work down. */
export function FadeIn({ delay = 0, ...props }: HTMLMotionProps<'div'> & { delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE, delay }}
      {...props}
    />
  );
}

/** Staggers direct <StaggerItem> children (e.g. dashboard cards). */
export function Stagger(props: HTMLMotionProps<'div'>) {
  return <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.045 } } }} {...props} />;
}

export function StaggerItem(props: HTMLMotionProps<'div'>) {
  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE } } }}
      {...props}
    />
  );
}
