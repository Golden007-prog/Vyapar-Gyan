"""Bootstrap admin user for VyaparGyan.

Usage:  python -m app.scripts.bootstrap_admin --email admin@vyapargyan.com

Idempotent: if user already has admin role, prints a message and exits.
Requires the user to already exist in Supabase Auth (sign up first).
"""

from __future__ import annotations

import argparse
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.integrations.supabase_client import get_supabase_admin_client
from app.core.logging import setup_logging, get_logger

setup_logging()
logger = get_logger("bootstrap_admin")


def bootstrap_admin(email: str):
    sb = get_supabase_admin_client()

    # 1. Find user_profile by email
    profile_resp = sb.table("user_profiles").select("*").eq("email", email).execute()
    profiles = profile_resp.data or []

    if not profiles:
        print(f"❌ No user_profile found for email: {email}")
        print("   Make sure the user has signed up via Supabase Auth first.")
        print("   The handle_new_auth_user trigger should auto-create the profile.")
        sys.exit(1)

    profile = profiles[0]
    profile_id = profile["id"]
    auth_user_id = profile.get("auth_user_id")
    print(f"✅ Found user profile: {profile_id} (auth: {auth_user_id})")

    # 2. Find the admin role ID
    role_resp = sb.table("roles").select("id").eq("name", "admin").execute()
    roles = role_resp.data or []
    if not roles:
        print("❌ Admin role not found in 'roles' table. Did you run migrations?")
        sys.exit(1)

    admin_role_id = roles[0]["id"]

    # 3. Check if already assigned
    existing_resp = (
        sb.table("user_roles")
        .select("id")
        .eq("user_profile_id", profile_id)
        .eq("role_id", admin_role_id)
        .execute()
    )
    if existing_resp.data:
        print(f"✅ User {email} already has admin role. No changes needed.")
        return

    # 4. Assign admin role
    sb.table("user_roles").insert({
        "user_profile_id": profile_id,
        "role_id": admin_role_id,
    }).execute()
    print(f"✅ Admin role assigned to {email}")

    # 5. Update profile is_active
    sb.table("user_profiles").update({"is_active": True}).eq("id", profile_id).execute()
    print(f"✅ Profile activated")

    logger.info("admin_bootstrapped", email=email, profile_id=profile_id)
    print(f"\n🎉 {email} is now an admin. They can sign in and access /api/v1/admin/* endpoints.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bootstrap admin user for VyaparGyan")
    parser.add_argument("--email", required=True, help="Email of the user to promote to admin")
    args = parser.parse_args()
    bootstrap_admin(args.email)
