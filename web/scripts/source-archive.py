from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
names = ['src', 'public', 'scripts', 'db', 'drizzle', 'migrations', 'test', 'package.json', 'package-lock.json', 'wrangler.toml', 'drizzle.config.ts', 'README.md', 'LICENSE', '.gitignore']
with ZipFile(root / 'public/source.zip', 'w', ZIP_DEFLATED) as archive:
    for name in names:
        path = root / name
        files = path.rglob('*') if path.is_dir() else [path]
        for file in sorted(files):
            if file.is_file() and file.name != 'source.zip' and '__pycache__' not in file.parts:
                archive.write(file, 'uijeongbu-movie-alerts/' + str(file.relative_to(root)))
