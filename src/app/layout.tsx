import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GymLog Web",
  description: "Rutinas, entrenamientos, historial y progreso con datos por usuario.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#08080e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
