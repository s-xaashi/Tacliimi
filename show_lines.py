path = r'c:\Users\salmaan\.gemini\antigravity\Tacliimi\src\pages\instructor\instructor-profile\index.html'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines[1600:1620]):
    # ensure no print crash
    print(f"{1601+i}: {line.encode('ascii', 'replace').decode('ascii').rstrip()}")
