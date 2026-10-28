import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'FJO - Voice', description: 'speak with Zevon' };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
