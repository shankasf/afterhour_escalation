import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import '../styles/globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Amsterdam Hostel — After-hours Escalation',
  description:
    'After-hours emergencies, handled. Voice or text support that reaches your on-call team and keeps you updated as we work.',
  metadataBase: new URL('https://main.amsterdamhostel.cloud'),
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#fbf8f3',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-cream-50 font-sans text-teal-900 antialiased">
        {children}
        <Script src="/widget.js" strategy="afterInteractive" />
        <div id="ah-chat-root" />
      </body>
    </html>
  );
}
