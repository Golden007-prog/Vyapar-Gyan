/**
 * Authentication Stack
 * 
 * Creates Amazon Cognito User Pool for managing authentication across all three
 * personas (Admin, Seller, Customer). The User Pool includes custom attributes
 * for role-based access control, password policies, and MFA settings based on
 * environment configuration.
 * 
 * Configuration is environment-specific:
 * - Dev: Relaxed password policy, MFA disabled
 * - Staging: Production-like password policy, optional MFA
 * - Prod: Strict password policy, MFA enabled
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
  Mfa,
  AccountRecovery,
  StringAttribute,
  CfnUserPoolGroup,
} from 'aws-cdk-lib/aws-cognito';
import { RemovalPolicy } from 'aws-cdk-lib';
import { EnvironmentConfig } from '../config';

/**
 * Properties for AuthStack
 */
export interface AuthStackProps extends cdk.StackProps {
  /** Environment-specific configuration */
  config: EnvironmentConfig;
}

/**
 * AuthStack creates Cognito User Pool and App Clients for authentication
 */
export class AuthStack extends cdk.Stack {
  /** The Cognito User Pool */
  public readonly userPool: UserPool;
  
  /** App client for web admin dashboard */
  public readonly webAdminClient: UserPoolClient;
  
  /** App client for web seller dashboard */
  public readonly webSellerClient: UserPoolClient;
  
  /** App client for API service (machine-to-machine) */
  public readonly apiServiceClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { config } = props;

    // Create Cognito User Pool
    this.userPool = new UserPool(this, 'UserPool', {
      userPoolName: `${config.resourcePrefix}-user-pool`,
      
      // Sign-in: Allow email and phone number
      signInAliases: {
        email: true,
        phone: true,
        username: false,
      },
      
      // Standard attributes
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        phoneNumber: {
          required: false,
          mutable: true,
        },
        fullname: {
          required: false,
          mutable: true,
        },
      },
      
      // Custom attributes for RBAC
      customAttributes: {
        // Role: admin, seller, or customer
        role: new StringAttribute({
          minLen: 1,
          maxLen: 20,
          mutable: true,
        }),
        // User ID reference to DynamoDB
        userId: new StringAttribute({
          minLen: 1,
          maxLen: 50,
          mutable: false,
        }),
        // Status: pending, approved, suspended
        status: new StringAttribute({
          minLen: 1,
          maxLen: 20,
          mutable: true,
        }),
      },
      
      // Password policy: environment-specific
      passwordPolicy: {
        minLength: config.cognito.passwordMinLength,
        requireLowercase: config.cognito.passwordRequireLowercase,
        requireUppercase: config.cognito.passwordRequireUppercase,
        requireDigits: config.cognito.passwordRequireNumbers,
        requireSymbols: config.cognito.passwordRequireSymbols,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      
      // MFA: environment-specific
      mfa: config.cognito.mfaEnabled ? Mfa.OPTIONAL : Mfa.OFF,
      mfaSecondFactor: {
        sms: true,
        otp: true,
      },
      
      // Account recovery: email preferred
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      
      // Email verification
      autoVerify: {
        email: true,
        phone: false,
      },
      
      // Self sign-up: disabled (admin approval required)
      selfSignUpEnabled: false,
      
      // User invitation
      userInvitation: {
        emailSubject: 'Welcome to VyaparGyan',
        emailBody: 'Hello {username}, your temporary password is {####}',
      },
      
      // User verification
      userVerification: {
        emailSubject: 'Verify your email for VyaparGyan',
        emailBody: 'Your verification code is {####}',
        emailStyle: cdk.aws_cognito.VerificationEmailStyle.CODE,
      },
      
      // Advanced security: enabled for prod
      advancedSecurityMode: config.environment === 'prod'
        ? cdk.aws_cognito.AdvancedSecurityMode.ENFORCED
        : cdk.aws_cognito.AdvancedSecurityMode.OFF,
      
      // Removal policy: retain for prod, destroy for dev
      removalPolicy: config.environment === 'prod'
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,
    });

    // Create user groups for role-based access control
    
