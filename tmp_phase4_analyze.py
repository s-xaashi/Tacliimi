import json

# Phase 4E: Public table policies
with open('c:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/.system_generated/steps/495/output.txt', 'r', encoding='utf-8') as f:
    res = json.load(f)['result']
    pub_data = json.loads(res[res.find('[{'):res.rfind('}]')+2])

# Phase 4D: Storage table policies
with open('c:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/.system_generated/steps/496/output.txt', 'r', encoding='utf-8') as f:
    res = json.load(f)['result']
    sto_data = json.loads(res[res.find('[{'):res.rfind('}]')+2])

print("=== STORAGE POLICIES ===")
for p in sto_data:
    print(f"[{p['cmd']}] {p['policyname']}  Roles: {p['roles']}")
    if p['using_clause']: print(f"  USING: {p['using_clause'][:100]}")
    if p['with_check_clause']: print(f"  WITH CHECK: {p['with_check_clause'][:100]}")

print("\n=== PUBLIC VULNERABLE POLICIES ===")
vulnerable_tables = []
for p in pub_data:
    # Look for purely "true" policies
    qual = (p['using_clause'] or '').strip().lower()
    chk = (p['with_check_clause'] or '').strip().lower()
    
    if qual == 'true' or chk == 'true':
        print(f"[{p['tablename']}] {p['cmd']} - {p['policyname']} -> TRUE")
        vulnerable_tables.append(p['tablename'])

    # Look for missing WITH CHECK on UPDATE/INSERT
    if p['cmd'] in ('UPDATE', 'INSERT') and not p['with_check_clause']:
        print(f"[{p['tablename']}] {p['cmd']} - {p['policyname']} -> NO WITH CHECK. USING: {qual[:100]}")
