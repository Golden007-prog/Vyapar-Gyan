import { Amplify } from 'aws-amplify';

/**
 * AWS Amplify Configuration for VyaparGyan
 * 
 * Environment Variables Required:
 * - NEXT_PUBLIC_COGNITO_USER_POOL_ID: Cognito User Pool ID
 * - NEXT_PUBLIC_COGNITO_CLIENT_ID: Cognito App Client ID
 * - NEXT_PUBLIC_AWS_REGION: AWS Region (default: ap-south-1)
 * 
 * These are set in .env.local for local development
 */

export const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || 'ap-south-1_jeKcCOzvw',
      userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || '',
      region: process.env.NEXT_PUBLIC_AWS_REGION || 'ap-south-1',
      loginWith: {
        email: true,
      },
      signUpVerificationMethod: 'code' as const,
      userAttributes: {
        email: {
          required: true,
        },
        phone_number: {
          required: false,
        },
      },
      passwordFormat: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireNumbers: true,
        requireSpecialCharacters: true,
      },
    },
  },
};

/**
 * Configure Amplify with SSR support
 * This should be called on the client side before any auth operations
 */
export function configureAmplify() {
  if (typeof window !== 'undefined') {
    Amplify.configure(amplifyConfig, { ssr: true });
  }
}
