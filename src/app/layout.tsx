import './globals.css';
import { SessionProvider } from '@/components/SessionProvider';
import { Analytics } from '@vercel/analytics/next';

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <title>ORCA</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <meta
          name="description"
          content="A living procedural music galaxy generated from canonical music metadata. Explore artist relationships as a spatial orca."
        />
        <link rel="icon" href="/ORCA_logo.png?v=3" type="image/png" />
        <link rel="shortcut icon" href="/ORCA_logo.png?v=3" type="image/png" />
        <link rel="apple-touch-icon" href="/ORCA_logo.png?v=3" type="image/png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <SessionProvider>{children}</SessionProvider>
        <Analytics />
      </body>
    </html>
  );
}

