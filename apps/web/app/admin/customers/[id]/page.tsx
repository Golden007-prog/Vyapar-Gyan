import CustomerDetailPage from './CustomerDetailClient';

export function generateStaticParams() {
  return [{ id: 'demo' }];
}

export default function Page() {
  return <CustomerDetailPage />;
}
