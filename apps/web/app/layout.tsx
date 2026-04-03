import type { Metadata } from 'next';
import './globals.css';
import ConfigureAmplify from '@/components/ConfigureAmplify';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';

export const metadata: Metadata = {
  title: 'VyaparGyan - AI-Powered Marketplace',
  description: 'Multi-seller marketplace with AI-powered business insights',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#4f46e5" />
      </head>
      <body style={{ fontFamily: "'Inter', sans-serif" }}>
        <ConfigureAmplify />
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}