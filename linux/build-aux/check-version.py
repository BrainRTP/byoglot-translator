import os
from pathlib import Path
import tomllib

root = Path(__file__).resolve().parents[1]
version = tomllib.loads((root / "Cargo.toml").read_text())["workspace"]["package"]["version"]
if os.environ.get("GITHUB_REF_TYPE") == "tag":
    if os.environ.get("GITHUB_REF_NAME") != f"linux-v{version}":
        raise SystemExit("The Linux tag must match the workspace version")
print(version)
