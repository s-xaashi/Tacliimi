import json

with open('c:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/.system_generated/steps/606/output.txt', 'r', encoding='utf-8') as f:
    res = json.load(f)['result']
    data = json.loads(res[res.find('[{'):res.rfind('}]')+2])

for p in data:
    name = p['proname']
    src = p['prosrc']
    is_secdef = p['prosecdef']
    args = p['args']
    
    print(f"\n--- {name} ({args}) [SECDEF: {is_secdef}] ---")
    
    # Simple static analysis flags
    flags = []
    
    # 1. Admin / Auth checks
    if 'auth.uid()' not in src:
        flags.append("NO auth.uid() CHECK")
    if 'profile' in src.lower() and 'admin' in src.lower() and ('select 1' not in src.lower() or 'role =' not in src.lower()):
        flags.append("POTENTIAL WEAK ADMIN CHECK")
        
    # 2. Concurrency / FOR UPDATE
    if any(k in name for k in ('consume', 'create', 'book', 'enroll', 'withdraw', 'refund', 'payment')):
        if 'for update' not in src.lower():
            flags.append("MISSING FOR UPDATE (Race Condition Risk)")
            
    # 3. Dynamic SQL / Arbitrary ID
    if 'execute ' in src.lower():
        flags.append("DYNAMIC SQL (SQLi Risk)")
        
    print(f"FLAGS: {', '.join(flags) if flags else 'None'}")
    
    if flags:
        print(src[:200] + '...')
