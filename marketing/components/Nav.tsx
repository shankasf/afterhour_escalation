import Link from 'next/link';

export default function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-teal-900/5 bg-cream-50/80 backdrop-blur">
      <nav className="container-page flex h-16 items-center justify-between" aria-label="Primary">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md text-teal-900 transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-teal-600 text-sm font-semibold text-cream-50">
            AH
          </span>
          <span className="text-base font-semibold tracking-tight">Amsterdam Hostel</span>
        </Link>

        <ul className="flex items-center gap-1 text-sm">
          <li>
            <Link
              href="/about"
              className="rounded-full px-4 py-2 text-teal-800 transition hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              About
            </Link>
          </li>
          <li>
            <Link
              href="/contact"
              className="rounded-full px-4 py-2 text-teal-800 transition hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              Contact
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