    // Admins group
    new CfnUserPoolGroup(this, 'AdminsGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'Admins',
      description: 'Platform administrators with full access',
      precedence: 1,
    });

    // Sellers group
    new CfnUserPoolGroup(this, 'SellersGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'Sellers',
      description: 'Verified sellers managing products and orders',
      precedence: 2,
    });

    // Customers group
    new CfnUserPoolGroup(this, 'CustomersGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'Customers',
      description: 'End customers browsing and ordering products',
      precedence: 3,
    });

    // Create app client for web admin dashboard
    this.webAdminClient = this.userPool.addClient('WebAdminClient', {
      userPoolClientName: `${config.resourcePrefix}-web-admin`,
      
      // OAuth flows: authorization code flow for web apps
      authFlows: {
        userPassword: false,
        userSrp: true,
        custom: false,
        adminUserPassword: false,
      },
      
      // OAuth settings
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,
          clientCredentials: false,
        },
        scopes: [
          cdk.aws_cognito.OAuthScope.EMAIL,
          cdk.aws_cognito.OAuthScope.OPENID,
          cdk.aws_cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: this.getCallbackUrls(config, 'admin'),
        logoutUrls: this.getLogoutUrls(config, 'admin'),
      },
      
      // Token validity
      accessTokenValidity: config.cognito.accessTokenValidity,
      idTokenValidity: config.cognito.accessTokenValidity,
      refreshTokenValidity: config.cognito.refreshTokenValidity,
      
      // Prevent user existence errors
      preventUserExistenceErrors: true,
      
      // Enable token revocation
      enableTokenRevocation: true,
      
      // Supported identity providers
      supportedIdentityProviders: [
        UserPoolClientIdentityProvider.COGNITO,
      ],
    });

    // Create app client for web seller dashboard
    this.webSellerClient = this.userPool.addClient('WebSellerClient', {
      userPoolClientName: `${config.resourcePrefix}-web-seller`,
      
      // OAuth flows: authorization code flow for web apps
      authFlows: {
        userPassword: false,
        userSrp: true,
        custom: false,
        adminUserPassword: false,
      },
      
      // OAuth settings
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,
          clientCredentials: false,
        },
        scopes: [
          cdk.aws_cognito.OAuthScope.EMAIL,
          cdk.aws_cognito.OAuthScope.OPENID,
          cdk.aws_cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: this.getCallbackUrls(config, 'seller'),
        logoutUrls: this.getLogoutUrls(config, 'seller'),
      },
      
      // Token validity
      accessTokenValidity: config.cognito.accessTokenValidity,
      idTokenValidity: config.cognito.accessTokenValidity,
      refreshTokenValidity: config.cognito.refreshTokenValidity,
      
      // Prevent user existence errors
      preventUserExistenceErrors: true,
      
      // Enable token revocation
      enableTokenRevocation: true,
      
      // Supported identity providers
      supportedIdentityProviders: [
        UserPoolClientIdentityProvider.COGNITO,
      ],
    });

    // Create app client for API service (machine-to-machine)
    this.apiServiceClient = this.userPool.addClient('ApiServiceClient', {
      userPoolClientName: `${config.resourcePrefix}-api-service`,
      
      // OAuth flows: admin user password for backend services
      authFlows: {
        userPassword: false,
        userSrp: false,
        custom: false,
        adminUserPassword: true,
      },
      
      // No OAuth for service client
      
      // Token validity
      accessTokenValidity: config.cognito.accessTokenValidity,
      idTokenValidity: config.cognito.accessTokenValidity,
      refreshTokenValidity: config.cognito.refreshTokenValidity,
      
      // Prevent user existence errors
      preventUserExistenceErrors: true,
      
      // Enable token revocation
      enableTokenRevocation: true,
      
      // Generate secret for service client
      generateSecret: true,
    });

    // Add environment-specific tags
    cdk.Tags.of(this.userPool).add('Name', `${config.resourcePrefix}-user-pool`);
    cdk.Tags.of(this.userPool).add('Service', 'authentication');

    // Output User Pool details for reference by other stacks
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${config.resourcePrefix}-user-pool-id`,
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      description: 'Cognito User Pool ARN',
      exportName: `${config.resourcePrefix}-user-pool-arn`,
    });

    new cdk.CfnOutput(this, 'WebAdminClientId', {
      value: this.webAdminClient.userPoolClientId,
      description: 'Web Admin App Client ID',
      exportName: `${config.resourcePrefix}-web-admin-client-id`,
    });

    new cdk.CfnOutput(this, 'WebSellerClientId', {
      value: this.webSellerClient.userPoolClientId,
      description: 'Web Seller App Client ID',
      exportName: `${config.resourcePrefix}-web-seller-client-id`,
    });

    new cdk.CfnOutput(this, 'ApiServiceClientId', {
      value: this.apiServiceClient.userPoolClientId,
      description: 'API Service App Client ID',
      exportName: `${config.resourcePrefix}-api-service-client-id`,
    });
  }

  /**
   * Get callback URLs for OAuth based on environment and app type
   */
  private getCallbackUrls(config: EnvironmentConfig, appType: 'admin' | 'seller'): string[] {
    const urls: string[] = [];

    if (config.environment === 'dev') {
      // Local development URLs
      urls.push(`http://localhost:3000/auth/callback`);
      // GitHub Pages deployment
      urls.push(`https://golden007-prog.github.io/Vyapar-Gyan/auth/callback`);
    } else if (config.environment === 'staging') {
      // Staging URLs
      urls.push(`https://staging-${appType}.vyapargyan.com/auth/callback`);
    } else {
      // Production URLs
      urls.push(`https://${appType}.vyapargyan.com/auth/callback`);
    }

    return urls;
  }

  /**
   * Get logout URLs for OAuth based on environment and app type
   */
  private getLogoutUrls(config: EnvironmentConfig, appType: 'admin' | 'seller'): string[] {
    const urls: string[] = [];

    if (config.environment === 'dev') {
      // Local development URLs
      urls.push(`http://localhost:3000/auth/logout`);
      // GitHub Pages deployment
      urls.push(`https://golden007-prog.github.io/Vyapar-Gyan/auth/logout`);
    } else if (config.environment === 'staging') {
      // Staging URLs
      urls.push(`https://staging-${appType}.vyapargyan.com/auth/logout`);
    } else {
      // Production URLs
      urls.push(`https://${appType}.vyapargyan.com/auth/logout`);
    }

    return urls;
  }
}
