import DisputeDetailPage from './DisputeDetailClient';

export function generateStaticParams() {
  return [{ id: 'demo' }];
}

export default function Page() {
  return <DisputeDetailPage />;
}
