import json

with open('c:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/.system_generated/steps/657/output.txt', 'r', encoding='utf-8') as f:
    res = json.load(f)['result']
    data = json.loads(res[res.find('[{'):res.rfind('}]')+2])

for p in data:
    name = p['proname']
    src = p['prosrc']
    args = p['args']
    
    print(f"\n======================================")
    print(f"FUNCTION: {name} ({args})")
    print(f"======================================")
    
    lines = src.split('\n')
    for line in lines:
        if 'auth.uid()' in line or 'SELECT 1 FROM' in line or 'RAISE EXCEPTION' in line or 'DELETE' in line or 'UPDATE' in line:
            print("  " + line.strip())
