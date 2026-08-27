import json

with open('c:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/.system_generated/steps/516/output.txt', 'r', encoding='utf-8') as f:
    res = json.load(f)['result']
    data = json.loads(res[res.find('[{'):res.rfind('}]')+2])

for row in data:
    if row['column_name'] in ['is_featured', 'approval_status', 'admin_id', 'status', 'mentor_payout_amount', 'rating', 'verification_status']:
        print(f"{row['table_name']}.{row['column_name']} ({row['data_type']}) - POTENTIALLY VULNERABLE TO MASS ASSIGNMENT")
