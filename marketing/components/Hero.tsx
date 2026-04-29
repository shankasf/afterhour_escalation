'use client';

declare global {
  interface Window {
    AHChat?: { open?: () => void };
  }
}

export default function Hero() {
  const openChat = () => {
    if (typeof window !== 'undefined' && window.AHChat?.open) {
      window.AHChat.open();
    } else {
      // Fallback: scroll to footer where contact details live
      document.getElementById('contact-anchor')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-teal-100/60 via-cream-50 to-cream-50"
      />
      <div className="container-page py-20 sm:py-28 lg:py-32">
        <div className="max-w-3xl">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-teal-700/15 bg-cream-100/70 px-3 py-1 text-xs font-medium uppercase tracking-wider text-teal-700">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden="true" />
            24/7 after-hours desk
          </p>
          <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-teal-900 sm:text-5xl lg:text-6xl">
            After-hours emergencies, handled.
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-teal-800/80 sm:text-xl">
            When your guests need help between midnight and morning, we pick up the line. We triage,
            reach the right person on your team, and keep everyone informed until it&apos;s
            resolved.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <button type="button" onClick={openChat} className="btn-primary">
              Talk to us
              <span aria-hidden="true">&rarr;</span>
            </button>
            <a href="#features" className="btn-secondary">
              Learn more
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
