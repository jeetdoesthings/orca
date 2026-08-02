import '../globals.css';
import './landing.css';

export const metadata = {
  title: 'ORCA — The shape of your taste',
  description:
    'A procedural music galaxy generated from canonical metadata. Your taste, mapped as a living orca.',
};

export default function LandingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {/* Cabinet Grotesk (display) via Fontshare */}
      <link
        rel="preconnect"
        href="https://api.fontshare.com"
        crossOrigin="anonymous"
      />
      <link
        href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@800,700,500,400&display=swap"
        rel="stylesheet"
      />
      {/* Inter Tight (body) + Geist Mono (numerals) via Google */}
      <link
        rel="preconnect"
        href="https://fonts.googleapis.com"
        crossOrigin="anonymous"
      />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      {children}
    </>
  );
}
