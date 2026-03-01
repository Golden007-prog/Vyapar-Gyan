import { getConfig, clearConfigCache, Config } from './config';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { mockClient } from 'aws-sdk-client-mock';

// Create mocks for AWS SDK clients
const ssmMock = mockClient(SSMClient);
const secretsMock = mockClient(SecretsManagerClient);

describe('Configuration Loader', () => {
  // Store original environment variables
  const originalEnv = process.env;
  
  beforeEach(() => {
    // Reset mocks
    ssmMock.reset();
    secretsMock.reset();
    
    // Clear config cache before each test
    clearConfigCache();
    
    // Reset environment variables
    process.env = { ...originalEnv };
    
    // Set up base environment variables
    process.env.ENVIRONMENT = 'dev';
    process.env.AWS_REGION = 'us-east-1';
    process.env.TABLE_NAME = 'vyapargyan-dev-table';
    process.env.EVENT_BUS_NAME = 'vyapargyan-dev-events';
    process.env.USER_POOL_ID = 'us-east-1_test123';
    process.env.USER_POOL_CLIENT_ID = 'test-client-id';
    process.env.PRODUCT_IMAGES_BUCKET = 'vyapargyan-dev-images';
    process.env.DOCUMENTS_BUCKET = 'vyapargyan-dev-documents';
    process.env.LOG_LEVEL = 'info';
    process.env.WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';
  });
  
  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });
  
  describe('Successful configuration loading', () => {
    beforeEach(() => {
      // Mock SSM Parameter Store responses
      ssmMock.on(GetParameterCommand, {
        Name: '/dev/whatsapp/phone-number-id'
      }).resolves({
        Parameter: { Value: '123456789' }
      });
      
      ssmMock.on(GetParameterCommand, {
        Name: '/dev/razorpay/key-id'
      }).resolves({
        Parameter: { Value: 'rzp_test_key123' }
      });
      
      // Mock Secrets Manager responses
      secretsMock.on(GetSecretValueCommand, {
        SecretId: '/dev/whatsapp/token'
      }).resolves({
        SecretString: 'whatsapp-token-secret'
      });
      
      secretsMock.on(GetSecretValueCommand, {
        SecretId: '/dev/razorpay/key-secret'
      }).resolves({
        SecretString: 'razorpay-secret-key'
      });
      
      secretsMock.on(GetSecretValueCommand, {
        SecretId: '/dev/razorpay/webhook-secret'
      }).resolves({
        SecretString: 'razorpay-webhook-secret'
      });
      
      secretsMock.on(GetSecretValueCommand, {
        SecretId: '/dev/gemini/api-key'
      }).resolves({
        SecretString: 'gemini-api-key-secret'
      });
    });
    
    it('should load and validate configuration successfully', async () => {
      const config = await getConfig();
      
      expect(config).toBeDefined();
      expect(config.environment).toBe('dev');
      expect(config.region).toBe('us-east-1');
      expect(config.tableName).toBe('vyapargyan-dev-table');
      expect(config.eventBusName).toBe('vyapargyan-dev-events');
      expect(config.userPoolId).toBe('us-east-1_test123');
      expect(config.whatsappToken).toBe('whatsapp-token-secret');
      expect(config.razorpayKeyId).toBe('rzp_test_key123');
      expect(config.razorpayKeySecret).toBe('razorpay-secret-key');
      expect(config.geminiApiKey).toBe('gemini-api-key-secret');
    });
    
    it('should cache configuration after first load', async () => {
      // First call
      const config1 = await getConfig();
      
      // Second call should return cached config without calling AWS
      const config2 = await getConfig();
      
      expect(config1).toBe(config2); // Same object reference
      
      // Verify AWS clients were only called once
      expect(ssmMock.calls().length).toBe(2); // Two SSM parameters
      expect(secretsMock.calls().length).toBe(4); // Four secrets
    });
    
    it('should use default log level if not specified', async () => {
      delete process.env.LOG_LEVEL;
      
      const config = await getConfig();
      
      expect(config.logLevel).toBe('info');
    });
    
    it('should use custom log level if specified', async () => {
      process.env.LOG_LEVEL = 'debug';
      
      const config = await getConfig();
      
      expect(config.logLevel).toBe('debug');
    });
    
    it('should use default AWS region if not specified', async () => {
      delete process.env.AWS_REGION;
      
      const config = await getConfig();
      
      expect(config.region).toBe('us-east-1');
    });
  });
  
  describe('Environment-specific configuration', () => {
    beforeEach(() => {
      // Mock responses for all environments
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: 'test-secret'
      });
    });
    
    it('should load dev environment configuration', async () => {
      process.env.ENVIRONMENT = 'dev';
      
      const config = await getConfig();
      
      expect(config.environment).toBe('dev');
    });
    
    it('should load staging environment configuration', async () => {
      process.env.ENVIRONMENT = 'staging';
      
      const config = await getConfig();
      
      expect(config.environment).toBe('staging');
    });
    
    it('should load prod environment configuration', async () => {
      process.env.ENVIRONMENT = 'prod';
      
      const config = await getConfig();
      
      expect(config.environment).toBe('prod');
    });
  });
  
  describe('Error handling', () => {
    it('should throw error if ENVIRONMENT is missing', async () => {
      delete process.env.ENVIRONMENT;
      
      await expect(getConfig()).rejects.toThrow('ENVIRONMENT environment variable is required');
    });
    
    it('should throw error if ENVIRONMENT is invalid', async () => {
      process.env.ENVIRONMENT = 'invalid';
      
      await expect(getConfig()).rejects.toThrow('Invalid ENVIRONMENT value: invalid');
    });
    
    it('should throw error if required environment variable is missing', async () => {
      delete process.env.TABLE_NAME;
      
      // Mock AWS responses
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: 'test-secret'
      });
      
      await expect(getConfig()).rejects.toThrow('Configuration validation failed');
    });
    
    it('should throw error if SSM parameter is not found', async () => {
      ssmMock.on(GetParameterCommand, {
        Name: '/dev/whatsapp/phone-number-id'
      }).rejects(new Error('ParameterNotFound'));
      
      await expect(getConfig()).rejects.toThrow('Failed to get parameter /dev/whatsapp/phone-number-id');
    });
    
    it('should throw error if SSM parameter has no value', async () => {
      ssmMock.on(GetParameterCommand, {
        Name: '/dev/whatsapp/phone-number-id'
      }).resolves({
        Parameter: {}
      });
      
      await expect(getConfig()).rejects.toThrow('Parameter /dev/whatsapp/phone-number-id not found or has no value');
    });
    
    it('should throw error if secret is not found', async () => {
      // Mock SSM to succeed
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      
      // Mock Secrets Manager to fail
      secretsMock.on(GetSecretValueCommand, {
        SecretId: '/dev/whatsapp/token'
      }).rejects(new Error('ResourceNotFoundException'));
      
      await expect(getConfig()).rejects.toThrow('Failed to get secret /dev/whatsapp/token');
    });
    
    it('should throw error if secret has no value', async () => {
      // Mock SSM to succeed
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      
      // Mock Secrets Manager to return empty
      secretsMock.on(GetSecretValueCommand, {
        SecretId: '/dev/whatsapp/token'
      }).resolves({});
      
      await expect(getConfig()).rejects.toThrow('Secret /dev/whatsapp/token not found or has no value');
    });
    
    it('should throw error if WhatsApp API URL is invalid', async () => {
      process.env.WHATSAPP_API_URL = 'not-a-url';
      
      // Mock AWS responses
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: 'test-secret'
      });
      
      await expect(getConfig()).rejects.toThrow('Configuration validation failed');
    });
  });
  
  describe('Configuration caching', () => {
    beforeEach(() => {
      // Mock AWS responses
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: 'test-secret'
      });
    });
    
    it('should clear cache when clearConfigCache is called', async () => {
      // First load
      await getConfig();
      
      // Clear cache
      clearConfigCache();
      
      // Second load should call AWS again
      await getConfig();
      
      // Verify AWS clients were called twice
      expect(ssmMock.calls().length).toBe(4); // 2 parameters × 2 loads
      expect(secretsMock.calls().length).toBe(8); // 4 secrets × 2 loads
    });
  });
  
  describe('Environment-specific secret paths', () => {
    it('should use correct secret paths for dev environment', async () => {
      process.env.ENVIRONMENT = 'dev';
      
      // Mock AWS responses
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: 'test-secret'
      });
      
      await getConfig();
      
      // Verify correct secret paths were used
      const secretCalls = secretsMock.calls();
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/dev/whatsapp/token'
      )).toBe(true);
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/dev/razorpay/key-secret'
      )).toBe(true);
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/dev/gemini/api-key'
      )).toBe(true);
    });
    
    it('should use correct secret paths for staging environment', async () => {
      process.env.ENVIRONMENT = 'staging';
      
      // Mock AWS responses
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: 'test-secret'
      });
      
      await getConfig();
      
      // Verify correct secret paths were used
      const secretCalls = secretsMock.calls();
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/staging/whatsapp/token'
      )).toBe(true);
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/staging/razorpay/key-secret'
      )).toBe(true);
    });
    
    it('should use correct secret paths for prod environment', async () => {
      process.env.ENVIRONMENT = 'prod';
      
      // Mock AWS responses
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: 'test-value' }
      });
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: 'test-secret'
      });
      
      await getConfig();
      
      // Verify correct secret paths were used
      const secretCalls = secretsMock.calls();
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/prod/whatsapp/token'
      )).toBe(true);
      expect(secretCalls.some(call => 
        call.args[0].input.SecretId === '/prod/razorpay/key-secret'
      )).toBe(true);
    });
  });
});
