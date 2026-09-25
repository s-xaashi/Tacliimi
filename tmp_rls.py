import json

# Parse RLS table status
with open('C:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/.system_generated/steps/301/output.txt', 'r', encoding='utf-8') as f:
    outer = json.load(f)
result_text = outer['result']
data = json.loads(result_text[result_text.find('[{'):result_text.rfind('}]')+2])

print("=== TABLES WITHOUT RLS ENABLED ===")
for t in data:
    if not t['rls_enabled']:
        print(f"  {t['table_name']:45} anon_select={t['anon_select']} auth_select={t['auth_select']} auth_insert={t['auth_insert']} auth_update={t['auth_update']}")

print("\n=== TABLES WITH RLS BUT ANON ACCESS ===")
for t in data:
    if t['rls_enabled'] and (t['anon_select'] or t['anon_insert'] or t['anon_update'] or t['anon_delete']):
        print(f"  {t['table_name']:45} anon: S={t['anon_select']} I={t['anon_insert']} U={t['anon_update']} D={t['anon_delete']}")

print("\n=== ALL TABLES ===")
for t in data:
    print(f"  {t['table_name']:45} rls={t['rls_enabled']} anon_sel={t['anon_select']} auth_sel={t['auth_select']} auth_ins={t['auth_insert']} auth_upd={t['auth_update']} auth_del={t['auth_delete']}")
