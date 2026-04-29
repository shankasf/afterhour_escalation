import Nav from '../../components/Nav';
import Footer from '../../components/Footer';

export const metadata = {
  title: 'About — Amsterdam Hostel',
  description:
    'A small, independent hostel and the after-hours service that keeps it running smoothly through the night.',
};

export default function AboutPage() {
  return (
    <>
      <Nav />
      <main className="container-page py-20 sm:py-24">
        <div className="mx-auto max-w-2xl">
          <p className="mb-4 text-xs font-medium uppercase tracking-wider text-teal-700">About</p>
          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight text-teal-900 sm:text-5xl">
            A hostel, and the night-shift that keeps it kind.
          </h1>

          <div className="prose-spacing mt-10 space-y-6 text-lg leading-relaxed text-teal-800/85">
            <p>
              Amsterdam Hostel is an independently-run guesthouse just off the canals. We host
              travellers from everywhere, and we believe a good stay depends as much on what
              happens at 3am as on what happens at check-in.
            </p>
            <p>
              Our after-hours escalation service exists because hospitality emergencies do not wait
              for office hours. A heater out, a lost key, a noisy neighbour, a medical question —
              someone needs to answer, calmly, every time.
            </p>
            <p>
              The service was built by our own team, for our own team, and we now run the same desk
              on behalf of a handful of nearby properties. It is small on purpose. We answer
              quickly, we know your runbook, and we treat every late-night call like it matters —
              because it does.
            </p>
          </div>

          <dl className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="rounded-xl border border-teal-900/10 bg-white/50 p-6">
              <dt className="text-xs font-medium uppercase tracking-wider text-teal-700">Founded</dt>
              <dd className="mt-1 text-2xl font-semibold text-teal-900">2019</dd>
            </div>
            <div className="rounded-xl border border-teal-900/10 bg-white/50 p-6">
              <dt className="text-xs font-medium uppercase tracking-wider text-teal-700">
                Properties served
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-teal-900">12</dd>
            </div>
            <div className="rounded-xl border border-teal-900/10 bg-white/50 p-6">
              <dt className="text-xs font-medium uppercase tracking-wider text-teal-700">Coverage</dt>
              <dd className="mt-1 text-2xl font-semibold text-teal-900">24 / 7</dd>
            </div>
          </dl>
        </div>
      </main>
      <Footer />
    </>
  );
}
