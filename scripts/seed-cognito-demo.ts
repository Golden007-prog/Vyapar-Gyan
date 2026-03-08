#!/usr/bin/env node
/**
 * Cognito Demo Account Seeding Script
 * 
 * Creates 3 pre-confirmed demo accounts in Cognito User Pool:
 *   - Admin:    +91 9000000001 / DemoAdmin@123
 *   - Seller:   +91 9000000002 / DemoSeller@123
 *   - Customer: +91 9000000003 / DemoCustomer@123
 * 
 * Also creates matching DynamoDB profile records.
 * 
 * Prerequisites:
 *   - AWS credentials configured (profile or env vars)
 *   - Cognito User Pool deployed
 *   - DynamoDB table deployed
 * 
 * Usage: npx tsx scripts/seed-cognito-demo.ts
 */

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const REGION = 'ap-south-1';
const USER_POOL_ID = 'ap-south-1_jeKcCOzvw';
const TABLE_NAME = 'dev-vyapargyan-main';

const cognitoClient = new CognitoIdentityProviderClient({ region: REGION });
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const DEMO_ACCOUNTS = [
  {
    phone: '+919000000001',
    password: 'DemoAdmin@123',
    group: 'admin',
    name: 'Demo Admin',
    role: 'admin',
    userId: 'demo-admin-001',
  },
  {
    phone: '+919000000002',
    password: 'DemoSeller@123',
    group: 'seller',
    name: 'Demo Seller',
    businessName: 'Gupta General Store',
    role: 'seller',
    userId: 'demo-seller-002',
  },
  {
    phone: '+919000000003',
    password: 'DemoCustomer@123',
    group: 'customer',
    name: 'Demo Customer',
    role: 'customer',
    userId: 'demo-customer-003',
  },
];

async function userExists(phone: string): Promise<boolean> {
  try {
    await cognitoClient.send(new AdminGetUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: phone,
    }));
    return true;
  } catch (err: any) {
    if (err.name === 'UserNotFoundException') return false;
    throw err;
  }
}

async function createDemoAccount(account: typeof DEMO_ACCOUNTS[0]) {
  const exists = await userExists(account.phone);
  if (exists) {
    console.log(`  ⏭️  ${account.role} (${account.phone}) already exists — skipping Cognito create`);
  } else {
    // Create user with suppressed welcome message
    await cognitoClient.send(new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: account.phone,
      UserAttributes: [
        { Name: 'phone_number', Value: account.phone },
        { Name: 'phone_number_verified', Value: 'true' },
        { Name: 'name', Value: account.name },
      ],
      MessageAction: 'SUPPRESS',
    }));

    // Set permanent password (bypasses FORCE_CHANGE_PASSWORD)
    await cognitoClient.send(new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: account.phone,
      Password: account.password,
      Permanent: true,
    }));

    console.log(`  ✅ Created Cognito user: ${account.role} (${account.phone})`);
  }

  // Add to group (idempotent)
  try {
    await cognitoClient.send(new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: account.phone,
      GroupName: account.group,
    }));
    console.log(`  ✅ Added to group: ${account.group}`);
  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException') {
      console.warn(`  ⚠️  Group "${account.group}" does not exist — create it in Cognito first`);
    } else {
      throw err;
    }
  }

  // Upsert DynamoDB profile
  const now = new Date().toISOString();
  const profileItem: Record<string, any> = {
    PK: `USER#${account.userId}`,
    SK: 'PROFILE',
    id: account.userId,
    userId: account.userId,
    role: account.role,
    status: 'active',
    ownerName: account.name,
    phone: account.phone,
    createdAt: now,
    updatedAt: now,
  };

  if (account.role === 'seller') {
    profileItem.businessName = (account as any).businessName || 'Demo Store';
    profileItem.totalRevenue = 45000;
    profileItem.businessAddress = {
      addressLine1: '123 MG Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
    };
  }

  await ddbClient.send(new PutCommand({ TableName: TABLE_NAME, Item: profileItem }));
  console.log(`  ✅ Upserted DynamoDB profile: ${account.userId}`);
}

async function main() {
  console.log('🔐 Seeding Cognito demo accounts...\n');

  for (const account of DEMO_ACCOUNTS) {
    console.log(`\n👤 ${account.role.toUpperCase()}`);
    try {
      await createDemoAccount(account);
    } catch (err) {
      console.error(`  ❌ Failed for ${account.role}:`, err);
    }
  }

  console.log('\n🎉 Demo account seeding complete!');
  console.log('\n📋 Demo Credentials:');
  console.log('  Admin:    +91 9000000001 / DemoAdmin@123');
  console.log('  Seller:   +91 9000000002 / DemoSeller@123');
  console.log('  Customer: +91 9000000003 / DemoCustomer@123');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
  });
