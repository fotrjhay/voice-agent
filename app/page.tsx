import Voice from './voice';
export const dynamic = 'force-dynamic';
export default function Page() { return <Voice business={process.env.BUSINESS_NAME || 'Your business'} />; }
