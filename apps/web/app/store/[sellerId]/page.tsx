import StorefrontClient from './StorefrontClient';

export function generateStaticParams() {
  return [{ sellerId: 'demo' }];
}

export default function StorefrontPage({ params }: { params: { sellerId: string } }) {
  return <StorefrontClient />;
}