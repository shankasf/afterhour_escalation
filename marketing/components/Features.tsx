const features = [
  {
    title: 'Voice or text',
    body: 'Guests reach us how they prefer — a phone call, the chat widget, or a quick message. No app to install, no friction.',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
      />
    ),
  },
  {
    title: 'We reach your on-call team',
    body: 'Smart escalation paths — manager first, then back-up, then owner. We loop the right hands and stay on the line.',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
      />
    ),
  },
  {
    title: 'Real updates as we work',
    body: 'No black-box service. You and the guest see status updates as the issue moves from received to acknowledged to resolved.',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
      />
    ),
  },
];

export default function Features() {
  return (
    <section id="features" className="border-y border-teal-900/5 bg-white/40 py-20 sm:py-24">
      <div className="container-page">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-teal-900 sm:text-4xl">
            What you get at 2am.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-teal-800/75">
            A small, focused service built around three things that actually matter when something
            breaks after hours.
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {features.map((f) => (
            <li
              key={f.title}
              className="group rounded-2xl border border-teal-900/10 bg-cream-50 p-7 transition-shadow duration-200 hover:shadow-lg hover:shadow-teal-900/5"
            >
              <div className="mb-5 grid h-11 w-11 place-items-center rounded-xl bg-teal-100 text-teal-700">
                <svg
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.6}
                  stroke="currentColor"
                  className="h-5 w-5"
                >
                  {f.icon}
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-teal-900">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-teal-800/75">{f.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
