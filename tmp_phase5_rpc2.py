import json

with open('c:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/.system_generated/steps/606/output.txt', 'r', encoding='utf-8') as f:
    res = json.load(f)['result']
    data = json.loads(res[res.find('[{'):res.rfind('}]')+2])

flagged = ['request_withdrawal', 'create_admin_account', 'create_update_offer', 'get_all_users_admin']

for p in data:
    name = p['proname']
    if name in flagged:
        print(f"\n======================================")
        print(f"FUNCTION: {name} ({p['args']})")
        print(f"======================================")
        print(p['prosrc'])
