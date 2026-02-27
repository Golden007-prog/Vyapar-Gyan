"""Seed categories for VyaparGyan local commerce marketplace.

Usage:  python -m app.scripts.seed_categories
Idempotent: skips categories that already exist (by slug).
"""

from __future__ import annotations

import sys
import os

# Ensure the backend directory is on PYTHONPATH
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.integrations.supabase_client import get_supabase_admin_client
from app.core.logging import setup_logging, get_logger

setup_logging()
logger = get_logger("seed_categories")

# --- Category hierarchy ---
CATEGORIES = [
    {"name": "Sarees", "slug": "sarees", "description": "Traditional and designer sarees", "sort_order": 1, "children": [
        {"name": "Silk Sarees", "slug": "silk-sarees", "description": "Pure silk and blended silk sarees", "sort_order": 1},
        {"name": "Cotton Sarees", "slug": "cotton-sarees", "description": "Comfortable daily-wear cotton sarees", "sort_order": 2},
        {"name": "Designer Sarees", "slug": "designer-sarees", "description": "Party and wedding designer sarees", "sort_order": 3},
    ]},
    {"name": "Clothing", "slug": "clothing", "description": "Men's and women's clothing", "sort_order": 2, "children": [
        {"name": "Women's Wear", "slug": "womens-wear", "description": "Suits, kurtis, lehengas", "sort_order": 1},
        {"name": "Men's Wear", "slug": "mens-wear", "description": "Shirts, kurtas, trousers", "sort_order": 2},
        {"name": "Kids' Wear", "slug": "kids-wear", "description": "Children's clothing", "sort_order": 3},
    ]},
    {"name": "Grocery", "slug": "grocery", "description": "Daily essentials and staples", "sort_order": 3, "children": [
        {"name": "Atta & Rice", "slug": "atta-rice", "description": "Flour, rice, and grains", "sort_order": 1},
        {"name": "Spices & Masala", "slug": "spices-masala", "description": "Kitchen spices and masala blends", "sort_order": 2},
        {"name": "Oil & Ghee", "slug": "oil-ghee", "description": "Cooking oils and ghee", "sort_order": 3},
        {"name": "Snacks & Namkeen", "slug": "snacks-namkeen", "description": "Ready-to-eat snacks", "sort_order": 4},
    ]},
    {"name": "Beauty & Personal Care", "slug": "beauty", "description": "Skincare, haircare, cosmetics", "sort_order": 4, "children": [
        {"name": "Skincare", "slug": "skincare", "description": "Creams, lotions, face wash", "sort_order": 1},
        {"name": "Haircare", "slug": "haircare", "description": "Shampoo, oil, conditioner", "sort_order": 2},
        {"name": "Cosmetics", "slug": "cosmetics", "description": "Makeup and beauty products", "sort_order": 3},
    ]},
    {"name": "Accessories", "slug": "accessories", "description": "Jewellery, bags, watches", "sort_order": 5, "children": [
        {"name": "Jewellery", "slug": "jewellery", "description": "Artificial and fashion jewellery", "sort_order": 1},
        {"name": "Bags & Wallets", "slug": "bags-wallets", "description": "Handbags, purses, wallets", "sort_order": 2},
    ]},
    {"name": "Home & Kitchen", "slug": "home-kitchen", "description": "Home decor, utensils, furnishing", "sort_order": 6, "children": [
        {"name": "Kitchen Items", "slug": "kitchen-items", "description": "Utensils, cookware, storage", "sort_order": 1},
        {"name": "Home Decor", "slug": "home-decor", "description": "Wall art, showpieces, lamps", "sort_order": 2},
        {"name": "Bedding & Furnishing", "slug": "bedding-furnishing", "description": "Bedsheets, curtains, cushions", "sort_order": 3},
    ]},
    {"name": "Puja Items", "slug": "puja-items", "description": "Religious and puja essentials", "sort_order": 7, "children": [
        {"name": "Pooja Samagri", "slug": "pooja-samagri", "description": "Incense, camphor, cotton wicks", "sort_order": 1},
        {"name": "Idols & Frames", "slug": "idols-frames", "description": "God idols and photo frames", "sort_order": 2},
    ]},
    {"name": "Gifts", "slug": "gifts", "description": "Gift items for all occasions", "sort_order": 8},
    {"name": "Electronics", "slug": "electronics", "description": "Mobiles, accessories, gadgets", "sort_order": 9, "children": [
        {"name": "Mobile Accessories", "slug": "mobile-accessories", "description": "Cases, chargers, earphones", "sort_order": 1},
        {"name": "Small Appliances", "slug": "small-appliances", "description": "Fans, heaters, irons", "sort_order": 2},
    ]},
    {"name": "Footwear", "slug": "footwear", "description": "Shoes, sandals, chappals", "sort_order": 10, "children": [
        {"name": "Women's Footwear", "slug": "womens-footwear", "description": "Heels, flats, sandals", "sort_order": 1},
        {"name": "Men's Footwear", "slug": "mens-footwear", "description": "Shoes, sandals, chappals", "sort_order": 2},
    ]},
    {"name": "Local Specials", "slug": "local-specials", "description": "Region-specific specialties and local brands", "sort_order": 11},
]


def seed_categories():
    sb = get_supabase_admin_client()
    created = 0
    skipped = 0

    for cat in CATEGORIES:
        children = cat.pop("children", [])
        parent_id = _upsert_category(sb, cat)
        if parent_id == "skipped":
            skipped += 1
            # Still need to check children
            existing = sb.table("categories").select("id").eq("slug", cat["slug"]).execute()
            parent_id = existing.data[0]["id"] if existing.data else None
        else:
            created += 1

        if parent_id and children:
            for child in children:
                child["parent_id"] = parent_id
                result = _upsert_category(sb, child)
                if result == "skipped":
                    skipped += 1
                else:
                    created += 1

    logger.info("seed_complete", created=created, skipped=skipped)
    print(f"\n✅ Category seed complete: {created} created, {skipped} already existed.")


def _upsert_category(sb, cat_data: dict) -> str:
    """Insert if not exists (by slug). Returns new ID or 'skipped'."""
    slug = cat_data["slug"]
    existing = sb.table("categories").select("id").eq("slug", slug).execute()
    if existing.data:
        logger.info("category_exists", slug=slug)
        return "skipped"

    resp = sb.table("categories").insert({
        "name": cat_data["name"],
        "slug": cat_data["slug"],
        "description": cat_data.get("description", ""),
        "sort_order": cat_data.get("sort_order", 0),
        "parent_id": cat_data.get("parent_id"),
        "is_active": True,
    }).execute()

    new_id = resp.data[0]["id"]
    logger.info("category_created", slug=slug, id=new_id)
    print(f"  + {cat_data['name']} ({slug})")
    return new_id


if __name__ == "__main__":
    print("🌱 Seeding categories for VyaparGyan...")
    seed_categories()
