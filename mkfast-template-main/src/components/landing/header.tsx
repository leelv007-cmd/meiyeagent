import {
  motion,
  AnimatePresence,
  useScroll,
  useMotionValueEvent,
} from 'motion/react';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import {
  landing_a11y_logo_home,
  landing_a11y_menu_close,
  landing_a11y_menu_open,
  landing_a11y_nav_mobile,
  landing_a11y_nav_primary,
  landing_nav_brand,
  landing_nav_faq,
  landing_nav_features,
  landing_nav_login,
  landing_nav_logo_alt,
  landing_nav_pricing,
  landing_nav_register,
  landing_nav_showcase,
} from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';

export function Header(): ReactNode {
  const navLinks = [
    { href: '#features', label: landing_nav_features() },
    { href: '#showcase', label: landing_nav_showcase() },
    { href: '#pricing', label: landing_nav_pricing() },
    { href: '#faq', label: landing_nav_faq() },
  ];

  const authLinks = [
    { to: Routes.Login, label: landing_nav_login() },
    { to: Routes.Register, label: landing_nav_register() },
  ];

  const [isOpen, setIsOpen] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, 'change', (latest) => {
    const previous = scrollY.getPrevious() ?? 0;

    if (latest > previous && latest > 50) {
      setIsHidden(true);
    } else {
      setIsHidden(false);
    }
    setIsScrolled(latest > 50);
  });

  const toggleMenu = () => setIsOpen(!isOpen);
  const closeMenu = () => setIsOpen(false);

  // mix-blend-difference turns blue over the amber backdrop, so the header
  // adapts by scroll state instead: hero-top rides the same tones as the H1
  // (foreground on the high-key light hero, background-dark on the flipped
  // dark hero), scrolled gets a glass bar with text-foreground, open menu is
  // always dark bronze so text goes white.
  const overHero = !isScrolled && !isOpen;
  const textTone = isOpen
    ? 'text-white'
    : overHero
      ? 'text-foreground dark:text-background'
      : 'text-foreground';
  const hoverTone = isOpen
    ? 'hover:bg-white/10'
    : overHero
      ? 'hover:bg-foreground/10 dark:hover:bg-background/10'
      : 'hover:bg-foreground/10';
  const logoFilter = isOpen ? '' : overHero ? 'invert' : 'invert dark:invert-0';
  const barTone =
    isScrolled && !isOpen
      ? 'border-b border-border/50 bg-background/70 backdrop-blur-md'
      : '';

  return (
    <>
      <div
        className="pointer-events-none fixed top-0 left-0 z-40 h-32 w-full"
        style={{
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          maskImage:
            'linear-gradient(to bottom, black 0%, black 20%, rgba(0,0,0,0.8) 40%, rgba(0,0,0,0.4) 60%, rgba(0,0,0,0.1) 80%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, black 0%, black 20%, rgba(0,0,0,0.8) 40%, rgba(0,0,0,0.4) 60%, rgba(0,0,0,0.1) 80%, transparent 100%)',
        }}
        aria-hidden="true"
      />

      <motion.header
        className={`fixed top-0 z-50 w-full transition-colors duration-300 ${barTone}`}
        initial={{ y: -20, opacity: 0, filter: 'blur(10px)' }}
        animate={{
          y: isHidden && !isOpen ? '-100%' : 0,
          opacity: 1,
          filter: isHidden && !isOpen ? 'blur(8px)' : 'blur(0px)',
        }}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <div className="mx-auto flex h-24 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.1,
              ease: [0.25, 0.46, 0.45, 0.94],
            }}
          >
            <Link
              to={Routes.Root}
              className="focus-ring flex items-center gap-2"
              aria-label={landing_a11y_logo_home()}
            >
              <img
                src="/landing/logo.svg"
                alt={landing_nav_logo_alt()}
                width={36}
                height={36}
                className={`h-8 w-auto ${logoFilter}`}
              />
              <span
                className={`text-lg font-semibold tracking-tight ${textTone}`}
              >
                {landing_nav_brand()}
              </span>
            </Link>
          </motion.div>

          <nav
            className="hidden items-center gap-3 lg:flex"
            aria-label={landing_a11y_nav_primary()}
          >
            {navLinks.map((link, index) => (
              <motion.div
                key={link.href}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.4,
                  delay: 0.15 + index * 0.05,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
              >
                <a
                  href={link.href}
                  className={`focus-ring rounded-md px-2.5 py-1 font-medium transition-colors ${textTone} ${hoverTone}`}
                >
                  {link.label}
                </a>
              </motion.div>
            ))}

            <motion.div
              className={`mx-4 h-px w-5 bg-current opacity-30 ${textTone}`}
              role="separator"
              aria-orientation="vertical"
              initial={{ opacity: 0, scaleX: 0 }}
              animate={{ opacity: 1, scaleX: 1 }}
              transition={{ duration: 0.4, delay: 0.4, ease: 'easeOut' }}
            />

            {authLinks.map((link, index) => (
              <motion.div
                key={link.label}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.4,
                  delay: 0.45 + index * 0.05,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
              >
                <Link
                  to={link.to}
                  className={`focus-ring rounded-md px-2.5 py-1 font-medium transition-colors ${textTone} ${hoverTone}`}
                >
                  {link.label}
                </Link>
              </motion.div>
            ))}
          </nav>

          <button
            type="button"
            onClick={toggleMenu}
            className={`focus-ring relative flex h-10 w-10 items-center justify-center lg:hidden ${textTone}`}
            aria-label={
              isOpen ? landing_a11y_menu_close() : landing_a11y_menu_open()
            }
            aria-expanded={isOpen}
          >
            <span className="sr-only">
              {isOpen ? landing_a11y_menu_close() : landing_a11y_menu_open()}
            </span>
            <span
              className={`absolute h-0.5 w-5 bg-current transition-transform duration-300 ${
                isOpen ? 'rotate-45' : 'rotate-0'
              }`}
            />
            <span
              className={`absolute h-5 w-0.5 bg-current transition-transform duration-300 ${
                isOpen ? 'rotate-45' : 'rotate-0'
              }`}
            />
          </button>
        </div>
      </motion.header>

      <AnimatePresence mode="sync">
        {isOpen && (
          <motion.div
            key="mobile-menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-[#2A1B10]/95 backdrop-blur-xl lg:hidden"
          >
            <nav
              className="mx-auto flex h-full max-w-7xl flex-col items-start gap-4 px-4 pt-32 sm:px-6"
              aria-label={landing_a11y_nav_mobile()}
            >
              {navLinks.map((link, index) => (
                <motion.div
                  key={link.href}
                  initial={{ opacity: 0, x: -40, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  transition={{
                    duration: 0.4,
                    delay: 0.05 + index * 0.08,
                    ease: [0.25, 0.46, 0.45, 0.94],
                  }}
                >
                  <a
                    href={link.href}
                    onClick={closeMenu}
                    className="focus-ring block text-6xl text-white transition-colors hover:text-white sm:text-6xl"
                  >
                    {link.label}
                  </a>
                </motion.div>
              ))}

              <motion.div
                initial={{ opacity: 0, scaleX: 0 }}
                animate={{ opacity: 1, scaleX: 1 }}
                transition={{ duration: 0.5, delay: 0.4, ease: 'easeOut' }}
                className="my-4 h-px w-20 origin-left bg-white/30"
                role="separator"
              />

              {authLinks.map((link, index) => (
                <motion.div
                  key={link.label}
                  initial={{ opacity: 0, x: -40, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  transition={{
                    duration: 0.4,
                    delay: 0.45 + index * 0.08,
                    ease: [0.25, 0.46, 0.45, 0.94],
                  }}
                >
                  <Link
                    to={link.to}
                    onClick={closeMenu}
                    className="focus-ring block text-6xl text-white transition-colors hover:text-white sm:text-6xl"
                  >
                    {link.label}
                  </Link>
                </motion.div>
              ))}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
