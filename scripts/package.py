from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parents[1]
output = root / "dist"
output.mkdir(exist_ok=True)
version = json.loads((root / "extension" / "manifest.json").read_text())["version"]
package = output / f"stacks-{version}.zip"
with ZipFile(package, "w", ZIP_DEFLATED) as archive:
    for file in sorted((root / "extension").rglob("*")):
        if file.is_file() and file.name != ".DS_Store":
            archive.write(file, file.relative_to(root / "extension"))
print(package)
