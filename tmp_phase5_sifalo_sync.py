import json
import os

with open('c:/Users/salmaan/.gemini/antigravity/brain/fe3a391e-f279-471b-a7d4-1912d88efb4e/.system_generated/steps/696/output.txt', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Extract content
sifalo_content = data['files'][0]['content']

os.makedirs('c:/Users/salmaan/.gemini/antigravity/Tacliimi/supabase/functions/sifalo-checkout', exist_ok=True)
with open('c:/Users/salmaan/.gemini/antigravity/Tacliimi/supabase/functions/sifalo-checkout/index.ts', 'w', encoding='utf-8') as f:
    f.write(sifalo_content)
