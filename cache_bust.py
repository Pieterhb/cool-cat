import os

directory = r"c:\coolcat"

for root, dirs, files in os.walk(directory):
    for file in files:
        if file.endswith(".html"):
            filepath = os.path.join(root, file)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
                
                new_content = content.replace('src="Logo.png"', 'src="Logo-v2.png"')
                new_content = new_content.replace('href="/Logo.png"', 'href="/Logo-v2.png"')
                new_content = new_content.replace('href="Logo.png"', 'href="Logo-v2.png"')
                new_content = new_content.replace('href="/favicon.ico"', 'href="/favicon-v2.ico"')
                new_content = new_content.replace('href="/apple-touch-icon.png"', 'href="/apple-touch-icon-v2.png"')
                
                if new_content != content:
                    with open(filepath, "w", encoding="utf-8") as f:
                        f.write(new_content)
                    print(f"Updated {filepath}")
            except Exception as e:
                print(f"Failed {filepath}: {e}")
