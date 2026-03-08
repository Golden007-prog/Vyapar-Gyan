import OrderDetailClient from './OrderDetailClient';

export function generateStaticParams() {
  return [{ orderId: 'demo' }];
}

export default function OrderDetailPage({ params }: { params: { orderId: string } }) {
  return <OrderDetailClient />;
}