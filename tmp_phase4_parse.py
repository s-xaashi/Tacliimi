import json

def parse_policies(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = json.load(f)['result']
        if '[{' not in content: return []
        return json.loads(content[content.find('[{'):content.rfind('}]')+2])

tables = parse_policies('c:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/.system_generated/steps/540/output.txt')
storage = parse_policies('c:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/.system_generated/steps/541/output.txt')

print("=== TABLE POLICIES ===")
for p in tables:
    if p['cmd'] in ('UPDATE', 'INSERT', 'ALL'):
        print(f"{p['tablename']} | {p['cmd']} | {p['policyname']} | WITH_CHECK={bool(p['with_check'])}")

print("\n=== STORAGE POLICIES ===")
for p in storage:
    if p['cmd'] in ('UPDATE', 'INSERT'):
        print(f"storage.objects | {p['cmd']} | {p['policyname']}")
