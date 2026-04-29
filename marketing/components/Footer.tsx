import Link from 'next/link';

export default function Footer() {
  return (
    <footer
      id="contact-anchor"
      className="mt-24 border-t border-teal-900/10 bg-cream-100/60"
    >
      <div className="container-page py-12">
        <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-teal-600 text-sm font-semibold text-cream-50">
                AH
              </span>
              <span className="text-base font-semibold tracking-tight text-teal-900">
                Amsterdam Hostel
              </span>
            </div>
            <p className="mt-3 max-w-md text-sm text-teal-800/70">
              After-hours escalation for hospitality teams. Calm response when it counts.
            </p>
          </div>

          <ul className="flex flex-wrap items-center gap-6 text-sm">
            <li>
              <Link
                href="/about"
                className="text-teal-800 transition hover:text-teal-900 focus-visible:outline-none focus-visible:underline"
              >
                About
              </Link>
            </li>
            <li>
              <Link
                href="/contact"
                className="text-teal-800 transition hover:text-teal-900 focus-visible:outline-none focus-visible:underline"
              >
                Contact
              </Link>
            </li>
          </ul>
        </div>

        <p className="mt-10 text-xs text-teal-800/60">
          &copy; {new Date().getFullYear()} Amsterdam Hostel. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
