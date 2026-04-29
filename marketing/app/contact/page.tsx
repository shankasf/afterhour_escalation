import Nav from '../../components/Nav';
import Footer from '../../components/Footer';

export const metadata = {
  title: 'Contact — Amsterdam Hostel',
  description:
    'Phone, email, and address for Amsterdam Hostel. Or open the chat in the bottom-right corner.',
};

const contactItems = [
  {
    label: 'Phone',
    value: '+31 20 123 4567',
    href: 'tel:+31201234567',
    sub: 'Available 24 hours, every day',
  },
  {
    label: 'Email',
    value: 'help@amsterdamhostel.cloud',
    href: 'mailto:help@amsterdamhostel.cloud',
    sub: 'We reply within an hour',
  },
  {
    label: 'Address',
    value: 'Prinsengracht 123, 1015 Amsterdam',
    href: 'https://maps.google.com/?q=Prinsengracht+123+Amsterdam',
    sub: 'Centrum, just off the canal ring',
  },
];

export default function ContactPage() {
  return (
    <>
      <Nav />
      <main className="container-page py-20 sm:py-24">
        <div className="mx-auto max-w-2xl">
          <p className="mb-4 text-xs font-medium uppercase tracking-wider text-teal-700">Contact</p>
          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight text-teal-900 sm:text-5xl">
            Get in touch.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-teal-800/80">
            Reach us however suits you. For urgent after-hours issues, the phone line is fastest —
            or just open the chat in the bottom-right corner of any page.
          </p>

          <ul className="mt-12 space-y-3">
            {contactItems.map((item) => (
              <li key={item.label}>
                <a
                  href={item.href}
                  className="group flex flex-col gap-1 rounded-2xl border border-teal-900/10 bg-white/50 p-6 transition-all duration-150 hover:border-teal-700/30 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 sm:flex-row sm:items-center sm:justify-between"
                  target={item.label === 'Address' ? '_blank' : undefined}
                  rel={item.label === 'Address' ? 'noopener noreferrer' : undefined}
                >
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-teal-700">
                      {item.label}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-teal-900">{item.value}</p>
                    <p className="mt-1 text-sm text-teal-800/65">{item.sub}</p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="text-teal-700 transition-transform duration-150 group-hover:translate-x-1"
                  >
                    &rarr;
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <Footer />
    </>
  );
}
