import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Business voice assistant', description: 'Local voice conversation demo' };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
