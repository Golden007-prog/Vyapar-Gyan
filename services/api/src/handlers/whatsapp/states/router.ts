import { logger } from '../../../utils/logger';
import { greetingHandler } from './greeting-handler';
import { browsingHandler } from './browsing-handler';
import { checkoutHandler } from './checkout-handler';

export interface MessageContext {
  message: any;
  customer: any;
  session: any;
  requestId: string;
}

/**
 * Route incoming message to appropriate state handler based on session state
 */
export async function routeMessage(context: MessageContext): Promise<void> {
  const { session, message } = context;
  const state = session.state || 'greeting';

  logger.info('Routing message to state handler', {
    sessionId: session.id,
    state,
    messageType: message.type,
  });

  try {
    switch (state) {
      case 'greeting':
        await greetingHandler(context);
        break;
      
      case 'browsing':
      case 'product_inquiry':
      case 'idle':
        // All browsing-related states use the same handler
        await browsingHandler(context);
        break;
      
      case 'checkout':
      case 'ordering':
      case 'payment':
        await checkoutHandler(context);
        break;
      
      case 'support':
        await handleSupport(context);
        break;
      
      default:
        logger.warn('Unknown session state, defaulting to greeting', {
          sessionId: session.id,
          state,
        });
        await greetingHandler(context);
    }
  } catch (error) {
    logger.error('Error in state handler', {
      sessionId: session.id,
      state,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Handle support state (placeholder)
 */
async function handleSupport(context: MessageContext): Promise<void> {
  const { session } = context;
  
  logger.info('Support state handler placeholder', {
    sessionId: session.id,
  });
  
  // For now, treat support like browsing
  await browsingHandler(context);
}
