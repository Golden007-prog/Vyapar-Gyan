import {
  Logger,
  LogLevel,
  createLogger,
  withContext,
  getContext,
  setContext,
} from './logger';

describe('Structured Logger', () => {
  // Store original environment and console.log
  const originalEnv = process.env;
  const originalConsoleLog = console.log;
  let logOutput: string[] = [];
  
  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    process.env.LOG_LEVEL = 'debug'; // Enable all logs for testing
    
    // Mock console.log to capture output
    logOutput = [];
    console.log = jest.fn((message: string) => {
      logOutput.push(message);
    });
  });
  
  afterEach(() => {
    // Restore original environment and console.log
    process.env = originalEnv;
    console.log = originalConsoleLog;
  });
  
  describe('Basic logging', () => {
    it('should log debug messages', () => {
      const logger = createLogger();
      logger.debug('Debug message');
      
      expect(logOutput).toHaveLength(1);
      const log = JSON.parse(logOutput[0]);
      
      expect(log.level).toBe('debug');
      expect(log.message).toBe('Debug message');
      expect(log.timestamp).toBeDefined();
    });
    
    it('should log info messages', () => {
      const logger = createLogger();
      logger.info('Info message');
      
      expect(logOutput).toHaveLength(1);
      const log = JSON.parse(logOutput[0]);
      
      expect(log.level).toBe('info');
      expect(log.message).toBe('Info message');
    });
    
    it('should log warning messages', () => {
      const logger = createLogger();
      logger.warn('Warning message');
      
      expect(logOutput).toHaveLength(1);
      const log = JSON.parse(logOutput[0]);
      
      expect(log.level).toBe('warn');
      expect(log.message).toBe('Warning message');
    });
    
    it('should log error messages', () => {
      const logger = createLogger();
      const error = new Error('Test error');
      logger.error('Error message', error);
      
      expect(logOutput).toHaveLength(1);
      const log = JSON.parse(logOutput[0]);
      
      expect(log.level).toBe('error');
      expect(log.message).toBe('Error message');
      expect(log.error).toBeDefined();
      expect(log.error.message).toBe('Test error');
      expect(log.error.stack).toBeDefined();
    });
    
    it('should include timestamp in ISO format', () => {
      const logger = createLogger();
      logger.info('Test message');
      
      const log = JSON.parse(logOutput[0]);
      const timestamp = new Date(log.timestamp);
      
      expect(timestamp.toISOString()).toBe(log.timestamp);
    });
  });
  
  describe('Context handling', () => {
    it('should include additional context in logs', () => {
      const logger = createLogger();
      logger.info('Message with context', { userId: '123', action: 'create' });
      
      const log = JSON.parse(logOutput[0]);
      
      expect(log.context).toBeDefined();
      expect(log.context.userId).toBe('123');
      expect(log.context.action).toBe('create');
    });
    
    it('should include default context from logger creation', () => {
      const logger = createLogger({ service: 'auth', version: '1.0' });
      logger.info('Test message');
      
      const log = JSON.parse(logOutput[0]);
      
      expect(log.context).toBeDefined();
      expect(log.context.service).toBe('auth');
      expect(log.context.version).toBe('1.0');
    });
    
    it('should merge default and provided context', () => {
      const logger = createLogger({ service: 'auth' });
      logger.info('Test message', { userId: '123' });
      
      const log = JSON.parse(logOutput[0]);
      
      expect(log.context.service).toBe('auth');
      expect(log.context.userId).toBe('123');
    });
    
    it('should create child logger with additional context', () => {
      const parentLogger = createLogger({ service: 'auth' });
      const childLogger = parentLogger.child({ handler: 'login' });
      
      childLogger.info('Test message');
      
      const log = JSON.parse(logOutput[0]);
      
      expect(log.context.service).toBe('auth');
      expect(log.context.handler).toBe('login');
    });
    
    it('should not include empty context object', () => {
      const logger = createLogger();
      logger.info('Test message');
      
      const log = JSON.parse(logOutput[0]);
      
      expect(log.context).toBeUndefined();
    });
  });
  
  describe('Request ID propagation', () => {
    it('should propagate requestId through withContext', async () => {
      const logger = createLogger();
      
      await withContext({ requestId: 'req-123' }, async () => {
        logger.info('Test message');
      });
      
      const log = JSON.parse(logOutput[0]);
      
      expect(log.requestId).toBe('req-123');
    });
    
    it('should propagate userId through withContext', async () => {
      const logger = createLogger();
      
      await withContext({ requestId: 'req-123', userId: 'user-456' }, async () => {
        logger.info('Test message');
      });
      
      const log = JSON.parse(logOutput[0]);
      
      expect(log.requestId).toBe('req-123');
      expect(log.userId).toBe('user-456');
    });
    
    it('should propagate context to nested async calls', async () => {
      const logger = createLogger();
      
      await withContext({ requestId: 'req-123' }, async () => {
        await Promise.resolve();
        logger.info('Nested message');
      });
      
      const log = JSON.parse(logOutput[0]);
      
      expect(log.requestId).toBe('req-123');
    });
    
    it('should get current context', async () => {
      await withContext({ requestId: 'req-123', userId: 'user-456' }, async () => {
        const context = getContext();
        
        expect(context).toBeDefined();
        expect(context?.requestId).toBe('req-123');
        expect(context?.userId).toBe('user-456');
      });
    });
    
    it('should set context values', async () => {
      const logger = createLogger();
      
      await withContext({ requestId: 'req-123' }, async () => {
        setContext({ userId: 'user-456' });
        logger.info('Test message');
      });
      
      const log = JSON.parse(logOutput[0]);
      
      expect(log.requestId).toBe('req-123');
      expect(log.userId).toBe('user-456');
    });
    
    it('should not include requestId and userId in context object', async () => {
      const logger = createLogger();
      
      await withContext({ requestId: 'req-123', userId: 'user-456' }, async () => {
        logger.info('Test message', { action: 'create' });
      });
      
      const log = JSON.parse(logOutput[0]);
      
      expect(log.requestId).toBe('req-123');
      expect(log.userId).toBe('user-456');
      expect(log.context).toBeDefined();
      expect(log.context.requestId).toBeUndefined();
      expect(log.context.userId).toBeUndefined();
      expect(log.context.action).toBe('create');
    });
  });
  
  describe('Error handling', () => {
    it('should format Error objects', () => {
      const logger = createLogger();
      const error = new Error('Test error');
      error.name = 'TestError';
      
      logger.error('Error occurred', error);
      
      const log = JSON.parse(logOutput[0]);
      
      expect(log.error).toBeDefined();
      expect(log.error.name).toBe('TestError');
      expect(log.error.message).toBe('Test error');
      expect(log.error.stack).toBeDefined();
    });
    
    it('should handle non-Error objects', () => {
      const logger = createLogger();
      
      logger.error('Error occurred', 'string error');
      
      const log = JSON.parse(logOutput[0]);
      
      expect(log.error).toBeDefined();
      expect(log.error.name).toBe('UnknownError');
      expect(log.error.message).toBe('string error');
    });
    
    it('should include context with error', () => {
      const logger = createLogger();
      const error = new Error('Test error');
      
      logger.error('Error occurred', error, { operation: 'database-query' });
      
      const log = JSON.parse(logOutput[0]);
      
      expect(log.error).toBeDefined();
      expect(log.context).toBeDefined();
      expect(log.context.operation).toBe('database-query');
    });
  });
  
  describe('Log level filtering', () => {
    it('should respect LOG_LEVEL environment variable', () => {
      process.env.LOG_LEVEL = 'warn';
      const logger = createLogger();
      
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');
      
      expect(logOutput).toHaveLength(2);
      expect(JSON.parse(logOutput[0]).level).toBe('warn');
      expect(JSON.parse(logOutput[1]).level).toBe('error');
    });
    
    it('should default to info level if LOG_LEVEL is not set', () => {
      delete process.env.LOG_LEVEL;
      const logger = createLogger();
      
      logger.debug('Debug message');
      logger.info('Info message');
      
      expect(logOutput).toHaveLength(1);
      expect(JSON.parse(logOutput[0]).level).toBe('info');
    });
    
    it('should default to info level if LOG_LEVEL is invalid', () => {
      process.env.LOG_LEVEL = 'invalid';
      const logger = createLogger();
      
      logger.debug('Debug message');
      logger.info('Info message');
      
      expect(logOutput).toHaveLength(1);
      expect(JSON.parse(logOutput[0]).level).toBe('info');
    });
  });
  
  describe('JSON output format', () => {
    it('should output valid JSON', () => {
      const logger = createLogger();
      logger.info('Test message');
      
      expect(() => JSON.parse(logOutput[0])).not.toThrow();
    });
    
    it('should include all required fields', () => {
      const logger = createLogger();
      logger.info('Test message');
      
      const log = JSON.parse(logOutput[0]);
      
      expect(log).toHaveProperty('timestamp');
      expect(log).toHaveProperty('level');
      expect(log).toHaveProperty('message');
    });
    
    it('should handle special characters in message', () => {
      const logger = createLogger();
      logger.info('Message with "quotes" and \n newlines');
      
      const log = JSON.parse(logOutput[0]);
      
      expect(log.message).toBe('Message with "quotes" and \n newlines');
    });
    
    it('should handle complex context objects', () => {
      const logger = createLogger();
      logger.info('Test message', {
        nested: { key: 'value' },
        array: [1, 2, 3],
        boolean: true,
        number: 42,
      });
      
      const log = JSON.parse(logOutput[0]);
      
      expect(log.context.nested).toEqual({ key: 'value' });
      expect(log.context.array).toEqual([1, 2, 3]);
      expect(log.context.boolean).toBe(true);
      expect(log.context.number).toBe(42);
    });
  });
  
  describe('Real-world usage scenarios', () => {
    it('should handle Lambda handler logging pattern', async () => {
      const logger = createLogger({ handler: 'auth-login' });
      
      await withContext({ requestId: 'aws-request-123' }, async () => {
        logger.info('Request received', { method: 'POST', path: '/auth/login' });
        logger.info('User authenticated', { userId: 'user-456' });
        logger.info('Request completed', { statusCode: 200, duration: 150 });
      });
      
      expect(logOutput).toHaveLength(3);
      
      logOutput.forEach((output) => {
        const log = JSON.parse(output);
        expect(log.requestId).toBe('aws-request-123');
        expect(log.context.handler).toBe('auth-login');
      });
    });
  });
});
