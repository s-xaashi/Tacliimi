import json

with open('C:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/.system_generated/steps/304/output.txt', 'r', encoding='utf-8') as f:
    outer = json.load(f)
result_text = outer['result']
data = json.loads(result_text[result_text.find('[{'):result_text.rfind('}]')+2])

# Group by table
from collections import defaultdict
by_table = defaultdict(list)
for p in data:
    by_table[p['tablename']].append(p)

print(f"Total policies: {len(data)}")
print(f"Tables with policies: {len(by_table)}\n")

# Find INSERT/UPDATE policies missing WITH CHECK
print("=== INSERT/UPDATE POLICIES WITHOUT WITH_CHECK ===")
for tbl, policies in sorted(by_table.items()):
    for p in policies:
        if p['cmd'] in ('INSERT', 'UPDATE', 'ALL') and not p.get('with_check'):
            print(f"  [{tbl}] policy={p['policyname']} cmd={p['cmd']} roles={p['roles']} qual={str(p.get('qual',''))[:80]}")

print("\n=== SENSITIVE TABLES: FULL POLICY LISTING ===")
sensitive = ['payments', 'admin_auth', 'admin_audit_logs', 'payout_methods', 'payout_transactions',
             'withdrawal_requests', 'instructor_earnings', 'refund_requests', 'promotion_orders',
             'profiles', 'support_tickets']
for tbl in sensitive:
    if tbl in by_table:
        print(f"\n--- {tbl} ({len(by_table[tbl])} policies) ---")
        for p in by_table[tbl]:
            print(f"  [{p['cmd']}] {p['policyname']}  roles={p['roles']}")
            print(f"    USING: {str(p.get('qual',''))[:120]}")
            if p.get('with_check'):
                print(f"    WITH CHECK: {str(p.get('with_check',''))[:120]}")
    else:
        print(f"\n--- {tbl}: NO POLICIES (all row access blocked by default if RLS=True) ---")

print("\n=== TABLES WITH ONLY 1 POLICY (potentially under-protected) ===")
for tbl, policies in sorted(by_table.items()):
    if len(policies) == 1:
        p = policies[0]
        print(f"  {tbl}: [{p['cmd']}] {p['policyname']} roles={p['roles']}")
