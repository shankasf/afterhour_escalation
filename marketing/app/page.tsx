import Nav from '../components/Nav';
import Hero from '../components/Hero';
import Features from '../components/Features';
import Footer from '../components/Footer';

const trustLogos = ['Canalside Inn', 'Jordaan Suites', 'Vondel Stay', 'De Pijp B&B', 'Centrum Lofts'];

const steps = [
  {
    n: '01',
    title: 'Guest reaches out',
    body: 'A call or chat lands on our 24/7 desk. We confirm name, room, and what is happening.',
  },
  {
    n: '02',
    title: 'We escalate the right person',
    body: 'Following your runbook, we ring the on-call manager first, then back-up, until someone picks up.',
  },
  {
    n: '03',
    title: 'You stay in the loop',
    body: 'Acknowledged, in-progress, resolved. The guest sees it. Your team sees it. Everyone aligns.',
  },
];

export default function HomePage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Features />

        <section aria-labelledby="trust-heading" className="py-16 sm:py-20">
          <div className="container-page">
            <h2
              id="trust-heading"
              className="text-center text-sm font-medium uppercase tracking-wider text-teal-800/60"
            >
              Trusted by independent hospitality teams across Amsterdam
            </h2>
            <ul className="mt-8 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
              {trustLogos.map((name) => (
                <li
                  key={name}
                  className="flex h-12 items-center justify-center rounded-lg border border-dashed border-teal-900/15 px-4 text-sm font-medium text-teal-800/70"
                >
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="how-heading" className="py-20 sm:py-24">
          <div className="container-page">
            <div className="mb-14 max-w-2xl">
              <h2
                id="how-heading"
                className="text-3xl font-semibold tracking-tight text-teal-900 sm:text-4xl"
              >
                How it works.
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-teal-800/75">
                Three steps from incoming call to resolution. No mystery, no missed handoffs.
              </p>
            </div>

            <ol className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {steps.map((s, i) => (
                <li
                  key={s.n}
                  className="relative rounded-2xl bg-teal-900 p-7 text-cream-50 shadow-sm"
                >
                  <span className="text-xs font-mono tracking-widest text-teal-200/80">{s.n}</span>
                  <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-cream-50/75">{s.body}</p>
                  {i < steps.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute right-4 top-1/2 hidden -translate-y-1/2 text-teal-300/40 md:block"
                    >
                      &rarr;
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
