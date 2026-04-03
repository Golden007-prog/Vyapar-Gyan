'use client';

interface ProductCardProps {
  productId: string;
  name: string;
  price: number;
  imageUrl: string;
  description: string;
  onAddToCart?: (productId: string) => void;
}

export default function ProductCard({
  productId,
  name,
  price,
  imageUrl,
  description,
  onAddToCart,
}: ProductCardProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" aria-label={`Product: ${name}`}>
      <img
        src={imageUrl}
        alt={name}
        className="h-40 w-full object-cover"
      />
      <div className="p-3">
        <h4 className="text-sm font-semibold text-gray-900">{name}</h4>
        <p className="mt-0.5 text-lg font-bold text-indigo-600" aria-label={`Price: ₹${price.toLocaleString('en-IN')}`}>
          ₹{price.toLocaleString('en-IN')}
        </p>
        <p className="mt-1 line-clamp-2 text-xs text-gray-500">{description}</p>
        <button
          onClick={() => onAddToCart?.(productId)}
          className="mt-2 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 active:bg-indigo-800"
          aria-label={`Add ${name} to cart`}
        >
          Add to cart
        </button>
      </div>
    </div>
  );
}
