import WebChat from '@/components/Chat/WebChat';

export default function SellerCopilotPage() {
  // Hardcoded test props for GOLDEN Store
  const testProps = {
    userId: 'seller-golden-001',
    role: 'seller' as const,
    sessionId: 'test-session-golden-123',
  };

  return (
    <div className="h-screen">
      <WebChat {...testProps} />
    </div>
  );
}
