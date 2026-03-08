'use client';

/**
 * ConfigureAmplify Component
 * 
 * This component initializes AWS Amplify on the client side.
 * It must be a Client Component to ensure Amplify.configure() runs in the browser.
 * 
 * Usage: Import this component in the root layout to initialize Amplify globally.
 */

import { useEffect } from 'react';
import { configureAmplify } from '@/lib/amplify-config';

export default function ConfigureAmplify() {
  useEffect(() => {
    // Configure Amplify when component mounts (client-side only)
    configureAmplify();
  }, []);

  // This component doesn't render anything
  return null;
}
