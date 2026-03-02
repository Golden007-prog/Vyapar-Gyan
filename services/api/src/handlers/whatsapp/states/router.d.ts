export interface MessageContext {
    message: any;
    customer: any;
    session: any;
    requestId: string;
}
/**
 * Route incoming message to appropriate state handler based on session state
 */
export declare function routeMessage(context: MessageContext): Promise<void>;
//# sourceMappingURL=router.d.ts.map