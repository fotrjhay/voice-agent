import Voice from './voice';
import { getBusinessSettings } from '../lib/settings';
import type { BusinessSettings } from '../lib/settings-schema';
import { headers } from 'next/headers';
import { requestSite } from '../lib/origins';
import AdminPage from './admin/page';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const site = requestSite(new Request('http://localhost/', { headers: await headers() }));
  if (site?.adminRoot) return <AdminPage />;
  let settings: BusinessSettings;
  try {
    ({ settings } = await getBusinessSettings());
  } catch {
    return <main><h1>Assistant unavailable</h1><p role="alert">Business settings could not be loaded. Please retry shortly or contact the site administrator.</p></main>;
  }
  return <Voice business={settings.businessName} />;
}
