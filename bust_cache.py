import os, re, glob

OLD_VER = "v=1791380000"
NEW_VER = "v=1791390000"

files_updated = []
for root, dirs, files in os.walk('.'):
    dirs[:] = [d for d in dirs if d not in ['.git', 'node_modules']]
    for fname in files:
        if not fname.endswith('.html'):
            continue
        path = os.path.join(root, fname)
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        if OLD_VER in content:
            new_content = content.replace(OLD_VER, NEW_VER)
            with open(path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            files_updated.append(path)

print(f"Cache bust complete. Updated {len(files_updated)} files:")
for f in files_updated:
    print(f"  {f}")
