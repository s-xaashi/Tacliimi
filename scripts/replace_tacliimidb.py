import os
import re

ROOT_DIR = r"c:\Users\salmaan\.gemini\antigravity\Tacliimi"

def process_directory(directory):
    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith(".html"):
                filepath = os.path.join(root, file)
                try:
                    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                        content = f.read()

                    # Find script tags involving tacliimi_db.js and replace them
                    new_content = re.sub(
                        r'<script\s+src="([^"]*tacliimi_db\.js)"[^>]*>\s*</script>', 
                        lambda m: '<script type="module" src="' + m.group(1).replace('tacliimi_db.js', 'globalProfile.js') + '"></script>', 
                        content
                    )
                    
                    # Also replace plain string references if any
                    new_content = new_content.replace('TacliimiDB.init()', '// Removed TacliimiDB')
                    new_content = new_content.replace('TacliimiDB.toggleTheme()', 'document.documentElement.classList.toggle(\'dark\'); localStorage.theme = document.documentElement.classList.contains(\'dark\') ? \'dark\' : \'light\';')

                    if new_content != content:
                        with open(filepath, 'w', encoding='utf-8') as f:
                            f.write(new_content)
                        print(f"Updated: {filepath}")
                except Exception as e:
                    print(f"Failed to process {filepath}: {e}")

process_directory(os.path.join(ROOT_DIR, 'src'))
process_directory(os.path.join(ROOT_DIR, 'public'))
print("Done processing HTML files.")
