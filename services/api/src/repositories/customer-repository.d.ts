export interface Customer {
    id: string;
    phoneNumber: string;
    profileName: string;
    whatsappId?: string;
    createdAt: string;
    updatedAt: string;
}
export interface ResolveOrCreateCustomerInput {
    phoneNumber: string;
    profileName: string;
    whatsappId?: string;
}
/**
 * CustomerRepository
 *
 * Manages customer data in DynamoDB.
 * Uses PK: CUSTOMER#{phoneNumber}, SK: PROFILE pattern.
 */
export declare class CustomerRepository {
    private tableName;
    constructor(tableName?: string);
    /**
     * Resolve existing customer or create new one
     */
    resolveOrCreate(input: ResolveOrCreateCustomerInput): Promise<Customer>;
    /**
     * Get customer by phone number
     */
    getByPhoneNumber(phoneNumber: string): Promise<Customer | null>;
    /**
     * Create new customer
     */
    create(customer: Customer): Promise<void>;
}
//# sourceMappingURL=customer-repository.d.ts.map