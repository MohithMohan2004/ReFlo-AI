import os
from dotenv import load_dotenv

load_dotenv()


class Config:

    # Signs logins and (without OCEMS_KEY_SECRET) encrypts saved OCEMS
    # API keys. There is no default: a public placeholder would let anyone
    # forge a session.
    SECRET_KEY = os.environ.get("FLASK_SECRET_KEY")
    if not SECRET_KEY:
        raise RuntimeError(
            "FLASK_SECRET_KEY is not set. Add it to .env (local) or to the "
            "container app's secrets (Azure)."
        )

    # Supabase
    SUPABASE_URL = os.environ.get("SUPABASE_URL")
    SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
