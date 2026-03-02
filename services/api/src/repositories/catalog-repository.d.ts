export interface Category {
    id: string;
    name: string;
    description?: string;
    imageUrl?: string;
    displayOrder: number;
    isActive: boolean;
}
export interface Product {
    id: string;
    sellerId: string;
    categoryId: string;
    name: string;
    description: string;
    price: number;
    stockQuantity: number;
    imageUrls: string[];
    isActive: boolean;
    createdAt: string;
}
/**
 * CatalogRepository
 *
 * Manages product catalog data access from DynamoDB.
 * Provides read-only access for browsing and search.
 */
export declare class CatalogRepository {
    private tableName;
    constructor(tableName?: string);
    /**
     * Get all active categories
     */
    getCategories(): Promise<Category[]>;
    /**
     * Get category by ID
     */
    getCategoryById(categoryId: string): Promise<Category | null>;
    /**
     * Get products by category
     */
    getProductsByCategory(categoryId: string, limit?: number): Promise<Product[]>;
    /**
     * Get product by ID
     */
    getProductById(productId: string): Promise<Product | null>;
    /**
     * Search products by name (simple text match)
     */
    searchProducts(query: string, limit?: number): Promise<Product[]>;
}
//# sourceMappingURL=catalog-repository.d.ts.map