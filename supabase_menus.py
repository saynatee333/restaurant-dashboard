import os
from typing import Any

from supabase import Client, create_client


def get_supabase_client() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")

    if not url or not key:
        raise ValueError(
            "Missing SUPABASE_URL or SUPABASE_KEY. "
            "Set them in your environment or .env file."
        )

    return create_client(url, key)


def get_menus(limit: int = 20) -> list[dict[str, Any]]:
    """
    Fetch rows from the menus table.
    """
    client = get_supabase_client()
    response = client.table("menus").select("*").limit(limit).execute()
    return response.data or []


if __name__ == "__main__":
    try:
        # Lazy import so this file still works if dotenv is not installed.
        from dotenv import load_dotenv

        load_dotenv()
    except Exception:
        pass

    try:
        menus = get_menus(limit=20)
        if not menus:
            print("No rows found in menus table.")
        else:
            print("Menus:")
            for idx, row in enumerate(menus, start=1):
                print(f"{idx}. {row}")
    except Exception as error:
        print(f"Failed to fetch menus: {error}")
