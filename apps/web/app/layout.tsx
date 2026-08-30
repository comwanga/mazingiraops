import type { Metadata, Viewport } from "next";
import { BrandBackground } from "@/components/BrandBackground";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BRANDING } from "@/lib/branding";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "MazingiraOps",
  title: {
    default: "MazingiraOps",
    template: "%s | MazingiraOps",
  },
  description:
    "Multi-ward environment operations reporting",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    title: "MazingiraOps",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: BRANDING.themeColor,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <a className="skip-link" href="#app-content">
          Skip to main content
        </a>
        <BrandBackground />
        <ServiceWorkerRegistration />
        <ThemeToggle />
        <div className="app-canvas" id="app-content" tabIndex={-1}>
          {children}
        </div>
      </body>
    </html>
  );
}
