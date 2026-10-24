import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { PinDialog } from "@/components/ui";

export const metadata = {
  title: "Auralink · Every passenger, understood",
  description: "Auralink helps airline passengers and cabin crew understand each other across accents, languages and cabin noise. When speech is unclear, it asks instead of guessing.",
};

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#050505" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/fonts/scripts.css" />
      </head>
      <body>
        {children}
        <PinDialog />
      </body>
    </html>
  );
}
