import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Box } from '@mui/material';
import Navigation from '@/components/Navigation';
import { AccessProvider } from '@/components/AccessProvider';
import { BrandingProvider } from '@/components/BrandingProvider';
import ThemeProvider from '@/components/ThemeProvider';
import { DynamicBackground } from '@/components/DynamicBackground';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'EdgeIQ Trades - Trading Leaderboards',
  description: 'Track your options trades and compete on the leaderboard',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                  document.documentElement.setAttribute('data-theme', theme);
                  document.body.setAttribute('data-theme', theme);
                } catch (e) {
                  document.documentElement.setAttribute('data-theme', 'light');
                  document.body.setAttribute('data-theme', 'light');
                }
              })();
            `,
          }}
        />
      </head>
      <body className={inter.className} suppressHydrationWarning>
        <AccessProvider>
          <BrandingProvider>
            <ThemeProvider>
              <DynamicBackground>
                <Navigation />
                <Box component="main" sx={{ position: 'relative', zIndex: 1 }}>
                  {children}
                </Box>
              </DynamicBackground>
            </ThemeProvider>
          </BrandingProvider>
        </AccessProvider>
      </body>
    </html>
  );
}

