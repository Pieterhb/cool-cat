import os

directory = r"c:\coolcat"
old_tags = """    <link rel="icon" type="image/png" href="/Logo.png">
    <link rel="apple-touch-icon" href="/Logo.png">"""
new_tags = """    <link rel="icon" type="image/x-icon" href="/favicon.ico">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">"""

for root, dirs, files in os.walk(directory):
    for file in files:
        if file.endswith(".html"):
            filepath = os.path.join(root, file)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
                
                if old_tags in content:
                    content = content.replace(old_tags, new_tags)
                    with open(filepath, "w", encoding="utf-8") as f:
                        f.write(content)
                    print(f"Updated {filepath}")
            except Exception as e:
                print(f"Failed {filepath}: {e}")
